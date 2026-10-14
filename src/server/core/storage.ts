import { mkdir, writeFile, rename, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import JSZip from 'jszip';
import { AppError } from '../errors';
import { id } from './shared';
import type { AssetDto } from '../../contracts/core';
const execFileAsync = promisify(execFile);
export interface IngestAssetInput {
  buffer: Buffer;
  name: string;
  mimeType: string;
  projectId?: string;
  source?: AssetDto['source'];
  sourceJobId?: string;
  tags?: string[];
}
export interface PreparedVariant {
  variant: 'original' | 'preview' | 'thumbnail';
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
}
export interface PreparedAsset {
  id: string;
  name: string;
  kind: AssetDto['kind'];
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sha256: string;
  source: AssetDto['source'];
  sourceJobId: string | null;
  projectId: string | null;
  tags: string[];
  variants: PreparedVariant[];
}
const MIME_KIND: Record<string, AssetDto['kind']> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/mp4': 'audio',
  'text/plain': 'document',
  'text/markdown': 'document',
  'application/pdf': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
};
export class PrivateStorage {
  constructor(private root: string) {}
  path(key: string): string {
    const path = resolve(this.root, key),
      base = resolve(this.root);
    if (!path.startsWith(base + sep)) throw new AppError(400, 'INVALID_STORAGE_KEY', '非法文件键');
    return path;
  }
  async write(buffer: Buffer, suffix: string): Promise<string> {
    const key = `${id().slice(0, 2)}/${id()}${suffix}`,
      path = this.path(key);
    await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
    const temp = `${path}.tmp`;
    await writeFile(temp, buffer, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
    return key;
  }
  async read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async prepare(input: IngestAssetInput): Promise<PreparedAsset> {
    if (!input.buffer.length || input.buffer.length > 100 * 1024 * 1024)
      throw new AppError(413, 'FILE_TOO_LARGE', '文件大小须为1字节至100MiB');
    const name = input.name.replace(/[\x00-\x1f/\\]/g, '_').slice(0, 200) || '未命名素材',
      extension = extname(name).toLowerCase();
    const detected = await fileTypeFromBuffer(input.buffer);
    let mimeType = detected?.mime ?? '';
    if (['.txt', '.md'].includes(extension) && !detected) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(input.buffer);
      } catch {
        throw new AppError(400, 'INVALID_TEXT', '文本必须使用UTF-8编码');
      }
      if (input.buffer.includes(0)) throw new AppError(400, 'INVALID_TEXT', '文本包含二进制内容');
      mimeType = extension === '.md' ? 'text/markdown' : 'text/plain';
    }
    if (
      extension === '.docx' &&
      [
        'application/zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ].includes(mimeType)
    ) {
      await this.validateDocx(input.buffer);
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    const kind = MIME_KIND[mimeType];
    if (!kind)
      throw new AppError(
        415,
        'UNSUPPORTED_FILE',
        '仅支持常用图片、音视频及TXT、Markdown、PDF、DOCX',
      );
    if (kind === 'document' && input.buffer.length > 20 * 1024 * 1024)
      throw new AppError(413, 'FILE_TOO_LARGE', '文档最大20MiB');
    let width: number | null = null,
      height: number | null = null,
      durationMs: number | null = null;
    const variants: PreparedVariant[] = [];
    if (kind === 'image') {
      const metadata = await sharp(input.buffer, {
        limitInputPixels: 64_000_000,
        animated: false,
      }).metadata();
      // Scene and OCR coordinates follow browser/preview orientation; retain original bytes below.
      const swapAxes =
        metadata.orientation !== undefined &&
        metadata.orientation >= 5 &&
        metadata.orientation <= 8;
      width = (swapAxes ? metadata.height : metadata.width) ?? null;
      height = (swapAxes ? metadata.width : metadata.height) ?? null;
      if (!width || !height || width > 16384 || height > 16384)
        throw new AppError(400, 'INVALID_IMAGE', '图片尺寸超出范围');
      await sharp(input.buffer, { limitInputPixels: 64_000_000 }).stats();
      for (const [variant, size] of [
        ['thumbnail', 480],
        ['preview', 1600],
      ] as const) {
        const output = await sharp(input.buffer, { limitInputPixels: 64_000_000 })
          .rotate()
          .resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: variant === 'thumbnail' ? 78 : 88 })
          .toBuffer({ resolveWithObject: true });
        variants.push({
          variant,
          storageKey: await this.write(output.data, '.webp'),
          mimeType: 'image/webp',
          byteSize: output.data.length,
          width: output.info.width,
          height: output.info.height,
        });
      }
    }
    const originalKey = await this.write(input.buffer, detected ? `.${detected.ext}` : extension);
    if (kind === 'video' || kind === 'audio') {
      try {
        const { stdout } = await execFileAsync(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'format=duration:stream=codec_type,width,height',
            '-of',
            'json',
            this.path(originalKey),
          ],
          { timeout: 15000, maxBuffer: 1024 * 1024 },
        );
        const metadata = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: { codec_type: string; width?: number; height?: number }[];
        };
        const stream = metadata.streams?.find((s) => s.codec_type === 'video');
        width = stream?.width ?? null;
        height = stream?.height ?? null;
        durationMs = Math.round(Number(metadata.format?.duration) * 1000);
        if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('duration');
      } catch {
        throw new AppError(
          422,
          'MEDIA_PROBE_FAILED',
          '无法验证媒体，请安装FFmpeg/ffprobe并检查文件格式',
        );
      }
    }
    variants.unshift({
      variant: 'original',
      storageKey: originalKey,
      mimeType,
      byteSize: input.buffer.length,
      width,
      height,
    });
    return {
      id: id(),
      name,
      kind,
      mimeType,
      byteSize: input.buffer.length,
      width,
      height,
      durationMs,
      sha256: createHash('sha256').update(input.buffer).digest('hex'),
      source: input.source ?? 'upload',
      sourceJobId: input.sourceJobId ?? null,
      projectId: input.projectId ?? null,
      tags: input.tags ?? [],
      variants,
    };
  }
  async validateDocx(buffer: Buffer): Promise<void> {
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files);
    if (entries.length > 2000 || !zip.file('word/document.xml') || !zip.file('[Content_Types].xml'))
      throw new AppError(400, 'INVALID_DOCX', '不是有效的DOCX文档');
    // Read ZIP central-directory sizes before expansion so a small compressed upload cannot allocate unbounded memory.
    let declared = 0,
      entriesFound = 0;
    for (let offset = 0; offset + 46 <= buffer.length; offset++) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
      const size = buffer.readUInt32LE(offset + 24),
        nameLength = buffer.readUInt16LE(offset + 28),
        extraLength = buffer.readUInt16LE(offset + 30),
        commentLength = buffer.readUInt16LE(offset + 32);
      declared += size;
      entriesFound++;
      if (size === 0xffffffff || declared > 40 * 1024 * 1024)
        throw new AppError(413, 'DOCX_EXPANSION_LIMIT', 'DOCX展开体积过大');
      offset += 45 + nameLength + extraLength + commentLength;
    }
    if (entriesFound !== entries.length)
      throw new AppError(400, 'INVALID_DOCX', '不支持此DOCX压缩结构');
    if (entries.some((e) => /vbaProject\.bin$/i.test(e.name)))
      throw new AppError(415, 'MACRO_NOT_ALLOWED', '不支持含宏文档');
  }
  async size(key: string): Promise<number> {
    return (await stat(this.path(key))).size;
  }
}

import sharp, { type Sharp } from 'sharp';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProviderError, type ProviderAdapter } from '../tasks/types';
const exec = promisify(execFile);
export const hasFfmpeg = () =>
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0;
const MAX_OUTPUT_PIXELS = 64_000_000;
const MAX_OUTPUT_SIDE = 16_384;
function assertOutputSize(width: number, height: number) {
  if (
    ![width, height].every((value) => Number.isFinite(value) && value >= 1) ||
    width > MAX_OUTPUT_SIDE ||
    height > MAX_OUTPUT_SIDE ||
    width * height > MAX_OUTPUT_PIXELS
  )
    throw new ProviderError('处理结果超过64MP或16384像素单边限制，请减少图片或降低尺寸。');
}
async function orientedSize(buffer: Buffer) {
  const meta = await sharp(buffer, { limitInputPixels: MAX_OUTPUT_PIXELS }).metadata();
  if (!meta.width || !meta.height) throw new ProviderError('无法读取图片尺寸。');
  const rotated = meta.orientation !== undefined && meta.orientation >= 5 && meta.orientation <= 8;
  return rotated
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}
function scaledSize(source: { width: number; height: number }, width?: number, height?: number) {
  const scale =
    width && height
      ? Math.min(width / source.width, height / source.height)
      : width
        ? width / source.width
        : height
          ? height / source.height
          : 1;
  // Ceil is a conservative preflight bound for libvips integer resampling.
  const output = {
    width: Math.ceil(source.width * scale),
    height: Math.ceil(source.height * scale),
  };
  assertOutputSize(output.width, output.height);
  return output;
}
export const localProvider: ProviderAdapter = {
  id: 'local',
  async execute(c) {
    const i = c.input,
      o = i.options;
    const source = await c.readAsset(i.assetIds[0]!);
    if (i.operation === 'local.video-trim') {
      const dir = await mkdtemp(join(tmpdir(), 'yingzao-video-'));
      try {
        const input = join(dir, 'source.mp4'),
          output = join(dir, 'result.mp4');
        await writeFile(input, source.buffer);
        await exec(
          'ffmpeg',
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            String(o.trimStart),
            '-i',
            input,
            '-t',
            String((o.trimEnd || o.duration) - o.trimStart),
            '-map',
            '0:v:0',
            '-map',
            '0:a?',
            '-c:v',
            'libx264',
            '-crf',
            '18',
            '-preset',
            'fast',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            '-y',
            output,
          ],
          { timeout: 300000, maxBuffer: 1024 * 1024 },
        );
        return {
          state: 'complete',
          outputs: [
            { buffer: await readFile(output), mimeType: 'video/mp4', name: '裁剪视频.mp4' },
          ],
        };
      } catch {
        throw new ProviderError('视频裁剪失败，请检查时间范围与 FFmpeg 安装。');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    let pipeline: Sharp;
    if (i.operation === 'local.stitch') {
      const width = o.width || 1200;
      // Inspect the whole composition before allocating any resized image.
      let plannedHeight = 0;
      for (const id of i.assetIds) {
        const a = id === i.assetIds[0] ? source : await c.readAsset(id);
        plannedHeight += scaledSize(await orientedSize(a.buffer), width).height;
        assertOutputSize(width, plannedHeight);
      }
      const pieces: { input: Buffer; left: number; top: number }[] = [];
      let height = 0;
      for (const id of i.assetIds) {
        const a = await c.readAsset(id);
        const { data, info } = await sharp(a.buffer, { limitInputPixels: 64_000_000 })
          .rotate()
          .resize({ width })
          .png()
          .toBuffer({ resolveWithObject: true });
        pieces.push({ input: data, left: 0, top: height });
        height += info.height;
      }
      assertOutputSize(width, height);
      pipeline = sharp({
        create: { width, height, channels: 4, background: o.background },
      }).composite(pieces);
    } else {
      if (!['local.resize', 'local.convert'].includes(i.operation))
        throw new ProviderError('本机处理不支持该操作。');
      const dimensions = await orientedSize(source.buffer);
      scaledSize(
        dimensions,
        i.operation === 'local.resize' ? o.width : undefined,
        i.operation === 'local.resize' ? o.height : undefined,
      );
      pipeline = sharp(source.buffer, { limitInputPixels: MAX_OUTPUT_PIXELS }).rotate();
      if (i.operation === 'local.resize')
        pipeline = pipeline.resize({
          width: o.width,
          height: o.height,
          fit: 'inside',
          withoutEnlargement: false,
        });
    }
    if (o.format === 'jpeg')
      pipeline = pipeline.flatten({ background: o.background }).jpeg({ quality: 94 });
    else if (o.format === 'webp') pipeline = pipeline.webp({ quality: 94 });
    else pipeline = pipeline.png();
    return {
      state: 'complete',
      outputs: [
        {
          buffer: await pipeline.toBuffer(),
          mimeType: `image/${o.format}`,
          name: `${i.operation === 'local.stitch' ? '长图' : '处理图片'}.${o.format === 'jpeg' ? 'jpg' : o.format}`,
        },
      ],
    };
  },
};

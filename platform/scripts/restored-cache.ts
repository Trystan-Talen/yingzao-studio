import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { regularFile } from './backup-integrity';

const OutputSchema = z
  .object({
    path: z.string().min(1).optional(),
    url: z.string().url().optional(),
    mimeType: z.string().min(1),
    name: z.string(),
    text: z.string().optional(),
    resultData: z.unknown().optional(),
  })
  .passthrough();
const OutputsSchema = z.array(OutputSchema).min(1).max(10);
const ResultSchema = z.union([
  OutputsSchema,
  z
    .object({
      outputKind: z.enum(['single', 'layers']),
      outputs: OutputsSchema,
      billingDisposition: z.literal('no-visible-text').optional(),
    })
    .passthrough(),
]);
type CachedItem = { id: string; status: string; phase: string; fence: number; result_json: string };
export class RestoredCacheError extends Error {
  constructor(
    public code: string,
    public itemId: string,
    reason: string,
  ) {
    super(`任务 ${itemId} 的恢复缓存${reason}，请核对该备份后重试。`);
    this.name = 'RestoredCacheError';
  }
}
const mediaTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
]);

/** Run only on an unpublished snapshot. Never reads historical absolute paths. */
export async function rebaseRestoredCaches(
  snapshotRoot: string,
  finalStorageDir: string,
  options: { verifyOnly?: boolean } = {},
) {
  const database = join(snapshotRoot, 'database.sqlite');
  await regularFile(database);
  const db = new Database(database, { fileMustExist: true, readonly: options.verifyOnly === true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_items'").get())
      return { rebasedItems: 0, verifiedFiles: [] };
    const rows = db
      .prepare(
        'SELECT id,status,phase,fence,result_json FROM job_items WHERE result_json IS NOT NULL',
      )
      .all() as CachedItem[];
    const updates: { id: string; original: string; value: string }[] = [];
    const verifiedFiles: { itemId: string; file: string; byteSize: number; sha256: string }[] = [];
    const mediaRoot = resolve(snapshotRoot, 'media');
    const cacheRoot = join(mediaRoot, '.job-results');
    for (const row of rows) {
      const fail = (code: string, reason: string): never => {
        throw new RestoredCacheError(code, row.id, reason);
      };
      let parsed: z.infer<typeof ResultSchema>;
      try {
        parsed = ResultSchema.parse(JSON.parse(row.result_json));
      } catch {
        fail('RESTORE_CACHE_MANIFEST', '清单格式无效');
      }
      const outputs = Array.isArray(parsed!) ? parsed! : parsed!.outputs;
      let changed = false;
      for (const [index, output] of outputs.entries()) {
        if (!output.path) continue;
        if (row.status === 'queued' || (row.status === 'running' && row.phase !== 'downloading'))
          fail('RESTORE_CACHE_STATE', '状态与已保存产物不一致');
        const filename = basename(output.path);
        const prefix = `${row.id}-`;
        const match = /^(\d+)-(\d+)\.bin$/.exec(filename.slice(prefix.length));
        if (
          !isAbsolute(output.path) ||
          output.path.includes('\\') ||
          basename(dirname(output.path)) !== '.job-results' ||
          !filename.startsWith(prefix) ||
          !match ||
          Number(match[1]) < 1 ||
          Number(match[1]) > row.fence ||
          Number(match[2]) !== index ||
          output.url !== undefined
        )
          fail('RESTORE_CACHE_OWNERSHIP', '路径或任务归属无效');
        const localPath = join(cacheRoot, filename);
        let bytes: Buffer;
        try {
          for (const directory of [mediaRoot, cacheRoot])
            if (!(await lstat(directory)).isDirectory()) throw new Error('Invalid directory');
          const info = await regularFile(localPath);
          if (!info.size || info.size > 100 * 1024 * 1024) throw new Error('Invalid size');
          bytes = await readFile(localPath);
          if (bytes.length !== info.size) throw new Error('Changed cache');
        } catch {
          fail('RESTORE_CACHE_MISSING', '文件缺失、大小无效或包含符号链接');
        }
        let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
        try {
          detected = await fileTypeFromBuffer(bytes!);
        } catch {
          fail('RESTORE_CACHE_CONTENT', '文件格式无效');
        }
        if (!detected! || !mediaTypes.has(detected!.mime))
          fail('RESTORE_CACHE_CONTENT', '文件格式无效');
        verifiedFiles.push({
          itemId: row.id,
          file: `.job-results/${filename}`,
          byteSize: bytes!.length,
          sha256: createHash('sha256').update(bytes!).digest('hex'),
        });
        output.path = resolve(finalStorageDir, '.job-results', filename);
        changed = true;
      }
      if (changed)
        updates.push({ id: row.id, original: row.result_json, value: JSON.stringify(parsed!) });
    }
    if (!options.verifyOnly)
      db.transaction(() => {
        const update = db.prepare(
          'UPDATE job_items SET result_json=? WHERE id=? AND result_json=?',
        );
        for (const row of updates)
          if (update.run(row.value, row.id, row.original).changes !== 1)
            throw new RestoredCacheError('RESTORE_CACHE_CONFLICT', row.id, '在核验期间发生变更');
      }).immediate();
    return { rebasedItems: options.verifyOnly ? 0 : updates.length, verifiedFiles };
  } finally {
    db.close();
  }
}

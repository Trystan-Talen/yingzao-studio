import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, mkdir, rename, rmdir, realpath } from 'node:fs/promises';
import { join, resolve, sep, dirname, basename } from 'node:path';
import { z } from 'zod';

const DigestSchema = z.object({
  path: z
    .string()
    .refine(
      (value) =>
        value === 'database.sqlite' ||
        value === 'keys.json' ||
        (value.startsWith('media/') &&
          value.split('/').every((part) => part && part !== '.' && part !== '..') &&
          !value.includes('\\')),
    ),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const BackupManifestSchema = z.discriminatedUnion('formatVersion', [
  z.object({ formatVersion: z.literal(1) }),
  z.object({ formatVersion: z.literal(2), files: z.array(DigestSchema).min(2) }),
]);
type FileDigest = z.infer<typeof DigestSchema>;

export async function canonicalTarget(path: string): Promise<string> {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(ancestor), ...suffix);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

export async function regularFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('备份只接受普通文件，不能包含符号链接');
  return info;
}
export async function digest(path: string): Promise<Omit<FileDigest, 'path'>> {
  await regularFile(path);
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    byteSize += (chunk as Buffer).length;
  }
  return { byteSize, sha256: hash.digest('hex') };
}
export async function mediaFiles(root: string, prefix = ''): Promise<string[]> {
  if (!(await lstat(root)).isDirectory()) throw new Error('备份媒体目录不能是符号链接');
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await mediaFiles(join(root, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
    else throw new Error('备份媒体不能包含符号链接或其他非普通文件');
  }
  return files.sort();
}
export async function collectDigests(root: string): Promise<FileDigest[]> {
  const paths = [
    'database.sqlite',
    'keys.json',
    ...(await mediaFiles(join(root, 'media'))).map((path) => `media/${path}`),
  ];
  const files: FileDigest[] = [];
  for (const path of paths) files.push({ path, ...(await digest(join(root, path))) });
  return files;
}
export async function verifyDigests(root: string, files: FileDigest[]) {
  const actual = await collectDigests(root);
  const expected = new Map(files.map((file) => [file.path, file]));
  if (expected.size !== files.length || expected.size !== actual.length)
    throw new Error('备份文件清单完整性校验未通过');
  for (const file of actual) {
    const entry = expected.get(file.path);
    if (!entry || entry.byteSize !== file.byteSize || entry.sha256 !== file.sha256)
      throw new Error(`备份文件摘要校验未通过：${file.path}`);
  }
}
export async function verifySnapshot(root: string) {
  const database = join(root, 'database.sqlite');
  await regularFile(database);
  await regularFile(join(root, 'keys.json'));
  z.object({ sessionSecret: z.string().min(1), encryptionKey: z.string().min(1) }).parse(
    JSON.parse(await readFile(join(root, 'keys.json'), 'utf8')),
  );
  // Read-only verification must not create a missing database or change a source snapshot.
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
    if (integrity.some((row) => row.integrity_check !== 'ok'))
      throw new Error('备份数据库完整性校验未通过');
    if ((db.pragma('foreign_key_check') as unknown[]).length)
      throw new Error('备份数据库关联完整性校验未通过');
    const missingOriginal = db
      .prepare(
        "SELECT a.id FROM assets a WHERE NOT EXISTS (SELECT 1 FROM asset_variants v WHERE v.asset_id=a.id AND v.variant='original') LIMIT 1",
      )
      .get();
    if (missingOriginal) throw new Error('备份素材缺少原件关联，完整性校验未通过');
    const files = db
      .prepare(
        'SELECT v.storage_key,v.byte_size,v.variant,a.sha256 FROM asset_variants v JOIN assets a ON a.id=v.asset_id',
      )
      .all() as {
      storage_key: string;
      byte_size: number;
      variant: string;
      sha256: string;
    }[];
    const mediaRoot = resolve(root, 'media');
    // Also reject symlinks in intermediate directories, not just at a referenced leaf.
    const available = new Set(await mediaFiles(mediaRoot));
    for (const file of files) {
      const path = resolve(mediaRoot, file.storage_key);
      if (!path.startsWith(`${mediaRoot}${sep}`) || !available.has(file.storage_key))
        throw new Error('备份素材路径或文件完整性校验未通过');
      const info = await regularFile(path);
      if (info.size !== file.byte_size) throw new Error('备份素材大小校验未通过');
      if (file.variant === 'original' && (await digest(path)).sha256 !== file.sha256)
        throw new Error('备份素材原件摘要校验未通过');
    }
  } finally {
    db.close();
  }
}
export async function publishSnapshot(stage: string, destination: string, existsMessage: string) {
  // Reserve the destination exclusively before rename; two concurrent restores/backups
  // must never replace one another's completed directory.
  try {
    await mkdir(destination, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      throw new Error(existsMessage);
    throw error;
  }
  try {
    await rename(stage, destination);
  } catch (error) {
    // Only remove our still-empty reservation; never recursively erase a destination.
    await rmdir(destination).catch(() => undefined);
    throw error;
  }
}

import { cp, mkdir, readFile, lstat, rm } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  BackupManifestSchema,
  regularFile,
  mediaFiles,
  verifyDigests,
  verifySnapshot,
  publishSnapshot,
  canonicalTarget,
} from './backup-integrity';
import { rebaseRestoredCaches } from './restored-cache';
export async function restore(source: string, destination: string) {
  source = resolve(source);
  destination = resolve(destination);
  if ((await canonicalTarget(destination)).startsWith(`${await canonicalTarget(source)}${sep}`))
    throw new Error('恢复目标必须位于备份目录之外');
  try {
    await lstat(destination);
    throw new Error('恢复目标已存在；为保护现有数据，必须使用新的空目录');
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
  }
  for (const name of ['manifest.json', 'database.sqlite', 'keys.json'])
    await regularFile(join(source, name));
  await mediaFiles(join(source, 'media'));
  const manifest = BackupManifestSchema.parse(
    JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')),
  );
  const stage = `${destination}.staging-${randomUUID()}`;
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(stage, { mode: 0o700 });
  try {
    await cp(join(source, 'database.sqlite'), join(stage, 'database.sqlite'));
    await cp(join(source, 'media'), join(stage, 'media'), { recursive: true });
    await cp(join(source, 'keys.json'), join(stage, 'keys.json'));
    if (manifest.formatVersion === 2) await verifyDigests(stage, manifest.files);
    await verifySnapshot(stage);
    await rebaseRestoredCaches(stage, join(destination, 'media'));
    await publishSnapshot(stage, destination, '恢复目标已存在；为保护现有数据，必须使用新的空目录');
    return destination;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  if (!process.argv[2] || !process.argv[3])
    throw new Error('用法：pnpm restore <备份目录> <新目录>');
  console.info(
    `恢复并校验完成：${await restore(resolve(process.argv[2]), resolve(process.argv[3]))}`,
  );
}

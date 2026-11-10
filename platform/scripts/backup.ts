import { cp, mkdir, writeFile, lstat, rm } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { loadConfig, type AppConfig } from '../src/server/config';
import {
  regularFile,
  mediaFiles,
  collectDigests,
  verifySnapshot,
  publishSnapshot,
  canonicalTarget,
} from './backup-integrity';
import { rebaseRestoredCaches } from './restored-cache';
export async function backup(
  config: AppConfig,
  destination = resolve('var/backups', new Date().toISOString().replaceAll(':', '-')),
) {
  destination = resolve(destination);
  const actualDestination = await canonicalTarget(destination);
  const actualMedia = await canonicalTarget(config.storageDir);
  if (actualDestination === actualMedia || actualDestination.startsWith(`${actualMedia}${sep}`))
    throw new Error('备份目标必须位于媒体目录之外');
  await regularFile(config.databasePath);
  try {
    await lstat(destination);
    throw new Error('Backup destination already exists');
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
  }
  await mediaFiles(config.storageDir);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const stage = `${destination}.staging-${randomUUID()}`;
  await mkdir(stage, { mode: 0o700 });
  try {
    const db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
    try {
      await db.backup(join(stage, 'database.sqlite'));
    } finally {
      db.close();
    }
    // Assets are immutable and retained after soft deletion. Copying after the SQLite snapshot
    // therefore captures every referenced original, even while newer assets are being added.
    await cp(config.storageDir, join(stage, 'media'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await writeFile(
      join(stage, 'keys.json'),
      JSON.stringify({ sessionSecret: config.sessionSecret, encryptionKey: config.encryptionKey }),
      { mode: 0o600, flag: 'wx' },
    );
    await verifySnapshot(stage);
    // Scratch results can be removed as live jobs finish. A database snapshot that
    // still references missing copied results must not be published as recoverable.
    await rebaseRestoredCaches(stage, config.storageDir, { verifyOnly: true });
    const files = await collectDigests(stage);
    await writeFile(
      join(stage, 'manifest.json'),
      JSON.stringify(
        {
          formatVersion: 2,
          createdAt: new Date().toISOString(),
          database: 'database.sqlite',
          media: 'media',
          keys: 'keys.json',
          demoMode: config.demoMode,
          files,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: 'wx' },
    );
    await publishSnapshot(stage, destination, 'Backup destination already exists');
    return destination;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href)
  console.info(`完整备份已保存：${await backup(loadConfig())}（含解密密钥，请妥善保管）`);

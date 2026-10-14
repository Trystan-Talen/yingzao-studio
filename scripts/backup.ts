import { cp, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, type AppConfig } from '../src/server/config';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
export async function backup(
  config: AppConfig,
  destination = resolve('var/backups', new Date().toISOString().replaceAll(':', '-')),
) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const database = join(destination, 'database.sqlite');
  try {
    await stat(database);
    throw new Error('Backup destination already exists');
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
  }
  const db = createDatabaseContext(config.databasePath);
  try {
    await db.sqlite.backup(database);
  } finally {
    closeDatabase(db);
  }
  // Assets are immutable and retained after soft deletion. Copying after the SQLite snapshot
  // therefore captures every referenced original, even while newer assets are being added.
  await cp(config.storageDir, join(destination, 'media'), { recursive: true, errorOnExist: true });
  await writeFile(
    join(destination, 'keys.json'),
    JSON.stringify({ sessionSecret: config.sessionSecret, encryptionKey: config.encryptionKey }),
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(
    join(destination, 'manifest.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        database: 'database.sqlite',
        media: 'media',
        keys: 'keys.json',
        demoMode: config.demoMode,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: 'wx' },
  );
  return destination;
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href)
  console.info(`完整备份已保存：${await backup(loadConfig())}（含解密密钥，请妥善保管）`);

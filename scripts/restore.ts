import { cp, mkdir, readFile, access, rm, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
export async function restore(source: string, destination: string) {
  try {
    await access(destination);
    throw new Error('恢复目标已存在；为保护现有数据，必须使用新的空目录');
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
  }
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')) as {
    formatVersion: number;
  };
  if (manifest.formatVersion !== 1) throw new Error('不支持的备份格式');
  const stage = `${destination}.staging-${randomUUID()}`;
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(stage, { mode: 0o700 });
  try {
    await cp(join(source, 'database.sqlite'), join(stage, 'database.sqlite'));
    await cp(join(source, 'media'), join(stage, 'media'), { recursive: true });
    await cp(join(source, 'keys.json'), join(stage, 'keys.json'));
    const db = createDatabaseContext(join(stage, 'database.sqlite'));
    try {
      const integrity = db.sqlite.pragma('integrity_check') as { integrity_check: string }[];
      if (integrity.some((r) => r.integrity_check !== 'ok'))
        throw new Error('备份数据库完整性检查未通过');
      if ((db.sqlite.pragma('foreign_key_check') as unknown[]).length)
        throw new Error('备份存在无效关联');
      const files = db.sqlite.prepare('SELECT storage_key FROM asset_variants').all() as {
        storage_key: string;
      }[];
      for (const file of files) {
        const path = resolve(stage, 'media', file.storage_key);
        if (!path.startsWith(`${resolve(stage, 'media')}/`)) throw new Error('备份素材路径无效');
        await access(path);
      }
    } finally {
      closeDatabase(db);
    }
    await rename(stage, destination);
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

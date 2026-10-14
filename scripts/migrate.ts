import { resolve } from 'node:path';
import { loadConfig } from '../src/server/config';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
const config = loadConfig();
const db = createDatabaseContext(config.databasePath);
try {
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  console.info(`数据库迁移完成：${config.databasePath}`);
} finally {
  closeDatabase(db);
}

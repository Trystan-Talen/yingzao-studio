import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export interface DatabaseContext {
  sqlite: Database.Database;
  orm: BetterSQLite3Database;
}
export function createDatabaseContext(databasePath: string): DatabaseContext {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath, { timeout: 10000 });
  sqlite.pragma('busy_timeout = 10000');
  try {
    // SQLite can bypass busy_timeout when two new connections switch journal mode.
    // This bounded startup-only retry releases each failed attempt before trying again.
    const deadline = Date.now() + 10000;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      try {
        sqlite.pragma('journal_mode = WAL');
        break;
      } catch (error) {
        if (
          !(error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY') ||
          Date.now() >= deadline
        )
          throw error;
        Atomics.wait(pause, 0, 0, 25);
      }
    }
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('synchronous = FULL');
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return { sqlite, orm: drizzle(sqlite) };
}
export function closeDatabase(db: DatabaseContext): void {
  db.sqlite.close();
}

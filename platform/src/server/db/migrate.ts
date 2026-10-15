import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseContext } from './connection';
export function migrateDatabase(db: DatabaseContext, options: { migrationsDir: string }): void {
  db.sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  for (const name of readdirSync(options.migrationsDir)
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort()) {
    const sql = readFileSync(join(options.migrationsDir, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    db.sqlite
      .transaction(() => {
        // API and worker may boot together. Read under the same write lock as execution.
        const previous = db.sqlite
          .prepare('SELECT checksum FROM schema_migrations WHERE name=?')
          .get(name) as { checksum: string } | undefined;
        if (previous) {
          if (previous.checksum !== checksum)
            throw new Error(`Applied migration was modified: ${name}`);
          return;
        }
        db.sqlite.exec(sql);
        db.sqlite
          .prepare('INSERT INTO schema_migrations VALUES (?,?,?)')
          .run(name, checksum, new Date().toISOString());
      })
      .immediate();
  }
}

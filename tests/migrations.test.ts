import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
const run = promisify(execFile);
it('serializes simultaneous API/worker migrations on the same SQLite database', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-migration-race-'));
  const dbpath = join(folder, 'race.sqlite'),
    migrationpath = join(folder, 'migrations');
  try {
    await mkdir(migrationpath);
    await writeFile(
      join(migrationpath, '0001-race.sql'),
      'CREATE TABLE records(id INTEGER PRIMARY KEY); WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x<100000) INSERT INTO records SELECT x FROM seq;',
    );
    const code = `import {createDatabaseContext,closeDatabase} from './src/server/db/connection.ts';import {migrateDatabase} from './src/server/db/migrate.ts';const db=createDatabaseContext(${JSON.stringify(dbpath)});migrateDatabase(db,{migrationsDir:${JSON.stringify(migrationpath)}});closeDatabase(db);`;
    await Promise.all(
      Array.from({ length: 3 }, () =>
        run(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), '-e', code], {
          cwd: resolve('.'),
          timeout: 25000,
          maxBuffer: 1024 * 1024,
        }),
      ),
    );
    const db = createDatabaseContext(dbpath);
    try {
      expect(db.sqlite.prepare('SELECT COUNT(*) n FROM records').get()).toEqual({ n: 100000 });
      expect(db.sqlite.prepare('SELECT COUNT(*) n FROM schema_migrations').get()).toEqual({ n: 1 });
    } finally {
      closeDatabase(db);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}, 30000);

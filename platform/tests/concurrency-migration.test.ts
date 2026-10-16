import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';

it('preserves existing billing modes and payment holds while upgrading the configured concurrency boundary', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-concurrency-migration-'));
  const legacy = join(folder, 'legacy');
  await mkdir(legacy);
  for (const name of await readdir(resolve('migrations')))
    if (/^\d+.*\.sql$/.test(name) && Number(name.slice(0, 4)) < 30)
      await copyFile(resolve('migrations', name), join(legacy, name));
  const db = createDatabaseContext(join(folder, 'old.sqlite'));
  try {
    migrateDatabase(db, { migrationsDir: legacy });
    const time = new Date().toISOString();
    db.sqlite
      .prepare(
        'INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('user', 'concurrency@example.test', 'fixture', 'Capacity', time, time);
    for (const [id, mode, limit, hold] of [
      ['shared', 'shared', 2, 0],
      ['held', 'allocated', 10, 1],
    ] as const) {
      db.sqlite
        .prepare(
          "INSERT INTO workspaces(id,name,kind,created_by,created_at,updated_at) VALUES(?,?,'personal',?,?,?)",
        )
        .run(id, id, 'user', time, time);
      db.sqlite.prepare('INSERT INTO workspace_billing VALUES(?,?,?,?)').run(id, mode, limit, hold);
    }
    const before = db.sqlite.prepare('SELECT * FROM workspace_billing ORDER BY workspace_id').all();
    const previous = db.sqlite.prepare('SELECT * FROM schema_migrations ORDER BY name').all();
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    expect(
      db.sqlite.prepare('SELECT * FROM workspace_billing ORDER BY workspace_id').all(),
    ).toEqual(before);
    expect(
      db.sqlite.prepare('SELECT * FROM schema_migrations WHERE name<? ORDER BY name').all('0030'),
    ).toEqual(previous);
    expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
    db.sqlite
      .prepare('UPDATE workspace_billing SET concurrency_limit=100 WHERE workspace_id=?')
      .run('shared');
    expect(() =>
      db.sqlite
        .prepare('UPDATE workspace_billing SET concurrency_limit=101 WHERE workspace_id=?')
        .run('shared'),
    ).toThrow();
    expect(
      db.sqlite.prepare('SELECT * FROM workspace_billing WHERE workspace_id=?').get('held'),
    ).toEqual(before[0]);
  } finally {
    closeDatabase(db);
    await rm(folder, { recursive: true, force: true });
  }
});

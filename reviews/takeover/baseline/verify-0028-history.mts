/** Copies the isolated local database with SQLite backup; never migrates the source. */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import Database from '../../../platform/node_modules/better-sqlite3/lib/index.js';
import { createDatabaseContext, closeDatabase } from '../../../platform/src/server/db/connection';
import { migrateDatabase } from '../../../platform/src/server/db/migrate';
const root = resolve(import.meta.dirname, '../../..');
const source = join(root, 'platform/var/takeover/baseline-app/demo.sqlite');
const dir = await mkdtemp(join(tmpdir(), 'verify-0028-'));
let sourceDb: InstanceType<typeof Database> | undefined;
let db: ReturnType<typeof createDatabaseContext> | undefined;
try {
  sourceDb = new Database(source, { readonly: true });
  const sourceMigrations = sourceDb.prepare('SELECT name FROM schema_migrations ORDER BY name').all();
  await sourceDb.backup(join(dir, 'copy.sqlite'));
  sourceDb.close();
  sourceDb = undefined;
  const beforeDir = join(dir, 'through-0027');
  await mkdir(beforeDir);
  for (const name of await readdir(join(root, 'platform/migrations')))
    if (/^\d+.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 27)
      await copyFile(join(root, 'platform/migrations', name), join(beforeDir, name));
  db = createDatabaseContext(join(dir, 'copy.sqlite'));
  migrateDatabase(db, { migrationsDir: beforeDir });
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name").all() as { name: string }[];
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const columns = Object.fromEntries(tables.map(({ name }) => [name, (db!.sqlite.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string }[]).map((r) => r.name)]));
  const snapshot = () => Object.fromEntries(tables.map(({ name }) => {
    const names = columns[name]!;
    const rows = db!.sqlite.prepare(`SELECT ${names.map(quote).join(',')} FROM ${quote(name)} ORDER BY ${names.map((_, i) => i + 1).join(',')}`).all();
    return [name, { rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
  }));
  const before = snapshot();
  migrateDatabase(db, { migrationsDir: join(root, 'platform/migrations') });
  migrateDatabase(db, { migrationsDir: join(root, 'platform/migrations') });
  const after = snapshot();
  const differences = tables.filter(({ name }) => JSON.stringify(before[name]) !== JSON.stringify(after[name])).map((r) => r.name);
  const foreignKeys = db.sqlite.pragma('foreign_key_check');
  const report = {
    checkedAt: new Date().toISOString(), source, sourceWasReadOnly: true, sourceMigrations,
    targetMigration: db.sqlite.prepare("SELECT name,checksum FROM schema_migrations WHERE name LIKE '0028%'").get(),
    unchangedHistoricalTables: tables.length, differences, foreignKeys,
    historicalTables: after,
    newRows: Object.fromEntries(['promotion_claims', 'prepaid_membership_purchases', 'prepaid_refund_reservations', 'billing_environment_binding'].map((name) => [name, (db!.sqlite.prepare(`SELECT COUNT(*) n FROM ${name}`).get() as { n: number }).n])),
    planBackfill: db.sqlite.prepare('SELECT COUNT(*) total,SUM(prepaid_terms_json IS NOT NULL) fixedTerms,SUM(promotion_json IS NOT NULL) promotions FROM plans').get(),
  };
  await writeFile(join(root, 'reviews/takeover/baseline/0028-history-result.json'), JSON.stringify(report, null, 2) + '\n');
  if (differences.length || (foreignKeys as unknown[]).length) throw new Error('Migration changed historical data or violated a foreign key');
  console.log(JSON.stringify({ unchangedHistoricalTables: tables.length, differences, foreignKeys, targetMigration: report.targetMigration, newRows: report.newRows, planBackfill: report.planBackfill }));
} finally {
  sourceDb?.close();
  if (db) closeDatabase(db);
  await rm(dir, { recursive: true, force: true });
}

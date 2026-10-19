import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, stat, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const cwd = process.cwd();
const [sourceArg, workArg, reportArg] = process.argv.slice(2);
assert(sourceArg && workArg && reportArg, 'backup, new work directory and report are required');
const source = resolve(sourceArg), work = resolve(workArg), reportPath = resolve(reportArg);
assert(work.startsWith(resolve('var/takeover/final-validation') + '/'));
assert(!work.startsWith(source + '/') && source !== work);
const require = createRequire(join(cwd, 'package.json'));
const Database = require('better-sqlite3');
const { restore } = await import(pathToFileURL(join(cwd, 'scripts/restore.ts')));
const { backup } = await import(pathToFileURL(join(cwd, 'scripts/backup.ts')));
const { createDatabaseContext, closeDatabase } = await import(pathToFileURL(join(cwd, 'src/server/db/connection.ts')));
const { migrateDatabase } = await import(pathToFileURL(join(cwd, 'src/server/db/migrate.ts')));
const hash = (v) => createHash('sha256').update(v).digest('hex');
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
const json = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);
async function fileTree(folder) {
  const output = {};
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await visit(p);
      else if (entry.isFile()) output[relative(folder, p)] = hash(await readFile(p));
      else throw new Error('Unexpected nonregular backup file');
    }
  }
  await visit(folder);
  return output;
}
function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
}
function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${quote(table)})`).all().map((r) => r.name);
}
function digest(db, table, cols, where = '') {
  const rows = db.prepare(`SELECT ${cols.map(quote).join(',')} FROM ${quote(table)}${where}`).raw().all();
  return { rows: rows.length, sha256: hash(rows.map(json).sort().join('\n')) };
}
function snapshot(db) {
  return Object.fromEntries(tables(db).map((t) => {
    const cols = columns(db, t);
    return [t, { columns: cols, ...digest(db, t, cols) }];
  }));
}
function assertHealth(db) {
  assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
}
const beforeFiles = await fileTree(source);
const wal = await stat(join(source, 'database.sqlite-wal')).catch((e) => {
  if (e.code === 'ENOENT') return { size: 0 };
  throw e;
});
assert.equal(wal.size, 0, 'Source backup must have no uncheckpointed WAL; do not silently ignore committed data');
await mkdir(dirname(work), { recursive: true, mode: 0o700 });
await mkdir(work, { recursive: false, mode: 0o700 });
// SQLite may touch shared-memory files even on a read-only connection. Inspect
// an exact isolated copy, so the source backup is never opened by SQLite.
const sourceSnapshot = join(work, 'source-snapshot.sqlite');
await copyFile(join(source, 'database.sqlite'), sourceSnapshot);
assert.equal(hash(await readFile(sourceSnapshot)), beforeFiles['database.sqlite']);
const old = new Database(sourceSnapshot, { readonly: true, fileMustExist: true });
let before;
try {
  assertHealth(old);
  before = snapshot(old);
  for (const row of old.prepare('SELECT name,checksum FROM schema_migrations').all())
    assert.equal(hash(await readFile(join(cwd, 'migrations', row.name))), row.checksum, `Historical migration changed: ${row.name}`);
} finally { old.close(); }
const restored = await restore(source, join(work, 'restored'));
const db = createDatabaseContext(join(restored, 'database.sqlite'));
let upgraded;
const comparisons = [];
let apiAccounts = 0, migrationCount = 0, referencedMedia = 0;
try {
  assert.deepEqual(snapshot(db.sqlite), before, 'Restore must preserve all rows before upgrade');
  migrateDatabase(db, { migrationsDir: join(cwd, 'migrations') });
  assertHealth(db.sqlite);
  for (const [table, original] of Object.entries(before)) {
    if (table === 'schema_migrations') continue;
    const where = table === 'credit_accounts' && !original.columns.includes('billing_channel')
      ? " WHERE billing_channel='web'" : '';
    const actual = digest(db.sqlite, table, original.columns, where);
    assert.deepEqual(actual, { rows: original.rows, sha256: original.sha256 }, `Historical rows changed: ${table}`);
    comparisons.push({ table, originalColumns: original.columns.length, rows: actual.rows, sha256: actual.sha256, channelFilter: where ? 'web' : null });
  }
  const sourceAccounts = before.credit_accounts.rows;
  const api = db.sqlite.prepare("SELECT balance,reserved,payment_review_required FROM credit_accounts WHERE billing_channel='api'").all();
  assert.equal(api.length, sourceAccounts);
  assert(api.every((r) => r.balance === 0 && r.reserved === 0 && r.payment_review_required === 0));
  apiAccounts = api.length;
  const applied = db.sqlite.prepare('SELECT name,checksum FROM schema_migrations ORDER BY name').all();
  for (const row of applied) assert.equal(hash(await readFile(join(cwd, 'migrations', row.name))), row.checksum);
  migrationCount = applied.length;
  assert.equal(migrationCount, (await readdir(join(cwd, 'migrations'))).filter((x) => /^\d+.*\.sql$/.test(x)).length);
  for (const row of db.sqlite.prepare('SELECT storage_key FROM asset_variants').all()) {
    const file = resolve(restored, 'media', row.storage_key);
    assert(file.startsWith(resolve(restored, 'media') + '/'));
    await stat(file);
    referencedMedia++;
  }
  const once = snapshot(db.sqlite);
  migrateDatabase(db, { migrationsDir: join(cwd, 'migrations') });
  assert.deepEqual(snapshot(db.sqlite), once, 'Second migration pass must be idempotent');
  upgraded = snapshot(db.sqlite);
} finally { closeDatabase(db); }
const keys = JSON.parse(await readFile(join(restored, 'keys.json'), 'utf8'));
await backup({ databasePath: join(restored, 'database.sqlite'), storageDir: join(restored, 'media'), sessionSecret: keys.sessionSecret, encryptionKey: keys.encryptionKey, demoMode: true }, join(work, 'upgraded-backup'));
const roundtrip = await restore(join(work, 'upgraded-backup'), join(work, 'roundtrip'));
const roundDb = new Database(join(roundtrip, 'database.sqlite'), { readonly: true, fileMustExist: true });
try { assertHealth(roundDb); assert.deepEqual(snapshot(roundDb), upgraded); }
finally { roundDb.close(); }
await assert.rejects(restore(join(work, 'upgraded-backup'), roundtrip), /恢复目标已存在/);
const originalMedia = Object.fromEntries(Object.entries(beforeFiles).filter(([k]) => k.startsWith('media/')));
const restoredMedia = await fileTree(join(restored, 'media'));
const roundMedia = await fileTree(join(roundtrip, 'media'));
assert.deepEqual(Object.fromEntries(Object.entries(originalMedia).map(([k,v]) => [k.slice(6),v])), restoredMedia);
assert.deepEqual(restoredMedia, roundMedia);
assert.equal(hash(await readFile(join(source, 'keys.json'))), hash(await readFile(join(roundtrip, 'keys.json'))));
assert.deepEqual(await fileTree(source), beforeFiles, 'Source backup must remain unchanged');
const report = {
  startedFrom: relative(cwd, source), work: relative(cwd, work), finishedUtc: new Date().toISOString(),
  sourceBusinessTables: comparisons.length, migrationCount, upgradedTables: Object.keys(upgraded).length,
  historicalComparisons: comparisons, apiZeroAccountsCreated: apiAccounts,
  originalMediaFiles: Object.keys(originalMedia).length, referencedMedia,
  checks: { sourceIntegrity: true, restoredRowsEqualBeforeUpgrade: true, historicalBusinessRowsPreserved: true,
    migrationChecksums: true, secondMigrationIdempotent: true, upgradedIntegrity: true, foreignKeys: true,
    completeBackupRestoreRows: true, completeBackupRestoreMedia: true, keyBytesPreserved: true,
    existingDestinationRejected: true, sourceBackupUnchanged: true },
  secrets: 'No keys, user rows, session tokens or identity values included. Digests/counts only.',
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ report: relative(cwd, reportPath), historicalBusinessTables: comparisons.length, migrationCount, mediaFiles: Object.keys(originalMedia).length, referencedMedia, checksPassed: Object.keys(report.checks).length }));

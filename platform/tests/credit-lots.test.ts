/** Real SQLite accounting and simulated clocks; no payment or provider network call. */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createCreditService, type CreditService } from '../src/server/tasks/credits';
import { createBillingAdmin } from '../src/server/billing/admin';
import { createBillingStore, type OrderRow } from '../src/server/billing/store';
import { addUtcMonths, type CreditSource } from '../src/server/tasks/credit-lots';
import type { Actor } from '../src/contracts/core';
let folder: string,
  db: DatabaseContext,
  core: CoreServices,
  credits: CreditService,
  actor: Actor,
  wid: string;
const reason =
  'Operator has reviewed the original credit source and approved this validity adjustment.';
const at = (iso: string) => vi.setSystemTime(new Date(iso));
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2027-01-01T12:00:00.000Z');
  folder = await mkdtemp(join(tmpdir(), 'yingzao-lots-'));
  db = createDatabaseContext(join(folder, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  credits = createCreditService(db);
  core = createCoreServices(
    db,
    {
      storageDir: join(folder, 'media'),
      sessionSecret: 'test',
      publicOrigin: 'http://127.0.0.1:5174',
      isProduction: false,
      demoMode: false,
    },
    { onWorkspaceCreated: (w, u) => credits.initialize(w, u, 0) },
  );
  const r = await core.auth.register({
    email: 'owner@example.local',
    password: 'OwnerPassword2026!',
    displayName: 'Owner',
  });
  actor = { userId: r.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] };
  wid = r.workspace.id;
});
afterEach(async () => {
  vi.useRealTimers();
  closeDatabase(db);
  await rm(folder, { recursive: true, force: true });
});
function grant(
  amount: number,
  expiresAt: string | null = null,
  source: CreditSource = 'manual',
  archiveMonths = 0,
) {
  return credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: `grant:${randomUUID()}`,
    amount,
    source,
    expiresAt,
    archiveMonths,
    description: 'Test source credit grant',
  }).lotId!;
}
function task(amount: number) {
  const jobId = randomUUID(),
    itemId = randomUUID();
  credits.reserve(wid, actor.userId, amount, jobId, itemId);
  return { jobId, itemId, amount };
}
function finish(t: ReturnType<typeof task>, success: boolean) {
  credits.finish(wid, actor.userId, t.amount, t.jobId, t.itemId, success);
}
function reconcile() {
  const account = credits.account(wid),
    buckets = credits.buckets(wid);
  expect(account.reserved).toBe(buckets.reduce((s, b) => s + b.reserved, 0));
  expect(account.balance - account.reserved).toBe(buckets.reduce((s, b) => s + b.available, 0));
  const total = db.sqlite
    .prepare(
      "SELECT COALESCE(SUM(CASE WHEN kind IN ('grant','adjustment') THEN amount WHEN kind='settle' THEN -amount ELSE 0 END),0) total FROM credit_ledger WHERE workspace_id=?",
    )
    .get(wid) as { total: number };
  expect(account.balance).toBe(total.total);
}
function refundFixture(amount: number) {
  const t = task(amount),
    date = new Date().toISOString();
  finish(t, true);
  db.sqlite
    .prepare(
      "INSERT INTO jobs(id,workspace_id,user_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,settled_credits,created_at,updated_at) VALUES(?,?,?,'image.generate','fixture','','{}','fixture',?,'fixture','succeeded','complete',?,?,?,?)",
    )
    .run(t.jobId, wid, actor.userId, randomUUID(), amount, amount, date, date);
  db.sqlite
    .prepare(
      "INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,credits,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,0,'{}','succeeded',?,?,?,?)",
    )
    .run(t.itemId, t.jobId, wid, actor.userId, amount, date, date, date);
  const ticket = core.business.createTicket(actor, wid, {
    subject: 'Review settled item',
    category: 'appeal',
    message: 'Please review the quality of this completed task.',
    jobId: t.jobId,
  });
  return { t, ticket };
}
function approve(f: ReturnType<typeof refundFixture>, amount: number) {
  return createBillingAdmin(db).resolveAppeal({
    actorUserId: actor.userId,
    workspaceId: wid,
    ticketId: f.ticket.id,
    decision: 'approved',
    reason,
    evidenceReference: 'manual-case-123',
    items: [{ itemId: f.t.itemId, credits: amount }],
  });
}
describe('credit validity, source reservations and immutable ledger', () => {
  it('uses nearest expiry first and creation FIFO for equal expiry, then permanent funds', () => {
    const forever = grant(100),
      late = grant(50, '2027-03-01T00:00:00.000Z');
    at('2027-01-02T00:00:00.000Z');
    const first = grant(30, '2027-02-01T00:00:00.000Z');
    at('2027-01-03T00:00:00.000Z');
    const second = grant(40, '2027-02-01T00:00:00.000Z');
    const t = task(90),
      byId = Object.fromEntries(credits.buckets(wid).map((b) => [b.id, b]));
    expect([
      byId[first]!.reserved,
      byId[second]!.reserved,
      byId[late]!.reserved,
      byId[forever]!.reserved,
    ]).toEqual([30, 40, 20, 0]);
    finish(t, true);
    finish(t, true);
    expect(credits.account(wid)).toEqual({ balance: 130, reserved: 0 });
    reconcile();
  });
  it('keeps insertion FIFO when sources share the exact same creation and expiry timestamp', () => {
    const first = grant(10, '2027-02-01T00:00:00.000Z'),
      second = grant(10, '2027-02-01T00:00:00.000Z');
    const t = task(12);
    expect(credits.buckets(wid).find((b) => b.id === first)!.reserved).toBe(10);
    expect(credits.buckets(wid).find((b) => b.id === second)!.reserved).toBe(2);
    finish(t, true);
    reconcile();
  });
  it('expires unspent credits exactly at UTC boundary, independently of reads on preceding days', () => {
    const id = grant(100, '2027-01-02T00:00:00.000Z');
    at('2027-01-01T23:59:59.999Z');
    expect(credits.account(wid).balance).toBe(100);
    at('2027-01-02T00:00:00.000Z');
    expect(credits.account(wid).balance).toBe(0);
    expect(credits.buckets(wid).find((b) => b.id === id)).toMatchObject({
      status: 'expired',
      remaining: 0,
    });
    expect(() => task(1)).toThrow();
    expect(credits.account(wid).balance).toBe(0);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) n FROM credit_ledger WHERE event_key LIKE 'lot-expire:%'")
        .get(),
    ).toEqual({ n: 1 });
    reconcile();
  });
  it.each([true, false])(
    'preserves in-flight reserve across expiry and handles success=%s once',
    (success) => {
      const id = grant(100, '2027-01-02T00:00:00.000Z'),
        t = task(60);
      at('2027-01-02T00:00:00.000Z');
      expect(credits.account(wid)).toEqual({ balance: 60, reserved: 60 });
      finish(t, success);
      finish(t, success);
      expect(credits.account(wid)).toEqual({ balance: 0, reserved: 0 });
      expect(credits.buckets(wid).find((b) => b.id === id)).toMatchObject({
        remaining: 0,
        reserved: 0,
        status: 'expired',
      });
      expect(() => finish(t, !success)).toThrow();
      reconcile();
    },
  );
  it('archives cancellation by original source and restores only while within the calendar archive window', () => {
    const id = grant(100, '2027-01-31T18:00:00.000Z', 'subscription', 3),
      t = task(40);
    at('2027-01-31T18:00:00.000Z');
    expect(credits.account(wid)).toEqual({ balance: 40, reserved: 40 });
    finish(t, false);
    expect(credits.account(wid)).toEqual({ balance: 0, reserved: 0 });
    expect(credits.buckets(wid)[0]).toMatchObject({
      status: 'archived',
      archived: 100,
      archiveUntil: '2027-04-30T18:00:00.000Z',
    });
    reconcile();
    const admin = createBillingAdmin(db),
      input = {
        actorUserId: actor.userId,
        workspaceId: wid,
        lotId: id,
        eventKey: 'renewal-reviewed',
        expiresAt: '2027-06-30T18:00:00.000Z',
        reason,
      };
    expect(admin.restoreCredits(input).restored).toBe(100);
    expect(admin.restoreCredits(input).restored).toBe(100);
    expect(credits.account(wid).balance).toBe(100);
    expect(credits.buckets(wid)[0]!.archiveUntil).toBe('2027-09-30T18:00:00.000Z');
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) n FROM operator_audit WHERE action='credits.restore'")
        .get(),
    ).toEqual({ n: 1 });
    reconcile();
    at('2027-09-30T18:00:00.000Z');
    expect(credits.account(wid).balance).toBe(0);
    expect(() =>
      admin.restoreCredits({
        ...input,
        eventKey: 'too-late',
        expiresAt: '2028-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
  it('purges archives lazily across restart while preserving old in-flight commitments', () => {
    grant(100, '2027-01-02T00:00:00.000Z', 'subscription', 3);
    const t = task(60);
    at('2027-01-02T00:00:00.000Z');
    expect(credits.buckets(wid)[0]!.archived).toBe(40);
    closeDatabase(db);
    at('2027-04-02T00:00:00.000Z');
    db = createDatabaseContext(join(folder, 'test.sqlite'));
    credits = createCreditService(db);
    expect(credits.account(wid)).toEqual({ balance: 60, reserved: 60 });
    expect(credits.buckets(wid)[0]).toMatchObject({
      status: 'expired',
      remaining: 60,
      archived: 0,
    });
    finish(t, false);
    expect(credits.account(wid)).toEqual({ balance: 0, reserved: 0 });
    reconcile();
  });
  it.each(['active', 'archived', 'expired'] as const)(
    'refunds to the original %s source without inventing a fresh lifetime',
    (status) => {
      grant(100, '2027-02-01T00:00:00.000Z', 'subscription', 3);
      const f = refundFixture(60);
      if (status === 'archived') at('2027-02-02T00:00:00.000Z');
      if (status === 'expired') at('2027-05-01T00:00:00.000Z');
      expect(approve(f, 50).refundedCredits).toBe(50);
      expect(approve(f, 50).alreadyProcessed).toBe(true);
      const bucket = credits.buckets(wid)[0]!;
      expect(bucket.status).toBe(status);
      expect(bucket.available).toBe(status === 'active' ? 90 : 0);
      expect(bucket.archived).toBe(status === 'archived' ? 90 : 0);
      expect(() => approve(f, 51)).toThrow();
      reconcile();
    },
  );
  it('makes operator grants and extensions idempotent, denies unauthorized operators and tenant swaps', () => {
    const admin = createBillingAdmin(db),
      input = {
        actorUserId: actor.userId,
        userId: actor.userId,
        workspaceId: wid,
        eventKey: 'one-grant',
        amount: 100,
        expiresAt: '2027-02-01T00:00:00.000Z',
        reason,
      };
    const g = admin.grantCredits(input);
    expect(admin.grantCredits(input).lotId).toBe(g.lotId);
    expect(credits.account(wid).balance).toBe(100);
    expect(() => admin.grantCredits({ ...input, amount: 101 })).toThrow();
    expect(() => admin.grantCredits({ ...input, actorUserId: randomUUID() })).toThrow();
    const ext = {
      actorUserId: actor.userId,
      workspaceId: wid,
      lotId: g.lotId!,
      eventKey: 'one-extension',
      expiresAt: '2027-03-01T00:00:00.000Z',
      reason,
    };
    admin.extendCredits(ext);
    admin.extendCredits(ext);
    expect(() => admin.extendCredits({ ...ext, workspaceId: randomUUID() })).toThrow();
    expect(() =>
      admin.extendCredits({ ...ext, eventKey: 'shrink', expiresAt: '2027-02-15T00:00:00.000Z' }),
    ).toThrow();
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) n FROM operator_audit WHERE action LIKE 'credits.%'")
        .get(),
    ).toEqual({ n: 2 });
    reconcile();
  });
  it('records a successful no-charge release reason without settling provider credits', () => {
    grant(10);
    const t = task(10);
    credits.finish(
      wid,
      actor.userId,
      t.amount,
      t.jobId,
      t.itemId,
      false,
      '未检测到文字，任务保留原图并释放预留',
    );
    expect(
      db.sqlite
        .prepare('SELECT kind,description FROM credit_ledger WHERE event_key=?')
        .get(`final:${t.itemId}`),
    ).toEqual({ kind: 'release', description: '未检测到文字，任务保留原图并释放预留' });
    reconcile();
  });
  it('rolls back every partial lot allocation on insufficient funds and leaves valid sources usable', () => {
    grant(20, '2027-02-01T00:00:00.000Z');
    grant(30);
    expect(() => task(51)).toThrow();
    expect(credits.account(wid)).toEqual({ balance: 50, reserved: 0 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM credit_lot_allocations').get()).toEqual({
      n: 0,
    });
    const t = task(50);
    finish(t, false);
    expect(credits.account(wid).balance).toBe(50);
    reconcile();
  });
  it('serializes two competing real process reservations without overspending any source', async () => {
    vi.useRealTimers();
    grant(100);
    const runner = join(folder, 'compete.mts');
    await writeFile(
      runner,
      `import { createDatabaseContext, closeDatabase } from ${JSON.stringify(pathToFileURL(resolve('src/server/db/connection.ts')).href)};\nimport { createCreditService } from ${JSON.stringify(pathToFileURL(resolve('src/server/tasks/credits.ts')).href)};\nconst d=createDatabaseContext(process.argv[2]);try { createCreditService(d).reserve(process.argv[3],process.argv[4],70,process.argv[5],process.argv[6]);console.log('reserved'); } catch(e) { console.log(e.code); } finally { closeDatabase(d); }`,
    );
    const run = promisify(execFile),
      results = await Promise.all(
        [0, 1].map(() =>
          run(
            process.execPath,
            [
              '--import',
              'tsx',
              runner,
              join(folder, 'test.sqlite'),
              wid,
              actor.userId,
              randomUUID(),
              randomUUID(),
            ],
            { cwd: resolve('.') },
          ),
        ),
      );
    expect(results.map((r) => r.stdout.trim()).sort()).toEqual([
      'INSUFFICIENT_CREDITS',
      'reserved',
    ]);
    expect(credits.account(wid)).toEqual({ balance: 100, reserved: 70 });
    reconcile();
  }, 20000);
});
function orderFixture(kind: 'credits' | 'subscription', amount = 30): OrderRow {
  const planId = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,active) VALUES(?,?,?,?,?,?,?,?,1)',
    )
    .run(
      planId,
      'Isolated payment validity fixture',
      kind,
      1000,
      'USD',
      kind === 'subscription' ? 'month' : null,
      amount,
      '{}',
    );
  const order = core.business.createOrder(actor, wid, { planId });
  db.sqlite.prepare("UPDATE orders SET payment_environment='test' WHERE id=?").run(order.id);
  return db.sqlite.prepare('SELECT * FROM orders WHERE id=?').get(order.id) as OrderRow;
}
describe('verified payment validity rules', () => {
  it('extends active credit packs for a calendar year from each purchase without reviving expired packs', () => {
    const old = grant(50, '2027-01-02T00:00:00.000Z', 'pack'),
      gone = grant(40, '2027-01-01T00:00:00.000Z', 'pack');
    const store = createBillingStore(db, core, credits),
      o = orderFixture('credits');
    const apply = () =>
      db.sqlite
        .transaction(() =>
          store.grant(o, 'checkout:first', 30, { paidAt: '2027-01-01T12:00:00.000Z' }),
        )
        .immediate();
    apply();
    apply();
    expect(credits.account(wid).balance).toBe(80);
    let buckets = credits.buckets(wid);
    expect(buckets.find((b) => b.id === old)).toMatchObject({
      expiresAt: '2028-01-01T12:00:00.000Z',
      available: 50,
    });
    expect(buckets.find((b) => b.id === gone)).toMatchObject({ status: 'expired', remaining: 0 });
    at('2027-01-10T12:00:00.000Z');
    const second = orderFixture('credits');
    db.sqlite
      .transaction(() =>
        store.grant(second, 'checkout:second', 30, { paidAt: '2027-01-10T12:00:00.000Z' }),
      )
      .immediate();
    buckets = credits.buckets(wid);
    expect(
      buckets
        .filter((b) => b.status === 'active')
        .every((b) => b.expiresAt === '2028-01-10T12:00:00.000Z'),
    ).toBe(true);
    expect(credits.account(wid).balance).toBe(110);
    reconcile();
  });
  it('restores archived subscription sources only on verified fulfillment and keeps restored reservations intact', () => {
    const old = grant(100, '2027-01-02T00:00:00.000Z', 'subscription', 3),
      t = task(20);
    at('2027-01-03T00:00:00.000Z');
    expect(credits.account(wid)).toEqual({ balance: 20, reserved: 20 });
    const store = createBillingStore(db, core, credits),
      o = orderFixture('subscription');
    expect(() =>
      db.sqlite
        .transaction(() =>
          store.grant(o, 'invoice:no-period', 30, { paidAt: '2027-01-03T00:00:00.000Z' }),
        )
        .immediate(),
    ).toThrow();
    db.sqlite
      .transaction(() =>
        store.grant(o, 'invoice:verified', 30, {
          paidAt: '2027-01-03T00:00:00.000Z',
          expiresAt: '2027-02-03T00:00:00.000Z',
        }),
      )
      .immediate();
    expect(credits.buckets(wid).find((b) => b.id === old)).toMatchObject({
      status: 'active',
      remaining: 100,
      reserved: 20,
      archiveUntil: '2027-05-03T00:00:00.000Z',
    });
    expect(credits.account(wid)).toEqual({ balance: 130, reserved: 20 });
    finish(t, false);
    expect(credits.account(wid)).toEqual({ balance: 130, reserved: 0 });
    reconcile();
  });
  it('clamps leap-year and end-of-month validity using UTC calendar dates', () => {
    expect(addUtcMonths('2028-02-29T10:15:00.000Z', 12)).toBe('2029-02-28T10:15:00.000Z');
    expect(addUtcMonths('2027-11-30T10:15:00.000Z', 3)).toBe('2028-02-29T10:15:00.000Z');
  });
});
async function legacyDatabase(reserved = 30) {
  closeDatabase(db);
  const oldDir = join(folder, 'pre-lots');
  await mkdir(oldDir);
  for (const name of (await readdir(resolve('migrations'))).filter(
    (n) => /^\d+.*\.sql$/.test(n) && Number(n.slice(0, 4)) < 13,
  ))
    await copyFile(resolve('migrations', name), join(oldDir, name));
  db = createDatabaseContext(join(folder, 'legacy.sqlite'));
  migrateDatabase(db, { migrationsDir: oldDir });
  core = createCoreServices(db, {
    storageDir: join(folder, 'old-media'),
    sessionSecret: 'test',
    publicOrigin: 'http://127.0.0.1:5174',
    isProduction: false,
    demoMode: false,
  });
  const r = await core.auth.register({
    email: 'legacy@example.local',
    password: 'LegacyPassword2026!',
    displayName: 'Legacy',
  });
  actor = { userId: r.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] };
  wid = r.workspace.id;
  const date = new Date().toISOString(),
    jobId = randomUUID(),
    itemId = randomUUID();
  db.sqlite.prepare('INSERT INTO credit_accounts VALUES(?,?,?,?)').run(wid, 100, reserved, date);
  db.sqlite.prepare('INSERT INTO workspace_billing(workspace_id) VALUES(?)').run(wid);
  db.sqlite
    .prepare('INSERT INTO member_budgets(workspace_id,user_id,spent,reserved) VALUES(?,?,0,?)')
    .run(wid, actor.userId, reserved);
  db.sqlite
    .prepare(
      "INSERT INTO credit_ledger VALUES(?,?,?,NULL,NULL,?,'grant',100,100,0,'Historical grant',?)",
    )
    .run(randomUUID(), wid, actor.userId, `initial:${wid}`, date);
  db.sqlite
    .prepare(
      "INSERT INTO credit_ledger VALUES(?,?,?,?,?,?,'reserve',30,100,30,'Historical reservation',?)",
    )
    .run(randomUUID(), wid, actor.userId, jobId, itemId, `reserve:${itemId}`, date);
  return { jobId, itemId, amount: 30 };
}
describe('legacy balance upgrade', () => {
  it('migrates original balances and ongoing reservations without inventing source expiration', async () => {
    const t = await legacyDatabase();
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    credits = createCreditService(db);
    expect(credits.buckets(wid)).toEqual([
      expect.objectContaining({
        source: 'legacy',
        granted: 100,
        remaining: 100,
        reserved: 30,
        expiresAt: null,
      }),
    ]);
    at('2035-01-01T00:00:00.000Z');
    expect(credits.account(wid)).toEqual({ balance: 100, reserved: 30 });
    finish(t, true);
    expect(credits.account(wid)).toEqual({ balance: 70, reserved: 0 });
    reconcile();
  });
  it('rolls back migration when historical account reserves disagree with immutable events', async () => {
    await legacyDatabase(31);
    expect(() => migrateDatabase(db, { migrationsDir: resolve('migrations') })).toThrow();
    expect(
      db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='credit_lots'")
        .get(),
    ).toBeUndefined();
    expect(
      db.sqlite
        .prepare("SELECT name FROM schema_migrations WHERE name='0013-credit-lots.sql'")
        .get(),
    ).toBeUndefined();
    expect(db.sqlite.prepare('SELECT balance,reserved FROM credit_accounts').get()).toEqual({
      balance: 100,
      reserved: 31,
    });
  });
  it('labels pre-attribution settlement refunds as legacy-refund, instead of granting a fabricated expiry', () => {
    grant(100);
    const f = refundFixture(60);
    // A migrated historical completed item has no source allocations; only its final ledger survives.
    db.sqlite.prepare('DELETE FROM credit_lot_allocations WHERE item_id=?').run(f.t.itemId);
    approve(f, 50);
    expect(credits.buckets(wid).find((b) => b.source === 'legacy-refund')).toMatchObject({
      available: 50,
      expiresAt: null,
      sourceId: f.t.itemId,
    });
    expect(credits.account(wid)).toEqual({ balance: 90, reserved: 0 });
    reconcile();
  });
});

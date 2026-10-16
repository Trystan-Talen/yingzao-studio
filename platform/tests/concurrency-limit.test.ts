import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import { EntitlementLimitsSchema, PlanLimitsSchema } from '../src/contracts/entitlements';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import type { AppConfig } from '../src/server/config';
import { createCoreServices, type CoreServices } from '../src/server/core';
import {
  closeDatabase,
  createDatabaseContext,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCreditService } from '../src/server/tasks/credits';
import { createTaskServices, type TaskServices } from '../src/server/tasks/service';
import { createWorker } from '../src/worker/runner';

let temp: string, db: DatabaseContext, core: CoreServices, tasks: TaskServices;
let actor: Actor, wid: string;
const workers: ReturnType<typeof createWorker>[] = [];

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'yingzao-concurrency-'));
  db = createDatabaseContext(join(temp, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5173',
    databasePath: join(temp, 'test.sqlite'),
    storageDir: join(temp, 'media'),
    sessionSecret: 'test-session-secret',
    encryptionKey: 'test-encryption-key',
    isProduction: false,
    demoMode: false,
    environmentSecrets: { openai: 'fixture-NOT-A-REAL-API-KEY' },
  };
  const credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (w, u) => credits.initialize(w, u, 10000),
    onMemberBudgetChanged: (w, u, limit) => credits.budget(w, u, limit),
    onMemberRemoved: (w, u) => tasks.removeMember(w, u),
  });
  tasks = createTaskServices(db, core, config);
  const registered = await core.auth.register({
    email: 'concurrency@example.local',
    password: 'TaskPassword2026!',
    displayName: 'Concurrency',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
});

afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  closeDatabase(db);
  await rm(temp, { recursive: true, force: true });
});

function setLimit100() {
  db.sqlite
    .prepare(
      "UPDATE entitlement_defaults SET limits_json=json_set(limits_json,'$.concurrency',100) WHERE id='standard'",
    )
    .run();
  db.sqlite
    .prepare('UPDATE workspace_billing SET concurrency_limit=100 WHERE workspace_id=?')
    .run(wid);
  expect(core.entitlements.effective(wid).limits.concurrency).toBe(100);
}
function submit(overrides: Partial<JobInput> = {}) {
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'A product on a clean background',
    ...overrides,
  });
  const quote = tasks.quote(actor, wid, input);
  return { quote, job: tasks.submit(actor, wid, input, quote.id, randomUUID()) };
}
function worker() {
  // Claim only: no worker loop, provider execution or external request is started.
  const instance = createWorker(tasks);
  workers.push(instance);
  return instance;
}
function activeCount() {
  return (
    db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM job_items WHERE workspace_id=? AND status IN ('running','reconciliation_required')",
      )
      .get(wid) as { n: number }
  ).n;
}

describe('100-slot workspace concurrency boundary with real submission and claim', () => {
  it('claims slot 100 and blocks slot 101 while uncertain tasks retain their real credit reservations', async () => {
    setLimit100();
    let reserved = 0;
    for (let i = 0; i < 99; i++) {
      const { job, quote } = submit();
      reserved += quote.maxCredits;
      // An explicitly uncertain provider operation still occupies its slot and reserve.
      db.sqlite
        .prepare(
          "UPDATE job_items SET status='reconciliation_required',phase='uncertain' WHERE job_id=?",
        )
        .run(job.id);
    }
    expect(activeCount()).toBe(99);
    expect(tasks.balance(actor, wid).reserved).toBe(reserved);
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#cfaa79' },
    })
      .png()
      .toBuffer();
    const source = await core.assets.ingest(actor, wid, {
      buffer,
      name: 'source.png',
      mimeType: 'image/png',
    });
    const resize = {
      operation: 'local.resize',
      providerId: 'local',
      assetIds: [source.id],
      options: { width: 16, height: 16 },
    };
    const first = submit(jobInputSchema.parse(resize));
    const second = submit(jobInputSchema.parse(resize));
    reserved += first.quote.maxCredits + second.quote.maxCredits;
    const firstWorker = worker(),
      secondWorker = worker();
    const claimed = firstWorker.claim();
    expect(claimed?.job_id).toBe(first.job.id);
    expect(activeCount()).toBe(100);
    expect(secondWorker.claim()).toBeUndefined();
    expect(tasks.get(actor, wid, second.job.id).items[0]?.status).toBe('queued');
    expect(tasks.balance(actor, wid).reserved).toBe(reserved);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='reserve'").get(),
    ).toEqual({ n: 101 });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) n FROM credit_ledger WHERE event_key LIKE 'final:%'")
        .get(),
    ).toEqual({ n: 0 });
  });

  it('preserves the global provider limit of four even with 100 workspace slots', () => {
    setLimit100();
    for (let i = 0; i < 5; i++) submit();
    const first = worker(),
      second = worker();
    expect(first.claim()).toBeDefined();
    expect(second.claim()).toBeDefined();
    expect(first.claim()).toBeDefined();
    expect(second.claim()).toBeDefined();
    expect(first.claim()).toBeUndefined();
    expect(activeCount()).toBe(4);
    expect(tasks.balance(actor, wid).reserved).toBe(40);
  });

  it('accepts 100 but rejects 101 in baseline, plan and stored workspace limits', () => {
    const baseline = JSON.parse(
      (
        db.sqlite
          .prepare("SELECT limits_json FROM entitlement_defaults WHERE id='standard'")
          .get() as { limits_json: string }
      ).limits_json,
    );
    expect(EntitlementLimitsSchema.safeParse({ ...baseline, concurrency: 100 }).success).toBe(true);
    expect(EntitlementLimitsSchema.safeParse({ ...baseline, concurrency: 101 }).success).toBe(
      false,
    );
    expect(PlanLimitsSchema.safeParse({ concurrency: 100 }).success).toBe(true);
    expect(PlanLimitsSchema.safeParse({ concurrency: 101 }).success).toBe(false);
    setLimit100();
    expect(() =>
      db.sqlite
        .prepare('UPDATE workspace_billing SET concurrency_limit=101 WHERE workspace_id=?')
        .run(wid),
    ).toThrow();
  });
});

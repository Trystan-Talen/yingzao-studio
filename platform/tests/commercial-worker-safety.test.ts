/** Isolated provider fixtures; these tests never contact a model service. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema } from '../src/contracts/jobs';
import type { AppConfig } from '../src/server/config';
import { createCoreServices } from '../src/server/core';
import {
  closeDatabase,
  createDatabaseContext,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCreditService } from '../src/server/tasks/credits';
import { createTaskServices, type TaskServices } from '../src/server/tasks/service';
import type { ProviderAdapter } from '../src/server/tasks/types';
import { createWorker } from '../src/worker/runner';

let directory: string, db: DatabaseContext, tasks: TaskServices, actor: Actor, wid: string;
const workers: ReturnType<typeof createWorker>[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yingzao-worker-safety-'));
  db = createDatabaseContext(join(directory, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5173',
    databasePath: join(directory, 'test.sqlite'),
    storageDir: join(directory, 'media'),
    sessionSecret: 'local-worker-safety-fixture',
    encryptionKey: 'local-encryption-fixture',
    isProduction: false,
    demoMode: false,
    environmentSecrets: { openai: 'fixture-NOT-A-REAL-API-KEY' },
  };
  const credits = createCreditService(db);
  const core = createCoreServices(db, config, {
    onWorkspaceCreated: (workspaceId, userId) => credits.initialize(workspaceId, userId, 500),
  });
  tasks = createTaskServices(db, core, config);
  const registered = await core.auth.register({
    email: 'owner@example.local',
    password: 'LocalFixture2026!',
    displayName: 'Owner',
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
  await rm(directory, { recursive: true, force: true });
});

function pendingJob() {
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'Product fixture',
  });
  const quote = tasks.quote(actor, wid, input);
  return tasks.submit(actor, wid, input, quote.id, randomUUID());
}

function worker(execute: ProviderAdapter['execute']) {
  const value = createWorker(tasks, { openai: { id: 'openai', execute } });
  workers.push(value);
  return value;
}

it('cancels a claimed but unsubmitted item without calling the provider or retaining its reservation', async () => {
  const job = pendingJob();
  const execute = vi.fn<ProviderAdapter['execute']>(async () => ({
    state: 'submitted',
    remote: { id: 'local-fixture' },
  }));
  const runner = worker(execute);
  const claimed = runner.claim()!;
  expect(claimed.phase).toBe('claimed');
  tasks.cancel(actor, wid, job.id);
  await runner.runItem(claimed);
  expect(execute).not.toHaveBeenCalled();
  expect(tasks.get(actor, wid, job.id).status).toBe('cancelled');
  expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 0 });
  tasks.cancel(actor, wid, job.id);
  expect(
    db.sqlite
      .prepare(
        'SELECT kind,COUNT(*) AS count FROM credit_ledger WHERE job_id=? GROUP BY kind ORDER BY kind',
      )
      .all(job.id),
  ).toEqual([
    { kind: 'release', count: 1 },
    { kind: 'reserve', count: 1 },
  ]);
});

it('retains the reservation when cancellation arrives after provider submission has started', async () => {
  const job = pendingJob();
  let resolveSubmission!: (result: Awaited<ReturnType<ProviderAdapter['execute']>>) => void;
  const execute = vi.fn<ProviderAdapter['execute']>(
    () =>
      new Promise((resolve) => {
        resolveSubmission = resolve;
      }),
  );
  const runner = worker(execute);
  const running = runner.runItem(runner.claim()!);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(tasks.cancel(actor, wid, job.id).status).toBe('running');
  expect(tasks.balance(actor, wid).reserved).toBe(8);
  resolveSubmission({ state: 'submitted', remote: { id: 'local-fixture' } });
  await running;
  expect(tasks.get(actor, wid, job.id).status).toBe('running');
  expect(tasks.balance(actor, wid).reserved).toBe(8);
});

it('does not starve another workspace behind a full page of concurrency-blocked jobs', () => {
  tasks.credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'local-fairness-budget',
    amount: 2000,
    source: 'manual',
    description: 'Local scheduling fixture',
  });
  const runner = worker(async () => ({ state: 'submitted', remote: { id: 'local-fixture' } }));
  pendingJob();
  const held = runner.claim()!;
  db.sqlite
    .prepare(
      "UPDATE job_items SET status='reconciliation_required',lease_owner=NULL,lease_until=NULL WHERE id=?",
    )
    .run(held.id);
  db.sqlite
    .prepare('UPDATE workspace_billing SET concurrency_limit=1 WHERE workspace_id=?')
    .run(wid);
  for (let index = 0; index < 100; index++) pendingJob();
  db.sqlite
    .prepare('UPDATE job_items SET created_at=? WHERE workspace_id=?')
    .run('2020-01-01T00:00:00.000Z', wid);
  const availableWorkspace = tasks.core.auth.createWorkspace(
    actor.userId,
    'Available workspace',
    'personal',
  );
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'Runnable fixture',
  });
  const quote = tasks.quote(actor, availableWorkspace.id, input);
  const runnable = tasks.submit(actor, availableWorkspace.id, input, quote.id, randomUUID());
  expect(runner.claim()?.job_id).toBe(runnable.id);
  expect(tasks.get(actor, availableWorkspace.id, runnable.id).status).toBe('running');
  expect(tasks.balance(actor, wid).reserved).toBe(808);
});

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
import { ProviderError, type ProviderAdapter } from '../src/server/tasks/types';
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

function pendingJob(workspaceId = wid) {
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'Product fixture',
  });
  const quote = tasks.quote(actor, workspaceId, input);
  return tasks.submit(actor, workspaceId, input, quote.id, randomUUID());
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

it('keeps uncertain reservations without blocking or resubmitting later workspace work', async () => {
  const execute = vi.fn<ProviderAdapter['execute']>(async () => {
    throw new ProviderError('Submission result is unknown', true);
  });
  const runner = worker(execute);
  const uncertainIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const job = pendingJob();
    uncertainIds.push(job.id);
    await runner.runItem(runner.claim()!);
    expect(tasks.get(actor, wid, job.id).status).toBe('reconciliation_required');
  }
  const next = pendingJob();
  execute.mockImplementation(async () => ({
    state: 'failed',
    message: 'Definitive fixture rejection',
  }));
  const claimed = runner.claim();
  expect(claimed?.job_id).toBe(next.id);
  await runner.runItem(claimed!);
  await runner.tick();
  await runner.drain();
  expect(execute).toHaveBeenCalledTimes(3);
  expect(tasks.get(actor, wid, next.id).status).toBe('failed');
  expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 16 });
  for (const id of uncertainIds) {
    expect(tasks.get(actor, wid, id).status).toBe('reconciliation_required');
    expect(() => tasks.retryQuote(actor, wid, id)).toThrow();
    expect(
      db.sqlite
        .prepare('SELECT kind FROM credit_ledger WHERE job_id=? ORDER BY created_at')
        .all(id),
    ).toEqual([{ kind: 'reserve' }]);
  }
});

it('does not let four uncertain submissions consume the shared provider execution slots', async () => {
  const execute = vi.fn<ProviderAdapter['execute']>(async () => {
    throw new ProviderError('Submission result is unknown', true);
  });
  const runner = worker(execute);
  const uncertainJobs: Array<{ workspaceId: string; jobId: string }> = [];
  for (let index = 0; index < 4; index++) {
    const workspaceId = tasks.core.auth.createWorkspace(
      actor.userId,
      `Unknown ${index}`,
      'personal',
    ).id;
    const job = pendingJob(workspaceId);
    uncertainJobs.push({ workspaceId, jobId: job.id });
    await runner.runItem(runner.claim()!);
  }
  const next = pendingJob();
  execute.mockImplementation(async () => ({
    state: 'failed',
    message: 'Definitive fixture rejection',
  }));
  const claimed = runner.claim();
  expect(claimed?.job_id).toBe(next.id);
  await runner.runItem(claimed!);
  await runner.tick();
  await runner.drain();
  expect(execute).toHaveBeenCalledTimes(5);
  for (const { workspaceId, jobId } of uncertainJobs) {
    expect(tasks.get(actor, workspaceId, jobId).status).toBe('reconciliation_required');
    expect(tasks.balance(actor, workspaceId)).toMatchObject({ balance: 500, reserved: 8 });
  }
});

it('still limits simultaneous running work to four shared provider slots', () => {
  const runner = worker(async () => ({ state: 'failed', message: 'Unused fixture' }));
  for (let index = 0; index < 5; index++) {
    const workspaceId = tasks.core.auth.createWorkspace(
      actor.userId,
      `Running ${index}`,
      'personal',
    ).id;
    pendingJob(workspaceId);
  }
  for (let index = 0; index < 4; index++) expect(runner.claim()).toBeDefined();
  expect(runner.claim()).toBeUndefined();
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
  expect(runner.claim()).toBeDefined();
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

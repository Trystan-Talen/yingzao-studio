/** Provider overrides below are deterministic contract fixtures, never claims of live AI inference. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import { formatAssetMention } from '../src/contracts/mentions';
import { blankScene } from '../src/contracts/scene';
import type { AppConfig } from '../src/server/config';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createCreditService } from '../src/server/tasks/credits';
import { createTaskServices, type TaskServices } from '../src/server/tasks/service';
import { ProviderError, type ItemRow, type ProviderAdapter } from '../src/server/tasks/types';
import { createWorker } from '../src/worker/runner';
import { AppError } from '../src/server/errors';
let temp: string,
  db: DatabaseContext,
  core: CoreServices,
  tasks: TaskServices,
  config: AppConfig,
  actor: Actor,
  wid: string,
  png: Buffer;
const workers: ReturnType<typeof createWorker>[] = [];
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'yingzao-tasks-'));
  db = createDatabaseContext(join(temp, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5173',
    databasePath: join(temp, 'test.sqlite'),
    storageDir: join(temp, 'media'),
    sessionSecret: 'test-session-secret',
    encryptionKey: 'test-encryption-key',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {
      openai: 'fixture-NOT-A-REAL-API-KEY',
      fal: 'fixture-fal-NOT-A-REAL-API-KEY',
    },
  };
  const credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (w, u) => credits.initialize(w, u, 500),
    onMemberBudgetChanged: (w, u, limit) => credits.budget(w, u, limit),
    onMemberRemoved: (w, u) => tasks.removeMember(w, u),
  });
  tasks = createTaskServices(db, core, config);
  const registered = await core.auth.register({
    email: 'test@example.local',
    password: 'TaskPassword2026!',
    displayName: 'Task Tester',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#cfaa79' } })
    .png()
    .toBuffer();
});
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  closeDatabase(db);
  await rm(temp, { recursive: true, force: true });
});
function input(overrides: Partial<JobInput> = {}): JobInput {
  return jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'A product on a clean background',
    ...overrides,
  });
}
function submit(i = input(), who = actor, workspaceId = wid) {
  const quote = tasks.quote(who, workspaceId, i);
  return { quote, job: tasks.submit(who, workspaceId, i, quote.id, randomUUID()) };
}
function worker(adapter: ProviderAdapter) {
  const w = createWorker(tasks, { [adapter.id]: adapter });
  workers.push(w);
  return w;
}
const complete = (): ProviderAdapter => ({
  id: 'openai',
  execute: async () => ({
    state: 'complete',
    outputs: [{ buffer: png, mimeType: 'image/png', name: 'fixture.png' }],
  }),
});
function expire(item: ItemRow, phase: string) {
  db.sqlite
    .prepare('UPDATE job_items SET phase=?,lease_until=? WHERE id=?')
    .run(phase, '2000-01-01T00:00:00.000Z', item.id);
}
describe('durable tasks, credits and worker integration', () => {
  it('refuses missing capability before reserving or creating a job', () => {
    tasks.settings.update(wid, { providerId: 'openai', enabled: false });
    expect(() => tasks.quote(actor, wid, input())).toThrow(AppError);
    expect(tasks.balance(actor, wid).reserved).toBe(0);
    expect(tasks.list(actor, wid).total).toBe(0);
  });
  it('binds quote to payload and idempotency key, reserving only once', () => {
    const i = input(),
      q = tasks.quote(actor, wid, i),
      key = randomUUID(),
      first = tasks.submit(actor, wid, i, q.id, key),
      again = tasks.submit(actor, wid, i, q.id, key);
    expect(again.id).toBe(first.id);
    expect(tasks.balance(actor, wid).reserved).toBe(8);
    expect(() => tasks.submit(actor, wid, { ...i, prompt: 'Changed' }, q.id, key)).toThrow(
      AppError,
    );
    expect(() => tasks.submit(actor, wid, i, q.id, randomUUID())).toThrow(AppError);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='reserve'").get(),
    ).toEqual({ n: 1 });
  });
  it('rolls back jobs and quotes if the available balance is insufficient', () => {
    const i = input({
        options: jobInputSchema.parse({
          operation: 'image.generate',
          providerId: 'openai',
          options: { count: 20 },
        }).options,
      }),
      q = tasks.quote(actor, wid, i);
    tasks.credits.debit({
      workspaceId: wid,
      userId: actor.userId,
      eventKey: 'fixture:consume-to-10',
      amount: tasks.credits.account(wid).balance - 10,
      description: 'Test fixture prior consumption',
    });
    expect(() => tasks.submit(actor, wid, i, q.id, randomUUID())).toThrow(AppError);
    expect(tasks.list(actor, wid).total).toBe(0);
    expect(tasks.balance(actor, wid).reserved).toBe(0);
    expect(db.sqlite.prepare('SELECT used_job_id FROM quotes WHERE id=?').get(q.id)).toEqual({
      used_job_id: null,
    });
  });
  it('settles a real stored output once, preserving original bytes and immutable ledger events', async () => {
    const { job } = submit();
    const w = worker(complete()),
      item = w.claim()!;
    await w.runItem(item);
    const done = tasks.get(actor, wid, job.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputAssets).toHaveLength(1);
    expect(
      (await core.assets.readOriginal(actor, wid, done.outputAssets[0]!.id)).buffer.equals(png),
    ).toBe(true);
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 492, reserved: 0, spent: 8 });
    tasks.transaction(() => tasks.credits.finish(wid, actor.userId, 8, job.id, item.id, true));
    expect(tasks.balance(actor, wid).balance).toBe(492);
    expect(
      db.sqlite
        .prepare('SELECT COUNT(*) n FROM credit_ledger WHERE event_key=?')
        .get(`final:${item.id}`),
    ).toEqual({ n: 1 });
  });
  it('releases definitive failure and preserves uncertain submissions for reconciliation', async () => {
    const failed = submit().job,
      w1 = worker({
        id: 'openai',
        execute: async () => ({ state: 'failed', message: 'Fixture rejection' }),
      });
    await w1.runItem(w1.claim()!);
    expect(tasks.get(actor, wid, failed.id).status).toBe('failed');
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 0 });
    const unknown = submit().job,
      w2 = worker({
        id: 'openai',
        execute: async () => {
          throw new ProviderError('Timed out after transmission', true);
        },
      });
    await w2.runItem(w2.claim()!);
    expect(tasks.get(actor, wid, unknown.id).status).toBe('reconciliation_required');
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 8 });
    expect(() => tasks.retryQuote(actor, wid, unknown.id)).toThrow(AppError);
  });
  it('handles partial success and retries only failed items', async () => {
    const i = input({ options: { ...input().options, count: 2 } }),
      { job } = submit(i);
    let call = 0;
    const w = worker({
      id: 'openai',
      execute: async () =>
        call++ === 0
          ? {
              state: 'complete',
              outputs: [{ buffer: png, name: 'success.png', mimeType: 'image/png' }],
            }
          : { state: 'failed', message: 'Fixture failure' },
    });
    await w.tick();
    await w.drain();
    expect(tasks.get(actor, wid, job.id)).toMatchObject({ status: 'partial', settledCredits: 8 });
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 492, reserved: 0 });
    const retry = tasks.retryQuote(actor, wid, job.id);
    expect(retry.units).toBe(1);
    expect(retry.maxCredits).toBe(8);
    const next = tasks.submit(actor, wid, i, retry.id, randomUUID());
    expect(next.items).toHaveLength(1);
    const success = worker(complete());
    await success.runItem(success.claim()!);
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 484, reserved: 0 });
  });
  it('cancels queued jobs with release but does not pretend a running request is cancelled', async () => {
    const queued = submit().job;
    expect(tasks.cancel(actor, wid, queued.id).status).toBe('cancelled');
    expect(tasks.balance(actor, wid).reserved).toBe(0);
    const running = submit().job,
      w = worker({
        id: 'openai',
        execute: async () => ({ state: 'submitted', remote: { id: 'remote-fixture' } }),
        poll: async () => ({ state: 'running', stage: 'Fixture pending' }),
      });
    const item = w.claim()!;
    await w.runItem(item);
    expect(tasks.cancel(actor, wid, running.id).status).toBe('running');
    expect(tasks.balance(actor, wid).reserved).toBe(8);
    expect(
      db.sqlite.prepare('SELECT cancel_requested FROM job_items WHERE id=?').get(item.id),
    ).toEqual({ cancel_requested: 1 });
  });
  it('recovers expired submitting conservatively and resumes polling without resubmitting', async () => {
    let executeCount = 0,
      pollCount = 0;
    const adapter: ProviderAdapter = {
      id: 'openai',
      execute: async () => {
        executeCount++;
        return { state: 'submitted', remote: { id: 'remote-1' } };
      },
      poll: async () => {
        pollCount++;
        return {
          state: 'complete',
          outputs: [{ buffer: png, name: 'polled.png', mimeType: 'image/png' }],
        };
      },
    };
    const first = submit().job,
      w = worker(adapter),
      claimed = w.claim()!;
    expire(claimed, 'submitting');
    w.recover();
    expect(tasks.get(actor, wid, first.id).status).toBe('reconciliation_required');
    expect(w.claim()).toBeUndefined();
    const second = submit().job,
      item = w.claim()!;
    await w.runItem(item);
    db.sqlite
      .prepare('UPDATE job_items SET next_attempt_at=? WHERE id=?')
      .run('2000-01-01T00:00:00.000Z', item.id);
    const resumed = worker(adapter),
      pollItem = resumed.claim()!;
    await resumed.runItem(pollItem);
    expect(tasks.get(actor, wid, second.id).status).toBe('succeeded');
    expect(executeCount).toBe(1);
    expect(pollCount).toBe(1);
  });
  it('guards stale lease holders before remote side effects', async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      id: 'openai',
      execute: async () => {
        calls++;
        return { state: 'failed', message: 'fixture' };
      },
    };
    submit();
    const old = worker(adapter),
      stale = old.claim()!;
    expire(stale, 'claimed');
    const fresh = worker(adapter);
    fresh.recover();
    const current = fresh.claim()!;
    expect(current.fence).toBeGreaterThan(stale.fence);
    await old.runItem(stale);
    expect(calls).toBe(0);
    await fresh.runItem(current);
    expect(calls).toBe(1);
  });
  it('enforces workspace concurrency across worker instances', () => {
    submit(input({ options: { ...input().options, count: 3 } }));
    const w1 = worker(complete()),
      w2 = worker(complete());
    expect(w1.claim()).toBeDefined();
    expect(w2.claim()).toBeDefined();
    expect(w1.claim()).toBeUndefined();
  });
  it('keeps pending results separate when users edit the canvas while work is running', async () => {
    const project = core.projects.create(actor, wid, { name: 'Pending test' }),
      document = core.documents.get(actor, wid, project.documentId);
    const { job } = submit(
      input({ projectId: project.id, documentId: document.id, baseRevision: 1 }),
    );
    core.documents.save(actor, wid, document.id, {
      expectedRevision: 1,
      scene: blankScene(900, 700),
    });
    const w = worker(complete());
    await w.runItem(w.claim()!);
    expect(tasks.get(actor, wid, job.id).status).toBe('succeeded');
    const pending = tasks.pending(actor, wid, document.id)[0]!;
    expect(core.documents.get(actor, wid, document.id).scene.layers).toHaveLength(0);
    expect(() => tasks.apply(actor, wid, pending.id, 1, 'new-layer')).toThrow(AppError);
    expect(tasks.pending(actor, wid, document.id)).toHaveLength(1);
    const applied = tasks.apply(actor, wid, pending.id, 2, 'new-layer');
    expect(applied.revision).toBe(3);
    expect(applied.scene.canvas.width).toBe(900);
    expect(applied.scene.layers).toHaveLength(1);
    expect(tasks.pending(actor, wid, document.id)).toHaveLength(0);
    expect(() => tasks.apply(actor, wid, pending.id, 3, 'new-layer')).toThrow(AppError);
  });
  it('rejects foreign resources and applies API-key scope and budget limits', () => {
    const other = core.team.create(actor, { name: 'Other workspace' }),
      foreign = core.projects.create(actor, other.id, { name: 'Foreign' });
    expect(() => tasks.quote(actor, wid, input({ projectId: foreign.id }))).toThrow(AppError);
    const { job } = submit();
    expect(() => tasks.get(actor, other.id, job.id)).toThrow(AppError);
    const key = core.business.createKey(actor, wid, {
        name: 'Limited',
        scopes: ['jobs:read', 'jobs:write', 'credits:read'],
        creditLimit: 8,
      }),
      apiActor: Actor = {
        userId: actor.userId,
        authType: 'apiKey',
        apiKeyId: key.key.id,
        workspaceId: wid,
        scopes: key.key.scopes,
      };
    submit(input(), apiActor);
    expect(() => submit(input(), apiActor)).toThrow(AppError);
    expect(() => tasks.quote({ ...apiActor, scopes: ['jobs:read'] }, wid, input())).toThrow(
      AppError,
    );
  });
  it('cancels removed members queued jobs but lets already submitted results finish in the original space', async () => {
    const team = core.team.create(actor, { name: 'Team' }),
      invite = core.team.invite(actor, team.id, { email: 'member@example.local', role: 'member' }),
      registered = await core.auth.register({
        email: 'member@example.local',
        password: 'MemberPassword2026!',
        displayName: 'Member',
        inviteToken: new URL(invite.inviteUrl).hash.slice(7),
      }),
      memberActor: Actor = {
        userId: registered.user.id,
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      };
    const active = submit(input(), memberActor, team.id).job,
      queued = submit(input(), memberActor, team.id).job;
    const w = worker({
      id: 'openai',
      execute: async () => ({ state: 'submitted', remote: { id: 'remote-team' } }),
      poll: async () => ({
        state: 'complete',
        outputs: [{ buffer: png, name: 'team.png', mimeType: 'image/png' }],
      }),
    });
    const item = w.claim()!;
    await w.runItem(item);
    const membership = core.team
      .members(actor, team.id, {})
      .items.find((m) => m.user.id === memberActor.userId)!;
    core.team.removeMember(actor, team.id, membership.id);
    expect(tasks.get(actor, team.id, queued.id).status).toBe('cancelled');
    expect(() => tasks.get(memberActor, team.id, active.id)).toThrow(AppError);
    db.sqlite
      .prepare('UPDATE job_items SET next_attempt_at=? WHERE id=?')
      .run('2000-01-01T00:00:00.000Z', item.id);
    await w.runItem(w.claim()!);
    expect(tasks.get(actor, team.id, active.id).status).toBe('succeeded');
    expect(tasks.get(actor, team.id, active.id).outputAssets[0]?.workspaceId).toBe(team.id);
  });
});

describe('security and recovery regressions', () => {
  it('rejects mismatched finalization and never permits negative or duplicate allocation', () => {
    const { job } = submit();
    const item = job.items[0]!;
    expect(() => tasks.credits.finish(wid, actor.userId, 7, job.id, item.id, true)).toThrow(
      AppError,
    );
    expect(() => tasks.credits.reserve(wid, actor.userId, -1, job.id, randomUUID())).toThrow(
      AppError,
    );
    expect(tasks.balance(actor, wid).reserved).toBe(8);
    tasks.credits.finish(wid, actor.userId, 8, job.id, item.id, true);
    expect(() => tasks.credits.finish(wid, actor.userId, 8, job.id, item.id, false)).toThrow(
      AppError,
    );
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 492, reserved: 0 });
  });
  it('guards allocated pools and collects unused limits without discarding in-flight reservations', async () => {
    wid = core.team.create(actor, { name: 'Allocation team' }).id;
    const invite = core.team.invite(actor, wid, { email: 'budget@example.local', role: 'member' });
    const joined = await core.auth.register({
      email: 'budget@example.local',
      password: 'MemberPassword2026!',
      displayName: 'Budget member',
      inviteToken: new URL(invite.inviteUrl).hash.slice(7),
    });
    tasks.credits.setMode(wid, 'allocated', actor.userId);
    tasks.credits.budget(wid, actor.userId, 400);
    expect(() => tasks.credits.budget(wid, joined.user.id, 101)).toThrow(AppError);
    tasks.credits.budget(wid, joined.user.id, 100);
    submit();
    expect(() => tasks.credits.budget(wid, actor.userId, 7)).toThrow(AppError);
    tasks.credits.setMode(wid, 'shared', actor.userId);
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 8 });
    expect(
      db.sqlite
        .prepare(
          'SELECT credit_limit,reserved FROM member_budgets WHERE workspace_id=? AND user_id=?',
        )
        .get(wid, actor.userId),
    ).toEqual({ credit_limit: null, reserved: 8 });
    tasks.credits.setMode(wid, 'allocated', actor.userId);
    expect(() => submit()).toThrow(AppError);
  });
  it('cancels revoked keys before claim and immediately before transmission', async () => {
    let calls = 0;
    const w = worker({
      id: 'openai',
      execute: async () => {
        calls++;
        return { state: 'failed', message: 'fixture' };
      },
    });
    for (const beforeClaim of [true, false]) {
      const key = core.business.createKey(actor, wid, {
        name: 'revocable',
        scopes: ['jobs:read', 'jobs:write'],
        creditLimit: 20,
      });
      const api: Actor = {
        ...actor,
        authType: 'apiKey',
        apiKeyId: key.key.id,
        workspaceId: wid,
        scopes: key.key.scopes,
      };
      const { job } = submit(input(), api);
      const item = beforeClaim ? undefined : w.claim()!;
      core.business.revokeKey(actor, wid, key.key.id);
      if (item) await w.runItem(item);
      else expect(w.claim()).toBeUndefined();
      expect(tasks.get(actor, wid, job.id).status).toBe('cancelled');
    }
    expect(calls).toBe(0);
    expect(tasks.balance(actor, wid).reserved).toBe(0);
  });
  it('allows already submitted results to settle after key revocation', async () => {
    const key = core.business.createKey(actor, wid, {
      name: 'submitted',
      scopes: ['jobs:read', 'jobs:write'],
      creditLimit: 20,
    });
    const api: Actor = {
      ...actor,
      authType: 'apiKey',
      apiKeyId: key.key.id,
      workspaceId: wid,
      scopes: key.key.scopes,
    };
    const { job } = submit(input(), api);
    const w = worker({
      id: 'openai',
      execute: async () => ({ state: 'submitted', remote: { id: 'fixture-existing' } }),
      poll: async () => ({
        state: 'complete',
        outputs: [{ buffer: png, mimeType: 'image/png', name: 'existing.png' }],
      }),
    });
    await w.runItem(w.claim()!);
    core.business.revokeKey(actor, wid, key.key.id);
    db.sqlite
      .prepare('UPDATE job_items SET next_attempt_at=? WHERE job_id=?')
      .run('2000-01-01T00:00:00.000Z', job.id);
    await w.runItem(w.claim()!);
    expect(tasks.get(actor, wid, job.id).status).toBe('succeeded');
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 492, reserved: 0 });
  });
  it('does not count successful polling against transient recovery retry allowance', async () => {
    const { job } = submit();
    const w = worker({
      id: 'openai',
      execute: async () => ({ state: 'submitted', remote: { id: 'fixture-long-running' } }),
      poll: async () => {
        throw new ProviderError('Temporary query outage');
      },
    });
    await w.runItem(w.claim()!);
    db.sqlite
      .prepare('UPDATE job_items SET attempts=250,next_attempt_at=? WHERE job_id=?')
      .run('2000-01-01T00:00:00.000Z', job.id);
    await w.runItem(w.claim()!);
    expect(tasks.get(actor, wid, job.id).status).toBe('running');
    expect(
      db.sqlite.prepare('SELECT recovery_failures FROM job_items WHERE job_id=?').get(job.id),
    ).toEqual({ recovery_failures: 1 });
    expect(tasks.balance(actor, wid).reserved).toBe(8);
  });
  it('will not transmit a claim whose lease has expired even before another worker recovers it', async () => {
    let calls = 0;
    submit();
    const w = worker({
      id: 'openai',
      execute: async () => {
        calls++;
        return { state: 'failed', message: 'fixture' };
      },
    });
    const item = w.claim()!;
    expire(item, 'claimed');
    await w.runItem(item);
    expect(calls).toBe(0);
  });
});

describe('explicit layer output transactions and media-based estimates', () => {
  it('stores every layer once, charges once, and applies a complete pending group after revision checks', async () => {
    const source = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'source.png',
      mimeType: 'image/png',
    });
    const project = core.projects.create(actor, wid, { name: 'Layered project' });
    const doc = core.documents.get(actor, wid, project.documentId);
    const i = input({
      operation: 'image.layers',
      providerId: 'fal',
      assetIds: [source.id],
      projectId: project.id,
      documentId: doc.id,
      baseRevision: doc.revision,
      options: { ...input().options, count: 4 },
    });
    const { job, quote } = submit(i);
    expect(quote.units).toBe(1);
    expect(quote.maxCredits).toBe(12);
    expect(job.items).toHaveLength(1);
    const w = worker({
      id: 'fal',
      execute: async () => ({
        state: 'complete',
        outputKind: 'layers',
        outputs: [1, 2, 3, 4].map((n) => ({
          buffer: png,
          name: `layer-${n}.png`,
          mimeType: 'image/png',
        })),
      }),
    });
    const item = w.claim()!;
    await w.runItem(item);
    await w.runItem(item);
    const done = tasks.get(actor, wid, job.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputAssets).toHaveLength(4);
    expect(done.items[0]).toMatchObject({
      assetIds: done.outputAssets.map((a) => a.id),
      outputKind: 'layers',
    });
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 488, reserved: 0, spent: 12 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='settle'").get(),
    ).toEqual({ n: 1 });
    core.documents.save(actor, wid, doc.id, { expectedRevision: 1, scene: blankScene(700, 600) });
    const pending = tasks.pending(actor, wid, doc.id)[0]!;
    expect(pending.assetIds).toHaveLength(4);
    expect(pending.outputKind).toBe('layers');
    expect(() => tasks.apply(actor, wid, pending.id, 1, 'new-layer')).toThrow(AppError);
    const applied = tasks.apply(actor, wid, pending.id, 2, 'new-layer');
    expect(applied.scene.layers).toHaveLength(1);
    const group = applied.scene.layers[0]!;
    expect(group.type).toBe('group');
    if (group.type !== 'group') throw new Error('expected grouped layers');
    expect(group.children.map((c) => (c.type === 'image' ? c.assetId : null))).toEqual(
      pending.assetIds,
    );
    expect(
      group.children.every(
        (c) => c.x === 0 && c.y === 0 && c.width === group.width && c.height === group.height,
      ),
    ).toBe(true);
    expect(tasks.pending(actor, wid, doc.id)).toHaveLength(0);
  });
  it('never persists a partial layer set or settles when one layer is invalid', async () => {
    const source = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'source.png',
      mimeType: 'image/png',
    });
    const { job } = submit(
      input({ operation: 'image.layers', providerId: 'fal', assetIds: [source.id] }),
    );
    const w = worker({
      id: 'fal',
      execute: async () => ({
        state: 'complete',
        outputKind: 'layers',
        outputs: [
          { buffer: png, name: 'valid.png', mimeType: 'image/png' },
          { buffer: Buffer.from('not image'), name: 'invalid.png', mimeType: 'image/png' },
        ],
      }),
    });
    await w.runItem(w.claim()!);
    expect(tasks.get(actor, wid, job.id).outputAssets).toHaveLength(0);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM job_item_assets').get()).toEqual({ n: 0 });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) n FROM assets WHERE source_job_id=?').get(job.id),
    ).toEqual({ n: 0 });
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 12, spent: 0 });
  });
  it('does not widen multi-output permission to unrelated providers and operations', async () => {
    const { job } = submit();
    const w = worker({
      id: 'openai',
      execute: async () => ({
        state: 'complete',
        outputKind: 'layers',
        outputs: [1, 2].map((n) => ({
          buffer: png,
          name: `unassociated-${n}.png`,
          mimeType: 'image/png',
        })),
      }),
    });
    await w.runItem(w.claim()!);
    db.sqlite
      .prepare('UPDATE job_items SET recovery_failures=10,next_attempt_at=? WHERE job_id=?')
      .run('2000-01-01T00:00:00.000Z', job.id);
    await w.runItem(w.claim()!);
    expect(tasks.get(actor, wid, job.id)).toMatchObject({
      status: 'reconciliation_required',
      outputAssets: [],
    });
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 8, spent: 0 });
  });
  it('quotes source-video operations using actual duration and extension using newly requested seconds', async () => {
    const path = join(temp, 'fixture-video.mp4');
    await promisify(execFile)('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=720x720:r=24',
      '-t',
      '3.25',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      path,
    ]);
    const source = await core.assets.ingest(actor, wid, {
      buffer: await readFile(path),
      name: 'fixture.mp4',
      mimeType: 'video/mp4',
    });
    expect(source.durationMs).toBeGreaterThan(3000);
    for (const operation of [
      'video-replica',
      'video.edit',
      'video.upscale',
      'video.translate',
    ] as const) {
      const q = tasks.quote(
        actor,
        wid,
        input({
          providerId: 'fal',
          operation,
          assetIds: [source.id],
          options: { ...input().options, duration: 9, language: 'en' },
        }),
      );
      expect(q.units).toBe(4);
    }
    const extension = tasks.quote(
      actor,
      wid,
      input({
        providerId: 'fal',
        operation: 'video.extend',
        assetIds: [source.id],
        options: { ...input().options, duration: 9 },
      }),
    );
    expect(extension.units).toBe(9);
  });
});

describe('immutable provider references', () => {
  it('binds signed media to job snapshots and rejects unrelated images and signature tampering', async () => {
    const source = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'allowed.png',
      mimeType: 'image/png',
    });
    const other = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'unrelated.png',
      mimeType: 'image/png',
    });
    const { job } = submit(input({ assetIds: [source.id] }));
    const w = worker({
      id: 'openai',
      execute: async () => ({ state: 'submitted', remote: { id: 'signed-fixture' } }),
    });
    await w.runItem(w.claim()!);
    const url = new URL(tasks.signedAssetUrl(wid, actor.userId, job.id, source.id));
    const expires = url.searchParams.get('expires')!,
      signature = url.searchParams.get('signature')!;
    expect(tasks.verifyMedia(wid, actor.userId, job.id, source.id, expires, signature)).toBe(true);
    expect(tasks.verifyMedia(wid, actor.userId, randomUUID(), source.id, expires, signature)).toBe(
      false,
    );
    expect(tasks.verifyMedia(wid, actor.userId, job.id, source.id, expires, '中'.repeat(64))).toBe(
      false,
    );
    expect(
      (await tasks.readProviderMedia(wid, actor.userId, job.id, source.id)).buffer.equals(png),
    ).toBe(true);
    await expect(tasks.readProviderMedia(wid, actor.userId, job.id, other.id)).rejects.toThrow(
      AppError,
    );
  });
  it('freezes brand references and style at quote time', async () => {
    const first = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'first.png',
      mimeType: 'image/png',
    });
    const second = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'second.png',
      mimeType: 'image/png',
    });
    const brand = core.references.createBrand(actor, wid, {
      name: 'Brand',
      description: 'Original style',
      referenceAssetIds: [first.id],
    });
    const i = input({ brandId: brand.id }),
      quote = tasks.quote(actor, wid, i);
    core.references.updateBrand(actor, wid, brand.id, {
      description: 'Changed style',
      referenceAssetIds: [second.id],
    });
    const job = tasks.submit(actor, wid, i, quote.id, randomUUID());
    let captured: JobInput | undefined;
    const w = worker({
      id: 'openai',
      execute: async (context) => {
        captured = context.input;
        return { state: 'failed', message: 'fixture' };
      },
    });
    await w.runItem(w.claim()!);
    expect(captured?.referenceAssetIds).toEqual([first.id]);
    expect(captured?.prompt).toContain('Original style');
    expect(captured?.prompt).not.toContain('Changed style');
    expect(tasks.get(actor, wid, job.id).status).toBe('failed');
  });
  it('quotes and executes ordered design modules with their own aspect ratio and references', async () => {
    const asset = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'module.png',
      mimeType: 'image/png',
    });
    const i = input({
      options: jobInputSchema.parse({
        operation: 'image.generate',
        providerId: 'openai',
        options: {
          count: 2,
          designs: [
            {
              id: randomUUID(),
              name: '主视觉',
              kind: 'marketing',
              ratio: '1:1',
              prompt: 'square launch',
              assetIds: [asset.id],
            },
            {
              id: randomUUID(),
              name: '社交竖版',
              kind: 'marketing',
              ratio: '9:16',
              prompt: 'vertical launch',
              assetIds: [],
            },
          ],
        },
      }).options,
    });
    const { quote, job } = submit(i);
    expect(quote.units).toBe(4);
    const parts = (
      db.sqlite
        .prepare('SELECT input_json FROM job_items WHERE job_id=? ORDER BY item_index')
        .all(job.id) as { input_json: string }[]
    ).map((r) => JSON.parse(r.input_json));
    expect(parts.map((r) => r.options.ratio)).toEqual(['1:1', '1:1', '9:16', '9:16']);
    expect(parts[0].assetIds).toEqual([asset.id]);
    expect(parts[2].prompt).toContain('社交竖版');
    expect(parts[0].options.designs).toBeUndefined();
  });
  it('freezes extracted reference document facts and never passes a document as an image', async () => {
    const asset = await core.assets.ingest(actor, wid, {
      buffer: Buffer.from('材料：再生玻璃。容量：50ml。'),
      name: 'facts.txt',
      mimeType: 'text/plain',
    });
    await core.assets.processPendingExtractions(2);
    const i = input({ assetIds: [asset.id] });
    const quote = tasks.quote(actor, wid, i);
    db.sqlite
      .prepare('UPDATE assets SET extracted_text=? WHERE id=?')
      .run('changed after quote', asset.id);
    const job = tasks.submit(actor, wid, i, quote.id, randomUUID());
    const row = db.sqlite
      .prepare('SELECT input_json FROM job_items WHERE job_id=?')
      .get(job.id) as { input_json: string };
    const frozen = JSON.parse(row.input_json);
    expect(frozen.assetIds).toEqual([]);
    expect(frozen.referenceText).toContain('再生玻璃');
    expect(frozen.referenceText).not.toContain('changed');
  });
});

describe('conversation snapshots and stable asset references', () => {
  it('freezes authorized project history and resolves each asset mention per generated item', async () => {
    const asset = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: '实物图.png',
      mimeType: 'image/png',
    });
    const project = core.projects.create(actor, wid, { name: '连续创作', kind: 'image' });
    db.sqlite
      .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        wid,
        project.id,
        actor.userId,
        'user',
        '这是30ml植物精华；禁止添加虚构功效',
        null,
        '{}',
        new Date().toISOString(),
      );
    const i = input({
      projectId: project.id,
      prompt: `根据 ${formatAssetMention('客户端伪造名称', asset.id)} 完善主图`,
      assetIds: [asset.id],
    });
    const q = tasks.quote(actor, wid, i);
    db.sqlite
      .prepare("UPDATE messages SET content='报价后的新历史，不可改变报价快照' WHERE project_id=?")
      .run(project.id);
    const job = tasks.submit(actor, wid, i, q.id, randomUUID());
    const row = db.sqlite
      .prepare('SELECT input_json FROM job_items WHERE job_id=?')
      .get(job.id) as { input_json: string };
    const frozen = JSON.parse(row.input_json) as JobInput;
    expect(frozen.conversationContext).toContain('30ml');
    expect(frozen.conversationContext).not.toContain('报价后的');
    expect(frozen.prompt).toContain('实物图.png；输入序号 1');
    expect(frozen.prompt).not.toContain('客户端伪造名称');
    expect(() =>
      tasks.quote(actor, wid, input({ prompt: formatAssetMention('已移除', asset.id) })),
    ).toThrow('被 @ 引用的素材已移除');
    const separate = core.projects.create(actor, wid, { name: '独立项目', kind: 'image' });
    const independent = tasks.quote(actor, wid, input({ projectId: separate.id }));
    const other = db.sqlite
      .prepare('SELECT items_json FROM quotes WHERE id=?')
      .get(independent.id) as { items_json: string };
    expect(other.items_json).not.toContain('30ml');
  });
  it('cancels an unsubmitted character job after authorization is withdrawn without calling the provider', async () => {
    const asset = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: '已授权参考.png',
      mimeType: 'image/png',
    });
    const character = core.references.createCharacter(actor, wid, {
      name: '测试参考',
      referenceAssetIds: [asset.id],
    });
    core.identity.authorize(actor, wid, character.id, {
      statementVersion: 'reference-use-v1',
      subjectRelationship: 'self',
      acknowledged: true,
    });
    const { job } = submit(input({ characterId: character.id }));
    core.identity.withdraw(actor, wid, character.id, { reason: '测试撤回不再用于生成' });
    let executed = false;
    const w = worker({
      id: 'openai',
      execute: async () => {
        executed = true;
        return {
          state: 'complete',
          outputs: [{ buffer: png, mimeType: 'image/png', name: 'never.png' }],
        };
      },
    });
    await w.tick();
    await w.stop();
    expect(executed).toBe(false);
    expect(tasks.get(actor, wid, job.id).status).toBe('cancelled');
    expect(tasks.balance(actor, wid).reserved).toBe(0);
  });
});

it('signs the mask representation and converts transparent edit regions to the official Flyelep white-mask convention', async () => {
  config.publicOrigin = 'https://studio.example.com';
  config.environmentSecrets.flyelep = 'fixture-NOT-A-REAL-FLYELEP-KEY';
  const source = await core.assets.ingest(actor, wid, {
    buffer: png,
    name: 'source.png',
    mimeType: 'image/png',
  });
  const pixels = Buffer.alloc(64 * 64 * 4, 0);
  for (let y = 0; y < 64; y++) for (let x = 32; x < 64; x++) pixels[(y * 64 + x) * 4 + 3] = 255;
  const mask = await core.assets.ingest(actor, wid, {
    buffer: await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
      .png()
      .toBuffer(),
    name: 'mask.png',
    mimeType: 'image/png',
  });
  const { job } = submit(
    input({
      providerId: 'flyelep',
      operation: 'image-inpaint',
      assetIds: [source.id],
      maskAssetId: mask.id,
    }),
  );
  db.sqlite.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);
  const url = new URL(tasks.signedAssetUrl(wid, actor.userId, job.id, mask.id, 'mask-white'));
  expect(
    tasks.verifyMedia(
      wid,
      actor.userId,
      job.id,
      mask.id,
      url.searchParams.get('expires')!,
      url.searchParams.get('signature')!,
      'mask-white',
    ),
  ).toBe(true);
  expect(
    tasks.verifyMedia(
      wid,
      actor.userId,
      job.id,
      mask.id,
      url.searchParams.get('expires')!,
      url.searchParams.get('signature')!,
    ),
  ).toBe(false);
  const file = await tasks.readProviderMedia(wid, actor.userId, job.id, mask.id, 'mask-white'),
    { data, info } = await sharp(file.buffer).raw().toBuffer({ resolveWithObject: true });
  expect(data[0]).toBe(255);
  expect(data[40 * info.channels]).toBe(0);
  await expect(
    tasks.readProviderMedia(wid, actor.userId, job.id, source.id, 'mask-white'),
  ).rejects.toMatchObject({ code: 'ASSET_REFERENCE' });
});

it('releases no-text translation reservations once and reuses the original detection across languages and worker restarts', async () => {
  const asset = await core.assets.ingest(actor, wid, {
    buffer: png,
    mimeType: 'image/png',
    name: 'blank-product.png',
  });
  const translation = jobInputSchema.parse({
    operation: 'image-translate',
    providerId: 'openai',
    assetIds: [asset.id],
    options: { languages: ['en', 'fr'] },
  });
  const initial = tasks.balance(actor, wid);
  let checks = 0;
  const adapter: ProviderAdapter = {
    id: 'openai',
    execute: async (context) => {
      const hasText = await context.textPresence!(asset.id, 'contract-detector-v1', async () => {
        checks++;
        return false;
      });
      expect(hasText).toBe(false);
      return {
        state: 'complete',
        billingDisposition: 'no-visible-text',
        outputs: [
          {
            ...(await context.readAsset(asset.id)),
            text: '未检测到文字，保留原图，不扣平台额度。',
          },
        ],
      };
    },
  };
  const { job } = submit(translation);
  const w = worker(adapter);
  await w.tick();
  await w.drain();
  const done = tasks.get(actor, wid, job.id);
  expect(done.status).toBe('succeeded');
  expect(done.settledCredits).toBe(0);
  expect(done.requestedCredits).toBeGreaterThan(0);
  expect(checks).toBe(1);
  expect(tasks.balance(actor, wid)).toMatchObject({ balance: initial.balance, reserved: 0 });
  const releases = () =>
    (
      db.sqlite
        .prepare("SELECT COUNT(*) n FROM credit_ledger WHERE job_id=? AND kind='release'")
        .get(job.id) as { n: number }
    ).n;
  expect(releases()).toBe(2);
  for (const output of done.outputAssets)
    expect((await core.assets.readOriginal(actor, wid, output.id)).buffer).toEqual(png);
  await w.tick();
  await w.drain();
  expect(releases()).toBe(2);
  await w.stop();
  const next = submit(translation).job;
  const restarted = worker(adapter);
  await restarted.tick();
  await restarted.drain();
  expect(tasks.get(actor, wid, next.id).settledCredits).toBe(0);
  expect(checks).toBe(1);
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM translation_text_checks').get()).toEqual({
    n: 1,
  });
});

it('recovers a persisted no-text result without repeating detection or charging after worker loss', async () => {
  const asset = await core.assets.ingest(actor, wid, {
    buffer: png,
    mimeType: 'image/png',
    name: 'original.png',
  });
  const { job } = submit(
    jobInputSchema.parse({
      operation: 'image-translate',
      providerId: 'openai',
      assetIds: [asset.id],
      options: { languages: ['en'] },
    }),
  );
  const itemId = job.items[0]!.id;
  const path = join(temp, 'persisted-no-text.bin');
  await writeFile(path, png);
  db.sqlite
    .prepare(
      "UPDATE job_items SET status='running',phase='downloading',lease_owner='terminated-worker',lease_until='2000-01-01T00:00:00.000Z',result_json=? WHERE id=?",
    )
    .run(
      JSON.stringify({
        outputKind: 'single',
        billingDisposition: 'no-visible-text',
        outputs: [
          {
            path,
            mimeType: 'image/png',
            name: 'original.png',
            text: 'No visible text; original preserved.',
          },
        ],
      }),
      itemId,
    );
  let submitted = 0;
  const w = worker({
    id: 'openai',
    execute: async () => {
      submitted++;
      throw new Error('must not submit again');
    },
  });
  await w.tick();
  await w.drain();
  expect(submitted).toBe(0);
  expect(tasks.get(actor, wid, job.id)).toMatchObject({ status: 'succeeded', settledCredits: 0 });
  expect(tasks.balance(actor, wid).reserved).toBe(0);
  expect(
    db.sqlite
      .prepare('SELECT kind,description FROM credit_ledger WHERE event_key=?')
      .get(`final:${itemId}`),
  ).toEqual({ kind: 'release', description: '未检测到文字，任务保留原图并释放预留' });
});

/** Local recovery fixtures only: generation, downloads and network access are mocked. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/server/app';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema } from '../src/contracts/jobs';
import { createWorker } from '../src/worker/runner';
import { ProviderError, type ProviderAdapter } from '../src/server/tasks/types';
import { downloadPublicMedia } from '../src/server/providers/http';

vi.mock('../src/server/providers/http', async (original) => ({
  ...(await original<typeof import('../src/server/providers/http')>()),
  downloadPublicMedia: vi.fn(),
}));
const download = vi.mocked(downloadPublicMedia);
const forbiddenFetch = vi.fn(() => {
  throw new Error('External network forbidden');
});
let directory: string,
  instance: Awaited<ReturnType<typeof createApp>>,
  actor: Actor,
  wid: string,
  cookie: string,
  png: Buffer;
const workers: ReturnType<typeof createWorker>[] = [];
const outputUrl = 'https://cdn.example.com/result.png?signature=private-fixture';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', forbiddenFetch);
  directory = await mkdtemp(join(tmpdir(), 'yingzao-result-recovery-'));
  instance = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(directory, 'fixture.sqlite'),
      storageDir: join(directory, 'media'),
      sessionSecret: 'fixture-session',
      encryptionKey: 'fixture-encryption',
      isProduction: false,
      demoMode: true,
      environmentSecrets: { openai: 'fixture-provider-key' },
    },
    { serveWeb: false },
  );
  const registration = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'recovery@example.local',
      password: 'RecoveryFixture2026!',
      displayName: '恢复测试',
    },
  });
  expect(registration.statusCode).toBe(201);
  const data = registration.json().data;
  wid = data.workspace.id;
  cookie = String(registration.headers['set-cookie']).split(';')[0]!;
  actor = {
    userId: data.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  download.mockResolvedValue(png);
});
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  await instance.app.close();
  await rm(directory, { recursive: true, force: true });
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
function submit(overrides: Record<string, unknown> = {}) {
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: '白色杯子',
    ...overrides,
  });
  const quote = instance.services.quote(actor, wid, input);
  return instance.services.submit(actor, wid, input, quote.id, randomUUID());
}
function worker(adapter: ProviderAdapter) {
  const value = createWorker(instance.services, { [adapter.id]: adapter });
  workers.push(value);
  return value;
}
function due(id: string) {
  instance.services.db.sqlite
    .prepare('UPDATE job_items SET next_attempt_at=? WHERE job_id=?')
    .run('2000-01-01T00:00:00.000Z', id);
}
function get(id: string) {
  return instance.services.get(actor, wid, id);
}
function resume(
  id: string,
  headers = { cookie, origin: 'http://127.0.0.1:5174', 'x-workspace-id': wid },
) {
  return instance.app.inject({ method: 'POST', url: `/api/v1/jobs/${id}/resume-result`, headers });
}
function ledger(id: string) {
  return instance.services.db.sqlite
    .prepare('SELECT kind,COUNT(*) n FROM credit_ledger WHERE job_id=? GROUP BY kind ORDER BY kind')
    .all(id);
}

it('exposes interrupted download recovery and preserves the stage when the retry allowance is exhausted', async () => {
  const job = submit();
  const execute = vi.fn<ProviderAdapter['execute']>(async () => ({
    state: 'complete',
    outputs: [{ url: outputUrl, mimeType: 'image/png', name: 'fixture.png' }],
  }));
  const run = worker({ id: 'openai', execute });
  download.mockRejectedValue(new ProviderError('公共 DNS 解析失败。 private-fixture'));
  await run.runItem(run.claim()!);
  expect(get(job.id)).toMatchObject({
    status: 'running',
    stage: expect.stringContaining('保存结果暂时中断'),
    items: [
      {
        phase: 'downloading',
        recoveryAttempts: 1,
        nextRetryAt: expect.any(String),
        canResume: false,
      },
    ],
  });
  expect(get(job.id).errorMessage).toContain('公共域名解析失败');
  expect(JSON.stringify(get(job.id))).not.toContain('private-fixture');
  instance.services.db.sqlite
    .prepare('UPDATE job_items SET recovery_failures=10 WHERE job_id=?')
    .run(job.id);
  due(job.id);
  const claimed = run.claim()!;
  expect(get(job.id).stage).toContain('正在恢复保存结果');
  await run.runItem(claimed);
  expect(get(job.id)).toMatchObject({
    status: 'reconciliation_required',
    stage: expect.stringContaining('自动保存已暂停'),
    items: [{ phase: 'downloading', canResume: true, retryable: false }],
  });
  expect(execute).toHaveBeenCalledOnce();
  expect(ledger(job.id)).toEqual([{ kind: 'reserve', n: 1 }]);
});

it('resumes a legacy uncertain cached result through the authenticated endpoint without generation or another charge', async () => {
  const job = submit();
  const execute = vi.fn<ProviderAdapter['execute']>();
  const poll = vi.fn<NonNullable<ProviderAdapter['poll']>>();
  const run = worker({ id: 'openai', execute, poll });
  instance.services.db.sqlite
    .prepare(
      "UPDATE job_items SET status='reconciliation_required',phase='uncertain',result_json=?,remote_id='existing',remote_json=?,recovery_failures=10,error_message='old' WHERE job_id=?",
    )
    .run(
      JSON.stringify([{ url: outputUrl, mimeType: 'image/png', name: 'fixture.png' }]),
      JSON.stringify({ id: 'existing' }),
      job.id,
    );
  instance.services.refresh(job.id);
  expect(get(job.id).items[0]!.canResume).toBe(true);
  expect(get(job.id).items[0]!.phase).toBe('downloading');
  const first = await resume(job.id),
    duplicate = await resume(job.id);
  expect(first.statusCode, first.body).toBe(200);
  expect(duplicate.statusCode, duplicate.body).toBe(200);
  expect(first.json().data.items[0]).toMatchObject({ phase: 'downloading', recoveryAttempts: 0 });
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({
    n: 1,
  });
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
    n: 1,
  });
  await run.runItem(run.claim()!);
  expect(get(job.id)).toMatchObject({ status: 'succeeded', errorMessage: null });
  expect(get(job.id).outputAssets).toHaveLength(1);
  expect(execute).not.toHaveBeenCalled();
  expect(poll).not.toHaveBeenCalled();
  expect(download).toHaveBeenCalledOnce();
  expect(ledger(job.id)).toEqual([
    { kind: 'reserve', n: 1 },
    { kind: 'settle', n: 1 },
  ]);
  expect((await resume(job.id)).statusCode).toBe(200);
  expect(run.claim()).toBeUndefined();
});

it('resumes only the existing remote ID across a worker restart and clears stale recovery errors', async () => {
  const job = submit();
  const execute = vi.fn<ProviderAdapter['execute']>(async () => ({
    state: 'submitted',
    remote: { id: 'existing-task' },
  }));
  const first = worker({
    id: 'openai',
    execute,
    poll: async () => {
      throw new ProviderError('Untrusted detail https://private.invalid/?key=private');
    },
  });
  await first.runItem(first.claim()!);
  instance.services.db.sqlite
    .prepare('UPDATE job_items SET recovery_failures=10 WHERE job_id=?')
    .run(job.id);
  due(job.id);
  await first.runItem(first.claim()!);
  expect(get(job.id)).toMatchObject({
    status: 'reconciliation_required',
    items: [{ phase: 'polling', canResume: true }],
  });
  expect(get(job.id).errorMessage).not.toContain('https:');
  await first.stop();
  const poll = vi.fn<NonNullable<ProviderAdapter['poll']>>(async () => ({
    state: 'complete',
    outputs: [{ buffer: png, mimeType: 'image/png', name: 'ready.png' }],
  }));
  const restarted = worker({ id: 'openai', execute, poll });
  expect((await resume(job.id)).statusCode).toBe(200);
  await restarted.runItem(restarted.claim()!);
  expect(poll.mock.calls[0]![0]).toMatchObject({ id: 'existing-task' });
  expect(execute).toHaveBeenCalledOnce();
  expect(get(job.id)).toMatchObject({ status: 'succeeded', errorMessage: null });
  expect(ledger(job.id)).toEqual([
    { kind: 'reserve', n: 1 },
    { kind: 'settle', n: 1 },
  ]);
});

it('does not reset automatic recovery counters on a duplicate resume click', async () => {
  const job = submit();
  instance.services.db.sqlite
    .prepare(
      "UPDATE job_items SET status='running',phase='polling',remote_id='known',remote_json=?,recovery_failures=4 WHERE job_id=?",
    )
    .run(JSON.stringify({ id: 'known' }), job.id);
  const result = await resume(job.id);
  expect(result.statusCode).toBe(200);
  expect(result.json().data.items[0].recoveryAttempts).toBe(4);
});

it('recovers a retry item without mistaking itself for another submitted retry', async () => {
  const original = submit();
  const execute = vi
    .fn<ProviderAdapter['execute']>()
    .mockResolvedValueOnce({ state: 'failed', message: 'Fixture rejection' })
    .mockResolvedValueOnce({
      state: 'complete',
      outputs: [{ url: outputUrl, mimeType: 'image/png', name: 'ready.png' }],
    });
  const run = worker({ id: 'openai', execute });
  await run.runItem(run.claim()!);
  const quote = instance.services.retryQuote(actor, wid, original.id);
  const retried = instance.services.submit(actor, wid, original.input, quote.id, randomUUID());
  expect(() => instance.services.retryQuote(actor, wid, original.id)).toThrow();
  download.mockRejectedValue(new ProviderError('公共 DNS 解析失败。'));
  await run.runItem(run.claim()!);
  instance.services.db.sqlite
    .prepare('UPDATE job_items SET recovery_failures=10 WHERE job_id=?')
    .run(retried.id);
  due(retried.id);
  await run.runItem(run.claim()!);
  expect(get(retried.id).items[0]).toMatchObject({
    canResume: true,
    retryJobId: null,
    retryRootItemId: original.items[0]!.id,
  });
  expect(get(original.id).items[0]).toMatchObject({ retryable: false, retryJobId: retried.id });
  download.mockResolvedValue(png);
  expect((await resume(retried.id)).statusCode).toBe(200);
  await run.runItem(run.claim()!);
  expect(get(retried.id).status).toBe('succeeded');
  expect(execute).toHaveBeenCalledTimes(2);
  expect(ledger(original.id)).toEqual([
    { kind: 'release', n: 1 },
    { kind: 'reserve', n: 1 },
  ]);
  expect(ledger(retried.id)).toEqual([
    { kind: 'reserve', n: 1 },
    { kind: 'settle', n: 1 },
  ]);
});

it('keeps mixed failed and recoverable items idempotent without reviving or charging the failed item', async () => {
  const job = submit({ options: { count: 2 } });
  const execute = vi
    .fn<ProviderAdapter['execute']>()
    .mockResolvedValueOnce({ state: 'failed', message: 'Fixture rejection' })
    .mockResolvedValueOnce({
      state: 'complete',
      outputs: [{ url: outputUrl, mimeType: 'image/png', name: 'ready.png' }],
    });
  const run = worker({ id: 'openai', execute });
  download.mockRejectedValue(new ProviderError('公共 DNS 解析失败。'));
  await run.runItem(run.claim()!);
  await run.runItem(run.claim()!);
  instance.services.db.sqlite
    .prepare("UPDATE job_items SET recovery_failures=10 WHERE job_id=? AND status='running'")
    .run(job.id);
  due(job.id);
  await run.runItem(run.claim()!);
  expect(get(job.id).items.map((item) => item.status)).toEqual([
    'failed',
    'reconciliation_required',
  ]);
  expect((await resume(job.id)).statusCode).toBe(200);
  expect((await resume(job.id)).statusCode).toBe(200);
  expect(get(job.id).items.map((item) => item.status)).toEqual(['failed', 'running']);
  download.mockResolvedValue(png);
  await run.runItem(run.claim()!);
  expect(get(job.id)).toMatchObject({ status: 'partial' });
  expect((await resume(job.id)).statusCode).toBe(200);
  expect(get(job.id).items.map((item) => item.status)).toEqual(['failed', 'succeeded']);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(run.claim()).toBeUndefined();
  expect(ledger(job.id)).toEqual([
    { kind: 'release', n: 1 },
    { kind: 'reserve', n: 2 },
    { kind: 'settle', n: 1 },
  ]);
});

it.each(['failed', 'cancelled'])(
  'does not treat an entirely %s job as an existing recovery',
  async (status) => {
    const job = submit();
    if (status === 'cancelled') instance.services.cancel(actor, wid, job.id);
    else {
      const run = worker({
        id: 'openai',
        execute: async () => ({ state: 'failed', message: 'Fixture rejection' }),
      });
      await run.runItem(run.claim()!);
    }
    expect((await resume(job.id)).statusCode).toBe(409);
    expect(get(job.id).status).toBe(status);
    expect(ledger(job.id)).toEqual([
      { kind: 'release', n: 1 },
      { kind: 'reserve', n: 1 },
    ]);
  },
);

it.each(['text', 'local'] as const)(
  'restores a cached %s output without executing a provider',
  async (kind) => {
    const source =
      kind === 'local'
        ? await instance.services.core.assets.ingest(actor, wid, {
            buffer: png,
            name: 'source.png',
            mimeType: 'image/png',
          })
        : null;
    const job = submit(
      source
        ? {
            operation: 'local.resize',
            providerId: 'local',
            assetIds: [source.id],
            options: { width: 16 },
          }
        : { operation: 'text.assist' },
    );
    const path = join(directory, 'cached.png');
    if (source) await writeFile(path, png);
    const outputs = source
      ? [{ path, mimeType: 'image/png', name: 'restored.png' }]
      : [{ text: '已生成的文字结果', mimeType: 'text/plain', name: 'result.txt' }];
    instance.services.db.sqlite
      .prepare(
        "UPDATE job_items SET status='reconciliation_required',phase='uncertain',result_json=? WHERE job_id=?",
      )
      .run(JSON.stringify(outputs), job.id);
    instance.services.refresh(job.id);
    const execute = vi.fn<ProviderAdapter['execute']>();
    const run = worker({ id: source ? 'local' : 'openai', execute });
    expect((await resume(job.id)).statusCode).toBe(200);
    await run.runItem(run.claim()!);
    const restored = get(job.id);
    expect(restored.status).toBe('succeeded');
    if (source) expect(restored.outputAssets).toHaveLength(1);
    else expect(restored.items[0]!.resultText).toBe('已生成的文字结果');
    expect(execute).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect((await resume(job.id)).statusCode).toBe(200);
    expect(run.claim()).toBeUndefined();
  },
);

it('requires the job workspace even when the requester owns another valid workspace', async () => {
  const job = submit();
  instance.services.db.sqlite
    .prepare(
      "UPDATE job_items SET status='reconciliation_required',phase='uncertain',result_json=? WHERE job_id=?",
    )
    .run(JSON.stringify([{ url: outputUrl, mimeType: 'image/png', name: 'ready.png' }]), job.id);
  instance.services.refresh(job.id);
  const other = instance.services.core.auth.createWorkspace(
    actor.userId,
    'Other workspace',
    'team',
  );
  const result = await resume(job.id, {
    cookie,
    origin: 'http://127.0.0.1:5174',
    'x-workspace-id': other.id,
  });
  expect(result.statusCode).toBe(404);
  expect(result.json().error.code).toBe('JOB_NOT_FOUND');
  expect(get(job.id).items[0]).toMatchObject({
    status: 'reconciliation_required',
    canResume: true,
  });
  expect(ledger(job.id)).toEqual([{ kind: 'reserve', n: 1 }]);
});

it('preserves a known provider queue stage rather than claiming the model is generating', async () => {
  const job = submit();
  const run = worker({
    id: 'openai',
    execute: async () => ({ state: 'submitted', remote: { id: 'known' } }),
    poll: async () => ({ state: 'running', stage: '服务商排队中' }),
  });
  await run.runItem(run.claim()!);
  due(job.id);
  await run.runItem(run.claim()!);
  expect(get(job.id).stage).toBe('服务商排队中');
  due(job.id);
  const claimed = run.claim()!;
  expect(get(job.id).stage).toBe('服务商排队中');
  await run.runItem(claimed);
});

it('refuses unknown submissions, invalid caches and cross-workspace access without scheduling anything', async () => {
  const job = submit();
  instance.services.db.sqlite
    .prepare(
      "UPDATE job_items SET status='reconciliation_required',phase='uncertain',result_json='{}',remote_id='known',remote_json='{}' WHERE job_id=?",
    )
    .run(job.id);
  instance.services.refresh(job.id);
  expect(get(job.id).items[0]!.canResume).toBe(false);
  expect((await resume(job.id)).statusCode).toBe(409);
  expect(
    (
      await resume(job.id, {
        cookie,
        origin: 'http://127.0.0.1:5174',
        'x-workspace-id': randomUUID(),
      })
    ).statusCode,
  ).not.toBe(200);
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
    n: 1,
  });
  expect(ledger(job.id)).toEqual([{ kind: 'reserve', n: 1 }]);
});

it.each(['polling', 'downloading'])(
  'never falls back to generation when %s metadata is missing',
  async (phase) => {
    const job = submit();
    const execute = vi.fn<ProviderAdapter['execute']>();
    const run = worker({ id: 'openai', execute });
    instance.services.db.sqlite
      .prepare("UPDATE job_items SET status='running',phase=?,recovery_failures=10 WHERE job_id=?")
      .run(phase, job.id);
    await run.runItem(run.claim()!);
    expect(execute).not.toHaveBeenCalled();
    expect(get(job.id)).toMatchObject({
      status: 'reconciliation_required',
      items: [{ phase, canResume: false }],
    });
  },
);

it('pauses excessive remote processing while retaining a safe query target and never refunds uncertain consumption', async () => {
  const job = submit();
  const execute = vi.fn<ProviderAdapter['execute']>();
  const poll = vi.fn<NonNullable<ProviderAdapter['poll']>>(async () => ({
    state: 'running',
    stage: '生成中',
  }));
  const run = worker({ id: 'openai', execute, poll });
  instance.services.db.sqlite
    .prepare(
      "UPDATE job_items SET status='running',phase='polling',remote_id='known',remote_json=? WHERE job_id=?",
    )
    .run(
      JSON.stringify({ id: 'known', submittedAt: new Date(Date.now() - 31 * 60000).toISOString() }),
      job.id,
    );
  await run.runItem(run.claim()!);
  expect(get(job.id)).toMatchObject({
    status: 'reconciliation_required',
    errorMessage: expect.stringContaining('30分钟'),
    items: [{ phase: 'polling', canResume: true }],
  });
  expect(execute).not.toHaveBeenCalled();
  expect(poll).toHaveBeenCalledOnce();
  expect(ledger(job.id)).toEqual([{ kind: 'reserve', n: 1 }]);
});

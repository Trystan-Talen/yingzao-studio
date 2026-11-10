/** Isolated workflow tests. Every model call and remote download is mocked. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import JSZip from 'jszip';
import { createApp } from '../src/server/app';
import type { Actor } from '../src/contracts/core';
import { detailPagePlanSchema, type DetailPagePlan } from '../src/contracts/detail-page';
import type { JobDto, JobInput } from '../src/contracts/jobs';
import { createWorker } from '../src/worker/runner';
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderResult,
} from '../src/server/tasks/types';
import { createDetailPageServices } from '../src/server/tasks/detail-pages';
import { downloadPublicMedia } from '../src/server/providers/http';

vi.mock('../src/server/providers/http', async (original) => ({
  ...(await original<typeof import('../src/server/providers/http')>()),
  downloadPublicMedia: vi.fn(),
}));
const download = vi.mocked(downloadPublicMedia);
const forbiddenFetch = vi.fn(() => {
  throw new Error('External network forbidden');
});
let temp: string,
  instance: Awaited<ReturnType<typeof createApp>>,
  actor: Actor,
  wid: string,
  cookie: string,
  png: Buffer,
  referenceId: string;
const workers: ReturnType<typeof createWorker>[] = [];

function plan(count = 6): DetailPagePlan {
  return detailPagePlanSchema.parse({
    productName: '白色陶瓷杯',
    productFacts: ['白色陶瓷杯，单个圆形把手'],
    audience: '日常咖啡饮用者',
    visualStyle: '干净的暖白商品摄影与简洁排版',
    palette: ['暖白', '浅灰'],
    consistencyNotes: '始终保持参考商品的轮廓、色彩、材质与单个把手',
    unknowns: ['未提供容量，不写容量数字'],
    screens: Array.from({ length: count }, (_, index) => ({
      id: `screen_${index + 1}`,
      title: `第${index + 1}屏`,
      purpose: '介绍已确认商品特点',
      copy: ['日常一杯'],
      prompt: '以参考图同一白杯为主体，保留上方文案空间',
      ratio: '3:4',
    })),
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', forbiddenFetch);
  temp = await mkdtemp(join(tmpdir(), 'yingzao-detail-pages-'));
  instance = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(temp, 'fixture.sqlite'),
      storageDir: join(temp, 'media'),
      sessionSecret: 'fixture-session',
      encryptionKey: 'fixture-encryption',
      isProduction: false,
      demoMode: true,
      environmentSecrets: { openai: 'fixture-image-key', dify: 'fixture-dify-key' },
      imageGateway: {
        baseUrl: 'https://images.example.test/v1',
        model: 'doubao-seedream-5.0-lite',
      },
    },
    { serveWeb: false },
  );
  const registration = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'detail@example.local',
      password: 'DetailFixture2026!',
      displayName: '详情页隔离测试',
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
  png = await sharp({ create: { width: 24, height: 32, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  referenceId = (
    await instance.services.core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'product.png',
      mimeType: 'image/png',
    })
  ).id;
  download.mockResolvedValue(png);
});
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  await instance.app.close();
  await rm(temp, { recursive: true, force: true });
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
function request(method: 'GET' | 'POST', url: string, payload?: unknown, space = wid) {
  return instance.app.inject({
    method,
    url,
    payload: payload as object,
    headers: { cookie, origin: 'http://127.0.0.1:5174', 'x-workspace-id': space },
  });
}
async function quote(count = 6) {
  const result = await request('POST', '/api/v1/detail-pages/quote', {
    plan: plan(count),
    referenceAssetIds: [referenceId],
  });
  expect(result.statusCode, result.body).toBe(200);
  return result.json().data as {
    input: JobInput;
    quote: { id: string; units: number; maxCredits: number };
  };
}
async function submit(
  value: Awaited<ReturnType<typeof quote>>,
  clientRequestId = randomUUID(),
): Promise<JobDto> {
  const response = await request('POST', '/api/v1/jobs', {
    input: value.input,
    quoteId: value.quote.id,
    clientRequestId,
  });
  expect(response.statusCode, response.body).toBe(202);
  return response.json().data;
}
function worker(adapters: Partial<Record<'dify' | 'openai', ProviderAdapter>>) {
  const result = createWorker(instance.services, adapters);
  workers.push(result);
  return result;
}
const imageResult = () => ({
  state: 'complete' as const,
  outputs: [{ buffer: png, mimeType: 'image/png', name: 'screen.png' }],
});
function ledger(jobId: string) {
  return instance.services.db.sqlite
    .prepare('SELECT kind,COUNT(*) n FROM credit_ledger WHERE job_id=? GROUP BY kind ORDER BY kind')
    .all(jobId);
}

it('persists a six-screen Dify plan and waits for a separate image quote/confirmation', async () => {
  const result = await request('POST', '/api/v1/detail-pages/plan-quote', {
    brief: '白色陶瓷杯，做完整详情页',
  });
  expect(result.statusCode, result.body).toBe(200);
  const quoted = result.json().data;
  expect(quoted.input).toMatchObject({
    providerId: 'dify',
    assetIds: [],
    referenceAssetIds: [],
    options: { assistantMode: 'detail-page', detailPageScreenCount: 6, ratio: '3:4', count: 1 },
  });
  const job = await submit(quoted);
  const image = vi.fn<ProviderAdapter['execute']>();
  const run = worker({
    dify: {
      id: 'dify',
      execute: async () => ({
        state: 'complete',
        outputs: [
          {
            text: '六屏方案待确认',
            mimeType: 'text/plain',
            name: 'plan.txt',
            resultData: { type: 'detail-page-plan', version: 1, plan: plan() },
          },
        ],
      }),
    },
    openai: { id: 'openai', execute: image },
  });
  await run.runItem(run.claim()!);
  expect(instance.services.get(actor, wid, job.id)).toMatchObject({
    status: 'succeeded',
    items: [{ resultData: { type: 'detail-page-plan', plan: { screens: plan().screens } } }],
  });
  expect(image).not.toHaveBeenCalled();
  expect(run.claim()).toBeUndefined();
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
    n: 1,
  });
});

it('persists an accepted planning run before completion and fences a restarted worker against duplicate submission', async () => {
  const quoted = await request('POST', '/api/v1/detail-pages/plan-quote', { brief: '白杯详情页' });
  const job = await submit(quoted.json().data);
  let accepted!: () => void;
  const started = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  let finishOld!: (result: ProviderResult) => void;
  const interruptedStream = new Promise<ProviderResult>((resolve) => {
    finishOld = resolve;
  });
  const execute = vi.fn<ProviderAdapter['execute']>(async (context) => {
    await context.onRemoteAccepted!({
      id: 'existing-planning-run',
      difyMode: 'detail-page',
      detailPageScreenCount: 6,
      detailPageRatio: '3:4',
    });
    accepted();
    return interruptedStream;
  });
  const first = worker({ dify: { id: 'dify', execute } });
  const firstAttempt = first.runItem(first.claim()!);
  await started;
  const stored = instance.services.db.sqlite
    .prepare('SELECT phase,remote_id,remote_json,lease_owner FROM job_items WHERE job_id=?')
    .get(job.id) as { phase: string; remote_id: string; remote_json: string; lease_owner: string };
  expect(stored).toMatchObject({
    phase: 'polling',
    remote_id: 'existing-planning-run',
    lease_owner: first.owner,
  });
  expect(JSON.parse(stored.remote_json)).toMatchObject({
    submittedAt: expect.any(String),
    detailPageScreenCount: 6,
  });
  instance.services.db.sqlite
    .prepare("UPDATE job_items SET lease_until='2000-01-01T00:00:00.000Z' WHERE job_id=?")
    .run(job.id);
  const complete: ProviderResult = {
    state: 'complete',
    outputs: [
      {
        text: '已经完成的六屏方案',
        name: 'plan.txt',
        mimeType: 'text/plain',
        resultData: { type: 'detail-page-plan', version: 1, plan: plan() },
      },
    ],
  };
  const poll = vi.fn<NonNullable<ProviderAdapter['poll']>>(async () => complete);
  const restarted = worker({ dify: { id: 'dify', execute, poll } });
  restarted.recover();
  await restarted.runItem(restarted.claim()!);
  finishOld(complete);
  await firstAttempt;
  expect(execute).toHaveBeenCalledOnce();
  expect(poll).toHaveBeenCalledOnce();
  expect(poll.mock.calls[0]![0]).toMatchObject({ id: 'existing-planning-run' });
  expect(instance.services.get(actor, wid, job.id).status).toBe('succeeded');
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
    n: 1,
  });
  expect(
    ledger(job.id).filter((row: unknown) => (row as { kind: string }).kind === 'settle'),
  ).toEqual([{ kind: 'settle', n: 1 }]);
});

it('quotes all screens, submits idempotently and exports ordered originals plus a real long image', async () => {
  const quoted = await quote();
  expect(quoted.quote).toMatchObject({ units: 6, maxCredits: 48 });
  const requestId = randomUUID();
  const job = await submit(quoted, requestId);
  expect((await submit(quoted, requestId)).id).toBe(job.id);
  expect(job.items.map((item) => item.detailPageScreenId)).toEqual(
    plan().screens.map((screen) => screen.id),
  );
  const execute = vi.fn<ProviderAdapter['execute']>(async () => imageResult());
  const run = worker({ openai: { id: 'openai', execute } });
  for (let index = 0; index < 6; index++) await run.runItem(run.claim()!);
  expect(execute).toHaveBeenCalledTimes(6);
  for (const [context] of execute.mock.calls) {
    expect(context.input.referenceAssetIds).toEqual([referenceId]);
    expect(context.input.options.designs).toBeUndefined();
    expect(context.input.options).toMatchObject({ count: 1, ratio: '3:4', detailPagePlan: plan() });
  }
  const view = await request('GET', `/api/v1/detail-pages/${job.id}`);
  expect(view.json().data.complete).toBe(true);
  expect(
    view
      .json()
      .data.screens.every(
        (screen: { outputAssets: unknown[] }) => screen.outputAssets.length === 1,
      ),
  ).toBe(true);
  const exported = await request('POST', '/api/v1/jobs/download-zip', { jobIds: [job.id] });
  expect(exported.statusCode, exported.body.slice(0, 80)).toBe(200);
  const archive = await JSZip.loadAsync(exported.rawPayload);
  const manifest = JSON.parse(
    await archive.file(`${job.id}/detail-page-manifest.json`)!.async('string'),
  );
  expect(manifest.screens.map((screen: { screenId: string }) => screen.screenId)).toEqual(
    plan().screens.map((screen) => screen.id),
  );
  expect(
    Object.keys(archive.files).filter((name) => name.includes('/screens/') && !name.endsWith('/')),
  ).toHaveLength(6);
  const long = await archive.file(`${job.id}/detail-page-750w.jpg`)!.async('nodebuffer');
  expect(await sharp(long).metadata()).toMatchObject({ width: 750, height: 192, format: 'jpeg' });
  expect(ledger(job.id)).toEqual([
    { kind: 'reserve', n: 6 },
    { kind: 'settle', n: 6 },
  ]);
});

it('retries only a failed screen and aggregates its replacement into the original complete set', async () => {
  const quoted = await quote(3);
  const job = await submit(quoted);
  const execute = vi
    .fn<ProviderAdapter['execute']>()
    .mockResolvedValueOnce({ state: 'failed', message: 'Fixture rejected screen' })
    .mockImplementation(async () => imageResult());
  const run = worker({ openai: { id: 'openai', execute } });
  for (let index = 0; index < 3; index++) await run.runItem(run.claim()!);
  expect(
    (await request('POST', '/api/v1/jobs/download-zip', { jobIds: [job.id] })).statusCode,
  ).toBe(409);
  const retryQuote = instance.services.retryQuote(actor, wid, job.id);
  expect(retryQuote.units).toBe(1);
  const retry = instance.services.submit(actor, wid, quoted.input, retryQuote.id, randomUUID());
  expect(retry.items[0]!.detailPageScreenId).toBe('screen_1');
  await run.runItem(run.claim()!);
  const view = createDetailPageServices(instance.services).get(actor, wid, job.id);
  expect(view.complete).toBe(true);
  expect(view.screens.map((screen) => screen.jobId)).toEqual([retry.id, job.id, job.id]);
  expect(view.screens[0]!.outputAssets).toHaveLength(1);
  expect(createDetailPageServices(instance.services).get(actor, wid, retry.id).complete).toBe(true);
  expect(execute).toHaveBeenCalledTimes(4);
  expect(ledger(job.id)).toEqual([
    { kind: 'release', n: 1 },
    { kind: 'reserve', n: 3 },
    { kind: 'settle', n: 2 },
  ]);
  expect(ledger(retry.id)).toEqual([
    { kind: 'reserve', n: 1 },
    { kind: 'settle', n: 1 },
  ]);
  expect(
    (await request('POST', '/api/v1/jobs/download-zip', { jobIds: [job.id] })).statusCode,
  ).toBe(200);
});

it('recovers only the cached screen after a download failure without re-running any screen', async () => {
  const quoted = await quote(2);
  const job = await submit(quoted);
  const execute = vi
    .fn<ProviderAdapter['execute']>()
    .mockResolvedValueOnce({
      state: 'complete',
      outputs: [
        { url: 'https://cdn.example.test/screen.png', mimeType: 'image/png', name: 'screen.png' },
      ],
    })
    .mockImplementation(async () => imageResult());
  const run = worker({ openai: { id: 'openai', execute } });
  download.mockRejectedValue(new ProviderError('公共 DNS 解析失败。'));
  await run.runItem(run.claim()!);
  instance.services.db.sqlite
    .prepare(
      "UPDATE job_items SET recovery_failures=10,next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
    .run(job.items[0]!.id);
  await run.runItem(run.claim()!);
  await run.runItem(run.claim()!);
  expect(createDetailPageServices(instance.services).get(actor, wid, job.id).complete).toBe(false);
  expect((await request('POST', `/api/v1/jobs/${job.id}/resume-result`)).statusCode).toBe(200);
  download.mockResolvedValue(png);
  await run.runItem(run.claim()!);
  expect(createDetailPageServices(instance.services).get(actor, wid, job.id).complete).toBe(true);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(ledger(job.id)).toEqual([
    { kind: 'reserve', n: 2 },
    { kind: 'settle', n: 2 },
  ]);
});

it('rejects modified screen prompts through the generic quote endpoint without reserving budget', async () => {
  const quoted = await quote(2);
  const altered = structuredClone(quoted.input);
  altered.options.designs![0]!.prompt = '偷偷改成另一种商品';
  const response = await request('POST', '/api/v1/quotes', altered);
  expect(response.statusCode).toBe(400);
  expect(response.json().error.code).toBe('DETAIL_PAGE_INPUT_CHANGED');
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({
    n: 1,
  });
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
    n: 0,
  });
});

it.each([
  { price: '未经确认的9999元' },
  { sellingPoints: '未经确认的功效承诺' },
  { colors: ['red'] },
  { textReplacements: [{ originalText: '日常一杯', replaceText: '未经确认', rect: [0, 0, 1, 1] }] },
  { platform: '加入未确认的营销文案' },
  { language: 'en-US' },
])('rejects prompt-affecting options outside the confirmed plan: %j', async (options) => {
  const quoted = await quote(2);
  const altered = structuredClone(quoted.input);
  Object.assign(altered.options, options);
  const response = await request('POST', '/api/v1/quotes', altered);
  expect(response.statusCode).toBe(400);
  expect(response.json().error.code).toBe('DETAIL_PAGE_INPUT_CHANGED');
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({
    n: 1,
  });
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
    n: 0,
  });
});

it('rejects missing references and foreign workspace references before quoting', async () => {
  expect(
    (await request('POST', '/api/v1/detail-pages/quote', { plan: plan(2), referenceAssetIds: [] }))
      .statusCode,
  ).toBe(400);
  const other = instance.services.core.auth.createWorkspace(actor.userId, 'Other details', 'team');
  const response = await request(
    'POST',
    '/api/v1/detail-pages/quote',
    { plan: plan(2), referenceAssetIds: [referenceId] },
    other.id,
  );
  expect(response.statusCode).toBe(404);
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({
    n: 0,
  });
});

it('checks reference metadata before budget reservation and keeps detail results workspace-scoped', async () => {
  instance.services.db.sqlite.prepare('UPDATE assets SET width=14 WHERE id=?').run(referenceId);
  const rejected = await request('POST', '/api/v1/detail-pages/quote', {
    plan: plan(2),
    referenceAssetIds: [referenceId],
  });
  expect(rejected.statusCode).toBe(400);
  expect(rejected.json().error.code).toBe('DETAIL_PAGE_REFERENCE_LIMIT');
  instance.services.db.sqlite.prepare('UPDATE assets SET width=24 WHERE id=?').run(referenceId);
  const job = await submit(await quote(2));
  const other = instance.services.core.auth.createWorkspace(actor.userId, 'Other results', 'team');
  expect(
    (await request('GET', `/api/v1/detail-pages/${job.id}`, undefined, other.id)).statusCode,
  ).toBe(404);
  expect(
    (await request('POST', '/api/v1/jobs/download-zip', { jobIds: [job.id] }, other.id)).statusCode,
  ).toBe(404);
});

it('bounds screen count, unique IDs and prompt sizes without silently truncating confirmed copy', () => {
  expect(detailPagePlanSchema.safeParse({ ...plan(), screens: [plan().screens[0]] }).success).toBe(
    false,
  );
  expect(
    detailPagePlanSchema.safeParse({
      ...plan(),
      screens: Array.from({ length: 11 }, (_, index) => ({
        ...plan().screens[0],
        id: `screen_${index}`,
      })),
    }).success,
  ).toBe(false);
  expect(
    detailPagePlanSchema.safeParse({ ...plan(2), screens: [plan().screens[0], plan().screens[0]] })
      .success,
  ).toBe(false);
  const maximum = plan(10);
  for (const screen of maximum.screens) {
    screen.purpose = '用'.repeat(300);
    screen.prompt = '图'.repeat(1000);
    screen.copy = Array.from({ length: 4 }, () => '文'.repeat(150));
  }
  const result = createDetailPageServices(instance.services).quote(actor, wid, {
    plan: maximum,
    referenceAssetIds: [referenceId],
  });
  expect(result.quote.units).toBe(10);
  expect(result.input.options.designs![0]!.prompt).toContain('文'.repeat(150));
});

it('binds a documented 3K detail-page selection into every quoted screen and rejects unsupported resolution', async () => {
  const result = await request('POST', '/api/v1/detail-pages/quote', {
    plan: plan(2),
    referenceAssetIds: [referenceId],
    resolution: '3K',
  });
  expect(result.statusCode, result.body).toBe(200);
  const value = result.json().data as Awaited<ReturnType<typeof quote>>;
  expect(value.input.options.resolution).toBe('3K');
  const job = await submit(value);
  const observed: string[] = [];
  const worker = createWorker(instance.services, {
    openai: {
      id: 'openai',
      async execute(context) {
        observed.push(context.input.options.resolution);
        return {
          state: 'complete',
          outputs: [{ buffer: png, name: 'contract.png', mimeType: 'image/png' }],
        };
      },
    },
  });
  workers.push(worker);
  for (let i = 0; i < 2; i++) await worker.runItem(worker.claim()!);
  expect(observed).toEqual(['3K', '3K']);
  expect(instance.services.get(actor, wid, job.id).status).toBe('succeeded');
  const denied = await request('POST', '/api/v1/detail-pages/quote', {
    plan: plan(2),
    referenceAssetIds: [referenceId],
    resolution: '8K',
  });
  expect(denied.statusCode).toBe(400);
});

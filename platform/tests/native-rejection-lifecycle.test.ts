/** Real classification, native adapters, worker and credits; synthetic HTTPS transport only. */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: transport.lookup }));
vi.mock('node:https', () => ({ request: transport.request }));

import type { Actor } from '../src/contracts/core';
import { creativeIntentRequestSchema } from '../src/contracts/creative-intent';
import { jobInputSchema } from '../src/contracts/jobs';
import type { ExecutionAttemptEvent } from '../src/contracts/task-execution';
import { createApp } from '../src/server/app';
import { createCreativeBriefServices } from '../src/server/tasks/creative-briefs';
import { simulateCreativeIntent } from '../src/server/tasks/creative-intent-simulation';
import { createWorker } from '../src/worker/runner';

type WireCall = { url: URL; method: string; body: Record<string, unknown> };
type WireReply = { status: number; body: unknown };
let dir: string, wid: string, actor: Actor;
let app: Awaited<ReturnType<typeof createApp>>;
let worker: ReturnType<typeof createWorker>;
let answer: (call: WireCall) => WireReply;
let image: Buffer, frame: Buffer;
const calls: WireCall[] = [];
const taskPath = '/api/v3/contents/generations/tasks';
const refused: WireReply = {
  status: 503,
  body: {
    error: {
      type: 'shell_api_error',
      param: '',
      code: null,
      message:
        'Current group g1 has no available channels for model gpt-image-2 under billing mode [pay-as-you-go, pay-per-request] (request id: fixture-request)',
    },
  },
};

function connections(kind: 'image' | 'video', fallbackCount: number) {
  const protocol = kind === 'image' ? 'openai-images' : 'seedance-native';
  const model = kind === 'image' ? 'gpt-image-2' : 'doubao-seedance-2.0';
  const path = kind === 'image' ? '/v1' : taskPath;
  app.services.settings.connections.update(wid, {
    kind,
    protocol,
    model,
    baseUrl: `https://primary.example${path}`,
    modelsUrl: '',
    enabled: true,
    secret: `synthetic-${kind}-primary`,
    fallbackResources: Array.from({ length: fallbackCount }, (_, index) => ({
      id: `backup-${kind}-${index + 1}`,
      name: `备用 ${index + 1}`,
      protocol,
      model,
      baseUrl: `https://backup${index + 1}.example${path}`,
      modelsUrl: '',
      enabled: true,
      secret: `synthetic-${kind}-backup-${index + 1}`,
    })),
  });
}

beforeEach(async () => {
  calls.length = 0;
  transport.lookup.mockReset();
  transport.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  transport.request.mockReset();
  transport.request.mockImplementation(
    (url: URL, options: RequestOptions, receive: (res: IncomingMessage) => void) => {
      const req = new EventEmitter() as ClientRequest;
      req.end = vi.fn((raw?: string | Uint8Array | (() => void)) => {
        queueMicrotask(() => {
          const call: WireCall = {
            url,
            method: options.method || 'POST',
            body:
              typeof raw === 'string' && raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
          };
          calls.push(call);
          let reply: WireReply;
          if (url.pathname.endsWith('/chat/completions')) {
            const messages = call.body.messages as { content: string }[];
            const request = creativeIntentRequestSchema.parse(JSON.parse(messages[1]!.content));
            const plan = simulateCreativeIntent(request);
            if (request.context.mediaType === 'video')
              plan.generationPlan = {
                imagePrompt: '柔光下完整的白色陶瓷杯。',
                videoPrompt: '镜头缓慢环绕陶瓷杯，保持主体完整。',
              };
            reply = {
              status: 200,
              body: {
                choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }],
              },
            };
          } else reply = answer(call);
          const res = Readable.from([Buffer.from(JSON.stringify(reply.body))]) as IncomingMessage;
          res.statusCode = reply.status;
          res.headers = { 'content-type': 'application/json', 'x-request-id': 'fixture-request' };
          receive(res);
        });
        return req;
      });
      return req;
    },
  );
  image = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#abc' } })
    .png()
    .toBuffer();
  frame = await sharp(image).resize(1024, 1024).png().toBuffer();
  answer = () => refused;
  dir = await mkdtemp(join(tmpdir(), 'yingzao-rejection-lifecycle-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(dir, 'isolated.sqlite'),
      storageDir: join(dir, 'media'),
      sessionSecret: 'synthetic-session',
      encryptionKey: 'synthetic-encryption',
      demoMode: false,
      isProduction: false,
      environmentSecrets: {},
    },
    { serveWeb: false },
  );
  const registered = await app.services.core.auth.register({
    email: 'rejection@example.local',
    password: 'SyntheticPassword2026!',
    displayName: '拒绝链路测试',
  });
  wid = registered.workspace.id;
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  app.services.credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'synthetic-grant',
    amount: 100,
    source: 'manual',
    description: '隔离测试积分',
  });
  app.services.settings.connections.update(wid, {
    kind: 'text',
    protocol: 'openai-chat',
    model: 'fixture-text',
    baseUrl: 'https://text.example/v1',
    modelsUrl: '',
    secret: 'synthetic-text',
    enabled: true,
  });
  connections('image', 0);
  connections('video', 0);
  worker = createWorker(app.services);
});

afterEach(async () => {
  await worker?.stop();
  await app?.app.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function submit(kind: 'image' | 'video' = 'image', planningMode?: 'direct') {
  const prepared = await createCreativeBriefServices(app.services).prepare(actor, wid, {
    requestId: randomUUID(),
    input: jobInputSchema.parse({
      providerId: 'native',
      operation: `${kind}.generate`,
      planningMode,
      prompt: '柔光中的白色陶瓷杯商品展示。',
      options: {
        model: kind === 'image' ? 'gpt-image-2' : 'doubao-seedance-2.0',
        ratio: '1:1',
        resolution: kind === 'image' ? '2K' : '720p',
        duration: 5,
        needText: false,
      },
    }),
  });
  const before = app.services.credits.account(wid).balance;
  const quote = app.services.quote(actor, wid, prepared.input);
  const job = app.services.submit(actor, wid, prepared.input, quote.id, randomUUID());
  return { job, before, credits: quote.maxCredits };
}

async function tick(jobId: string) {
  app.services.db.sqlite
    .prepare('UPDATE job_items SET next_attempt_at=? WHERE job_id=?')
    .run('2000-01-01T00:00:00.000Z', jobId);
  await worker.tick();
  await worker.drain();
}

function generated() {
  return calls.filter((call) => !call.url.pathname.endsWith('/chat/completions'));
}

function ledger(jobId: string) {
  return app.services.db.sqlite
    .prepare('SELECT kind,amount FROM credit_ledger WHERE job_id=? ORDER BY rowid')
    .all(jobId);
}

function executionLogs(jobId: string) {
  return (
    app.services.db.sqlite
      .prepare('SELECT event_json FROM job_execution_logs WHERE job_id=? ORDER BY id')
      .all(jobId) as { event_json: string }[]
  ).map((row) => JSON.parse(row.event_json) as ExecutionAttemptEvent);
}

describe('definitive no-channel rejection through actual worker and credit lifecycle', () => {
  it('direct image needs no text service and releases an explicit no-channel rejection without backups', async () => {
    app.services.db.sqlite
      .prepare("DELETE FROM model_connections WHERE workspace_id=? AND kind='text'")
      .run(wid);
    const { job, before, credits } = await submit('image', 'direct');
    expect(calls).toHaveLength(0);
    await tick(job.id);
    expect(app.services.get(actor, wid, job.id)).toMatchObject({
      status: 'failed',
      settledCredits: 0,
      input: { planningMode: 'direct' },
    });
    expect(app.services.credits.account(wid)).toMatchObject({ balance: before, reserved: 0 });
    expect(ledger(job.id)).toEqual([
      { kind: 'reserve', amount: credits },
      { kind: 'release', amount: credits },
    ]);
    await tick(job.id);
    expect(calls.map((call) => call.url.pathname)).toEqual(['/v1/images/generations']);
    expect(ledger(job.id)).toHaveLength(2);
  });

  it('direct image falls back on explicit rejection and settles once with zero text requests', async () => {
    app.services.db.sqlite
      .prepare("DELETE FROM model_connections WHERE workspace_id=? AND kind='text'")
      .run(wid);
    connections('image', 1);
    answer = (call) =>
      call.url.hostname === 'primary.example'
        ? refused
        : { status: 200, body: { data: [{ b64_json: image.toString('base64') }] } };
    const { job, before, credits } = await submit('image', 'direct');
    expect(calls).toHaveLength(0);
    await tick(job.id);
    const done = app.services.get(actor, wid, job.id);
    expect(done).toMatchObject({
      status: 'succeeded',
      settledCredits: credits,
      input: { planningMode: 'direct' },
    });
    expect(done.outputAssets).toHaveLength(1);
    const original = await app.services.core.assets.readOriginalForJob(
      { workspaceId: wid, createdBy: actor.userId, projectId: null, jobId: job.id },
      done.outputAssets[0]!.id,
    );
    expect(original.buffer).toEqual(image);
    expect(calls.map((call) => call.url.hostname)).toEqual(['primary.example', 'backup1.example']);
    expect(calls.every((call) => call.url.pathname === '/v1/images/generations')).toBe(true);
    expect(calls[1]!.body.prompt).toBe(calls[0]!.body.prompt);
    expect(app.services.credits.account(wid)).toMatchObject({
      balance: before - credits,
      reserved: 0,
    });
    expect(ledger(job.id)).toEqual([
      { kind: 'reserve', amount: credits },
      { kind: 'settle', amount: credits },
    ]);
    await tick(job.id);
    expect(calls).toHaveLength(2);
    expect(ledger(job.id)).toHaveLength(2);
  });

  it.each([
    {
      name: 'generic 503',
      reply: { status: 503, body: { error: { message: 'Service unavailable' } } },
    },
    {
      name: 'no-channel text alongside an accepted task',
      reply: {
        status: 503,
        body: { ...(refused.body as Record<string, unknown>), task_id: 'already-accepted' },
      },
    },
    { name: 'an invalid successful response', reply: { status: 200, body: { data: [] } } },
  ])('keeps $name uncertain without fallback or releasing credits', async ({ reply }) => {
    connections('image', 2);
    answer = () => reply;
    const { job, before, credits } = await submit();
    await tick(job.id);
    expect(app.services.get(actor, wid, job.id)).toMatchObject({
      status: 'reconciliation_required',
      settledCredits: 0,
    });
    expect(app.services.credits.account(wid)).toMatchObject({ balance: before, reserved: credits });
    expect(ledger(job.id)).toEqual([{ kind: 'reserve', amount: credits }]);
    expect(generated()).toHaveLength(1);
    await tick(job.id);
    expect(generated()).toHaveLength(1);
  });

  it('ends an unexecuted image without backups and releases its reservation exactly once', async () => {
    const { job, before, credits } = await submit();
    await tick(job.id);
    expect(app.services.get(actor, wid, job.id)).toMatchObject({
      status: 'failed',
      settledCredits: 0,
    });
    expect(app.services.credits.account(wid)).toMatchObject({ balance: before, reserved: 0 });
    expect(ledger(job.id)).toEqual([
      { kind: 'reserve', amount: credits },
      { kind: 'release', amount: credits },
    ]);
    expect(executionLogs(job.id)).toContainEqual(
      expect.objectContaining({
        status: 'rejected',
        httpStatus: 503,
        errorCode: 'PROVIDER_NOT_EXECUTED',
        resource: expect.objectContaining({ id: 'image' }),
      }),
    );
    await tick(job.id);
    expect(generated()).toHaveLength(1);
    expect(ledger(job.id)).toHaveLength(2);
  });

  it('uses the backup after no-channel rejection and saves one image with one settlement', async () => {
    connections('image', 1);
    answer = (call) =>
      call.url.hostname === 'primary.example'
        ? refused
        : {
            status: 200,
            body: { data: [{ b64_json: image.toString('base64') }] },
          };
    const { job, before, credits } = await submit();
    await tick(job.id);
    const done = app.services.get(actor, wid, job.id);
    expect(done).toMatchObject({ status: 'succeeded', settledCredits: credits });
    expect(done.outputAssets).toHaveLength(1);
    expect(done.outputAssets[0]).toMatchObject({ width: 2048, height: 2048, kind: 'image' });
    const stored = app.services.db.sqlite
      .prepare("SELECT storage_key FROM asset_variants WHERE asset_id=? AND variant='original'")
      .get(done.outputAssets[0]!.id) as { storage_key: string };
    expect(await readFile(join(dir, 'media', stored.storage_key))).toEqual(image);
    expect(app.services.credits.account(wid)).toMatchObject({
      balance: before - credits,
      reserved: 0,
    });
    expect(ledger(job.id)).toEqual([
      { kind: 'reserve', amount: credits },
      { kind: 'settle', amount: credits },
    ]);
    expect(generated().map((call) => call.url.hostname)).toEqual([
      'primary.example',
      'backup1.example',
    ]);
    expect(executionLogs(job.id)).toContainEqual(
      expect.objectContaining({
        status: 'succeeded',
        resource: expect.objectContaining({ id: 'backup-image-1' }),
      }),
    );
    await tick(job.id);
    expect(generated()).toHaveLength(2);
    expect(ledger(job.id)).toHaveLength(2);
  });

  it('tries all configured backups once then fails and releases when every resource explicitly rejects', async () => {
    connections('image', 2);
    const { job, before, credits } = await submit();
    await tick(job.id);
    expect(app.services.get(actor, wid, job.id)).toMatchObject({
      status: 'failed',
      settledCredits: 0,
    });
    expect(generated().map((call) => call.url.hostname)).toEqual([
      'primary.example',
      'backup1.example',
      'backup2.example',
    ]);
    expect(app.services.credits.account(wid)).toMatchObject({ balance: before, reserved: 0 });
    expect(ledger(job.id)).toEqual([
      { kind: 'reserve', amount: credits },
      { kind: 'release', amount: credits },
    ]);
    expect(
      executionLogs(job.id).filter((event) => event.errorCode === 'PROVIDER_NOT_EXECUTED'),
    ).toHaveLength(3);
    await tick(job.id);
    expect(generated()).toHaveLength(3);
    expect(ledger(job.id)).toHaveLength(2);
  });

  it('stops at an ambiguous backup response and retains the reservation without contacting another backup', async () => {
    connections('image', 2);
    answer = (call) =>
      call.url.hostname === 'primary.example'
        ? refused
        : {
            status: 503,
            body: { error: { message: 'Upstream temporarily unavailable' } },
          };
    const { job, before, credits } = await submit();
    await tick(job.id);
    expect(app.services.get(actor, wid, job.id)).toMatchObject({
      status: 'reconciliation_required',
      settledCredits: 0,
    });
    expect(generated().map((call) => call.url.hostname)).toEqual([
      'primary.example',
      'backup1.example',
    ]);
    expect(app.services.credits.account(wid)).toMatchObject({ balance: before, reserved: credits });
    expect(ledger(job.id)).toEqual([{ kind: 'reserve', amount: credits }]);
    await tick(job.id);
    expect(generated()).toHaveLength(2);
  });

  it('never resubmits or refunds an accepted video because later polling reports no channel', async () => {
    connections('video', 1);
    answer = (call) => {
      if (call.url.pathname.endsWith('/images/generations'))
        return { status: 200, body: { data: [{ b64_json: frame.toString('base64') }] } };
      if (call.method === 'GET') return refused;
      return { status: 200, body: { id: 'accepted-video-fixture' } };
    };
    const { job, before, credits } = await submit('video');
    await tick(job.id);
    for (let index = 0; index < 11; index++) await tick(job.id);
    expect(app.services.get(actor, wid, job.id)).toMatchObject({
      status: 'reconciliation_required',
      settledCredits: 0,
    });
    const videoCalls = generated().filter((call) => call.url.pathname.includes(taskPath));
    expect(videoCalls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(videoCalls.filter((call) => call.method === 'GET')).toHaveLength(11);
    expect(videoCalls.every((call) => call.url.hostname === 'primary.example')).toBe(true);
    expect(
      videoCalls
        .filter((call) => call.method === 'GET')
        .every((call) => call.url.pathname.endsWith('/accepted-video-fixture')),
    ).toBe(true);
    expect(app.services.credits.account(wid)).toMatchObject({ balance: before, reserved: credits });
    expect(ledger(job.id)).toEqual([{ kind: 'reserve', amount: credits }]);
    expect(
      executionLogs(job.id).filter((event) => event.errorCode === 'PROVIDER_NOT_EXECUTED'),
    ).toHaveLength(0);
  });
});

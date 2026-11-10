/** Isolated database, mocked GET metadata, no worker or real generation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import type { ModelCapabilitiesDto } from '../src/contracts/model-capabilities';

let directory: string, wid: string, cookie: string;
let actor: Actor;
let instance: Awaited<ReturnType<typeof createApp>>;
let config: AppConfig;
const network = vi.fn<typeof fetch>();
let now: number;
beforeEach(async () => {
  vi.stubGlobal('fetch', network);
  network.mockReset();
  network.mockImplementation(async (url, init) => {
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(String(url)).toBe('https://metadata-fixture.example/v1/models');
    return Response.json({ data: [{ id: 'gpt-image-2' }, { id: 'doubao-seedance-2.0' }] });
  });
  directory = await mkdtemp(join(tmpdir(), 'yingzao-model-capabilities-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(directory, 'test.sqlite'),
    storageDir: join(directory, 'media'),
    sessionSecret: 'capability-test-session',
    encryptionKey: 'capability-test-encryption',
    isProduction: false,
    demoMode: true,
    environmentSecrets: {
      openai: 'isolated-provider-fixture',
      dify: 'isolated-dify-fixture',
      seedance: 'isolated-video-fixture',
    },
    seedance: {
      taskBaseUrl: 'https://metadata-fixture.example/doubao/api/v3/contents/generations/tasks',
      model: 'doubao-seedance-2.0',
    },
    imageGateway: { baseUrl: 'https://metadata-fixture.example/v1', model: 'gpt-image-2' },
  };
  instance = await createApp(config, { serveWeb: false });
  const account = await instance.services.core.auth.register({
    email: 'capability@example.local',
    password: 'CapabilityFixture2026!',
    displayName: '能力测试',
  });
  wid = account.workspace.id;
  cookie = `studio_session=${account.sessionToken}`;
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(async () => {
  await instance.app.close();
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function request(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, workspaceId = wid) {
  return instance.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie, origin: config.publicOrigin, 'x-workspace-id': workspaceId },
    ...(payload ? { payload } : {}),
  });
}
async function capability(refresh = false): Promise<ModelCapabilitiesDto> {
  const response = await request(
    'GET',
    `/capabilities/model?providerId=openai&operation=image.generate&modelId=gpt-image-2&refresh=${refresh}`,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['cache-control']).toContain('no-store');
  return response.json().data;
}
function imageInput(revision?: string): JobInput {
  return jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    capabilityRevision: revision,
    prompt: '白色陶瓷杯，柔和自然光',
    options: { model: 'gpt-image-2', ratio: '1:1', resolution: '1K', count: 1 },
  });
}
function counts() {
  return {
    jobs: (
      instance.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get() as { n: number }
    ).n,
    reserved: instance.services.credits.account(wid).reserved,
  };
}

describe('authenticated model capability route and generation proof', () => {
  it.each(['brand', 'document', 'design'] as const)(
    'keeps revision validation through %s snapshot input transformation',
    async (kind) => {
      config.imageGateway = undefined;
      network.mockImplementation(async (url, init) => {
        expect(init?.method).toBe('GET');
        expect(String(url)).toBe('https://api.openai.com/v1/models');
        return Response.json({ data: [{ id: 'gpt-image-2.5-flare' }] });
      });
      const core = instance.services.core;
      const image = await core.assets.ingest(actor, wid, {
        name: 'reference.png',
        mimeType: 'image/png',
        buffer: await sharp({
          create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
        })
          .png()
          .toBuffer(),
      });
      const document =
        kind === 'document'
          ? await core.assets.ingest(actor, wid, {
              name: 'product.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('材料为再生玻璃，容量50毫升。'),
            })
          : null;
      if (document) await core.assets.processPendingExtractions(2);
      const brand =
        kind === 'brand'
          ? core.references.createBrand(actor, wid, {
              name: '品牌',
              description: '明亮风格',
              referenceAssetIds: [image.id],
            })
          : null;
      const queried = await request(
        'GET',
        `/capabilities/model?providerId=openai&operation=image.generate&modelId=gpt-image-2.5-flare&inputMode=${document ? 'image' : 'text'}`,
      );
      expect(queried.statusCode, queried.body).toBe(200);
      const revision = queried.json().data.revision;
      const input = jobInputSchema.parse({
        providerId: 'openai',
        operation: 'image.generate',
        prompt: '真实商品图片',
        capabilityRevision: revision,
        assetIds: document ? [document.id] : [],
        ...(brand ? { brandId: brand.id } : {}),
        options: {
          model: 'gpt-image-2.5-flare',
          ratio: '1:1',
          resolution: '1K',
          ...(kind === 'design'
            ? {
                designs: [
                  {
                    id: randomUUID(),
                    name: '主图',
                    kind: 'free',
                    ratio: '1:1',
                    assetIds: [image.id],
                    prompt: '保持商品外形',
                  },
                ],
              }
            : {}),
        },
      });
      const quoted = await request('POST', '/quotes', input);
      expect(quoted.statusCode, quoted.body).toBe(200);
      const submitted = await request('POST', '/jobs', {
        input,
        quoteId: quoted.json().data.id,
        clientRequestId: randomUUID(),
      });
      expect(submitted.statusCode, submitted.body).toBe(202);
      const job = submitted.json().data;
      expect(job.input).toEqual(input);
      const row = instance.services.db.sqlite
        .prepare('SELECT input_json FROM job_items WHERE job_id=?')
        .get(job.id) as { input_json: string };
      const frozen = jobInputSchema.parse(JSON.parse(row.input_json));
      expect(frozen.capabilityRevision).toBe(revision);
      if (brand) {
        expect(frozen.referenceAssetIds).toEqual([image.id]);
        expect(frozen.brandId).toBeUndefined();
      }
      if (document) {
        expect(frozen.assetIds).toEqual([]);
        expect(frozen.referenceText).toContain('再生玻璃');
      }
      if (kind === 'design') {
        expect(frozen.assetIds).toEqual([image.id]);
        expect(frozen.options.designs).toBeUndefined();
      }
      expect(network).toHaveBeenCalledTimes(1);
    },
  );
  it('preserves the static endpoint, rejects malformed/unknown models and protects space boundaries', async () => {
    const staticResponse = await request('GET', '/capabilities');
    expect(staticResponse.statusCode).toBe(200);
    expect(network).not.toHaveBeenCalled();
    const path =
      '/capabilities/model?providerId=openai&operation=image.generate&modelId=gpt-image-2';
    expect((await instance.app.inject({ method: 'GET', url: `/api/v1${path}` })).statusCode).toBe(
      401,
    );
    expect((await request('GET', path, undefined, randomUUID())).statusCode).toBe(403);
    expect(
      (await request('GET', path.replace('modelId=gpt-image-2', 'modelId=unknown'))).statusCode,
    ).toBe(400);
    expect((await request('GET', `${path}&url=https://evil.example`)).statusCode).toBe(400);
    expect(network).not.toHaveBeenCalled();
    const result = await capability();
    expect(result).toMatchObject({
      status: 'limited',
      source: 'upstream-model-list',
      canGenerate: true,
      parametersVerified: false,
    });
    expect(counts()).toEqual({ jobs: 0, reserved: 0 });
  });
  it('old contract quotations need no metadata; new proofs reject expiration before any job/reserve', async () => {
    expect((await request('POST', '/quotes', imageInput())).statusCode).toBe(200);
    expect(network).not.toHaveBeenCalled();
    const cap = await capability();
    const input = imageInput(cap.revision);
    const quoted = await request('POST', '/quotes', input);
    expect(quoted.statusCode, quoted.body).toBe(200);
    expect(quoted.json().data.expiresAt).toBe(cap.expiresAt);
    now += 301000;
    const submit = await request('POST', '/jobs', {
      input,
      quoteId: quoted.json().data.id,
      clientRequestId: randomUUID(),
    });
    expect(submit.statusCode).toBe(409);
    expect(submit.json().error.code).toBe('CAPABILITY_CHANGED');
    expect(counts()).toEqual({ jobs: 0, reserved: 0 });
  });
  it('credential rotation invalidates quotes while accepted request replay remains idempotent', async () => {
    const cap = await capability();
    const input = imageInput(cap.revision);
    const quoted = await request('POST', '/quotes', input);
    const body = { input, quoteId: quoted.json().data.id, clientRequestId: randomUUID() };
    const submitted = await request('POST', '/jobs', body);
    expect(submitted.statusCode, submitted.body).toBe(202);
    const before = counts();
    const update = await request('PUT', '/providers', {
      providerId: 'openai',
      secret: 'rotated-private-fixture',
      enabled: true,
    });
    expect(update.statusCode).toBe(200);
    now += 301000;
    const replay = await request('POST', '/jobs', body);
    expect(replay.statusCode, replay.body).toBe(202);
    expect(replay.json().data.id).toBe(submitted.json().data.id);
    expect(counts()).toEqual(before);
    expect((await request('POST', '/quotes', input)).json().error.code).toBe('CAPABILITY_CHANGED');
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('failure refresh invalidates the prior successful proof and cannot reserve a job', async () => {
    const first = await capability();
    const input = imageInput(first.revision);
    const quoted = await request('POST', '/quotes', input);
    now += 3000;
    network.mockResolvedValueOnce(new Response('private-provider-failure', { status: 503 }));
    expect((await capability(true)).canGenerate).toBe(false);
    const submitted = await request('POST', '/jobs', {
      input,
      quoteId: quoted.json().data.id,
      clientRequestId: randomUUID(),
    });
    expect(submitted.statusCode).toBe(409);
    expect(counts()).toEqual({ jobs: 0, reserved: 0 });
  });
  it('retry quotes refresh expired proofs and return the exact replacement input', async () => {
    const cap = await capability();
    const input = imageInput(cap.revision);
    const quoted = await request('POST', '/quotes', input);
    const submitted = await request('POST', '/jobs', {
      input,
      quoteId: quoted.json().data.id,
      clientRequestId: randomUUID(),
    });
    const job = submitted.json().data;
    expect(submitted.statusCode, submitted.body).toBe(202);
    expect((await request('POST', `/jobs/${job.id}/cancel`)).statusCode).toBe(200);
    expect(counts().reserved).toBe(0);
    now += 301000;
    const retry = await request('POST', `/jobs/${job.id}/retry-quote`);
    expect(retry.statusCode, retry.body).toBe(200);
    const retryQuote = retry.json().data;
    expect(retryQuote.input.capabilityRevision).not.toBe(input.capabilityRevision);
    expect(Date.parse(retryQuote.expiresAt)).toBe(now + 300000);
    expect(retryQuote.input.options).toEqual(input.options);
    const accepted = await request('POST', '/jobs', {
      input: retryQuote.input,
      quoteId: retryQuote.id,
      clientRequestId: randomUUID(),
    });
    expect(accepted.statusCode, accepted.body).toBe(202);
    expect(accepted.json().data.items[0].retrySourceItemId).toBe(job.items[0].id);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it('planning propagates a local-only proof without making any billable or guessed metadata request', async () => {
    const cap = await request(
      'GET',
      '/capabilities/model?providerId=dify&operation=text.assist&modelId=kimi-k3',
    );
    expect(cap.statusCode).toBe(200);
    expect(cap.json().data.source).toBe('local-adapter');
    const quoted = await request('POST', '/detail-pages/plan-quote', {
      brief: '白瓷杯商品详情',
      capabilityRevision: cap.json().data.revision,
    });
    expect(quoted.statusCode, quoted.body).toBe(200);
    expect(quoted.json().data.input.capabilityRevision).toBe(cap.json().data.revision);
    expect(quoted.json().data.input.options.model).toBe('kimi-k3');
    expect(network).not.toHaveBeenCalled();
    expect(counts()).toEqual({ jobs: 0, reserved: 0 });
  });
  it('accepts both documented Seedance audio settings without submitting generation', async () => {
    const cap = await request(
      'GET',
      '/capabilities/model?providerId=seedance&operation=video.generate&modelId=doubao-seedance-2.0',
    );
    expect(cap.statusCode, cap.body).toBe(200);
    expect(cap.json().data.parameters).toContainEqual({
      key: 'generateAudio',
      values: [false, true],
      source: 'provider-documentation',
      adjustable: true,
    });
    const input = jobInputSchema.parse({
      providerId: 'seedance',
      operation: 'video.generate',
      capabilityRevision: cap.json().data.revision,
      prompt: '陶瓷杯缓慢旋转',
      options: {
        model: 'doubao-seedance-2.0',
        ratio: '16:9',
        resolution: '480p',
        duration: 5,
        generateAudio: false,
        needText: false,
      },
    });
    const quoted = await request('POST', '/quotes', input);
    expect(quoted.statusCode, quoted.body).toBe(200);
    const rejected = await request('POST', '/quotes', {
      ...input,
      options: { ...input.options, generateAudio: true },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(counts()).toEqual({ jobs: 0, reserved: 0 });
  });
});

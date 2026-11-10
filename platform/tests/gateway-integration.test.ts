/** Isolated provider contracts only: no model credentials or external requests are used. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/server/app';
import { loadConfig, type AppConfig } from '../src/server/config';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import type { Actor } from '../src/contracts/core';
import { PROVIDERS } from '../src/contracts/catalog';
import { providerJson, downloadPublicMedia } from '../src/server/providers/http';
import { createWorker } from '../src/worker/runner';
import { ProviderError, type ItemRow } from '../src/server/tasks/types';

vi.mock('../src/server/providers/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/providers/http')>()),
  providerJson: vi.fn(),
  downloadPublicMedia: vi.fn(),
}));
const http = vi.mocked(providerJson);
const download = vi.mocked(downloadPublicMedia);
const forbiddenFetch = vi.fn(async () => {
  throw new Error('External requests are forbidden in gateway integration tests');
});
let temp: string;
let config: AppConfig;
let instance: Awaited<ReturnType<typeof createApp>>;
let cookie: string;
let wid: string;
let actor: Actor;
let png: Buffer;
const workers: ReturnType<typeof createWorker>[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  http.mockRejectedValue(new Error('Unexpected provider request'));
  download.mockRejectedValue(new Error('Unexpected media download'));
  vi.stubGlobal('fetch', forbiddenFetch);
  temp = await mkdtemp(join(tmpdir(), 'yingzao-gateway-integration-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(temp, 'test.sqlite'),
    storageDir: join(temp, 'media'),
    sessionSecret: 'gateway-contract-session-secret',
    encryptionKey: 'gateway-contract-encryption-secret',
    demoMode: true,
    isProduction: false,
    environmentSecrets: {
      openai: 'contract-image-key',
      dify: 'contract-dify-key',
      seedance: 'contract-video-key',
    },
    imageGateway: {
      baseUrl: 'https://images.example.test/v1',
      model: 'gpt-image-2',
      quality: 'low',
      size: '1024x1024',
    },
    dify: { baseUrl: 'https://dify.example.test/v1' },
    seedance: {
      taskBaseUrl: 'https://video.example.test/doubao/api/v3/contents/generations/tasks',
      model: 'doubao-seedance-2.0',
    },
  };
  instance = await createApp(config, { serveWeb: false });
  const registration = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'gateway-contract@example.local',
      password: 'GatewayContractPassword2026!',
      displayName: '接口隔离验收',
    },
  });
  expect(registration.statusCode, registration.body).toBe(201);
  cookie = String(registration.headers['set-cookie']).split(';')[0]!;
  const data = registration.json().data;
  wid = data.workspace.id;
  actor = {
    userId: data.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#e6b9a2' } })
    .png()
    .toBuffer();
});

afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  await instance?.app.close();
  if (temp) await rm(temp, { recursive: true, force: true });
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const headers = () => ({ cookie, origin: config.publicOrigin, 'x-workspace-id': wid });
function input(
  providerId: 'openai' | 'dify' | 'seedance',
  overrides: Record<string, unknown> = {},
) {
  return jobInputSchema.parse({
    operation:
      providerId === 'dify'
        ? 'text.assist'
        : providerId === 'seedance'
          ? 'video.generate'
          : 'image.generate',
    providerId,
    prompt: '白色陶瓷杯置于浅灰背景，使用柔和自然光。',
    options:
      providerId === 'seedance'
        ? { duration: 5, ratio: '16:9', resolution: '720p', needText: false }
        : {},
    ...overrides,
  });
}
function quote(value: JobInput) {
  return instance.app.inject({
    method: 'POST',
    url: '/api/v1/quotes',
    headers: headers(),
    payload: value,
  });
}
async function submit(value: JobInput) {
  const quotation = await quote(value);
  expect(quotation.statusCode, quotation.body).toBe(200);
  const payload = {
    input: value,
    quoteId: quotation.json().data.id,
    clientRequestId: randomUUID(),
  };
  const send = () =>
    instance.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: headers(), payload });
  const first = await send();
  const duplicate = await send();
  expect(first.statusCode, first.body).toBe(202);
  expect(duplicate.statusCode, duplicate.body).toBe(202);
  expect(duplicate.json().data.id).toBe(first.json().data.id);
  expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
    n: 1,
  });
  return first.json().data.id as string;
}
function worker() {
  const created = createWorker(instance.services);
  workers.push(created);
  return created;
}
function assertNoQuotedWork() {
  for (const table of ['quotes', 'jobs', 'job_items'])
    expect(instance.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
  expect(instance.services.balance(actor, wid).reserved).toBe(0);
  expect(http).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
}
async function reference() {
  return instance.services.core.assets.ingest(actor, wid, {
    buffer: png,
    name: '隔离参考图.png',
    mimeType: 'image/png',
  });
}

describe('configured gateway HTTP and worker integration', () => {
  it('loads explicit gateway configuration without changing the default official image provider', () => {
    const safe = {
      SESSION_SECRET: 'contract-session-no-fallback-files',
      ENCRYPTION_KEY: 'contract-encryption-no-fallback-files',
      DATABASE_PATH: config.databasePath,
      STORAGE_DIR: config.storageDir,
    };
    expect(loadConfig(safe).imageGateway).toBeUndefined();
    const loaded = loadConfig({
      ...safe,
      OPENAI_API_KEY: 'fixture-image-key',
      IMAGE_API_BASE_URL: 'https://gateway.example.test/v1',
      DIFY_API_KEY: 'fixture-dify-key',
      DIFY_API_BASE_URL: 'https://workflow.example.test/v1',
      SEEDANCE_API_KEY: 'fixture-video-key',
      SEEDANCE_TASK_BASE_URL: 'https://video.example.test/tasks',
      SEEDANCE_MODEL: 'doubao-seedance-2.0',
    });
    expect(loaded.imageGateway).toEqual({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-image-2',
      quality: 'low',
      size: '1024x1024',
    });
    expect(loaded.dify).toEqual({ baseUrl: 'https://workflow.example.test/v1' });
    expect(loaded.seedance).toEqual({
      taskBaseUrl: 'https://video.example.test/tasks',
      model: 'doubao-seedance-2.0',
    });
    expect(loaded.environmentSecrets).toMatchObject({
      openai: 'fixture-image-key',
      dify: 'fixture-dify-key',
      seedance: 'fixture-video-key',
    });
  });

  it('exposes only supported gateway capabilities while preserving official OpenAI capabilities when no gateway is configured', async () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(['dify', 'seedance', 'openai', 'fal', 'flyelep', 'tikhub', 'local']),
    );
    const capabilities = instance.services.settings.capabilities(wid);
    const image = capabilities.operations.filter((operation) => operation.providerId === 'openai');
    expect(image.map((operation) => operation.id)).toEqual(['image.generate']);
    expect(image[0]).toMatchObject({
      available: true,
      liveVerified: false,
      models: [{ id: 'gpt-image-2', ratios: ['1:1'], resolutions: ['1K'] }],
    });
    expect(
      capabilities.operations.find((operation) => operation.providerId === 'dify'),
    ).toMatchObject({ id: 'text.assist', available: true });
    expect(
      capabilities.operations.find((operation) => operation.providerId === 'seedance'),
    ).toMatchObject({
      id: 'video.generate',
      available: true,
      models: [
        {
          durations: Array.from({ length: 12 }, (_, n) => n + 4),
          resolutions: ['480p', '720p', '1080p', '4K'],
        },
      ],
    });
    await instance.app.close();
    config = { ...config, imageGateway: undefined };
    instance = await createApp(config, { serveWeb: false });
    const official = instance.services.settings
      .capabilities(wid)
      .operations.filter((operation) => operation.providerId === 'openai');
    expect(official.map((operation) => operation.id)).toEqual(
      expect.arrayContaining(['image.generate', 'text.assist', 'image.ocr', 'image-inpaint']),
    );
    expect(
      official
        .find((operation) => operation.id === 'image.generate')!
        .models.some((model) => model.ratios.includes('3:4')),
    ).toBe(true);
    expect(http).not.toHaveBeenCalled();
  });

  it('loads Seedream without GPT quality flags and rejects stale model or size selections before quoting', async () => {
    const loaded = loadConfig({
      SESSION_SECRET: 'contract-session-no-fallback-files',
      ENCRYPTION_KEY: 'contract-encryption-no-fallback-files',
      DATABASE_PATH: config.databasePath,
      STORAGE_DIR: config.storageDir,
      IMAGE_API_BASE_URL: 'https://xingyunyinli.com/v1',
      IMAGE_MODEL: 'doubao-seedream-5.0-lite',
    });
    expect(loaded.imageGateway).toEqual({
      baseUrl: 'https://xingyunyinli.com/v1',
      model: 'doubao-seedream-5.0-lite',
      size: '2048x2048',
    });
    expect(loaded.imageGateway).not.toHaveProperty('quality');
    await instance.app.close();
    config = { ...config, imageGateway: loaded.imageGateway };
    instance = await createApp(config, { serveWeb: false });
    const providers = await instance.app.inject({ url: '/api/v1/providers', headers: headers() });
    expect(providers.statusCode, providers.body).toBe(200);
    expect(providers.json().data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'openai',
          name: 'Seedream（豆包生图）',
          configured: true,
        }),
      ]),
    );
    const capabilities = instance.services.settings.capabilities(wid);
    expect(capabilities.providers.find((provider) => provider.id === 'openai')!.name).toBe(
      'Seedream（豆包生图）',
    );
    const image = capabilities.operations.filter((operation) => operation.providerId === 'openai');
    expect(image.map((operation) => operation.id)).toEqual(['image.generate']);
    expect(image[0]!.models).toEqual([
      expect.objectContaining({
        id: 'doubao-seedream-5.0-lite',
        name: 'Seedream 5.0 Lite（豆包生图）',
        ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
        resolutions: ['2K', '3K', '4K'],
      }),
    ]);
    const supported = {
      model: 'doubao-seedream-5.0-lite',
      ratio: '1:1',
      resolution: '2K',
      count: 1,
    };
    for (const unsupported of [
      { model: 'gpt-image-2' },
      { resolution: '1K' },
      { ratio: '8:7' },
      { count: 2 },
    ]) {
      const denied = await quote(input('openai', { options: { ...supported, ...unsupported } }));
      expect(denied.statusCode, denied.body).toBe(400);
    }
    assertNoQuotedWork();
    const accepted = await quote(input('openai', { options: supported }));
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(http).not.toHaveBeenCalled();
  });

  it('routes a Seedream request through the configured worker without GPT fields and persists its downloaded image', async () => {
    await instance.app.close();
    config = {
      ...config,
      imageGateway: {
        baseUrl: 'https://xingyunyinli.com/v1',
        model: 'doubao-seedream-5.0-lite',
        size: '2048x2048',
      },
    };
    instance = await createApp(config, { serveWeb: false });
    const value = input('openai', {
      options: { model: 'doubao-seedream-5.0-lite', ratio: '1:1', resolution: '2K', count: 1 },
    });
    const image = await sharp({
      create: { width: 2048, height: 2048, channels: 3, background: '#e6b9a2' },
    })
      .png()
      .toBuffer();
    const id = await submit(value);
    http.mockResolvedValue({ data: [{ url: 'https://media.example.test/seedream-contract.png' }] });
    download.mockResolvedValue(image);
    const execution = worker();
    await execution.runItem(execution.claim()!);
    const result = instance.services.get(actor, wid, id);
    expect(result.status).toBe('succeeded');
    expect(result.outputAssets).toHaveLength(1);
    expect(result.outputAssets[0]).toMatchObject({
      width: 2048,
      height: 2048,
      mimeType: 'image/png',
    });
    expect(
      (await instance.services.core.assets.readOriginal(actor, wid, result.outputAssets[0]!.id))
        .buffer,
    ).toEqual(image);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![0]).toBe('https://xingyunyinli.com/v1/images/generations');
    expect(http.mock.calls[0]![1]!.body).toEqual({
      model: 'doubao-seedream-5.0-lite',
      prompt: expect.stringContaining(value.prompt),
      size: '2048x2048',
      sequential_image_generation: 'disabled',
      response_format: 'url',
      output_format: 'png',
      watermark: false,
      stream: false,
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]![0]).toBe('https://media.example.test/seedream-contract.png');
    expect(instance.services.balance(actor, wid).reserved).toBe(0);
    await execution.tick();
    await execution.drain();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported Dify inputs before creating quotes or reservations', async () => {
    const asset = await reference();
    const rejected = [
      input('dify', { options: { assistantMode: 'design-plan' } }),
      input('dify', { assetIds: [asset.id] }),
      input('dify', { referenceAssetIds: [asset.id] }),
      input('dify', { referenceText: '需要核对的文档内容' }),
      input('dify', { conversationContext: '之前的内容' }),
      input('dify', { options: { count: 2 } }),
      input('dify', { prompt: ' ' }),
      input('dify', { prompt: '过'.repeat(8001) }),
    ];
    for (const value of rejected) {
      const response = await quote(value);
      expect(response.statusCode, response.body).toBe(400);
    }
    assertNoQuotedWork();
  });

  it('accepts new provider settings, encrypts their credentials and restores workspace overrides after restart', async () => {
    for (const providerId of ['dify', 'seedance'] as const) {
      const secret = `workspace-contract-${providerId}-key`;
      const saved = await instance.app.inject({
        method: 'PUT',
        url: '/api/v1/providers',
        headers: headers(),
        payload: { providerId, secret, enabled: true },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.body).not.toContain(secret);
      const row = instance.services.db.sqlite
        .prepare(
          'SELECT encrypted_secret FROM provider_settings WHERE workspace_id=? AND provider_id=?',
        )
        .get(wid, providerId) as { encrypted_secret: string };
      expect(row.encrypted_secret).toBeTruthy();
      expect(row.encrypted_secret).not.toContain(secret);
    }
    await instance.app.close();
    instance = await createApp(config, { serveWeb: false });
    expect(instance.services.settings.secret(wid, 'dify')).toBe('workspace-contract-dify-key');
    expect(instance.services.settings.secret(wid, 'seedance')).toBe(
      'workspace-contract-seedance-key',
    );
    const listed = await instance.app.inject({ url: '/api/v1/providers', headers: headers() });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.body).not.toContain('workspace-contract-');
    expect(http).not.toHaveBeenCalled();
  });

  it('rejects unsupported Seedance inputs before creating quotes or reservations', async () => {
    const asset = await reference();
    const basic = input('seedance');
    for (const change of [
      { duration: 16 },
      { ratio: '2:3' },
      { resolution: '8K' },
      { count: 2 },
      { needText: true },
    ]) {
      const response = await quote(input('seedance', { options: { ...basic.options, ...change } }));
      expect(response.statusCode, response.body).toBe(400);
    }
    for (const changes of [{ assetIds: [asset.id] }, { referenceAssetIds: [asset.id] }]) {
      const response = await quote(input('seedance', changes));
      expect(response.statusCode, response.body).toBe(400);
    }
    assertNoQuotedWork();
  });

  it('rejects image gateway dimensions, batching and references before quoting', async () => {
    const asset = await reference();
    for (const changes of [
      { options: { ratio: '3:4' } },
      { options: { resolution: '2K' } },
      { options: { count: 2 } },
      { assetIds: [asset.id] },
      { referenceAssetIds: [asset.id] },
    ]) {
      const response = await quote(input('openai', changes));
      expect(response.statusCode, response.body).toBe(400);
    }
    assertNoQuotedWork();
  });

  it('executes the configured Dify workflow once and persists its complete pending-confirmation text', async () => {
    const id = await submit(input('dify'));
    http.mockResolvedValue({
      workflow_run_id: 'contract-workflow-run',
      data: {
        status: 'succeeded',
        outputs: {
          plan_json: JSON.stringify({
            schema_version: '1.0',
            status: 'needs_confirmation',
            delivery_type: 'image',
            product_facts: ['白色陶瓷杯'],
            unknowns: ['品牌未知'],
            creative_direction: '柔和自然光',
            image_tasks: [
              {
                id: 'image_1',
                purpose: '商品图',
                prompt: '保留产品外观',
                reference_required: true,
              },
            ],
            video_shots: [],
            voiceover_text: '',
            questions: ['请提供商品参考图。'],
          }),
        },
      },
    });
    const execution = worker();
    await execution.runItem(execution.claim()!);
    const result = instance.services.get(actor, wid, id);
    expect(result.status).toBe('succeeded');
    expect(result.items[0]!.resultText).toContain('创作策划（待确认）');
    expect(result.items[0]!.resultText).toContain('请提供商品参考图');
    expect(result.items[0]!.resultData).toBeNull();
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![0]).toBe('https://dify.example.test/v1/workflows/run');
    expect(http.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer contract-dify-key' });
    await execution.tick();
    await execution.drain();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('routes the configured image gateway through the worker and stores the actual image bytes once', async () => {
    const id = await submit(input('openai'));
    http.mockResolvedValue({ data: [{ b64_json: png.toString('base64') }] });
    const execution = worker();
    await execution.runItem(execution.claim()!);
    const result = instance.services.get(actor, wid, id);
    expect(result.status).toBe('succeeded');
    expect(result.outputAssets).toHaveLength(1);
    expect(
      (await instance.services.core.assets.readOriginal(actor, wid, result.outputAssets[0]!.id))
        .buffer,
    ).toEqual(png);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![0]).toBe('https://images.example.test/v1/images/generations');
    expect(http.mock.calls[0]![1]!.body).toMatchObject({
      model: 'gpt-image-2',
      quality: 'low',
      size: '1024x1024',
      n: 1,
    });
    expect(instance.services.balance(actor, wid).reserved).toBe(0);
  });

  it('holds an uncertain Dify submission for reconciliation instead of resubmitting after recovery', async () => {
    const id = await submit(input('dify'));
    http.mockRejectedValue(new ProviderError('提交结果待核对。', true));
    const execution = worker();
    await execution.runItem(execution.claim()!);
    expect(instance.services.get(actor, wid, id).status).toBe('reconciliation_required');
    const resumed = worker();
    await resumed.tick();
    await resumed.drain();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('persists a Seedance remote task and resumes polling after restart without another billed submission', async () => {
    const filename = join(temp, 'contract-video.mp4');
    await promisify(execFile)('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=gray:s=64x64:d=1',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      filename,
    ]);
    const video = await readFile(filename);
    const id = await submit(input('seedance'));
    http.mockResolvedValueOnce({ id: 'contract-video-task' });
    const first = worker();
    const firstItem = first.claim()!;
    await first.runItem(firstItem);
    const saved = instance.services.db.sqlite
      .prepare('SELECT phase,remote_id,remote_json FROM job_items WHERE id=?')
      .get(firstItem.id) as { phase: string; remote_id: string; remote_json: string };
    expect(saved).toMatchObject({ phase: 'polling', remote_id: 'contract-video-task' });
    expect(JSON.parse(saved.remote_json)).toEqual({
      id: 'contract-video-task',
      endpoint: 'https://video.example.test/doubao/api/v3/contents/generations/tasks',
      submittedAt: expect.any(String),
    });
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![0]).toBe('https://video.example.test/v1/videos');
    expect(http.mock.calls[0]![1]!.method ?? 'POST').toBe('POST');
    expect(http.mock.calls[0]![1]!.body).toEqual({
      model: 'doubao-seedance-2.0',
      prompt: input('seedance').prompt,
      seconds: 5,
      metadata: { resolution: '720p', ratio: '16:9', generate_audio: false },
    });
    await first.stop();
    await instance.app.close();
    instance = await createApp(config, { serveWeb: false });
    const resumed = worker();
    instance.services.db.sqlite
      .prepare('UPDATE job_items SET next_attempt_at=? WHERE id=?')
      .run('2000-01-01T00:00:00.000Z', firstItem.id);
    http.mockResolvedValueOnce({
      id: 'contract-video-task',
      status: 'succeeded',
      content: { video_url: 'https://media.example.test/contract-video.mp4' },
    });
    download.mockResolvedValue(video);
    const persisted = resumed.claim() as ItemRow;
    expect(persisted.remote_id).toBe('contract-video-task');
    await resumed.runItem(persisted);
    const result = instance.services.get(actor, wid, id);
    expect(result.status).toBe('succeeded');
    expect(result.outputAssets).toHaveLength(1);
    expect(
      (await instance.services.core.assets.readOriginal(actor, wid, result.outputAssets[0]!.id))
        .buffer,
    ).toEqual(video);
    expect(
      http.mock.calls.filter(([, options]) => (options!.method ?? 'POST') === 'POST'),
    ).toHaveLength(1);
    expect(http.mock.calls[1]![0]).toBe(
      'https://video.example.test/doubao/api/v3/contents/generations/tasks/contract-video-task',
    );
    expect(http.mock.calls[1]![1]!.method).toBe('GET');
    expect(download).toHaveBeenCalledTimes(1);
    expect(instance.services.balance(actor, wid).reserved).toBe(0);
    await resumed.tick();
    await resumed.drain();
    expect(http).toHaveBeenCalledTimes(2);
  });
});

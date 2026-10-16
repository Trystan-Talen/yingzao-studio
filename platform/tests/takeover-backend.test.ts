/** Local SQLite and deterministic provider fixtures; no paid or external requests. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildVideoAudioRequest } from '../src/server/providers/video-audio';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { createWorker } from '../src/worker/runner';
import type { ProviderAdapter } from '../src/server/tasks/types';
import { falProvider } from '../src/server/providers/fal';
import { inputHash } from '../src/server/tasks/validation';
import type { DesignPlanResult } from '../src/contracts/design-plan';

let folder: string;
let instance: Awaited<ReturnType<typeof createApp>>;
let actor: Actor;
let wid: string;
let cookie: string;
let png: Buffer;
const workers: ReturnType<typeof createWorker>[] = [];
const origin = 'http://127.0.0.1:5174';
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-takeover-'));
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: origin,
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'takeover-fixture-session',
    encryptionKey: 'takeover-fixture-encryption',
    isProduction: false,
    demoMode: true,
    environmentSecrets: {
      openai: 'fixture-not-a-real-key',
      fal: 'fixture-not-a-real-key',
      flyelep: 'fixture-not-a-real-key',
    },
  };
  instance = await createApp(config, { serveWeb: false });
  const registered = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: {
      email: 'takeover@example.local',
      password: 'TakeoverFixture2026!',
      displayName: '测试创作者',
    },
  });
  expect(registered.statusCode, registered.body).toBe(201);
  cookie = String(registered.headers['set-cookie']).split(';')[0]!;
  const user = registered.json().data;
  wid = user.workspace.id;
  actor = {
    userId: user.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#446655' } })
    .png()
    .toBuffer();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const worker of workers.splice(0)) await worker.stop();
  await instance.app.close();
  await rm(folder, { recursive: true, force: true });
});
const headers = (workspace = wid) => ({ cookie, origin, 'x-workspace-id': workspace });
function input(overrides: Record<string, unknown> = {}): JobInput {
  return jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: '商品创作',
    ...overrides,
  });
}
function submit(value = input(), requestId = randomUUID(), workspace = wid) {
  const quote = instance.services.quote(actor, workspace, value);
  return instance.services.submit(actor, workspace, value, quote.id, requestId);
}
async function asset(name = 'fixture.png') {
  return instance.services.core.assets.ingest(actor, wid, {
    buffer: png,
    name,
    mimeType: 'image/png',
  });
}
function worker(adapter: ProviderAdapter) {
  const value = createWorker(instance.services, { [adapter.id]: adapter });
  workers.push(value);
  return value;
}
const planResult: DesignPlanResult = {
  type: 'design-plan',
  version: 1,
  plan: {
    analysis: '植物精华产品图',
    objective: '展示质感',
    style: '自然',
    palette: ['#446655'],
    composition: '居中',
    copy: ['植物精华'],
    scene: '自然光影',
    technical: { ratio: '1:1', resolution: '1K', language: 'zh-CN' },
    directions: [1, 2, 3].map((index) => ({
      title: `方向${index}`,
      prompt: `真实产品质感方向${index}`,
    })),
  },
};

describe('takeover backend regression boundaries', () => {
  it('scopes and freezes the separate music asset through quote, job, provider media and worker access', async () => {
    const file = join(folder, 'background.wav');
    await promisify(execFile)(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=330:duration=5',
        '-c:a',
        'pcm_s16le',
        '-y',
        file,
      ],
      { timeout: 15000 },
    );
    const music = await instance.services.core.assets.ingest(actor, wid, {
      buffer: await readFile(file),
      name: 'background.wav',
      mimeType: 'audio/wav',
    });
    const value = input({
      operation: 'video.generate',
      providerId: 'fal',
      backgroundAudioAssetId: music.id,
      options: { model: 'wan-2.6', resolution: '720p', duration: 5, ratio: '1:1' },
    });
    const foreign = instance.services.core.auth.createWorkspace(
      actor.userId,
      'Foreign music space',
      'team',
    );
    const otherMusic = await instance.services.core.assets.ingest(actor, foreign.id, {
      buffer: await readFile(file),
      name: 'foreign.wav',
      mimeType: 'audio/wav',
    });
    expect(() =>
      instance.services.quote(actor, wid, { ...value, backgroundAudioAssetId: otherMusic.id }),
    ).toThrow();
    const quote = instance.services.quote(actor, wid, value);
    expect(quote.items?.[0]?.backgroundAudioAssetId).toBe(music.id);
    const job = instance.services.submit(actor, wid, value, quote.id, randomUUID());
    expect(job.input.backgroundAudioAssetId).toBe(music.id);
    expect(job.items[0]?.backgroundAudioAssetId).toBe(music.id);
    await expect(
      instance.services.readProviderMedia(wid, actor.userId, job.id, music.id, 'original'),
    ).rejects.toMatchObject({ code: 'INVALID_JOB_CONTEXT' });
    let accessed = false;
    const run = worker({
      id: 'fal',
      execute: async (context) => {
        const request = await buildVideoAudioRequest(context);
        accessed = String(request.audio_url).startsWith('data:audio/wav;base64,');
        return { state: 'failed', message: 'Intentional fixture stop before any external request' };
      },
    });
    const claimed = run.claim()!;
    expect(
      (await instance.services.readProviderMedia(wid, actor.userId, job.id, music.id, 'original'))
        .mimeType,
    ).toBe('audio/wav');
    await expect(
      instance.services.readProviderMedia(wid, actor.userId, job.id, otherMusic.id, 'original'),
    ).rejects.toMatchObject({ code: 'ASSET_REFERENCE' });
    await run.runItem(claimed);
    expect(accessed).toBe(true);
    expect(instance.services.get(actor, wid, job.id).status).toBe('failed');
    expect(instance.services.balance(actor, wid)).toMatchObject({
      balance: 1000,
      reserved: 0,
      spent: 0,
    });
  });

  it('replays a pre-upgrade request despite newly added default option fields', () => {
    const value = input(),
      requestId = randomUUID(),
      quote = instance.services.quote(actor, wid, value);
    const job = instance.services.submit(actor, wid, value, quote.id, requestId);
    const legacy = JSON.parse(JSON.stringify(value));
    delete legacy.options.motionOrientation;
    delete legacy.options.referenceAuthorized;
    delete legacy.options.forceTranslation;
    instance.services.db.sqlite
      .prepare('UPDATE jobs SET input_json=?,input_hash=? WHERE id=?')
      .run(JSON.stringify(legacy), inputHash(legacy), job.id);
    expect(instance.services.submit(actor, wid, value, quote.id, requestId).id).toBe(job.id);
    expect(() =>
      instance.services.submit(actor, wid, { ...value, prompt: 'different' }, quote.id, requestId),
    ).toThrow();
    expect(
      instance.services.db.sqlite
        .prepare('SELECT COUNT(*) n FROM jobs WHERE request_id=?')
        .get(requestId),
    ).toEqual({ n: 1 });
  });

  it('persists structured plans through provider completion, DTO and project messages', async () => {
    const project = instance.services.core.projects.create(actor, wid, { name: '方案对象' });
    const job = submit(
      input({
        operation: 'text.assist',
        projectId: project.id,
        options: { assistantMode: 'design-plan' },
      }),
    );
    const run = worker({
      id: 'openai',
      execute: async () => ({
        state: 'complete',
        outputs: [
          {
            text: '已生成设计方案',
            mimeType: 'text/plain',
            name: 'plan.txt',
            resultData: planResult,
          },
        ],
      }),
    });
    await run.runItem(run.claim()!);
    expect(instance.services.get(actor, wid, job.id).items[0]!.resultData).toEqual(planResult);
    const message = instance.services.db.sqlite
      .prepare("SELECT metadata_json FROM messages WHERE job_id=? AND role='assistant'")
      .get(job.id) as { metadata_json: string };
    expect(JSON.parse(message.metadata_json).resultData).toEqual(planResult);
    const response = await instance.app.inject({
      url: `/api/v1/jobs/${job.id}`,
      headers: headers(),
    });
    expect(response.json().data.items[0].resultData).toEqual(planResult);
    expect(JSON.stringify(response.json())).not.toContain('responseUrl');
  });

  it('resumes a stored plan without a second provider call and rejects invalid result versions', async () => {
    const value = input({ operation: 'text.assist', options: { assistantMode: 'design-plan' } });
    const stored = submit(value);
    instance.services.db.sqlite
      .prepare(
        "UPDATE job_items SET status='running',phase='downloading',lease_until=?,result_json=? WHERE id=?",
      )
      .run(
        '2000-01-01T00:00:00.000Z',
        JSON.stringify({
          outputKind: 'single',
          outputs: [
            { text: '恢复方案', mimeType: 'text/plain', name: 'plan.txt', resultData: planResult },
          ],
        }),
        stored.items[0]!.id,
      );
    let calls = 0;
    const run = worker({
      id: 'openai',
      execute: async () => {
        calls++;
        return {
          state: 'complete',
          outputs: [
            {
              text: '非法版本',
              mimeType: 'text/plain',
              name: 'plan.txt',
              resultData: { ...planResult, version: 2 } as unknown as DesignPlanResult,
            },
          ],
        };
      },
    });
    run.recover();
    await run.runItem(run.claim()!);
    expect(calls).toBe(0);
    expect(instance.services.get(actor, wid, stored.id).items[0]!.resultData).toEqual(planResult);
    const invalid = submit(value);
    await run.runItem(run.claim()!);
    expect(calls).toBe(1);
    expect(instance.services.get(actor, wid, invalid.id)).toMatchObject({
      status: 'reconciliation_required',
      settledCredits: 0,
    });
    expect(instance.services.get(actor, wid, invalid.id).items[0]!.resultData).toBeNull();
  });
  it('transmits Wan text intent as guidance and validates the final prompt before quoting', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: 'fixture',
          status_url: 'https://queue.fal.run/status',
          response_url: 'https://queue.fal.run/result',
        }),
      ),
    );
    const requests: Record<string, unknown>[] = [];
    fetch.mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(init?.body as string));
      return new Response(
        JSON.stringify({
          request_id: 'fixture',
          status_url: 'https://queue.fal.run/status',
          response_url: 'https://queue.fal.run/result',
        }),
      );
    });
    for (const options of [
      { needText: true, language: 'en' },
      { needText: false, language: 'zh-CN' },
    ]) {
      const value = input({
        operation: 'video.generate',
        providerId: 'fal',
        options: { model: 'wan-2.6', resolution: '720p', ...options },
      });
      await falProvider.execute(
        {
          actor,
          workspaceId: wid,
          input: value,
          readAsset: async () => {
            throw new Error('not expected');
          },
        },
        'fixture-key',
      );
    }
    expect(requests[0]!.prompt).toContain('use en');
    expect(requests[1]!.prompt).toContain('Do not add on-screen text');
    expect(requests[0]).not.toHaveProperty('language');
    expect(requests[0]).not.toHaveProperty('generate_audio');
    expect(() =>
      instance.services.quote(
        actor,
        wid,
        input({
          operation: 'video.generate',
          providerId: 'fal',
          prompt: 'a'.repeat(1450),
          options: { model: 'wan-2.6', resolution: '720p' },
        }),
      ),
    ).toThrow(/1500/);
    expect(
      instance.services.settings
        .capabilities(wid)
        .operations.find((op) => op.id === 'video.generate')
        ?.models.find((model) => model.id === 'wan-2.6')?.textOverlay?.mode,
    ).toBe('prompt-guidance');
  });
  it('recovers a lost submission response only for its user and workspace, with read scope', async () => {
    const requestId = randomUUID();
    const job = submit(input(), requestId);
    const found = await instance.app.inject({
      url: `/api/v1/jobs/by-request/${requestId}`,
      headers: headers(),
    });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json().data.id).toBe(job.id);
    const otherWorkspace = instance.services.core.auth.createWorkspace(
      actor.userId,
      '其它空间',
      'team',
    );
    expect(
      (
        await instance.app.inject({
          url: `/api/v1/jobs/by-request/${requestId}`,
          headers: headers(otherWorkspace.id),
        })
      ).statusCode,
    ).toBe(404);
    const team = instance.services.core.auth.createWorkspace(actor.userId, '共同空间', 'team');
    const invitation = instance.services.core.team.invite(actor, team.id, {
      email: 'other@example.local',
      role: 'member',
    });
    const other = await instance.services.core.auth.register({
      email: 'other@example.local',
      password: 'OtherFixture2026!',
      displayName: '其它成员',
      inviteToken: new URL(invitation.inviteUrl).hash.slice(7),
    });
    submit(input(), requestId, team.id);
    expect(
      (
        await instance.app.inject({
          url: `/api/v1/jobs/by-request/${requestId}`,
          headers: {
            origin,
            cookie: `studio_session=${other.sessionToken}`,
            'x-workspace-id': team.id,
          },
        })
      ).statusCode,
    ).toBe(404);
    const key = instance.services.core.business.createKey(actor, wid, {
      name: 'without read',
      scopes: ['jobs:write'],
    });
    expect(
      (
        await instance.app.inject({
          url: `/api/v1/jobs/by-request/${requestId}`,
          headers: { authorization: `Bearer ${key.secret}`, 'x-workspace-id': wid },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await instance.app.inject({
          url: `/api/v1/jobs/by-request/${randomUUID()}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('keeps text assistance out of the media draft metadata', () => {
    const project = instance.services.core.projects.create(actor, wid, { name: '媒体草稿' });
    submit(input({ projectId: project.id }));
    submit(input({ operation: 'text.assist', projectId: project.id }));
    const messages = instance.services.db.sqlite
      .prepare(
        "SELECT metadata_json FROM messages WHERE project_id=? AND role='user' ORDER BY rowid",
      )
      .all(project.id) as { metadata_json: string }[];
    expect(JSON.parse(messages[0]!.metadata_json).draft.operation).toBe('image.generate');
    expect(JSON.parse(messages[1]!.metadata_json)).not.toHaveProperty('draft');
    expect(JSON.parse(messages[1]!.metadata_json).assistantRequest.operation).toBe('text.assist');
  });

  it('reserves each failed source item once across competing retry quotes and successful descendants', async () => {
    const job = submit();
    const failed = worker({
      id: 'openai',
      execute: async () => ({ state: 'failed', message: 'fixture failure' }),
    });
    await failed.runItem(failed.claim()!);
    const firstQuote = instance.services.retryQuote(actor, wid, job.id);
    const competingQuote = instance.services.retryQuote(actor, wid, job.id);
    const retry = instance.services.submit(actor, wid, job.input, firstQuote.id, randomUUID());
    expect(() => instance.services.retryQuote(actor, wid, job.id)).toThrow();
    expect(() =>
      instance.services.submit(actor, wid, job.input, competingQuote.id, randomUUID()),
    ).toThrow();
    expect(instance.services.balance(actor, wid).reserved).toBe(8);
    const succeeded = worker({
      id: 'openai',
      execute: async () => ({
        state: 'complete',
        outputs: [{ buffer: png, mimeType: 'image/png', name: 'retry.png' }],
      }),
    });
    await succeeded.runItem(succeeded.claim()!);
    expect(instance.services.get(actor, wid, retry.id).status).toBe('succeeded');
    expect(() => instance.services.retryQuote(actor, wid, job.id)).toThrow();
    expect(instance.services.get(actor, wid, job.id).items[0]).toMatchObject({
      retryable: false,
      retryJobId: retry.id,
    });
    expect(instance.services.balance(actor, wid)).toMatchObject({ reserved: 0, spent: 8 });
  });

  it('allows a failed retry to be retried, but locks its common source while another descendant is active', async () => {
    const job = submit();
    const failed = worker({
      id: 'openai',
      execute: async () => ({ state: 'failed', message: 'fixture failure' }),
    });
    await failed.runItem(failed.claim()!);
    const quote = instance.services.retryQuote(actor, wid, job.id);
    const retry = instance.services.submit(actor, wid, job.input, quote.id, randomUUID());
    await failed.runItem(failed.claim()!);
    const retryQuote = instance.services.retryQuote(actor, wid, retry.id);
    const descendant = instance.services.submit(
      actor,
      wid,
      retry.input,
      retryQuote.id,
      randomUUID(),
    );
    expect(descendant.items[0]).toMatchObject({
      retryRootItemId: job.items[0]!.id,
      retrySourceItemId: retry.items[0]!.id,
    });
    expect(() => instance.services.retryQuote(actor, wid, job.id)).toThrow();
    expect(instance.services.balance(actor, wid).reserved).toBe(8);
  });

  it('rejects remote upscale results that cannot be imported before reserving credits', async () => {
    const image = await asset();
    instance.services.db.sqlite
      .prepare('UPDATE assets SET width=4000,height=4000 WHERE id=?')
      .run(image.id);
    expect(() =>
      instance.services.quote(
        actor,
        wid,
        input({
          operation: 'image-upscale',
          providerId: 'fal',
          assetIds: [image.id],
          options: { model: 'aura-sr', scale: 4 },
        }),
      ),
    ).toThrow(/像素|尺寸/);
    expect(instance.services.list(actor, wid).total).toBe(0);
    expect(instance.services.balance(actor, wid).reserved).toBe(0);
  });

  it('quotes and freezes every source/product combination with no silently discarded reference', async () => {
    instance.services.config.publicOrigin = 'https://studio.example.test';
    const images = await Promise.all(
      ['source-a', 'source-b', 'product-a', 'product-b'].map((name) => asset(`${name}.png`)),
    );
    const value = input({
      operation: 'product-replace',
      providerId: 'flyelep',
      assetIds: images.slice(0, 2).map((a) => a.id),
      referenceAssetIds: images.slice(2).map((a) => a.id),
      options: { model: '9' },
    });
    const quote = instance.services.quote(actor, wid, value);
    expect(quote.units).toBe(4);
    expect(quote.items?.map((item) => [item.assetIds[0], item.referenceAssetIds[0]])).toEqual(
      images
        .slice(0, 2)
        .flatMap((source) => images.slice(2).map((product) => [source.id, product.id])),
    );
    const job = instance.services.submit(actor, wid, value, quote.id, randomUUID());
    expect(job.items).toHaveLength(4);
    expect(
      job.items.map((item) => [item.sourceAssetIds?.[0], item.referenceAssetIds?.[0]]),
    ).toEqual(quote.items?.map((item) => [item.assetIds[0], item.referenceAssetIds[0]]));
    expect(job.requestedCredits).toBe(32);
  });

  it('deduplicates normalized colors before quotation and rejects replacement without a product or description', async () => {
    const image = await asset();
    const value = input({
      operation: 'product-recolor',
      assetIds: [image.id],
      options: { colors: [' #FFFFFF ', '#ffffff', '#fff'] },
    });
    const quote = instance.services.quote(actor, wid, value);
    expect(quote.units).toBe(1);
    const job = instance.services.submit(actor, wid, value, quote.id, randomUUID());
    expect(job.items).toHaveLength(1);
    expect(() =>
      instance.services.quote(
        actor,
        wid,
        input({ operation: 'product-replace', assetIds: [image.id], prompt: '' }),
      ),
    ).toThrow();
  });
});

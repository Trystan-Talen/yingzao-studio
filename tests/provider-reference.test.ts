/** Official schema fixtures and local SQLite integration, never paid inference or quality claims. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import type { Actor } from '../src/contracts/core';
import {
  buildFalReferenceRequest,
  FAL_REFERENCE_ENDPOINTS,
  FAL_REFERENCE_MODELS,
  validateFalReferenceInput,
  type FalReferenceAsset,
  type FalReferenceModel,
} from '../src/server/providers/fal-reference';
import { falProvider } from '../src/server/providers/fal';
import { providerJson } from '../src/server/providers/http';
import type { ExecutionContext, RemoteTask } from '../src/server/tasks/types';
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
vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const http = vi.mocked(providerJson);
const ids = Array.from({ length: 9 }, () => randomUUID());
const actor: Actor = {
  userId: randomUUID(),
  authType: 'session',
  apiKeyId: null,
  workspaceId: null,
  scopes: [],
};
function input(
  model: FalReferenceModel = 'kling-o1-reference',
  changes: Partial<JobInput> = {},
  options: Record<string, unknown> = {},
): JobInput {
  const capability = FAL_REFERENCE_MODELS.find((m) => m.id === model)!;
  return jobInputSchema.parse({
    operation: 'video.generate',
    providerId: 'fal',
    prompt: 'A gentle orbit around the product.',
    assetIds: model === 'kling-o1-first-last' ? ids.slice(0, 2) : [ids[0]],
    ...changes,
    options: {
      model,
      ratio: capability.ratios[0],
      resolution: capability.resolutions[0],
      duration: 5,
      referenceMode: model === 'kling-o1-first-last' ? 'first-last' : 'all',
      ...options,
    },
  });
}
async function png(color = '#246fff', width = 320, height = 320) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}
async function context(
  i: JobInput,
  files?: Map<string, { buffer: Buffer; mimeType: string; name: string }>,
): Promise<ExecutionContext> {
  const image = await png();
  return {
    actor,
    workspaceId: randomUUID(),
    input: i,
    readAsset: async (id) =>
      files?.get(id) || { buffer: image, mimeType: 'image/png', name: 'reference.png' },
  };
}
function imageAsset(id = ids[0]!, change: Partial<FalReferenceAsset> = {}): FalReferenceAsset {
  return {
    id,
    kind: 'image',
    mimeType: 'image/png',
    width: 320,
    height: 320,
    byteSize: 1000,
    ...change,
  };
}
function remote(): RemoteTask {
  return {
    id: 'fixture',
    endpoint: FAL_REFERENCE_ENDPOINTS['kling-o1-reference'],
    statusUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/fixture/status',
    responseUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/fixture',
    cancelUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/fixture/cancel',
  };
}
beforeEach(() => vi.clearAllMocks());
describe('official Kling reference protocols', () => {
  it('three model payloads contain only official OpenAPI fields and all required fields', async () => {
    for (const model of Object.keys(FAL_REFERENCE_ENDPOINTS) as FalReferenceModel[]) {
      const { endpoint, body } = await buildFalReferenceRequest(await context(input(model)));
      const doc = JSON.parse(
        readFileSync(
          resolve('../research/fal-reference-schemas', endpoint.replaceAll('/', '--') + '.json'),
          'utf8',
        ),
      ) as {
        components: {
          schemas: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
        };
      };
      const definition = Object.entries(doc.components.schemas).find(
        ([name, value]) => name.endsWith('Input') && value.properties?.prompt,
      )?.[1];
      expect(definition).toBeDefined();
      for (const key of Object.keys(body)) expect(definition!.properties).toHaveProperty(key);
      for (const key of definition!.required || []) expect(body).toHaveProperty(key);
      expect(body).toMatchObject({ duration: '5', enable_safety_checker: true });
      expect(body).not.toHaveProperty('resolution');
    }
  });
  it('preserves exact first/end byte order and does not invent aspect ratio for O1 image-to-video', async () => {
    const first = await png('red'),
      last = await png('blue');
    const files = new Map([
      [ids[0]!, { buffer: first, mimeType: 'image/png', name: 'first' }],
      [ids[1]!, { buffer: last, mimeType: 'image/png', name: 'last' }],
    ]);
    const { body } = await buildFalReferenceRequest(
      await context(input('kling-o1-first-last'), files),
    );
    expect(body.start_image_url).toBe(`data:image/png;base64,${first.toString('base64')}`);
    expect(body.end_image_url).toBe(`data:image/png;base64,${last.toString('base64')}`);
    expect(body.prompt).toContain('@Image2');
    expect(body).not.toHaveProperty('aspect_ratio');
    expect(body).not.toHaveProperty('image_urls');
  });
  it('allows the same original to anchor both ends and reads it once', async () => {
    const ctx = await context(input('kling-o1-first-last', { assetIds: [ids[0]!, ids[0]!] }));
    ctx.readAsset = vi.fn(ctx.readAsset);
    const { body } = await buildFalReferenceRequest(ctx);
    expect(body.start_image_url).toBe(body.end_image_url);
    expect(ctx.readAsset).toHaveBeenCalledTimes(1);
  });
  it('separates O3 frame constraints, image references and one video element', async () => {
    const source = Buffer.from('fixture-video-only-no-inference');
    const files = new Map([
      [ids[3]!, { buffer: source, mimeType: 'video/mp4', name: 'reference.mp4' }],
    ]);
    const probe = vi.fn(async () => ({ width: 1280, height: 720, duration: 5, fps: 30 }));
    const i = input(
      'kling-o3-4k-reference',
      { assetIds: ids.slice(0, 2), referenceAssetIds: ids.slice(2, 4) },
      { referenceMode: 'first-last', duration: 15 },
    );
    const { body } = await buildFalReferenceRequest(await context(i, files), probe);
    expect(body).toMatchObject({
      duration: '15',
      generate_audio: false,
      aspect_ratio: '16:9',
      elements: [{ video_url: `data:video/mp4;base64,${source.toString('base64')}` }],
    });
    expect(body.image_urls).toHaveLength(1);
    expect(body.start_image_url).toBeTruthy();
    expect(body.end_image_url).toBeTruthy();
    expect(body.prompt).toContain('@Image1');
    expect(body.prompt).toContain('@Element1');
    expect(probe).toHaveBeenCalledExactlyOnceWith(source);
  });
  it('refuses corrupt originals and invalid actual video fps before network submission', async () => {
    const files = new Map([
      [ids[0]!, { buffer: Buffer.from('not a video'), mimeType: 'video/mp4', name: 'broken.mp4' }],
    ]);
    await expect(
      buildFalReferenceRequest(await context(input('kling-o3-4k-reference'), files)),
    ).rejects.toThrow();
    await expect(
      buildFalReferenceRequest(await context(input('kling-o3-4k-reference'), files), async () => ({
        width: 1280,
        height: 720,
        duration: 5,
        fps: 12,
      })),
    ).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });
  it('rejects impossible modes, counts, ignored document/mask inputs, long prompts and unknown options', () => {
    const bad: JobInput[] = [
      input('kling-o1-first-last', { assetIds: [ids[0]!] }),
      input('kling-o1-first-last', {}, { referenceMode: 'all' }),
      input('kling-o1-first-last', { referenceAssetIds: [ids[2]!] }),
      input('kling-o1-reference', {}, { referenceMode: 'first-last' }),
      input('kling-o1-reference', { assetIds: [] }),
      input('kling-o1-reference', { assetIds: ids.slice(0, 8) }),
      input('kling-o1-reference', { maskAssetId: ids[1] }),
      input('kling-o1-reference', { referenceText: 'fact' }),
      input('kling-o1-reference', { prompt: 'x'.repeat(2101) }),
      input('kling-o1-reference', {}, { duration: 11 }),
      input('kling-o1-first-last', {}, { ratio: '16:9' }),
      input('kling-o3-4k-reference', {}, { resolution: '1080p' }),
    ];
    for (const i of bad) expect(() => validateFalReferenceInput(i)).toThrow();
  });
  it('validates quote metadata dimensions, bytes, mime and authorization, including nonfinite values', () => {
    for (const change of [
      { width: 299 },
      { height: 299 },
      { width: 1000 },
      { mimeType: 'image/gif' },
      { byteSize: 50 * 1024 * 1024 + 1 },
      { byteSize: -1 },
      { width: Infinity },
      { byteSize: NaN },
      { kind: 'document' },
    ])
      expect(() => validateFalReferenceInput(input(), [imageAsset(ids[0], change)])).toThrow();
    expect(() => validateFalReferenceInput(input(), [])).toThrow('未获授权');
    expect(() => validateFalReferenceInput(input(), [imageAsset()])).not.toThrow();
  });
  it('permits at most one properly sized O3 video and rejects video in O1 and first/end frames', () => {
    const video = imageAsset(ids[0], {
      kind: 'video',
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      durationMs: 5000,
    });
    expect(() => validateFalReferenceInput(input('kling-o3-4k-reference'), [video])).not.toThrow();
    expect(() => validateFalReferenceInput(input('kling-o1-reference'), [video])).toThrow(
      '仅Kling',
    );
    expect(() =>
      validateFalReferenceInput(input('kling-o3-4k-reference', { assetIds: [ids[0]!, ids[1]!] }), [
        video,
        { ...video, id: ids[1]! },
      ]),
    ).toThrow('最多一个');
    expect(() =>
      validateFalReferenceInput(
        input(
          'kling-o3-4k-reference',
          { assetIds: [ids[0]!, ids[1]!] },
          { referenceMode: 'first-last' },
        ),
        [video, imageAsset(ids[1])],
      ),
    ).toThrow('参考图');
    for (const change of [
      { durationMs: 2999 },
      { durationMs: 10051 },
      { width: 719 },
      { height: 2161 },
      { byteSize: 200 * 1024 * 1024 + 1 },
      { mimeType: 'video/webm' },
      { durationMs: NaN },
    ])
      expect(() =>
        validateFalReferenceInput(input('kling-o3-4k-reference'), [{ ...video, ...change }]),
      ).toThrow();
  });
  it('rejects actual images smaller than claimed quote metadata before submission', async () => {
    const files = new Map([
      [ids[0]!, { buffer: await png('red', 299, 320), mimeType: 'image/png', name: 'small.png' }],
    ]);
    await expect(falProvider.execute(await context(input(), files), 'fixture-key')).rejects.toThrow(
      '至少300',
    );
    expect(http).not.toHaveBeenCalled();
  });
  it('dispatches to documented queue endpoint and persists route for polling and cancellation', async () => {
    const r = remote();
    http.mockResolvedValueOnce({
      request_id: r.id,
      status_url: r.statusUrl,
      response_url: r.responseUrl,
      cancel_url: r.cancelUrl,
    });
    const result = await falProvider.execute(await context(input()), 'fixture-NOT-A-KEY');
    expect(result).toMatchObject({
      state: 'submitted',
      remote: { endpoint: FAL_REFERENCE_ENDPOINTS['kling-o1-reference'] },
    });
    expect(http.mock.calls[0]?.[0]).toBe(`https://queue.fal.run/${r.endpoint}`);
    expect(http.mock.calls[0]?.[1]).toMatchObject({
      submission: true,
      headers: { 'X-Fal-No-Retry': '1' },
    });
    http.mockResolvedValueOnce({ status: 'IN_PROGRESS' });
    expect(await falProvider.poll!(r, 'fixture')).toMatchObject({ state: 'running' });
    http.mockResolvedValueOnce({ status: 'COMPLETED' }).mockResolvedValueOnce({
      video: { url: 'https://example.invalid/fixture.mp4', content_type: null },
    });
    expect(await falProvider.poll!(r, 'fixture')).toMatchObject({
      state: 'complete',
      outputs: [{ mimeType: 'video/mp4' }],
    });
    http.mockResolvedValueOnce({});
    await falProvider.cancel!(r, 'fixture');
    expect(http.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'PUT' });
  });
  it('treats malformed submission and untrusted queue URLs as ambiguous and never follows them', async () => {
    http.mockResolvedValueOnce({ request_id: 'broken' });
    await expect(falProvider.execute(await context(input()), 'fixture')).rejects.toMatchObject({
      ambiguous: true,
    });
    http.mockResolvedValueOnce({
      request_id: 'bad',
      status_url: 'https://queue.fal.run@evil.invalid/status',
      response_url: remote().responseUrl,
    });
    await expect(falProvider.execute(await context(input()), 'fixture')).rejects.toMatchObject({
      ambiguous: true,
    });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('keeps WAN text/single-image routes and refuses silently dropped references even if invoked directly', async () => {
    const wan = jobInputSchema.parse({
      operation: 'video.generate',
      providerId: 'fal',
      prompt: 'A cloud',
      options: { model: 'wan-2.6', duration: 5, resolution: '720p', ratio: '16:9' },
    });
    const r = remote();
    http.mockResolvedValueOnce({
      request_id: r.id,
      status_url: r.statusUrl,
      response_url: r.responseUrl,
    });
    await falProvider.execute(await context(wan), 'fixture');
    expect(http.mock.calls[0]?.[0]).toBe('https://queue.fal.run/wan/v2.6/text-to-video');
    await expect(
      falProvider.execute(await context({ ...wan, referenceAssetIds: [ids[0]!] }), 'fixture'),
    ).rejects.toThrow('一张首帧');
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe('reference quotes with actual SQLite, assets and budget', () => {
  let temp: string,
    db: DatabaseContext,
    core: CoreServices,
    tasks: TaskServices,
    who: Actor,
    wid: string,
    assetId: string;
  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), 'yingzao-reference-'));
    db = createDatabaseContext(join(temp, 'db.sqlite'));
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    const config: AppConfig = {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5173',
      databasePath: join(temp, 'db.sqlite'),
      storageDir: join(temp, 'media'),
      sessionSecret: 'fixture',
      encryptionKey: 'fixture',
      isProduction: false,
      demoMode: false,
      environmentSecrets: { fal: 'fixture-NOT-A-REAL-KEY' },
    };
    const credits = createCreditService(db);
    core = createCoreServices(db, config, {
      onWorkspaceCreated: (w, u) => credits.initialize(w, u, 500),
    });
    tasks = createTaskServices(db, core, config);
    const registered = await core.auth.register({
      email: 'ref@example.local',
      password: 'FixturePassword2026!',
      displayName: 'Reference fixture',
    });
    who = { ...actor, userId: registered.user.id };
    wid = registered.workspace.id;
    assetId = (
      await core.assets.ingest(who, wid, {
        buffer: await png(),
        mimeType: 'image/png',
        name: 'reference.png',
      })
    ).id;
  });
  afterEach(async () => {
    closeDatabase(db);
    await rm(temp, { recursive: true, force: true });
  });
  it('advertises all new models, removes fake local AI fusion, and quotes requested seconds', () => {
    const capabilities = tasks.settings.capabilities(wid);
    expect(
      capabilities.operations
        .find((c) => c.id === 'video.generate' && c.providerId === 'fal')
        ?.models.map((m) => m.id),
    ).toEqual(['wan-2.6', ...Object.keys(FAL_REFERENCE_ENDPOINTS)]);
    expect(
      capabilities.operations.some((c) => c.id === 'image-fusion' && c.providerId === 'local'),
    ).toBe(false);
    const i = input(
      'kling-o1-first-last',
      { assetIds: [assetId, assetId] },
      { duration: 8, count: 2 },
    );
    const q = tasks.quote(who, wid, i);
    expect(q).toMatchObject({ units: 16, maxCredits: 80 });
    expect(tasks.balance(who, wid).reserved).toBe(0);
    const job = tasks.submit(who, wid, i, q.id, randomUUID());
    expect(job.items).toHaveLength(2);
    expect(tasks.balance(who, wid).reserved).toBe(80);
    expect(http).not.toHaveBeenCalled();
  });
  it('rejects unsupported and unauthorized inputs before creating quotes or reservations', () => {
    for (const i of [
      input('kling-o1-first-last', { assetIds: [assetId] }),
      input('kling-o1-reference', { assetIds: [randomUUID()] }),
      input('kling-o1-reference', { assetIds: [assetId] }, { duration: 11 }),
    ])
      expect(() => tasks.quote(who, wid, i)).toThrow();
    expect(db.sqlite.prepare('SELECT count(*) n FROM quotes').get()).toEqual({ n: 0 });
    expect(tasks.balance(who, wid).reserved).toBe(0);
    expect(http).not.toHaveBeenCalled();
  });
  it('revalidates frozen brand references so O1 first/end cannot silently ignore brand images', () => {
    const brand = core.references.createBrand(who, wid, {
      name: 'Fixture',
      referenceAssetIds: [assetId],
    });
    expect(() =>
      tasks.quote(
        who,
        wid,
        input('kling-o1-first-last', { assetIds: [assetId, assetId], brandId: brand.id }),
      ),
    ).toThrow('额外品牌');
    expect(db.sqlite.prepare('SELECT count(*) n FROM quotes').get()).toEqual({ n: 0 });
    expect(tasks.balance(who, wid).reserved).toBe(0);
  });
  it('accepts brand refs in O3 frame mode, freezes them and rejects subsequent source revocation on submit', () => {
    const brand = core.references.createBrand(who, wid, {
      name: 'Fixture',
      description: 'Blue palette',
      referenceAssetIds: [assetId],
    });
    const i = input(
      'kling-o3-4k-reference',
      { assetIds: [assetId, assetId], brandId: brand.id },
      { referenceMode: 'first-last' },
    );
    const q = tasks.quote(who, wid, i);
    const row = db.sqlite.prepare('SELECT items_json FROM quotes WHERE id=?').get(q.id) as {
      items_json: string;
    };
    const frozen = JSON.parse(row.items_json) as JobInput[];
    expect(frozen[0]?.referenceAssetIds).toEqual([assetId]);
    expect(frozen[0]?.prompt).toContain('Blue palette');
    core.assets.remove(who, wid, assetId);
    expect(() => tasks.submit(who, wid, i, q.id, randomUUID())).toThrow();
    expect(tasks.balance(who, wid).reserved).toBe(0);
  });
});

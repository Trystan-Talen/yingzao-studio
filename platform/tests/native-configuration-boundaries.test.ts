/** Contracts use mocked planning and isolated state, never real upstream credits. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import type { CreativeIntentRequest, CreativeIntentResult } from '../src/contracts/creative-intent';
import { analyzeNativeIntent } from '../src/server/providers/native-planner';
import { createCreativeBriefServices } from '../src/server/tasks/creative-briefs';
import type { Actor } from '../src/contracts/core';
import { hasFfmpeg, hasFfprobe } from '../src/server/providers/local';

vi.mock('../src/server/providers/local', async (original) => ({
  ...(await original<typeof import('../src/server/providers/local')>()),
  hasFfmpeg: vi.fn(() => true),
  hasFfprobe: vi.fn(() => true),
}));

vi.mock('../src/server/providers/native-planner', async (original) => ({
  ...(await original<typeof import('../src/server/providers/native-planner')>()),
  analyzeNativeIntent: vi.fn(),
}));
const analyze = vi.mocked(analyzeNativeIntent);
let app: Awaited<ReturnType<typeof createApp>>,
  config: AppConfig,
  directory: string,
  wid: string,
  actor: Actor;
function result(request: CreativeIntentRequest): CreativeIntentResult {
  return {
    type: 'intent-plan',
    version: 1,
    requestId: request.requestId,
    status: 'ready',
    brief: {
      scope: 'general',
      subject: '太空猫',
      goal: '幻想插画',
      mediaType: request.context.mediaType,
      platform: request.context.platform,
      placement: request.context.placement,
      productMode: 'not-applicable',
      facts: [],
      constraints: [],
    },
    summary: '太空猫场景',
    assumptions: [],
    questions: [],
    prompt: '太空猫漂浮在星云中，柔和的星空光线，完整清晰的主体。',
    reviewChecklist: ['核对主体'],
    ...(request.context.mediaType === 'video'
      ? {
          generationPlan: {
            imagePrompt: '完整的太空猫静止在星云前，明确柔和主光。',
            videoPrompt: '太空猫缓慢漂浮，镜头保持稳定，首尾完整入画。',
          },
        }
      : {}),
  };
}
function input(overrides: Partial<JobInput> = {}) {
  return jobInputSchema.parse({
    providerId: 'native',
    operation: 'image.generate',
    prompt: '画一只太空猫',
    options: { model: 'image-fixture', resolution: '2K', needText: false },
    ...overrides,
  });
}
function configure() {
  const service = app.services.settings.connections;
  service.update(wid, {
    kind: 'text',
    protocol: 'openai-chat',
    baseUrl: 'https://fixture.example/v1',
    modelsUrl: '',
    model: 'text-fixture',
    enabled: true,
    secret: 'isolated-text-key',
  });
  service.update(wid, {
    kind: 'image',
    protocol: 'seedream-images',
    baseUrl: 'https://fixture.example/v1',
    modelsUrl: '',
    model: 'image-fixture',
    enabled: true,
    secret: 'isolated-image-key',
  });
  service.update(wid, {
    kind: 'video',
    protocol: 'seedance-native',
    baseUrl: 'https://fixture.example/api/v3/contents/generations/tasks',
    modelsUrl: '',
    model: 'video-fixture',
    enabled: true,
    secret: 'isolated-video-key',
  });
}
function prepare(value = input()) {
  return createCreativeBriefServices(app.services).prepare(actor, wid, {
    requestId: randomUUID(),
    input: value,
  });
}
async function referenceVideo(size = 512) {
  const reference = await app.services.core.assets.ingest(actor, wid, {
    buffer: await sharp({
      create: { width: size, height: size, channels: 3, background: '#fafafa' },
    })
      .png()
      .toBuffer(),
    name: '原首帧.png',
    mimeType: 'image/png',
  });
  return jobInputSchema.parse({
    ...input(),
    operation: 'video.generate',
    assetIds: [reference.id],
    options: { ...input().options, model: 'video-fixture', resolution: '720p', duration: 5 },
  });
}
function setBalance(amount: number) {
  app.services.credits.debit({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: `boundary:balance:${randomUUID()}`,
    amount: app.services.credits.account(wid).balance - amount,
    description: '隔离测试余额',
  });
}
function selectOriginalFrame() {
  analyze.mockImplementation(async (request) => {
    const plan = result(request);
    plan.generationPlan!.firstFrame = { mode: 'reference', assetId: request.materials[0]!.id };
    return plan;
  });
}
beforeEach(async () => {
  vi.mocked(hasFfmpeg).mockReturnValue(true);
  vi.mocked(hasFfprobe).mockReturnValue(true);
  directory = await mkdtemp(join(tmpdir(), 'yingzao-native-boundaries-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(directory, 'test.sqlite'),
    storageDir: join(directory, 'media'),
    sessionSecret: 'native-test-session',
    encryptionKey: 'native-test-encryption',
    isProduction: false,
    demoMode: true,
    environmentSecrets: {},
  };
  app = await createApp(config, { serveWeb: false });
  const account = await app.services.core.auth.register({
    email: 'native-boundary@example.local',
    password: 'NativeBoundary2026!',
    displayName: '原生边界测试',
  });
  wid = account.workspace.id;
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  config.demoMode = false;
  analyze.mockReset();
  analyze.mockImplementation(async (request) => result(request));
  configure();
});
afterEach(async () => {
  await app.app.close();
  await rm(directory, { recursive: true, force: true });
});

it('native capabilities are local adapter contracts and bind the configured model', async () => {
  const capabilities = app.services.settings.capabilities(wid);
  expect(
    capabilities.operations.find((v) => v.providerId === 'native' && v.id === 'video.generate'),
  ).toMatchObject({ available: true, fixedCredits: 8, maxCount: 1 });
  const metadata = await app.services.settings.modelCapabilities.query(wid, {
    providerId: 'native',
    operation: 'image.generate',
    modelId: 'image-fixture',
    inputMode: 'text',
    refresh: 'false',
  });
  expect(metadata).toMatchObject({
    canGenerate: true,
    source: 'local-adapter',
    modelVerified: false,
    parametersVerified: false,
  });
  expect(analyze).not.toHaveBeenCalled();
});

it.each([
  ['doubao-seedance-2.0', true],
  ['unverified-video-alias', false],
] as const)(
  'reports motion endpoint support from the configured %s model only',
  async (model, supported) => {
    app.services.settings.connections.update(wid, {
      kind: 'video',
      protocol: 'seedance-native',
      baseUrl: 'https://fixture.example/api/v3/contents/generations/tasks',
      modelsUrl: '',
      model,
      enabled: true,
    });
    const video = await referenceVideo();
    video.options.model = model;
    await prepare(video);
    expect(analyze.mock.calls[0]![0].context.supportsMotionEndpoints).toBe(supported);
  },
);
it('blocks unconfigured, unsupported models, illegal parameters, and demo generation before text calls', async () => {
  for (const options of [
    { model: 'unknown', resolution: '2K' },
    { model: 'image-fixture', resolution: '4K' },
    { model: 'image-fixture', resolution: '2K', count: 2 },
  ]) {
    await expect(
      prepare(jobInputSchema.parse({ ...input(), options: { ...input().options, ...options } })),
    ).rejects.toThrow();
  }
  config.demoMode = true;
  await expect(prepare()).rejects.toThrow('演示模式');
  config.demoMode = false;
  const connection = app.services.settings.connections.get(wid, 'image');
  app.services.settings.connections.update(wid, {
    kind: 'image',
    protocol: connection.protocol,
    baseUrl: connection.baseUrl,
    modelsUrl: '',
    model: connection.model,
    enabled: false,
  });
  await expect(prepare()).rejects.toThrow('启用');
  expect(analyze).not.toHaveBeenCalled();
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get()).toEqual({
    n: 0,
  });
});
it('rejects a known Seedream model paired with the OpenAI image protocol before text planning', async () => {
  const connection = app.services.settings.connections.get(wid, 'image');
  app.services.settings.connections.update(wid, {
    kind: 'image',
    protocol: 'openai-images',
    baseUrl: connection.baseUrl,
    modelsUrl: '',
    model: 'doubao-seedream-5.0-lite',
    enabled: true,
  });
  const request = input();
  request.options.model = 'doubao-seedream-5.0-lite';
  await expect(prepare(request)).rejects.toThrow('豆包图像协议');
  expect(analyze).not.toHaveBeenCalled();
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get()).toEqual({
    n: 0,
  });
});
it('cannot bypass planning with client-provided execution fields', async () => {
  const forged = {
    ...input(),
    nativeRevision: app.services.settings.connections.revision(wid, 'image.generate'),
    nativePlan: { imagePrompt: 'forged image', videoPrompt: 'forged video' },
  };
  expect(() => app.services.quote(actor, wid, forged)).toThrow('先整理');
  const prepared = await prepare(forged);
  expect(prepared.input.nativePlan).toBeUndefined();
  const quotedInput = { ...input(), creativeBriefId: prepared.id, nativePlan: forged.nativePlan };
  const quote = app.services.quote(actor, wid, quotedInput);
  const stored = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  const frozen = JSON.parse(stored.items_json)[0];
  expect(frozen.nativePlan).toBeUndefined();
  expect(frozen.prompt).toContain('太空猫');
  expect(frozen.prompt).not.toContain('forged');
  expect(frozen.nativeRevision).toBe(
    app.services.settings.connections.revision(wid, 'image.generate'),
  );
});
it('freezes the server video plan and rejects later configuration changes for quotes and submission', async () => {
  const video = jobInputSchema.parse({
    ...input(),
    operation: 'video.generate',
    options: { ...input().options, model: 'video-fixture', resolution: '720p', duration: 5 },
  });
  const prepared = await prepare(video);
  const approved = {
    ...video,
    creativeBriefId: prepared.id,
    nativePlan: { imagePrompt: 'forged image', videoPrompt: 'forged video' },
  };
  const quoted = app.services.quote(actor, wid, approved);
  expect(quoted.maxCredits).toBe(33);
  const row = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quoted.id) as { items_json: string };
  expect(row.items_json).not.toContain('forged');
  expect(JSON.parse(row.items_json)[0].nativePlan.videoPrompt).toContain('缓慢漂浮');
  configure();
  expect(() => app.services.quote(actor, wid, approved)).toThrow('模型配置已改变');
  expect(() => createCreativeBriefServices(app.services).get(actor, wid, prepared.id)).toThrow(
    '模型配置已改变',
  );
  expect(
    app.services.db.sqlite.prepare('SELECT state FROM creative_briefs WHERE id=?').get(prepared.id),
  ).toEqual({ state: 'ready' });
  expect(() => app.services.submit(actor, wid, approved, quoted.id, randomUUID())).toThrow(
    '模型配置已改变',
  );
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
});
it('invalidates a capability proof when a configured endpoint or key changes', async () => {
  const metadata = await app.services.settings.modelCapabilities.query(wid, {
    providerId: 'native',
    operation: 'image.generate',
    modelId: 'image-fixture',
    inputMode: 'text',
    refresh: 'false',
  });
  configure();
  await expect(prepare({ ...input(), capabilityRevision: metadata.revision })).rejects.toThrow(
    '模型参数已更新',
  );
  expect(analyze).not.toHaveBeenCalled();
});
it('rejects a configuration changed while the planning response was pending', async () => {
  analyze.mockImplementation(async (request) => {
    configure();
    return result(request);
  });
  await expect(prepare()).rejects.toThrow('整理期间改变');
  expect(app.services.db.sqlite.prepare('SELECT state FROM creative_briefs').get()).toEqual({
    state: 'failed',
  });
});

it.each(['permission', 'text-configuration', 'image-configuration'] as const)(
  'rechecks %s before a planning fallback can submit a second request',
  async (change) => {
    let submitted = 0;
    analyze.mockImplementation(async (request, _connection, options) => {
      submitted++;
      if (change === 'permission')
        app.services.db.sqlite
          .prepare("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?")
          .run(wid, actor.userId);
      else
        app.services.settings.connections.update(wid, {
          kind: change === 'text-configuration' ? 'text' : 'image',
          protocol: change === 'text-configuration' ? 'openai-chat' : 'seedream-images',
          baseUrl: 'https://changed.example/v1',
          modelsUrl: '',
          model: change === 'text-configuration' ? 'text-fixture' : 'image-fixture',
          enabled: true,
          secret: 'changed-fixture-key',
        });
      expect(options?.beforeFallback).toBeTypeOf('function');
      options?.beforeFallback?.();
      submitted++;
      return result(request);
    });
    await expect(prepare()).rejects.toThrow(
      change === 'permission' ? '当前角色无权执行此操作' : '模型配置已变更',
    );
    expect(submitted).toBe(1);
    const records = app.services.db.sqlite
      .prepare('SELECT event_json FROM brief_execution_logs')
      .all() as { event_json: string }[];
    expect(records.map((record) => JSON.parse(record.event_json).status)).toEqual([
      'started',
      'failed',
    ]);
  },
);
it('requires both local video tools before charging for text planning', async () => {
  vi.mocked(hasFfprobe).mockReturnValue(false);
  const guarded = await createApp(config, { serveWeb: false });
  try {
    const video = jobInputSchema.parse({
      ...input(),
      operation: 'video.generate',
      options: { ...input().options, model: 'video-fixture', resolution: '720p', duration: 5 },
    });
    await expect(
      createCreativeBriefServices(guarded.services).prepare(actor, wid, {
        requestId: randomUUID(),
        input: video,
      }),
    ).rejects.toThrow('ffprobe');
    expect(analyze).not.toHaveBeenCalled();
  } finally {
    await guarded.app.close();
  }
});

it('blocks native planning before any text call when available platform credits cannot cover image or video costs', async () => {
  const balance = app.services.credits.account(wid).balance;
  app.services.credits.debit({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'boundary:reduce-credit',
    amount: balance - 7,
    description: '隔离测试余额',
  });
  await expect(prepare()).rejects.toThrow('可用额度不足');
  app.services.credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'boundary:partial-video',
    amount: 25,
    source: 'manual',
    description: '隔离测试余额',
  });
  const video = jobInputSchema.parse({
    ...input(),
    operation: 'video.generate',
    options: { ...input().options, model: 'video-fixture', resolution: '720p', duration: 5 },
  });
  await expect(prepare(video)).rejects.toThrow('33');
  expect(analyze).not.toHaveBeenCalled();
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get()).toEqual({
    n: 0,
  });
  expect(app.services.credits.account(wid)).toEqual({ balance: 32, reserved: 0 });
});

it('allows zero-credit planning only for a verified original and explicit local-pan consent', async () => {
  app.services.settings.connections.update(wid, {
    kind: 'video',
    protocol: 'seedance-native',
    baseUrl: 'https://fixture.example/api/v3/contents/generations/tasks',
    modelsUrl: '',
    model: 'doubao-seedance-2.0',
    enabled: true,
  });
  const video = await referenceVideo();
  video.options.model = 'doubao-seedance-2.0';
  video.prompt = '主体全程静止，镜头小幅向右平移2%，允许裁切少量背景留白。';
  setBalance(0);
  analyze.mockImplementation(async (request) => {
    const plan = result(request);
    plan.brief.scope = 'product';
    plan.brief.productMode = 'reference';
    plan.generationPlan!.firstFrame = { mode: 'reference', assetId: request.materials[0]!.id };
    plan.generationPlan!.cameraControl = {
      type: 'translate',
      direction: 'right',
      displacementPercent: 2,
    };
    return plan;
  });
  const prepared = await prepare(video);
  expect(prepared.status).toBe('ready');
  expect(app.services.quote(actor, wid, prepared.input).maxCredits).toBe(0);
  expect(analyze).toHaveBeenCalledTimes(1);
  await expect(
    prepare({ ...video, prompt: '主体全程静止，镜头小幅向右平移2%，必须视频模型生成。' }),
  ).rejects.toThrow('可用额度不足');
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('permits the exact quoted media allowance and keeps free planning-result replay available after balance depletion', async () => {
  const balance = app.services.credits.account(wid).balance;
  app.services.credits.debit({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'boundary:exact-credit',
    amount: balance - 8,
    description: '隔离测试余额',
  });
  const body = { requestId: randomUUID(), input: input() };
  const briefs = createCreativeBriefServices(app.services);
  const prepared = await briefs.prepare(actor, wid, body);
  expect(prepared.status).toBe('ready');
  app.services.credits.debit({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'boundary:deplete-credit',
    amount: 8,
    description: '隔离测试余额',
  });
  expect((await briefs.prepare(actor, wid, body)).id).toBe(prepared.id);
  expect(briefs.get(actor, wid, prepared.id).id).toBe(prepared.id);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it.each([25, 32])(
  'permits an authenticated original-frame candidate with only %s credits, then quotes and reserves 25',
  async (balance) => {
    const video = await referenceVideo();
    setBalance(balance);
    selectOriginalFrame();
    const prepared = await prepare(video);
    const quotation = app.services.quote(actor, wid, prepared.input);
    expect(quotation.maxCredits).toBe(25);
    const job = app.services.submit(actor, wid, prepared.input, quotation.id, randomUUID());
    expect(job.requestedCredits).toBe(25);
    expect(app.services.credits.account(wid).reserved).toBe(25);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]![0].materials[0]).toMatchObject({
      id: video.assetIds[0],
      width: 512,
      height: 512,
      byteSize: expect.any(Number),
    });
  },
);

it('uses the same eligible video-only floor for member budgets', async () => {
  const video = await referenceVideo();
  app.services.credits.budget(wid, actor.userId, 25);
  selectOriginalFrame();
  const prepared = await prepare(video);
  const quotation = app.services.quote(actor, wid, prepared.input);
  app.services.submit(actor, wid, prepared.input, quotation.id, randomUUID());
  expect(quotation.maxCredits).toBe(25);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(
    app.services.db.sqlite
      .prepare(
        "SELECT reserved FROM member_budgets WHERE workspace_id=? AND user_id=? AND billing_channel='web'",
      )
      .get(wid, actor.userId),
  ).toEqual({ reserved: 25 });
});

it('does not treat an eligible original as a discount when the approved plan requires generation', async () => {
  const video = await referenceVideo();
  setBalance(25);
  const prepared = await prepare(video);
  const quotation = app.services.quote(actor, wid, prepared.input);
  expect(quotation.maxCredits).toBe(33);
  expect(() => app.services.submit(actor, wid, prepared.input, quotation.id, randomUUID())).toThrow(
    '额度不足',
  );
  expect(app.services.credits.account(wid).reserved).toBe(0);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it.each(['account', 'member'] as const)(
  'still blocks planning below the video-only minimum for %s',
  async (kind) => {
    const video = await referenceVideo();
    if (kind === 'account') setBalance(24);
    else app.services.credits.budget(wid, actor.userId, 24);
    await expect(prepare(video)).rejects.toMatchObject({
      code: kind === 'account' ? 'INSUFFICIENT_CREDITS' : 'MEMBER_BUDGET_EXCEEDED',
    });
    expect(analyze).not.toHaveBeenCalled();
  },
);

it.each(['small', 'ratio', 'oversize', 'forged'] as const)(
  'does not waive the planning image allowance for an unusable %s candidate',
  async (reason) => {
    const video = await referenceVideo(reason === 'small' ? 299 : 512);
    if (reason === 'ratio') video.options.ratio = '16:9';
    if (reason === 'oversize')
      app.services.db.sqlite
        .prepare('UPDATE assets SET byte_size=? WHERE id=?')
        .run(30 * 1024 * 1024, video.assetIds[0]);
    if (reason === 'forged') {
      video.nativePlan = {
        imagePrompt: '伪造首帧',
        videoPrompt: '伪造动作',
        firstFrame: { mode: 'reference', assetId: video.assetIds[0]! },
      };
      video.assetIds = [];
    }
    setBalance(25);
    await expect(prepare(video)).rejects.toThrow('33');
    expect(analyze).not.toHaveBeenCalled();
  },
);

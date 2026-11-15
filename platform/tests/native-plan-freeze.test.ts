import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import { jobInputSchema } from '../src/contracts/jobs';
import type { Actor } from '../src/contracts/core';
import { analyzeNativeIntent } from '../src/server/providers/native-planner';
import * as capture from '../src/server/tasks/native-capture';
import { createCreativeBriefServices } from '../src/server/tasks/creative-briefs';
import type { NativeImageEdit } from '../src/contracts/native-image-edit';

vi.mock('../src/server/providers/local-matting', async (original) => ({
  ...(await original<typeof import('../src/server/providers/local-matting')>()),
  probeLocalMatting: vi.fn(async () => ({ identity: 'isolated-installation-contract' })),
}));
vi.mock('../src/server/providers/native-planner', async (original) => ({
  ...(await original<typeof import('../src/server/providers/native-planner')>()),
  analyzeNativeIntent: vi.fn(),
}));
const analyze = vi.mocked(analyzeNativeIntent);
let app: Awaited<ReturnType<typeof createApp>>, directory: string, actor: Actor, wid: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yingzao-native-freeze-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(directory, 'fixture.sqlite'),
      storageDir: join(directory, 'media'),
      sessionSecret: 'fixture-session',
      encryptionKey: 'fixture-encryption',
      isProduction: false,
      demoMode: false,
      environmentSecrets: {},
    },
    { serveWeb: false },
  );
  const account = await app.services.core.auth.register({
    email: 'freeze@example.local',
    password: 'IsolatedFixture2026!',
    displayName: '冻结方案测试',
  });
  wid = account.workspace.id;
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  app.services.credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'fixture-credit',
    amount: 1000,
    source: 'manual',
    description: '隔离测试积分',
  });
  for (const kind of ['text', 'image', 'video'] as const)
    app.services.settings.connections.update(wid, {
      kind,
      protocol:
        kind === 'text' ? 'openai-chat' : kind === 'image' ? 'seedream-images' : 'seedance-native',
      baseUrl:
        kind === 'video'
          ? 'https://fixture.example/api/v3/contents/generations/tasks'
          : 'https://fixture.example/v1',
      modelsUrl: '',
      model: `fixture-${kind}`,
      enabled: true,
      secret: `fixture-${kind}`,
    });
  analyze.mockImplementation(async (request) => ({
    type: 'intent-plan',
    version: 1,
    requestId: request.requestId,
    status: 'ready',
    brief: {
      scope: 'general',
      subject: '白色杯子',
      goal: '概念短片',
      mediaType: 'video',
      platform: request.context.platform,
      placement: request.context.placement,
      productMode: 'not-applicable',
      facts: [],
      constraints: [],
    },
    summary: '柔光下的白色杯子。',
    assumptions: [],
    questions: [],
    prompt: '柔光下的白色杯子。',
    generationPlan: {
      imagePrompt: '完整白色杯子。',
      videoPrompt: '镜头缓缓靠近白色杯子。',
      firstFrame: { mode: 'generate' },
    },
    reviewChecklist: [],
  }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function input() {
  return jobInputSchema.parse({
    providerId: 'native',
    operation: 'video.generate',
    prompt: '制作白色杯子的概念短片。',
    options: {
      model: 'fixture-video',
      ratio: '1:1',
      resolution: '720p',
      duration: 5,
      needText: false,
    },
  });
}
function quotePlan(id: string) {
  const row = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(id) as { items_json: string };
  return JSON.parse(row.items_json)[0].nativePlan;
}

it.each(['generate', 'asset'] as const)(
  'freezes the %s background plan and does not trust client edits or recovered planner prose',
  async (mode) => {
    app.services.settings.connections.update(wid, {
      kind: 'image',
      protocol: 'seedream-images',
      baseUrl: 'https://fixture.example/v1',
      modelsUrl: '',
      model: 'doubao-seedream-5.0-lite',
      enabled: true,
      secret: 'fixture-image',
    });
    const source = await app.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({
        create: { width: 2048, height: 2048, channels: 3, background: '#bc8745' },
      })
        .png()
        .toBuffer(),
      name: '原图.png',
      mimeType: 'image/png',
    });
    let maskId: string | undefined;
    if (mode === 'asset') {
      const alpha = Buffer.alloc(2048 * 2048, 255);
      alpha.fill(0, 0, 2048 * 1024);
      const mask = await app.services.core.assets.ingest(actor, wid, {
        buffer: await sharp({
          create: { width: 2048, height: 2048, channels: 3, background: '#ffffff' },
        })
          .joinChannel(alpha, { raw: { width: 2048, height: 2048, channels: 1 } })
          .png()
          .toBuffer(),
        name: '已有区域.png',
        mimeType: 'image/png',
      });
      maskId = mask.id;
      app.services.credits.debit({
        workspaceId: wid,
        userId: actor.userId,
        eventKey: 'zero-for-local',
        amount: 1000,
        description: '本机零积分测试',
      });
    }
    const edit: NativeImageEdit = {
      type: 'solid-background',
      sourceAssetId: source.id,
      color: '#e6e8eb',
      regionDescription: '后方背景',
      preserveDescription: '主体与台面',
      mask: mode === 'generate' ? { mode: 'generate' } : { mode: 'asset', assetId: maskId! },
    };
    const defaultAnalyze = analyze.getMockImplementation()!;
    analyze.mockImplementationOnce(async (...args) => {
      expect(args[0].context.imageEditSize).toEqual({ width: 2048, height: 2048 });
      const result = await defaultAnalyze(...args);
      result.brief.mediaType = 'image';
      result.brief.scope = 'product';
      result.brief.productMode = 'reference';
      delete result.generationPlan;
      result.imageEdit = edit;
      return result;
    });
    const briefs = createCreativeBriefServices(app.services);
    const prepared = await briefs.prepare(actor, wid, {
      requestId: randomUUID(),
      input: jobInputSchema.parse({
        providerId: 'native',
        operation: 'image.generate',
        prompt: '仅将背景改为#e6e8eb，保留主体与台面。',
        assetIds: [source.id],
        maskAssetId: maskId,
        imageEdit: { ...edit, color: '#ff0000' },
        options: {
          model: 'doubao-seedream-5.0-lite',
          resolution: '2K',
          ratio: '1:1',
          needText: false,
        },
      }),
    });
    expect(prepared.input.imageEdit).toBeUndefined();
    const row = app.services.db.sqlite
      .prepare('SELECT input_json,result_json FROM creative_briefs WHERE id=?')
      .get(prepared.id) as { input_json: string; result_json: string };
    const frozenEdit: NativeImageEdit = {
      ...edit,
      mask: mode === 'generate' ? { mode: 'generate', calibration: 'local-matting-v2' } : edit.mask,
    };
    expect(JSON.parse(row.input_json).imageEdit).toEqual(frozenEdit);
    const first = app.services.quote(actor, wid, {
      ...prepared.input,
      imageEdit: { ...edit, color: '#000000' },
    });
    expect(first.maxCredits).toBe(mode === 'asset' ? 0 : 8);
    const changedResult = JSON.parse(row.result_json);
    changedResult.imageEdit.color = '#112233';
    app.services.db.sqlite
      .prepare('UPDATE creative_briefs SET result_json=? WHERE id=?')
      .run(JSON.stringify(changedResult), prepared.id);
    const next = app.services.quote(actor, wid, briefs.get(actor, wid, prepared.id).input);
    for (const quote of [first, next]) {
      const stored = app.services.db.sqlite
        .prepare('SELECT items_json FROM quotes WHERE id=?')
        .get(quote.id) as { items_json: string };
      expect(JSON.parse(stored.items_json)[0].imageEdit).toEqual(frozenEdit);
    }
    expect(analyze).toHaveBeenCalledTimes(1);
  },
);

it('keeps the confirmed stage prompts across compiler changes, result recovery, and subsequent quotes', async () => {
  const body = { requestId: randomUUID(), input: input() };
  const briefs = createCreativeBriefServices(app.services);
  const prepared = await briefs.prepare(actor, wid, body);
  expect(prepared.input.nativePlan).toBeUndefined();
  const stored = app.services.db.sqlite
    .prepare('SELECT input_json FROM creative_briefs WHERE id=?')
    .get(prepared.id) as { input_json: string };
  expect(JSON.parse(stored.input_json).nativePlan.videoPrompt).toContain('缓缓靠近');
  const first = app.services.quote(actor, wid, prepared.input);
  const confirmed = quotePlan(first.id);
  const compiler = vi.spyOn(capture, 'compileNativeVideoPlan').mockReturnValue({
    imagePrompt: '尚未确认的新构图',
    videoPrompt: '尚未确认的新运镜',
    firstFrame: { mode: 'generate' },
  });
  const recovered = briefs.get(actor, wid, prepared.id);
  expect((await briefs.prepare(actor, wid, body)).id).toBe(prepared.id);
  const next = app.services.quote(actor, wid, recovered.input);
  expect(quotePlan(next.id)).toEqual(confirmed);
  expect(compiler).not.toHaveBeenCalled();
  expect(analyze).toHaveBeenCalledTimes(1);
});

it.each([
  {
    control: { type: 'translate' as const, direction: 'right' as const, displacementPercent: 2 },
    rawPrompt: '主体全程静止，镜头小幅向右平移2%。',
    oldPrompt:
      '首帧与尾帧共同约束这一段微移：相机仅水平向右平移，对应主体投影向左移动约画面宽度的2%。',
  },
  {
    control: { type: 'zoom' as const, scalePercent: 103 },
    rawPrompt: '主体全程静止，相机机位固定，画面中心固定，等比放大到103%。',
    oldPrompt: '首帧与尾帧共同约束这一段变焦：画面中心固定，整幅等比放大到103%。',
  },
])(
  'preserves an already-confirmed controlled camera snapshot: $control.type',
  async ({ control, rawPrompt, oldPrompt }) => {
    app.services.settings.connections.update(wid, {
      kind: 'video',
      protocol: 'seedance-native',
      baseUrl: 'https://fixture.example/api/v3/contents/generations/tasks',
      modelsUrl: '',
      model: 'doubao-seedance-2.0',
      enabled: true,
      secret: 'fixture-video',
    });
    const reference = await app.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({
        create: { width: 512, height: 512, channels: 3, background: '#fafafa' },
      })
        .png()
        .toBuffer(),
      name: '原首帧.png',
      mimeType: 'image/png',
    });
    const defaultAnalyze = analyze.getMockImplementation()!;
    analyze.mockImplementationOnce(async (...args) => {
      const result = await defaultAnalyze(...args);
      result.brief.scope = 'product';
      result.brief.productMode = 'reference';
      result.generationPlan!.firstFrame = { mode: 'reference', assetId: reference.id };
      result.generationPlan!.cameraControl = control;
      return result;
    });
    // Recreate a snapshot confirmed with the earlier compiler, only in this isolated database.
    const compiler = vi
      .spyOn(capture, 'compileNativeVideoPlan')
      .mockImplementationOnce((result) => ({
        ...result.generationPlan!,
        videoPrompt: oldPrompt,
      }));
    const briefs = createCreativeBriefServices(app.services);
    const prepared = await briefs.prepare(actor, wid, {
      requestId: randomUUID(),
      input: jobInputSchema.parse({
        ...input(),
        prompt: rawPrompt,
        assetIds: [reference.id],
        options: { ...input().options, model: 'doubao-seedance-2.0' },
      }),
    });
    expect(compiler).toHaveBeenCalledTimes(1);
    compiler.mockImplementation(() => {
      throw new Error('Confirmed snapshot cannot be recompiled');
    });
    const recovered = briefs.get(actor, wid, prepared.id);
    const first = app.services.quote(actor, wid, recovered.input);
    const next = app.services.quote(actor, wid, recovered.input);
    expect(quotePlan(first.id)).toEqual(quotePlan(next.id));
    expect(quotePlan(first.id)).toMatchObject({
      videoPrompt: oldPrompt,
      firstFrame: { mode: 'reference', assetId: reference.id },
      cameraControl: control,
    });
    expect(compiler).toHaveBeenCalledTimes(1);
  },
);

it.each([true, false])(
  'pins a legacy brief once, preferring an existing quote when present (%s)',
  async (hasQuote) => {
    const briefs = createCreativeBriefServices(app.services);
    const prepared = await briefs.prepare(actor, wid, { requestId: randomUUID(), input: input() });
    const existing = hasQuote ? app.services.quote(actor, wid, prepared.input) : undefined;
    const saved = app.services.db.sqlite
      .prepare('SELECT input_json,input_fingerprint FROM creative_briefs WHERE id=?')
      .get(prepared.id) as { input_json: string; input_fingerprint: string };
    const oldInput = JSON.parse(saved.input_json);
    delete oldInput.nativePlan;
    app.services.db.sqlite
      .prepare('UPDATE creative_briefs SET input_json=? WHERE id=?')
      .run(JSON.stringify(oldInput), prepared.id);
    const compiler = vi.spyOn(capture, 'compileNativeVideoPlan');
    if (hasQuote)
      compiler.mockImplementation(() => {
        throw new Error('Recompilation was not confirmed');
      });
    const first = app.services.quote(actor, wid, prepared.input);
    if (existing) expect(quotePlan(first.id)).toEqual(quotePlan(existing.id));
    expect(compiler).toHaveBeenCalledTimes(hasQuote ? 0 : 1);
    compiler.mockImplementation(() => {
      throw new Error('Recompilation was not confirmed');
    });
    const next = app.services.quote(actor, wid, prepared.input);
    expect(quotePlan(next.id)).toEqual(quotePlan(first.id));
    const pinned = app.services.db.sqlite
      .prepare('SELECT input_json,input_fingerprint FROM creative_briefs WHERE id=?')
      .get(prepared.id) as { input_json: string; input_fingerprint: string };
    expect(pinned.input_fingerprint).toBe(saved.input_fingerprint);
    expect(JSON.parse(pinned.input_json).nativePlan).toEqual(quotePlan(first.id));
    expect(briefs.get(actor, wid, prepared.id).input.nativePlan).toBeUndefined();
  },
);

it('rejects an invalid stored plan instead of silently recompiling or weakening its length limit', async () => {
  const prepared = await createCreativeBriefServices(app.services).prepare(actor, wid, {
    requestId: randomUUID(),
    input: input(),
  });
  const saved = app.services.db.sqlite
    .prepare('SELECT input_json FROM creative_briefs WHERE id=?')
    .get(prepared.id) as { input_json: string };
  const altered = JSON.parse(saved.input_json);
  altered.nativePlan.imagePrompt = '字'.repeat(11001);
  app.services.db.sqlite
    .prepare('UPDATE creative_briefs SET input_json=? WHERE id=?')
    .run(JSON.stringify(altered), prepared.id);
  const compiler = vi.spyOn(capture, 'compileNativeVideoPlan');
  expect(() => app.services.quote(actor, wid, prepared.input)).toThrow();
  expect(compiler).not.toHaveBeenCalled();
});

it('freezes selected product images, brand guidance and private memory through the native video plan', async () => {
  const asset = await app.services.core.assets.ingest(actor, wid, {
    buffer: await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer(),
    name: '产品参考.png',
    mimeType: 'image/png',
  });
  const brand = app.services.core.references.createBrand(actor, wid, {
    name: '白杯品牌',
    description: '简约排版',
  });
  const product = app.services.core.knowledge.createProduct(actor, wid, {
    name: '白杯',
    brandId: brand.id,
    facts: ['容量300毫升'],
    referenceAssetIds: [asset.id],
  });
  const memory = app.services.core.knowledge.createMemory(actor, wid, {
    topic: '构图',
    kind: 'preference',
    content: '主体留出呼吸空间',
    mediaType: 'video',
  });
  const raw = jobInputSchema.parse({
    ...input(),
    productId: product.id,
    includeProductImages: true,
    useMemory: true,
  });
  const briefs = createCreativeBriefServices(app.services);
  const prepared = await briefs.prepare(actor, wid, { requestId: randomUUID(), input: raw });
  const request = analyze.mock.calls.at(-1)![0];
  expect(request.memoryContext?.items).toContainEqual(
    expect.objectContaining({ id: memory.id, content: memory.content }),
  );
  expect(request.materials).toContainEqual(
    expect.objectContaining({ id: asset.id, role: 'reference' }),
  );
  expect(request.sourceTexts).toContainEqual(
    expect.objectContaining({ id: `product:${product.id}:v1` }),
  );
  const first = app.services.quote(actor, wid, prepared.input);
  app.services.core.knowledge.updateProduct(actor, wid, product.id, {
    name: '白杯',
    facts: ['容量500毫升'],
    brandId: brand.id,
    expectedVersion: 1,
  });
  app.services.core.knowledge.removeMemory(actor, wid, memory.id);
  const second = app.services.quote(actor, wid, prepared.input);
  expect(quotePlan(second.id)).toEqual(quotePlan(first.id));
  const saved = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(second.id) as { items_json: string };
  const frozen = jobInputSchema.parse(JSON.parse(saved.items_json)[0]);
  expect(frozen.referenceAssetIds).toContain(asset.id);
  expect(frozen.productId).toBeUndefined();
  expect(frozen.useMemory).toBeUndefined();
  expect(frozen.includeProductImages).toBeUndefined();
  expect(saved.items_json).not.toContain(memory.content);
  expect(saved.items_json).not.toContain('容量500毫升');
});

it.each(['product', 'brand'] as const)(
  'quotes and submits a confirmed local mask whose only original image comes from the %s library',
  async (kind) => {
    app.services.settings.connections.update(wid, {
      kind: 'image',
      protocol: 'seedream-images',
      baseUrl: 'https://fixture.example/v1',
      modelsUrl: '',
      model: 'doubao-seedream-5.0-lite',
      enabled: true,
      secret: 'fixture-image',
    });
    const source = await app.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({
        create: { width: 2048, height: 2048, channels: 3, background: '#bc8745' },
      })
        .png()
        .toBuffer(),
      name: '库内原图.png',
      mimeType: 'image/png',
    });
    const alpha = Buffer.alloc(2048 * 2048, 255);
    alpha.fill(0, 0, 2048 * 1024);
    const mask = await app.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({
        create: { width: 2048, height: 2048, channels: 3, background: '#ffffff' },
      })
        .joinChannel(alpha, { raw: { width: 2048, height: 2048, channels: 1 } })
        .png()
        .toBuffer(),
      name: '确认蒙版.png',
      mimeType: 'image/png',
    });
    const association =
      kind === 'product'
        ? {
            productId: app.services.core.knowledge.createProduct(actor, wid, {
              name: '库内产品',
              referenceAssetIds: [source.id],
            }).id,
            includeProductImages: true,
          }
        : {
            brandId: app.services.core.references.createBrand(actor, wid, {
              name: '库内品牌',
              referenceAssetIds: [source.id],
            }).id,
          };
    const base = analyze.getMockImplementation()!;
    analyze.mockImplementationOnce(async (...args) => {
      const result = await base(...args);
      result.brief.mediaType = 'image';
      result.brief.scope = 'product';
      result.brief.productMode = 'reference';
      delete result.generationPlan;
      result.imageEdit = {
        type: 'solid-background',
        sourceAssetId: source.id,
        color: '#e6e8eb',
        regionDescription: '背景',
        preserveDescription: '主体',
        mask: { mode: 'asset', assetId: mask.id },
      };
      return result;
    });
    const raw = jobInputSchema.parse({
      providerId: 'native',
      operation: 'image.generate',
      prompt: '仅将背景改为#e6e8eb，保留主体。',
      ...association,
      maskAssetId: mask.id,
      options: {
        model: 'doubao-seedream-5.0-lite',
        resolution: '2K',
        ratio: '1:1',
        needText: false,
      },
    });
    const prepared = await createCreativeBriefServices(app.services).prepare(actor, wid, {
      requestId: randomUUID(),
      input: raw,
    });
    expect(prepared.status).toBe('ready');
    const quote = app.services.quote(actor, wid, prepared.input);
    expect(quote.maxCredits).toBe(0);
    const job = app.services.submit(actor, wid, prepared.input, quote.id, randomUUID());
    expect(job.status).toBe('queued');
    const item = app.services.db.sqlite
      .prepare('SELECT input_json FROM job_items WHERE job_id=?')
      .get(job.id) as { input_json: string };
    const frozen = jobInputSchema.parse(JSON.parse(item.input_json));
    expect(frozen.referenceAssetIds).toContain(source.id);
    expect(frozen.imageEdit?.sourceAssetId).toBe(source.id);
    expect(frozen.imageEdit?.mask).toEqual({ mode: 'asset', assetId: mask.id });
    app.services.core.assets.remove(actor, wid, source.id);
    expect(() => app.services.quote(actor, wid, prepared.input)).toThrow();
  },
);

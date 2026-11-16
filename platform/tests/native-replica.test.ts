/** Complete owned-brief/quote/worker contract, isolated files and mocked remote transport. */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Actor } from '../src/contracts/core';
import { creativeIntentRequestSchema } from '../src/contracts/creative-intent';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import { downloadPublicMedia } from '../src/server/providers/http';
import { nativeProviderJson } from '../src/server/providers/native-http';
import { nativeReplicaImages } from '../src/server/providers/native-replica';
import { createCreativeBriefServices } from '../src/server/tasks/creative-briefs';
import { simulateCreativeIntent } from '../src/server/tasks/creative-intent-simulation';
import { ProviderError, type ExecutionContext } from '../src/server/tasks/types';
import { createWorker } from '../src/worker/runner';

vi.mock('../src/server/providers/native-http', () => ({ nativeProviderJson: vi.fn() }));
vi.mock('../src/server/providers/http', async (original) => ({
  ...(await original<typeof import('../src/server/providers/http')>()),
  downloadPublicMedia: vi.fn(),
}));
const call = vi.mocked(nativeProviderJson),
  download = vi.mocked(downloadPublicMedia),
  exec = promisify(execFile);
const taskBase = 'https://fixture.example/api/v3/contents/generations/tasks';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let app: Awaited<ReturnType<typeof createApp>>, dir: string, actor: Actor, wid: string;
let worker: ReturnType<typeof createWorker>;
let subject: { id: string; buffer: Buffer },
  reference: { id: string; buffer: Buffer },
  generated: Buffer;
beforeEach(async () => {
  call.mockReset();
  download.mockReset();
  dir = await mkdtemp(join(tmpdir(), 'yingzao-replica-contract-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(dir, 'fixture.sqlite'),
      storageDir: join(dir, 'media'),
      sessionSecret: 'fixture-session',
      encryptionKey: 'fixture-encryption',
      isProduction: false,
      demoMode: false,
      environmentSecrets: {},
    },
    { serveWeb: false },
  );
  const account = await app.services.core.auth.register({
    email: 'replica@example.local',
    password: 'IsolatedFixture2026!',
    displayName: '复刻测试',
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
      baseUrl: kind === 'video' ? taskBase : 'https://fixture.example/v1',
      modelsUrl: '',
      model: kind === 'video' ? 'doubao-seedance-2.0' : `fixture-${kind}`,
      ...(kind === 'text' ? { visionModel: 'fixture-vision' } : {}),
      enabled: true,
      secret: `fixture-${kind}`,
    });
  const ingest = async (color: string, name: string) => {
    const buffer = await sharp({
      create: { width: 512, height: 512, channels: 3, background: color },
    })
      .png()
      .toBuffer();
    const asset = await app.services.core.assets.ingest(actor, wid, {
      buffer,
      name,
      mimeType: 'image/png',
    });
    return { id: asset.id, buffer };
  };
  subject = await ingest('#008000', '自己的方块.png');
  reference = await ingest('#ff0000', '参考构图.png');
  generated = await sharp({
    create: { width: 2048, height: 2048, channels: 3, background: '#00aa66' },
  })
    .png()
    .toBuffer();
  call.mockImplementation(async (url, options) => {
    if (url.endsWith('/chat/completions')) {
      const body = options?.body as {
        model: string;
        messages: { content: string | { type: string; text?: string }[] }[];
      };
      if (body.model === 'fixture-vision') {
        const content = body.messages[1]!.content as { type: string; text?: string }[];
        const request = JSON.parse(content[0]!.text!) as { referenceKind: string };
        const frames = content
          .filter((part) => part.type === 'text' && part.text?.includes('style-reference'))
          .map((part) => JSON.parse(part.text!) as { timestampSeconds: number });
        return {
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  version: 1,
                  referenceKind: request.referenceKind,
                  visualStatus: 'readable',
                  observations: ['主体是绿色方块；参考提供构图和背景。'],
                  motion:
                    request.referenceKind === 'video'
                      ? {
                          description: '采样画面明度渐变',
                          uncertainties: ['有限采样不能证明连续运动，无音频分析'],
                        }
                      : null,
                  timeline:
                    request.referenceKind === 'video'
                      ? frames.map((frame) => ({
                          timestampSeconds: frame.timestampSeconds,
                          description: '该时刻采样画面',
                        }))
                      : [],
                  anchorFrameIndex: request.referenceKind === 'video' ? 2 : 0,
                  transferGuidance: '保留自己的主体，参考画面的构图和光线。',
                  limitations: ['只依据已提供像素；视频仅抽样且没有分析音频。'],
                }),
              },
            },
          ],
        };
      }
      const request = creativeIntentRequestSchema.parse(
        JSON.parse(body.messages[1]!.content as string),
      );
      expect(request.replica?.evidence.subjectSha256).toBe(hash(subject.buffer));
      const plan = simulateCreativeIntent(request);
      if (request.context.mediaType === 'video')
        plan.generationPlan = {
          imagePrompt: '以自己的主体生成参考构图的新场景。',
          videoPrompt: '镜头缓慢接近，主体保持结构完整，结尾平稳。',
          firstFrame: { mode: 'generate' },
        };
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] };
    }
    if (url.endsWith('/images/generations'))
      return { data: [{ b64_json: generated.toString('base64') }] };
    if (url === taskBase && options?.method !== 'GET') return { id: 'fixture-created-video' };
    if (url === `${taskBase}/fixture-created-video` && options?.method === 'GET')
      return {
        id: 'fixture-created-video',
        status: 'succeeded',
        content: { video_url: 'https://media.example/fixture.mp4' },
      };
    throw new Error(`Unexpected contract request ${url}`);
  });
  download.mockRejectedValue(new Error('Unexpected fixture download'));
  worker = createWorker(app.services);
});
afterEach(async () => {
  await worker?.stop();
  await app?.app.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});
function input(kind: 'image' | 'video' = 'image'): JobInput {
  return jobInputSchema.parse({
    providerId: 'native',
    operation: `${kind}.generate`,
    prompt: '以自己的绿色方块为主体，借鉴参考构图与布光，保留自己的身份和结构。',
    assetIds: [subject.id],
    referenceAssetIds: [reference.id],
    replica: {
      referenceAssetId: reference.id,
      subjectAssetId: subject.id,
      aspects: ['composition', 'lighting'],
      ...(kind === 'video' ? { trimStart: 1, trimDuration: 3 } : {}),
    },
    options: {
      model: kind === 'video' ? 'doubao-seedance-2.0' : 'fixture-image',
      ratio: '1:1',
      resolution: kind === 'video' ? '720p' : '2K',
      duration: 5,
      needText: false,
    },
  });
}
const briefs = () => createCreativeBriefServices(app.services);
const prepare = (value = input()) =>
  briefs().prepare(actor, wid, { requestId: randomUUID(), input: value });
function frozen(id: string): JobInput {
  const row = app.services.db.sqlite
    .prepare('SELECT input_json FROM creative_briefs WHERE id=?')
    .get(id) as { input_json: string };
  return jobInputSchema.parse(JSON.parse(row.input_json));
}
async function tick(jobId?: string) {
  if (jobId)
    app.services.db.sqlite
      .prepare('UPDATE job_items SET next_attempt_at=? WHERE job_id=?')
      .run('2000-01-01T00:00:00.000Z', jobId);
  await worker.tick();
  await worker.drain();
}
it('freezes actual visual evidence, strips client snapshots, and edits only the owned subject after studying both images', async () => {
  const requestId = randomUUID(),
    raw = input();
  const prepared = await briefs().prepare(actor, wid, { requestId, input: raw });
  expect(prepared.status).toBe('ready');
  expect(prepared.input.nativeReplica).toBeUndefined();
  expect(prepared.referenceStudy?.evidence).toMatchObject({
    model: 'fixture-vision',
    referenceSha256: hash(reference.buffer),
    subjectSha256: hash(subject.buffer),
  });
  const saved = frozen(prepared.id);
  expect(saved.nativeReplica?.intent).toEqual(raw.replica);
  expect(saved.nativeReplica?.renderStrategy).toBe('subject-edit-v1');
  const again = await briefs().prepare(actor, wid, { requestId, input: raw });
  expect(again.id).toBe(prepared.id);
  expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls.map(([, options]) => (options!.body as { model: string }).model)).toEqual([
    'fixture-vision',
    'fixture-text',
  ]);
  const tampered = {
    ...prepared.input,
    nativeReplica: {
      ...saved.nativeReplica!,
      study: { ...saved.nativeReplica!.study, observations: ['客户端虚构内容'] },
      evidence: { ...saved.nativeReplica!.evidence, referenceSha256: '0'.repeat(64) },
    },
  };
  const quotation = app.services.quote(actor, wid, tampered);
  expect(quotation.maxCredits).toBe(8);
  const item = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quotation.id) as { items_json: string };
  expect(JSON.parse(item.items_json)[0].nativeReplica).toEqual(saved.nativeReplica);
  const job = app.services.submit(actor, wid, tampered, quotation.id, randomUUID());
  await tick();
  expect(app.services.get(actor, wid, job.id)).toMatchObject({
    status: 'succeeded',
    settledCredits: 8,
  });
  const image = call.mock.calls.find(([url]) => url.endsWith('/images/generations'))!;
  const body = image[1]!.body as { image: string[]; prompt: string };
  expect(body.image).toHaveLength(1);
  expect(Buffer.from(body.image[0]!.split(',')[1]!, 'base64')).toEqual(subject.buffer);
  expect(body.prompt).toContain('不存在图2');
  expect(body.prompt).toContain('不能分别改变部件尺寸');
  const output = app.services.get(actor, wid, job.id).outputAssets[0]!;
  expect(output).toMatchObject({ kind: 'image', width: 2048, height: 2048 });
});

it('freezes selected brand and product text without adding their images to the two replica roles', async () => {
  const unrelated = await app.services.core.assets.ingest(actor, wid, {
    buffer: await sharp({ create: { width: 512, height: 512, channels: 3, background: '#0000ff' } })
      .png()
      .toBuffer(),
    name: '品牌与产品资料图.png',
    mimeType: 'image/png',
  });
  const brand = app.services.core.references.createBrand(actor, wid, {
    name: '复刻测试品牌',
    description: '原品牌青绿背景',
    referenceAssetIds: [unrelated.id],
  });
  const product = app.services.core.knowledge.createProduct(actor, wid, {
    name: '自己的商品',
    facts: ['容量450毫升'],
    brandId: brand.id,
    referenceAssetIds: [unrelated.id],
  });
  const implementation = call.getMockImplementation()!;
  call.mockImplementation(async (url, options) => {
    const response = await implementation(url, options);
    if ((options?.body as { model?: string })?.model === 'fixture-text') {
      const envelope = response as { choices: { message: { content: string } }[] };
      const plan = JSON.parse(envelope.choices[0]!.message.content);
      plan.prompt += ' 使用原品牌青绿背景；自己的商品容量450毫升。';
      envelope.choices[0]!.message.content = JSON.stringify(plan);
    }
    return response;
  });
  const raw = { ...input(), brandId: brand.id, productId: product.id };
  const prepared = await prepare(raw);
  expect(prepared.contextSources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'brand',
        id: brand.id,
        content: expect.stringContaining('原品牌青绿背景'),
      }),
      expect.objectContaining({
        kind: 'product',
        id: product.id,
        content: expect.stringContaining('容量450毫升'),
      }),
    ]),
  );
  expect(prepared.referenceStudy?.evidence).toMatchObject({
    referenceSha256: hash(reference.buffer),
    subjectSha256: hash(subject.buffer),
    audioAnalyzed: false,
  });
  const planning = call.mock.calls.find(
    ([, options]) => (options?.body as { model?: string })?.model === 'fixture-text',
  )!;
  const messages = (planning[1]!.body as { messages: { content: string }[] }).messages;
  const request = creativeIntentRequestSchema.parse(JSON.parse(messages[1]!.content));
  expect(request.materials.map((material) => material.id)).toEqual([subject.id, reference.id]);
  expect(request.sourceTexts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'brand', text: expect.stringContaining('原品牌青绿背景') }),
      expect.objectContaining({ text: expect.stringContaining('容量450毫升') }),
    ]),
  );
  app.services.core.references.updateBrand(actor, wid, brand.id, {
    description: '后来改为红色背景',
  });
  app.services.core.knowledge.updateProduct(actor, wid, product.id, {
    expectedVersion: product.version,
    facts: ['容量999毫升'],
  });
  const quotation = app.services.quote(actor, wid, prepared.input);
  const job = app.services.submit(actor, wid, prepared.input, quotation.id, randomUUID());
  await tick();
  expect(app.services.get(actor, wid, job.id).status).toBe('succeeded');
  const image = call.mock.calls.find(([url]) => url.endsWith('/images/generations'))!;
  const body = image[1]!.body as { image: string[]; prompt: string };
  expect(body.image).toHaveLength(1);
  expect(Buffer.from(body.image[0]!.split(',')[1]!, 'base64')).toEqual(subject.buffer);
  expect(body.prompt).toContain('原品牌青绿背景');
  expect(body.prompt).toContain('容量450毫升');
  expect(body.prompt).not.toMatch(/后来改为红色背景|容量999毫升/);
});

it('rejects mismatched brands and implicit product-image expansion before replica model calls', async () => {
  const brand = app.services.core.references.createBrand(actor, wid, { name: '所属品牌' });
  const other = app.services.core.references.createBrand(actor, wid, { name: '另一品牌' });
  const product = app.services.core.knowledge.createProduct(actor, wid, {
    name: '自己的商品',
    brandId: brand.id,
    referenceAssetIds: [subject.id],
  });
  await expect(
    prepare({ ...input(), brandId: other.id, productId: product.id }),
  ).rejects.toMatchObject({ code: 'PRODUCT_BRAND_CONFLICT' });
  await expect(
    prepare({ ...input(), brandId: brand.id, productId: product.id, includeProductImages: true }),
  ).rejects.toMatchObject({ code: 'REPLICA_INPUT_INVALID' });
  await expect(prepare({ ...input(), brandId: randomUUID() })).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(call).not.toHaveBeenCalled();
});
it('retains two-image execution for a previously frozen replica without a new rendering strategy', async () => {
  const prepared = await prepare();
  const input = frozen(prepared.id);
  delete input.nativeReplica!.renderStrategy;
  const context = {
    input,
    readAsset: async (id: string) => ({
      buffer: id === subject.id ? subject.buffer : reference.buffer,
      mimeType: 'image/png',
      name: '原件.png',
    }),
  } as ExecutionContext;
  const files = await nativeReplicaImages(context);
  expect(files.map((file) => file.buffer)).toEqual([subject.buffer, reference.buffer]);
});
it('does not authorize generation from an unowned or client-invented brief/snapshot', async () => {
  const prepared = await prepare();
  const raw = input();
  raw.nativeReplica = frozen(prepared.id).nativeReplica;
  expect(() => app.services.quote(actor, wid, raw)).toThrow();
  const team = app.services.core.auth.createWorkspace(actor.userId, '另一团队', 'team');
  const invite = app.services.core.team.invite(actor, team.id, {
    email: 'other@example.local',
    role: 'member',
  });
  const other = await app.services.core.auth.register({
    email: 'other@example.local',
    password: 'OtherFixturePassword2026!',
    displayName: '其他账号',
    inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
  });
  const otherActor = { ...actor, userId: other.user.id };
  expect(() => briefs().get(otherActor, other.workspace.id, prepared.id)).toThrow();
  expect(() =>
    app.services.quote(otherActor, other.workspace.id, { ...raw, creativeBriefId: prepared.id }),
  ).toThrow();
  const foreign = await app.services.core.assets.ingest(otherActor, team.id, {
    buffer: reference.buffer,
    mimeType: 'image/png',
    name: '另一团队参考.png',
  });
  const inaccessible = {
    ...input(),
    referenceAssetIds: [foreign.id],
    replica: { ...input().replica!, referenceAssetId: foreign.id },
  };
  await expect(prepare(inaccessible)).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
});
it('rejects role swaps, wrong media type, count and image motion/trim settings before visual calls', async () => {
  const valid = input();
  for (const invalid of [
    { ...valid, assetIds: [reference.id] },
    { ...valid, referenceAssetIds: [subject.id] },
    { ...valid, options: { ...valid.options, count: 2 } },
    { ...valid, replica: { ...valid.replica!, aspects: ['camera'] } },
    { ...valid, replica: { ...valid.replica!, trimStart: 1 } },
    input('video'),
  ])
    await expect(
      briefs().prepare(actor, wid, { requestId: randomUUID(), input: invalid }),
    ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it('rejects changed original bytes before any image model request', async () => {
  const prepared = await prepare();
  const input = frozen(prepared.id);
  const context = {
    input,
    readAsset: async (id: string) => ({
      buffer: id === subject.id ? Buffer.from('changed') : reference.buffer,
      mimeType: 'image/png',
      name: '原件.png',
    }),
  } as ExecutionContext;
  await expect(nativeReplicaImages(context)).rejects.toThrow(/原件/);
  expect(call.mock.calls.filter(([url]) => url.endsWith('/images/generations'))).toHaveLength(0);
});
it.each(['bytes', 'pixels'] as const)(
  'rejects an actually oversized %s subject or reference before visual planning',
  async (limit) => {
    const buffer =
      limit === 'bytes'
        ? Buffer.concat([
            subject.buffer,
            Buffer.alloc(10 * 1024 * 1024 + 1 - subject.buffer.length),
          ])
        : await sharp({ create: { width: 6001, height: 6000, channels: 3, background: '#888888' } })
            .png()
            .toBuffer();
    const asset = await app.services.core.assets.ingest(actor, wid, {
      buffer,
      mimeType: 'image/png',
      name: '超出复刻限制.png',
    });
    if (limit === 'bytes') expect(asset.byteSize).toBeGreaterThan(10 * 1024 * 1024);
    else expect(asset.width! * asset.height!).toBeGreaterThan(36_000_000);
    for (const role of ['subject', 'reference'] as const) {
      const value = input();
      if (role === 'subject') {
        value.assetIds = [asset.id];
        value.replica!.subjectAssetId = asset.id;
      } else {
        value.referenceAssetIds = [asset.id];
        value.replica!.referenceAssetId = asset.id;
      }
      await expect(prepare(value)).rejects.toMatchObject({ code: 'REPLICA_IMAGE_LIMIT' });
    }
    expect(call).not.toHaveBeenCalled();
  },
  60000,
);
it('reuses completed visual analysis after a definite text failure on an explicit new request, while charging no duplicate visual call', async () => {
  const transport = call.getMockImplementation()!;
  let textAttempts = 0;
  call.mockImplementation(async (...args) => {
    if (
      (args[1]?.body as { model?: string } | undefined)?.model === 'fixture-text' &&
      ++textAttempts === 1
    )
      throw new ProviderError('文本服务拒绝创建', false, 'PROVIDER_HTTP_403');
    return transport(...args);
  });
  const requestId = randomUUID(),
    raw = input();
  await expect(briefs().prepare(actor, wid, { requestId, input: raw })).rejects.toThrow(/文本服务/);
  const failed = app.services.db.sqlite
    .prepare('SELECT id,state,request_json,input_json FROM creative_briefs WHERE request_id=?')
    .get(requestId) as { id: string; state: string; request_json: string; input_json: string };
  expect(failed.state).toBe('failed');
  expect(JSON.parse(failed.request_json).replica).toEqual(
    JSON.parse(failed.input_json).nativeReplica,
  );
  await expect(briefs().prepare(actor, wid, { requestId, input: raw })).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
  const retried = await prepare(raw);
  expect(retried.status).toBe('ready');
  expect(
    call.mock.calls.filter(
      ([, options]) => (options?.body as { model?: string })?.model === 'fixture-vision',
    ),
  ).toHaveLength(1);
  expect(textAttempts).toBe(2);
  expect(retried.referenceStudy).toEqual({
    study: JSON.parse(failed.request_json).replica.study,
    evidence: JSON.parse(failed.request_json).replica.evidence,
  });
});
it('does not auto-repeat an uncertain planning request under a fresh request ID', async () => {
  const transport = call.getMockImplementation()!;
  call.mockImplementation(async (...args) => {
    if ((args[1]?.body as { model?: string } | undefined)?.model === 'fixture-text')
      throw new ProviderError('模型已提交但连接中断', true, 'PROVIDER_CONNECTION');
    return transport(...args);
  });
  await expect(prepare()).rejects.toThrow(/连接中断/);
  expect(call).toHaveBeenCalledTimes(2);
  await expect(prepare()).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
});
it('analyzes the selected real video frames, generates a new subject scene then submits only its first frame', async () => {
  const sourcePath = join(dir, 'reference.mp4');
  await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=black:s=320x180:r=10',
      '-vf',
      'geq=lum=16+N*3:cb=128:cr=128',
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-crf',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '2',
      '-y',
      sourcePath,
    ],
    { timeout: 60000 },
  );
  const buffer = await readFile(sourcePath);
  const source = await app.services.core.assets.ingest(actor, wid, {
    buffer,
    mimeType: 'video/mp4',
    name: '参考短片.mp4',
  });
  reference = { id: source.id, buffer };
  const outside = input('video');
  outside.replica!.trimStart = 4;
  await expect(prepare(outside)).rejects.toThrow(/选段/);
  expect(call).not.toHaveBeenCalled();
  const prepared = await prepare(input('video'));
  expect(prepared.referenceStudy?.evidence).toMatchObject({
    referenceKind: 'video',
    clipStartSeconds: 1,
    clipDurationSeconds: 3,
    audioAnalyzed: false,
  });
  expect(prepared.referenceStudy?.evidence.frames).toHaveLength(6);
  expect(frozen(prepared.id).nativePlan?.firstFrame).toEqual({ mode: 'generate' });
  const quotation = app.services.quote(actor, wid, prepared.input);
  expect(quotation.maxCredits).toBe(33);
  const job = app.services.submit(actor, wid, prepared.input, quotation.id, randomUUID());
  await tick();
  expect(app.services.get(actor, wid, job.id).status).toBe('running');
  const imageBody = call.mock.calls.find(([url]) => url.endsWith('/images/generations'))![1]!
    .body as { image: string[] };
  expect(imageBody.image).toHaveLength(2);
  expect(Buffer.from(imageBody.image[0]!.split(',')[1]!, 'base64')).toEqual(subject.buffer);
  const anchor = Buffer.from(imageBody.image[1]!.split(',')[1]!, 'base64');
  expect((await sharp(anchor).metadata()).width).toBe(320);
  expect(hash(anchor)).toBe(prepared.referenceStudy!.evidence.frames[2]!.sha256);
  const submission = call.mock.calls.find(
    ([url, options]) => url === taskBase && options?.method !== 'GET',
  )![1]!.body as { content: { type: string; role?: string; image_url?: { url: string } }[] };
  const frame = submission.content.find((part) => part.role === 'first_frame')!;
  expect(frame.type).toBe('image_url');
  expect(Buffer.from(frame.image_url!.url.split(',')[1]!, 'base64')).toEqual(generated);
  expect(
    submission.content.some((part) => part.type === 'video_url' || part.role === 'reference_video'),
  ).toBe(false);
  const outputPath = join(dir, 'result.mp4');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=960x960:d=5:r=24',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '2',
    '-y',
    outputPath,
  ]);
  download.mockResolvedValue(await readFile(outputPath));
  await tick(job.id);
  expect(app.services.get(actor, wid, job.id)).toMatchObject({
    status: 'succeeded',
    settledCredits: 33,
  });
}, 60000);

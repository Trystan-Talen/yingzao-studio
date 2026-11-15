/** Full native pipeline on temporary SQLite/media with mocked model transport; never live spend. */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import {
  creativeIntentRequestSchema,
  type CreativePreparation,
} from '../src/contracts/creative-intent';
import { createCreativeBriefServices } from '../src/server/tasks/creative-briefs';
import { simulateCreativeIntent } from '../src/server/tasks/creative-intent-simulation';
import { nativeProviderJson } from '../src/server/providers/native-http';
import { downloadPublicMedia } from '../src/server/providers/http';
import { createWorker } from '../src/worker/runner';
import { ProviderError } from '../src/server/tasks/types';

vi.mock('../src/server/providers/native-http', () => ({ nativeProviderJson: vi.fn() }));
vi.mock('../src/server/providers/http', async (original) => ({
  ...(await original<typeof import('../src/server/providers/http')>()),
  downloadPublicMedia: vi.fn(),
}));
const call = vi.mocked(nativeProviderJson);
const download = vi.mocked(downloadPublicMedia);
const exec = promisify(execFile);
let dir: string, wid: string, actor: Actor, png: Buffer, generatedPng: Buffer, config: AppConfig;
let instance: Awaited<ReturnType<typeof createApp>>;
let worker: ReturnType<typeof createWorker>;
let videoStatus: 'succeeded' | 'failed';
const taskBase = 'https://fixture.example/doubao/api/v3/contents/generations/tasks';

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), 'yingzao-native-integration-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(dir, 'isolated.sqlite'),
    storageDir: join(dir, 'media'),
    sessionSecret: 'native-session-fixture',
    encryptionKey: 'native-encryption-fixture',
    demoMode: false,
    isProduction: false,
    environmentSecrets: {},
  };
  instance = await createApp(config, { serveWeb: false });
  const account = await instance.services.core.auth.register({
    email: 'native-fixture@example.local',
    password: 'NativeFixturePassword2026!',
    displayName: '原生合同测试',
  });
  wid = account.workspace.id;
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  instance.services.credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'native-test-credit',
    amount: 10000,
    source: 'manual',
    description: '隔离测试积分',
  });
  for (const kind of ['text', 'image', 'video'] as const)
    instance.services.settings.connections.update(wid, {
      kind,
      protocol:
        kind === 'text' ? 'openai-chat' : kind === 'image' ? 'seedream-images' : 'seedance-native',
      baseUrl: kind === 'video' ? taskBase : 'https://fixture.example/v1',
      modelsUrl: '',
      model: kind === 'video' ? 'doubao-seedance-2.0' : `fixture-${kind}`,
      enabled: true,
      secret: `fixture-${kind}-secret`,
    });
  png = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#cfe2df' } })
    .png()
    .toBuffer();
  generatedPng = await sharp({
    create: { width: 2048, height: 2048, channels: 3, background: '#cfe2df' },
  })
    .png()
    .toBuffer();
  videoStatus = 'succeeded';
  call.mockImplementation(async (url, options) => {
    if (url.endsWith('/chat/completions')) {
      const body = options?.body as { messages: { content: string }[] };
      const request = creativeIntentRequestSchema.parse(JSON.parse(body.messages[1]!.content));
      const plan = simulateCreativeIntent(request);
      if (request.context.mediaType === 'video')
        plan.generationPlan = {
          imagePrompt: '初始画面：柔光下完整的白色陶瓷杯。',
          videoPrompt: '镜头缓慢推进，陶瓷杯保持完整入画，结尾平稳。',
        };
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] };
    }
    if (url.endsWith('/images/generations'))
      return { data: [{ b64_json: generatedPng.toString('base64') }] };
    if (url === taskBase && options?.method !== 'GET')
      return { id: `native-video-${call.mock.calls.length}` };
    if (url.startsWith(`${taskBase}/`) && options?.method === 'GET')
      return {
        id: url.split('/').at(-1),
        status: videoStatus,
        content: { video_url: 'https://media.example/native-video.mp4?signature=fixture' },
      };
    throw new Error(`Unexpected local contract request: ${url}`);
  });
  download.mockRejectedValue(new Error('Unexpected fixture download'));
  worker = createWorker(instance.services);
});
afterEach(async () => {
  await worker?.stop();
  await instance?.app.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});
function input(kind: 'image' | 'video' = 'image'): JobInput {
  return jobInputSchema.parse({
    providerId: 'native',
    operation: `${kind}.generate`,
    prompt: '请制作柔光中的白色陶瓷杯。',
    options: {
      model: kind === 'video' ? 'doubao-seedance-2.0' : `fixture-${kind}`,
      ratio: '1:1',
      resolution: kind === 'video' ? '720p' : '2K',
      duration: 5,
      needText: false,
    },
  });
}
async function prepare(kind: 'image' | 'video' = 'image'): Promise<CreativePreparation> {
  return createCreativeBriefServices(instance.services).prepare(actor, wid, {
    requestId: randomUUID(),
    input: input(kind),
  });
}
async function referenceInput(): Promise<JobInput> {
  const reference = await instance.services.core.assets.ingest(actor, wid, {
    buffer: png,
    name: '已确认首帧.png',
    mimeType: 'image/png',
  });
  const value = input('video');
  value.prompt = '将这张参考图直接作为视频首帧，保持原构图与主体外观，只做轻微向右平移。';
  value.assetIds = [reference.id];
  value.options.kind = 'product';
  return value;
}
async function prepareFrame(
  value: JobInput,
  firstFrame: NonNullable<JobInput['nativePlan']>['firstFrame'],
  cameraControl?: NonNullable<JobInput['nativePlan']>['cameraControl'],
): Promise<CreativePreparation> {
  call.mockImplementationOnce(async (_url, options) => {
    const body = options?.body as { messages: { content: string }[] };
    const request = creativeIntentRequestSchema.parse(JSON.parse(body.messages[1]!.content));
    const plan = simulateCreativeIntent(request);
    plan.generationPlan = {
      imagePrompt: '保持参考图中的构图、主体外观与相对位置。',
      videoPrompt: '保持首帧主体外观，仅做轻微平行向右移动，结尾停稳。',
      firstFrame,
      ...(cameraControl ? { cameraControl } : {}),
    };
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] };
  });
  return createCreativeBriefServices(instance.services).prepare(actor, wid, {
    requestId: randomUUID(),
    input: value,
  });
}
async function tick(jobId?: string) {
  if (jobId)
    instance.services.db.sqlite
      .prepare('UPDATE job_items SET next_attempt_at=? WHERE job_id=?')
      .run('2000-01-01T00:00:00.000Z', jobId);
  await worker.tick();
  await worker.drain();
}
function generationCalls() {
  return call.mock.calls.filter(([url]) => !url.endsWith('/chat/completions'));
}

describe('native durable pipeline integration', () => {
  it('executes an image without decrypting an unrelated broken video connection', async () => {
    const preparation = await prepare();
    const quote = instance.services.quote(actor, wid, preparation.input);
    const job = instance.services.submit(actor, wid, preparation.input, quote.id, randomUUID());
    instance.services.db.sqlite
      .prepare(
        "UPDATE model_connections SET encrypted_secret='invalid-fixture' WHERE workspace_id=? AND kind='video'",
      )
      .run(wid);
    await expect(worker.runItem(worker.claim()!)).resolves.toBeUndefined();
    expect(instance.services.get(actor, wid, job.id)).toMatchObject({
      status: 'succeeded',
      settledCredits: 8,
    });
    expect(generationCalls()).toHaveLength(1);
    expect(instance.services.credits.account(wid).reserved).toBe(0);
  });
  it('releases an unsubmitted image when its required connection cannot be decrypted', async () => {
    const preparation = await prepare();
    const before = instance.services.credits.account(wid).balance;
    const quote = instance.services.quote(actor, wid, preparation.input);
    const job = instance.services.submit(actor, wid, preparation.input, quote.id, randomUUID());
    instance.services.db.sqlite
      .prepare(
        "UPDATE model_connections SET encrypted_secret='invalid-fixture' WHERE workspace_id=? AND kind='image'",
      )
      .run(wid);
    await expect(worker.runItem(worker.claim()!)).resolves.toBeUndefined();
    expect(instance.services.get(actor, wid, job.id)).toMatchObject({
      status: 'failed',
      settledCredits: 0,
      errorMessage: '模型配置密钥无法解密，请重新保存密钥。',
    });
    expect(generationCalls()).toHaveLength(0);
    expect(instance.services.credits.account(wid)).toMatchObject({ balance: before, reserved: 0 });
  });
  it.each(['configured', 'invalid-credentials', 'processing-recovery'] as const)(
    'quotes and executes an approved exact pan with %s at zero model credits',
    async (mode) => {
      const value = await referenceInput();
      value.prompt =
        '商品全程静止，相机向右小幅平移2%，保持主体结构，允许裁切少量边缘背景，不调用视频模型。';
      const preparation = await prepareFrame(
        value,
        { mode: 'reference', assetId: value.assetIds[0]! },
        { type: 'translate', direction: 'right', displacementPercent: 2 },
      );
      const before = instance.services.credits.account(wid);
      const quotation = instance.services.quote(actor, wid, preparation.input);
      expect(quotation.maxCredits).toBe(0);
      const job = instance.services.submit(
        actor,
        wid,
        preparation.input,
        quotation.id,
        randomUUID(),
      );
      if (mode !== 'configured')
        instance.services.db.sqlite
          .prepare(
            "UPDATE model_connections SET encrypted_secret='invalid-fixture' WHERE workspace_id=?",
          )
          .run(wid);
      if (mode === 'processing-recovery')
        instance.services.db.sqlite
          .prepare(
            "UPDATE job_items SET status='running',phase='processing',lease_owner=NULL,lease_until=NULL WHERE job_id=?",
          )
          .run(job.id);
      await tick();
      const done = instance.services.get(actor, wid, job.id);
      expect(done.status).toBe('succeeded');
      expect(done.settledCredits).toBe(0);
      expect(done.outputAssets).toHaveLength(1);
      expect(done.outputAssets[0]).toMatchObject({
        kind: 'video',
        width: 960,
        height: 960,
        durationMs: 5000,
      });
      const asset = instance.services.core.assets.get(actor, wid, done.outputAssets[0]!.id);
      expect(asset.source).toBe('local-processing');
      expect(generationCalls()).toHaveLength(0);
      expect(instance.services.credits.account(wid).balance).toBe(before.balance);
      expect(instance.services.credits.account(wid).reserved).toBe(0);
    },
    60000,
  );
  it.each(['buffer', 'url'] as const)(
    'holds an undersized native image from %s before settlement and recovers only the cached bytes',
    async (transport) => {
      const preparation = await prepare();
      const accountBefore = instance.services.credits.account(wid);
      const quotation = instance.services.quote(actor, wid, preparation.input);
      const job = instance.services.submit(
        actor,
        wid,
        preparation.input,
        quotation.id,
        randomUUID(),
      );
      call.mockResolvedValueOnce({
        data: [
          {
            ...(transport === 'buffer'
              ? { b64_json: png.toString('base64') }
              : { url: 'https://media.example/undersized.png' }),
            // The remote service cannot declare its own lower acceptance expectation.
            expectedImageSize: { width: 512, height: 512 },
          },
        ],
      });
      download.mockResolvedValue(png);
      await tick();
      const held = instance.services.get(actor, wid, job.id);
      expect(held.status).toBe('reconciliation_required');
      expect(held.errorMessage).toContain('应为2048×2048像素，实际为512×512像素');
      expect(held.outputAssets).toHaveLength(0);
      expect(held.settledCredits).toBe(0);
      expect(instance.services.credits.account(wid)).toMatchObject({
        balance: accountBefore.balance,
        reserved: accountBefore.reserved + quotation.maxCredits,
      });
      const row = instance.services.db.sqlite
        .prepare('SELECT result_json,recovery_failures,phase FROM job_items WHERE id=?')
        .get(held.items[0]!.id) as {
        result_json: string;
        recovery_failures: number;
        phase: string;
      };
      expect(row).toMatchObject({ recovery_failures: 0, phase: 'downloading' });
      const cache = JSON.parse(row.result_json) as {
        outputs: {
          path: string;
          url?: string;
          expectedImageSize: { width: number; height: number };
        }[];
      };
      expect(cache.outputs[0]!.expectedImageSize).toEqual({ width: 2048, height: 2048 });
      expect(cache.outputs[0]!.url).toBeUndefined();
      expect(await readFile(cache.outputs[0]!.path)).toEqual(png);
      const callsBefore = call.mock.calls.length;
      await worker.stop();
      worker = createWorker(instance.services);
      // Changing current configuration must not rewrite the old request's expected size.
      instance.services.settings.connections.update(wid, {
        kind: 'image',
        protocol: 'openai-images',
        baseUrl: 'https://other-fixture.example/v1',
        modelsUrl: '',
        model: 'changed-image-model',
        enabled: true,
        secret: 'changed-fixture-secret',
      });
      instance.services.resumeResult(actor, wid, job.id);
      await tick(job.id);
      const recovered = instance.services.get(actor, wid, job.id);
      expect(recovered.status).toBe('reconciliation_required');
      expect(recovered.errorMessage).toContain('应为2048×2048像素，实际为512×512像素');
      expect(recovered.settledCredits).toBe(0);
      expect(instance.services.credits.account(wid)).toMatchObject({
        balance: accountBefore.balance,
        reserved: accountBefore.reserved + quotation.maxCredits,
      });
      expect(call).toHaveBeenCalledTimes(callsBefore);
      expect(download).toHaveBeenCalledTimes(transport === 'url' ? 1 : 0);
      expect(await readFile(cache.outputs[0]!.path)).toEqual(png);
    },
  );
  it('holds legacy cached images without a trusted request size instead of inferring it from current settings', async () => {
    const preparation = await prepare();
    const quotation = instance.services.quote(actor, wid, preparation.input);
    const job = instance.services.submit(actor, wid, preparation.input, quotation.id, randomUUID());
    call.mockResolvedValueOnce({ data: [{ b64_json: png.toString('base64') }] });
    await tick();
    const held = instance.services.get(actor, wid, job.id);
    expect(held.status).toBe('reconciliation_required');
    const row = instance.services.db.sqlite
      .prepare('SELECT result_json FROM job_items WHERE id=?')
      .get(held.items[0]!.id) as { result_json: string };
    const cache = JSON.parse(row.result_json) as {
      outputs: { path: string; expectedImageSize?: { width: number; height: number } }[];
    };
    // Isolated upgrade fixture: an older cache lacks request metadata even though its pixels
    // would happen to pass if compared against the currently selected 2K configuration.
    delete cache.outputs[0]!.expectedImageSize;
    await writeFile(cache.outputs[0]!.path, generatedPng);
    instance.services.db.sqlite
      .prepare('UPDATE job_items SET result_json=? WHERE id=?')
      .run(JSON.stringify(cache), held.items[0]!.id);
    const callsBefore = call.mock.calls.length;
    await worker.stop();
    worker = createWorker(instance.services);
    instance.services.resumeResult(actor, wid, job.id);
    await tick(job.id);
    const recovered = instance.services.get(actor, wid, job.id);
    expect(recovered.status).toBe('reconciliation_required');
    expect(recovered.errorMessage).toContain('缺少可信的原始请求像素规格');
    expect(recovered.outputAssets).toHaveLength(0);
    expect(recovered.settledCredits).toBe(0);
    expect(call).toHaveBeenCalledTimes(callsBefore);
    expect(download).not.toHaveBeenCalled();
    expect(await readFile(cache.outputs[0]!.path)).toEqual(generatedPng);
  });
  it('uses the approved original frame byte for byte without generating an image, and settles only video credits', async () => {
    const videoPath = join(dir, 'reference-fixture.mp4');
    await exec('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=960x960:d=5:r=12',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ]);
    download.mockResolvedValue(await readFile(videoPath));
    const value = await referenceInput();
    const preparation = await prepareFrame(value, {
      mode: 'reference',
      assetId: value.assetIds[0]!,
    });
    // A client cannot turn an approved original into a generated first frame either.
    const submitted = {
      ...preparation.input,
      nativePlan: {
        imagePrompt: '客户端重画',
        videoPrompt: '客户端运镜',
        firstFrame: { mode: 'generate' as const },
      },
    };
    const quotation = instance.services.quote(actor, wid, submitted);
    expect(quotation.maxCredits).toBe(25);
    const job = instance.services.submit(actor, wid, submitted, quotation.id, randomUUID());
    await tick();
    const pending = instance.services.get(actor, wid, job.id);
    expect(pending.status).toBe('running');
    const frame = instance.services.db.sqlite
      .prepare('SELECT asset_id FROM native_generation_frames WHERE item_id=?')
      .get(pending.items[0]!.id) as { asset_id: string };
    const savedFrame = await instance.services.core.assets.readOriginalForJob(
      { workspaceId: wid, createdBy: actor.userId, projectId: pending.projectId, jobId: job.id },
      frame.asset_id,
    );
    expect(savedFrame.buffer).toEqual(png);
    const submissions = generationCalls().filter(([, options]) => options?.method !== 'GET');
    expect(submissions).toHaveLength(1);
    expect(submissions[0]![0]).toBe(taskBase);
    expect(submissions[0]![1]?.body).toMatchObject({
      content: expect.arrayContaining([
        {
          type: 'image_url',
          role: 'first_frame',
          image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
        },
      ]),
    });
    await tick(job.id);
    expect(instance.services.get(actor, wid, job.id)).toMatchObject({
      status: 'succeeded',
      settledCredits: 25,
    });
    expect(generationCalls().filter(([url]) => url.endsWith('/images/generations'))).toHaveLength(
      0,
    );
  });
  it('does not let a client-supplied original-frame plan waive the approved image-generation charge', async () => {
    const value = await referenceInput();
    const preparation = await prepareFrame(value, { mode: 'generate' });
    const forged = {
      ...preparation.input,
      nativePlan: {
        imagePrompt: '客户端跳过重画',
        videoPrompt: '客户端运镜',
        firstFrame: { mode: 'reference' as const, assetId: value.assetIds[0]! },
        cameraControl: { type: 'zoom' as const, scalePercent: 103 },
        videoPostprocess: 'model-video-tail-hold-v1' as const,
      },
    };
    const quotation = instance.services.quote(actor, wid, forged);
    expect(quotation.maxCredits).toBe(33);
    const job = instance.services.submit(actor, wid, forged, quotation.id, randomUUID());
    await tick();
    expect(instance.services.get(actor, wid, job.id).status).toBe('running');
    expect(generationCalls().filter(([url]) => url.endsWith('/images/generations'))).toHaveLength(
      1,
    );
    const execution = instance.services.db.sqlite
      .prepare('SELECT input_json FROM job_items WHERE job_id=?')
      .get(job.id) as { input_json: string };
    expect(JSON.parse(execution.input_json).nativePlan.firstFrame).toEqual({ mode: 'generate' });
    expect(JSON.parse(execution.input_json).nativePlan.videoPostprocess).toBeUndefined();
  });

  it('freezes the disclosed model tail hold at the original video price even if a client removes its flag', async () => {
    const value = await referenceInput();
    value.prompt = '主体全程静止，相机机位固定，画面中心固定，整幅等比放大到103%，最后0.5秒停稳。';
    const preparation = await prepareFrame(
      value,
      { mode: 'reference', assetId: value.assetIds[0]! },
      { type: 'zoom', scalePercent: 103 },
    );
    expect(preparation.result?.summary).toContain('本机将原片完整时间范围');
    const submitted = { ...preparation.input, nativePlan: undefined };
    const quotation = instance.services.quote(actor, wid, submitted);
    expect(quotation.maxCredits).toBe(25);
    const job = instance.services.submit(actor, wid, submitted, quotation.id, randomUUID());
    const execution = instance.services.db.sqlite
      .prepare('SELECT input_json FROM job_items WHERE job_id=?')
      .get(job.id) as { input_json: string };
    expect(JSON.parse(execution.input_json).nativePlan.videoPostprocess).toBe(
      'model-video-tail-hold-v1',
    );
    expect(generationCalls()).toHaveLength(0);
  });
  it('retains the original-frame price and exact image on an explicit failed-video retry', async () => {
    videoStatus = 'failed';
    const value = await referenceInput();
    const preparation = await prepareFrame(value, {
      mode: 'reference',
      assetId: value.assetIds[0]!,
    });
    const quotation = instance.services.quote(actor, wid, preparation.input);
    expect(quotation.maxCredits).toBe(25);
    const job = instance.services.submit(actor, wid, preparation.input, quotation.id, randomUUID());
    await tick();
    await tick(job.id);
    expect(instance.services.get(actor, wid, job.id).status).toBe('failed');
    const retryQuote = instance.services.retryQuote(actor, wid, job.id);
    expect(retryQuote.maxCredits).toBe(25);
    const retry = instance.services.submit(
      actor,
      wid,
      preparation.input,
      retryQuote.id,
      randomUUID(),
    );
    await tick();
    expect(instance.services.get(actor, wid, retry.id).status).toBe('running');
    expect(generationCalls().filter(([url]) => url.endsWith('/images/generations'))).toHaveLength(
      0,
    );
    const submissions = generationCalls().filter(
      ([url, options]) => url === taskBase && options?.method !== 'GET',
    );
    expect(submissions).toHaveLength(2);
    expect(submissions[0]![1]?.body).toEqual(submissions[1]![1]?.body);
    expect(call.mock.calls.filter(([url]) => url.endsWith('/chat/completions'))).toHaveLength(1);
  });
  it('rejects a planner-selected original that is not attached, before issuing a quote', async () => {
    const value = await referenceInput();
    const unattached = await instance.services.core.assets.ingest(actor, wid, {
      buffer: png,
      name: '未选择的图片.png',
      mimeType: 'image/png',
    });
    await expect(
      prepareFrame(value, { mode: 'reference', assetId: unattached.id }),
    ).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_FAILED' });
    expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({
      n: 0,
    });
    expect(generationCalls()).toHaveLength(0);
  });
  it('rejects a mismatched original-frame ratio before quotation instead of silently cropping it', async () => {
    const value = await referenceInput();
    value.options.ratio = '16:9';
    await expect(
      prepareFrame(value, { mode: 'reference', assetId: value.assetIds[0]! }),
    ).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_FAILED' });
    expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({
      n: 0,
    });
    expect(generationCalls()).toHaveLength(0);
  });
  it('rejects a reference removed after planning instead of issuing a discounted quote', async () => {
    const value = await referenceInput();
    const preparation = await prepareFrame(value, {
      mode: 'reference',
      assetId: value.assetIds[0]!,
    });
    instance.services.core.assets.remove(actor, wid, value.assetIds[0]!);
    expect(() => instance.services.quote(actor, wid, preparation.input)).toThrow();
    expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({
      n: 0,
    });
    expect(generationCalls()).toHaveLength(0);
  });
  it('rejects another workspace original before planning or quotation', async () => {
    const other = instance.services.core.auth.createWorkspace(actor.userId, '另一空间', 'team');
    const reference = await instance.services.core.assets.ingest(actor, other.id, {
      buffer: png,
      name: '私有首帧.png',
      mimeType: 'image/png',
    });
    const value = input('video');
    value.assetIds = [reference.id];
    await expect(
      createCreativeBriefServices(instance.services).prepare(actor, wid, {
        requestId: randomUUID(),
        input: value,
      }),
    ).rejects.toThrow();
    expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({
      n: 0,
    });
    expect(call).not.toHaveBeenCalled();
  });
  it('persists received invalid planning as failed, observes it once and permits an explicit new request', async () => {
    const raw = {
      choices: [{ finish_reason: 'stop', message: { content: '{"status":"ready"}' } }],
    };
    call.mockResolvedValueOnce(raw);
    const observer = vi.fn(async () => {});
    const briefs = createCreativeBriefServices(instance.services, {
      nativePlannerObserver: observer,
    });
    await expect(
      briefs.prepare(actor, wid, { requestId: randomUUID(), input: input('video') }),
    ).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_FAILED' });
    expect(observer).toHaveBeenCalledExactlyOnceWith(raw);
    expect(call).toHaveBeenCalledTimes(1);
    const failed = instance.services.db.sqlite
      .prepare('SELECT id,state,error_message FROM creative_briefs')
      .get() as { id: string; state: string; error_message: string };
    expect(failed.state).toBe('failed');
    expect(failed.error_message).toContain('重新整理');
    expect(() => briefs.get(actor, wid, failed.id)).toThrow('重新整理');
    expect(generationCalls()).toHaveLength(0);
    const ready = await briefs.prepare(actor, wid, {
      requestId: randomUUID(),
      input: input('video'),
    });
    expect(ready.status).toBe('ready');
    expect(observer).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledTimes(2);
    expect(instance.services.quote(actor, wid, ready.input).maxCredits).toBe(33);
  });
  it('classifies only the exact legacy invalid-plan diagnostic as retryable without rewriting uncertain records', async () => {
    call.mockRejectedValueOnce(new ProviderError('transport not resolved', true));
    await expect(prepare()).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    const sql = instance.services.db.sqlite;
    const row = sql.prepare('SELECT id FROM creative_briefs').get() as { id: string };
    const briefs = createCreativeBriefServices(instance.services);
    expect(() => briefs.get(actor, wid, row.id)).toThrow('transport not resolved');
    sql
      .prepare('UPDATE creative_briefs SET error_message=? WHERE id=?')
      .run(
        '文本模型返回的策划不完整、事实依据不符或输出被截断；已停止生成，请核对本次调用。',
        row.id,
      );
    try {
      briefs.get(actor, wid, row.id);
      throw new Error('Expected a failed-plan diagnostic');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'CREATIVE_BRIEF_FAILED',
        message: expect.stringContaining('重新整理'),
      });
    }
    expect(sql.prepare('SELECT state FROM creative_briefs WHERE id=?').get(row.id)).toEqual({
      state: 'uncertain',
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('plans once, freezes the approved image prompt, generates, stores and reopens the exact image', async () => {
    const preparation = await prepare();
    expect(call.mock.calls).toHaveLength(1);
    expect(generationCalls()).toHaveLength(0);
    const quotation = instance.services.quote(actor, wid, preparation.input);
    expect(quotation.maxCredits).toBe(8);
    const job = instance.services.submit(actor, wid, preparation.input, quotation.id, randomUUID());
    await tick();
    const saved = instance.services.get(actor, wid, job.id);
    expect(saved.status).toBe('succeeded');
    expect(saved.outputAssets).toHaveLength(1);
    expect(saved.outputAssets[0]!.kind).toBe('image');
    const original = await instance.services.core.assets.readOriginalForJob(
      { workspaceId: wid, createdBy: actor.userId, projectId: null, jobId: job.id },
      saved.outputAssets[0]!.id,
    );
    expect(original.buffer).toEqual(generatedPng);
    expect(saved.settledCredits).toBe(8);
    expect(generationCalls()).toHaveLength(1);
  });
  it('produces one saved first frame, polls the same task, and saves a fully decodable video', async () => {
    const videoPath = join(dir, 'fixture.mp4');
    await exec('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=960x960:d=5:r=12',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      videoPath,
    ]);
    const mp4 = await readFile(videoPath);
    download.mockResolvedValue(mp4);
    const preparation = await prepare('video');
    const quotation = instance.services.quote(actor, wid, preparation.input);
    expect(quotation.maxCredits).toBe(33);
    const job = instance.services.submit(actor, wid, preparation.input, quotation.id, randomUUID());
    await tick();
    const pending = instance.services.get(actor, wid, job.id);
    expect(pending.status).toBe('running');
    expect(pending.items[0]!.remoteId).toMatch(/^native-video-/);
    const frame = instance.services.db.sqlite
      .prepare('SELECT * FROM native_generation_frames WHERE item_id=?')
      .get(pending.items[0]!.id) as { asset_id: string };
    expect(frame.asset_id).toBeTruthy();
    expect(instance.services.core.assets.get(actor, wid, frame.asset_id).kind).toBe('image');
    // A fresh worker resumes from persisted remote metadata; it does not call image/video POST again.
    await worker.stop();
    worker = createWorker(instance.services);
    await tick(job.id);
    const completed = instance.services.get(actor, wid, job.id);
    expect(completed.status).toBe('succeeded');
    expect(completed.outputAssets).toHaveLength(1);
    expect(completed.outputAssets[0]).toMatchObject({
      kind: 'video',
      durationMs: 5000,
      width: 960,
      height: 960,
    });
    const original = await instance.services.core.assets.readOriginalForJob(
      { workspaceId: wid, createdBy: actor.userId, projectId: null, jobId: job.id },
      completed.outputAssets[0]!.id,
    );
    expect(original.buffer).toEqual(mp4);
    await exec('ffmpeg', ['-v', 'error', '-i', videoPath, '-f', 'null', '-']);
    expect(completed.settledCredits).toBe(33);
    expect(generationCalls().filter(([, options]) => options?.method !== 'GET')).toHaveLength(2);
    expect(generationCalls().filter(([, options]) => options?.method === 'GET')).toHaveLength(1);
    expect(download).toHaveBeenCalledTimes(1);
  });
  it('reuses a saved first frame on explicit retry and does not charge its fixed credits twice', async () => {
    videoStatus = 'failed';
    const preparation = await prepare('video');
    const quotation = instance.services.quote(actor, wid, preparation.input);
    const original = instance.services.submit(
      actor,
      wid,
      preparation.input,
      quotation.id,
      randomUUID(),
    );
    await tick();
    await tick(original.id);
    expect(instance.services.get(actor, wid, original.id).status).toBe('failed');
    const retryQuote = instance.services.retryQuote(actor, wid, original.id);
    expect(retryQuote.maxCredits).toBe(25);
    const retry = instance.services.submit(
      actor,
      wid,
      preparation.input,
      retryQuote.id,
      randomUUID(),
    );
    await tick();
    expect(instance.services.get(actor, wid, retry.id).status).toBe('running');
    expect(generationCalls().filter(([url]) => url.endsWith('/images/generations'))).toHaveLength(
      1,
    );
    expect(generationCalls().filter(([url]) => url === taskBase)).toHaveLength(2);
    expect(call.mock.calls.filter(([url]) => url.endsWith('/chat/completions'))).toHaveLength(1);
  });
  it.each([
    ['512x512', 5],
    ['960x960', 3],
  ] as const)(
    'holds wrong-spec video %s / %ss for reconciliation and preserves its original bytes',
    async (size, duration) => {
      const videoPath = join(dir, 'wrong-spec.mp4');
      await exec('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=blue:s=${size}:d=${duration}:r=12`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        videoPath,
      ]);
      const mp4 = await readFile(videoPath);
      download.mockResolvedValue(mp4);
      const preparation = await prepare('video');
      const quotation = instance.services.quote(actor, wid, preparation.input);
      const job = instance.services.submit(
        actor,
        wid,
        preparation.input,
        quotation.id,
        randomUUID(),
      );
      await tick();
      await tick(job.id);
      const held = instance.services.get(actor, wid, job.id);
      expect(held.status).toBe('reconciliation_required');
      expect(held.errorMessage).toContain('应为960×960像素、5秒');
      expect(held.errorMessage).toContain(`实际为${size.replace('x', '×')}像素、${duration}秒`);
      expect(held.outputAssets).toHaveLength(0);
      expect(held.settledCredits).toBe(0);
      const row = instance.services.db.sqlite
        .prepare('SELECT result_json FROM job_items WHERE id=?')
        .get(held.items[0]!.id) as { result_json: string };
      const cache = JSON.parse(row.result_json) as { outputs: { path: string; url?: string }[] };
      expect(await readFile(cache.outputs[0]!.path)).toEqual(mp4);
      expect(cache.outputs[0]!.url).toBeUndefined();
      const callsBefore = call.mock.calls.length;
      instance.services.resumeResult(actor, wid, job.id);
      await tick(job.id);
      expect(instance.services.get(actor, wid, job.id).status).toBe('reconciliation_required');
      expect(download).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledTimes(callsBefore);
    },
  );
  it('holds an ambiguous video submission for reconciliation without repeating either generation', async () => {
    const preparation = await prepare('video');
    const quotation = instance.services.quote(actor, wid, preparation.input);
    const job = instance.services.submit(actor, wid, preparation.input, quotation.id, randomUUID());
    call.mockResolvedValueOnce({ data: [{ b64_json: generatedPng.toString('base64') }] });
    call.mockRejectedValueOnce(new ProviderError('fixture timeout after submit', true));
    await tick();
    const held = instance.services.get(actor, wid, job.id);
    expect(held.status).toBe('reconciliation_required');
    expect(
      instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM native_generation_frames').get(),
    ).toEqual({ n: 1 });
    const before = call.mock.calls.length;
    await worker.stop();
    worker = createWorker(instance.services);
    await tick(job.id);
    expect(call).toHaveBeenCalledTimes(before);
    expect(() => instance.services.retryQuote(actor, wid, job.id)).toThrow('没有可重试项');
  });
  it('rejects direct unplanned generation and a resource change after quotation without model spend', async () => {
    expect(() => instance.services.quote(actor, wid, input())).toThrow('先整理');
    expect(call).not.toHaveBeenCalled();
    const preparation = await prepare();
    const quotation = instance.services.quote(actor, wid, preparation.input);
    const current = instance.services.settings.connections.get(wid, 'image');
    instance.services.settings.connections.update(wid, {
      kind: 'image',
      protocol: current.protocol,
      baseUrl: current.baseUrl,
      modelsUrl: current.modelsUrl,
      model: 'changed-model',
      enabled: true,
    });
    expect(() =>
      instance.services.submit(actor, wid, preparation.input, quotation.id, randomUUID()),
    ).toThrow();
    expect(generationCalls()).toHaveLength(0);
  });
  it('keeps the generated first frame and stops before video submission when settings change mid-run', async () => {
    const preparation = await prepare('video');
    const quotation = instance.services.quote(actor, wid, preparation.input);
    const job = instance.services.submit(actor, wid, preparation.input, quotation.id, randomUUID());
    call.mockImplementationOnce(async () => {
      instance.services.settings.connections.update(wid, {
        kind: 'image',
        protocol: 'seedream-images',
        baseUrl: 'https://fixture.example/v1',
        modelsUrl: '',
        model: 'fixture-image',
        enabled: false,
      });
      return { data: [{ b64_json: generatedPng.toString('base64') }] };
    });
    await tick();
    expect(instance.services.get(actor, wid, job.id)).toMatchObject({
      status: 'failed',
      errorMessage: '模型连接已改变，已保留首帧并停止后续视频生成。',
    });
    expect(
      instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM native_generation_frames').get(),
    ).toEqual({ n: 1 });
    expect(generationCalls()).toHaveLength(1);
    expect(generationCalls()[0]![0]).toContain('/images/generations');
  });
  it('allows a rotated key to query the existing same-endpoint same-model video without resubmission', async () => {
    videoStatus = 'failed';
    const preparation = await prepare('video');
    const quotation = instance.services.quote(actor, wid, preparation.input);
    const job = instance.services.submit(actor, wid, preparation.input, quotation.id, randomUUID());
    await tick();
    const remoteId = instance.services.get(actor, wid, job.id).items[0]!.remoteId;
    instance.services.settings.connections.update(wid, {
      kind: 'video',
      protocol: 'seedance-native',
      baseUrl: taskBase,
      modelsUrl: '',
      model: 'doubao-seedance-2.0',
      enabled: true,
      secret: 'rotated-fixture-key',
    });
    await tick(job.id);
    expect(instance.services.get(actor, wid, job.id).status).toBe('failed');
    expect(call.mock.calls.at(-1)).toEqual([
      `${taskBase}/${remoteId}`,
      { method: 'GET', headers: { Authorization: 'Bearer rotated-fixture-key' }, timeoutMs: 30000 },
    ]);
    expect(generationCalls().filter(([, options]) => options?.method !== 'GET')).toHaveLength(2);
  });
});

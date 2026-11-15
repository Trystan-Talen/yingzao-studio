/** Independent stage-recovery checks: real owned briefs/quotes, isolated media, no model transport. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Actor } from '../src/contracts/core';
import type { CreativeIntentRequest, CreativeIntentResult } from '../src/contracts/creative-intent';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import { analyzeNativeIntent } from '../src/server/providers/native-planner';
import { analyzeNativeBackgroundStudy } from '../src/server/providers/native-background-study';
import { analyzeNativeReferenceStudy } from '../src/server/providers/native-reference-study';
import { probeLocalMatting } from '../src/server/providers/local-matting';
import { nativeProviderJson } from '../src/server/providers/native-http';
import { createCreativeBriefServices } from '../src/server/tasks/creative-briefs';
import { ProviderError } from '../src/server/tasks/types';

vi.mock('../src/server/providers/local-matting', async (original) => ({
  ...(await original<typeof import('../src/server/providers/local-matting')>()),
  probeLocalMatting: vi.fn(async () => ({ identity: 'isolated-installation-contract' })),
}));
vi.mock('../src/server/providers/native-planner', async (original) => ({
  ...(await original<typeof import('../src/server/providers/native-planner')>()),
  analyzeNativeIntent: vi.fn(),
}));
vi.mock('../src/server/providers/native-background-study', () => ({
  analyzeNativeBackgroundStudy: vi.fn(),
}));
vi.mock('../src/server/providers/native-reference-study', () => ({
  analyzeNativeReferenceStudy: vi.fn(),
}));
vi.mock('../src/server/providers/native-http', () => ({ nativeProviderJson: vi.fn() }));
const planner = vi.mocked(analyzeNativeIntent);
const background = vi.mocked(analyzeNativeBackgroundStudy);
const referenceStudy = vi.mocked(analyzeNativeReferenceStudy);
const transport = vi.mocked(nativeProviderJson);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let app: Awaited<ReturnType<typeof createApp>>, directory: string, actor: Actor, wid: string;
let sourceId: string, referenceId: string;
const textConnection = (model = 'fixture-planner') => ({
  kind: 'text' as const,
  protocol: 'openai-chat' as const,
  baseUrl: 'https://native-recovery.invalid/v1',
  modelsUrl: '',
  model,
  visionModel: 'fixture-vision',
  enabled: true,
  secret: 'unused-isolated-fixture',
});
function plan(request: CreativeIntentRequest, edit = true): CreativeIntentResult {
  return {
    type: 'intent-plan',
    version: 1,
    requestId: request.requestId,
    status: 'ready',
    brief: {
      scope: 'product',
      subject: '自己的杯子',
      goal: '保留主体进行画面创作',
      mediaType: request.context.mediaType,
      platform: request.context.platform,
      placement: request.context.placement,
      market: request.context.market,
      productMode: 'reference',
      facts: [],
      constraints: [],
    },
    summary: '保持原图主体与台面，只调整已指定区域。',
    assumptions: [],
    questions: [],
    prompt: request.rawPrompt,
    reviewChecklist: ['核对主体保持原样'],
    ...(edit
      ? {
          imageEdit: {
            type: 'solid-background' as const,
            sourceAssetId: sourceId,
            color: '#e6e8eb',
            regionDescription: '后方背景',
            preserveDescription: '主体与台面',
            mask: { mode: 'generate' as const },
          },
        }
      : {}),
  };
}
function raw(): JobInput {
  return jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'native',
    prompt: '仅将后方背景改为#e6e8eb，保留主体与台面。',
    assetIds: [sourceId],
    options: { model: 'doubao-seedream-5.0-lite', resolution: '2K', ratio: '1:1', needText: false },
  });
}
const service = () => createCreativeBriefServices(app.services);
const prepare = (
  input = raw(),
  extra: {
    requestId?: string;
    previousId?: string;
    answers?: { questionId: string; answer: string }[];
  } = {},
) => service().prepare(actor, wid, { requestId: randomUUID(), input, ...extra });
function row(requestId: string) {
  return app.services.db.sqlite
    .prepare('SELECT * FROM creative_briefs WHERE request_id=?')
    .get(requestId) as {
    id: string;
    state: string;
    result_json: string | null;
    compiled_prompt: string | null;
    input_json: string;
    request_json: string;
    background_study_json: string | null;
  };
}
function assertNotQuotable(input: JobInput, requestId: string, code = 'CREATIVE_BRIEF_NOT_READY') {
  expect(() =>
    app.services.quote(actor, wid, { ...input, creativeBriefId: row(requestId).id }),
  ).toThrow(expect.objectContaining({ code }));
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({ n: 0 });
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
}
beforeEach(async () => {
  planner.mockReset();
  background.mockReset();
  referenceStudy.mockReset();
  transport.mockReset();
  directory = await mkdtemp(join(tmpdir(), 'yingzao-native-planning-recovery-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(directory, 'fixture.sqlite'),
      storageDir: join(directory, 'media'),
      sessionSecret: 'isolated-session',
      encryptionKey: 'isolated-encryption',
      isProduction: false,
      demoMode: false,
      environmentSecrets: {},
    },
    { serveWeb: false },
  );
  const account = await app.services.core.auth.register({
    email: 'recovery@example.local',
    password: 'IsolatedFixture2026!',
    displayName: '阶段恢复测试',
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
    description: '隔离积分',
  });
  app.services.settings.connections.update(wid, textConnection());
  app.services.settings.connections.update(wid, {
    kind: 'image',
    protocol: 'seedream-images',
    baseUrl: 'https://native-recovery.invalid/v1',
    modelsUrl: '',
    model: 'doubao-seedream-5.0-lite',
    enabled: true,
    secret: 'unused-isolated-fixture',
  });
  const ingest = async (color: string, name: string) =>
    app.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({ create: { width: 2048, height: 2048, channels: 3, background: color } })
        .png()
        .toBuffer(),
      name,
      mimeType: 'image/png',
    });
  sourceId = (await ingest('#846731', '主体.png')).id;
  referenceId = (await ingest('#203067', '风格.png')).id;
  planner.mockImplementation(async (request) => plan(request));
  background.mockImplementation(async (input, connection) => ({
    regionDescription: input.regionDescription,
    preserveDescription: input.preserveDescription,
    boundaryNotes: '保留杯子轮廓与台面，仅分析后方背景。',
    uncertainties: [],
    evidence: {
      sourceSha256: hash(input.source.buffer),
      model: connection.model,
      analyzedAt: new Date().toISOString(),
    },
  }));
  referenceStudy.mockImplementation(async ({ media }, connection) => ({
    study: {
      version: 1,
      referenceKind: 'image',
      visualStatus: 'readable',
      observations: ['参考提供构图'],
      motion: null,
      timeline: [],
      anchorFrameIndex: 0,
      transferGuidance: '保留自己的主体，只参考光线。',
      limitations: ['不保证逐像素复刻'],
    },
    evidence: {
      version: 1,
      referenceKind: 'image',
      referenceSha256: media.referenceSha256,
      subjectSha256: media.subjectSha256,
      subjectImageSha256: media.subject.sha256,
      model: connection.model,
      sampledAt: media.sampledAt,
      analyzedAt: new Date().toISOString(),
      timestampBasis: 'relative-to-selected-clip',
      clipStartSeconds: 0,
      clipDurationSeconds: 0,
      audioAnalyzed: false,
      frames: media.frames.map(
        ({ index, timestampSeconds, sourceTimestampSeconds, sha256, width, height }) => ({
          index,
          timestampSeconds,
          sourceTimestampSeconds,
          sha256,
          width,
          height,
        }),
      ),
    },
  }));
});
afterEach(async () => {
  await app?.app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('blocks a fresh ID while an ordinary native text stage is analyzing, then returns the completed same ID without another call', async () => {
  const input = raw(),
    requestId = randomUUID();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  planner.mockImplementationOnce(async (request) => {
    started();
    await held;
    return plan(request, false);
  });
  const active = prepare(input, { requestId });
  try {
    await entered;
    expect(row(requestId).state).toBe('analyzing');
    await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    expect(planner).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
    assertNotQuotable(input, requestId);
  } finally {
    release();
  }
  const result = await active;
  expect((await prepare(input, { requestId })).id).toBe(result.id);
  expect(planner).toHaveBeenCalledTimes(1);
});

for (const stage of ['text', 'background-vision'] as const) {
  it(`blocks fresh and original request IDs after an uncertain ${stage} result, with no usable quote`, async () => {
    const input = raw(),
      requestId = randomUUID();
    const error = new ProviderError('已提交但响应中断', true, 'PROVIDER_CONNECTION');
    if (stage === 'text') planner.mockRejectedValueOnce(error);
    else background.mockRejectedValueOnce(error);
    await expect(prepare(input, { requestId })).rejects.toMatchObject({
      code: 'CREATIVE_BRIEF_UNCERTAIN',
    });
    expect(row(requestId).state).toBe('uncertain');
    expect(Boolean(row(requestId).result_json)).toBe(stage === 'background-vision');
    await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    await expect(prepare(input, { requestId })).rejects.toMatchObject({
      code: 'CREATIVE_BRIEF_UNCERTAIN',
    });
    expect(planner).toHaveBeenCalledTimes(1);
    expect(background).toHaveBeenCalledTimes(stage === 'text' ? 0 : 1);
    assertNotQuotable(input, requestId);
  });
}

it('pins validated text on definite visual failure and reuses it under a fresh request with a matching new result ID', async () => {
  const input = raw(),
    first = randomUUID(),
    second = randomUUID();
  background.mockRejectedValueOnce(
    new ProviderError('视觉服务明确拒绝', false, 'PROVIDER_HTTP_403'),
  );
  await expect(prepare(input, { requestId: first })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_FAILED',
  });
  const failed = row(first);
  expect(failed.state).toBe('failed');
  expect(JSON.parse(failed.result_json!)).toMatchObject({
    requestId: first,
    imageEdit: { mask: { mode: 'generate' } },
  });
  expect(failed.compiled_prompt).toBeNull();
  assertNotQuotable(input, first);
  await expect(prepare(input, { requestId: first })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_FAILED',
  });
  expect(planner).toHaveBeenCalledTimes(1);
  expect(background).toHaveBeenCalledTimes(1);
  const recovered = await prepare(input, { requestId: second });
  expect(recovered.status).toBe('ready');
  expect(recovered.result.requestId).toBe(second);
  expect(recovered.result.imageEdit?.visualGuidance?.boundaryNotes).toContain('保留杯子');
  expect(planner).toHaveBeenCalledTimes(1);
  expect(background).toHaveBeenCalledTimes(2);
  expect(app.services.quote(actor, wid, recovered.input).maxCredits).toBeGreaterThan(0);
  expect(row(first).state).toBe('failed');
  expect(row(first).result_json).toBe(failed.result_json);
});

it('never treats an invalid text response as a reusable completed stage', async () => {
  const input = raw(),
    requestId = randomUUID();
  planner.mockImplementationOnce(async (request) => ({
    ...plan(request),
    requestId: randomUUID(),
  }));
  await expect(prepare(input, { requestId })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_FAILED',
  });
  expect(row(requestId).result_json).toBeNull();
  expect(background).not.toHaveBeenCalled();
  assertNotQuotable(input, requestId);
  expect((await prepare(input)).status).toBe('ready');
  expect(planner).toHaveBeenCalledTimes(2);
  expect(background).toHaveBeenCalledTimes(1);
});

for (const boundary of ['project', 'configuration', 'fingerprint', 'metadata'] as const) {
  it(`does not reuse a failed background text stage across a changed ${boundary}`, async () => {
    let input = raw();
    if (boundary === 'project')
      input = {
        ...input,
        projectId: app.services.core.projects.create(actor, wid, { name: '原项目', kind: 'image' })
          .id,
      };
    background.mockRejectedValueOnce(new ProviderError('视觉明确失败', false, 'PROVIDER_HTTP_403'));
    await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_FAILED' });
    if (boundary === 'project')
      input = {
        ...input,
        projectId: app.services.core.projects.create(actor, wid, {
          name: '另一项目',
          kind: 'image',
        }).id,
      };
    if (boundary === 'configuration')
      app.services.settings.connections.update(wid, textConnection('different-planner'));
    if (boundary === 'fingerprint')
      input = { ...input, prompt: `${input.prompt} 不改变杯子标签。` };
    if (boundary === 'metadata')
      app.services.core.assets.update(actor, wid, sourceId, { name: '重新命名的主体.png' });
    expect((await prepare(input)).status).toBe('ready');
    expect(planner).toHaveBeenCalledTimes(2);
    expect(background).toHaveBeenCalledTimes(2);
  });
}

for (const ambiguous of [false, true]) {
  it(`keeps different clarification answers isolated from ${ambiguous ? 'uncertain' : 'failed'} background text`, async () => {
    const input = raw();
    planner.mockImplementationOnce(async (request) => ({
      ...plan(request, false),
      status: 'needs_clarification',
      prompt: '',
      questions: [
        {
          id: 'background',
          field: 'reference',
          question: '需要保留什么？',
          reason: '明确边界',
          options: ['保留杯子与台面', '保留杯子、台面与阴影'],
        },
      ],
    }));
    const previous = await prepare(input);
    background.mockRejectedValueOnce(
      new ProviderError('视觉阶段未完成', ambiguous, 'PROVIDER_CONNECTION'),
    );
    const firstAnswers = [
      { questionId: 'background', answer: '仅将后方背景改为#e6e8eb，保留杯子与台面。' },
    ];
    await expect(
      prepare(input, { previousId: previous.id, answers: firstAnswers }),
    ).rejects.toMatchObject({
      code: ambiguous ? 'CREATIVE_BRIEF_UNCERTAIN' : 'CREATIVE_BRIEF_FAILED',
    });
    const recovered = await prepare(input, {
      previousId: previous.id,
      answers: [
        { questionId: 'background', answer: '仅将后方背景改为#e6e8eb，保留杯子、台面与阴影。' },
      ],
    });
    expect(recovered.status).toBe('ready');
    expect(planner).toHaveBeenCalledTimes(3);
    expect(background).toHaveBeenCalledTimes(2);
    expect(planner.mock.calls[2]![0].answers.at(-1)?.answer).toBe(
      '仅将后方背景改为#e6e8eb，保留杯子、台面与阴影。',
    );
  });
}

it('rechecks configuration after replica vision and never starts text using an outdated connection', async () => {
  const input = jobInputSchema.parse({
    ...raw(),
    prompt: '借鉴参考构图，保留自己的杯子。',
    referenceAssetIds: [referenceId],
    replica: {
      referenceAssetId: referenceId,
      subjectAssetId: sourceId,
      aspects: ['composition'],
      trimStart: 0,
    },
  });
  const vision = referenceStudy.getMockImplementation()!;
  referenceStudy.mockImplementationOnce(async (...args) => {
    const result = await vision(...args);
    app.services.settings.connections.update(wid, textConnection('rotated-planner'));
    return result;
  });
  planner.mockImplementation(async (request) => plan(request, false));
  const requestId = randomUUID();
  await expect(prepare(input, { requestId })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_FAILED',
  });
  expect(row(requestId).state).toBe('failed');
  expect(referenceStudy).toHaveBeenCalledTimes(1);
  expect(planner).not.toHaveBeenCalled();
  expect(background).not.toHaveBeenCalled();
  assertNotQuotable(input, requestId, 'CREATIVE_CONFIGURATION_CHANGED');
  expect((await prepare(input)).status).toBe('ready');
  expect(referenceStudy).toHaveBeenCalledTimes(2);
  expect(planner).toHaveBeenCalledTimes(1);
  expect(planner.mock.calls[0]![1].model).toBe('rotated-planner');
});

for (const boundary of ['project', 'configuration', 'fingerprint'] as const) {
  it(`does not block an explicitly different ${boundary} behind another request's uncertain text`, async () => {
    let input = raw();
    if (boundary === 'project')
      input = {
        ...input,
        projectId: app.services.core.projects.create(actor, wid, { name: '原项目', kind: 'image' })
          .id,
      };
    planner.mockRejectedValueOnce(
      new ProviderError('文本已提交，结果未知', true, 'PROVIDER_CONNECTION'),
    );
    const requestId = randomUUID();
    await expect(prepare(input, { requestId })).rejects.toMatchObject({
      code: 'CREATIVE_BRIEF_UNCERTAIN',
    });
    if (boundary === 'project')
      input = {
        ...input,
        projectId: app.services.core.projects.create(actor, wid, { name: '新项目', kind: 'image' })
          .id,
      };
    if (boundary === 'configuration')
      app.services.settings.connections.update(wid, textConnection('new-planner'));
    if (boundary === 'fingerprint') input = { ...input, prompt: `${input.prompt} 不改变原构图。` };
    expect((await prepare(input)).status).toBe('ready');
    expect(planner).toHaveBeenCalledTimes(2);
    expect(background).toHaveBeenCalledTimes(1);
    expect(row(requestId).state).toBe('uncertain');
  });
}

it('reclassifies only the known legacy invalid-response record on read and permits one explicit new preparation without rewriting history', async () => {
  const input = raw(),
    requestId = randomUUID();
  const legacyMessage =
    '文本模型返回的策划不完整、事实依据不符或输出被截断；已停止生成，请核对本次调用。';
  // Reproduce the old parser's precise persisted shape; no real provider call is made.
  planner.mockRejectedValueOnce(new ProviderError(legacyMessage, true, 'NATIVE_PLAN_INVALID'));
  await expect(prepare(input, { requestId })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_UNCERTAIN',
  });
  const original = row(requestId);
  expect(original.state).toBe('uncertain');
  expect(original.result_json).toBeNull();
  expect(() => service().get(actor, wid, original.id)).toThrow(
    expect.objectContaining({ code: 'CREATIVE_BRIEF_FAILED' }),
  );
  await expect(prepare(input, { requestId })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_FAILED',
  });
  expect(planner).toHaveBeenCalledTimes(1);
  assertNotQuotable(input, requestId);
  expect(row(requestId)).toEqual(original);
  const newRequestId = randomUUID();
  const recovered = await prepare(input, { requestId: newRequestId });
  expect(recovered.status).toBe('ready');
  expect(recovered.id).not.toBe(original.id);
  expect(recovered.result.requestId).toBe(newRequestId);
  expect(planner).toHaveBeenCalledTimes(2);
  expect(background).toHaveBeenCalledTimes(1);
  expect(row(requestId)).toEqual(original);
  expect(app.services.quote(actor, wid, recovered.input).maxCredits).toBeGreaterThan(0);
});

it('treats a reordered persisted request as the same uncertain stage instead of charging again for JSON key ordering', async () => {
  const input = raw(),
    requestId = randomUUID();
  planner.mockRejectedValueOnce(new ProviderError('传输结果仍未知', true, 'PROVIDER_CONNECTION'));
  await expect(prepare(input, { requestId })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_UNCERTAIN',
  });
  const original = row(requestId);
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, item]) => [key, reorder(item)]),
      );
    return value;
  };
  const reordered = JSON.stringify(reorder(JSON.parse(original.request_json)));
  expect(reordered).not.toBe(original.request_json);
  app.services.db.sqlite
    .prepare('UPDATE creative_briefs SET request_json=? WHERE id=?')
    .run(reordered, original.id);
  await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
  expect(() => service().get(actor, wid, original.id)).toThrow(
    expect.objectContaining({ code: 'CREATIVE_BRIEF_UNCERTAIN' }),
  );
  expect(planner).toHaveBeenCalledTimes(1);
  expect(background).not.toHaveBeenCalled();
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get()).toEqual({
    n: 1,
  });
  assertNotQuotable(input, requestId);
});

it.each(['background-surface-boundary', 'region-not-visible'] as const)(
  'asks about %s before freezing any executable mask plan or quote',
  async (scopeAmbiguity) => {
    const observe = background.getMockImplementation()!;
    background.mockImplementationOnce(async (...args) => ({
      ...(await observe(...args)),
      scopeAmbiguity,
    }));
    const requestId = randomUUID(),
      input = raw();
    const prepared = await prepare(input, { requestId });
    expect(prepared.status).toBe('needs_clarification');
    expect(prepared.result.prompt).toBe('');
    expect(prepared.result.imageEdit).toBeUndefined();
    expect(prepared.result.questions).toHaveLength(1);
    expect(prepared.result.questions[0]?.id).toBe('background_boundary');
    expect(prepared.input.imageEdit).toBeUndefined();
    expect(row(requestId).state).toBe('needs_clarification');
    expect(JSON.parse(row(requestId).input_json).imageEdit).toBeUndefined();
    const savedStudy = row(requestId).background_study_json;
    expect(JSON.parse(savedStudy!)).toMatchObject({
      version: 1,
      sourceAssetId: sourceId,
      color: '#e6e8eb',
      nativeRevision: JSON.parse(row(requestId).input_json).nativeRevision,
      study: {
        regionDescription: '后方背景',
        preserveDescription: '主体与台面',
        scopeAmbiguity,
        evidence: {
          model: 'fixture-vision',
          sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });
    assertNotQuotable(input, requestId);
    expect((await prepare(input, { requestId })).id).toBe(prepared.id);
    expect(planner).toHaveBeenCalledOnce();
    expect(background).toHaveBeenCalledOnce();
    if (scopeAmbiguity === 'background-surface-boundary') {
      const clarified = await prepare(input, {
        previousId: prepared.id,
        answers: [
          {
            questionId: 'background_boundary',
            answer: prepared.result.questions[0]!.options[0]!,
          },
        ],
      });
      expect(clarified.status).toBe('ready');
      expect(planner).toHaveBeenCalledTimes(2);
      expect(background).toHaveBeenCalledTimes(2);
      expect(row(requestId).state).toBe('needs_clarification');
      expect(row(requestId).background_study_json).toBe(savedStudy);
    }
  },
);

it('does not turn a disclosed fine-edge limitation into a needless scope question', async () => {
  const observe = background.getMockImplementation()!;
  background.mockImplementationOnce(async (...args) => ({
    ...(await observe(...args)),
    scopeAmbiguity: 'none',
    uncertainties: ['软焦边缘需按原图校准，不能保证每个像素准确。'],
  }));
  const prepared = await prepare();
  expect(prepared.status).toBe('ready');
  expect(prepared.result.questions).toEqual([]);
  expect(prepared.result.imageEdit?.visualGuidance?.uncertainties).toHaveLength(1);
});

it('retains received background evidence when the connection changes before the plan can be authorized', async () => {
  const observe = background.getMockImplementation()!;
  background.mockImplementationOnce(async (...args) => {
    const study = await observe(...args);
    app.services.settings.connections.update(wid, textConnection('changed-during-study'));
    return study;
  });
  const requestId = randomUUID(),
    input = raw();
  await expect(prepare(input, { requestId })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_FAILED',
  });
  const saved = JSON.parse(row(requestId).background_study_json!);
  expect(saved.study.evidence.model).toBe('fixture-vision');
  expect(saved.study.boundaryNotes).toContain('保留杯子');
  expect(saved.nativeRevision).toBe(JSON.parse(row(requestId).input_json).nativeRevision);
  expect(saved.nativeRevision).not.toBe(
    app.services.settings.connections.revision(wid, input.operation),
  );
  expect(background).toHaveBeenCalledOnce();
  assertNotQuotable(input, requestId, 'CREATIVE_CONFIGURATION_CHANGED');
});

it('blocks a new paid attempt when completed background evidence cannot be persisted', async () => {
  app.services.db.sqlite.exec(`CREATE TRIGGER reject_background_evidence
    BEFORE UPDATE OF background_study_json ON creative_briefs
    BEGIN SELECT RAISE(ABORT, 'fixture evidence disk failure'); END`);
  const requestId = randomUUID(),
    input = raw();
  await expect(prepare(input, { requestId })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_UNCERTAIN',
  });
  expect(row(requestId).state).toBe('uncertain');
  expect(row(requestId).background_study_json).toBeNull();
  app.services.db.sqlite.exec('DROP TRIGGER reject_background_evidence');
  await expect(prepare(input, { requestId })).rejects.toMatchObject({
    code: 'CREATIVE_BRIEF_UNCERTAIN',
  });
  await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
  expect(planner).toHaveBeenCalledOnce();
  expect(background).toHaveBeenCalledOnce();
  assertNotQuotable(input, requestId);
});

it.each(['text', 'background', 'reference'] as const)(
  'blocks original and fresh request IDs after a received %s observation cannot be recorded',
  async (kind) => {
    const input = raw(),
      requestId = randomUUID();
    const observer = vi.fn(async () => {
      throw new Error('isolated observer storage failed');
    });
    if (kind === 'text') {
      const actual = await vi.importActual<typeof import('../src/server/providers/native-planner')>(
        '../src/server/providers/native-planner',
      );
      planner.mockImplementation(actual.analyzeNativeIntent);
    } else if (kind === 'background') {
      const actual = await vi.importActual<
        typeof import('../src/server/providers/native-background-study')
      >('../src/server/providers/native-background-study');
      background.mockImplementation(actual.analyzeNativeBackgroundStudy);
    } else {
      const actual = await vi.importActual<
        typeof import('../src/server/providers/native-reference-study')
      >('../src/server/providers/native-reference-study');
      referenceStudy.mockImplementation(actual.analyzeNativeReferenceStudy);
      input.referenceAssetIds = [referenceId];
      input.replica = {
        subjectAssetId: sourceId,
        referenceAssetId: referenceId,
        aspects: ['lighting'],
        trimStart: 0,
      };
    }
    // The transport has already returned a response when the observer fails.
    // Its payload cannot be inspected or reused after this local persistence failure.
    transport.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
    const briefs = createCreativeBriefServices(app.services, {
      ...(kind === 'text'
        ? { nativePlannerObserver: observer }
        : kind === 'background'
          ? { nativeBackgroundObserver: observer }
          : { nativeReferenceObserver: observer }),
    });
    const submit = (id = randomUUID()) => briefs.prepare(actor, wid, { requestId: id, input });
    await expect(submit(requestId)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    const saved = row(requestId);
    expect(saved.state).toBe('uncertain');
    expect(saved.background_study_json).toBeNull();
    expect(JSON.parse(saved.input_json).nativeReplica).toBeUndefined();
    await expect(submit(requestId)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    await expect(submit()).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    expect(transport).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledOnce();
    expect(planner).toHaveBeenCalledTimes(kind === 'reference' ? 0 : 1);
    expect(row(requestId)).toEqual(saved);
    assertNotQuotable(input, requestId);
  },
);

it('blocks a new strict background preparation before either paid planning stage when local capability is unavailable', async () => {
  vi.mocked(probeLocalMatting).mockRejectedValueOnce(
    new ProviderError('installation unavailable', false, 'LOCAL_MATTING_UNAVAILABLE'),
  );
  await expect(prepare()).rejects.toMatchObject({ code: 'LOCAL_MATTING_UNAVAILABLE' });
  expect(planner).not.toHaveBeenCalled();
  expect(background).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get()).toEqual({
    n: 0,
  });
});

it('checks local installation before a paid planner when a valid clarification first specifies exact background editing', async () => {
  planner.mockImplementationOnce(async (request) => ({
    ...plan(request, false),
    status: 'needs_clarification',
    prompt: '',
    questions: [
      {
        id: 'background',
        field: 'reference',
        question: '请说明要修改的区域和目标颜色。',
        reason: '明确编辑授权',
        options: ['仅修改后方背景'],
      },
    ],
  }));
  const input = { ...raw(), prompt: '请调整这张商品图的背景。' };
  const first = await prepare(input);
  expect(first.status).toBe('needs_clarification');
  expect(planner).toHaveBeenCalledOnce();
  vi.mocked(probeLocalMatting).mockRejectedValueOnce(
    new ProviderError('installation unavailable', false, 'LOCAL_MATTING_UNAVAILABLE'),
  );
  await expect(
    prepare(input, {
      previousId: first.id,
      answers: [
        { questionId: 'background', answer: '仅将后方背景改为#e6e8eb，保留主体、台面与阴影。' },
      ],
    }),
  ).rejects.toMatchObject({ code: 'LOCAL_MATTING_UNAVAILABLE' });
  expect(planner).toHaveBeenCalledOnce();
  expect(background).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get()).toEqual({
    n: 1,
  });
});

it.each(['analyzing', 'uncertain'] as const)(
  'does not resubmit an %s stage when only the memory decay weight advances',
  async (state) => {
    const memory = app.services.core.knowledge.createMemory(actor, wid, {
      topic: '画面风格',
      kind: 'preference',
      content: '留白与简约背景',
      halfLifeDays: 30,
    });
    const initial = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initial);
    const input = { ...raw(), prompt: '保留参考白杯，制作商品展示图', useMemory: true };
    const requestId = randomUUID();
    planner.mockImplementation(async (request) => plan(request, false));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    planner.mockImplementationOnce(async (request) => {
      started();
      if (state === 'uncertain')
        throw new ProviderError('文本结果未知', true, 'PROVIDER_CONNECTION');
      await held;
      return plan(request, false);
    });
    const active = prepare(input, { requestId });
    try {
      await entered;
      if (state === 'uncertain')
        await expect(active).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
      clock.mockReturnValue(initial + 60_000);
      const oldWeight = JSON.parse(row(requestId).request_json).memoryContext.items[0]
        .weight as number;
      expect(app.services.core.knowledge.getMemory(actor, wid, memory.id).effectiveWeight).not.toBe(
        oldWeight,
      );
      const repeated = await prepare(input).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      expect(planner).toHaveBeenCalledTimes(1);
      expect(repeated).toMatchObject({ error: { code: 'CREATIVE_BRIEF_UNCERTAIN' } });
      expect(background).not.toHaveBeenCalled();
      expect(
        app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get(),
      ).toEqual({ n: 1 });
    } finally {
      release();
      if (state === 'analyzing') await active;
      clock.mockRestore();
    }
  },
);

it('treats a decay-only memory ranking reversal as the same uncertain stage', async () => {
  const initial = Date.now();
  const fast = app.services.core.knowledge.createMemory(actor, wid, {
    topic: '快速偏好',
    kind: 'preference',
    content: '简约',
    halfLifeDays: 1,
  });
  const slow = app.services.core.knowledge.createMemory(actor, wid, {
    topic: '缓慢偏好',
    kind: 'preference',
    content: '留白',
    halfLifeDays: 10,
  });
  app.services.db.sqlite
    .prepare('UPDATE creative_memories SET confirmed_at=? WHERE id=?')
    .run(new Date(initial - 86_400_000).toISOString(), slow.id);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(initial);
  try {
    const input = { ...raw(), prompt: '保留参考商品，创作展示图', useMemory: true };
    planner.mockRejectedValueOnce(new ProviderError('结果未明', true, 'PROVIDER_CONNECTION'));
    const requestId = randomUUID();
    await expect(prepare(input, { requestId })).rejects.toMatchObject({
      code: 'CREATIVE_BRIEF_UNCERTAIN',
    });
    const previous = JSON.parse(row(requestId).request_json) as CreativeIntentRequest;
    expect(previous.memoryContext?.items.map((item) => item.id)).toEqual([fast.id, slow.id]);
    clock.mockReturnValue(initial + 86_400_000);
    expect(
      app.services.core.knowledge.resolveMemories(actor, wid, 'image').items.map((item) => item.id),
    ).toEqual([slow.id, fast.id]);
    await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    expect(planner).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
  }
});

it.each(['content', 'version', 'confirmed_at', 'expires_at'] as const)(
  'does not merge substantively changed memory %s into an uncertain previous request',
  async (field) => {
    const memory = app.services.core.knowledge.createMemory(actor, wid, {
      topic: '偏好',
      content: '简约',
      kind: 'preference',
      halfLifeDays: 30,
    });
    const input = { ...raw(), prompt: '保留参考商品，创作展示图', useMemory: true };
    planner.mockRejectedValueOnce(new ProviderError('结果未明', true, 'PROVIDER_CONNECTION'));
    await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    const value =
      field === 'content'
        ? '留白'
        : field === 'version'
          ? 2
          : new Date(Date.now() + 86_400_000).toISOString();
    // Mutate one persisted field independently, proving equality retains each lifetime/version dimension.
    app.services.db.sqlite
      .prepare(`UPDATE creative_memories SET ${field}=? WHERE id=?`)
      .run(value, memory.id);
    planner.mockImplementation(async (request) => plan(request, false));
    const updated = await prepare(input);
    expect(updated.status).toBe('ready');
    expect(planner).toHaveBeenCalledTimes(2);
  },
);

it('drops a memory below the eligibility threshold on a new request instead of reviving the old uncertain context', async () => {
  const initial = Date.now();
  app.services.core.knowledge.createMemory(actor, wid, {
    topic: '短期偏好',
    content: '简约',
    kind: 'preference',
    halfLifeDays: 1,
  });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(initial);
  try {
    const input = { ...raw(), prompt: '保留参考商品，创作展示图', useMemory: true };
    planner.mockRejectedValueOnce(new ProviderError('结果未明', true, 'PROVIDER_CONNECTION'));
    await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
    clock.mockReturnValue(initial + 3 * 86_400_000);
    planner.mockImplementation(async (request) => plan(request, false));
    const fresh = await prepare(input);
    expect(fresh.status).toBe('ready');
    expect(planner.mock.calls.at(-1)![0].memoryContext?.items).toEqual([]);
    expect(fresh.contextSources).toBeUndefined();
  } finally {
    clock.mockRestore();
  }
});

it('allows nonnative media to restart after the actual native text planner connection changes', async () => {
  app.services.config.environmentSecrets.openai = 'unused-isolated-image-key';
  const input = {
    ...raw(),
    providerId: 'openai' as const,
    prompt: '保留参考白杯，制作展示图',
    useMemory: true,
    options: { ...raw().options, model: 'gpt-image-2' },
  };
  planner.mockRejectedValueOnce(
    new ProviderError('原文字连接结果未知', true, 'PROVIDER_CONNECTION'),
  );
  await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
  app.services.settings.connections.update(wid, textConnection('explicit-new-text-model'));
  planner.mockImplementation(async (request) => plan(request, false));
  expect((await prepare(input)).status).toBe('ready');
  expect(planner).toHaveBeenCalledTimes(2);
  expect(planner.mock.calls.at(-1)![1].model).toBe('explicit-new-text-model');
});

it('retains native unknown-result protection for legacy records without the additional planner identity', async () => {
  const input = { ...raw(), prompt: '保留参考白杯，制作展示图', useMemory: true };
  planner.mockRejectedValueOnce(
    new ProviderError('迁移前原生结果未知', true, 'PROVIDER_CONNECTION'),
  );
  await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
  app.services.db.sqlite.prepare('UPDATE creative_briefs SET planner_revision=NULL').run();
  await expect(prepare(input)).rejects.toMatchObject({ code: 'CREATIVE_BRIEF_UNCERTAIN' });
  expect(planner).toHaveBeenCalledTimes(1);
});

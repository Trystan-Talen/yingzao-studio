/** Isolated service contracts. Model results are fixtures, not claims about real model quality. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import type {
  CreativeIntentRequest,
  CreativeIntentResult,
  CreativePreparation,
} from '../src/contracts/creative-intent';
import { analyzeDifyIntent } from '../src/server/providers/dify';
import { ProviderError } from '../src/server/tasks/types';
import { createCreativeBriefServices } from '../src/server/tasks/creative-briefs';

vi.mock('../src/server/providers/dify', async (original) => ({
  ...(await original<typeof import('../src/server/providers/dify')>()),
  analyzeDifyIntent: vi.fn(),
}));
const analyze = vi.mocked(analyzeDifyIntent);
const network = vi.fn(() => {
  throw new Error('External network forbidden');
});
let temp: string;
let app: Awaited<ReturnType<typeof createApp>>;
let config: AppConfig;
let actor: Actor;
let wid: string;
let cookie: string;

function input(overrides: Partial<JobInput> = {}): JobInput {
  return jobInputSchema.parse({
    providerId: 'openai',
    operation: 'image.generate',
    prompt: '画一只太空猫',
    options: { model: 'doubao-seedream-5.0-lite', resolution: '2K', needText: false },
    ...overrides,
  });
}
function result(
  request: CreativeIntentRequest,
  changes: Partial<CreativeIntentResult> = {},
): CreativeIntentResult {
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
      ...(request.context.market ? { market: request.context.market } : {}),
      productMode: 'not-applicable',
      facts: [],
      constraints: [],
    },
    summary: '制作一张太空猫幻想插画。',
    assumptions: ['采用柔和的星空光线'],
    questions: [],
    prompt: '太空猫漂浮在星云中，以柔和的星空光线表现幻想场景。',
    reviewChecklist: ['确认主体是太空猫'],
    ...changes,
  };
}
const question = (id = 'subject') => ({
  id,
  field: 'subject' as const,
  question: '主要画什么？',
  reason: '主体决定画面',
  options: [],
});
function clarification(request: CreativeIntentRequest, id = 'subject') {
  return result(request, { status: 'needs_clarification', prompt: '', questions: [question(id)] });
}
beforeEach(async () => {
  vi.stubGlobal('fetch', network);
  network.mockClear();
  analyze.mockReset();
  analyze.mockImplementation(async (request) => result(request));
  temp = await mkdtemp(join(tmpdir(), 'yingzao-creative-briefs-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(temp, 'fixture.sqlite'),
    storageDir: join(temp, 'media'),
    sessionSecret: 'creative-fixture-session',
    encryptionKey: 'creative-fixture-encryption',
    isProduction: false,
    demoMode: true,
    environmentSecrets: { openai: 'isolated-image-fixture', dify: 'isolated-planner-fixture' },
    imageGateway: { baseUrl: 'https://images.example.test/v1', model: 'doubao-seedream-5.0-lite' },
  };
  app = await createApp(config, { serveWeb: false });
  const account = await app.services.core.auth.register({
    email: 'creative@example.local',
    password: 'CreativeFixture2026!',
    displayName: '需求隔离测试',
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
  // Exercise the real service branch while keeping every planner invocation mocked.
  app.services.config.demoMode = false;
});
afterEach(async () => {
  await app.app.close();
  await rm(temp, { recursive: true, force: true });
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
function request(
  method: 'GET' | 'POST',
  path: string,
  payload?: unknown,
  space = wid,
  session = cookie,
) {
  return app.app.inject({
    method,
    url: `/api/v1${path}`,
    payload: payload as object,
    headers: { cookie: session, origin: config.publicOrigin, 'x-workspace-id': space },
  });
}
async function prepare(value = input(), extra: Record<string, unknown> = {}) {
  const response = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: value,
    ...extra,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data as CreativePreparation;
}
function count(table: 'jobs' | 'quotes' | 'creative_briefs') {
  return (app.services.db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number })
    .n;
}
async function imageAsset(name = 'reference.png') {
  const buffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  return app.services.core.assets.ingest(actor, wid, { buffer, name, mimeType: 'image/png' });
}

it('keeps the original wording and freezes compiled guidance only in quoted items', async () => {
  const original = input({ prompt: '  画一只太空猫，像水彩一样。  ' });
  const prepared = await prepare(original);
  expect(prepared.input.prompt).toBe(original.prompt);
  expect(prepared.result.status).toBe('ready');
  expect(prepared.result.questions).toEqual([]);
  expect(count('jobs')).toBe(0);
  expect(count('quotes')).toBe(0);
  const quoted = await request('POST', '/quotes', prepared.input);
  expect(quoted.statusCode, quoted.body).toBe(200);
  const quote = quoted.json().data;
  expect(quote.creativeSummary).toEqual({
    summary: prepared.result.summary,
    assumptions: prepared.result.assumptions,
  });
  const row = app.services.db.sqlite
    .prepare('SELECT input_json,items_json FROM quotes WHERE id=?')
    .get(quote.id) as { input_json: string; items_json: string };
  expect(JSON.parse(row.input_json).prompt).toBe(original.prompt);
  const item = JSON.parse(row.items_json)[0] as JobInput;
  expect(item.prompt).toContain(prepared.result.prompt);
  expect(item.prompt).not.toMatch(/品牌|容量|价格|商品保真|白底/);
  expect(original.options.needText).toBe(false);
  expect(item.prompt).toContain('画面不添加文字、字幕或水印。');
  expect(item.prompt).not.toContain('画面文字使用');
  expect(item.creativeBriefId).toBeUndefined();
  expect(item.options).toEqual(original.options);
  expect(count('jobs')).toBe(0);
  const submitted = await request('POST', '/jobs', {
    input: prepared.input,
    quoteId: quote.id,
    clientRequestId: randomUUID(),
  });
  expect(submitted.statusCode, submitted.body).toBe(202);
  expect(submitted.json().data.prompt).toBe(original.prompt);
  expect(submitted.json().data.input.creativeBriefId).toBe(prepared.id);
  const saved = app.services.db.sqlite
    .prepare('SELECT input_json FROM job_items WHERE job_id=?')
    .get(submitted.json().data.id) as { input_json: string };
  expect(JSON.parse(saved.input_json)).toEqual(item);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('does not quote or submit a preparation that still needs a necessary answer', async () => {
  analyze.mockImplementation(async (value) => clarification(value));
  const prepared = await prepare(input({ prompt: '做个高级一点的' }));
  expect(prepared.status).toBe('needs_clarification');
  const quoted = await request('POST', '/quotes', prepared.input);
  expect(quoted.statusCode).toBe(409);
  expect(quoted.body).toContain('CREATIVE_BRIEF_NOT_READY');
  const submitted = await request('POST', '/jobs', {
    input: prepared.input,
    quoteId: randomUUID(),
    clientRequestId: randomUUID(),
  });
  expect(submitted.statusCode).toBe(409);
  expect(count('quotes')).toBe(0);
  expect(count('jobs')).toBe(0);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it.each(['prompt', 'ratio', 'language', 'platform', 'reference'] as const)(
  'invalidates a ready preparation after changing %s',
  async (field) => {
    const prepared = await prepare();
    const changed = structuredClone(prepared.input);
    if (field === 'prompt') changed.prompt = '换成月球兔子';
    if (field === 'ratio') changed.options.ratio = '3:4';
    if (field === 'language') changed.options.language = 'en';
    if (field === 'platform') changed.options.platform = 'Amazon';
    if (field === 'reference') changed.referenceAssetIds = [(await imageAsset()).id];
    const quoted = await request('POST', '/quotes', changed);
    expect(quoted.statusCode, quoted.body).toBe(409);
    expect(quoted.body).toContain('CREATIVE_BRIEF_CHANGED');
    expect(count('quotes')).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(1);
  },
);

it('does not let a ready preparation replace quotation or alter a quoted request', async () => {
  const prepared = await prepare();
  const noQuote = await request('POST', '/jobs', {
    input: prepared.input,
    quoteId: randomUUID(),
    clientRequestId: randomUUID(),
  });
  expect(noQuote.statusCode).toBe(409);
  expect(noQuote.body).toContain('QUOTE_EXPIRED');
  const quoted = await request('POST', '/quotes', prepared.input);
  expect(quoted.statusCode, quoted.body).toBe(200);
  const changed = { ...prepared.input, prompt: '改成月球兔子' };
  const wrong = await request('POST', '/jobs', {
    input: changed,
    quoteId: quoted.json().data.id,
    clientRequestId: randomUUID(),
  });
  expect(wrong.statusCode).toBe(409);
  expect(count('jobs')).toBe(0);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('returns the same completed request without a second model call and rejects changed input', async () => {
  const requestId = randomUUID();
  const first = await prepare(input(), { requestId });
  const again = await prepare(input(), { requestId });
  expect(again).toEqual(first);
  const changed = await request('POST', '/creative-briefs/prepare', {
    requestId,
    input: input({ prompt: '月球兔子' }),
  });
  expect(changed.statusCode).toBe(409);
  expect(changed.body).toContain('CREATIVE_REQUEST_CHANGED');
  expect(count('creative_briefs')).toBe(1);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('rejects a changed answer payload under a reused follow-up request ID', async () => {
  analyze.mockImplementationOnce(async (value) => clarification(value));
  const original = input({ prompt: '做个高级一点的' });
  const first = await prepare(original);
  const requestId = randomUUID();
  await prepare(original, {
    previousId: first.id,
    requestId,
    answers: [{ questionId: 'subject', answer: '太空猫' }],
  });
  const duplicateWithoutAnswer = await request('POST', '/creative-briefs/prepare', {
    input: original,
    previousId: first.id,
    requestId,
    answers: [],
  });
  expect(duplicateWithoutAnswer.statusCode).toBe(409);
  expect(duplicateWithoutAnswer.body).toContain('CREATIVE_REQUEST_CHANGED');
  expect(analyze).toHaveBeenCalledTimes(2);
});

it('merges answers and their verbatim source evidence without changing the original prompt', async () => {
  analyze.mockImplementationOnce(async (value) => clarification(value, 'subject'));
  analyze.mockImplementationOnce(async (value) => clarification(value, 'reference'));
  const original = input({ prompt: '做个高级一点的' });
  const first = await prepare(original);
  const second = await prepare(original, {
    previousId: first.id,
    answers: [{ questionId: 'subject', answer: '太空猫' }],
  });
  const third = await prepare(original, {
    previousId: second.id,
    answers: [{ questionId: 'reference', answer: '接受自由幻想创意' }],
  });
  const call = analyze.mock.calls[2]![0];
  expect(call.rawPrompt).toBe(original.prompt);
  expect(call.answers).toEqual([
    { questionId: 'subject', answer: '太空猫' },
    { questionId: 'reference', answer: '接受自由幻想创意' },
  ]);
  expect(call.sourceTexts).toEqual(
    expect.arrayContaining([
      { id: 'answer:0', text: '太空猫' },
      { id: 'answer:1', text: '接受自由幻想创意' },
    ]),
  );
  expect(call.previousSummary).toBe(second.result.summary);
  expect(third.input.prompt).toBe(original.prompt);
  const badAnswer = await request('POST', '/creative-briefs/prepare', {
    input: original,
    requestId: randomUUID(),
    previousId: first.id,
    answers: [{ questionId: 'not_asked', answer: 'bad' }],
  });
  expect(badAnswer.statusCode).toBe(400);
  expect(analyze).toHaveBeenCalledTimes(3);
});

it('includes explicit source text in the planner evidence, without trusting its instructions', async () => {
  const referenceText = '用户提供的产品事实：陶瓷杯，容量 300 毫升。';
  await prepare(input({ prompt: '按资料展示杯子', referenceText }));
  expect(
    analyze.mock.calls[0]![0].sourceTexts.some((source) => source.text === referenceText),
  ).toBe(true);
});

it('rejects fabricated source quotations even if the model reports ready', async () => {
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    output.brief.facts = [{ sourceId: 'request', quote: '不存在的认证' }];
    return output;
  });
  const response = await request('POST', '/creative-briefs/prepare', {
    input: input(),
    requestId: randomUUID(),
  });
  expect(response.statusCode).toBe(502);
  expect(count('quotes')).toBe(0);
  expect(count('jobs')).toBe(0);
});

it.each(['platform', 'placement', 'market'] as const)(
  'revalidates the selected %s at the service boundary',
  async (field) => {
    analyze.mockImplementation(async (value) => {
      const output = result(value);
      Object.assign(output.brief, { scope: 'product', productMode: 'concept' });
      if (field === 'platform') output.brief.platform = 'TikTok';
      if (field === 'placement') output.brief.placement = 'social-image';
      if (field === 'market') output.brief.market = 'GB';
      return output;
    });
    const selected = input();
    Object.assign(selected.options, {
      platform: 'Amazon',
      creativePlacement: 'main-image',
      creativeMarket: 'US',
    });
    const response = await request('POST', '/creative-briefs/prepare', {
      input: selected,
      requestId: randomUUID(),
    });
    expect(response.statusCode).toBe(502);
    expect(count('quotes')).toBe(0);
  },
);

it('does not accept a background image as the product reference', async () => {
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    Object.assign(output.brief, {
      scope: 'product',
      productMode: 'reference',
      subject: '真实杯子',
    });
    return output;
  });
  const asset = await imageAsset('background.png');
  const response = await request('POST', '/creative-briefs/prepare', {
    input: input({ prompt: '保留真实杯子外观', backgroundAssetId: asset.id }),
    requestId: randomUUID(),
  });
  expect(response.statusCode).toBe(502);
  expect(count('quotes')).toBe(0);
});

it('prevents concurrent repeats while one request is still being analyzed', async () => {
  let release!: (value: CreativeIntentResult) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  analyze.mockImplementation(() => {
    began();
    return new Promise<CreativeIntentResult>((resolve) => {
      release = resolve;
    });
  });
  const body = { input: input(), requestId: randomUUID() };
  const pending = request('POST', '/creative-briefs/prepare', body);
  const running = Promise.resolve(pending);
  await started;
  const repeat = await request('POST', '/creative-briefs/prepare', body);
  expect(repeat.statusCode).toBe(409);
  expect(repeat.body).toContain('CREATIVE_BRIEF_ANALYZING');
  release(result(analyze.mock.calls[0]![0]));
  expect((await running).statusCode).toBe(200);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(count('creative_briefs')).toBe(1);
});

it('restores completed preparation after restart without another model call', async () => {
  const requestId = randomUUID();
  const first = await prepare(input(), { requestId });
  await app.app.close();
  app = await createApp(config, { serveWeb: false });
  const fetched = await request('GET', `/creative-briefs/${first.id}`);
  expect(fetched.statusCode, fetched.body).toBe(200);
  expect(fetched.headers['cache-control']).toContain('no-store');
  expect(fetched.json().data).toEqual(first);
  const duplicate = await prepare(input(), { requestId });
  expect(duplicate.id).toBe(first.id);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('does not replay uncertain requests after restart and does not expose arbitrary exception details', async () => {
  analyze.mockRejectedValueOnce(
    new ProviderError('模型提交结果未知，请核对。', true, 'FIXTURE_UNCERTAIN'),
  );
  const body = { input: input(), requestId: randomUUID() };
  const first = await request('POST', '/creative-briefs/prepare', body);
  expect(first.statusCode).toBe(502);
  const row = app.services.db.sqlite.prepare('SELECT id,state FROM creative_briefs').get() as {
    id: string;
    state: string;
  };
  expect(row.state).toBe('uncertain');
  await app.app.close();
  app = await createApp(config, { serveWeb: false });
  const repeat = await request('POST', '/creative-briefs/prepare', body);
  expect(repeat.statusCode).toBe(409);
  expect(analyze).toHaveBeenCalledTimes(1);
  analyze.mockRejectedValueOnce(new Error('private-exception-payload'));
  const unsafe = await request('POST', '/creative-briefs/prepare', {
    input: input({ prompt: '这是另一项明确的新需求：画月球上的兔子' }),
    requestId: randomUUID(),
  });
  expect(unsafe.statusCode).toBe(502);
  expect(unsafe.body).not.toContain('private-exception-payload');
});

it.each(['DIFY_INTENT_FAILED', 'DIFY_INTENT_INVALID'])(
  'persists terminal %s without replaying it and allows only an explicit new request',
  async (code) => {
    analyze.mockRejectedValueOnce(new ProviderError('需求整理未完成。', false, code));
    const body = { input: input(), requestId: randomUUID() };
    const first = await request('POST', '/creative-briefs/prepare', body);
    expect(first.statusCode).toBe(502);
    expect(first.json().error.code).toBe('CREATIVE_BRIEF_FAILED');
    const row = app.services.db.sqlite.prepare('SELECT id,state FROM creative_briefs').get() as {
      id: string;
      state: string;
    };
    expect(row.state).toBe('failed');
    const fetched = await request('GET', `/creative-briefs/${row.id}`);
    expect(fetched.json().error.code).toBe('CREATIVE_BRIEF_FAILED');
    const repeated = await request('POST', '/creative-briefs/prepare', body);
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().error.code).toBe('CREATIVE_BRIEF_FAILED');
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(count('creative_briefs')).toBe(1);
    const retried = await prepare(body.input, { requestId: randomUUID() });
    expect(retried.id).not.toBe(row.id);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(count('creative_briefs')).toBe(2);
    expect(count('jobs')).toBe(0);
    expect(count('quotes')).toBe(0);
  },
);

it('keeps brief tokens scoped to their workspace and actor, even for another editor', async () => {
  const team = app.services.core.auth.createWorkspace(actor.userId, '准备需求团队', 'team');
  const invite = app.services.core.team.invite(actor, team.id, {
    email: 'colleague@example.local',
    role: 'member',
  });
  const colleague = await app.services.core.auth.register({
    email: 'colleague@example.local',
    password: 'ColleagueFixture2026!',
    displayName: '同事',
    inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
  });
  app.services.core.knowledge.createMemory(actor, team.id, {
    topic: '个人资料',
    content: '同事不能读取的私人资料',
    kind: 'profile',
  });
  const briefs = createCreativeBriefServices(app.services);
  const prepared = await briefs.prepare(actor, team.id, {
    requestId: randomUUID(),
    input: input({ useMemory: true }),
  });
  expect(prepared.contextSources?.[0]?.content).toBe('同事不能读取的私人资料');
  const colleagueCookie = `studio_session=${colleague.sessionToken}`;
  const notOwner = await request(
    'GET',
    `/creative-briefs/${prepared.id}`,
    undefined,
    team.id,
    colleagueCookie,
  );
  expect(notOwner.statusCode).toBe(404);
  const borrowed = await request('POST', '/quotes', prepared.input, team.id, colleagueCookie);
  expect(borrowed.statusCode).toBe(404);
  expect(borrowed.body).toContain('CREATIVE_BRIEF_NOT_FOUND');
  const wrongSpace = await request('POST', '/quotes', prepared.input, wid);
  expect(wrongSpace.statusCode).toBe(404);
  const followup = await request(
    'POST',
    '/creative-briefs/prepare',
    { input: input(), previousId: prepared.id, requestId: randomUUID() },
    team.id,
    colleagueCookie,
  );
  expect(followup.statusCode).toBe(404);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('blocks read-only members before any model request', async () => {
  const team = app.services.core.auth.createWorkspace(actor.userId, '只读需求团队', 'team');
  const invite = app.services.core.team.invite(actor, team.id, {
    email: 'viewer@example.local',
    role: 'viewer',
  });
  const viewer = await app.services.core.auth.register({
    email: 'viewer@example.local',
    password: 'ViewerFixture2026!',
    displayName: '只读',
    inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
  });
  const response = await request(
    'POST',
    '/creative-briefs/prepare',
    { input: input(), requestId: randomUUID() },
    team.id,
    `studio_session=${viewer.sessionToken}`,
  );
  expect(response.statusCode).toBe(403);
  expect(analyze).not.toHaveBeenCalled();
  expect(count('creative_briefs')).toBe(0);
});

it('does not treat unrelated project messages as evidence after the current reference changes', async () => {
  const project = app.services.core.projects.create(actor, wid, {
    name: '用户资料来源',
    kind: 'image',
  });
  const sql = app.services.db.sqlite;
  const insert = sql.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run(
    randomUUID(),
    wid,
    project.id,
    actor.userId,
    'user',
    '只将口红背景改为#e6e8eb，保留金属管与横卧盖。',
    null,
    '{}',
    '2026-01-01T00:00:00.000Z',
  );
  insert.run(
    randomUUID(),
    wid,
    project.id,
    actor.userId,
    'assistant',
    '未经提供的终身保温认证',
    null,
    '{}',
    '2026-01-02T00:00:00.000Z',
  );
  const oldReference = await imageAsset('旧参考.png');
  const currentReference = await imageAsset('本次参考.png');
  await prepare(
    input({ prompt: '制作口红图片', projectId: project.id, assetIds: [oldReference.id] }),
  );
  const prompt = '只将香水瓶后方背景改为#e9d8ca，保留瓶身与黑绸。';
  const prepared = await prepare(
    input({ prompt, projectId: project.id, assetIds: [currentReference.id] }),
  );
  const currentRequest = analyze.mock.calls.at(-1)![0];
  const sources = currentRequest.sourceTexts.map((item) => item.text).join('\n');
  expect(sources).toBe(prompt);
  expect(currentRequest.materials.map((item) => item.id)).toEqual([currentReference.id]);
  expect(currentRequest.previousSummary).toBeUndefined();
  expect(currentRequest.answers).toEqual([]);
  expect(sources).not.toContain('口红');
  expect(sources).not.toContain('未经提供的终身保温认证');
  const quote = app.services.quote(actor, wid, prepared.input);
  const saved = sql.prepare('SELECT items_json FROM quotes WHERE id=?').get(quote.id) as {
    items_json: string;
  };
  expect(saved.items_json).not.toContain('未经提供的终身保温认证');
});

it('preserves compiled item snapshots when a cancelled generation is quoted for retry', async () => {
  const prepared = await prepare();
  const quote = app.services.quote(actor, wid, prepared.input);
  const job = app.services.submit(actor, wid, prepared.input, quote.id, randomUUID());
  const sql = app.services.db.sqlite;
  const original = sql.prepare('SELECT input_json FROM job_items WHERE job_id=?').get(job.id) as {
    input_json: string;
  };
  app.services.cancel(actor, wid, job.id);
  const retry = app.services.retryQuote(actor, wid, job.id);
  const saved = sql.prepare('SELECT items_json FROM quotes WHERE id=?').get(retry.id) as {
    items_json: string;
  };
  expect(JSON.parse(saved.items_json)[0]).toEqual(JSON.parse(original.input_json));
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('does not invent required branding or optional parameters when a product-reference fixture is ready', async () => {
  const asset = await imageAsset('product.png');
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    Object.assign(output.brief, {
      scope: 'product',
      productMode: 'reference',
      subject: '参考图中的杯子',
    });
    output.prompt = '展示参考图中的同一个杯子，保留实际外观。';
    return output;
  });
  const prepared = await prepare(
    input({ prompt: '把这只杯子放在桌上', referenceAssetIds: [asset.id] }),
  );
  expect(prepared.status).toBe('ready');
  expect(prepared.result.questions).toEqual([]);
  expect(prepared.result.brief.facts).toEqual([]);
  expect(analyze.mock.calls[0]![0].materials).toEqual([
    {
      id: asset.id,
      name: 'product.png',
      kind: 'image',
      role: 'reference',
      width: 32,
      height: 32,
      byteSize: asset.byteSize,
    },
  ]);
});

it('freezes reference geometry once while preserving explicit edits, closeups and every constraint', async () => {
  const asset = await imageAsset('product.png');
  const direction =
    '编辑参考图中的商品：只把瓶身改成淡紫色，以局部特写展示已有表面，允许裁掉瓶底；保留用户要求的镜面强反射，背景换成窗边亚麻布。';
  const constraints = [
    '只修改用户指定的瓶身颜色，其他可见结构与标识保持参考图原样。',
    '不新增人物、字幕、水印；没有抗菌检测报告，不得添加抗菌功效声明。',
  ];
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    Object.assign(output.brief, {
      scope: 'product',
      productMode: 'reference',
      subject: '参考商品',
      constraints,
    });
    output.prompt = direction;
    return output;
  });
  const original = input({
    prompt: direction,
    referenceAssetIds: [asset.id],
    options: { ...input().options, platform: '小红书', ratio: '3:4' },
  });
  const prepared = await prepare(original);
  const quote = app.services.quote(actor, wid, prepared.input);
  const saved = app.services.db.sqlite
    .prepare('SELECT input_json,items_json FROM quotes WHERE id=?')
    .get(quote.id) as { input_json: string; items_json: string };
  const compiled = JSON.parse(saved.items_json)[0] as JobInput;
  expect(JSON.parse(saved.input_json).prompt).toBe(direction);
  expect(compiled.referenceAssetIds).toContain(asset.id);
  expect(compiled.options.ratio).toBe('3:4');
  expect(compiled.prompt.startsWith(direction)).toBe(true);
  for (const constraint of constraints) expect(compiled.prompt).toContain(constraint);
  expect(compiled.prompt.match(/商品仅等比缩放/g)).toHaveLength(1);
  expect(compiled.prompt).toContain('用户明确要求的改形、改色、换视角、局部特写或裁切优先');
  expect(compiled.prompt).toContain('不得把否定、疑问或未证实表述改写为肯定声明');
  expect(compiled.prompt).not.toContain('主体完整');
  expect(compiled.prompt).not.toContain('策略版本');
  expect(compiled.prompt).not.toContain('100%还原');
  expect(prepared.result.questions).toEqual([]);
  expect(count('jobs')).toBe(0);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('keeps explicit market in local simulation without calling the real planner branch', async () => {
  app.services.config.demoMode = true;
  const selected = input();
  Object.assign(selected.options, { platform: 'Amazon', creativeMarket: 'US' });
  const prepared = await prepare(selected);
  expect(prepared.result.brief.market).toBe('US');
  expect(analyze).not.toHaveBeenCalled();
});

it('does not impose product identity constraints on a general creative image reference', async () => {
  const asset = await imageAsset('style-reference.png');
  const prepared = await prepare(
    input({ prompt: '参考这种水彩笔触画三只紫色太空猫', referenceAssetIds: [asset.id] }),
  );
  const quote = app.services.quote(actor, wid, prepared.input);
  const row = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  const compiled = JSON.parse(row.items_json)[0] as JobInput;
  expect(compiled.prompt).not.toContain('实际商品参考图片随请求提供');
  expect(compiled.prompt).not.toContain('等比缩放');
  expect(prepared.result.brief.scope).toBe('general');
});

it('does not reuse a project-scoped preparation in another project or without its original project', async () => {
  const first = app.services.core.projects.create(actor, wid, { name: '原项目', kind: 'image' });
  const second = app.services.core.projects.create(actor, wid, { name: '另一项目', kind: 'image' });
  const requestId = randomUUID();
  const prepared = await prepare(input({ projectId: first.id }), { requestId });
  for (const projectId of [second.id, undefined]) {
    const changed = { ...prepared.input, projectId };
    const quote = await request('POST', '/quotes', changed);
    expect(quote.statusCode, quote.body).toBe(409);
    const repeat = await request('POST', '/creative-briefs/prepare', { requestId, input: changed });
    expect(repeat.statusCode, repeat.body).toBe(409);
  }
  expect(count('quotes')).toBe(0);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('allows an initially unbound preparation to be assigned to its first new project', async () => {
  const prepared = await prepare();
  const project = app.services.core.projects.create(actor, wid, {
    name: '整理后创建',
    kind: 'image',
  });
  const assigned = { ...prepared.input, projectId: project.id };
  const quote = await request('POST', '/quotes', assigned);
  expect(quote.statusCode, quote.body).toBe(200);
  const submitted = await request('POST', '/jobs', {
    input: assigned,
    quoteId: quote.json().data.id,
    clientRequestId: randomUUID(),
  });
  expect(submitted.statusCode, submitted.body).toBe(202);
  expect(submitted.json().data.projectId).toBe(project.id);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('rejects a ready result that silently treats an explicit product placement as general creativity', async () => {
  const selected = input();
  selected.options.creativePlacement = 'main-image';
  const response = await request('POST', '/creative-briefs/prepare', {
    input: selected,
    requestId: randomUUID(),
  });
  expect(response.statusCode).toBe(502);
  expect(count('quotes')).toBe(0);
  expect(count('jobs')).toBe(0);
});

it('retains a quotation for provenance without upgrading a negated fragment into a generated claim', async () => {
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    Object.assign(output.brief, {
      scope: 'product',
      productMode: 'concept',
      subject: '概念杯子',
      facts: [{ sourceId: 'request', quote: '食品级认证' }],
    });
    output.prompt = '展示一个概念杯子，只描述外观。';
    return output;
  });
  const prepared = await prepare(
    input({ prompt: '创作概念杯子。食品级认证未经证实，不能写这个认证。' }),
  );
  expect(prepared.result.brief.facts[0]?.quote).toBe('食品级认证');
  const quote = app.services.quote(actor, wid, prepared.input);
  const saved = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  const compiled = JSON.parse(saved.items_json)[0] as JobInput;
  expect(compiled.prompt).not.toContain('食品级认证');
  expect(compiled.prompt).not.toContain('可使用的事实');
  expect(compiled.prompt).toContain('不得把否定、疑问或未证实表述改写为肯定声明');
});

it('provides explicit legacy copy options as sources but does not append them after the corrected plan', async () => {
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    Object.assign(output.brief, { scope: 'product', productMode: 'concept', subject: '概念杯子' });
    output.prompt = '展示绿色概念杯子，标注容量500毫升，不标价格。';
    return output;
  });
  const selected = input({
    prompt: '旧字段300毫升已作废；按500毫升的绿色概念杯制作，不标价格。',
    conversationContext: '未确认的旧会话声明',
  });
  Object.assign(selected.options, {
    sellingPoints: '旧容量300毫升',
    price: '￥12',
    colors: ['#ff0000'],
    textReplacements: [{ originalText: '300毫升', replaceText: '旧文案', rect: [0, 0, 10, 10] }],
  });
  const prepared = await prepare(selected);
  const sources = analyze.mock.calls[0]![0].sourceTexts;
  expect(sources).toEqual(
    expect.arrayContaining([
      { id: 'option:selling-points', text: '旧容量300毫升' },
      { id: 'option:price', text: '￥12' },
      { id: 'option:colors', text: JSON.stringify(selected.options.colors) },
      { id: 'option:text-replacements', text: JSON.stringify(selected.options.textReplacements) },
    ]),
  );
  const quote = app.services.quote(actor, wid, prepared.input);
  const row = app.services.db.sqlite
    .prepare('SELECT input_json,items_json FROM quotes WHERE id=?')
    .get(quote.id) as { input_json: string; items_json: string };
  expect(JSON.parse(row.input_json).options.sellingPoints).toBe('旧容量300毫升');
  const compiled = JSON.parse(row.items_json)[0] as JobInput;
  expect(compiled.prompt).toContain('500毫升');
  expect(compiled.prompt).not.toContain('300毫升');
  expect(compiled.conversationContext).toBeUndefined();
  for (const key of ['sellingPoints', 'price', 'colors', 'textReplacements'])
    expect(compiled.options).not.toHaveProperty(key);
});

it.each([
  ['video', 'product', 'product-video'],
  ['video', 'social', 'social-video'],
  ['video', 'brand', 'ad-video'],
  ['image', 'detail', 'detail-image'],
] as const)(
  'preserves the explicit legacy %s/%s selection in the planning request',
  async (mediaType, kind, placement) => {
    analyze.mockImplementation(async (value) => {
      const output = result(value);
      if (['product-video', 'detail-image'].includes(placement))
        Object.assign(output.brief, { scope: 'product', productMode: 'concept' });
      return output;
    });
    const selected = input({
      operation: mediaType === 'video' ? 'video.generate' : 'image.generate',
    });
    selected.options.kind = kind;
    const prepared = await prepare(selected);
    expect(analyze.mock.calls[0]![0].context.placement).toBe(placement);
    expect(prepared.result.brief.placement).toBe(placement);
  },
);

function wanInput(): JobInput {
  config.environmentSecrets.fal = 'isolated-wan-fixture';
  return jobInputSchema.parse({
    operation: 'video.generate',
    providerId: 'fal',
    prompt: '制作概念杯子主图视频',
    options: {
      model: 'wan-2.6',
      kind: 'product',
      platform: '抖音',
      ratio: '9:16',
      resolution: '720p',
      duration: 5,
      needText: false,
    },
  });
}

it('omits source citations from execution prompts while retaining their audit evidence', async () => {
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    Object.assign(output.brief, { scope: 'product', productMode: 'concept', subject: '概念杯子' });
    output.prompt = '展示概念杯子全貌，再缓慢推进展示细节。';
    return output;
  });
  const prepared = await prepare(wanInput());
  expect(analyze.mock.calls[0]![0].strategy.guidance).toContain('https://school.jinritemai.com/');
  const quote = app.services.quote(actor, wid, prepared.input);
  const saved = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  const compiled = JSON.parse(saved.items_json)[0] as JobInput;
  expect(compiled.prompt).toContain('5–60 秒');
  expect(compiled.prompt).not.toContain('https://');
  expect(compiled.prompt).not.toContain('策略版本');
  expect(compiled.prompt).not.toContain('尚未核实');
  expect(compiled.prompt).not.toContain('等比缩放');
  const audit = app.services.db.sqlite
    .prepare('SELECT strategy_json FROM creative_briefs WHERE id=?')
    .get(prepared.id) as { strategy_json: string };
  expect(audit.strategy_json).toContain('https://school.jinritemai.com/');
  const strategy = JSON.parse(audit.strategy_json) as {
    requirements: { text: string }[];
    recommendations: { text: string }[];
  };
  for (const item of [...strategy.requirements, ...strategy.recommendations])
    expect(compiled.prompt).toContain(item.text);
});

it('rejects an over-budget compiled Wan prompt before writing a payable quote', async () => {
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    Object.assign(output.brief, { scope: 'product', productMode: 'concept', subject: '概念杯子' });
    output.prompt = '缓慢展示同一概念杯子。'.repeat(160);
    return output;
  });
  const prepared = await prepare(wanInput());
  expect(prepared.status).toBe('ready');
  expect(prepared.input.prompt.length).toBeLessThan(100);
  const quoted = await request('POST', '/quotes', prepared.input);
  expect(quoted.statusCode, quoted.body).toBe(400);
  expect(quoted.body).toContain('PROMPT_TOO_LONG');
  expect(count('quotes')).toBe(0);
  expect(count('jobs')).toBe(0);
  expect(analyze).toHaveBeenCalledTimes(1);
});

it('audits raw brand and document sources without reintroducing corrected claims into execution', async () => {
  // The legacy OpenAI route supports brands; the image gateway deliberately rejects them.
  delete app.services.config.imageGateway;
  const asset = await imageAsset();
  const document = await app.services.core.assets.ingest(actor, wid, {
    buffer: Buffer.from('文档旧宣称：99%抗菌。'),
    name: 'product-facts.txt',
    mimeType: 'text/plain',
  });
  await app.services.core.assets.processPendingExtractions();
  const brandResponse = await request('POST', '/brands', {
    name: '参考品牌',
    description: '品牌旧宣称：终身保温。',
    referenceAssetIds: [asset.id],
  });
  expect(brandResponse.statusCode, brandResponse.body).toBe(201);
  const brand = brandResponse.json().data;
  analyze.mockImplementation(async (value) => {
    const output = result(value);
    Object.assign(output.brief, {
      scope: 'product',
      productMode: 'reference',
      subject: '参考图杯子',
    });
    output.prompt = '展示参考图中的杯子外观，不添加功效宣传。';
    return output;
  });
  const raw = input({
    prompt: '拒绝旧的抗菌、保温、食品级认证说法，只展示杯子外观。',
    brandId: brand.id,
    assetIds: [document.id],
    referenceText: '资料旧宣称：食品级认证。',
    options: { ...input().options, model: 'gpt-image-2' },
  });
  const prepared = await prepare(raw);
  const requestSources = analyze.mock.calls[0]![0].sourceTexts;
  expect(requestSources.some((source) => source.text.includes('99%抗菌'))).toBe(true);
  expect(requestSources.some((source) => source.text.includes('终身保温'))).toBe(true);
  const quote = app.services.quote(actor, wid, prepared.input);
  const saved = app.services.db.sqlite
    .prepare('SELECT input_json,items_json FROM quotes WHERE id=?')
    .get(quote.id) as { input_json: string; items_json: string };
  const compiled = JSON.parse(saved.items_json)[0] as JobInput;
  expect(compiled.prompt).not.toMatch(/99%抗菌|终身保温|食品级认证/);
  expect(compiled.referenceText).toBeUndefined();
  expect(compiled.brandId).toBeUndefined();
  expect(compiled.assetIds).not.toContain(document.id);
  expect(compiled.referenceAssetIds).toContain(asset.id);
  expect(JSON.parse(saved.input_json).referenceText).toBe(raw.referenceText);
  const audit = app.services.db.sqlite
    .prepare('SELECT request_json FROM creative_briefs WHERE id=?')
    .get(prepared.id) as { request_json: string };
  expect(audit.request_json).toContain('99%抗菌');
  expect(audit.request_json).toContain('终身保温');
});

it('preserves the existing unprepared generation path for raw reference prose and copy options', () => {
  const raw = input({ referenceText: '旧接口明确输入的资料' });
  raw.options.sellingPoints = '旧接口卖点';
  raw.options.price = '￥12';
  const quote = app.services.quote(actor, wid, raw);
  const row = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  const item = JSON.parse(row.items_json)[0] as JobInput;
  expect(item.referenceText).toBe(raw.referenceText);
  expect(item.options.sellingPoints).toBe('旧接口卖点');
  expect(item.options.price).toBe('￥12');
});

it.each([
  ['seedream with no image yet', 'openai', 'doubao-seedream-5.0-lite', 0, 0, 'all', true],
  ['seedream input image', 'openai', 'doubao-seedream-5.0-lite', 1, 0, 'all', true],
  ['seedream reference image', 'openai', 'doubao-seedream-5.0-lite', 0, 1, 'all', true],
  ['seedream excessive images', 'openai', 'doubao-seedream-5.0-lite', 5, 0, 'all', false],
  ['text-only image gateway', 'openai', 'gpt-image-2', 1, 0, 'all', false],
  ['unknown image model', 'openai', 'unknown-model', 1, 0, 'all', false],
  ['seedance text-to-video', 'seedance', 'doubao-seedance-2.0', 1, 0, 'all', false],
  ['wan with no image yet', 'fal', 'wan-2.6', 0, 0, 'all', true],
  ['wan first frame', 'fal', 'wan-2.6', 1, 0, 'all', true],
  ['wan wrong reference slot', 'fal', 'wan-2.6', 0, 1, 'all', false],
  ['wan too many frames', 'fal', 'wan-2.6', 2, 0, 'all', false],
  ['kling first and last frames', 'fal', 'kling-o1-first-last', 2, 0, 'first-last', true],
  ['kling first-last with no image yet', 'fal', 'kling-o1-first-last', 0, 0, 'first-last', true],
  ['kling first-last extra reference', 'fal', 'kling-o1-first-last', 2, 1, 'first-last', false],
  ['kling reference images', 'fal', 'kling-o1-reference', 0, 2, 'all', true],
  ['kling reference with no image yet', 'fal', 'kling-o1-reference', 0, 0, 'all', true],
  ['kling unsupported first-last mode', 'fal', 'kling-o1-reference', 2, 0, 'first-last', false],
] as const)(
  'reports actual reference capability for %s',
  async (_label, providerId, model, inputs, references, referenceMode, expected) => {
    config.environmentSecrets.fal = 'isolated-reference-fixture';
    config.environmentSecrets.seedance = 'isolated-video-fixture';
    if (model === 'gpt-image-2')
      config.imageGateway = { baseUrl: 'https://images.example.test/v1', model };
    const assets = await Promise.all(
      Array.from({ length: inputs + references }, (_, n) => imageAsset(`reference-${n}.png`)),
    );
    const value = input({
      providerId,
      operation: providerId === 'openai' ? 'image.generate' : 'video.generate',
      assetIds: assets.slice(0, inputs).map((asset) => asset.id),
      referenceAssetIds: assets.slice(inputs).map((asset) => asset.id),
      options: { ...input().options, model, referenceMode },
    });
    await prepare(value);
    expect(analyze.mock.calls[0]![0].context.supportsReference).toBe(expected);
  },
);

it.each(['openai', 'fal'] as const)(
  'treats a document as planner context rather than an image for %s',
  async (providerId) => {
    const document = await app.services.core.assets.ingest(actor, wid, {
      buffer: Buffer.from('用户提供的外观说明，不是商品图。'),
      name: 'description.txt',
      mimeType: 'text/plain',
    });
    await app.services.core.assets.processPendingExtractions();
    const value = providerId === 'openai' ? input() : wanInput();
    value.options.kind = 'free';
    value.assetIds = [document.id];
    await prepare(value);
    const context = analyze.mock.calls[0]![0];
    // Image preparation strips document IDs; Wan's input slot accepts only a first-frame image.
    expect(context.context.supportsReference).toBe(providerId === 'openai');
    expect(context.materials).toContainEqual(
      expect.objectContaining({ id: document.id, kind: 'document' }),
    );
    expect(context.sourceTexts).toContainEqual(
      expect.objectContaining({ id: `document:${document.id}` }),
    );
  },
);

it('does not claim Wan can use brand images that would enter an unsupported reference slot', async () => {
  const asset = await imageAsset();
  const brand = await request('POST', '/brands', {
    name: '参考品牌',
    description: '仅图像参考',
    referenceAssetIds: [asset.id],
  });
  expect(brand.statusCode, brand.body).toBe(201);
  const value = wanInput();
  value.options.kind = 'free';
  value.brandId = brand.json().data.id;
  await prepare(value);
  expect(analyze.mock.calls[0]![0].materials).toContainEqual(
    expect.objectContaining({ id: asset.id, role: 'reference' }),
  );
  expect(analyze.mock.calls[0]![0].context.supportsReference).toBe(false);
});

it('uses only explicitly enabled, eligible personal context and never turns it into product evidence', async () => {
  const memory = app.services.core.knowledge.createMemory(actor, wid, {
    topic: '视觉偏好',
    content: '偏好绿色留白；私人职业信息',
    kind: 'preference',
  });
  app.services.core.knowledge.createMemory(actor, wid, {
    topic: '暂停偏好',
    content: '不可注入的暂停内容',
    kind: 'preference',
    status: 'paused',
  });
  app.services.core.knowledge.createMemory(actor, wid, {
    topic: '仅视频',
    content: '不可注入的运镜偏好',
    kind: 'preference',
    mediaType: 'video',
  });
  const selected = await prepare(input({ useMemory: true }));
  const context = analyze.mock.calls[0]![0];
  expect(context.memoryContext?.items).toEqual([
    expect.objectContaining({ id: memory.id, version: 1, content: memory.content }),
  ]);
  expect(context.sourceTexts).toEqual([{ id: 'request', text: input().prompt }]);
  expect(selected.contextSources).toEqual([
    expect.objectContaining({ kind: 'memory', id: memory.id, content: memory.content }),
  ]);
  const quote = app.services.quote(actor, wid, selected.input);
  const saved = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  expect(saved.items_json).not.toContain(memory.content);
  expect(saved.items_json).not.toContain('useMemory');
  await prepare(input({ useMemory: false }));
  await prepare(input());
  expect(analyze.mock.calls[1]![0].memoryContext).toBeUndefined();
  expect(analyze.mock.calls[2]![0].memoryContext).toBeUndefined();

  analyze.mockImplementationOnce(async (value) => {
    const output = result(value);
    output.brief.facts = [{ sourceId: memory.id, quote: memory.content }];
    return output;
  });
  const forged = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: input({ useMemory: true }),
  });
  expect(forged.statusCode).toBe(502);
});

it('resolves selected product and its brand as versioned text without silently attaching images', async () => {
  const asset = await imageAsset();
  const brand = app.services.core.references.createBrand(actor, wid, {
    name: '陶瓷品牌',
    description: '品牌旧说明',
    referenceAssetIds: [asset.id],
  });
  const product = app.services.core.knowledge.createProduct(actor, wid, {
    name: '白杯',
    facts: ['容量300毫升'],
    cautions: ['不可宣称抗菌'],
    brandId: brand.id,
    referenceAssetIds: [asset.id],
  });
  const prepared = await prepare(input({ productId: product.id }));
  const context = analyze.mock.calls[0]![0];
  expect(context.sourceTexts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: `product:${product.id}:v1`,
        text: expect.stringContaining('容量300毫升'),
      }),
      expect.objectContaining({ id: 'brand', text: expect.stringContaining('品牌旧说明') }),
    ]),
  );
  expect(context.materials).toEqual([]);
  expect(prepared.contextSources?.map((source) => source.kind)).toEqual(['brand', 'product']);
  const quote = app.services.quote(actor, wid, prepared.input);
  const row = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  expect(row.items_json).not.toContain('productId');
  expect(row.items_json).not.toContain('品牌旧说明');
  await prepare(input({ productId: product.id, includeProductImages: true }));
  expect(analyze.mock.calls[1]![0].materials).toContainEqual(
    expect.objectContaining({ id: asset.id, role: 'reference' }),
  );
});

it('freezes library sources and personal context through clarification and refreshes only on a new preparation', async () => {
  const brand = app.services.core.references.createBrand(actor, wid, {
    name: '品牌',
    description: '旧品牌资料',
  });
  const product = app.services.core.knowledge.createProduct(actor, wid, {
    name: '白杯',
    facts: ['容量300毫升'],
    brandId: brand.id,
  });
  const memory = app.services.core.knowledge.createMemory(actor, wid, {
    topic: '配色',
    content: '绿色留白',
    kind: 'preference',
  });
  const raw = input({ productId: product.id, useMemory: true });
  analyze.mockImplementationOnce(async (value) => clarification(value));
  const first = await prepare(raw);
  app.services.core.knowledge.updateProduct(actor, wid, product.id, {
    name: '白杯',
    facts: ['容量500毫升'],
    brandId: brand.id,
    expectedVersion: 1,
  });
  app.services.core.references.updateBrand(actor, wid, brand.id, {
    name: '品牌',
    description: '新品牌资料',
  });
  app.services.core.knowledge.updateMemory(actor, wid, memory.id, {
    topic: '配色',
    content: '蓝色留白',
    kind: 'preference',
    expectedVersion: 1,
  });
  const second = await prepare(raw, {
    previousId: first.id,
    answers: [{ questionId: 'subject', answer: '只画杯子，不标容量，按这次要求用红色背景' }],
  });
  expect(analyze.mock.calls[1]![0].memoryContext?.items[0]?.content).toBe('绿色留白');
  expect(analyze.mock.calls[1]![0].sourceTexts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: `product:${product.id}:v1`,
        text: expect.stringContaining('容量300毫升'),
      }),
      expect.objectContaining({ id: 'brand', text: expect.stringContaining('旧品牌资料') }),
      { id: 'answer:0', text: '只画杯子，不标容量，按这次要求用红色背景' },
    ]),
  );
  expect(second.contextSources).toEqual(first.contextSources);
  const quote = app.services.quote(actor, wid, second.input);
  const row = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  expect(row.items_json).not.toMatch(/容量300毫升|容量500毫升|绿色留白|蓝色留白/);
  const fresh = await prepare(raw);
  expect(fresh.contextSources).toContainEqual(
    expect.objectContaining({
      kind: 'product',
      version: 2,
      content: expect.stringContaining('容量500毫升'),
    }),
  );
  expect(fresh.contextSources).toContainEqual(
    expect.objectContaining({ kind: 'memory', version: 2, content: '蓝色留白' }),
  );
});

it('blocks expired or mismatched product data before a planner call', async () => {
  const brand = app.services.core.references.createBrand(actor, wid, { name: '品牌甲' });
  const other = app.services.core.references.createBrand(actor, wid, { name: '品牌乙' });
  const product = app.services.core.knowledge.createProduct(actor, wid, {
    name: '过期资料',
    brandId: brand.id,
    validUntil: '2000-01-01T00:00:00.000Z',
  });
  const expired = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: input({ productId: product.id }),
  });
  expect(expired.statusCode).toBe(409);
  expect(expired.body).toContain('PRODUCT_CONTEXT_EXPIRED');
  app.services.core.knowledge.updateProduct(actor, wid, product.id, {
    name: '有效资料',
    brandId: brand.id,
    validUntil: null,
    expectedVersion: 1,
  });
  const mismatch = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: input({ productId: product.id, brandId: other.id }),
  });
  expect(mismatch.statusCode).toBe(400);
  expect(mismatch.body).toContain('PRODUCT_BRAND_CONFLICT');
  expect(analyze).not.toHaveBeenCalled();
});

it('requires a prepared plan for product or personal memory and rejects unsupported operations', async () => {
  const product = app.services.core.knowledge.createProduct(actor, wid, { name: '白杯' });
  for (const fields of [{ productId: product.id }, { useMemory: true }]) {
    const response = await request('POST', '/quotes', input(fields));
    expect(response.statusCode).toBe(409);
    expect(response.body).toContain('KNOWLEDGE_PLAN_REQUIRED');
  }
  const unsupported = await request(
    'POST',
    '/quotes',
    input({ operation: 'text.assist', useMemory: true }),
  );
  expect(unsupported.statusCode).toBe(400);
  expect(unsupported.body).toContain('KNOWLEDGE_CONTEXT_UNSUPPORTED');
  const orphanImages = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: input({ includeProductImages: true }),
  });
  expect(orphanImages.statusCode).toBe(400);
  const services = createCreativeBriefServices(app.services);
  const key = app.services.core.business.createKey(actor, wid, {
    name: '隔离密钥',
    scopes: ['jobs:write', 'jobs:read'],
  });
  await expect(
    services.prepare(
      {
        ...actor,
        authType: 'apiKey',
        apiKeyId: key.key.id,
        workspaceId: wid,
        scopes: ['jobs:write'],
      },
      wid,
      { requestId: randomUUID(), input: input({ useMemory: true }) },
    ),
  ).rejects.toMatchObject({ code: 'MEMORY_SESSION_REQUIRED' });
  expect(analyze).not.toHaveBeenCalled();
  expect(count('quotes')).toBe(0);
});

it('invalidates a prepared plan when context selections change and retains old retry evidence after deleting memory', async () => {
  const memory = app.services.core.knowledge.createMemory(actor, wid, {
    topic: '配色',
    content: '绿色',
    kind: 'preference',
  });
  const prepared = await prepare(input({ useMemory: true }));
  app.services.core.knowledge.removeMemory(actor, wid, memory.id);
  const restored = await request('GET', `/creative-briefs/${prepared.id}`);
  expect(restored.json().data.contextSources).toEqual(prepared.contextSources);
  const changed = await request('POST', '/quotes', { ...prepared.input, useMemory: false });
  expect(changed.statusCode).toBe(409);
  expect(changed.body).toContain('CREATIVE_BRIEF_CHANGED');
  const fresh = await prepare(input({ useMemory: true }));
  expect(fresh.contextSources).toBeUndefined();
  expect(fresh.omittedMemoryCount).toBe(0);
});

it('rejects cross-workspace products and over-limit product pictures without any planner request', async () => {
  const other = app.services.core.auth.createWorkspace(actor.userId, '隔离产品空间', 'team');
  const privateProduct = app.services.core.knowledge.createProduct(actor, other.id, {
    name: '私有产品',
  });
  const forbidden = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: input({ productId: privateProduct.id }),
  });
  expect(forbidden.statusCode).toBe(404);
  const images = await Promise.all(Array.from({ length: 5 }, () => imageAsset()));
  const product = app.services.core.knowledge.createProduct(actor, wid, {
    name: '四张图',
    referenceAssetIds: images.slice(0, 4).map((asset) => asset.id),
  });
  const excessive = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: input({ productId: product.id, includeProductImages: true, assetIds: [images[4]!.id] }),
  });
  expect(excessive.statusCode).toBe(400);
  expect(analyze).not.toHaveBeenCalled();
});

it('does not expose private context snapshots through an API key owned by the same user', async () => {
  app.services.core.knowledge.createMemory(actor, wid, {
    topic: '职业',
    content: '仅本人登录读取的职业信息',
    kind: 'profile',
  });
  const prepared = await prepare(input({ useMemory: true }));
  const key = app.services.core.business.createKey(actor, wid, {
    name: '合法接口密钥',
    scopes: ['jobs:read', 'jobs:write'],
  });
  const keyActor: Actor = {
    ...actor,
    authType: 'apiKey',
    apiKeyId: key.key.id,
    workspaceId: wid,
    scopes: ['jobs:read', 'jobs:write'],
  };
  const services = createCreativeBriefServices(app.services);
  expect(() => services.get(keyActor, wid, prepared.id)).toThrow('本人登录会话');
  expect(() => app.services.quote(keyActor, wid, prepared.input)).toThrow('个人记忆');
});

it('blocks a new quote using expired product evidence while retaining an already issued quote snapshot', async () => {
  const initial = Date.now();
  const product = app.services.core.knowledge.createProduct(actor, wid, {
    name: '限时资料',
    facts: ['活动价格99元'],
    validUntil: new Date(initial + 60_000).toISOString(),
  });
  const prepared = await prepare(input({ productId: product.id }));
  const quote = app.services.quote(actor, wid, prepared.input);
  const time = vi.spyOn(Date, 'now').mockReturnValue(initial + 120_000);
  try {
    expect(() => app.services.quote(actor, wid, prepared.input)).toThrow('已过期');
    const submitted = app.services.submit(actor, wid, prepared.input, quote.id, randomUUID());
    expect(submitted.status).toBe('queued');
    expect(submitted.items).toHaveLength(1);
    const restored = createCreativeBriefServices(app.services).get(actor, wid, prepared.id);
    expect(restored.contextSources?.find((source) => source.kind === 'product')?.expiresAt).toBe(
      product.validUntil,
    );
  } finally {
    time.mockRestore();
  }
});

it.each(['product', 'temporary-memory', 'decayed-memory'] as const)(
  'blocks a retry quote using expired %s without changing the previous job or balance',
  async (kind) => {
    const initial = Date.now();
    let selection: Partial<JobInput>;
    if (kind === 'product') {
      const product = app.services.core.knowledge.createProduct(actor, wid, {
        name: '限时产品',
        facts: ['限时价格99元'],
        validUntil: new Date(initial + 60_000).toISOString(),
      });
      selection = { productId: product.id };
    } else {
      app.services.core.knowledge.createMemory(actor, wid, {
        topic: '活动配色',
        content: '本次活动使用红色',
        kind: kind === 'temporary-memory' ? 'temporary' : 'preference',
        ...(kind === 'temporary-memory'
          ? { expiresAt: new Date(initial + 60_000).toISOString() }
          : { halfLifeDays: 1 }),
      });
      selection = { useMemory: true };
    }
    const prepared = await prepare(input(selection));
    const quote = app.services.quote(actor, wid, prepared.input);
    const job = app.services.submit(actor, wid, prepared.input, quote.id, randomUUID());
    app.services.cancel(actor, wid, job.id);
    const balance = app.services.balance(actor, wid);
    const quotes = count('quotes');
    const time = vi
      .spyOn(Date, 'now')
      .mockReturnValue(initial + (kind === 'decayed-memory' ? 3 * 86_400_000 : 120_000));
    try {
      expect(() => app.services.retryQuote(actor, wid, job.id)).toThrow('已过期');
      expect(count('quotes')).toBe(quotes);
      expect(app.services.balance(actor, wid)).toEqual(balance);
      expect(app.services.get(actor, wid, job.id).status).toBe('cancelled');
      expect(analyze).toHaveBeenCalledTimes(1);
    } finally {
      time.mockRestore();
    }
  },
);

it('rejects expired personal context before continuing a clarification and refreshes it in a new request', async () => {
  const initial = Date.now();
  app.services.core.knowledge.createMemory(actor, wid, {
    topic: '今日活动',
    content: '活动主题为红色',
    kind: 'temporary',
    expiresAt: new Date(initial + 60_000).toISOString(),
  });
  analyze.mockImplementationOnce(async (value) => clarification(value));
  const raw = input({ useMemory: true });
  const first = await prepare(raw);
  const time = vi.spyOn(Date, 'now').mockReturnValue(initial + 120_000);
  try {
    const next = await request('POST', '/creative-briefs/prepare', {
      requestId: randomUUID(),
      input: raw,
      previousId: first.id,
      answers: [{ questionId: 'subject', answer: '杯子' }],
    });
    expect(next.statusCode).toBe(409);
    expect(next.body).toContain('KNOWLEDGE_CONTEXT_EXPIRED');
    expect(analyze).toHaveBeenCalledTimes(1);
    const fresh = await prepare(raw);
    expect(fresh.contextSources).toBeUndefined();
  } finally {
    time.mockRestore();
  }
});

it('keeps an explicitly selected brand snapshot after its library record is removed, but still checks frozen assets', async () => {
  delete app.services.config.imageGateway;
  const asset = await imageAsset();
  const brand = app.services.core.references.createBrand(actor, wid, {
    name: '已确认品牌',
    description: '旧品牌风格',
    referenceAssetIds: [asset.id],
  });
  const prepared = await prepare(
    input({ brandId: brand.id, options: { ...input().options, model: 'gpt-image-2' } }),
  );
  app.services.core.references.removeBrand(actor, wid, brand.id);
  const quote = app.services.quote(actor, wid, prepared.input);
  const saved = app.services.db.sqlite
    .prepare('SELECT items_json FROM quotes WHERE id=?')
    .get(quote.id) as { items_json: string };
  expect(JSON.parse(saved.items_json)[0].referenceAssetIds).toContain(asset.id);
  app.services.core.assets.remove(actor, wid, asset.id);
  expect(() => app.services.quote(actor, wid, prepared.input)).toThrow();
});

it.each(['product', 'memory', 'product-images'] as const)(
  'rejects unplanned grouped %s context before preparation or quotation',
  async (selection) => {
    delete app.services.config.imageGateway;
    const product = app.services.core.knowledge.createProduct(actor, wid, {
      name: '分组产品',
      cautions: ['不可宣称抗菌'],
    });
    const raw = input({
      ...(selection === 'memory' ? { useMemory: true } : { productId: product.id }),
      ...(selection === 'product-images' ? { includeProductImages: true } : {}),
      options: {
        ...input().options,
        model: 'gpt-image-2',
        designs: [
          {
            id: randomUUID(),
            name: '旧模块',
            kind: 'marketing',
            ratio: '1:1',
            prompt: '旧模块仍要求宣称99%抗菌',
            assetIds: [],
          },
        ],
      },
    });
    const preparation = await request('POST', '/creative-briefs/prepare', {
      requestId: randomUUID(),
      input: raw,
    });
    expect(preparation.statusCode, preparation.body).toBe(400);
    expect(preparation.body).toContain('KNOWLEDGE_GROUP_UNSUPPORTED');
    const quote = await request('POST', '/quotes', raw);
    expect(quote.statusCode, quote.body).toBe(400);
    expect(quote.body).toContain('KNOWLEDGE_GROUP_UNSUPPORTED');
    expect(analyze).not.toHaveBeenCalled();
    expect(count('creative_briefs')).toBe(0);
    expect(count('quotes')).toBe(0);
  },
);

it.each([undefined, false] as const)(
  'preserves legacy grouped creation with memory %s',
  async (useMemory) => {
    delete app.services.config.imageGateway;
    const raw = input({
      ...(useMemory === undefined ? {} : { useMemory, includeProductImages: false }),
      options: {
        ...input().options,
        model: 'gpt-image-2',
        designs: [
          {
            id: randomUUID(),
            name: '主图',
            kind: 'marketing',
            ratio: '1:1',
            prompt: '白色背景',
            assetIds: [],
          },
          {
            id: randomUUID(),
            name: '附图',
            kind: 'marketing',
            ratio: '1:1',
            prompt: '绿色背景',
            assetIds: [],
          },
        ],
      },
    });
    const prepared = await prepare(raw);
    expect(analyze.mock.calls.at(-1)![0].memoryContext).toBeUndefined();
    const quote = app.services.quote(actor, wid, prepared.input);
    const saved = app.services.db.sqlite
      .prepare('SELECT items_json FROM quotes WHERE id=?')
      .get(quote.id) as { items_json: string };
    const parts = JSON.parse(saved.items_json) as JobInput[];
    expect(parts).toHaveLength(2);
    expect(parts[0]!.prompt).toContain('本张物料：主图。白色背景');
    expect(parts[1]!.prompt).toContain('本张物料：附图。绿色背景');
  },
);

it.each(['analyzing', 'uncertain'] as const)(
  'protects an %s Dify preparation with private context from a fresh request ID',
  async (state) => {
    app.services.core.knowledge.createMemory(actor, wid, {
      topic: '风格',
      content: '适当留白',
      kind: 'preference',
    });
    const initial = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initial);
    const raw = input({ useMemory: true });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    analyze.mockImplementationOnce(async (value) => {
      started();
      if (state === 'uncertain') throw new ProviderError('工作流结果未知', true, 'DIFY_UNCERTAIN');
      await held;
      return result(value);
    });
    const pending = request('POST', '/creative-briefs/prepare', {
      requestId: randomUUID(),
      input: raw,
    });
    try {
      await entered;
      if (state === 'uncertain') expect((await pending).statusCode).toBe(502);
      clock.mockReturnValue(initial + 60_000);
      const repeated = await request('POST', '/creative-briefs/prepare', {
        requestId: randomUUID(),
        input: raw,
      });
      expect(analyze).toHaveBeenCalledTimes(1);
      expect(repeated.statusCode, repeated.body).toBe(409);
      expect(repeated.body).toContain('CREATIVE_BRIEF_UNCERTAIN');
      expect(count('creative_briefs')).toBe(1);
    } finally {
      release();
      if (state === 'analyzing') expect((await pending).statusCode).toBe(200);
      clock.mockRestore();
    }
  },
);

it('allows an explicit new request after changing the actual Dify planner connection', async () => {
  const raw = input({ useMemory: true });
  analyze.mockRejectedValueOnce(new ProviderError('旧工作流结果未知', true, 'DIFY_UNCERTAIN'));
  const failed = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: raw,
  });
  expect(failed.statusCode).toBe(502);
  const old = app.services.db.sqlite
    .prepare('SELECT input_json,request_json FROM creative_briefs')
    .get() as { input_json: string; request_json: string };
  config.environmentSecrets.dify = 'isolated-new-planner-credential';
  const fresh = await prepare(raw);
  expect(fresh.status).toBe('ready');
  expect(analyze).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(old)).not.toContain('isolated-planner-fixture');
  expect(JSON.stringify(fresh)).not.toContain('isolated-new-planner-credential');
});

it('preserves explicit retry behavior for legacy nonnative attempts with no recorded planner identity', async () => {
  const raw = input({ useMemory: true });
  analyze.mockRejectedValueOnce(new ProviderError('迁移前工作流结果未知', true, 'DIFY_UNCERTAIN'));
  const failed = await request('POST', '/creative-briefs/prepare', {
    requestId: randomUUID(),
    input: raw,
  });
  expect(failed.statusCode).toBe(502);
  app.services.db.sqlite.prepare('UPDATE creative_briefs SET planner_revision=NULL').run();
  expect((await prepare(raw)).status).toBe('ready');
  expect(analyze).toHaveBeenCalledTimes(2);
});

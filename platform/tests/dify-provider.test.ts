import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { jobInputSchema } from '../src/contracts/jobs';
import { createDifyProvider, parseDifyPlanJson, type DifyPlan } from '../src/server/providers/dify';
import { providerJson } from '../src/server/providers/http';
import { ProviderError, type ExecutionContext } from '../src/server/tasks/types';

vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const call = vi.mocked(providerJson);
const provider = createDifyProvider();

function plan(): DifyPlan {
  return {
    schema_version: '1.0',
    status: 'needs_confirmation',
    delivery_type: 'both',
    product_facts: ['用户提供：白色陶瓷杯，300毫升'],
    unknowns: ['品牌名称未提供'],
    creative_direction: '明亮、简洁的商品展示',
    image_tasks: [
      {
        id: 'image_1',
        purpose: '商品主图与视频首帧',
        prompt: '以用户提供的白色陶瓷杯为主体，不添加未提供的品牌。',
        reference_required: true,
      },
    ],
    video_shots: [
      {
        id: 'shot_1',
        source_image_id: 'image_1',
        prompt: '镜头缓慢靠近杯子。',
        duration_seconds: 0,
      },
    ],
    voiceover_text: '白色陶瓷杯，300毫升。',
    questions: ['请确认镜头时长，并提供有权使用的商品参考图。'],
  };
}

function response(value: unknown = JSON.stringify(plan())) {
  return {
    workflow_run_id: 'workflow-contract-run',
    task_id: 'workflow-contract-task',
    data: { status: 'succeeded', outputs: { plan_json: value } },
  };
}

function context(overrides: Record<string, unknown> = {}): ExecutionContext {
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse({
      providerId: 'dify',
      operation: 'text.assist',
      prompt: '为白色陶瓷杯策划商品图片和视频，容量300毫升。',
      ...overrides,
    }),
    readAsset: vi.fn(async () => {
      throw new Error('Asset access is forbidden for this text-only workflow');
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  call.mockResolvedValue(response());
});

it('submits only the published brief input and returns every plan section without fabricated design directions', async () => {
  const ctx = context();
  const result = await provider.execute(ctx, 'dify-contract-test-key');
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]).toEqual([
    'https://api.dify.ai/v1/workflows/run',
    {
      headers: { Authorization: 'Bearer dify-contract-test-key' },
      body: {
        inputs: { brief: ctx.input.prompt },
        response_mode: 'blocking',
        user: expect.stringMatching(/^yingzao_[0-9a-f]{48}$/),
      },
      submission: true,
      timeoutMs: 120000,
    },
  ]);
  if (result.state !== 'complete') throw new Error('Expected completed planning text');
  expect(result.outputs).toHaveLength(1);
  const output = result.outputs[0]!;
  expect(output.resultData).toBeUndefined();
  expect(output.text).toContain('尚未执行图片、视频或配音生成');
  for (const value of [
    plan().product_facts[0],
    plan().unknowns[0],
    plan().creative_direction,
    plan().image_tasks[0]!.purpose,
    plan().image_tasks[0]!.prompt,
    plan().video_shots[0]!.prompt,
    plan().voiceover_text,
    plan().questions[0],
  ])
    expect(output.text).toContain(value);
  expect(output.text).toContain('首帧图片任务：image_1');
  expect(output.text).toContain('时长：待确认');
  expect(output.text).not.toContain('方向3');
  expect(ctx.readAsset).not.toHaveBeenCalled();
});

it('keeps the Dify user stable for one workspace and separates the same user in another workspace', async () => {
  const ctx = context();
  await provider.execute(ctx, 'contract-key');
  await provider.execute(ctx, 'contract-key');
  await provider.execute({ ...ctx, workspaceId: randomUUID() }, 'contract-key');
  const users = call.mock.calls.map(([, options]) => (options!.body as { user: string }).user);
  expect(users[0]).toBe(users[1]);
  expect(users[2]).not.toBe(users[0]);
  expect(users[0]).not.toContain(ctx.actor.userId);
  expect(users[0]).not.toContain(ctx.workspaceId);
});

it('uses an explicitly configured HTTPS base path without following a separate untrusted response URL', async () => {
  await createDifyProvider({ baseUrl: 'https://dify.example.test/custom/v1/' }).execute(
    context(),
    'contract-key',
  );
  expect(call.mock.calls[0]![0]).toBe('https://dify.example.test/custom/v1/workflows/run');
});

it.each([
  'http://dify.example.test/v1',
  'https://user:password@dify.example.test/v1',
  'https://dify.example.test/v1?secret=private',
  'https://dify.example.test/v1#fragment',
  'invalid',
])('rejects an unsafe or malformed base URL before requesting it: %s', (baseUrl) => {
  expect(() => createDifyProvider({ baseUrl })).toThrow(ProviderError);
  expect(call).not.toHaveBeenCalled();
});

it.each([
  { assetIds: [randomUUID()] },
  { referenceAssetIds: [randomUUID()] },
  { maskAssetId: randomUUID() },
  { backgroundAssetId: randomUUID() },
  { backgroundAudioAssetId: randomUUID() },
  { characterId: randomUUID() },
  { brandId: randomUUID() },
  { linkUrl: 'https://example.test/product' },
  { options: { count: 2 } },
  { options: { designs: [{ id: randomUUID(), name: '设计一', kind: 'free', ratio: '1:1' }] } },
  { referenceText: '外部文档中的产品事实' },
  { conversationContext: '之前的项目上下文' },
  { options: { assistantMode: 'design-plan' } },
  { operation: 'image.generate' },
  { prompt: ' ' },
  { prompt: '过'.repeat(8001) },
])('rejects unsupported context or input before any paid workflow call: %j', async (input) => {
  await expect(provider.execute(context(input), 'contract-key')).rejects.toMatchObject({
    ambiguous: false,
  });
  expect(call).not.toHaveBeenCalled();
});

it('requires an application key before making a workflow request', async () => {
  await expect(provider.execute(context())).rejects.toMatchObject({ ambiguous: false });
  expect(call).not.toHaveBeenCalled();
});

it.each([
  ['extra fields', (value: Record<string, unknown>) => (value.execute = true)],
  ['auto-approved state', (value: Record<string, unknown>) => (value.status = 'approved')],
  ['unknown schema', (value: Record<string, unknown>) => (value.schema_version = '2.0')],
  [
    'invalid delivery type',
    (value: Record<string, unknown>) => (value.delivery_type = 'image|video'),
  ],
  [
    'missing questions for unknown duration',
    (value: Record<string, unknown>) => (value.questions = []),
  ],
  [
    'empty task prompt',
    (value: Record<string, unknown>) =>
      ((value.image_tasks as DifyPlan['image_tasks'])[0]!.prompt = ' '),
  ],
  [
    'non-boolean reference flag',
    (value: Record<string, unknown>) =>
      ((value.image_tasks as Record<string, unknown>[])[0]!.reference_required = 'true'),
  ],
  [
    'duplicated global task id',
    (value: Record<string, unknown>) =>
      ((value.video_shots as DifyPlan['video_shots'])[0]!.id = 'image_1'),
  ],
  [
    'missing image reference',
    (value: Record<string, unknown>) =>
      ((value.video_shots as DifyPlan['video_shots'])[0]!.source_image_id = 'not_present'),
  ],
  [
    'excessive video duration',
    (value: Record<string, unknown>) =>
      ((value.video_shots as DifyPlan['video_shots'])[0]!.duration_seconds = 16),
  ],
  [
    'video tasks in image-only plan',
    (value: Record<string, unknown>) => (value.delivery_type = 'image'),
  ],
  ['missing required images', (value: Record<string, unknown>) => (value.image_tasks = [])],
])(
  'rejects invalid workflow contracts without leaking their contents: %s',
  async (_name, mutate) => {
    const invalid = plan();
    mutate(invalid);
    call.mockResolvedValue(response(JSON.stringify(invalid)));
    await expect(provider.execute(context(), 'contract-key')).rejects.toMatchObject({
      code: 'DIFY_PLAN_INVALID',
      ambiguous: true,
    });
    expect(call).toHaveBeenCalledTimes(1);
  },
);

it('rejects duplicate JSON fields including escaped aliases instead of accepting the last value', () => {
  const valid = JSON.stringify(plan());
  const duplicate = valid.replace(
    '"status":"needs_confirmation"',
    '"status":"approved","st\\u0061tus":"needs_confirmation"',
  );
  expect(() => parseDifyPlanJson(duplicate)).toThrow(ProviderError);
  expect(parseDifyPlanJson(valid)).toEqual(plan());
});

it.each([undefined, plan(), 'private-unparseable-content', ' '.repeat(65537), '```json\n{}\n```'])(
  'requires a bounded raw plan_json string from the validated output',
  (value) => {
    expect(() => parseDifyPlanJson(value)).toThrow(ProviderError);
  },
);

it.each([
  {},
  { data: { status: 'succeeded', outputs: { plan_json: JSON.stringify(plan()) } } },
  { workflow_run_id: 'run', data: { status: 'running' } },
  { workflow_run_id: 'run', data: { status: 'succeeded', outputs: {} } },
])('retains ambiguous workflow results for reconciliation', async (value) => {
  call.mockResolvedValue(value);
  await expect(provider.execute(context(), 'contract-key')).rejects.toMatchObject({
    ambiguous: true,
  });
  expect(call).toHaveBeenCalledTimes(1);
});

it.each(['failed', 'stopped'])(
  'returns a terminal %s without exposing provider error details',
  async (status) => {
    call.mockResolvedValue({
      workflow_run_id: 'run',
      data: { status, outputs: null, error: 'private-provider-request-and-secret' },
    });
    const result = await provider.execute(context(), 'contract-key');
    expect(result.state).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('private-provider-request-and-secret');
  },
);

it('does not resubmit when the HTTP layer reports an ambiguous submission', async () => {
  call.mockRejectedValue(new ProviderError('服务连接中断，提交结果需要核对。', true));
  await expect(provider.execute(context(), 'contract-key')).rejects.toMatchObject({
    ambiguous: true,
  });
  expect(call).toHaveBeenCalledTimes(1);
});

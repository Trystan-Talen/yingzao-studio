import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { jobInputSchema } from '../src/contracts/jobs';
import type { DetailPagePlanResult } from '../src/contracts/detail-page';
import { createDifyProvider, parseDifyDetailPageJson } from '../src/server/providers/dify';
import { providerJson } from '../src/server/providers/http';
import { ProviderError, type ExecutionContext } from '../src/server/tasks/types';

vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const call = vi.mocked(providerJson);
const provider = createDifyProvider();
const fetchCall = vi.fn<typeof fetch>();
function plan(screenCount = 6, ratio: '3:4' | '2:3' | '9:16' = '3:4'): DetailPagePlanResult {
  return {
    type: 'detail-page-plan',
    version: 1,
    plan: {
      productName: '白色陶瓷杯',
      productFacts: ['白色陶瓷杯', '容量300毫升'],
      audience: '建议面向日常饮水人群，需用户确认',
      visualStyle: '简洁自然商品摄影',
      palette: ['米白', '浅木色'],
      consistencyNotes: '统一商品外观、光线、标题位置与配色',
      unknowns: ['品牌与适用温度未提供'],
      screens: Array.from({ length: screenCount }, (_, index) => ({
        id: `screen_${index + 1}`,
        title: `商品展示${index + 1}`,
        purpose: '展示用户已提供的商品事实',
        copy: ['白色陶瓷杯'],
        prompt: '统一米白背景与柔和侧光，保留商品外观。',
        ratio,
      })),
    },
  };
}
function response(value: unknown = JSON.stringify(plan())) {
  const data = [
    {
      event: 'workflow_started',
      workflow_run_id: 'detail-contract-run',
      data: { id: 'detail-contract-run' },
    },
    {
      event: 'workflow_finished',
      workflow_run_id: 'detail-contract-run',
      data: { id: 'detail-contract-run', status: 'succeeded', outputs: { plan_json: value } },
    },
  ];
  return new Response(data.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
function context(
  options: Record<string, unknown> = {},
  input: Record<string, unknown> = {},
): ExecutionContext {
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
      prompt: '白色陶瓷杯，容量300毫升，请策划完整商品详情页。',
      options: { assistantMode: 'detail-page', ratio: '3:4', ...options },
      ...input,
    }),
    readAsset: vi.fn(async () => {
      throw new Error('No asset access is authorized during planning');
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchCall);
  fetchCall.mockResolvedValue(response());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('requests six complete screens and persists a detail-page result without pretending three directions are six screens', async () => {
  const ctx = context();
  const result = await provider.execute(ctx, 'contract-key');
  expect(fetchCall).toHaveBeenCalledTimes(1);
  expect(fetchCall.mock.calls[0]?.[0]).toBe('https://api.dify.ai/v1/workflows/run');
  expect(JSON.parse(String(fetchCall.mock.calls[0]?.[1]?.body))).toEqual({
    inputs: {
      brief: ctx.input.prompt,
      planning_mode: 'detail-page',
      screen_count: 6,
      ratio: '3:4',
    },
    response_mode: 'streaming',
    user: expect.stringMatching(/^yingzao_[0-9a-f]{48}$/),
  });
  expect(fetchCall.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
  expect(call).not.toHaveBeenCalled();
  if (result.state !== 'complete') throw new Error('Expected a completed plan');
  expect(result.outputs).toHaveLength(1);
  expect(result.outputs[0]?.resultData).toEqual(plan());
  expect(result.outputs[0]?.text).toContain('待确认');
  expect(result.outputs[0]?.text).toContain('未提交图片生成');
  expect(result.outputs[0]?.text).toContain('6. 商品展示6');
  expect(result.outputs[0]?.text).not.toContain('方向3');
  expect(result.outputs[0]?.url).toBeUndefined();
  expect(result.outputs[0]?.buffer).toBeUndefined();
  expect(ctx.readAsset).not.toHaveBeenCalled();
});

it.each([
  [2, '2:3'],
  [10, '9:16'],
] as const)('preserves an explicit %i-screen request at ratio %s', async (screenCount, ratio) => {
  fetchCall.mockResolvedValue(response(JSON.stringify(plan(screenCount, ratio))));
  const result = await provider.execute(
    context({ detailPageScreenCount: screenCount, ratio }),
    'contract-key',
  );
  expect(result.state).toBe('complete');
  expect(JSON.parse(String(fetchCall.mock.calls[0]?.[1]?.body))).toMatchObject({
    inputs: { screen_count: screenCount, ratio },
  });
});

it.each([
  [
    'too few screens',
    (p: DetailPagePlanResult) => {
      p.plan.screens.pop();
    },
  ],
  [
    'too many screens',
    (p: DetailPagePlanResult) => {
      p.plan.screens.push({ ...p.plan.screens[0]!, id: 'extra' });
    },
  ],
  [
    'wrong ratio',
    (p: DetailPagePlanResult) => {
      p.plan.screens[0]!.ratio = '9:16';
    },
  ],
  [
    'duplicate ids',
    (p: DetailPagePlanResult) => {
      p.plan.screens[1]!.id = p.plan.screens[0]!.id;
    },
  ],
  [
    'empty prompt',
    (p: DetailPagePlanResult) => {
      p.plan.screens[0]!.prompt = ' ';
    },
  ],
  [
    'fabricated asset id',
    (p: DetailPagePlanResult) => {
      Object.assign(p.plan.screens[0]!, { assetId: randomUUID() });
    },
  ],
  [
    'pretend executed',
    (p: DetailPagePlanResult) => {
      Object.assign(p, { status: 'succeeded' });
    },
  ],
  [
    'unknown schema version',
    (p: DetailPagePlanResult) => {
      Object.assign(p, { version: 2 });
    },
  ],
  [
    'missing known facts',
    (p: DetailPagePlanResult) => {
      p.plan.productFacts = [];
    },
  ],
])(
  'retains invalid %s as ambiguous, with one request and no response leak',
  async (_name, mutate) => {
    const value = plan();
    mutate(value);
    value.plan.unknowns.push('private-marker-must-not-leak');
    fetchCall.mockResolvedValue(response(JSON.stringify(value)));
    await expect(provider.execute(context(), 'contract-key')).rejects.toMatchObject({
      ambiguous: true,
      code: 'DIFY_DETAIL_PAGE_INVALID',
    });
    expect(fetchCall).toHaveBeenCalledTimes(1);
    try {
      await Promise.resolve(
        parseDifyDetailPageJson(JSON.stringify(value), { screenCount: 6, ratio: '3:4' }),
      );
    } catch (error) {
      expect(String(error)).not.toContain('private-marker-must-not-leak');
    }
  },
);

it.each([{}, '```json\n{}\n```', 'not-json', undefined, 'x'.repeat(65537)])(
  'rejects malformed output instead of falling back to fake screens',
  (value) => {
    expect(() => parseDifyDetailPageJson(value, { screenCount: 6, ratio: '3:4' })).toThrow(
      ProviderError,
    );
  },
);

it.each([
  ['visualStyle', '品牌待确认'],
  ['consistencyNotes', '容量待确认'],
  ['title', '价格待补充'],
  ['copy', '售后待补充'],
  ['prompt', '价格售后待补充'],
  ['copy', '价格/售后待补充'],
  ['title', '参数待填'],
  ['prompt', '参考图待确认'],
  ['copy', '待确认商品'],
] as const)(
  'rejects internal placeholder %s / %s in a completed result without exposing its text',
  async (field, phrase) => {
    const value = plan();
    const privateText = `${phrase} private-response-marker`;
    if (field === 'visualStyle' || field === 'consistencyNotes') value.plan[field] = privateText;
    else if (field === 'copy') value.plan.screens[0]!.copy = [privateText];
    else value.plan.screens[0]![field] = privateText;
    fetchCall.mockResolvedValue(response(JSON.stringify(value)));
    await expect(provider.execute(context(), 'contract-key')).rejects.toMatchObject({
      ambiguous: true,
      code: 'DIFY_DETAIL_PAGE_INVALID',
    });
    expect(() =>
      parseDifyDetailPageJson(JSON.stringify(value), { screenCount: 6, ratio: '3:4' }),
    ).toThrow(expect.not.stringContaining('private-response-marker'));
    expect(fetchCall).toHaveBeenCalledOnce();
    expect(call).not.toHaveBeenCalled();
  },
);

it('keeps confirmation reminders outside finished content and permits unrelated technical product text', () => {
  const value = plan();
  value.plan.unknowns = ['品牌待确认', '容量待确认', '参考图待确认'];
  value.plan.audience = '适用人群与品牌待确认';
  value.plan.screens[0]!.purpose = '记录参数待填的核对事项';
  value.plan.screens[0]!.copy = ['API 接口展示'];
  expect(parseDifyDetailPageJson(JSON.stringify(value), { screenCount: 6, ratio: '3:4' })).toEqual(
    value,
  );
});

it('rejects duplicate JSON keys even when the last field would satisfy the requested count', () => {
  const value = JSON.stringify(plan()).replace('"version":1', '"version":2,"vers\\u0069on":1');
  expect(() => parseDifyDetailPageJson(value, { screenCount: 6, ratio: '3:4' })).toThrow(
    ProviderError,
  );
});

it('accepts all 24 merged unknowns but rejects a 25th without silently dropping information', async () => {
  const value = plan();
  value.plan.unknowns = Array.from({ length: 24 }, (_, index) => `待确认事项${index}`);
  fetchCall.mockResolvedValue(response(JSON.stringify(value)));
  const result = await provider.execute(context(), 'contract-key');
  expect(result.state).toBe('complete');
  if (result.state !== 'complete') throw new Error('Expected complete');
  expect(result.outputs[0]?.resultData).toEqual(value);
  value.plan.unknowns.push('新增未确认事项');
  expect(() =>
    parseDifyDetailPageJson(JSON.stringify(value), { screenCount: 6, ratio: '3:4' }),
  ).toThrow(ProviderError);
  expect(fetchCall).toHaveBeenCalledOnce();
});

it.each([
  [{ ratio: '1:1' }, {}],
  [{ count: 2 }, {}],
  [{}, { prompt: '过'.repeat(5001) }],
  [{}, { referenceAssetIds: [randomUUID()] }],
  [{}, { assetIds: [randomUUID()] }],
  [{}, { referenceText: '未经本次明确提交的事实' }],
  [{}, { brandId: randomUUID() }],
])('rejects unsupported planning input before calling Dify', async (options, input) => {
  await expect(provider.execute(context(options, input), 'contract-key')).rejects.toMatchObject({
    ambiguous: false,
  });
  expect(call).not.toHaveBeenCalled();
});

it('never retries an uncertain paid planning submission', async () => {
  fetchCall.mockRejectedValue(new Error('private-secret-error'));
  await expect(provider.execute(context(), 'contract-key')).rejects.toMatchObject({
    ambiguous: true,
  });
  expect(fetchCall).toHaveBeenCalledTimes(1);
});

const acceptedRemote = {
  id: 'detail-contract-run',
  difyMode: 'detail-page' as const,
  detailPageScreenCount: 6,
  detailPageRatio: '3:4' as const,
};
const frame = (value: unknown) =>
  new TextEncoder().encode(`data: ${JSON.stringify(value)}\r\n\r\n`);
const started = {
  event: 'workflow_started',
  workflow_run_id: acceptedRemote.id,
  data: { id: acceptedRemote.id },
};

it('persists the accepted id before completion and keeps the stream open while the workflow runs', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel: cancelled,
  });
  fetchCall.mockResolvedValue(
    new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
  );
  let persisted!: () => void;
  const persistence = new Promise<void>((resolve) => {
    persisted = resolve;
  });
  const ctx = context();
  ctx.onRemoteAccepted = vi.fn(async (remote) => {
    expect(remote).toEqual(acceptedRemote);
    persisted();
  });
  let finished = false;
  const result = provider.execute(ctx, 'contract-key').then((value) => {
    finished = true;
    return value;
  });
  const bytes = frame(started);
  controller.enqueue(bytes.slice(0, 11));
  controller.enqueue(bytes.slice(11));
  await persistence;
  expect(finished).toBe(false);
  expect(cancelled).not.toHaveBeenCalled();
  expect(ctx.onRemoteAccepted).toHaveBeenCalledTimes(1);
  controller.enqueue(
    frame({
      event: 'workflow_finished',
      workflow_run_id: acceptedRemote.id,
      data: {
        id: acceptedRemote.id,
        status: 'succeeded',
        outputs: { plan_json: JSON.stringify(plan()) },
      },
    }),
  );
  expect((await result).state).toBe('complete');
  expect(fetchCall).toHaveBeenCalledTimes(1);
});

it('recovers a disconnected accepted stream using only GET of the same id from a fresh adapter', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  fetchCall.mockResolvedValue(
    new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
  );
  const ctx = context();
  let persisted!: () => void;
  const saved = new Promise<void>((resolve) => {
    persisted = resolve;
  });
  ctx.onRemoteAccepted = vi.fn(() => {
    persisted();
  });
  const task = provider.execute(ctx, 'contract-key');
  controller.enqueue(frame(started));
  await saved;
  controller.error(new Error('private-connection-detail'));
  const result = await task;
  expect(result).toEqual({ state: 'submitted', remote: acceptedRemote });
  const restarted = createDifyProvider();
  call.mockResolvedValue({
    id: acceptedRemote.id,
    status: 'succeeded',
    outputs: { plan_json: JSON.stringify(plan()) },
  });
  const recovered = await restarted.poll!(
    JSON.parse(JSON.stringify(acceptedRemote)),
    'contract-key',
  );
  expect(recovered.state).toBe('complete');
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'https://api.dify.ai/v1/workflows/run/detail-contract-run',
    { method: 'GET', headers: { Authorization: 'Bearer contract-key' }, timeoutMs: 30000 },
  );
  expect(fetchCall).toHaveBeenCalledTimes(1);
});

it.each(['failed', 'stopped', 'partial-succeeded'])(
  'reports the workflow terminal %s through polling without leaking upstream errors',
  async (status) => {
    call.mockResolvedValue({
      id: acceptedRemote.id,
      status,
      outputs: null,
      error: 'private-secret-detail',
    });
    const result = await provider.poll!(acceptedRemote, 'contract-key');
    expect(result.state).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('private-secret-detail');
    expect(fetchCall).not.toHaveBeenCalled();
  },
);

it.each([
  ['DETAIL_PAGE_FIELDS_INVALID', '缺少必填字段'],
  ['DETAIL_PAGE_RESPONSE_INCOMPLETE', '模型输出未完整结束'],
  ['DETAIL_PAGE_FACT_NOT_IN_BRIEF', '商品事实未能逐字对应'],
  ['DETAIL_PAGE_LIST_INVALID', '列表条数或条目格式'],
  ['DETAIL_PAGE_UNSOURCED_NUMBER', '没有提供的数字'],
  ['DETAIL_PAGE_UNSOURCED_CLAIM', '功效、认证或营销声明'],
  ['DETAIL_PAGE_INTERNAL_PLACEHOLDER', '内部待确认占位内容'],
  ['DETAIL_PAGE_SCREEN_COUNT_MISMATCH', '方案屏数'],
  ['DETAIL_PAGE_FACTS_HTTP_400', '商品事实提取：请求内容不符合模型接口要求（400）'],
  ['DETAIL_PAGE_VISUAL_HTTP_401', '整套视觉规范：模型接口身份验证失败（401）'],
  ['DETAIL_PAGE_SCREENS_HTTP_403', '逐屏策划：模型接口访问权限不足（403）'],
  ['DETAIL_PAGE_FACTS_HTTP_404', '商品事实提取：模型或接口地址不存在（404）'],
  ['DETAIL_PAGE_VISUAL_HTTP_408', '整套视觉规范：模型请求超时（408）'],
  ['DETAIL_PAGE_SCREENS_HTTP_409', '逐屏策划：模型请求状态冲突（409）'],
  ['DETAIL_PAGE_FACTS_HTTP_422', '商品事实提取：请求参数不被模型服务接受（422）'],
  ['DETAIL_PAGE_VISUAL_HTTP_429', '整套视觉规范：模型服务限流，请求过于频繁（429）'],
  ['DETAIL_PAGE_SCREENS_HTTP_500', '逐屏策划：模型服务内部错误（500）'],
  ['DETAIL_PAGE_FACTS_HTTP_502', '商品事实提取：模型网关响应异常（502）'],
  ['DETAIL_PAGE_SCREENS_HTTP_503', '逐屏策划：模型服务繁忙（503）'],
  ['DETAIL_PAGE_VISUAL_HTTP_504', '整套视觉规范：模型网关响应超时（504）'],
  ['DETAIL_PAGE_SCREENS_HTTP_OTHER', '逐屏策划：模型接口返回不支持的状态'],
])('maps known code %s to a safe Chinese failure without resubmission', async (code, expected) => {
  call.mockResolvedValue({
    id: acceptedRemote.id,
    status: 'failed',
    error: `Traceback: private-brief-and-secret\nValueError: ${code}\nprivate-response-body`,
  });
  const result = await provider.poll!(acceptedRemote, 'contract-key');
  expect(result).toMatchObject({ state: 'failed', message: expect.stringContaining(expected) });
  expect(JSON.stringify(result)).not.toMatch(/private|Traceback|ValueError|DETAIL_PAGE_/);
  expect(fetchCall).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledOnce();
});

it('uses the same safe failure mapping for the terminal stream event', async () => {
  fetchCall.mockResolvedValue(
    new Response(
      [
        {
          event: 'workflow_started',
          workflow_run_id: acceptedRemote.id,
          data: { id: acceptedRemote.id },
        },
        {
          event: 'workflow_finished',
          workflow_run_id: acceptedRemote.id,
          data: {
            id: acceptedRemote.id,
            status: 'failed',
            error: 'ValueError: DETAIL_PAGE_JSON_INVALID private-response-body',
          },
        },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
      {
        headers: { 'Content-Type': 'text/event-stream' },
      },
    ),
  );
  const result = await provider.execute(context(), 'contract-key');
  expect(result).toMatchObject({
    state: 'failed',
    message: expect.stringContaining('完整、有效的结构化方案'),
  });
  expect(JSON.stringify(result)).not.toContain('private-response-body');
  expect(fetchCall).toHaveBeenCalledOnce();
  expect(call).not.toHaveBeenCalled();
});

it('reports the observed third-stage 503 failure from the stream without leaking the overload body or retrying', async () => {
  fetchCall.mockResolvedValue(
    new Response(
      [
        started,
        {
          event: 'workflow_finished',
          workflow_run_id: acceptedRemote.id,
          data: {
            id: acceptedRemote.id,
            status: 'failed',
            error:
              'ValueError: DETAIL_PAGE_SCREENS_HTTP_503 private-secret-body system_cpu_overload current:99.7%,threshold:90%',
          },
        },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
      { headers: { 'Content-Type': 'text/event-stream' } },
    ),
  );
  const result = await provider.execute(context(), 'contract-key');
  expect(result).toMatchObject({
    state: 'failed',
    message: expect.stringContaining('逐屏策划：模型服务繁忙（503）'),
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private|system_cpu|99\.7|90%|ValueError|DETAIL_PAGE_/,
  );
  expect(fetchCall).toHaveBeenCalledOnce();
  expect(call).not.toHaveBeenCalled();
});

it.each([
  undefined,
  {},
  'DETAIL_PAGE_UNKNOWN_NEW_ERROR private-body',
  'DETAIL_PAGE_UNKNOWN_HTTP_503 private-body',
  'DETAIL_PAGE_SCREENS_HTTP_599 private-body',
  'DETAIL_PAGE_SCREENS_HTTP_503_PRIVATE private-body',
])('does not expose unknown workflow errors %s', async (error) => {
  call.mockResolvedValue({ id: acceptedRemote.id, status: 'failed', error });
  expect(await provider.poll!(acceptedRemote, 'contract-key')).toMatchObject({
    state: 'failed',
    message: expect.stringContaining('暂未取得完整方案'),
  });
  expect(JSON.stringify(await provider.poll!(acceptedRemote, 'contract-key'))).not.toMatch(
    /private|DETAIL_PAGE_/,
  );
  expect(fetchCall).not.toHaveBeenCalled();
});

it.each(['running', 'pending'])(
  'keeps the same %s run active without resubmission',
  async (status) => {
    call.mockResolvedValue({ id: acceptedRemote.id, status });
    expect(await provider.poll!(acceptedRemote, 'contract-key')).toMatchObject({
      state: 'running',
    });
    expect(fetchCall).not.toHaveBeenCalled();
  },
);

it('rejects a mismatched run id and never uses provider-supplied recovery URLs', async () => {
  call.mockResolvedValue({
    id: 'different-run',
    status: 'succeeded',
    outputs: { plan_json: JSON.stringify(plan()) },
  });
  await expect(
    provider.poll!(
      { ...acceptedRemote, statusUrl: 'https://untrusted.example/steal-key' },
      'contract-key',
    ),
  ).rejects.toMatchObject({ ambiguous: true, code: 'DIFY_RESULT_UNCERTAIN' });
  expect(call.mock.calls[0]?.[0]).toBe('https://api.dify.ai/v1/workflows/run/detail-contract-run');
});

it('rejects a corrupted stored run id before sending a credential', async () => {
  await expect(
    provider.poll!({ ...acceptedRemote, id: '../../anything' }, 'contract-key'),
  ).rejects.toMatchObject({ code: 'DIFY_RECOVERY_INVALID' });
  expect(call).not.toHaveBeenCalled();
  expect(fetchCall).not.toHaveBeenCalled();
});

it('marks EOF before an accepted id as ambiguous and never resubmits', async () => {
  fetchCall.mockResolvedValue(
    new Response(': ping\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
  );
  await expect(provider.execute(context(), 'contract-key')).rejects.toMatchObject({
    ambiguous: true,
  });
  expect(fetchCall).toHaveBeenCalledTimes(1);
});

it.each([
  [401, false],
  [429, false],
  [503, true],
] as const)('handles HTTP %i without treating its body as a plan', async (status, ambiguous) => {
  fetchCall.mockResolvedValue(new Response('private-error-body', { status }));
  await expect(provider.execute(context(), 'contract-key')).rejects.toMatchObject({
    ambiguous,
    code: `PROVIDER_HTTP_${status}`,
  });
  expect(fetchCall).toHaveBeenCalledTimes(1);
});

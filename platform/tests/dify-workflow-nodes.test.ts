import { expect, it } from 'vitest';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { detailPagePlanResultSchema } from '../src/contracts/detail-page';
import { parseDifyDetailPageJson } from '../src/server/providers/dify';
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint'))('js-yaml') as {
  load: (source: string) => unknown;
};
const file = 'workflows/dify/detail-page-v1/detail-page-v1';
const nodeSchema = z.object({
  id: z.string(),
  data: z
    .object({ type: z.string(), title: z.string(), code: z.string().optional() })
    .passthrough(),
});
const definition = z
  .object({
    version: z.literal('0.7.0'),
    workflow: z.object({
      environment_variables: z.array(z.object({ value_type: z.string(), value: z.unknown() })),
      graph: z.object({
        nodes: z.array(nodeSchema),
        edges: z.array(
          z.object({ source: z.string(), target: z.string(), sourceHandle: z.string() }),
        ),
      }),
    }),
  })
  .parse(yaml.load(readFileSync(`${file}.yaml`, 'utf8')));
const ids = {
  normalize: '1793350001000',
  facts: '1793350003000',
  visual: '1793350005000',
  screens: '1793350007000',
  validate: '1793350009000',
  legacy: '1793263188866',
};
const brief = '白色陶瓷杯，容量300毫升。';
const facts = {
  productName: '白色陶瓷杯',
  productFacts: ['白色陶瓷杯', '容量300毫升'],
  unknowns: ['品牌未知'],
};
const visual = {
  audience: '建议面向日常饮水人群',
  visualStyle: '自然商品摄影',
  palette: ['米白', '浅木色'],
  consistencyNotes: '统一光线与标题位置，商品外观以确认参考图为准',
  unknowns: [],
};
const screens = () => ({
  screens: Array.from({ length: 6 }, (_, i) => ({
    id: `screen_${i + 1}`,
    title: ['纯白外观', '日常饮水', '陶瓷质感', '桌面氛围', '容量说明', '简洁收束'][i],
    purpose: '顺序展示已知商品事实',
    copy: ['白色陶瓷杯', '容量300毫升'],
    prompt: '米白背景，柔和自然光，保留商品外观与标题留白。',
    ratio: '3:4',
  })),
});
function response(content: unknown, finish_reason = 'stop') {
  return JSON.stringify({
    choices: [
      {
        message: { content: typeof content === 'string' ? content : JSON.stringify(content) },
        finish_reason,
      },
    ],
  });
}
function run(
  key: keyof typeof ids,
  args: Record<string, unknown>,
  entryPoint: 'main' | 'response' = 'main',
) {
  const code = definition.workflow.graph.nodes.find((n) => n.id === ids[key])?.data.code;
  if (!code) throw new Error('Missing code node');
  const script =
    'import sys,json\np=json.load(sys.stdin)\nscope={}\nexec(compile(p["code"],"dify-node","exec"),scope)\ntry:\n print(json.dumps({"ok":True,"result":scope[p["entryPoint"]](**p["args"])}))\nexcept Exception as error:\n print(json.dumps({"ok":False,"error":str(error)}))\n';
  // Large synchronous stdin pipes can stall before Python reads the complete payload.
  // A file descriptor preserves the exact stdin contract without relaxing execution bounds.
  const folder = mkdtempSync(join(tmpdir(), 'yingzao-dify-node-'));
  let input: number | undefined;
  try {
    const payload = join(folder, 'input.json');
    writeFileSync(payload, JSON.stringify({ code, args, entryPoint }), { mode: 0o600 });
    input = openSync(payload, 'r');
    return JSON.parse(
      execFileSync('python3', ['-c', script], {
        stdio: [input, 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 10000,
      }),
    ) as { ok: boolean; result: Record<string, string | number>; error?: string };
  } finally {
    if (input !== undefined) closeSync(input);
    rmSync(folder, { recursive: true, force: true });
  }
}
const finalArgs = () => ({
  body: response(screens()),
  status_code: 200,
  facts_json: JSON.stringify(facts),
  visual_json: JSON.stringify(visual),
  brief,
  screen_count: 6,
  ratio: '3:4',
});

const httpFailureStages = [
  {
    stage: 'FACTS',
    key: 'visual' as const,
    args: { brief, screen_count: 6, ratio: '3:4', model: 'kimi-k3' },
  },
  {
    stage: 'VISUAL',
    key: 'screens' as const,
    args: {
      brief,
      screen_count: 6,
      ratio: '3:4',
      model: 'kimi-k3',
      facts_json: JSON.stringify(facts),
    },
  },
  { stage: 'SCREENS', key: 'validate' as const, args: finalArgs() },
];

it.each(httpFailureStages)(
  'reports only the fixed $stage stage and allowlisted HTTP status without parsing or exposing the body',
  ({ stage, key, args }) => {
    const privateBody = 'private-sentinel-body; system_cpu_overload; current 99.7%; key=hidden';
    for (const status of [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504]) {
      const result = run(key, { ...args, body: privateBody, status_code: status });
      expect(result).toEqual({ ok: false, error: `DETAIL_PAGE_${stage}_HTTP_${status}` });
    }
    for (const status of [201, 301, 418, 599, 503.5, '503', false, null]) {
      const result = run(key, { ...args, body: privateBody, status_code: status });
      expect(result).toEqual({ ok: false, error: `DETAIL_PAGE_${stage}_HTTP_OTHER` });
    }
  },
);

it('retains the old generic HTTP failure code when no recognized fixed stage is supplied', () => {
  for (const stage of [undefined, 'DETAIL_PAGE_SCREENS_HTTP_503', 'arbitrary-stage']) {
    expect(
      run(
        'validate',
        { body: 'private-response-sentinel', status_code: 503, ...(stage ? { stage } : {}) },
        'response',
      ),
    ).toEqual({ ok: false, error: 'DETAIL_PAGE_RESPONSE_STATUS_INVALID' });
  }
});

it('merges mutually exclusive validated branches into one uniquely named workflow output', () => {
  const { nodes, edges } = definition.workflow.graph;
  const ends = nodes.filter((node) => node.data.type === 'end');
  const aggregates = nodes.filter((node) => node.data.type === 'variable-aggregator');
  expect(ends).toHaveLength(1);
  expect(aggregates).toHaveLength(1);
  const aggregate = aggregates[0]!;
  expect(aggregate.data).toMatchObject({
    output_type: 'string',
    variables: [
      ['1793263440766', 'result'],
      ['1793350009000', 'result'],
      ['1793710003000', 'result'],
    ],
    advanced_settings: { group_enabled: false, groups: [] },
  });
  expect(
    edges
      .filter((edge) => edge.target === aggregate.id)
      .map((edge) => edge.source)
      .sort(),
  ).toEqual(['1793263440766', '1793350009000', '1793710003000']);
  expect(ends[0]!.data.outputs).toEqual([
    { variable: 'plan_json', value_selector: [aggregate.id, 'output'], value_type: 'string' },
  ]);
  expect(edges.filter((edge) => edge.target === ends[0]!.id)).toEqual([
    expect.objectContaining({ source: aggregate.id, target: ends[0]!.id }),
  ]);
});

it('compiles every embedded code node and validates package hashes and all graph edges offline', async () => {
  for (const node of definition.workflow.graph.nodes.filter((n) => n.data.type === 'code')) {
    expect(() =>
      execFileSync('python3', ['-c', 'import sys;compile(sys.stdin.read(),"node","exec")'], {
        input: node.data.code!,
        timeout: 10000,
      }),
    ).not.toThrow();
  }
  const nodeIds = new Set(definition.workflow.graph.nodes.map((n) => n.id));
  for (const edge of definition.workflow.graph.edges) {
    expect(nodeIds.has(edge.source)).toBe(true);
    expect(nodeIds.has(edge.target)).toBe(true);
  }
  expect(
    definition.workflow.graph.edges
      .filter((e) => e.source === '1793350002000')
      .map((e) => e.sourceHandle)
      .sort(),
  ).toEqual(['false', 'intent', 'true']);
  for (const env of definition.workflow.environment_variables.filter(
    (e) => e.value_type === 'secret',
  ))
    expect(env.value).toBe('');
  for (const node of definition.workflow.graph.nodes.filter(
    (n) => n.data.type === 'http-request',
  )) {
    expect(node.data.retry_config).toMatchObject({ retry_enabled: false, max_retries: 0 });
    expect(node.data.ssl_verify).toBe(true);
    expect(node.data.url).toBe('{{#env.PLANNER_BASE_URL#}}/chat/completions');
  }
  const archive = await JSZip.loadAsync(readFileSync(`${file}.ifpkg`));
  const source = await archive.file('app.yaml')!.async('nodebuffer');
  const manifest = z
    .object({
      format: z.literal('dify.app'),
      format_version: z.literal(1),
      apps: z.array(z.object({ path: z.string(), size: z.number(), sha256: z.string() })).length(1),
    })
    .parse(yaml.load(await archive.file('manifest.yaml')!.async('string')));
  expect(source.toString()).toBe(readFileSync(`${file}.yaml`, 'utf8'));
  expect(manifest.apps[0]).toEqual({
    path: 'app.yaml',
    size: source.length,
    sha256: createHash('sha256').update(source).digest('hex'),
  });
});

it('preserves brief-only old mode and defaults new detail planning to six screens', () => {
  expect(run('normalize', { brief }).result).toMatchObject({
    planning_mode: 'ideas',
    screen_count: 6,
    ratio: '3:4',
  });
  expect(
    run('normalize', { brief, planning_mode: 'detail-page', screen_count: null, ratio: null })
      .result,
  ).toMatchObject({ planning_mode: 'detail-page', screen_count: 6, ratio: '3:4' });
  const old = run('legacy', { brief, model: 'kimi-k3' });
  expect(old.ok).toBe(true);
  expect(JSON.parse(String(old.result.result))).toMatchObject({
    model: 'kimi-k3',
    stream: false,
    max_tokens: 2048,
  });
});

it.each([1, 11, true, 2.5])(
  'rejects an invalid screen count %s before model submission',
  (screen_count) => {
    expect(
      run('normalize', { brief, planning_mode: 'detail-page', screen_count, ratio: '3:4' }).ok,
    ).toBe(false);
  },
);

it('constructs three isolated system/user messages and assembles the exact shared contract', () => {
  const first = run('facts', { brief, model: 'kimi-k3' });
  expect(first.ok).toBe(true);
  const second = run('visual', {
    body: response(facts),
    status_code: 200,
    brief,
    screen_count: 6,
    ratio: '3:4',
    model: 'kimi-k3',
  });
  expect(second.ok).toBe(true);
  const third = run('screens', {
    body: response(visual),
    status_code: 200,
    facts_json: second.result.facts_json,
    brief,
    screen_count: 6,
    ratio: '3:4',
    model: 'kimi-k3',
  });
  expect(third.ok).toBe(true);
  for (const value of [first, second, third]) {
    const request = JSON.parse(String(value.result.result));
    expect(request.messages.map((message: { role: string }) => message.role)).toEqual([
      'system',
      'user',
    ]);
    expect(request).toMatchObject({ model: 'kimi-k3', stream: false });
  }
  expect(JSON.parse(String(third.result.result)).max_tokens).toBe(8192);
  const finished = run('validate', {
    ...finalArgs(),
    facts_json: second.result.facts_json,
    visual_json: third.result.visual_json,
  });
  expect(finished.ok).toBe(true);
  expect(
    detailPagePlanResultSchema.parse(JSON.parse(String(finished.result.result))).plan.screens,
  ).toHaveLength(6);
});

it('preserves original visual requirements after fact extraction without promoting them into product facts', () => {
  const originalBrief = `${brief}自然光、浅米色背景，留出标题空间，不要水滴和黑色背景。`;
  const second = run('visual', {
    body: response(facts),
    status_code: 200,
    brief: originalBrief,
    screen_count: 6,
    ratio: '3:4',
    model: 'kimi-k3',
  });
  const third = run('screens', {
    body: response(visual),
    status_code: 200,
    facts_json: second.result.facts_json,
    brief: originalBrief,
    screen_count: 6,
    ratio: '3:4',
    model: 'kimi-k3',
  });
  for (const value of [second, third]) {
    expect(value.ok).toBe(true);
    const request = JSON.parse(String(value.result.result));
    const data = JSON.parse(request.messages[1].content);
    expect(data.brief).toBe(originalBrief);
    expect(data.facts.productFacts).toEqual(facts.productFacts);
    expect(request.messages[0].content).toContain('brief');
    expect(request.messages[0].content).toContain('瓶口、泵头、瓶盖、把手、标签、轮廓和比例');
  }
});

it.each([2, 6, 10])(
  'accepts a complete %i-screen maximum-length node output in the actual backend parser',
  (count) => {
    const result = run('validate', {
      ...finalArgs(),
      screen_count: count,
      body: response({
        screens: Array.from({ length: count }, (_, index) => ({
          id: `screen_${index + 1}`,
          title: '景'.repeat(80),
          purpose: '叙'.repeat(300),
          copy: Array.from({ length: 4 }, () => '字'.repeat(150)),
          prompt: '画'.repeat(1000),
          ratio: '3:4',
        })),
      }),
    });
    expect(result.ok).toBe(true);
    const accepted = parseDifyDetailPageJson(result.result.result, {
      screenCount: count,
      ratio: '3:4',
    });
    expect(accepted.plan.screens).toHaveLength(count);
  },
);

it.each([
  ['purpose', '叙'.repeat(301)],
  ['copy', Array.from({ length: 5 }, () => '文案')],
  ['copy', ['字'.repeat(151)]],
  ['prompt', '画'.repeat(1001)],
  ['title', '🌿'.repeat(41)],
  ['purpose', '🌿'.repeat(151)],
  ['copy', ['🌿'.repeat(76)]],
  ['prompt', '🌿'.repeat(501)],
] as const)(
  'rejects a %s field beyond the receiving backend limit before declaring workflow success',
  (field, value) => {
    const content = screens();
    Object.assign(content.screens[0]!, { [field]: value });
    const result = run('validate', { ...finalArgs(), body: response(content) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^DETAIL_PAGE_(TEXT|LIST)_INVALID$/);
  },
);

it('normalizes screen ids and JavaScript whitespace while retaining valid Unicode boundaries', () => {
  const content = screens();
  Object.assign(content.screens[0]!, {
    id: ' screen_1 ',
    title: '\ufeff商品标题\ufeff',
    purpose: '🌿'.repeat(150),
    copy: ['🌿'.repeat(75)],
    prompt: '🌿'.repeat(500),
  });
  const result = run('validate', { ...finalArgs(), body: response(content) });
  expect(result.ok).toBe(true);
  const accepted = parseDifyDetailPageJson(result.result.result, { screenCount: 6, ratio: '3:4' });
  expect(accepted.plan.screens[0]).toMatchObject({ id: 'screen_1', title: '商品标题' });
  content.screens[0]!.purpose = '\ufeff';
  expect(run('validate', { ...finalArgs(), body: response(content) })).toMatchObject({
    ok: false,
    error: 'DETAIL_PAGE_TEXT_INVALID',
  });
});

it('keeps operator unknowns and execution notes out of the requested finished-image content', () => {
  const operatorFacts = {
    ...facts,
    unknowns: ['品牌待确认', '容量待确认', '价格售后待补充'],
  };
  const requests = [
    run('facts', { brief, model: 'kimi-k3' }),
    run('visual', {
      body: response(operatorFacts),
      status_code: 200,
      brief,
      screen_count: 6,
      ratio: '3:4',
      model: 'kimi-k3',
    }),
    run('screens', {
      body: response(visual),
      status_code: 200,
      facts_json: JSON.stringify(operatorFacts),
      brief,
      screen_count: 6,
      ratio: '3:4',
      model: 'kimi-k3',
    }),
  ].map((value) => {
    expect(value.ok).toBe(true);
    return JSON.parse(String(value.result.result)) as {
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
  });
  // This verifies the actual embedded node requests, not only detached prompt source files.
  for (const request of requests) {
    const system = request.messages[0]!.content;
    expect(system).toContain('unknowns 只供操作者确认，绝不能作为成品画面文字、画面占位或卖点');
    expect(system).toContain('不硬凑功效或信息屏');
  }
  expect(requests.map((request) => request.max_tokens)).toEqual([2048, 2048, 8192]);
  for (const request of requests.slice(1))
    expect(request.messages[0]!.content).toContain('不得把后端、本地任务、编排平台、API、上传流程');
  const finalPrompt = requests[2]!.messages[0]!.content;
  expect(finalPrompt).toContain('title、purpose、copy、prompt 均不得含');
  expect(finalPrompt).toContain('copy 可为空数组，设计纯商品画面');
  expect(finalPrompt).not.toContain('已知规格—收束提醒');
  expect(finalPrompt).not.toContain('明确后续以用户确认的商品参考图为准');
  expect(requests[1]!.messages[0]!.content).not.toContain('后续本地图像任务会负责');
  expect(JSON.parse(requests[2]!.messages[1]!.content).facts.unknowns).toEqual(
    operatorFacts.unknowns,
  );
});

it.each(['title', 'copy', 'prompt'] as const)(
  'rejects internal placeholders in finished screen %s while preserving operator unknowns',
  (field) => {
    const content = screens();
    Object.assign(content.screens[0]!, {
      [field]: field === 'copy' ? ['品牌待确认'] : '品牌待确认',
    });
    expect(run('validate', { ...finalArgs(), body: response(content) })).toMatchObject({
      ok: false,
      error: 'DETAIL_PAGE_INTERNAL_PLACEHOLDER',
    });
  },
);

it.each(['visualStyle', 'consistencyNotes'] as const)(
  'stops internal placeholders in %s before the third model request',
  (field) => {
    expect(
      run('screens', {
        body: response({ ...visual, [field]: '参数待填' }),
        status_code: 200,
        facts_json: JSON.stringify(facts),
        brief,
        screen_count: 6,
        ratio: '3:4',
        model: 'kimi-k3',
      }),
    ).toMatchObject({ ok: false, error: 'DETAIL_PAGE_INTERNAL_PLACEHOLDER' });
  },
);

it.each([
  '品牌待确认',
  '容量待确认',
  '价格待补充',
  '售后待补充',
  '价格售后待补充',
  '价格/售后待补充',
  '参数待填',
  '参考图待确认',
  '待确认商品',
])('rejects exact internal marker %s only in designated finished content', (marker) => {
  const content = screens();
  content.screens[0]!.prompt = marker;
  expect(run('validate', { ...finalArgs(), body: response(content) })).toMatchObject({
    ok: false,
    error: 'DETAIL_PAGE_INTERNAL_PLACEHOLDER',
  });
  const allowed = run('validate', {
    ...finalArgs(),
    facts_json: JSON.stringify({ ...facts, unknowns: [marker] }),
  });
  expect(allowed.ok).toBe(true);
  expect(JSON.parse(String(allowed.result.result)).plan.unknowns).toEqual([marker]);
});

it('rejects invented product facts before the visual model can be called', () => {
  const result = run('visual', {
    body: response({ ...facts, productFacts: ['抗菌率99.9%'] }),
    status_code: 200,
    brief,
    screen_count: 6,
    ratio: '3:4',
    model: 'kimi-k3',
  });
  expect(result).toMatchObject({ ok: false, error: 'DETAIL_PAGE_FACT_NOT_IN_BRIEF' });
  expect(JSON.stringify(result)).not.toContain('99.9');
});

it.each([7, 12])(
  'preserves all unknowns when both valid planning stages return %i distinct entries',
  (count) => {
    const factUnknowns = Array.from({ length: count }, (_, i) => `商品待确认事项${i}`);
    const visualUnknowns = Array.from({ length: count }, (_, i) => `视觉待确认事项${i}`);
    const result = run('validate', {
      ...finalArgs(),
      facts_json: JSON.stringify({ ...facts, unknowns: factUnknowns }),
      visual_json: JSON.stringify({ ...visual, unknowns: visualUnknowns }),
    });
    expect(result.ok).toBe(true);
    const parsed = detailPagePlanResultSchema.parse(JSON.parse(String(result.result.result)));
    expect(parsed.plan.unknowns).toEqual([...factUnknowns, ...visualUnknowns]);
  },
);

it('deduplicates exact unknowns in first-seen order without merging different wording', () => {
  const result = run('validate', {
    ...finalArgs(),
    facts_json: JSON.stringify({ ...facts, unknowns: ['品牌未提供', '包装尺寸未知'] }),
    visual_json: JSON.stringify({
      ...visual,
      unknowns: ['包装尺寸未知', '品牌尚待确认', '背景场景待确认', '品牌未提供'],
    }),
  });
  expect(result.ok).toBe(true);
  expect(JSON.parse(String(result.result.result)).plan.unknowns).toEqual([
    '品牌未提供',
    '包装尺寸未知',
    '品牌尚待确认',
    '背景场景待确认',
  ]);
});

it.each(['facts_json', 'visual_json'])(
  'still rejects an over-limit individual stage %s instead of truncating it',
  (stage) => {
    const args = finalArgs();
    const value = JSON.parse(args[stage as 'facts_json' | 'visual_json']);
    value.unknowns = Array.from({ length: 13 }, (_, i) => `待确认事项${i}`);
    expect(run('validate', { ...args, [stage]: JSON.stringify(value) })).toMatchObject({
      ok: false,
      error: 'DETAIL_PAGE_LIST_INVALID',
    });
  },
);

it.each([
  [
    'missing screen',
    (value: ReturnType<typeof screens>) => {
      value.screens.pop();
    },
  ],
  [
    'duplicate id',
    (value: ReturnType<typeof screens>) => {
      value.screens[1]!.id = value.screens[0]!.id;
    },
  ],
  [
    'wrong ratio',
    (value: ReturnType<typeof screens>) => {
      value.screens[0]!.ratio = '9:16';
    },
  ],
  [
    'invented asset',
    (value: ReturnType<typeof screens>) => {
      Object.assign(value.screens[0]!, { assetId: 'untrusted-id' });
    },
  ],
  [
    'unsupported number',
    (value: ReturnType<typeof screens>) => {
      value.screens[0]!.copy = ['容量500毫升'];
    },
  ],
  [
    'unsupported claim',
    (value: ReturnType<typeof screens>) => {
      value.screens[0]!.copy = ['食品级认证'];
    },
  ],
])('rejects %s without sanitizing it into a fake successful plan', (_name, mutate) => {
  const value = screens();
  mutate(value);
  expect(run('validate', { ...finalArgs(), body: response(value) }).ok).toBe(false);
});

it.each([
  { status_code: 429 },
  { body: 'private-invalid-body' },
  { body: response(screens(), 'length') },
  { body: response('{"screens":[],"screens":[]}') },
  { body: response('```json\n{}\n``` extra') },
])('rejects an unsuccessful or incomplete response with fixed errors', (override) => {
  const value = run('validate', { ...finalArgs(), ...override });
  expect(value.ok).toBe(false);
  expect(value.error).toMatch(/^DETAIL_PAGE_/);
  expect(JSON.stringify(value)).not.toContain('private-invalid-body');
});

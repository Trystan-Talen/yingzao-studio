// Build portable YAML and, optionally, a same-app private overlay without reading secret values.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint'))('js-yaml');
const root = dirname(fileURLToPath(import.meta.url));
const common = await readFile(join(root, 'nodes/common.py'), 'utf8');
const intentCommon = await readFile(join(root, 'nodes/intent_common.py'), 'utf8');
const ids = {
  start: '1793261377434',
  normalize: '1793350001000',
  branch: '1793350002000',
  legacyRequest: '1793263188866',
  legacyHttp: '1793263371516',
  legacyParser: '1793263440766',
  end: '1793261923165',
  factsRequest: '1793350003000',
  factsHttp: '1793350004000',
  visualRequest: '1793350005000',
  visualHttp: '1793350006000',
  screensRequest: '1793350007000',
  screensHttp: '1793350008000',
  validate: '1793350009000',
  aggregate: '1793350010000',
  intentRequest: '1793710001000',
  intentHttp: '1793710002000',
  intentParser: '1793710003000',
};
const nodes = [];
const edges = [];
function node(key, type, title, x, y, data) {
  const n = {
    id: ids[key],
    type: 'custom',
    position: { x, y },
    positionAbsolute: { x, y },
    width: 242,
    height: type === 'code' ? 82 : 98,
    sourcePosition: 'right',
    targetPosition: 'left',
    selected: false,
    data: { type, title, desc: '', selected: false, ...data },
  };
  nodes.push(n);
  return n;
}
function edge(from, to, handle = 'source') {
  edges.push({
    id: `${ids[from]}-${handle}-${ids[to]}-target`,
    type: 'custom',
    source: ids[from],
    sourceHandle: handle,
    target: ids[to],
    targetHandle: 'target',
    zIndex: 0,
    data: {
      isInIteration: false,
      isInLoop: false,
      sourceType: nodes.find((n) => n.id === ids[from]).data.type,
      targetType: nodes.find((n) => n.id === ids[to]).data.type,
    },
  });
}
const variable = (variable, key, field, type = 'string') => ({
  variable,
  value_selector: [key === 'env' ? 'env' : ids[key], field],
  value_type: type,
});
async function code(key, title, file, x, y, variables, outputs, prompt) {
  const shared = file.startsWith('legacy')
    ? ''
    : file.startsWith('intent')
      ? intentCommon + '\n'
      : common + '\n' + (file === 'normalize' ? intentCommon + '\n' : '');
  const source = `${shared}${prompt ? `SYSTEM_PROMPT = ${JSON.stringify(await readFile(join(root, `prompts/${prompt}.txt`), 'utf8'))}\n\n` : ''}${await readFile(join(root, `nodes/${file}.py`), 'utf8')}`;
  return node(key, 'code', title, x, y, {
    code_language: 'python3',
    code: source,
    variables,
    outputs: Object.fromEntries(
      Object.entries(outputs).map(([name, type]) => [name, { type, children: null }]),
    ),
  });
}
function http(key, title, previous, x, y) {
  return node(key, 'http-request', title, x, y, {
    method: 'post',
    url: '{{#env.PLANNER_BASE_URL#}}/chat/completions',
    headers: 'Authorization: Bearer {{#env.PLANNER_API_KEY#}}\nContent-Type: application/json',
    params: '',
    authorization: { type: 'no-auth', config: null },
    body: { type: 'raw-text', data: [{ type: 'text', value: `{{#${ids[previous]}.result#}}` }] },
    timeout: {
      connect: 10,
      read: 120,
      write: 10,
      max_connect_timeout: 0,
      max_read_timeout: 0,
      max_write_timeout: 0,
    },
    retry_config: { retry_enabled: false, max_retries: 0, retry_interval: 100 },
    ssl_verify: true,
    variables: [],
  });
}
const startVariable = (variable, label, type, required, defaultValue, extra = {}) => ({
  variable,
  label,
  type,
  required,
  default: defaultValue,
  hint: '',
  placeholder: '',
  options: [],
  ...extra,
});
node('start', 'start', '用户输入', 0, 260, {
  variables: [
    startVariable('brief', '用户原话、目标与约束', 'paragraph', true, '', { max_length: 12000 }),
    startVariable('planning_mode', '策划模式（留空为旧创作策划）', 'select', false, 'ideas', {
      options: ['ideas', 'detail-page', 'intent'],
    }),
    startVariable(
      'intent_request_json',
      '意图理解结构化请求（仅意图模式）',
      'paragraph',
      false,
      '',
      {
        max_length: 120000,
      },
    ),
    startVariable('screen_count', '详情页屏数（2–10，默认6）', 'number', false, 6),
    startVariable('ratio', '详情页比例', 'select', false, '3:4', {
      options: ['3:4', '2:3', '9:16'],
    }),
  ],
});
await code(
  'normalize',
  '输入校验与兼容路由',
  'normalize',
  340,
  260,
  [
    variable('brief', 'start', 'brief'),
    variable('planning_mode', 'start', 'planning_mode'),
    variable('screen_count', 'start', 'screen_count', 'number'),
    variable('ratio', 'start', 'ratio'),
    variable('intent_request_json', 'start', 'intent_request_json'),
  ],
  {
    brief: 'string',
    planning_mode: 'string',
    screen_count: 'number',
    ratio: 'string',
    intent_request_json: 'string',
  },
);
node('branch', 'if-else', '意图理解、详情页或原策划', 680, 260, {
  cases: [
    {
      case_id: 'intent',
      logical_operator: 'and',
      conditions: [
        {
          id: 'intent-mode',
          variable_selector: [ids.normalize, 'planning_mode'],
          comparison_operator: 'is',
          value: 'intent',
        },
      ],
    },
    {
      case_id: 'true',
      logical_operator: 'and',
      conditions: [
        {
          id: 'detail-mode',
          variable_selector: [ids.normalize, 'planning_mode'],
          comparison_operator: 'is',
          value: 'detail-page',
        },
      ],
    },
  ],
});
await code(
  'intentRequest',
  '需求理解请求构建',
  'intent_request',
  1020,
  -300,
  [
    variable('intent_request_json', 'normalize', 'intent_request_json'),
    variable('model', 'env', 'PLANNER_MODEL'),
  ],
  { result: 'string' },
  'intent',
);
http('intentHttp', 'Kimi 需求理解与最少追问', 'intentRequest', 1360, -300);
await code(
  'intentParser',
  '需求状态、事实来源与能力校验',
  'intent_parser',
  1700,
  -300,
  [
    variable('body', 'intentHttp', 'body'),
    variable('status_code', 'intentHttp', 'status_code', 'number'),
    variable('intent_request_json', 'normalize', 'intent_request_json'),
  ],
  { result: 'string' },
);
await code(
  'legacyRequest',
  '原策划请求构建',
  'legacy_request',
  1020,
  0,
  [variable('brief', 'normalize', 'brief'), variable('model', 'env', 'PLANNER_MODEL')],
  { result: 'string' },
);
http('legacyHttp', 'Kimi 原创作策划', 'legacyRequest', 1360, 0);
await code(
  'legacyParser',
  '原策划结构校验',
  'legacy_parser',
  1700,
  0,
  [
    variable('body', 'legacyHttp', 'body'),
    variable('status_code', 'legacyHttp', 'status_code', 'number'),
  ],
  { result: 'string' },
);
await code(
  'factsRequest',
  '事实与未知提取请求',
  'facts_request',
  1020,
  500,
  [variable('brief', 'normalize', 'brief'), variable('model', 'env', 'PLANNER_MODEL')],
  { result: 'string' },
  'facts',
);
http('factsHttp', 'Kimi 商品事实提取', 'factsRequest', 1360, 500);
const scoped = [
  variable('brief', 'normalize', 'brief'),
  variable('screen_count', 'normalize', 'screen_count', 'number'),
  variable('ratio', 'normalize', 'ratio'),
];
await code(
  'visualRequest',
  '事实溯源校验与视觉请求',
  'visual_request',
  1700,
  500,
  [
    variable('body', 'factsHttp', 'body'),
    variable('status_code', 'factsHttp', 'status_code', 'number'),
    ...scoped,
    variable('model', 'env', 'PLANNER_MODEL'),
  ],
  { facts_json: 'string', result: 'string' },
  'visual',
);
http('visualHttp', 'Kimi 全套视觉规范', 'visualRequest', 2040, 500);
await code(
  'screensRequest',
  '视觉校验与逐屏请求',
  'screens_request',
  2380,
  500,
  [
    variable('body', 'visualHttp', 'body'),
    variable('status_code', 'visualHttp', 'status_code', 'number'),
    variable('facts_json', 'visualRequest', 'facts_json'),
    ...scoped,
    variable('model', 'env', 'PLANNER_MODEL'),
  ],
  { visual_json: 'string', result: 'string' },
  'screens',
);
http('screensHttp', 'Kimi 完整逐屏策划', 'screensRequest', 2720, 500);
await code(
  'validate',
  '逐屏结构与声明安全校验',
  'validate_plan',
  3060,
  500,
  [
    variable('body', 'screensHttp', 'body'),
    variable('status_code', 'screensHttp', 'status_code', 'number'),
    variable('facts_json', 'visualRequest', 'facts_json'),
    variable('visual_json', 'screensRequest', 'visual_json'),
    ...scoped,
  ],
  { result: 'string' },
);
node('aggregate', 'variable-aggregator', '合并已校验的策划结果', 3400, 260, {
  output_type: 'string',
  variables: [
    [ids.legacyParser, 'result'],
    [ids.validate, 'result'],
    [ids.intentParser, 'result'],
  ],
  advanced_settings: { group_enabled: false, groups: [] },
});
node('end', 'end', '待确认创作计划', 3740, 260, {
  outputs: [
    { variable: 'plan_json', value_selector: [ids.aggregate, 'output'], value_type: 'string' },
  ],
});
edge('start', 'normalize');
edge('normalize', 'branch');
edge('branch', 'legacyRequest', 'false');
edge('branch', 'factsRequest', 'true');
edge('branch', 'intentRequest', 'intent');
for (const branch of [
  ['intentRequest', 'intentHttp', 'intentParser', 'aggregate'],
  ['legacyRequest', 'legacyHttp', 'legacyParser', 'aggregate'],
  [
    'factsRequest',
    'factsHttp',
    'visualRequest',
    'visualHttp',
    'screensRequest',
    'screensHttp',
    'validate',
    'aggregate',
  ],
])
  for (let i = 1; i < branch.length; i++) edge(branch[i - 1], branch[i]);
edge('aggregate', 'end');
const description =
  '版本 detail-page-v1：兼容原文字策划和详情页，增量支持通用/商品需求理解及最多两项关键追问。仅输出需求或策划结果，不执行媒体生成或批准付费；由映造校验、报价并确认生成。';
const app = {
  version: '0.7.0',
  kind: 'app',
  app: {
    name: '映造·商品创作策划',
    description,
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_type: 'emoji',
    mode: 'workflow',
    use_icon_as_answer_icon: false,
  },
  dependencies: [],
  workflow: {
    conversation_variables: [],
    environment_variables: [
      {
        id: '0169cfb4-1f0e-481e-9dd4-6a83d70f0011',
        name: 'PLANNER_API_KEY',
        value_type: 'secret',
        value: '',
        description: '用户授权的策划接口密钥，仅在云端填写',
        selector: ['env', 'PLANNER_API_KEY'],
      },
      {
        id: '0169cfb4-1f0e-481e-9dd4-6a83d70f0012',
        name: 'PLANNER_BASE_URL',
        value_type: 'string',
        value: 'https://xingyunyinli.com/v1',
        description: '策划接口基础地址',
        selector: ['env', 'PLANNER_BASE_URL'],
      },
      {
        id: '0169cfb4-1f0e-481e-9dd4-6a83d70f0013',
        name: 'PLANNER_MODEL',
        value_type: 'string',
        value: 'kimi-k3',
        description: '文本策划模型',
        selector: ['env', 'PLANNER_MODEL'],
      },
    ],
    features: {
      file_upload: { enabled: false },
      opening_statement: '',
      retriever_resource: { enabled: false },
      sensitive_word_avoidance: { enabled: false },
      speech_to_text: { enabled: false },
      suggested_questions: [],
      suggested_questions_after_answer: { enabled: false },
      text_to_speech: { enabled: false, language: '', voice: '' },
    },
    graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.6 } },
    rag_pipeline_variables: [],
  },
};
async function save(output, value, basename) {
  await mkdir(output, { recursive: true });
  const source = yaml.dump(value, { noRefs: true, lineWidth: 110, sortKeys: false });
  await writeFile(join(output, `${basename}.yaml`), source);
  const buffer = Buffer.from(source);
  const manifest = {
    format: 'dify.app',
    format_version: 1,
    apps: [
      {
        path: 'app.yaml',
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      },
    ],
  };
  const archive = new JSZip();
  const zipOptions = { date: new Date('2026-10-29T00:00:00Z') };
  archive.file('app.yaml', buffer, zipOptions);
  archive.file('manifest.yaml', yaml.dump(manifest), zipOptions);
  await writeFile(
    join(output, `${basename}.ifpkg`),
    await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  return {
    yaml: join(output, `${basename}.yaml`),
    package: join(output, `${basename}.ifpkg`),
    nodeCount: nodes.length,
  };
}
console.log(JSON.stringify(await save(root, app, 'detail-page-v1')));
const overlayIndex = process.argv.indexOf('--overlay');
if (overlayIndex >= 0) {
  const sourcePath = resolve(process.argv[overlayIndex + 1] || '');
  const outputPath = resolve(process.argv[overlayIndex + 2] || '');
  if (!sourcePath.includes('/var/') || !outputPath.includes('/var/'))
    throw new Error('Private overlay must stay in var');
  const original = yaml.load(await readFile(sourcePath, 'utf8'));
  const merged = structuredClone(app);
  merged.app = { ...original.app, description };
  merged.workflow.features = original.workflow.features;
  merged.workflow.environment_variables = original.workflow.environment_variables.map((e) => {
    if (e.value_type === 'secret') {
      if (e.value !== '' && e.value !== '[__HIDDEN__]')
        throw new Error('Only an export without secret values is accepted');
      return { ...e, value: '[__HIDDEN__]' };
    }
    return e;
  });
  if (
    !['PLANNER_API_KEY', 'PLANNER_MODEL', 'PLANNER_BASE_URL'].every((n) =>
      merged.workflow.environment_variables.some((e) => e.name === n),
    )
  )
    throw new Error('Required existing planner variables are missing');
  console.log(JSON.stringify(await save(outputPath, merged, 'detail-page-v1-same-app')));
}

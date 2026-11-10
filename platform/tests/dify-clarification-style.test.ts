import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  creativeIntentRequestSchema,
  creativeIntentResultSchema,
  type CreativeIntentResult,
} from '../src/contracts/creative-intent';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint'))('js-yaml') as {
  load: (source: string) => unknown;
};
const directory = 'workflows/dify/detail-page-v1';
const source = readFileSync(`${directory}/detail-page-v1.yaml`, 'utf8');
const definition = z
  .object({
    workflow: z.object({
      graph: z.object({
        nodes: z.array(
          z.object({ id: z.string(), data: z.object({ code: z.string().optional() }) }),
        ),
      }),
    }),
  })
  .parse(yaml.load(source));
const input = creativeIntentRequestSchema.parse({
  version: 1,
  requestId: randomUUID(),
  rawPrompt: '做个高级的，不要人物；不要把“不加文字”理解成删除原有标识。',
  sourceTexts: [
    { id: 'prompt', text: '做个高级的，不要人物；不要把“不加文字”理解成删除原有标识。' },
  ],
  answers: [],
  materials: [],
  context: {
    mediaType: 'image',
    platform: '通用电商',
    placement: 'general',
    language: '中文',
    count: 1,
    ratio: '1:1',
    resolution: '2K',
    supportsReference: true,
    supportsAudio: false,
    supportsText: true,
  },
  strategy: { id: 'general', guidance: '仅询问真正影响交付的问题。' },
});

function run(id: string, args: Record<string, unknown>) {
  const code = definition.workflow.graph.nodes.find((node) => node.id === id)?.data.code;
  if (!code) throw new Error('Missing workflow node');
  return JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        'import sys,json\np=json.load(sys.stdin)\nscope={}\nexec(compile(p["code"],"node","exec"),scope)\ntry:\n print(json.dumps({"ok":True,"result":scope["main"](**p["args"])}))\nexcept Exception as error:\n print(json.dumps({"ok":False,"error":str(error)}))\n',
      ],
      { input: JSON.stringify({ code, args }), encoding: 'utf8', timeout: 10000 },
    ),
  ) as { ok: boolean; result?: Record<string, string> };
}

function clarification(): CreativeIntentResult {
  return {
    type: 'intent-plan',
    version: 1,
    requestId: input.requestId,
    status: 'needs_clarification',
    brief: {
      scope: 'general',
      subject: '',
      goal: '明确主体后创作',
      mediaType: 'image',
      platform: '通用电商',
      placement: 'general',
      productMode: 'not-applicable',
      facts: [],
      constraints: ['不要人物', '不新增文字，不删除原有标识'],
    },
    summary: '先确认画面主体。',
    assumptions: [],
    questions: [
      {
        id: 'subject',
        field: 'subject',
        question: '你想让画面展示什么主体？',
        reason: '主体决定画面内容。',
        options: ['动物', '风景'],
      },
    ],
    prompt: '',
    reviewChecklist: ['不出现人物，保留原有标识'],
  };
}

function parseNode(value: CreativeIntentResult) {
  return run('1793710003000', {
    status_code: 200,
    body: JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
    }),
    intent_request_json: JSON.stringify(input),
  });
}

it('embeds conversational guidance without changing user constraints or the two-blocker policy', () => {
  const built = run('1793710001000', {
    intent_request_json: JSON.stringify(input),
    model: 'kimi-k3',
  });
  expect(built.ok).toBe(true);
  const payload = JSON.parse(built.result!.result!) as {
    messages: { role: string; content: string }[];
  };
  const prompt = payload.messages[0]!.content;
  expect(prompt).toBe(readFileSync(`${directory}/prompts/intent.txt`, 'utf8'));
  for (const rule of [
    '每题只问一个需要决定的问题',
    '一句口语，一般20–35个中文字',
    '通常提供2–3个短选项',
    'reason只用一句话',
    '不重复问题或选项',
    '不截断问句',
    '简短不能省掉冲突双方、必要限定、否定',
    '不强制每轮只问一题',
    '每轮最多2个',
    '不要索取品牌、容量、材质',
    '缺品牌、容量、价格、材质、客群都不必追问',
  ])
    expect(prompt).toContain(rule);
  expect(JSON.parse(payload.messages[1]!.content)).toEqual(input);
  // This proves the built artifact carries the guidance, not that a live model follows it.
});

it('keeps long necessary qualifications lossless and allows two independent questions', () => {
  const value = clarification();
  value.questions[0]!.question =
    '你说不要新增文字，同时要求保留商品原有标识；在不删除原有文字和不新增排版的前提下，这次具体要展示什么主体？';
  value.questions.push({
    id: 'conflict',
    field: 'conflict',
    question: '保留'.repeat(118) + '否定条件',
    reason: '必要'.repeat(120),
    options: ['原样'.repeat(50), '改变'.repeat(50), '暂缓'.repeat(50)],
  });
  expect(creativeIntentResultSchema.parse(value)).toEqual(value);
  const parsed = parseNode(value);
  expect(parsed.ok).toBe(true);
  expect(JSON.parse(parsed.result!.result!)).toEqual(value);
});

it('retains existing hard question length and count limits in both parsers', () => {
  const tooLong = clarification();
  tooLong.questions[0]!.question = '问'.repeat(241);
  expect(creativeIntentResultSchema.safeParse(tooLong).success).toBe(false);
  expect(parseNode(tooLong).ok).toBe(false);
  const tooMany = clarification();
  tooMany.questions = ['subject', 'conflict', 'delivery'].map((id) => ({
    ...tooMany.questions[0]!,
    id,
  }));
  expect(creativeIntentResultSchema.safeParse(tooMany).success).toBe(false);
  expect(parseNode(tooMany).ok).toBe(false);
});

it('packages the exact reviewed DSL and a matching checksum in the import archive', async () => {
  const archive = await JSZip.loadAsync(readFileSync(`${directory}/detail-page-v1.ifpkg`));
  const packaged = await archive.file('app.yaml')!.async('nodebuffer');
  expect(packaged.toString('utf8')).toBe(source);
  const manifest = z
    .object({
      apps: z.array(z.object({ path: z.string(), size: z.number(), sha256: z.string() })),
    })
    .parse(yaml.load(await archive.file('manifest.yaml')!.async('string')));
  expect(manifest.apps).toEqual([
    {
      path: 'app.yaml',
      size: packaged.length,
      sha256: createHash('sha256').update(packaged).digest('hex'),
    },
  ]);
  expect(definition.workflow.graph.nodes).toHaveLength(18);
});

import { expect, it } from 'vitest';
import {
  creativeIntentRequestSchema,
  creativeIntentResultSchema,
  validateCreativeIntent,
  type CreativeIntentRequest,
} from '../src/contracts/creative-intent';
import { simulateCreativeIntent } from '../src/server/tasks/creative-intent-simulation';

function request(placement: CreativeIntentRequest['context']['placement']): CreativeIntentRequest {
  return creativeIntentRequestSchema.parse({
    version: 1,
    requestId: '00000000-0000-4000-8000-000000000001',
    rawPrompt: '创作杯子展示',
    sourceTexts: [{ id: 'request', text: '创作杯子展示' }],
    answers: [],
    materials: [],
    context: {
      mediaType: placement === 'product-video' ? 'video' : 'image',
      platform: '通用电商',
      placement,
      market: 'CN',
      language: 'zh-CN',
      count: 1,
      ratio: '1:1',
      resolution: '2K',
      supportsReference: true,
      supportsAudio: false,
      supportsText: false,
    },
    strategy: { id: 'isolated-demo', guidance: '' },
  });
}

it.each(['main-image', 'secondary-image', 'detail-image', 'product-video'] as const)(
  'keeps the explicit product placement %s valid in the local fixture',
  (placement) => {
    const input = request(placement);
    const output = creativeIntentResultSchema.parse(simulateCreativeIntent(input));
    expect(output.brief).toMatchObject({
      scope: 'product',
      productMode: 'concept',
      placement,
      market: 'CN',
    });
    expect(() => validateCreativeIntent(output, input)).not.toThrow();
  },
);

it('uses reference mode only for usable product images, never background-only or unavailable references', () => {
  const input = request('main-image');
  input.materials = [
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'fixture.png',
      kind: 'image',
      role: 'reference',
    },
  ];
  const output = simulateCreativeIntent(input);
  expect(output.brief.productMode).toBe('reference');
  expect(() => validateCreativeIntent(output, input)).not.toThrow();
  input.context.supportsReference = false;
  expect(simulateCreativeIntent(input).brief.productMode).toBe('concept');
  input.context.supportsReference = true;
  input.materials[0]!.role = 'background';
  expect(simulateCreativeIntent(input).brief.productMode).toBe('concept');
});

it('keeps free creativity general even when image references exist', () => {
  const input = request('general');
  input.rawPrompt = '画一只太空猫';
  input.materials = [
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'style.png',
      kind: 'image',
      role: 'reference',
    },
  ];
  const output = simulateCreativeIntent(input);
  expect(output.brief).toMatchObject({ scope: 'general', productMode: 'not-applicable' });
  expect(() => validateCreativeIntent(output, input)).not.toThrow();
});

it.each(['image', 'video'] as const)(
  'quotes the original request and clarification answers in the local %s confirmation summary',
  (mediaType) => {
    const input = request('general');
    input.context.mediaType = mediaType;
    input.rawPrompt = '帮我做个高级一点';
    const missing = simulateCreativeIntent(input);
    expect(missing.status).toBe('needs_clarification');
    expect(missing.prompt).toBe('');
    expect(missing.questions).toHaveLength(1);
    input.answers = [
      { questionId: 'subject', answer: '青绿色精华概念瓶，不添加人物或文字。' },
      { questionId: 'delivery', answer: '固定机位，无音轨，不改变上述否定要求。' },
    ];
    const output = creativeIntentResultSchema.parse(simulateCreativeIntent(input));
    expect(output.status).toBe('ready');
    expect(output.summary).toBe(
      '【本机模拟】原话：帮我做个高级一点\n补充1：青绿色精华概念瓶，不添加人物或文字。\n补充2：固定机位，无音轨，不改变上述否定要求。',
    );
    expect(output.prompt).toBe([input.rawPrompt, ...input.answers.map((a) => a.answer)].join('\n'));
    expect(output.brief.facts).toEqual([]);
    expect(output.questions).toEqual([]);
    expect(() => validateCreativeIntent(output, input)).not.toThrow();
  },
);

it('bounds a maximal local summary while retaining a marked excerpt from every answer', () => {
  const input = request('general');
  input.rawPrompt = '原始长需求'.repeat(2400);
  input.answers = Array.from({ length: 12 }, (_, index) => ({
    questionId: `subject_${index}`,
    answer: `第${index + 1}项补充：${'不要添加人物。'.repeat(240)}`,
  }));
  const before = structuredClone(input);
  const output = creativeIntentResultSchema.parse(simulateCreativeIntent(input));
  expect(output.summary.length).toBeLessThanOrEqual(800);
  expect(output.summary).toContain('【本机模拟】原话：原始长需求');
  for (let index = 0; index < 12; index++)
    expect(output.summary).toContain(`补充${index + 1}：第${index + 1}项补充：`);
  expect(output.summary.match(/…/g)).toHaveLength(13);
  expect(input).toEqual(before);
  expect(output.prompt).toBe(
    [input.rawPrompt, ...input.answers.map((answer) => answer.answer)].join('\n').slice(0, 5000),
  );
});

import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  creativeIntentRequestSchema,
  type CreativeIntentResult,
} from '../src/contracts/creative-intent';
import {
  NativePlanValidationError,
  parseNativeIntentResponse,
} from '../src/server/providers/native-planner';
import { compileNativeVideoPlan } from '../src/server/tasks/native-capture';

function fixture(rawPrompt: string, direction: 'left' | 'right' = 'right') {
  const request = creativeIntentRequestSchema.parse({
    version: 1,
    requestId: randomUUID(),
    rawPrompt,
    sourceTexts: [{ id: 'request', text: rawPrompt }],
    answers: [],
    materials: [
      {
        id: randomUUID(),
        name: '参考图.png',
        kind: 'image',
        role: 'input',
        width: 600,
        height: 600,
        byteSize: 1000,
      },
    ],
    context: {
      mediaType: 'video',
      platform: '通用电商',
      placement: 'general',
      language: 'zh-CN',
      count: 1,
      ratio: '1:1',
      resolution: '720p',
      duration: 5,
      supportsReference: true,
      supportsMotionEndpoints: true,
      supportsAudio: false,
      supportsText: false,
    },
    strategy: { id: 'fixture', guidance: '' },
  });
  const result: CreativeIntentResult = {
    type: 'intent-plan',
    version: 1,
    requestId: request.requestId,
    status: 'ready',
    brief: {
      scope: 'product',
      subject: '参考商品',
      goal: '产品短片',
      mediaType: 'video',
      platform: '通用电商',
      placement: 'general',
      productMode: 'reference',
      facts: [],
      constraints: [],
    },
    summary: '保持参考商品外观。',
    assumptions: [],
    questions: [],
    prompt: '保持商品完整入画。',
    reviewChecklist: [],
    generationPlan: {
      imagePrompt: '沿用原图。',
      videoPrompt: '相机向右小幅平移，主体静止。',
      firstFrame: { mode: 'reference', assetId: request.materials[0]!.id },
      cameraControl: { type: 'translate', direction, displacementPercent: 2 },
    },
  };
  return { request, result };
}
const response = (result: CreativeIntentResult) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
});

it('recovers only redundant omitted video fields from a complete validated stage plan', () => {
  const { request, result } = fixture('主体保持静止，镜头小幅向右平移。');
  const incomplete: Record<string, unknown> = { ...result };
  delete incomplete.prompt;
  delete incomplete.questions;
  const parse = (value: unknown) =>
    parseNativeIntentResponse(
      { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] },
      request,
    );
  expect(parse(incomplete)).toMatchObject({
    prompt: `初始画面：${result.generationPlan!.imagePrompt}\n视频动作：${result.generationPlan!.videoPrompt}`,
    questions: [],
  });
  for (const invalid of [
    { ...incomplete, generationPlan: undefined },
    { ...incomplete, generationPlan: { ...result.generationPlan, videoPrompt: '' } },
    { ...incomplete, prompt: null },
    { ...incomplete, questions: null },
    { ...incomplete, brief: { ...result.brief, mediaType: 'image' } },
    { ...incomplete, generationPlan: { ...result.generationPlan, unknown: true } },
    {
      ...incomplete,
      generationPlan: {
        ...result.generationPlan,
        firstFrame: { mode: 'reference', assetId: randomUUID() },
      },
    },
  ])
    expect(() => parse(invalid)).toThrow(NativePlanValidationError);
});

it('rejects hallucinated output pixels while preserving reference dimensions', () => {
  const { request, result } = fixture('主体保持静止，镜头小幅向右平移。');
  const sizedRequest = {
    ...request,
    context: { ...request.context, videoOutputSize: { width: 960, height: 960 } },
  };
  expect(() =>
    parseNativeIntentResponse(
      response({ ...result, assumptions: ['最终输出720×720，无音频。'] }),
      sizedRequest,
    ),
  ).toThrow('VIDEO_OUTPUT_SIZE_CHANGED');
  expect(
    parseNativeIntentResponse(
      response({ ...result, assumptions: ['参考原图600×600，最终输出960×960。'] }),
      sizedRequest,
    ).assumptions,
  ).toEqual(['参考原图600×600，最终输出960×960。']);
});

it.each(['absent', 'null'] as const)(
  'canonicalizes only %s inactive prompt text in a valid clarification',
  (mode) => {
    const { request, result } = fixture('需要确认创作主体。');
    const clarification: Record<string, unknown> = {
      ...result,
      status: 'needs_clarification',
      questions: [
        {
          id: 'subject',
          field: 'subject',
          question: '主要表现什么？',
          reason: '主体尚未提供。',
          options: ['商品', '场景'],
        },
      ],
    };
    delete clarification.generationPlan;
    if (mode === 'absent') delete clarification.prompt;
    else clarification.prompt = null;
    const parse = (value: unknown) =>
      parseNativeIntentResponse(
        {
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
        },
        request,
      );
    expect(parse(clarification)).toMatchObject({ status: 'needs_clarification', prompt: '' });
    expect(() => parse({ ...clarification, questions: [] })).toThrow(NativePlanValidationError);
    expect(() => parse({ ...clarification, generationPlan: result.generationPlan })).toThrow();
    expect(() => parse({ ...clarification, prompt: '已可执行的商品画面' })).toThrow();
    expect(() => parse({ ...clarification, prompt: 12 })).toThrow('prompt: invalid_type');
    expect(() => parse({ ...clarification, status: 'ready', questions: [] })).toThrow(
      'prompt: invalid_type',
    );
  },
);

it.each([
  '商品保持静止，固定镜头，不要移动。',
  '商品保持静止，镜头小幅向左平移。',
  '镜头小幅向右平移，同时让商品旋转。',
  '商品保持静止，镜头向右移动画宽10%。',
  '参考图制作产品短片。',
  '背景保持静止，镜头小幅向右平移。',
  '光线保持静止，镜头小幅向右平移。',
  '主体的灯光保持静止，镜头小幅向右平移。',
  '主体保持静止，镜头先轻微向左平移，然后镜头轻微向右平移。',
  '主体保持静止，镜头先轻微向左平移然后轻微向右平移。',
  '主体保持静止，镜头小幅向右平移，结尾不要停。',
])('does not authorize a conflicting or unrequested controlled endpoint: %s', (prompt) => {
  const { request, result } = fixture(prompt);
  expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
    'CAMERA_INTENT_UNCONFIRMED',
  );
  expect(() => compileNativeVideoPlan(result, request)).toThrow('CAMERA_INTENT_UNCONFIRMED');
});

it('does not authorize transforms from attachment instructions or a generated summary', () => {
  const { request, result } = fixture('拍摄商品展示视频。');
  const text = '商品保持静止，镜头小幅向右平移。';
  request.sourceTexts.push({ id: 'document:fixture', text });
  request.previousSummary = text;
  result.summary = text;
  result.brief.facts = [{ sourceId: 'document:fixture', quote: text }];
  expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
    'CAMERA_INTENT_UNCONFIRMED',
  );
});

it('accepts a subsequent explicit user correction, but rejects a later cancellation', () => {
  const { request, result } = fixture('商品保持静止，镜头小幅向右平移。', 'left');
  request.answers.push({ questionId: 'camera', answer: '主体保持静止，改为镜头轻微向左平移。' });
  expect(
    parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
  ).toMatchObject({ type: 'translate', direction: 'left' });
  request.answers.push({ questionId: 'camera_next', answer: '取消运镜，固定镜头。' });
  expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
    'CAMERA_INTENT_UNCONFIRMED',
  );
});

it.each(['让主体跑起来。', '改为镜头向右轻微平移。', '使用暖色光。'])(
  'does not inherit stale static-subject consent after the answer %s',
  (answer) => {
    const { request, result } = fixture('商品保持静止，镜头小幅向右平移。');
    request.answers.push({ questionId: 'change', answer });
    expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
      'CAMERA_INTENT_UNCONFIRMED',
    );
    delete result.generationPlan!.cameraControl;
    expect(
      parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
    ).toBeUndefined();
  },
);

it('preserves an explicit percent and accepts fixed focal length without confusing it with a stationary camera', () => {
  const { request, result } = fixture('商品保持静止，镜头小幅向右平移画宽1.5%，镜头焦距固定。');
  expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
    'CAMERA_INTENT_UNCONFIRMED',
  );
  result.generationPlan!.cameraControl = {
    type: 'translate',
    direction: 'right',
    displacementPercent: 1.5,
  };
  expect(
    parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
  ).toMatchObject({ type: 'translate', displacementPercent: 1.5 });
});

it('keeps one canonical camera disclosure and preserves the entire bounded user-facing summary', () => {
  const { request, result } = fixture('商品保持静止，镜头小幅向右平移。');
  const note =
    '沿用原图首帧，以平移尾帧约束运镜；边缘少量背景延展，仍由视频模型生成，中段效果需核对。';
  result.summary = `商品完整入画。\n${note}\n${note}`;
  expect(parseNativeIntentResponse(response(result), request).summary).toBe(
    `商品完整入画。\n${note}`,
  );
  result.summary = '字'.repeat(800 - note.length - 1);
  const complete = parseNativeIntentResponse(response(result), request).summary;
  expect(complete.length).toBe(800);
  expect(complete.startsWith(result.summary)).toBe(true);
  result.summary += '字';
  expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
    'CAMERA_DISCLOSURE_LIMIT',
  );
});

it('uses the confirmed structured movement without sending a contradictory model motion paragraph', () => {
  const { request, result } = fixture('商品保持静止，镜头小幅向左平移。', 'left');
  result.generationPlan!.videoPrompt = '相机向右环绕30度并变焦。';
  const compiled = compileNativeVideoPlan(result, request)!;
  expect(compiled.videoPrompt).toContain('整幅画面向右平移约画面宽度的2%');
  expect(compiled.videoPrompt).not.toContain('相机向右环绕30度并变焦');
});

const zoomPrompt =
  '主体全程静止，相机机位和朝向固定，仅以非常缓慢的光学变焦，让整幅画面围绕固定画面中心等比放大到起始的103%。最后0.5秒保持。';
function zoomFixture(rawPrompt = zoomPrompt, scalePercent = 103) {
  const state = fixture(rawPrompt);
  state.result.generationPlan!.cameraControl = { type: 'zoom', scalePercent };
  return state;
}

it.each([
  '相机机位固定，画面中心固定，光学变焦等比放大到103%。',
  '背景静止，相机机位固定，画面中心固定，等比放大到103%。',
  '主体静止，画面中心固定，等比放大到103%。',
  '主体静止，相机机位固定，光学变焦放大到103%。',
  '主体静止，相机机位固定，画面中心固定，轻微光学变焦。',
  '主体静止，相机机位固定，画面中心固定，等比放大到110%。',
  '主体静止，相机机位固定，画面中心固定，等比放大到102%。',
  '主体静止，相机机位固定，画面中心固定，先等比放大到102%，再等比放大到103%。',
  '主体静止，相机机位固定，画面中心固定，从101%等比放大到103%。',
  '主体静止，相机机位固定，画面中心固定，从100%等比放大到102%再到103%。',
  `${zoomPrompt}镜头向右平移2%。`,
  `${zoomPrompt}商品随后旋转。`,
  `${zoomPrompt}最后缩小。`,
  `${zoomPrompt}不要裁切任何边缘。`,
  `${zoomPrompt}最后不要停。`,
  '主体静止，相机机位固定，画面中心固定，不要等比放大到103%。',
])('does not invent or alter a bounded fixed-center zoom: %s', (rawPrompt) => {
  const { request, result } = zoomFixture(rawPrompt);
  expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
    'CAMERA_INTENT_UNCONFIRMED',
  );
});

it.each([
  ['等比放大到起始的103%', 103],
  ['等比放大至101.5%', 101.5],
  ['等比放大约2%', 102],
  ['光学变焦约1%', 101],
] as const)('keeps the explicitly requested zoom amount %s', (motion, scalePercent) => {
  const { request, result } = zoomFixture(
    `主体静止，相机机位固定，画面中心固定，${motion}。`,
    scalePercent,
  );
  expect(
    parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
  ).toEqual({ type: 'zoom', scalePercent });
});

it('accepts the original live request with one explicit 100-to-103-percent range', () => {
  const { request, result } = zoomFixture(
    '将这张参考图原样作为首帧，制作5秒方形静物产品短片。拍摄机位和朝向固定，商品静止，画面中心固定。只缓慢增加镜头焦距，使整幅画面从100%等比放大到103%，最后半秒停稳。口红和盖子的各段比例、红色斜切面、金色材质、盖子端面形状及倾角、相对位置和遮挡关系沿用首帧，完整入画。保留原背景、台面、光照与色温。不要水平平移、绕拍或重新摆放物件，不新增文字、物件或音轨。',
  );
  expect(
    parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
  ).toEqual({ type: 'zoom', scalePercent: 103 });
  expect(compileNativeVideoPlan(result, request)!.videoPrompt).toContain(
    '终点严格为首帧尺寸的103%',
  );
});

it('requires complete fresh zoom intent after an answer and keeps ordinary video available', () => {
  const { request, result } = zoomFixture();
  request.answers.push({ questionId: 'color', answer: '用暖色光。' });
  expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
    'CAMERA_INTENT_UNCONFIRMED',
  );
  request.answers.push({ questionId: 'motion', answer: zoomPrompt });
  expect(
    parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
  ).toMatchObject({ type: 'zoom' });
  request.answers[1]!.answer = '让主体跑起来。';
  expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
    'CAMERA_INTENT_UNCONFIRMED',
  );
  delete result.generationPlan!.cameraControl;
  expect(
    parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
  ).toBeUndefined();
});

it('discloses zoom cropping once without falsely claiming background extension', () => {
  const { request, result } = zoomFixture();
  const note =
    '沿用原图首帧，以中心等比放大的尾帧约束变焦；边缘少量裁切，仍由视频模型生成，中段效果需核对。';
  result.summary = `保留原图。\n${note}\n${note}`;
  const parsed = parseNativeIntentResponse(response(result), request);
  expect(parsed.summary).toBe(`保留原图。\n${note}`);
  expect(parsed.summary).not.toContain('背景延展');
  expect(parseNativeIntentResponse(response(parsed), request).summary).toBe(parsed.summary);
});

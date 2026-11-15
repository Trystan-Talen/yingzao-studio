import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  creativeIntentRequestSchema,
  creativeIntentResultSchema,
} from '../src/contracts/creative-intent';
import {
  canPlanExactPan,
  compileNativeVideoPlan,
  usesExactPan,
  usesModelVideoTailHold,
} from '../src/server/tasks/native-capture';
import { parseNativeIntentResponse } from '../src/server/providers/native-planner';

function fixture() {
  const id = randomUUID();
  const request = creativeIntentRequestSchema.parse({
    version: 1,
    requestId: randomUUID(),
    rawPrompt: '保持参考口红及盖子不变，主体全程静止，镜头微微向右平移，结尾停住。',
    sourceTexts: [
      { id: 'request', text: '保持参考口红及盖子不变，主体全程静止，镜头微微向右平移，结尾停住。' },
    ],
    answers: [],
    materials: [
      {
        id,
        name: '只看名称不能知道内容.png',
        kind: 'image',
        role: 'input',
        width: 2048,
        height: 2048,
        byteSize: 800000,
      },
    ],
    context: {
      mediaType: 'video',
      platform: '通用电商',
      placement: 'product-video',
      language: 'zh-CN',
      count: 1,
      ratio: '1:1',
      resolution: '720p',
      duration: 5,
      supportsReference: true,
      supportsAudio: false,
      supportsText: false,
    },
    strategy: { id: 'example-strategy', guidance: '可选建议：环绕主体、多个镜头切换。' },
  });
  const result = creativeIntentResultSchema.parse({
    type: 'intent-plan',
    version: 1,
    requestId: request.requestId,
    status: 'ready',
    brief: {
      scope: 'product',
      subject: '参考图中的口红及盖子',
      goal: '保持外观的产品短片',
      mediaType: 'video',
      platform: request.context.platform,
      placement: request.context.placement,
      productMode: 'reference',
      facts: [{ sourceId: 'request', quote: request.rawPrompt }],
      constraints: ['全片5秒，结尾停住。', '镜头只作向右平移。'],
    },
    summary: '沿用参考图作为首帧，保持主体静止，镜头向右微移。',
    assumptions: [],
    questions: [],
    prompt: '完整的方案说明仅供确认，不应再次作为两个阶段的输入。',
    generationPlan: {
      firstFrame: { mode: 'reference', assetId: id },
      imagePrompt: '沿用参考图既有画面，无重绘。',
      videoPrompt:
        '主体静止，相机向右直线平移，光轴方向与焦距不变，主体投影向左微移约画宽2%；最后0.5秒平稳停止。',
    },
    reviewChecklist: ['比较原图与视频中商品各段长宽比例。'],
  });
  return { request, result };
}

function response(result: unknown) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] };
}

describe('disclosed real model video tail hold selection', () => {
  function zoom(tail = '最后0.5秒停稳。') {
    const value = fixture();
    value.request.context.supportsMotionEndpoints = true;
    value.request.rawPrompt = `主体全程静止，相机机位固定，画面中心固定，整幅等比放大到103%。${tail}`;
    value.request.sourceTexts = [{ id: 'request', text: value.request.rawPrompt }];
    value.result.brief.facts = [{ sourceId: 'request', quote: value.request.rawPrompt }];
    value.result.generationPlan!.cameraControl = { type: 'zoom', scalePercent: 103 };
    return value;
  }
  it.each(['最后0.5秒停稳。', '末尾半秒保持末帧。', '结尾0.5秒完全静止。'])(
    'freezes an explicit, disclosed half-second hold: %s',
    (tail) => {
      const { request, result } = zoom(tail);
      expect(usesModelVideoTailHold(result, request)).toBe(true);
      expect(compileNativeVideoPlan(result, request)?.videoPostprocess).toBe(
        'model-video-tail-hold-v1',
      );
      const parsed = parseNativeIntentResponse(response(result), request);
      expect(parsed.summary).toContain('视频中间画面仍由模型生成并保留完整原片');
      expect(parsed.summary).toContain('按原顺序重采样');
      expect(parsed.summary).toContain('不修复主体形变');
      expect(parseNativeIntentResponse(response(parsed), request).summary).toBe(parsed.summary);
    },
  );
  it.each([
    '结尾停住。',
    '最后1秒停稳。',
    '最后0.5秒不要停稳。',
    '最后0.5秒停稳，禁止本机后处理。',
    '最后0.5秒停稳，只保留模型原片。',
    '背景烟雾升起，最后0.5秒停稳。',
    '布料飘动，最后0.5秒停稳。',
    '随音乐节奏变焦，最后0.5秒停稳。',
  ])('does not infer or override retiming permission: %s', (tail) => {
    const { request, result } = zoom(tail);
    expect(usesModelVideoTailHold(result, request)).toBe(false);
  });
  it('does not infer a hold from planner text, attachments, or a superseded answer', () => {
    const { request, result } = zoom();
    request.answers = [
      { questionId: 'camera', answer: '主体静止，相机机位固定，画面中心固定，等比放大到103%。' },
    ];
    expect(usesModelVideoTailHold(result, request)).toBe(false);
    expect(compileNativeVideoPlan(result, request)?.videoPostprocess).toBeUndefined();
  });
  it('does not retime ordinary dynamic model video or a locally rendered pan', () => {
    const { request, result } = fixture();
    request.rawPrompt += '最后0.5秒停稳。';
    expect(usesModelVideoTailHold(result, request)).toBe(false);
    expect(compileNativeVideoPlan(result, request)?.videoPostprocess).toBeUndefined();
  });
});

describe('disclosed exact photo pan selection', () => {
  it.each([
    '需要真实空间视差。',
    '要求三维相机横移。',
    '改变景深并进行焦点转移。',
    '前后层不同移动。',
    '前景移动比背景快。',
    '需要真实 parallax 和 3D camera movement。',
    '不能没有真实视差。',
    '不需要二维动画而是需要三维相机运动。',
  ])('does not replace requested spatial motion with a cropped photo: %s', (motion) => {
    const { request, result } = fixture();
    request.context.supportsMotionEndpoints = true;
    request.rawPrompt = `主体静止，镜头向右小幅平移2%，允许裁切少量边缘背景。${motion}`;
    result.generationPlan!.cameraControl = {
      type: 'translate',
      direction: 'right',
      displacementPercent: 2,
    };
    expect(usesExactPan(result, request)).toBe(false);
    expect(canPlanExactPan(request)).toBe(false);
    expect(() => compileNativeVideoPlan(result, request)).toThrow('CAMERA_INTENT_UNCONFIRMED');
    delete result.generationPlan!.cameraControl;
    result.generationPlan!.videoPrompt = `主体静止，镜头向右小幅平移。${motion}`;
    expect(compileNativeVideoPlan(result, request)!.videoPrompt).toContain(motion);
  });

  it.each([
    '不需要三维视差。',
    '不要真实空间视差。',
    '不做三维相机横移。',
    '无需改变景深。',
    '不要前后层不同移动。',
    '保持景深不变，不拉焦。',
    'without parallax, no 3D camera motion。',
  ])('keeps explicitly excluded spatial effects compatible with exact pan: %s', (motion) => {
    const { request, result } = fixture();
    request.context.supportsMotionEndpoints = true;
    request.rawPrompt = `主体静止，镜头向右小幅平移2%，允许裁切少量边缘背景。${motion}`;
    result.generationPlan!.cameraControl = {
      type: 'translate',
      direction: 'right',
      displacementPercent: 2,
    };
    expect(usesExactPan(result, request)).toBe(true);
    expect(canPlanExactPan(request)).toBe(true);
    expect(compileNativeVideoPlan(result, request)!.motionRenderer).toBe('exact-pan-v1');
  });

  it('accepts the actual clarified perfume request with naturally repeated same-direction motion', () => {
    const { request, result } = fixture();
    request.context.supportsMotionEndpoints = true;
    request.rawPrompt =
      '使用该香水参考制作5秒横版静物视频。画面整体向右平移，等效镜头向左轻移，最终位移为画宽的2%；0至4.5秒平滑减速，最后0.5秒完全停稳。严格保持等比尺度不变、朝向不变，瓶体、瓶盖、液体、布料、石台、阴影和背景作同一二维位移，无绕拍、俯仰、缩放、旋转、透视变化、液体晃动或褶皱运动，不补出新的瓶侧面。边缘不得镜像重复、拉伸或露出空带。明确采用可保持此精度的产品模式并记录模型生成与本机处理各自负责的部分。 主体保持静止，镜头只做非常缓慢、小幅的水平向左平移，幅度为画宽2%。允许裁切少量背景边缘，接受在视频开始前固定放大约2%以预留位移余量，片内尺度不再变化。采用静态图精确平移，不调用视频模型，不需要三维视差。';
    result.generationPlan!.cameraControl = {
      type: 'translate',
      direction: 'left',
      displacementPercent: 2,
    };
    expect(canPlanExactPan(request)).toBe(true);
    expect(compileNativeVideoPlan(result, request)!.motionRenderer).toBe('exact-pan-v1');
  });

  it.each([
    ['镜头向右轻移，镜头向右小幅平移2%。', true],
    ['镜头向右小幅平移2%，镜头向右轻移。', true],
    ['镜头向右小幅平移1%，镜头向右小幅平移2%。', false],
    ['镜头向右小幅平移2%，镜头向左小幅平移2%。', false],
  ])('allows repetition only when camera direction and amount agree: %s', (motion, allowed) => {
    const { request, result } = fixture();
    request.context.supportsMotionEndpoints = true;
    request.rawPrompt = `主体静止，${motion}允许裁切少量边缘背景。`;
    result.generationPlan!.cameraControl = {
      type: 'translate',
      direction: 'right',
      displacementPercent: 2,
    };
    if (allowed)
      expect(compileNativeVideoPlan(result, request)!.motionRenderer).toBe('exact-pan-v1');
    else expect(() => compileNativeVideoPlan(result, request)).toThrow('CAMERA_INTENT_UNCONFIRMED');
  });
  it.each([
    ['允许裁切少量边缘背景。', true],
    ['允许裁切少量背景，不调用视频模型。', true],
    ['允许对背景进行少量裁切。', true],
    ['不允许裁切背景。', false],
    ['允许裁切主体。', false],
    ['允许裁切少量背景，必须调用视频模型。', false],
    ['允许裁切少量背景，原样作为首帧。', false],
    ['', false],
  ])('honors the actual crop and renderer choice: %s', (suffix, expected) => {
    const { request, result } = fixture();
    request.context.supportsMotionEndpoints = true;
    request.rawPrompt += suffix;
    result.generationPlan!.cameraControl = {
      type: 'translate',
      direction: 'right',
      displacementPercent: 2,
    };
    expect(usesExactPan(result, request)).toBe(expected);
    expect(compileNativeVideoPlan(result, request)!.motionRenderer).toBe(
      expected ? 'exact-pan-v1' : undefined,
    );
  });
  it('does not inherit permission to crop from a superseded request or an attachment', () => {
    const { request, result } = fixture();
    result.generationPlan!.cameraControl = {
      type: 'translate',
      direction: 'right',
      displacementPercent: 2,
    };
    request.rawPrompt += '允许裁切少量背景。';
    request.answers = [
      { questionId: 'choice', answer: '主体静止，相机向右小幅平移2%，不要裁切背景。' },
    ];
    expect(usesExactPan(result, request)).toBe(false);
  });
});

describe('native capture stage isolation', () => {
  it('keeps camera timing out of the first-frame request and does not append alternative strategy shots', () => {
    const { request, result } = fixture();
    const original = structuredClone(result);
    const plan = compileNativeVideoPlan(result, request)!;
    expect(plan.imagePrompt).toContain(result.generationPlan!.imagePrompt);
    expect(plan.imagePrompt).not.toMatch(/5秒|平移|环绕|镜头切换/);
    expect(plan.videoPrompt).toContain(result.generationPlan!.videoPrompt);
    expect(plan.videoPrompt).not.toContain(result.generationPlan!.imagePrompt);
    expect(plan.videoPrompt).not.toContain(request.strategy.guidance);
    expect(plan.videoPrompt).not.toContain(result.prompt);
    expect(plan.videoPrompt).not.toContain(result.brief.facts[0]!.quote);
    expect(plan.videoPrompt).not.toContain(result.reviewChecklist[0]);
    expect(plan.videoPrompt.length).toBeLessThan(500);
    expect(result).toEqual(original);
  });

  it('retains reference geometry rather than inventing a left-front placement from its filename', () => {
    const { request, result } = fixture();
    result.generationPlan!.firstFrame = { mode: 'generate' };
    result.generationPlan!.imagePrompt = '只把背景改成浅灰，保留参考主体。';
    const plan = compileNativeVideoPlan(result, request)!;
    expect(plan.imagePrompt).toContain('各段长宽比例');
    expect(plan.imagePrompt).toContain('相对位置保持一致');
    expect(plan.imagePrompt).toContain('不换视角');
    expect(plan.imagePrompt).toContain('主体只等比缩放');
    expect(plan.imagePrompt).not.toMatch(/左前方|中央偏右|只看名称/);
  });

  it('keeps an explicitly chosen orbit rather than adding a conflicting fixed-camera default', () => {
    const { request, result } = fixture();
    result.generationPlan!.videoPrompt = '相机环绕主体15度，结尾继续运动。';
    const plan = compileNativeVideoPlan(result, request)!;
    expect(plan.videoPrompt.startsWith(result.generationPlan!.videoPrompt)).toBe(true);
    expect(plan.videoPrompt).not.toMatch(/固定镜头|焦距|0.5秒|停止|二维|平面画布|同步移动/);
  });

  it('keeps legacy two-prompt plans valid without inventing a reference choice', () => {
    const { request, result } = fixture();
    delete result.generationPlan!.firstFrame;
    const plan = compileNativeVideoPlan(result, request)!;
    expect(plan.firstFrame).toBeUndefined();
    expect(parseNativeIntentResponse(response(result), request)).toEqual(result);
  });
});

describe('native reference plan provenance', () => {
  it('accepts a matching input image and freezes its explicit source selection', () => {
    const { request, result } = fixture();
    expect(parseNativeIntentResponse(response(result), request)).toEqual(result);
    expect(compileNativeVideoPlan(result, request)!.firstFrame).toEqual(
      result.generationPlan!.firstFrame,
    );
  });

  it.each(['missing', 'background', 'document', 'unsupported'] as const)(
    'rejects a %s reference before submitting media',
    (reason) => {
      const { request, result } = fixture();
      // First-frame provenance applies even when no product-preservation mode was claimed.
      result.brief.productMode = 'concept';
      if (reason === 'missing') request.materials[0]!.id = randomUUID();
      if (reason === 'background') request.materials[0]!.role = 'background';
      if (reason === 'document') request.materials[0]!.kind = 'document';
      if (reason === 'unsupported') request.context.supportsReference = false;
      expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
        'FIRST_FRAME_REFERENCE_INVALID',
      );
      expect(() => compileNativeVideoPlan(result, request)).toThrow(
        'FIRST_FRAME_REFERENCE_INVALID',
      );
    },
  );

  it.each(['ratio', 'missing-size'] as const)(
    'rejects %s mismatch rather than silently cropping, stretching or regenerating a supplied frame',
    (reason) => {
      const { request, result } = fixture();
      if (reason === 'ratio') request.context.ratio = '16:9';
      else delete request.materials[0]!.width;
      expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
        'FIRST_FRAME_RATIO_MISMATCH',
      );
      expect(() => compileNativeVideoPlan(result, request)).toThrow('FIRST_FRAME_RATIO_MISMATCH');
    },
  );

  it.each([
    { width: 299, height: 299, byteSize: 1000 },
    { width: 6001, height: 6001, byteSize: 1000 },
    { width: 2048, height: 2048, byteSize: 30 * 1024 * 1024 },
  ])('rejects a known unsupported original before issuing a frozen media plan: %o', (metadata) => {
    const { request, result } = fixture();
    Object.assign(request.materials[0]!, metadata);
    expect(() => parseNativeIntentResponse(response(result), request)).toThrow('FIRST_FRAME_LIMIT');
    expect(() => compileNativeVideoPlan(result, request)).toThrow('FIRST_FRAME_LIMIT');
  });

  it.each([300, 6000])(
    'accepts the inclusive %s-pixel limit and a source just under the byte limit',
    (size) => {
      const { request, result } = fixture();
      Object.assign(request.materials[0]!, {
        width: size,
        height: size,
        byteSize: 30 * 1024 * 1024 - 1,
      });
      expect(parseNativeIntentResponse(response(result), request)).toEqual(result);
    },
  );

  it('keeps an already-persisted reference decision without byte metadata valid', () => {
    const { request, result } = fixture();
    delete request.materials[0]!.byteSize;
    expect(parseNativeIntentResponse(response(result), request)).toEqual(result);
    expect(compileNativeVideoPlan(result, request)!.firstFrame).toEqual(
      result.generationPlan!.firstFrame,
    );
  });
});

describe('native controlled camera plan', () => {
  it('always discloses source reuse and endpoint guidance without claiming to guarantee the middle frames', () => {
    const { request, result } = fixture();
    request.context.supportsMotionEndpoints = true;
    result.generationPlan!.cameraControl = {
      type: 'translate',
      direction: 'right',
      displacementPercent: 2,
    };
    const parsed = parseNativeIntentResponse(response(result), request);
    expect(parsed.summary).toContain('沿用参考图作为首帧');
    expect(parsed.summary).toContain('平移尾帧约束运镜');
    expect(parsed.summary).toContain('边缘少量背景延展');
    expect(parsed.summary).toContain('仍由视频模型生成');
    expect(parsed.summary).toContain('中段效果需核对');
    expect(parseNativeIntentResponse(response(parsed), request).summary).toBe(parsed.summary);
    result.summary = '长'.repeat(800);
    expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
      'CAMERA_DISCLOSURE_LIMIT',
    );
  });
  it.each(['left', 'right'] as const)(
    'maps a confirmed %s camera indication to one opposite two-dimensional whole-scene shift',
    (direction) => {
      const { request, result } = fixture();
      request.context.supportsMotionEndpoints = true;
      request.rawPrompt = request.rawPrompt.replace('向右', direction === 'left' ? '向左' : '向右');
      request.sourceTexts[0]!.text = request.rawPrompt;
      result.brief.facts[0]!.quote = request.rawPrompt;
      result.generationPlan!.cameraControl = {
        type: 'translate',
        direction,
        displacementPercent: 2,
      };
      expect(
        parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
      ).toEqual(result.generationPlan!.cameraControl);
      const compiled = compileNativeVideoPlan(result, request)!;
      expect(compiled.cameraControl).toEqual(result.generationPlan!.cameraControl);
      expect(compiled.videoPrompt).toContain('静态首帧视为一张完整平面画布');
      expect(compiled.videoPrompt).toContain('仅做二维水平滑动');
      expect(compiled.videoPrompt).toContain(
        `整幅画面向${direction === 'right' ? '左' : '右'}平移约画面宽度的2%`,
      );
      expect(compiled.videoPrompt).toContain('背景、台面、全部物件及阴影以同一位移同步移动');
      expect(compiled.videoPrompt).toContain('轮廓、比例、倾角、遮挡和背景分界形状保持不变');
      expect(compiled.videoPrompt).toContain('不生成视差、三维新视角或绕拍');
      expect(compiled.videoPrompt).not.toMatch(/相机(?:仅|沿|水平)|主体投影|光轴/);
      expect(compiled.videoPrompt).toContain('无反向或过冲');
      expect(compiled.videoPrompt).toContain('停稳在尾帧');
      expect(compiled.videoPrompt.length).toBeLessThan(500);
      expect(compiled.imagePrompt).not.toContain('尾帧');
    },
  );

  it('does not silently enable endpoint control on an existing plan after the model gains support', () => {
    const { request, result } = fixture();
    request.context.supportsMotionEndpoints = true;
    expect(
      parseNativeIntentResponse(response(result), request).generationPlan!.cameraControl,
    ).toBeUndefined();
    const compiled = compileNativeVideoPlan(result, request)!;
    expect(compiled.cameraControl).toBeUndefined();
    expect(compiled.videoPrompt).not.toContain('尾帧');
  });

  it.each([101, 101.5, 103])(
    'compiles a center-fixed %s-percent endpoint without importing a larger model zoom',
    (scalePercent) => {
      const { request, result } = fixture();
      request.context.supportsMotionEndpoints = true;
      request.rawPrompt = `主体全程静止，相机机位固定，画面中心固定，整幅等比放大到${scalePercent}%。`;
      request.sourceTexts[0]!.text = request.rawPrompt;
      result.brief.facts[0]!.quote = request.rawPrompt;
      result.generationPlan!.cameraControl = { type: 'zoom', scalePercent };
      result.generationPlan!.videoPrompt = '相机向前推进并放大到125%。';
      const parsed = parseNativeIntentResponse(response(result), request);
      const compiled = compileNativeVideoPlan(parsed, request)!;
      expect(compiled.firstFrame).toEqual(result.generationPlan!.firstFrame);
      expect(compiled.cameraControl).toEqual({ type: 'zoom', scalePercent });
      expect(compiled.videoPrompt).toContain('围绕固定画面中心做二维等比放大');
      expect(compiled.videoPrompt).toContain(`终点严格为首帧尺寸的${scalePercent}%`);
      expect(compiled.videoPrompt).toContain(
        '背景、台面、全部物件及阴影使用同一中心和缩放比例同步放大',
      );
      expect(compiled.videoPrompt).toContain('不超出尾帧尺度');
      expect(compiled.videoPrompt).toContain('0.5秒停稳在尾帧');
      expect(compiled.videoPrompt).not.toMatch(/125%|向前推进|整幅平移|不缩放/);
      expect(compiled.imagePrompt).not.toContain(`${scalePercent}%`);
      expect(compiled.videoPrompt.length).toBeLessThan(500);
    },
  );

  it.each([false, undefined])(
    'rejects camera control when the trusted support flag is %s',
    (support) => {
      const { request, result } = fixture();
      request.context.supportsMotionEndpoints = support;
      result.generationPlan!.cameraControl = {
        type: 'translate',
        direction: 'right',
        displacementPercent: 2,
      };
      expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
        'CAMERA_ENDPOINT_UNSUPPORTED',
      );
      expect(() => compileNativeVideoPlan(result, request)).toThrow('CAMERA_ENDPOINT_UNSUPPORTED');
    },
  );

  it.each(['generated', 'legacy', 'general'] as const)(
    'rejects controlled motion for a %s scene rather than changing its rendering path',
    (kind) => {
      const { request, result } = fixture();
      request.context.supportsMotionEndpoints = true;
      result.generationPlan!.cameraControl = {
        type: 'translate',
        direction: 'left',
        displacementPercent: 2,
      };
      if (kind === 'generated') result.generationPlan!.firstFrame = { mode: 'generate' };
      if (kind === 'legacy') delete result.generationPlan!.firstFrame;
      if (kind === 'general') {
        result.brief.scope = 'general';
        result.brief.productMode = 'not-applicable';
        request.context.placement = result.brief.placement = 'general';
      }
      expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
        'CAMERA_REFERENCE_REQUIRED',
      );
      expect(() => compileNativeVideoPlan(result, request)).toThrow('CAMERA_REFERENCE_REQUIRED');
    },
  );

  it.each([
    { type: 'orbit', direction: 'right', displacementPercent: 2 },
    { type: 'translate', direction: 'up', displacementPercent: 2 },
    { type: 'translate', direction: 'right', displacementPercent: 0.9 },
    { type: 'translate', direction: 'right', displacementPercent: 3.1 },
    { type: 'zoom', scalePercent: 3 },
    { type: 'zoom', scalePercent: 100.9 },
    { type: 'zoom', scalePercent: 103.1 },
    { type: 'zoom', scalePercent: 103, direction: 'right' },
    { type: 'translate', direction: 'right', displacementPercent: 2, scalePercent: 103 },
  ])('rejects unsupported endpoint instructions %o', (cameraControl) => {
    const { request, result } = fixture();
    request.context.supportsMotionEndpoints = true;
    const raw = { ...result, generationPlan: { ...result.generationPlan, cameraControl } };
    expect(() => parseNativeIntentResponse(response(raw), request)).toThrow(
      'generationPlan.cameraControl',
    );
  });
});

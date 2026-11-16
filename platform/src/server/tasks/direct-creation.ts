import {
  creativeIntentResultSchema,
  type CreativeIntentRequest,
} from '../../contracts/creative-intent';
import type { JobInput } from '../../contracts/jobs';
import { nativeReferenceFrameIssue } from '../../contracts/native-plan';
import { AppError } from '../errors';

/** Deterministic attachment of selected evidence. No interpretation or model calls. */
export function compileDirectCreation(input: JobInput, request: CreativeIntentRequest) {
  const attachments = request.sourceTexts.filter((source) => source.id !== 'request');
  const memory = request.memoryContext?.items ?? [];
  const placementNames = {
    general: '通用创作',
    'main-image': '商品主图',
    'secondary-image': '商品副图',
    'detail-image': '商品详情图',
    'product-video': '商品视频',
    'social-image': '社交图片',
    'social-video': '社交视频',
    'ad-image': '广告图片',
    'ad-video': '广告视频',
  };
  const prompt = [
    input.prompt,
    ...(request.context.platform && request.context.platform !== '通用电商'
      ? [`已选发布平台：${request.context.platform}`]
      : []),
    ...(request.context.placement !== 'general'
      ? [`已选素材用途：${placementNames[request.context.placement]}`]
      : []),
    ...(request.context.market ? [`已选市场：${request.context.market}`] : []),
    ...attachments.map((source) => `已选资料（${source.id}）：\n${source.text}`),
    ...(memory.length
      ? [
          '个人偏好仅用于创作风格，不作为商品事实；本次明确需求优先。',
          ...memory.map((item) => `${item.topic}：${item.content}`),
        ]
      : []),
    input.options.needText
      ? `画面文字语言：${input.options.language}。`
      : '画面不添加文字、字幕或水印。',
  ].join('\n\n');
  if (prompt.length > 11000)
    throw new AppError(
      400,
      'CREATIVE_PROMPT_LIMIT',
      '原始需求与已选资料超过直接生成范围，请精简后重试；内容不会被截断。',
    );
  const video = input.operation === 'video.generate';
  const images = request.materials.filter(
    (item) => item.kind === 'image' && ['input', 'reference'].includes(item.role),
  );
  const reference =
    images.length === 1 &&
    !nativeReferenceFrameIssue(
      {
        width: images[0]!.width ?? null,
        height: images[0]!.height ?? null,
        byteSize: images[0]!.byteSize ?? 0,
      },
      input.options.ratio,
    )
      ? images[0]
      : undefined;
  const nativePlan: JobInput['nativePlan'] =
    video && input.providerId === 'native'
      ? {
          imagePrompt: prompt,
          videoPrompt: prompt,
          firstFrame: reference
            ? { mode: 'reference', assetId: reference.id }
            : { mode: 'generate' },
        }
      : undefined;
  const product =
    Boolean(input.productId) ||
    ['main-image', 'secondary-image', 'detail-image', 'product-video'].includes(
      request.context.placement,
    );
  const previewPrompt =
    prompt.length <= 5000
      ? prompt
      : '按原始需求与已选资料直接生成；完整内容保存在本次输入和资料快照中。';
  const result = creativeIntentResultSchema.parse({
    type: 'intent-plan',
    version: 1,
    requestId: request.requestId,
    status: 'ready',
    brief: {
      scope: product ? 'product' : 'general',
      subject: '本次原始需求指定的内容',
      goal: '按原话与显式选择的资料直接生成',
      mediaType: request.context.mediaType,
      platform: request.context.platform,
      placement: request.context.placement,
      market: request.context.market,
      productMode: product
        ? images.length && request.context.supportsReference
          ? 'reference'
          : 'concept'
        : 'not-applicable',
      facts: [],
      constraints: [],
    },
    summary: nativePlan
      ? reference
        ? '思考模式已关闭：保留所选图片作为首帧，直接调用视频模型，不调用文本模型。'
        : '思考模式已关闭：按原话与已选资料生成首帧，再调用视频模型；费用包含首帧，不调用文本模型。'
      : '思考模式已关闭：将原始需求与已选资料直接交给生成模型，不调用文本模型。',
    assumptions: [],
    questions: [],
    prompt: previewPrompt,
    ...(nativePlan
      ? {
          generationPlan: {
            imagePrompt: previewPrompt,
            videoPrompt: previewPrompt,
            firstFrame: nativePlan.firstFrame,
          },
        }
      : {}),
    reviewChecklist: [],
  });
  return { prompt, result, nativePlan };
}

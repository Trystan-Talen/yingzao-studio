import { z } from 'zod';
import { nativeCameraControlSchema, nativeFirstFrameSchema } from './native-plan';
import { nativeImageEditSchema } from './native-image-edit';
import { nativeReplicaSchema } from './native-replica';

/** Shared by the strict result contract and native planner instructions. */
export const CREATIVE_INTENT_LIMITS = {
  subject: 300,
  goal: 500,
  platform: 80,
  market: 20,
  facts: 16,
  sourceId: 100,
  quote: 500,
  constraints: 8,
  constraint: 300,
  summary: 800,
  assumptions: 5,
  assumption: 240,
  questions: 2,
  questionId: 60,
  question: 240,
  reason: 240,
  options: 3,
  option: 100,
  prompt: 5000,
  reviewChecklist: 6,
  reviewItem: 240,
} as const;
const limits = CREATIVE_INTENT_LIMITS;

export const CREATIVE_PLACEMENTS = [
  'general',
  'main-image',
  'secondary-image',
  'detail-image',
  'product-video',
  'social-image',
  'social-video',
  'ad-image',
  'ad-video',
] as const;
export const creativePlacementSchema = z.enum(CREATIVE_PLACEMENTS);
export type CreativePlacement = z.infer<typeof creativePlacementSchema>;
/** Preserve an explicit use; only map legacy choices with an unambiguous meaning. */
export function resolveCreativePlacement(input: {
  mediaType: 'image' | 'video';
  kind?: string;
  placement?: CreativePlacement;
}): CreativePlacement {
  if (input.placement && input.placement !== 'general') return input.placement;
  if (input.mediaType === 'video') {
    if (input.kind === 'product') return 'product-video';
    if (input.kind === 'social') return 'social-video';
    if (input.kind === 'brand') return 'ad-video';
  }
  if (input.mediaType === 'image' && input.kind === 'detail') return 'detail-image';
  return 'general';
}
export const creativeAnswerSchema = z
  .object({
    questionId: z.string().min(1).max(60),
    answer: z.string().trim().min(1).max(2000),
  })
  .strict();
export const creativeQuestionSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .max(limits.questionId),
    field: z.enum(['subject', 'reference', 'conflict', 'claim', 'delivery', 'capability']),
    question: z.string().trim().min(1).max(limits.question),
    reason: z.string().trim().min(1).max(limits.reason),
    options: z.array(z.string().trim().min(1).max(limits.option)).max(limits.options),
  })
  .strict();
export const creativeContextSourceSchema = z
  .object({
    kind: z.enum(['brand', 'product', 'memory']),
    id: z.string().uuid(),
    label: z.string().min(1).max(300),
    version: z.number().int().positive().optional(),
    updatedAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    content: z.string().max(20000),
  })
  .strict();
export const creativeMemoryContextSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            topic: z.string().min(1).max(80),
            kind: z.enum(['profile', 'preference', 'temporary']),
            content: z.string().min(1).max(2000),
            version: z.number().int().positive(),
            updatedAt: z.string().datetime(),
            confirmedAt: z.string().datetime().optional(),
            expiresAt: z.string().datetime().nullable().optional(),
            halfLifeDays: z.number().int().min(1).max(3650).nullable().optional(),
            weight: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(8),
    omitted: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) => value.items.reduce((sum, item) => sum + item.content.length, 0) <= 6000,
    '本次记忆上下文过长',
  );
export const creativeIntentRequestSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().uuid(),
    rawPrompt: z.string().trim().min(1).max(12000),
    sourceTexts: z
      .array(z.object({ id: z.string().min(1).max(100), text: z.string().max(20000) }).strict())
      .max(16),
    previousSummary: z.string().max(2000).optional(),
    answers: z.array(creativeAnswerSchema).max(12),
    materials: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().max(300),
            kind: z.enum(['image', 'video', 'audio', 'document']),
            role: z.enum(['reference', 'input', 'background', 'audio', 'mask']),
            width: z.number().int().positive().optional(),
            height: z.number().int().positive().optional(),
            byteSize: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(40),
    context: z
      .object({
        mediaType: z.enum(['image', 'video']),
        platform: z.string().max(80),
        placement: creativePlacementSchema,
        market: z.string().max(20).optional(),
        language: z.string().max(30),
        count: z.number().int().min(1).max(20),
        ratio: z.string().max(20),
        resolution: z.string().max(20),
        duration: z.number().optional(),
        supportsReference: z.boolean(),
        supportsMotionEndpoints: z.boolean().optional(),
        supportsBackgroundMask: z.boolean().optional(),
        imageEditSize: z
          .object({ width: z.number().int().positive(), height: z.number().int().positive() })
          .strict()
          .optional(),
        videoOutputSize: z
          .object({ width: z.number().int().positive(), height: z.number().int().positive() })
          .strict()
          .optional(),
        supportsAudio: z.boolean(),
        supportsText: z.boolean(),
      })
      .strict(),
    strategy: z.object({ id: z.string().max(160), guidance: z.string().max(16000) }).strict(),
    replica: nativeReplicaSchema.optional(),
    memoryContext: creativeMemoryContextSchema.optional(),
    contextSources: z.array(creativeContextSourceSchema).max(10).optional(),
  })
  .strict();
const strictCreativeIntentResultSchema = z
  .object({
    type: z.literal('intent-plan'),
    version: z.literal(1),
    requestId: z.string().uuid(),
    status: z.enum(['ready', 'needs_clarification']),
    brief: z
      .object({
        scope: z.enum(['general', 'product']),
        subject: z.string().max(limits.subject),
        goal: z.string().max(limits.goal),
        mediaType: z.enum(['image', 'video']),
        platform: z.string().max(limits.platform),
        placement: creativePlacementSchema,
        market: z.string().max(limits.market).optional(),
        productMode: z.enum(['not-applicable', 'concept', 'reference']),
        facts: z
          .array(
            z
              .object({
                sourceId: z.string().min(1).max(limits.sourceId),
                quote: z.string().trim().min(1).max(limits.quote),
              })
              .strict(),
          )
          .max(limits.facts),
        constraints: z.array(z.string().min(1).max(limits.constraint)).max(limits.constraints),
      })
      .strict(),
    summary: z.string().trim().min(1).max(limits.summary),
    assumptions: z.array(z.string().min(1).max(limits.assumption)).max(limits.assumptions),
    questions: z.array(creativeQuestionSchema).max(limits.questions),
    prompt: z.string().max(limits.prompt),
    generationPlan: z
      .object({
        imagePrompt: z.string().trim().min(1).max(limits.prompt),
        videoPrompt: z.string().trim().min(1).max(limits.prompt),
        firstFrame: nativeFirstFrameSchema.optional(),
        cameraControl: nativeCameraControlSchema.optional(),
      })
      .strict()
      .optional(),
    imageEdit: nativeImageEditSchema.optional(),
    reviewChecklist: z.array(z.string().min(1).max(limits.reviewItem)).max(limits.reviewChecklist),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status === 'ready' &&
      (value.questions.length || !value.prompt.trim() || !value.brief.subject.trim())
    )
      ctx.addIssue({ code: 'custom', message: '需求就绪时须有主体及创作说明，且没有待回答问题' });
    if (value.status === 'needs_clarification' && !value.questions.length)
      ctx.addIssue({ code: 'custom', message: '需要补充时必须提供关键问题' });
    if (value.status === 'needs_clarification' && value.prompt.trim())
      ctx.addIssue({ code: 'custom', message: '待补充需求不能携带可执行提示词' });
    if (value.generationPlan && (value.status !== 'ready' || value.brief.mediaType !== 'video'))
      ctx.addIssue({ code: 'custom', message: '首帧与运镜方案仅用于已就绪的视频创作' });
    if (value.imageEdit && (value.status !== 'ready' || value.brief.mediaType !== 'image'))
      ctx.addIssue({ code: 'custom', message: '局部背景方案仅用于已就绪的图片创作' });
    if (new Set(value.questions.map((q) => q.id)).size !== value.questions.length)
      ctx.addIssue({ code: 'custom', message: '问题编号不可重复' });
  });

/** A ready plan has no unanswered questions; normalize only the absent field, never invalid data. */
export const creativeIntentResultSchema = z.preprocess((value) => {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'status' in value &&
    value.status === 'ready' &&
    !Object.hasOwn(value, 'questions')
  )
    return { ...value, questions: [] };
  return value;
}, strictCreativeIntentResultSchema);

export type CreativeIntentRequest = z.infer<typeof creativeIntentRequestSchema>;
export type CreativeIntentResult = z.infer<typeof creativeIntentResultSchema>;
export type CreativeAnswer = z.infer<typeof creativeAnswerSchema>;

/** Validate evidence and executable boundaries, independently of the model's confidence. */
export function validateCreativeIntent(
  result: CreativeIntentResult,
  request: CreativeIntentRequest,
): void {
  if (result.requestId !== request.requestId) throw new Error('需求结果与本次请求不一致');
  for (const fact of result.brief.facts) {
    const source = request.sourceTexts.find((item) => item.id === fact.sourceId);
    if (!source?.text.includes(fact.quote)) throw new Error('商品事实缺少可核对的原文依据');
  }
  if (result.status !== 'ready') return;
  if (
    request.context.platform &&
    request.context.platform !== '通用电商' &&
    result.brief.platform !== request.context.platform
  )
    throw new Error('需求不能静默改变已选平台');
  if (
    request.context.placement !== 'general' &&
    result.brief.placement !== request.context.placement
  )
    throw new Error('需求不能静默改变已选素材用途');
  if (request.context.market && result.brief.market !== request.context.market)
    throw new Error('需求不能静默改变已选市场');
  if (result.brief.mediaType !== request.context.mediaType)
    throw new Error('需求交付类型与当前图片或视频入口不一致');
  if (result.brief.productMode === 'reference') {
    if (
      !request.materials.some(
        (item) => item.kind === 'image' && ['reference', 'input'].includes(item.role),
      )
    )
      throw new Error('保持实物外观需要商品参考图');
    if (!request.context.supportsReference) throw new Error('当前生成能力不能使用商品参考图');
  }
  if (result.brief.scope === 'general' && result.brief.productMode !== 'not-applicable')
    throw new Error('通用创意不能附加商品保真条件');
  if (result.brief.scope === 'product' && result.brief.productMode === 'not-applicable')
    throw new Error('商品创作须明确概念或实物参考方式');
  if (
    ['main-image', 'secondary-image', 'detail-image', 'product-video'].includes(
      result.brief.placement,
    ) &&
    result.brief.scope !== 'product'
  )
    throw new Error('商品素材用途须按商品创作处理');
}

export interface CreativePreparation {
  contextSources?: z.infer<typeof creativeContextSourceSchema>[];
  omittedMemoryCount?: number;
  referenceStudy?: import('./reference-study').ReferenceStudyResult;
  id: string;
  status: 'ready' | 'needs_clarification';
  result: CreativeIntentResult;
  /** Generation input includes only a server-issued brief ID; the user's wording stays intact. */
  input: import('./jobs').JobInput;
}

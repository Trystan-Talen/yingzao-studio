import { z } from 'zod';

export const DETAIL_PAGE_DEFAULT_SCREENS = 6;
export const DETAIL_PAGE_MAX_SCREENS = 10;
// Two planning stages may each return 12 distinct unknowns; preserve both without truncation.
export const DETAIL_PAGE_MAX_UNKNOWNS = 24;
export const detailPageRatioSchema = z.enum(['3:4', '2:3', '9:16']);
const sentence = z.string().trim().min(1).max(500);
export const detailPageScreenSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/),
    title: z.string().trim().min(1).max(80),
    purpose: z.string().trim().min(1).max(300),
    copy: z.array(z.string().trim().min(1).max(150)).max(4),
    prompt: z.string().trim().min(1).max(1000),
    ratio: detailPageRatioSchema,
  })
  .strict();
export const detailPagePlanSchema = z
  .object({
    productName: z.string().trim().min(1).max(120),
    productFacts: z.array(sentence).min(1).max(12),
    audience: sentence,
    visualStyle: sentence,
    palette: z.array(z.string().trim().min(1).max(60)).min(1).max(6),
    consistencyNotes: sentence,
    unknowns: z.array(sentence).max(DETAIL_PAGE_MAX_UNKNOWNS),
    screens: z.array(detailPageScreenSchema).min(2).max(DETAIL_PAGE_MAX_SCREENS),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (new Set(plan.screens.map((screen) => screen.id)).size !== plan.screens.length)
      ctx.addIssue({ code: 'custom', path: ['screens'], message: '每屏编号必须唯一' });
  });
export const detailPagePlanResultSchema = z
  .object({
    type: z.literal('detail-page-plan'),
    version: z.literal(1),
    plan: detailPagePlanSchema,
  })
  .strict();
export const detailPageBriefSchema = z
  .object({
    brief: z.string().trim().min(1).max(5000),
    screenCount: z.number().int().min(2).max(DETAIL_PAGE_MAX_SCREENS).default(6),
    ratio: detailPageRatioSchema.default('3:4'),
    projectId: z.string().uuid().optional(),
    capabilityRevision: z.string().uuid().optional(),
  })
  .strict();
export const detailPageConfirmationSchema = z
  .object({
    plan: detailPagePlanSchema,
    resolution: z.enum(['2K', '3K', '4K']).optional(),
    referenceAssetIds: z.array(z.string().uuid()).min(1).max(4),
    projectId: z.string().uuid().optional(),
    planningJobId: z.string().uuid().optional(),
    capabilityRevision: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((confirmation, ctx) => {
    if (new Set(confirmation.referenceAssetIds).size !== confirmation.referenceAssetIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['referenceAssetIds'],
        message: '商品参考图片不能重复',
      });
  });

export type DetailPageScreen = z.infer<typeof detailPageScreenSchema>;
export type DetailPagePlan = z.infer<typeof detailPagePlanSchema>;
export type DetailPagePlanResult = z.infer<typeof detailPagePlanResultSchema>;
export type DetailPageBrief = z.infer<typeof detailPageBriefSchema>;
export type DetailPageConfirmation = z.infer<typeof detailPageConfirmationSchema>;

export function formatDetailPagePlan(plan: DetailPagePlan): string {
  return [
    `商品详情页方案（待确认）：${plan.productName}`,
    '本次仅生成策划，未提交图片生成。策划依据用户文字事实，尚未分析商品参考图。',
    `商品事实：\n${plan.productFacts.map((fact) => `- ${fact}`).join('\n')}`,
    `目标人群：${plan.audience}`,
    `统一视觉：${plan.visualStyle}；配色：${plan.palette.join(' / ')}`,
    `一致性要求：${plan.consistencyNotes}`,
    ...plan.screens.map(
      (screen, index) =>
        `${index + 1}. ${screen.title}（${screen.ratio}）\n目的：${screen.purpose}\n文案：${screen.copy.join('；') || '不添加文字'}\n画面：${screen.prompt}`,
    ),
    `待核对：${plan.unknowns.join('；') || '请逐屏核对文案与商品事实，再确认整套报价。'}`,
  ].join('\n\n');
}

import { z } from 'zod';
import {
  detailPagePlanSchema,
  detailPageRatioSchema,
  type DetailPagePlan,
} from '../../contracts/detail-page';
import { jobInputSchema } from '../../contracts/jobs';

// Incomplete edits are recoverable drafts; the strict shared plan is checked before pricing.
const editablePlanSchema = z.object({
  productName: z.string(),
  productFacts: z.array(z.string()),
  audience: z.string(),
  visualStyle: z.string(),
  palette: z.array(z.string()),
  consistencyNotes: z.string(),
  unknowns: z.array(z.string()),
  screens: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        purpose: z.string(),
        copy: z.array(z.string()),
        prompt: z.string(),
        ratio: detailPageRatioSchema,
      }),
    )
    .max(10),
});
export const detailPageDraftSchema = z.object({
  version: z.literal(1),
  brief: z.string().max(5000),
  screenCount: z.number().int().min(2).max(10),
  ratio: detailPageRatioSchema,
  resolution: z.enum(['2K', '3K', '4K']).optional(),
  referenceAssetIds: z.array(z.string().uuid()).max(4),
  projectId: z.string().uuid().optional(),
  planningJobId: z.string().uuid().optional(),
  generationJobId: z.string().uuid().optional(),
  adoptedPlanningJobId: z.string().uuid().optional(),
  recoveredPlanMessageId: z.string().uuid().optional(),
  plan: editablePlanSchema.nullable(),
  confirmedScreens: z.array(z.string()),
  factsConfirmed: z.boolean(),
});
export type DetailPageDraft = z.infer<typeof detailPageDraftSchema>;
export const emptyDetailPageDraft = (): DetailPageDraft => ({
  version: 1,
  brief: '',
  screenCount: 6,
  ratio: '3:4',
  referenceAssetIds: [],
  plan: null,
  confirmedScreens: [],
  factsConfirmed: false,
});
export function detailPageDraftKey(userId: string, workspaceId: string, projectId?: string) {
  return `yingzao:detail-page:v1:${userId}:${workspaceId}:${projectId ?? 'new'}`;
}
export function readDetailPageDraft(storage: Pick<Storage, 'getItem'>, key: string) {
  try {
    const raw = storage.getItem(key);
    return {
      draft: raw ? detailPageDraftSchema.parse(JSON.parse(raw)) : emptyDetailPageDraft(),
      error: null,
    };
  } catch {
    return {
      draft: emptyDetailPageDraft(),
      error: '本机详情页草稿暂时无法恢复，请先检查浏览器存储。已有任务仍保存在项目中。',
    };
  }
}
export function updateDetailPageScreen(
  plan: DetailPagePlan,
  id: string,
  patch: Partial<DetailPagePlan['screens'][number]>,
): DetailPagePlan {
  return {
    ...plan,
    screens: plan.screens.map((screen) =>
      screen.id === id ? { ...screen, ...patch, id: screen.id } : screen,
    ),
  };
}

export const RECOVERED_DETAIL_PLAN_NOTE = '本机恢复校验：沿用原策划结果，未重新调用模型。';
const recoveredMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.literal('user'),
  createdAt: z.string(),
  metadata: z.object({ draft: jobInputSchema, creationWarnings: z.array(z.string()) }),
});
export interface RecoveredDetailPlan {
  messageId: string;
  plan: DetailPagePlan;
  createdAt: string;
}
export function recoveredDetailPagePlan(
  messages: unknown[],
  projectId: string,
  expected?: { screenCount?: number; ratio?: string },
): RecoveredDetailPlan | null {
  const candidates: RecoveredDetailPlan[] = [];
  for (const value of messages) {
    const message = recoveredMessageSchema.safeParse(value);
    if (
      !message.success ||
      message.data.metadata.draft.projectId !== projectId ||
      !message.data.metadata.creationWarnings.includes(RECOVERED_DETAIL_PLAN_NOTE)
    )
      continue;
    const result = detailPagePlanSchema.safeParse(
      message.data.metadata.draft.options.detailPagePlan,
    );
    if (
      !result.success ||
      (expected?.screenCount !== undefined &&
        result.data.screens.length !== expected.screenCount) ||
      (expected?.ratio !== undefined &&
        result.data.screens.some((screen) => screen.ratio !== expected.ratio))
    )
      continue;
    candidates.push({
      messageId: message.data.id,
      plan: result.data,
      createdAt: message.data.createdAt,
    });
  }
  return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
export function adoptRecoveredDetailPagePlan(
  draft: DetailPageDraft,
  recovered: RecoveredDetailPlan,
): DetailPageDraft {
  return {
    ...draft,
    plan: recovered.plan,
    recoveredPlanMessageId: recovered.messageId,
    adoptedPlanningJobId: undefined,
    confirmedScreens: [],
    factsConfirmed: false,
  };
}

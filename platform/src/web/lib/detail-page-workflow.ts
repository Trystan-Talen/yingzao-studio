import { z } from 'zod';
import { detailPagePlanSchema, type DetailPagePlan } from '../../contracts/detail-page';
import type { DetailPageDraft } from './detail-page-draft';
import { t } from './i18n';

export type DetailPageStep = 0 | 1 | 2;
const editorSchema = z.object({
  step: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  resultMode: z.enum(['draft', 'result']),
  planBriefKey: z.string().nullable(),
  acceptedBriefKey: z.string().nullable(),
});
export type DetailPageEditorState = z.infer<typeof editorSchema>;

export function defaultDetailPageEditor(draft: DetailPageDraft): DetailPageEditorState {
  return {
    step: draft.generationJobId ? 2 : draft.plan || draft.planningJobId ? 1 : 0,
    resultMode: draft.generationJobId ? 'result' : 'draft',
    planBriefKey: null,
    acceptedBriefKey: null,
  };
}

// Keep editor metadata in the same atomic draft write; old drafts remain valid.
export function readDetailPageEditor(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  draft: DetailPageDraft,
): DetailPageEditorState {
  try {
    const raw = storage.getItem(key);
    const parsed = editorSchema.safeParse(raw ? JSON.parse(raw).editor : null);
    if (!parsed.success) return defaultDetailPageEditor(draft);
    const editor = parsed.data;
    if (editor.step === 2 && !draft.generationJobId && !draft.plan)
      return defaultDetailPageEditor(draft);
    if (editor.step === 1 && !draft.plan && !draft.planningJobId)
      return defaultDetailPageEditor(draft);
    return editor;
  } catch {
    return defaultDetailPageEditor(draft);
  }
}

export function detailPageBriefKey(input: {
  brief: string;
  screenCount: number;
  ratio: string;
}): string {
  return JSON.stringify([input.brief.trim(), input.screenCount, input.ratio]);
}

export function isDetailPagePlanOutdated(
  currentBriefKey: string,
  planBriefKey: string | null,
  acceptedBriefKey: string | null,
): boolean {
  return !!planBriefKey && planBriefKey !== currentBriefKey && acceptedBriefKey !== currentBriefKey;
}

export function detailPageStepAvailable(
  step: DetailPageStep,
  state: { hasPlan: boolean; hasPlanning: boolean; hasResult: boolean; readyToGenerate: boolean },
): boolean {
  if (step === 0) return true;
  if (step === 1) return state.hasPlan || state.hasPlanning;
  return state.hasResult || state.readyToGenerate;
}

export interface DetailPageFieldIssue {
  field: string;
  screenId?: string;
  screenIndex?: number;
  label: string;
  message: string;
}
const fieldLabels: Record<string, string> = {
  productName: '商品名称',
  productFacts: '商品事实',
  audience: '目标人群',
  visualStyle: '视觉风格',
  palette: '配色',
  consistencyNotes: '各屏一致性要求',
  unknowns: '待核对信息',
  screens: '分屏列表',
  id: '分屏编号',
  title: '分屏标题',
  purpose: '这一屏的任务',
  copy: '画面文案',
  prompt: '画面与构图要求',
  ratio: '单屏比例',
};

export function detailPageFieldIssues(plan: DetailPagePlan | null): DetailPageFieldIssue[] {
  if (!plan) return [];
  const parsed = detailPagePlanSchema.safeParse(plan);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const screenIndex =
      issue.path[0] === 'screens' && typeof issue.path[1] === 'number' ? issue.path[1] : undefined;
    const field = String(issue.path[screenIndex === undefined ? 0 : 2] ?? 'screens');
    const rowIndex = issue.path[screenIndex === undefined ? 1 : 3];
    const label = `${t(fieldLabels[field] ?? '内容')}${typeof rowIndex === 'number' ? t('第 {count} 行').replace('{count}', String(rowIndex + 1)) : ''}`;
    let message = t('请检查此项内容。');
    if (issue.code === 'too_small') {
      message =
        issue.origin === 'array'
          ? t('至少填写 {count} 项。').replace('{count}', String(issue.minimum))
          : t('请填写内容，不能只包含空格。');
    } else if (issue.code === 'too_big') {
      message =
        issue.origin === 'array'
          ? t('最多 {count} 项，请删除多余内容。').replace('{count}', String(issue.maximum))
          : t('最多 {count} 个字符，请缩短内容。').replace('{count}', String(issue.maximum));
    } else if (field === 'ratio') message = t('请选择 3:4、2:3 或 9:16。');
    else if (issue.code === 'custom') message = t(issue.message);
    else if (field === 'id') message = t('分屏编号无效，请删除此屏后重新添加。');
    return {
      field,
      ...(screenIndex === undefined
        ? {}
        : { screenIndex, screenId: plan.screens[screenIndex]?.id }),
      label,
      message,
    };
  });
}

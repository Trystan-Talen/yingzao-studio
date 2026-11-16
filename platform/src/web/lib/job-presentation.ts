import type { Job, JobInput } from './tasks';
import { t } from './i18n';

/** Receipts describe the submitted snapshot, never the currently edited draft. */
export function jobInputSummary(input: Pick<JobInput, 'prompt' | 'options'>): string {
  const compact = (text: string) => {
    const characters = Array.from(text.replace(/\s+/g, ' ').trim());
    return characters.length > 100 ? `${characters.slice(0, 100).join('')}…` : characters.join('');
  };
  const plan = input.options.detailPagePlan;
  if (plan) {
    const ratios = [...new Set(plan.screens.map((screen) => screen.ratio))].join(' / ');
    return `${compact(plan.productName)} · ${plan.screens.length} ${t('屏详情页')} · ${ratios}`;
  }
  return compact(input.prompt) || t('创作任务');
}

export interface JobPresentation {
  title: string;
  description: string;
  step: number | null;
  tone: 'active' | 'success' | 'warning' | 'error' | 'neutral';
  animated: boolean;
  canResume: boolean;
  resumeLabel: string;
}

/** Display only server-confirmed stages. Elapsed time never implies progress. */
export function presentJob(job: Job): JobPresentation {
  const pending = job.items.filter(
    (item) => !['succeeded', 'cancelled', 'failed'].includes(item.status),
  );
  const resumable = job.items.filter((item) => item.canResume);
  const saving =
    pending.some((item) => item.phase === 'downloading') ||
    resumable.some((item) => item.phase === 'downloading' || !item.remoteId);
  const querying =
    pending.some((item) => item.phase === 'polling') || resumable.some((item) => !!item.remoteId);
  const recovering = pending.some((item) => !!item.nextRetryAt);
  const base: JobPresentation = {
    title: '',
    description: '',
    step: null,
    tone: 'neutral',
    animated: false,
    canResume: resumable.length > 0,
    resumeLabel: saving ? '恢复保存作品' : '继续查询结果',
  };
  if (base.canResume)
    return {
      ...base,
      title: saving ? '已收到生成结果，保存已暂停' : '任务已受理，查询已暂停',
      description: saving
        ? '继续获取并保存已有结果，不会再次调用模型生成。'
        : '继续查询原任务，不会创建新的生成任务。',
      tone: 'warning',
      step: saving ? 2 : 1,
    };
  if (job.status === 'reconciliation_required')
    return {
      ...base,
      title: '执行结果需要核对',
      description: '尚无法确认最终结果。请先核对原任务，避免重复生成。',
      tone: 'warning',
    };
  if (job.status === 'succeeded')
    return {
      ...base,
      title: job.operation === 'text.assist' ? '创作建议已就绪' : '作品已保存',
      description: '结果已保存，可以预览、下载或继续创作。',
      step: 3,
      tone: 'success',
    };
  if (job.status === 'failed')
    return {
      ...base,
      title: '这次创作未完成',
      description: '需求和参数仍然保留。检查原因后，可编辑需求或重新确认费用再试。',
      tone: 'error',
    };
  if (job.status === 'partial')
    return {
      ...base,
      title: '部分作品已完成',
      description: '成功作品已保留，其余条目的原因与处理方式见下方。',
      tone: 'warning',
    };
  if (job.status === 'cancelled')
    return { ...base, title: '任务已取消', description: '创作需求仍然保留，可调整后重新提交。' };
  if (job.status === 'queued')
    return {
      ...base,
      title: '任务已提交，等待执行器',
      description:
        job.providerId === 'local'
          ? '已保存在本机队列，尚未开始处理素材。无需重复提交。'
          : '已保存在本机队列，尚未开始生成。无需重复提交。',
      step: 0,
      tone: 'active',
      animated: true,
    };
  if (recovering)
    return {
      ...base,
      title: saving ? '连接中断，正在恢复保存' : '连接中断，正在恢复查询',
      description: '系统会继续处理原任务，无需重新提交。',
      step: saving ? 2 : querying ? 1 : 0,
      tone: 'warning',
      animated: true,
    };
  if (saving)
    return {
      ...base,
      title: '已收到生成结果，正在保存',
      description: '正在下载原始文件并校验，保存完成后会自动显示。',
      step: 2,
      tone: 'active',
      animated: true,
    };
  if (job.providerId === 'local')
    return {
      ...base,
      title: '正在处理素材',
      description: '处理完成后会自动显示结果。',
      step: 1,
      tone: 'active',
      animated: true,
    };
  return {
    ...base,
    title: querying ? '任务已受理，正在查询进度' : '正在请求创作服务',
    description: '结果返回后会继续保存，实际等待时间取决于服务商。',
    step: 1,
    tone: 'active',
    animated: true,
  };
}

export function elapsedJobSeconds(createdAt: string, now: number): number | null {
  const start = Date.parse(createdAt);
  return Number.isFinite(start) && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - start) / 1000))
    : null;
}

export function elapsedLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
}

/** Status-filtered requests can overlap during a transition; newest evidence wins. */
export function mergeJobSnapshots(...groups: Job[][]): Job[] {
  const jobs = new Map<string, Job>();
  for (const job of groups.flat()) {
    const existing = jobs.get(job.id);
    if (!existing || job.updatedAt >= existing.updatedAt) jobs.set(job.id, job);
  }
  return [...jobs.values()];
}

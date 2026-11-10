import type { ItemRow } from './types';

/** A recovery target must already exist; this never authorizes another generation. */
export function recoverablePhase(item: ItemRow): 'downloading' | 'polling' | null {
  if (item.result_json) {
    try {
      const value = JSON.parse(item.result_json);
      const outputs = Array.isArray(value) ? value : value?.outputs;
      if (
        Array.isArray(outputs) &&
        outputs.length &&
        outputs.every(
          (output) =>
            output &&
            typeof output === 'object' &&
            (typeof output.url === 'string' ||
              typeof output.path === 'string' ||
              typeof output.text === 'string' ||
              output.resultData),
        )
      )
        return 'downloading';
    } catch {
      /* Invalid cached data is not permission to resubmit. */
    }
  }
  if (item.remote_id && item.remote_json) {
    try {
      const remote = JSON.parse(item.remote_json);
      if (remote && typeof remote.id === 'string' && remote.id === item.remote_id) return 'polling';
    } catch {
      /* Preserve the original task for manual reconciliation. */
    }
  }
  return null;
}

export function taskStage(item: ItemRow): string {
  const phase = item.phase === 'uncertain' ? recoverablePhase(item) : item.phase;
  if (item.status === 'reconciliation_required') {
    if (recoverablePhase(item) === 'downloading')
      return '结果已生成，自动保存已暂停，可恢复已有结果';
    if (recoverablePhase(item) === 'polling') return '远程任务已保留，自动查询已暂停，可恢复查询';
    return '提交结果尚未确认，需核对服务商记录，不能重复生成';
  }
  if (item.recovery_failures > 0 && ['polling', 'downloading'].includes(phase || '')) {
    const action = phase === 'downloading' ? '保存结果' : '查询远程任务';
    return item.lease_owner
      ? `正在恢复${action}（第 ${item.recovery_failures} 次），不会重新生成`
      : `${action}暂时中断，等待自动恢复（${item.recovery_failures}/10），不会重新生成`;
  }
  if (phase === 'downloading') return '结果已生成，正在下载并保存';
  if (phase === 'polling') return '任务已受理，正在查询进度';
  if (phase === 'submitting') return '请求已发送，等待模型返回，勿重复提交';
  return item.status === 'queued' ? '等待处理' : '准备素材';
}

export function currentJobStage(items: ItemRow[], fallback: string): string {
  const item =
    items.find((i) => i.status === 'reconciliation_required') ||
    items.find((i) => i.status === 'running');
  if (!item) return fallback;
  if (
    item.status === 'running' &&
    item.phase === 'polling' &&
    !item.recovery_failures &&
    fallback &&
    !['准备素材', '正在处理', '等待处理', '需要核对服务商结果'].includes(fallback)
  )
    return fallback;
  return taskStage(item);
}

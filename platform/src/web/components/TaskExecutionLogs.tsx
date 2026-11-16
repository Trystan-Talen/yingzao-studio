import { useState } from 'react';
import type { TaskExecutionLogsDto } from '../../contracts/task-execution';
import { dateTime, useApi } from '../lib/api';
import { t } from '../lib/i18n';
import { statusLabels } from '../lib/tasks';
import { Badge, Button, ErrorState, Loading, Notice, Pagination } from './ui';
import '../styles/task-execution-logs.css';

const resultLabels: Record<string, string> = {
  started: '请求开始',
  succeeded: '响应成功',
  submitted: '上游已受理',
  running: '上游处理中',
  rejected: '明确拒绝',
  uncertain: '结果待核对',
  failed: '调用失败',
};
const phaseLabels: Record<string, string> = {
  queued: '等待领取',
  submitting: '正在提交',
  polling: '查询上游状态',
  downloading: '下载产物',
  processing: '本机处理',
  committing: '保存结果',
  done: '已结束',
  uncertain: '结果待核对',
};
const executionLabels: Record<string, string> = {
  started: '执行开始',
  succeeded: '任务完成',
  running: '当前阶段结束',
  failed: '执行结束',
  uncertain: '结果待核对',
};
const plannerLabels: Record<string, string> = {
  started: '规划开始',
  succeeded: '规划已保存',
  failed: '规划失败',
  uncertain: '规划结果待核对',
};

export function TaskExecutionLogs({ jobId, active }: { jobId: string; active: boolean }) {
  const [page, setPage] = useState(1);
  const query = useApi<TaskExecutionLogsDto>(
    `/jobs/${jobId}/execution-logs?page=${page}&pageSize=30`,
    active,
    active ? 5000 : undefined,
  );
  const data = query.data;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!data) return <Loading label={t('正在读取任务日志…')} />;
  return (
    <section className="task-execution-logs" aria-label={t('管理员任务日志')}>
      <div className="inline-actions">
        <strong>{t('任务执行记录')}</strong>
        <Button variant="ghost" busy={query.isFetching} onClick={() => void query.refetch()}>
          {t('刷新日志')}
        </Button>
        <span className="field-hint">
          {t('更新于')} {dateTime(data.generatedAt)}
        </span>
      </div>
      <Notice>{t(data.diagnosis)}</Notice>
      <dl className="detail-list">
        <div>
          <dt>{t('执行路径')}</dt>
          <dd>
            {t(
              data.providerId === 'native'
                ? '项目内编排，直接请求模型接口'
                : data.providerId === 'dify'
                  ? 'Dify（工作流服务）'
                  : data.providerId,
            )}
          </dd>
        </div>
        <div>
          <dt>{t('当前阶段')}</dt>
          <dd>{data.stage}</dd>
        </div>
        <div>
          <dt>{t('空间内待核对条目')}</dt>
          <dd>
            {data.waitingForReconciliation} {t('项；保留额度，不自动重新生成')}
          </dd>
        </div>
      </dl>
      {data.items.map((item) => (
        <details className="execution-item" key={item.id} open={data.items.length === 1}>
          <summary>
            {t('第')} {item.index + 1} {t('项')} · {t(statusLabels[item.status] ?? item.status)} ·{' '}
            {t(phaseLabels[item.phase] ?? item.phase)}
          </summary>
          <dl className="detail-list">
            <div>
              <dt>{t('条目编号')}</dt>
              <dd>{item.id}</dd>
            </div>
            <div>
              <dt>{t('执行器领取次数')}</dt>
              <dd>{item.attempts}</dd>
            </div>
            <div>
              <dt>{t('执行租约')}</dt>
              <dd>
                {t(item.leaseActive ? '已被执行器领取' : '当前无有效租约')}
                {item.leaseUntil ? ` · ${dateTime(item.leaseUntil)}` : ''}
              </dd>
            </div>
            <div>
              <dt>{t('上游任务编号')}</dt>
              <dd>{item.remoteId ?? t('未取得')}</dd>
            </div>
            <div>
              <dt>{t('恢复失败次数')}</dt>
              <dd>{item.recoveryFailures}</dd>
            </div>
            {item.errorMessage && (
              <div>
                <dt>{t('结果原因')}</dt>
                <dd>{item.errorMessage}</dd>
              </div>
            )}
            {item.status === 'running' && item.recoveryFailures > 0 && (
              <div>
                <dt>{t('下次核查')}</dt>
                <dd>{dateTime(item.nextAttemptAt)}</dd>
              </div>
            )}
          </dl>
          {!!item.upstreamMetadata && (
            <details>
              <summary>{t('已保存的上游任务元数据（已脱敏）')}</summary>
              <pre>{JSON.stringify(item.upstreamMetadata, null, 2)}</pre>
            </details>
          )}
        </details>
      ))}
      <h3>{t('资源调用记录')}</h3>
      <p className="field-hint">
        {t(
          '仅保留状态、请求编号、错误及用量等脱敏元数据，不保存接口密钥、请求素材或生成文件内容。历史任务未采集的响应不会补造。',
        )}
      </p>
      {!data.logs.length && (
        <p>
          {t('尚无调用记录。未领取的任务尚未请求上游；早于日志功能的任务可能没有历史调用详情。')}
        </p>
      )}
      {data.logs.map((log) => (
        <article className="execution-attempt" key={`${log.origin}-${log.id}`}>
          <div className="inline-actions">
            <strong>{log.resource?.name || t('服务调用')}</strong>
            <span className="field-hint">
              {t(log.origin === 'planning' ? '需求规划' : '任务执行')}
            </span>
            <Badge
              tone={
                ['failed', 'rejected'].includes(log.status)
                  ? 'red'
                  : log.status === 'uncertain'
                    ? 'orange'
                    : 'neutral'
              }
            >
              {t(
                (log.resource?.id === 'worker'
                  ? executionLabels
                  : log.resource?.id === 'planner'
                    ? plannerLabels
                    : resultLabels)[log.status] ?? log.status,
              )}
            </Badge>
            <time>{dateTime(log.createdAt)}</time>
          </div>
          <dl className="detail-list">
            <div>
              <dt>{t('动作')}</dt>
              <dd>
                {t(
                  log.action === 'poll'
                    ? '查询状态'
                    : log.action === 'cancel'
                      ? '申请取消'
                      : '提交请求',
                )}
                {log.stage ? ` · ${log.stage}` : ''}
              </dd>
            </div>
            {log.resource?.baseUrl && (
              <div>
                <dt>{t('资源地址')}</dt>
                <dd>{log.resource.baseUrl}</dd>
              </div>
            )}
            {log.resource?.model && (
              <div>
                <dt>{t('实际模型')}</dt>
                <dd>{log.resource.model}</dd>
              </div>
            )}
            {log.resource?.protocol && (
              <div>
                <dt>{t('接口协议')}</dt>
                <dd>{log.resource.protocol}</dd>
              </div>
            )}
            {log.httpStatus !== undefined && (
              <div>
                <dt>{t('HTTP（接口）状态码')}</dt>
                <dd>{log.httpStatus}</dd>
              </div>
            )}
            {log.durationMs !== undefined && (
              <div>
                <dt>{t('调用耗时')}</dt>
                <dd>
                  {(log.durationMs / 1000).toFixed(2)} {t('秒')}
                </dd>
              </div>
            )}
            {log.requestId && (
              <div>
                <dt>{t('上游请求编号')}</dt>
                <dd>{log.requestId}</dd>
              </div>
            )}
            {log.remoteId && (
              <div>
                <dt>{t('上游任务编号')}</dt>
                <dd>{log.remoteId}</dd>
              </div>
            )}
            {log.errorCode && (
              <div>
                <dt>{t('错误代码')}</dt>
                <dd>{log.errorCode}</dd>
              </div>
            )}
            {log.message && (
              <div>
                <dt>{t('结果原因')}</dt>
                <dd>{log.message}</dd>
              </div>
            )}
          </dl>
          {!!log.metadata && (
            <details>
              <summary>{t('上游返回元数据（已脱敏）')}</summary>
              <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
            </details>
          )}
        </article>
      ))}
      <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
      <details className="execution-item">
        <summary>{t('任务阶段记录（最近100条）')}</summary>
        {data.lifecycle.map((event) => (
          <div key={event.id}>
            <span>
              {dateTime(event.createdAt)} · {t(resultLabels[event.type] ?? event.type)}
            </span>
            <pre>{JSON.stringify(event.details, null, 2)}</pre>
          </div>
        ))}
      </details>
    </section>
  );
}

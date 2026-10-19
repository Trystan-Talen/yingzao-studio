import type { AssetDto } from '../../contracts/core';
import { ResultComparison } from './ResultComparison';
import { t } from '../lib/i18n';
import { OCRResultPanel } from './OCRResultPanel';
import { TaskReconcile } from './TaskReconcile';
import { useStudio } from '../context';
import { useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  dateTime,
  downloadFile,
  downloadPost,
  patch,
  post,
  qs,
  useApi,
  useRefresh,
  type Page,
} from '../lib/api';
import { operationName, statusLabels, type Job, type Quote } from '../lib/tasks';
import { AssetVisual } from './AssetPicker';
import { JobSubmit } from './JobSubmit';
import { designPlanResultSchema, type DesignPlan } from '../../contracts/design-plan';
import { DesignPlanResult } from './DesignPlanResult';
import {
  Badge,
  Button,
  Drawer,
  Field,
  Empty,
  ErrorState,
  Loading,
  Modal,
  Notice,
  Pagination,
  useAction,
} from './ui';
type AcceptPlan = (plan: DesignPlan, directionIndex: number) => void;
export function JobCard({
  job,
  onAcceptPlan,
  onAcceptAsset,
}: {
  job: Job;
  onAcceptPlan?: AcceptPlan;
  onAcceptAsset?: (asset: AssetDto) => void;
}) {
  const { isAdmin, session } = useStudio();
  const action = useAction();
  const refresh = useRefresh();
  const [detail, setDetail] = useState(false);
  const plans = new Map(
    job.items.flatMap((item) => {
      const result = designPlanResultSchema.safeParse(item.resultData);
      return result.success ? [[item.id, result.data.plan] as const] : [];
    }),
  );
  return (
    <article className="job-card">
      <div className="job-heading">
        <strong>{job.prompt || operationName(job.operation)}</strong>
        <Badge
          tone={
            job.status === 'succeeded'
              ? 'green'
              : job.status === 'failed'
                ? 'red'
                : job.status === 'reconciliation_required'
                  ? 'orange'
                  : 'neutral'
          }
        >
          {t(statusLabels[job.status] ?? job.status)}
        </Badge>
      </div>
      <p className="muted">
        {job.stage ? t(job.stage) : operationName(job.operation)} · {dateTime(job.createdAt)}
      </p>
      {job.errorMessage && <p className="field-error">{job.errorMessage}</p>}
      {job.outputAssets.length > 0 && (
        <div className="job-outputs">
          {job.outputAssets.map((asset) => (
            <button
              key={asset.id}
              onClick={() => setDetail(true)}
              aria-label={`${t('查看')} ${asset.name}`}
            >
              <AssetVisual asset={asset} />
            </button>
          ))}
        </div>
      )}
      <div className="job-footer">
        <span>
          {job.settledCredits} / {job.requestedCredits}
          {t('额度')}
        </span>
        <Button variant="ghost" onClick={() => setDetail(true)}>
          {t(plans.size ? '查看设计方案' : '查看详情')}
        </Button>
        {['queued', 'running'].includes(job.status) && (
          <Button
            variant="ghost"
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                await post(`/jobs/${job.id}/cancel`);
                await refresh();
              }, '已提交取消请求')
            }
          >
            <X size={14} />
            {t('取消')}
          </Button>
        )}
      </div>
      <Modal
        open={detail}
        onClose={() => setDetail(false)}
        title={t('任务详情')}
        description={`${t('任务')} ${job.id}`}
        wide
      >
        <dl className="detail-list">
          <div>
            <dt>{t('状态')}</dt>
            <dd>{t(statusLabels[job.status] ?? job.status)}</dd>
          </div>
          <div>
            <dt>{t('任务说明')}</dt>
            <dd>{job.prompt || t('未填写描述')}</dd>
          </div>
          <div>
            <dt>{t('已结算')}</dt>
            <dd>
              {job.settledCredits}
              {t('额度')}
            </dd>
          </div>
        </dl>
        {job.status === 'reconciliation_required' && (
          <Notice tone="warning">
            {t('服务请求结果尚未确认。系统会保留额度等待核对，避免重复生成和重复扣费。')}
            {isAdmin && <TaskReconcile job={job} />}
          </Notice>
        )}
        {!!plans.size && !onAcceptPlan && (
          <Notice>
            {job.projectId
              ? t('这里可查看、修改并复制方案。进入对应项目后，可从作品卡选择方向应用到创作草稿。')
              : t('这里可查看、修改并复制方案。此任务未关联项目，请将方案复制到新的创作草稿。')}
          </Notice>
        )}
        <div className="task-items">
          {job.items.map((item) => (
            <div key={item.id}>
              <span>
                {t('第')}
                {item.index + 1}
                {t('项')}
              </span>
              <Badge>{t(statusLabels[item.status] ?? item.status)}</Badge>
              {!!item.sourceAssetIds?.length && (
                <p className="field-hint">
                  {t('原图')}{' '}
                  {item.sourceAssetIds
                    .map((id) => `${job.input.assetIds.indexOf(id) + 1 || id.slice(-8)}`)
                    .join('、')}
                  {!!item.referenceAssetIds?.length &&
                    ` → ${t('参考')} ${item.referenceAssetIds.map((id) => `${job.input.referenceAssetIds.indexOf(id) + 1 || id.slice(-8)}`).join('、')}`}
                </p>
              )}
              {item.retryJobId && (
                <p className="field-hint">
                  {t('已建立重试任务')} · {item.retryJobId.slice(-8)}
                  {t('，不会从本项重复发起。')}
                </p>
              )}
              {item.retryable === true && <Badge tone="orange">{t('可重试')}</Badge>}
              {item.errorMessage && <p className="field-error">{item.errorMessage}</p>}
              {plans.has(item.id) ? (
                <DesignPlanResult
                  plan={plans.get(item.id)!}
                  onApply={
                    onAcceptPlan
                      ? (plan, direction) => {
                          onAcceptPlan(plan, direction);
                          setDetail(false);
                        }
                      : undefined
                  }
                />
              ) : item.resultText ? (
                <div className="task-text-result">
                  {job.operation === 'image.ocr' ? (
                    <OCRResultPanel text={item.resultText} jobId={job.id} itemId={item.id} />
                  ) : (
                    <pre>{item.resultText}</pre>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void action.run(
                        () => navigator.clipboard.writeText(item.resultText ?? ''),
                        '文本结果已复制',
                      )
                    }
                  >
                    {t('复制文本')}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {job.outputAssets.map((asset) => (
          <div className="result-detail" key={asset.id}>
            {asset.kind === 'video' ? (
              <video src={asset.originalUrl} controls />
            ) : (
              <img src={asset.previewUrl ?? asset.originalUrl} alt={asset.name} />
            )}
            <ResultComparison
              sourceIds={[
                ...new Set(
                  job.items.find(
                    (item) => item.assetIds.includes(asset.id) || item.assetId === asset.id,
                  )?.sourceAssetIds ?? [],
                ),
              ]}
              result={asset}
            />
            {onAcceptAsset && (
              <Button
                variant="secondary"
                onClick={() =>
                  void action.run(async () => {
                    onAcceptAsset(asset);
                    setDetail(false);
                  })
                }
              >
                {t('作为参考继续创作')}
              </Button>
            )}
            <Button
              variant="secondary"
              busy={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await downloadFile(asset.originalUrl, asset.name);
                  await post(`/jobs/${job.id}/downloaded`);
                  await refresh();
                }, '已下载原件')
              }
            >
              <Download size={16} />
              {t('下载原件')}
            </Button>
          </div>
        ))}
        <div className="inline-actions">
          {(job.outputAssets.length > 0 || job.items.some((item) => item.resultText)) && (
            <Button
              variant="secondary"
              busy={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await downloadPost(
                    '/jobs/download-zip',
                    { jobIds: [job.id] },
                    'yingzao-task.zip',
                  );
                  await post(`/jobs/${job.id}/downloaded`);
                  await refresh();
                }, '任务结果已打包下载')
              }
            >
              {t('打包下载结果与参数')}
            </Button>
          )}
          {job.createdBy === session?.user.id &&
            ['succeeded', 'failed', 'partial', 'cancelled'].includes(job.status) && (
              <Button
                variant="ghost"
                busy={action.busy}
                onClick={() =>
                  void action.run(
                    async () => {
                      await patch(`/jobs/${job.id}/history`, { archived: !job.isArchived });
                      setDetail(false);
                      await refresh();
                    },
                    job.isArchived ? '已恢复历史记录' : '历史记录已归档',
                  )
                }
              >
                {job.isArchived ? t('恢复历史记录') : t('归档历史记录')}
              </Button>
            )}
        </div>
        {job.projectId && (
          <Link
            className="button secondary"
            to={`/workbench/${job.projectId}`}
            onClick={() => setDetail(false)}
          >
            <ExternalLink size={15} />
            {t(plans.size && !onAcceptPlan ? '打开项目采用方案' : '打开项目')}
          </Link>
        )}
        {['failed', 'partial', 'cancelled'].includes(job.status) && (
          <Notice>
            {t('成功结果会保留。仅重试可重试且尚未建立重试任务的条目；结果待核对项需先核对。')}
            <JobSubmit
              forceConfirmation
              input={job.input}
              recoveryScope={`retry:${job.id}`}
              quoteFactory={() => post<Quote>(`/jobs/${job.id}/retry-quote`)}
              operation={{
                id: job.operation,
                name: operationName(job.operation),
                providerId: job.providerId,
                available: true,
                reason: null,
                models: [],
                priceCredits: 0,
                unit: 'request',
                liveVerified: false,
              }}
              valid={job.items.some(
                (item) =>
                  item.retryable ??
                  (['failed', 'cancelled'].includes(item.status) && !item.retryJobId),
              )}
              label={t('为可重试项重新估价')}
              onCreated={() => {
                setDetail(false);
                void refresh();
              }}
            />
          </Notice>
        )}
      </Modal>
    </article>
  );
}
export function TaskCenter({
  open,
  onClose,
  onAcceptPlan,
}: {
  open: boolean;
  onClose: () => void;
  onAcceptPlan?: AcceptPlan;
}) {
  const { workspace, session } = useStudio();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    q: '',
    status: '',
    operation: '',
    projectId: '',
    createdBy: '',
    from: '',
    to: '',
    downloaded: '',
    archived: 'false',
  });
  const [selected, setSelected] = useState<string[]>([]);
  const projects = useApi<Page<{ id: string; name: string }>>('/projects?pageSize=100', open);
  const members = useApi<Page<{ user: { id: string; displayName: string } }>>(
    '/members?pageSize=100',
    open,
  );
  const caps = useApi<{ operations: { id: string; name: string }[] }>('/capabilities', open);
  const refresh = useRefresh();
  const action = useAction();
  const query = useApi<Page<Job>>(
    `/jobs${qs({ ...filters, createdBy: filters.createdBy || session?.user.id, from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined, to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined, pageSize: 30, page })}`,
    open,
    open ? 4000 : undefined,
  );
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [JSON.stringify(filters), workspace?.id]);
  return (
    <Drawer open={open} onClose={onClose} title={t('任务中心')}>
      <div className="section-heading">
        <p className="muted">{t('每一次创作，都有迹可循')}</p>
        <Button variant="ghost" onClick={() => void query.refetch()}>
          <RefreshCw size={15} />
          {t('刷新')}
        </Button>
      </div>
      <details className="task-filters">
        <summary>{t('筛选历史记录')}</summary>
        <div className="form-grid">
          <Field label={t('搜索任务')}>
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </Field>
          <Field label={t('任务状态')}>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">{t('全部状态')}</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('处理类型')}>
            <select
              value={filters.operation}
              onChange={(e) => setFilters({ ...filters, operation: e.target.value })}
            >
              <option value="">{t('全部类型')}</option>
              {[...new Map(caps.data?.operations.map((op) => [op.id, op]) ?? []).values()].map(
                (op) => (
                  <option key={op.id} value={op.id}>
                    {operationName(op.id)}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label={t('项目')}>
            <select
              value={filters.projectId}
              onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}
            >
              <option value="">{t('全部项目')}</option>
              {projects.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('创建成员')}>
            <select
              value={filters.createdBy}
              onChange={(e) => setFilters({ ...filters, createdBy: e.target.value })}
            >
              <option value="">{t('我的历史')}</option>
              {members.data?.items.map((item) => (
                <option key={item.user.id} value={item.user.id}>
                  {item.user.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('下载状态')}>
            <select
              value={filters.downloaded}
              onChange={(e) => setFilters({ ...filters, downloaded: e.target.value })}
            >
              <option value="">{t('全部')}</option>
              <option value="true">{t('已下载')}</option>
              <option value="false">{t('未下载')}</option>
            </select>
          </Field>
          <Field label={t('开始日期')}>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </Field>
          <Field label={t('结束日期')}>
            <input
              type="date"
              min={filters.from}
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </Field>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.archived === 'true'}
              onChange={(e) => setFilters({ ...filters, archived: String(e.target.checked) })}
            />
            {t('查看已归档记录')}
          </label>
        </div>
        <p className="field-hint">{t('归档只隐藏自己的历史记录，不删除作品或额度账本。')}</p>
      </details>
      {!!selected.length && (
        <Button
          variant="secondary"
          busy={action.busy}
          onClick={() =>
            void action.run(async () => {
              await downloadPost('/jobs/download-zip', { jobIds: selected }, 'yingzao-results.zip');
              await Promise.all(selected.map((id) => post(`/jobs/${id}/downloaded`)));
              setSelected([]);
              await refresh();
            }, '任务结果已打包下载')
          }
        >
          {t('打包下载所选结果')} ({selected.length})
        </Button>
      )}
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : query.data?.items.length ? (
        query.data.items.map((job) => (
          <div key={job.id}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                disabled={!selected.includes(job.id) && selected.length >= 30}
                checked={selected.includes(job.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, job.id]
                      : selected.filter((id) => id !== job.id),
                  )
                }
              />
              {t('选择此任务')}
            </label>
            <JobCard job={job} onAcceptPlan={onAcceptPlan} />
          </div>
        ))
      ) : (
        <Empty
          title={t('你的下一件作品，从这里开始')}
          description={t('提交创作或本地处理后，进度与结果会持续保存在这里。')}
        />
      )}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.total}
          pageSize={query.data.pageSize}
          onPage={setPage}
        />
      )}
    </Drawer>
  );
}

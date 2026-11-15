import type { AssetDto } from '../../contracts/core';
import { ResultComparison } from './ResultComparison';
import { CreativeQuality } from './CreativeQuality';
import { BackgroundEditReview } from './BackgroundEditReview';
import { t } from '../lib/i18n';
import { OCRResultPanel } from './OCRResultPanel';
import { TaskReconcile } from './TaskReconcile';
import { useStudio } from '../context';
import { useEffect, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileText,
  Image,
  RefreshCw,
  Search,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import '../tasks.css';
import '../styles/library-tasks.css';
import '../styles/result-studio.css';
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
import { JobProgress, CreationPlaceholder } from './JobProgress';
import { jobInputSummary, presentJob } from '../lib/job-presentation';
import { jobDestination } from '../lib/job-navigation';
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
  showProjectLink = false,
  onJobCreated,
  onNavigate,
  compact = false,
}: {
  job: Job;
  onAcceptPlan?: AcceptPlan;
  onAcceptAsset?: (asset: AssetDto) => void;
  showProjectLink?: boolean;
  onJobCreated?: (job: Job) => void;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const { isAdmin, session, canEdit } = useStudio();
  const action = useAction();
  const refresh = useRefresh();
  const [detail, setDetail] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [backgroundItem, setBackgroundItem] = useState<string | null>(null);
  const backgroundCandidate = job.backgroundReview?.some((review) => review.state === 'candidate');
  const presentation = presentJob(job);
  const summary = job.input.options.detailPagePlan ? jobInputSummary(job.input) : job.prompt;
  const TypeIcon = job.operation.startsWith('video.')
    ? Video
    : job.operation.startsWith('image.')
      ? Image
      : Sparkles;
  const waiting = ['queued', 'running', 'reconciliation_required'].includes(job.status);
  const errors = [
    ...new Set(
      [job.errorMessage, ...job.items.map((item) => item.errorMessage)].filter(
        (value): value is string => !!value,
      ),
    ),
  ];
  const texts = job.items.filter((item) => item.resultText);
  const canRetry = job.items.some(
    (item) => item.retryable ?? (['failed', 'cancelled'].includes(item.status) && !item.retryJobId),
  );
  useEffect(() => {
    setResumed(false);
  }, [job.updatedAt, job.status]);
  const plans = new Map(
    job.items.flatMap((item) => {
      const result = designPlanResultSchema.safeParse(item.resultData);
      return result.success ? [[item.id, result.data.plan] as const] : [];
    }),
  );
  return (
    <article
      className="job-card result-job-card"
      data-job-id={job.id}
      data-compact={compact}
      data-status={job.status}
    >
      <div className="result-card-heading">
        <div className="result-card-label">
          <span className="result-type-icon">
            <TypeIcon size={15} />
          </span>
          <strong>{operationName(job.operation)}</strong>
          <span className="result-card-date">{dateTime(job.createdAt)}</span>
        </div>
        <Badge
          tone={
            backgroundCandidate
              ? 'orange'
              : job.status === 'succeeded'
                ? 'green'
                : job.status === 'failed'
                  ? 'red'
                  : job.status === 'reconciliation_required'
                    ? 'orange'
                    : 'neutral'
          }
        >
          {t(backgroundCandidate ? '背景候选 · 待核对' : (statusLabels[job.status] ?? job.status))}
        </Badge>
      </div>
      {(!compact || waiting || presentation.canResume) &&
        (job.status !== 'succeeded' || !job.outputAssets.length) && <JobProgress job={job} />}
      {!!errors.length && job.status !== 'succeeded' && (
        <div className="result-errors" role="note">
          <strong>{t(presentation.canResume ? '中断原因' : '任务说明')}</strong>
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
      {presentation.canResume && (
        <div className="result-recovery-action">
          <Button
            busy={action.busy}
            disabled={!canEdit || resumed}
            onClick={() =>
              void action.run(async () => {
                const result = await post<Job>(`/jobs/${job.id}/resume-result`);
                setResumed(true);
                onJobCreated?.(result);
                void refresh();
              }, '已恢复原任务，不会重新生成')
            }
          >
            <RefreshCw size={15} />
            {t(resumed ? '已恢复，等待更新' : presentation.resumeLabel)}
          </Button>
          <span>{t('沿用原任务，不会再次生成')}</span>
        </div>
      )}
      {job.status === 'reconciliation_required' && !presentation.canResume && isAdmin && (
        <div className="result-recovery-action">
          <TaskReconcile job={job} />
        </div>
      )}
      {compact && job.outputAssets.length > 0 ? (
        <Link className="result-compact-link" to={jobDestination(job)} onClick={onNavigate}>
          <span className="result-compact-thumbnail">
            {job.outputAssets[0]!.kind === 'image' || job.outputAssets[0]!.previewUrl ? (
              <img
                src={job.outputAssets[0]!.previewUrl ?? job.outputAssets[0]!.originalUrl}
                alt={job.outputAssets[0]!.name}
                loading="lazy"
              />
            ) : (
              <Video size={22} />
            )}
          </span>
          <span>
            <strong>
              {job.outputAssets.length} {t('个作品已保存')}
            </strong>
            <small>{t('打开任务查看完整结果与下载')}</small>
          </span>
          <ExternalLink size={15} />
        </Link>
      ) : !compact && job.outputAssets.length > 0 ? (
        <div className="result-media-grid" data-single={job.outputAssets.length === 1}>
          {job.outputAssets.map((asset) => (
            <figure className="creation-media result-artwork" key={asset.id}>
              {asset.kind === 'video' ? (
                <video
                  src={asset.originalUrl}
                  poster={asset.previewUrl ?? undefined}
                  controls
                  preload="metadata"
                  playsInline
                  aria-label={asset.name}
                />
              ) : (
                <button
                  className="result-image-button"
                  onClick={() => setDetail(true)}
                  aria-label={`${t('查看')} ${asset.name}`}
                >
                  <img
                    src={asset.previewUrl ?? asset.originalUrl}
                    alt={asset.name}
                    loading="lazy"
                  />
                </button>
              )}
              <figcaption>
                <span>{asset.kind === 'video' ? t('视频作品') : t('图片作品')}</span>
                <div className="result-artwork-actions">
                  {onAcceptAsset && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void action.run(async () => {
                          onAcceptAsset(asset);
                        }, '已放入创作参考')
                      }
                    >
                      {t('作为参考')}
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    busy={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await downloadFile(asset.originalUrl, asset.name);
                        await post(`/jobs/${job.id}/downloaded`);
                        void refresh();
                      }, '已下载原件')
                    }
                  >
                    <Download size={14} />
                    {t('下载原件')}
                  </Button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : !compact && waiting && !texts.length ? (
        <CreationPlaceholder video={job.operation.startsWith('video.')} />
      ) : null}
      {compact && !!texts.length && (
        <Link className="result-compact-text" to={jobDestination(job)} onClick={onNavigate}>
          <FileText size={17} />
          <span>
            {texts.length} {t('份文本结果已保存')}
          </span>
          <ExternalLink size={14} />
        </Link>
      )}
      {!compact && !!texts.length && !plans.size && (
        <div className="result-text-preview">
          {texts.map((item) => (
            <details key={item.id} open={texts.length === 1}>
              <summary>
                {t('创作文本')}
                <span>{t('展开或收起')}</span>
              </summary>
              <pre>{item.resultText}</pre>
              <Button
                variant="ghost"
                onClick={() =>
                  void action.run(
                    () => navigator.clipboard.writeText(item.resultText ?? ''),
                    '文本结果已复制',
                  )
                }
              >
                {t('复制文本')}
              </Button>
            </details>
          ))}
        </div>
      )}
      {compact ? (
        <p className="creation-prompt" title={summary}>
          {summary
            ? summary.length > 100
              ? `${summary.slice(0, 100)}…`
              : summary
            : t('未填写描述')}
        </p>
      ) : (
        <details className="result-description">
          <summary>{t('查看本次创作描述')}</summary>
          <p className="creation-prompt">{summary || t('未填写描述')}</p>
        </details>
      )}
      {!compact && job.outputAssets.length > 0 && <CreativeQuality review={job.creativeReview} />}
      {!compact &&
        job.backgroundReview?.map((review) => (
          <Notice key={review.itemId}>
            {t(
              review.state === 'candidate'
                ? '背景区域由模型识别，当前为待核对候选；请检查后调整并确认。'
                : '背景按已确认区域在本机合成，原候选仍保留。',
            )}
            {canEdit && (
              <Button variant="secondary" onClick={() => setBackgroundItem(review.itemId)}>
                {t('调整背景区域')}
              </Button>
            )}
          </Notice>
        ))}
      {backgroundItem && (
        <BackgroundEditReview
          job={job}
          itemId={backgroundItem}
          onClose={() => setBackgroundItem(null)}
          onCreated={(created) => {
            onJobCreated?.(created);
            void refresh();
          }}
        />
      )}
      {!compact && ['failed', 'partial', 'cancelled'].includes(job.status) && canRetry && (
        <Notice>
          {t('成功结果会保留。仅重试可重试且尚未建立重试任务的条目；结果待核对项需先核对。')}
          <JobSubmit
            forceConfirmation
            input={job.input}
            recoveryScope={`retry:${job.id}`}
            quoteFactory={async () => {
              const quote = await post<Quote>(`/jobs/${job.id}/retry-quote`);
              return { input: quote.input ?? job.input, quote };
            }}
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
            onCreated={(created) => {
              setDetail(false);
              onJobCreated?.(created);
              void refresh();
            }}
          />
        </Notice>
      )}
      <div className="result-card-footer">
        <span className="result-credit">
          {t('已结算')} {job.settledCredits} / {job.requestedCredits} {t('额度')}
        </span>
        <div className="result-footer-actions">
          {showProjectLink && (
            <Link
              className={`button ${compact ? 'primary' : 'secondary'} job-destination`}
              to={jobDestination(job)}
              onClick={onNavigate}
            >
              {t(job.outputAssets.length ? '查看作品' : '查看任务')}
              <ExternalLink size={13} />
            </Link>
          )}
          <Button variant="ghost" onClick={() => setDetail(true)}>
            {t(plans.size ? '查看设计方案' : '参数与详情')}
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
      </div>
      <Modal
        open={detail}
        onClose={() => setDetail(false)}
        title={t('任务详情')}
        description={`${t('任务')} ${job.id}`}
        wide
      >
        <div className="result-inspector">
          {job.status !== 'succeeded' && <JobProgress job={job} />}
          {!!errors.length && job.status !== 'succeeded' && (
            <div className="result-errors" role="note">
              <strong>{t(presentation.canResume ? '中断原因' : '任务说明')}</strong>
              {errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}
          {job.status === 'reconciliation_required' && !presentation.canResume && (
            <Notice tone="warning">
              {t('服务请求结果尚未确认。系统会保留额度等待核对，避免重复生成和重复扣费。')}
              {isAdmin && <TaskReconcile job={job} />}
            </Notice>
          )}
          {job.outputAssets.map((asset) => (
            <div className="result-detail result-inspector-artwork" key={asset.id}>
              {asset.kind === 'video' ? (
                <video
                  src={asset.originalUrl}
                  controls
                  preload="metadata"
                  playsInline
                  aria-label={asset.name}
                />
              ) : (
                <img src={asset.previewUrl ?? asset.originalUrl} alt={asset.name} />
              )}
              <div className="result-artwork-actions">
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
                  variant="primary"
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
              <details className="result-specs">
                <summary>{t('作品规格')}</summary>
                <dl className="detail-list">
                  <div>
                    <dt>{t('文件名称')}</dt>
                    <dd>{asset.name}</dd>
                  </div>
                  <div>
                    <dt>{t('文件格式')}</dt>
                    <dd>{asset.mimeType}</dd>
                  </div>
                  {!!asset.width && !!asset.height && (
                    <div>
                      <dt>{t('像素尺寸')}</dt>
                      <dd>
                        {asset.width} × {asset.height}
                      </dd>
                    </div>
                  )}
                  {asset.durationMs !== null && (
                    <div>
                      <dt>{t('实际时长')}</dt>
                      <dd>
                        {(asset.durationMs / 1000).toFixed(2)} {t('秒')}
                      </dd>
                    </div>
                  )}
                </dl>
              </details>
            </div>
          ))}
          <details className="result-record" open={job.outputAssets.length === 0 || !!plans.size}>
            <summary>{t('任务参数与处理记录')}</summary>
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
              {job.input.options.model && (
                <div>
                  <dt>{t('模型')}</dt>
                  <dd>{job.input.options.model}</dd>
                </div>
              )}
            </dl>
            {!!plans.size && !onAcceptPlan && (
              <Notice>
                {job.projectId
                  ? t(
                      '这里可查看、修改并复制方案。进入对应项目后，可从作品卡选择方向应用到创作草稿。',
                    )
                  : t('这里可查看、修改并复制方案。此任务未关联项目，请将方案复制到新的创作草稿。')}
              </Notice>
            )}
            <div className="result-task-items">
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
          </details>
          <div className="result-inspector-actions">
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
          {showProjectLink && (
            <Link
              className="button secondary"
              to={jobDestination(job)}
              onClick={() => {
                setDetail(false);
                onNavigate?.();
              }}
            >
              <ExternalLink size={15} />
              {t(job.outputAssets.length ? '查看作品' : '查看任务')}
            </Link>
          )}
        </div>
      </Modal>
    </article>
  );
}
export function TaskCenter({
  open,
  onClose,
  onAcceptPlan,
  title,
}: {
  open: boolean;
  onClose: () => void;
  onAcceptPlan?: AcceptPlan;
  title?: string;
}) {
  return (
    <Drawer open={open} onClose={onClose} title={title ?? t('任务中心')}>
      <div className="task-drawer-intro">
        <p className="muted">{t('离开页面也会继续处理；每次任务的进度和结果都保留在这里。')}</p>
        <Link className="button secondary" to="/tasks" onClick={onClose}>
          {t('打开完整任务中心')} <ExternalLink size={15} />
        </Link>
      </div>
      <TaskList enabled={open} onNavigate={onClose} onAcceptPlan={onAcceptPlan} />
    </Drawer>
  );
}

const initialTaskFilters = {
  q: '',
  status: '',
  operation: '',
  projectId: '',
  createdBy: '',
  from: '',
  to: '',
  downloaded: '',
  archived: 'false',
};
type TaskFilters = typeof initialTaskFilters;

function taskDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

/** A bookmarked filter must be safe to render, including hand-edited date/page values. */
export function readTaskLocation(params: URLSearchParams): { filters: TaskFilters; page: number } {
  const filters: TaskFilters = { ...initialTaskFilters };
  for (const key of Object.keys(initialTaskFilters) as (keyof TaskFilters)[])
    filters[key] = params.get(key) ?? initialTaskFilters[key];
  if (!Object.hasOwn(statusLabels, filters.status)) filters.status = '';
  filters.from = taskDate(filters.from);
  filters.to = taskDate(filters.to);
  if (filters.from && filters.to && filters.to < filters.from) filters.to = '';
  if (!['true', 'false'].includes(filters.downloaded)) filters.downloaded = '';
  filters.archived = filters.archived === 'true' ? 'true' : 'false';
  const page = Number(params.get('page') ?? 1);
  return { filters, page: Number.isSafeInteger(page) && page > 0 ? page : 1 };
}

/** Preserve the focused job and unrelated URL state when filtering or clearing filters. */
export function writeTaskLocation(
  current: URLSearchParams,
  filters: TaskFilters,
  page = 1,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of Object.keys(initialTaskFilters) as (keyof TaskFilters)[]) {
    if (filters[key] && filters[key] !== initialTaskFilters[key]) next.set(key, filters[key]);
    else next.delete(key);
  }
  if (page > 1) next.set('page', String(page));
  else next.delete('page');
  return next;
}

export function TaskList({
  enabled = true,
  onNavigate,
  onAcceptPlan,
  syncUrl = false,
}: {
  enabled?: boolean;
  onNavigate?: () => void;
  onAcceptPlan?: AcceptPlan;
  syncUrl?: boolean;
}) {
  const { workspace, session } = useStudio();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [localPage, setLocalPage] = useState(1);
  const [localFilters, setLocalFilters] = useState(initialTaskFilters);
  const locationState = readTaskLocation(params);
  const page = syncUrl ? locationState.page : localPage;
  const filters = syncUrl ? locationState.filters : localFilters;
  const [selected, setSelected] = useState<string[]>([]);
  function setPage(next: number) {
    setSelected([]);
    if (syncUrl) setParams(writeTaskLocation(params, filters, next));
    else setLocalPage(next);
  }
  function setFilters(next: TaskFilters) {
    setSelected([]);
    if (syncUrl) setParams(writeTaskLocation(params, next), { replace: true });
    else {
      setLocalFilters(next);
      setLocalPage(1);
    }
  }
  const projects = useApi<Page<{ id: string; name: string }>>('/projects?pageSize=100', enabled);
  const members = useApi<Page<{ user: { id: string; displayName: string } }>>(
    '/members?pageSize=100',
    enabled,
  );
  const caps = useApi<{ operations: { id: string; name: string }[] }>('/capabilities', enabled);
  const refresh = useRefresh();
  const action = useAction();
  const query = useApi<Page<Job>>(
    `/jobs${qs({ ...filters, from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined, to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined, pageSize: 30, page })}`,
    enabled,
    enabled ? 4000 : undefined,
  );
  useEffect(() => {
    setSelected([]);
  }, [JSON.stringify(filters), page, workspace?.id]);
  const filterLabels = [
    filters.q && `${t('搜索')}：${filters.q}`,
    filters.status && t(statusLabels[filters.status] ?? filters.status),
    filters.operation && operationName(filters.operation),
    filters.projectId &&
      (projects.data?.items.find((item) => item.id === filters.projectId)?.name ?? t('指定项目')),
    filters.createdBy &&
      (members.data?.items.find((item) => item.user.id === filters.createdBy)?.user.displayName ??
        t('指定成员')),
    filters.from && `${t('开始日期')}：${filters.from}`,
    filters.to && `${t('结束日期')}：${filters.to}`,
    filters.downloaded && t(filters.downloaded === 'true' ? '已下载' : '未下载'),
    filters.archived === 'true' && t('已归档'),
  ].filter((value): value is string => !!value);
  function resetFilters() {
    setFilters(initialTaskFilters);
    setSelected([]);
  }
  return (
    <section className="task-list" aria-label={t('任务记录')}>
      <div className="task-history-toolbar">
        <label className="library-search task-search">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label={t('搜索任务')}
            placeholder={t('搜索创作描述…')}
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
        </label>
        <p className="task-record-count">
          {t(filters.createdBy === session?.user.id ? '我的任务' : '当前空间任务')} ·{' '}
          {query.data ? `${query.data.total} ${t('条记录')}` : t('正在读取')}
        </p>
        <Button variant="ghost" onClick={() => void query.refetch()}>
          <RefreshCw size={15} />
          {t('刷新')}
        </Button>
      </div>
      <div className="task-status-tabs" aria-label={t('按状态查看任务')}>
        {[
          ['', '全部'],
          ['queued', '排队中'],
          ['running', '处理中'],
          ['succeeded', '已完成'],
          ['partial', '部分完成'],
          ['failed', '未完成'],
          ['reconciliation_required', '等待核对'],
          ['cancelled', '已取消'],
        ].map(([value, label]) => (
          <Button
            key={value}
            variant={filters.status === value ? 'primary' : 'ghost'}
            aria-pressed={filters.status === value}
            onClick={() => setFilters({ ...filters, status: value! })}
          >
            {t(label!)}
          </Button>
        ))}
      </div>
      {!!filterLabels.length && (
        <div className="task-filter-summary" role="status">
          <span>
            {t('当前筛选')}：{filterLabels.join(' · ')}
          </span>
          <Button variant="ghost" onClick={resetFilters}>
            {t('清空筛选')}
          </Button>
        </div>
      )}
      <details className="task-filters">
        <summary>{t('筛选历史记录')}</summary>
        <div className="form-grid">
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
              <option value="">{t('全部成员')}</option>
              <option value={session?.user.id}>{t('我的任务')}</option>
              {members.data?.items
                .filter((item) => item.user.id !== session?.user.id)
                .map((item) => (
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
        <div className="selection-bar task-selection-bar">
          <span>
            {t('已选择')} {selected.length} {t('条记录')}
          </span>
          <Button
            variant="secondary"
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                await downloadPost(
                  '/jobs/download-zip',
                  { jobIds: selected },
                  'yingzao-results.zip',
                );
                await Promise.all(selected.map((id) => post(`/jobs/${id}/downloaded`)));
                setSelected([]);
                await refresh();
              }, '任务结果已打包下载')
            }
          >
            <Download size={15} /> {t('打包下载所选结果')}
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            {t('取消选择')}
          </Button>
        </div>
      )}
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : query.data?.items.length ? (
        query.data.items.map((job) => (
          <div key={job.id} className="task-list-item">
            <label className="checkbox-label task-list-selection">
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
              <span className="sr-only">
                {t('选择此任务')}：{job.prompt.slice(0, 50)}
              </span>
            </label>
            <JobCard
              job={job}
              onAcceptPlan={onAcceptPlan}
              compact
              showProjectLink
              onNavigate={onNavigate}
              onJobCreated={(created) => {
                onNavigate?.();
                navigate(jobDestination(created));
              }}
            />
          </div>
        ))
      ) : (
        <Empty
          title={t(filterLabels.length ? '没有符合筛选条件的任务' : '还没有创作任务')}
          description={t(
            filterLabels.length
              ? '清空筛选，查看所有任务和作品。'
              : '开始一次创作，提交成功后会在这里保留进度、结果和生成参数。',
          )}
          action={
            filterLabels.length ? (
              <Button variant="secondary" onClick={resetFilters}>
                {t('清空筛选')}
              </Button>
            ) : (
              <Link className="button secondary" to="/" onClick={onNavigate}>
                {t('去创作')}
              </Link>
            )
          }
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
    </section>
  );
}

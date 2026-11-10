import { jobInputSchema } from '../../contracts/jobs';
import { t } from '../lib/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, CheckCircle2, Coins, Image, Sparkles, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError, CONFIRMATION_TIMEOUT_MS, errorMessage, useRefresh } from '../lib/api';
import { jobDestination } from '../lib/job-navigation';
import { jobInputSummary } from '../lib/job-presentation';
import {
  readPendingSubmissions,
  writePendingSubmission,
  removePendingSubmission,
  submissionWasRejected,
  type PendingSubmission,
} from '../lib/creation-recovery';
import type { Job, JobInput, Operation, Quote } from '../lib/tasks';
import { Button, Modal, Notice, useAction } from './ui';
import { useStudio } from '../context';
import { canConfirmQuote, quoteFormFingerprint } from '../lib/quote-confirmation';
import { CreativeSummary } from './CreativeBrief';
import { CreditEstimate } from './CreditEstimate';
import '../styles/job-submit.css';

export function JobCreatedReceipt({ job }: { job: Job }) {
  return (
    <Notice>
      <strong>{t('任务已创建')}</strong>
      <p>{jobInputSummary(job.input)}</p>
      <Link to={jobDestination(job)} state={{ submittedJob: job }}>
        {t('查看这次任务')} <ArrowUpRight size={14} />
      </Link>
    </Notice>
  );
}

export function JobSubmit({
  input,
  operation,
  valid = true,
  onCreated,
  label = '开始创作',
  busyLabel,
  estimateReady = true,
  forceConfirmation = false,
  beforePrepareInput,
  prepareInput,
  recoveryScope,
  quoteFactory,
  secondaryActions,
  onRequestPrompt,
  onCapabilityChanged,
}: {
  input: JobInput;
  operation: Operation | undefined;
  valid?: boolean;
  onCreated?: (job: Job) => void;
  label?: string;
  busyLabel?: string;
  /** Independent of prompt completeness: empty prompts can still show a specification estimate. */
  estimateReady?: boolean;
  forceConfirmation?: boolean;
  /** Null means a lightweight clarification is shown; no project, quote or job is created. */
  beforePrepareInput?: (input: JobInput) => Promise<JobInput | null>;
  prepareInput?: (input: JobInput) => Promise<JobInput>;
  recoveryScope?: string;
  quoteFactory?: (input: JobInput) => Promise<Quote | { input: JobInput; quote: Quote }>;
  secondaryActions?: ReactNode;
  /** An empty new home prompt stays actionable, without bypassing submission validation. */
  onRequestPrompt?: () => void;
  /** Refresh metadata only; the user must request and confirm a new quote afterwards. */
  onCapabilityChanged?: () => Promise<boolean>;
}) {
  const { canEdit, session, workspace } = useStudio();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scope = recoveryScope ?? `${input.operation}:${input.projectId ?? 'new'}`;
  const [journal] = useState(() => {
    try {
      return readPendingSubmissions(localStorage, session!.user.id, workspace!.id);
    } catch {
      return { value: [], error: t('浏览器存储不可用，无法可靠记录提交。请检查浏览器设置。') };
    }
  });
  const [recovery, setRecovery] = useState<PendingSubmission | null>(
    () =>
      journal.value.find(
        (entry) =>
          entry.scope === scope ||
          (scope.startsWith('composer:') &&
            !entry.scope.startsWith('retry:') &&
            input.projectId &&
            entry.input.projectId === input.projectId &&
            entry.input.operation === input.operation),
      ) ?? null,
  );
  const [recoveryMissing, setRecoveryMissing] = useState(false);
  const [storageError, setStorageError] = useState(journal.error);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [acceptedJob, setAcceptedJob] = useState<Job | null>(null);
  const [needsReconfirmation, setNeedsReconfirmation] = useState(false);
  const confirmGeneration =
    forceConfirmation ||
    needsReconfirmation ||
    session?.user.preferences.confirmGeneration !== false;
  const capabilityRecovery = useRef(onCapabilityChanged);
  capabilityRecovery.current = onCapabilityChanged;
  const pendingRequest = useRef<{
    quote: Quote;
    input: JobInput;
    id: string;
    formFingerprint: string;
  } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const quoteExpiresAt = quote?.expiresAt;
  const [, setQuoteExpiryTick] = useState(0);
  useEffect(() => {
    if (!quoteExpiresAt || !confirmGeneration) return;
    const remaining = Date.parse(quoteExpiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(() => setQuoteExpiryTick((tick) => tick + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [quoteExpiresAt, confirmGeneration]);
  const [snapshot, setSnapshot] = useState<JobInput | null>(null);
  const mediaGeneration = ['image.generate', 'video.generate'].includes(input.operation);
  const mediaQuote =
    !!snapshot && ['image.generate', 'video.generate'].includes(snapshot.operation);
  const quotedOperation =
    operation?.id === snapshot?.operation && operation?.providerId === snapshot?.providerId
      ? operation
      : undefined;
  const requestId = useRef<string | null>(null);
  const validated = jobInputSchema.safeParse(input);
  const requestPrompt = !input.prompt.trim() && onRequestPrompt;
  const formFingerprint = quoteFormFingerprint(input);
  const latestForm = useRef({
    valid,
    canEdit,
    available: operation?.available,
    fingerprint: formFingerprint,
  });
  latestForm.current = {
    valid,
    canEdit,
    available: operation?.available,
    fingerprint: formFingerprint,
  };
  const confirmationAllowed =
    !!quote &&
    canConfirmQuote(
      valid && canEdit && !!operation?.available,
      pendingRequest.current?.formFingerprint,
      formFingerprint,
      quote.expiresAt,
    );
  const quoteExpired = !!quote && !(Date.parse(quote.expiresAt) > Date.now());
  const action = useAction();
  const refresh = useRefresh();
  async function recoverCapability(error: unknown) {
    if (
      !(error instanceof ApiError) ||
      error.code !== 'CAPABILITY_CHANGED' ||
      !capabilityRecovery.current ||
      !mounted.current
    )
      return error;
    pendingRequest.current = null;
    requestId.current = null;
    setQuote(null);
    setSnapshot(null);
    setNeedsReconfirmation(true);
    let updated = false;
    try {
      updated = await capabilityRecovery.current();
    } catch {
      // A metadata failure never starts another preparation or a model task.
    }
    const message = t(
      updated
        ? '模型信息已重新核查，草稿已保留。请再次点击生成并确认报价。'
        : '模型信息未能更新，草稿已保留。请刷新模型信息后再次确认报价。',
    );
    if (mounted.current) setSubmissionError(message);
    return new Error(message);
  }
  function accept(job: Job, id: string) {
    // Once the server has acknowledged a job, browser housekeeping cannot turn it
    // into a failed submission or prevent the user from reaching that same job.
    try {
      removePendingSubmission(localStorage, session!.user.id, workspace!.id, id);
    } catch {
      setStorageError(t('任务已提交，但本机记录清理失败。再次进入时请核对该任务。'));
    }
    setRecovery(null);
    setRecoveryMissing(false);
    pendingRequest.current = null;
    setQuote(null);
    setSnapshot(null);
    setSubmissionError(null);
    setConfirmationError(null);
    setAcceptedJob(job);
    setNeedsReconfirmation(false);
    if (mounted.current) {
      try {
        onCreated?.(job);
      } catch {
        setStorageError(t('任务已创建，请通过下方入口查看进度，请勿重复提交。'));
      }
    }
    void refresh().catch(() => undefined);
  }
  async function dispatch(data: Quote, payload: JobInput, id: string) {
    if (!session || !workspace) return;
    const record: PendingSubmission =
      recovery?.requestId === id
        ? recovery
        : {
            version: 1,
            scope,
            input: payload,
            quote: data,
            requestId: id,
            confirmedAt: new Date().toISOString(),
          };
    try {
      writePendingSubmission(localStorage, session.user.id, workspace.id, record);
    } catch {
      setStorageError(t('无法保存提交记录，本次尚未发送。请检查浏览器存储后重试。'));
      setSubmissionError(t('无法保存提交记录，本次尚未发送。请检查浏览器存储后重试。'));
      throw new Error(t('无法保存提交记录，本次尚未发送。'));
    }
    setStorageError(null);
    setSubmissionError(null);
    setConfirmationError(null);
    setAcceptedJob(null);
    setRecovery(record);
    setRecoveryMissing(false);
    let job: Job;
    try {
      job = await api<Job>(
        '/jobs',
        {
          method: 'POST',
          timeoutMs: CONFIRMATION_TIMEOUT_MS,
          body: JSON.stringify({ input: payload, quoteId: data.id, clientRequestId: id }),
        },
        workspace.id,
      );
    } catch (error) {
      setQuote(null);
      if (error instanceof ApiError && submissionWasRejected(error)) {
        try {
          removePendingSubmission(localStorage, session.user.id, workspace.id, id);
        } catch {
          setStorageError(t('本次任务未创建，但本机记录清理失败。重新进入时请核对提交结果。'));
        }
        setRecovery(null);
        pendingRequest.current = null;
        setQuote(null);
        setSubmissionError(errorMessage(error));
      } else {
        setConfirmationError(errorMessage(error));
      }
      throw await recoverCapability(error);
    }
    accept(job, id);
  }
  async function estimate() {
    await action.run(async () => {
      setSubmissionError(null);
      setAcceptedJob(null);
      let submitting = false;
      try {
        if (!validated.success) throw new Error(t('请检查必填参数与数值范围。'));
        if (!valid || !canEdit || !operation?.available)
          throw new Error(t('当前设置暂不能提交，请返回编辑核对模型信息。'));
        if (recovery) throw new Error(t('请先核对上次提交结果。'));
        let pending = pendingRequest.current;
        if (
          !pending ||
          pending.formFingerprint !== formFingerprint ||
          Date.parse(pending.quote.expiresAt) <= Date.now()
        ) {
          const checkedInput = beforePrepareInput ? await beforePrepareInput(input) : input;
          if (!checkedInput || !mounted.current) return;
          if (
            !latestForm.current.valid ||
            !latestForm.current.canEdit ||
            !latestForm.current.available ||
            latestForm.current.fingerprint !== formFingerprint
          )
            throw new Error(t('设置或模型信息已改变，请返回编辑并重新确认报价。'));
          const payload = prepareInput ? await prepareInput(checkedInput) : checkedInput;
          if (!mounted.current) return;
          if (
            !latestForm.current.valid ||
            !latestForm.current.canEdit ||
            !latestForm.current.available ||
            latestForm.current.fingerprint !== formFingerprint
          )
            throw new Error(t('设置或模型信息已改变，请返回编辑并重新确认报价。'));
          const data = quoteFactory
            ? await quoteFactory(payload)
            : await api<Quote>(
                '/quotes',
                {
                  method: 'POST',
                  body: JSON.stringify(payload),
                  timeoutMs: CONFIRMATION_TIMEOUT_MS,
                },
                workspace!.id,
              );
          if (!mounted.current) return;
          const prepared = 'quote' in data ? data : { quote: data, input: payload };
          if (
            !latestForm.current.valid ||
            !latestForm.current.canEdit ||
            !latestForm.current.available ||
            latestForm.current.fingerprint !== formFingerprint
          )
            throw new Error(t('设置或模型信息已改变，请返回编辑并重新确认报价。'));
          const checked = jobInputSchema.safeParse(prepared.input);
          if (!checked.success) throw new Error(t('返回的任务参数无效，请重新估价。'));
          pending = {
            quote: prepared.quote,
            input: structuredClone(prepared.input),
            id: crypto.randomUUID(),
            formFingerprint,
          };
          pendingRequest.current = pending;
        }
        setSnapshot(pending.input);
        setQuote(pending.quote);
        requestId.current = pending.id;
        if (!confirmGeneration) {
          submitting = true;
          await dispatch(pending.quote, pending.input, pending.id);
        }
      } catch (error) {
        const failure = submitting ? error : await recoverCapability(error);
        if (!submitting) setSubmissionError(errorMessage(failure));
        throw failure;
      }
    });
  }
  async function submit() {
    if (!quote || !snapshot || !requestId.current) return;
    if (
      !canConfirmQuote(
        latestForm.current.valid && latestForm.current.canEdit && !!latestForm.current.available,
        pendingRequest.current?.formFingerprint,
        latestForm.current.fingerprint,
        quote.expiresAt,
      )
    ) {
      setSubmissionError(
        t(
          Date.parse(quote.expiresAt) <= Date.now()
            ? '报价已过期，请返回编辑并重新估价。'
            : '设置或模型信息已改变，请返回编辑并重新确认报价。',
        ),
      );
      return;
    }
    await action.run(
      () => dispatch(quote, snapshot, requestId.current!),
      t('任务已提交，可在任务中心查看进度'),
    );
  }
  async function recover() {
    if (!recovery || !session || !workspace) return;
    await action.run(async () => {
      setConfirmationError(null);
      try {
        const job = await api<Job>(
          `/jobs/by-request/${recovery.requestId}`,
          { timeoutMs: CONFIRMATION_TIMEOUT_MS },
          workspace.id,
        );
        accept(job, recovery.requestId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setRecoveryMissing(true);
          return;
        }
        setConfirmationError(errorMessage(error));
        throw error;
      }
    }, t('提交结果已核对'));
  }
  return (
    <div
      className={`submit-block ${secondaryActions ? 'submit-block-home' : ''}${mediaGeneration ? ' studio-media-submit' : ''}`}
    >
      {acceptedJob && <JobCreatedReceipt job={acceptedJob} />}
      {submissionError && !recovery && (
        <Notice tone="warning">
          <strong>{t('尚未创建生成任务')}</strong>
          <p>{submissionError}</p>
          <p>{t('请调整参数或检查可用额度，再点击创作；可以先保存草稿。')}</p>
          <Link to="/tasks">
            {t('查看我的任务')} <ArrowUpRight size={14} />
          </Link>
        </Notice>
      )}
      {storageError && <Notice tone="warning">{storageError}</Notice>}
      {recovery && (
        <Notice tone="warning">
          <strong>{t(action.busy ? '正在确认任务，请稍候' : '上次提交结果待核对')}</strong>
          <p>
            {jobInputSummary(recovery.input)} · {recovery.quote.maxCredits} {t('额度上限')}
          </p>
          <p>{t('核对不会再次生成。请先找回原任务，避免重复提交。')}</p>
          {confirmationError && <p>{confirmationError}</p>}
          <Button variant="secondary" busy={action.busy} onClick={() => void recover()}>
            {t('核对提交结果')}
          </Button>
          {recoveryMissing && (
            <>
              <p>
                {t('暂未找到原任务。你可以继续提交同一份已确认请求，系统会按原编号避免重复创建。')}
              </p>
              <Button
                disabled={!canEdit}
                busy={action.busy}
                onClick={() =>
                  void action.run(
                    () => dispatch(recovery.quote, recovery.input, recovery.requestId),
                    t('原请求已提交'),
                  )
                }
              >
                {t('继续提交原请求')}
              </Button>
            </>
          )}
        </Notice>
      )}
      {!validated.success && <Notice tone="warning">{t('请检查必填参数与数值范围。')}</Notice>}
      {!operation?.available && (
        <Notice>
          {t(operation?.reason ?? '该能力尚未连接生成服务。素材与参数仍可编辑并保存。')}{' '}
          <Link to="/settings?tab=providers">
            {t('连接服务')}
            <ArrowUpRight size={12} />
          </Link>
        </Notice>
      )}
      {!confirmGeneration && operation?.available && (
        <p className="field-hint">
          {t(
            '已关闭二次确认。点击创作后将按服务端报价预留空间额度；供应商可能另行收费，预算限制仍然生效。',
          )}
        </p>
      )}
      <div className="submit-row">
        {secondaryActions}
        {mediaGeneration && !quoteFactory ? (
          <CreditEstimate input={input} operation={operation} ready={estimateReady} />
        ) : (
          (!secondaryActions || operation?.available) && (
            <span className="muted">
              <Coins size={14} />
              {operation?.available
                ? confirmGeneration
                  ? t('提交前确认实际估价')
                  : t('按报价直接提交并预留额度')
                : t('连接服务后估价')}
            </span>
          )
        )}
        <Button
          busy={action.busy}
          disabled={
            !canEdit ||
            (!valid && !requestPrompt) ||
            (!validated.success && !requestPrompt) ||
            !operation?.available ||
            !!recovery ||
            !!journal.error
          }
          onClick={() => (requestPrompt ? requestPrompt() : void estimate())}
        >
          {secondaryActions ? <ArrowUpRight size={16} /> : <Sparkles size={16} />}
          {t(action.busy && busyLabel ? busyLabel : label)}
        </Button>
      </div>
      <Modal
        open={!!quote && confirmGeneration}
        onClose={() => {
          if (!action.busy) setQuote(null);
        }}
        title={t('确认创作')}
        description={t(
          mediaQuote
            ? '核对需求与积分后开始生成。'
            : '本次任务会按以下配置执行，任务开始后可在任务中心查看结果。',
        )}
      >
        {quote && snapshot && (
          <>
            {mediaQuote && (
              <section
                className="media-quote-summary studio-quote-summary"
                aria-label={t('本次创作确认')}
              >
                <header className="studio-quote-heading">
                  <span className="studio-quote-icon" aria-hidden="true">
                    {snapshot.operation === 'image.generate' ? (
                      <Image size={22} />
                    ) : (
                      <Video size={22} />
                    )}
                  </span>
                  <h3>
                    {t(snapshot.operation === 'image.generate' ? '本次图片创作' : '本次视频创作')}
                  </h3>
                  <span className="studio-quote-count">
                    <strong>{quote.items?.length ?? snapshot.options.count}</strong>{' '}
                    {t(snapshot.operation === 'image.generate' ? '张' : '条')}
                  </span>
                </header>
                <div className="media-quote-specs">
                  <span>
                    <small>{t('画幅')}</small>
                    <strong>{snapshot.options.ratio}</strong>
                  </span>
                  <span>
                    <small>{t('清晰度')}</small>
                    <strong>{snapshot.options.resolution}</strong>
                  </span>
                  {snapshot.operation === 'video.generate' && (
                    <span>
                      <small>{t('每条时长')}</small>
                      <strong>
                        {snapshot.options.duration} {t('秒')}
                      </strong>
                    </span>
                  )}
                </div>
                <div className="studio-quote-request">
                  <span>{t('本次内容')}</span>
                  <p>
                    {jobInputSummary({
                      ...snapshot,
                      prompt: quote.creativeSummary?.summary || snapshot.prompt,
                    })}
                  </p>
                </div>
                {(snapshot.options.generateAudio !== undefined ||
                  snapshot.backgroundAudioAssetId) && (
                  <div className="studio-quote-audio">
                    {snapshot.options.generateAudio !== undefined && (
                      <span>{t(snapshot.options.generateAudio ? '含生成音轨' : '无生成音轨')}</span>
                    )}
                    {snapshot.backgroundAudioAssetId && <span>{t('含背景音乐')}</span>}
                  </div>
                )}
                <div className="studio-quote-cost">
                  <span>{t('预留积分上限')}</span>
                  <div className="media-quote-price" aria-label={t('预留积分上限')}>
                    <strong>{quote.maxCredits}</strong>
                    <span>{t('积分')}</span>
                  </div>
                </div>
              </section>
            )}
            <details
              className={mediaQuote ? 'media-quote-details' : undefined}
              open={mediaQuote ? undefined : true}
            >
              <summary hidden={!mediaQuote}>{t('查看详细配置与计费')}</summary>
              {quote.creativeSummary && <CreativeSummary {...quote.creativeSummary} />}
              {mediaQuote && snapshot.prompt && (
                <section className="studio-quote-original" aria-label={t('原始描述')}>
                  <h4>{t('原始描述')}</h4>
                  <p tabIndex={0}>{snapshot.prompt}</p>
                </section>
              )}
              {!mediaQuote && (
                <div className="quote-summary">
                  <span>{t('本次创作需求')}</span>
                  <p>{jobInputSummary(snapshot)}</p>
                  <div>
                    {snapshot.options.ratio && <span>{snapshot.options.ratio}</span>}
                    {snapshot.options.resolution && <span>{snapshot.options.resolution}</span>}
                    {snapshot.operation === 'video.generate' && (
                      <span>
                        {snapshot.options.duration} {t('秒')}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <dl className="detail-list">
                <div>
                  <dt>{t('处理方式')}</dt>
                  <dd>{quotedOperation?.name ?? snapshot.operation}</dd>
                </div>
                <div>
                  <dt>{t('生成模型')}</dt>
                  <dd>
                    {quotedOperation?.models.find((model) => model.id === snapshot.options.model)
                      ?.name ??
                      (snapshot.options.model
                        ? String(snapshot.options.model)
                        : (quotedOperation?.models[0]?.name ??
                          quotedOperation?.name ??
                          t('创作服务')))}
                  </dd>
                </div>
                <div>
                  <dt>{t('素材')}</dt>
                  <dd>
                    {
                      new Set(
                        [
                          ...snapshot.assetIds,
                          ...snapshot.referenceAssetIds,
                          snapshot.maskAssetId,
                          snapshot.backgroundAssetId,
                          snapshot.backgroundAudioAssetId,
                        ].filter((id): id is string => !!id),
                      ).size
                    }
                    {t('项')}
                  </dd>
                </div>
                {[
                  ['蒙版', snapshot.maskAssetId],
                  ['背景参考', snapshot.backgroundAssetId],
                  ['背景音乐', snapshot.backgroundAudioAssetId],
                ]
                  .filter(([, id]) => !!id)
                  .map(([label]) => (
                    <div key={label}>
                      <dt>{t(label!)}</dt>
                      <dd>1{t('项')}</dd>
                    </div>
                  ))}
                {snapshot.options.generateAudio !== undefined && (
                  <div>
                    <dt>{t('生成视频音轨')}</dt>
                    <dd>{t(snapshot.options.generateAudio ? '开启' : '关闭')}</dd>
                  </div>
                )}
                {snapshot.options.detailPagePlan && (
                  <div>
                    <dt>{t('整套详情页')}</dt>
                    <dd>
                      {snapshot.options.detailPagePlan.productName} ·{' '}
                      {snapshot.options.detailPagePlan.screens.length} {t('屏')}
                    </dd>
                  </div>
                )}
                {quote.items && (
                  <div>
                    <dt>{t('处理任务')}</dt>
                    <dd>
                      {quote.items.length}
                      {t('项')}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t('计费数量')}</dt>
                  <dd>
                    {quote.units}
                    {quotedOperation &&
                      // Retry controls can supply placeholder capabilities with no model/rate.
                      // Keep the server's unit count, without inventing a label from that placeholder.
                      (!mediaQuote || quotedOperation.models.length > 0) &&
                      t(
                        quotedOperation.unit === 'second'
                          ? '秒'
                          : quotedOperation.unit === 'image'
                            ? '张'
                            : '次',
                      )}
                  </dd>
                </div>
                <div>
                  <dt>{t('预留额度上限')}</dt>
                  <dd>
                    <strong>
                      {quote.maxCredits}
                      {t('额度')}
                    </strong>
                  </dd>
                </div>
              </dl>
              {!!quote.items?.length && (
                <details className="section-spaced" open={quote.items.length <= 6}>
                  <summary>
                    {t('本次处理组合')} · {quote.items.length}
                  </summary>
                  <ol>
                    {quote.items.map((item) => (
                      <li key={item.index}>
                        {snapshot.options.detailPagePlan && (
                          <strong>
                            {item.index + 1}.{' '}
                            {snapshot.options.detailPagePlan.screens[item.index]?.title} ·{' '}
                          </strong>
                        )}
                        {item.assetIds.length
                          ? item.assetIds
                              .map(
                                (id) =>
                                  `${t('原图')} ${snapshot.assetIds.indexOf(id) + 1 || id.slice(-8)}`,
                              )
                              .join('、')
                          : t('文字输入')}
                        {item.referenceAssetIds.length > 0 &&
                          ` → ${item.referenceAssetIds.map((id) => `${t('参考')} ${snapshot.referenceAssetIds.indexOf(id) + 1 || id.slice(-8)}`).join('、')}`}
                        {snapshot.maskAssetId && ` · ${t('蒙版')}`}
                        {item.backgroundAssetId && ` · ${t('背景参考')}`}
                        {item.backgroundAudioAssetId && ` · ${t('背景音乐')}`}
                        {item.color && ` · ${t('颜色')} ${item.color}`}
                        {item.language && ` · ${t('语言')} ${item.language}`}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </details>
            {snapshot.operation === 'media.import' && (
              <Notice>
                {t(
                  '解析服务按调用另行收费，链接失效或解析后无法下载也可能收费。确认仅对当前链接执行一次；连接中断时请先核对原任务。',
                )}
              </Notice>
            )}
            {mediaQuote ? (
              <p className="media-quote-note">
                {t('确认后预留工作空间积分；供应商费用另计。失败与取消按实际执行情况结算。')}
              </p>
            ) : (
              <Notice>
                {t(
                  '这里显示的是工作空间额度。供应商可能按实际调用另行收取费用。失败与取消按实际执行情况结算。',
                )}
              </Notice>
            )}
            {!confirmationAllowed && (
              <Notice tone="warning">
                {t(
                  quoteExpired
                    ? '报价已过期，请返回编辑并重新估价。'
                    : '设置或模型信息已改变，请返回编辑并重新确认报价。',
                )}
              </Notice>
            )}
            <div className="modal-actions">
              <Button variant="secondary" disabled={action.busy} onClick={() => setQuote(null)}>
                {t('继续编辑')}
              </Button>
              <Button
                busy={action.busy}
                disabled={!confirmationAllowed}
                onClick={() => void submit()}
              >
                <CheckCircle2 size={16} />
                {t('确认并提交')}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

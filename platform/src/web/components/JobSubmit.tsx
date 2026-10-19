import { jobInputSchema } from '../../contracts/jobs';
import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Coins, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError, useRefresh } from '../lib/api';
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
export function JobSubmit({
  input,
  operation,
  valid = true,
  onCreated,
  label = '开始创作',
  forceConfirmation = false,
  prepareInput,
  recoveryScope,
  quoteFactory,
}: {
  input: JobInput;
  operation: Operation | undefined;
  valid?: boolean;
  onCreated?: (job: Job) => void;
  label?: string;
  forceConfirmation?: boolean;
  prepareInput?: (input: JobInput) => Promise<JobInput>;
  recoveryScope?: string;
  quoteFactory?: (input: JobInput) => Promise<Quote>;
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
  const confirmGeneration =
    forceConfirmation || session?.user.preferences.confirmGeneration !== false;
  const pendingRequest = useRef<{ quote: Quote; input: JobInput; id: string } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [snapshot, setSnapshot] = useState<JobInput | null>(null);
  const requestId = useRef<string | null>(null);
  const validated = jobInputSchema.safeParse(input);
  const action = useAction();
  const refresh = useRefresh();
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
      throw new Error(t('无法保存提交记录，本次尚未发送。'));
    }
    setStorageError(null);
    setRecovery(record);
    setRecoveryMissing(false);
    try {
      const job = await api<Job>(
        '/jobs',
        {
          method: 'POST',
          body: JSON.stringify({ input: payload, quoteId: data.id, clientRequestId: id }),
        },
        workspace.id,
      );
      try {
        removePendingSubmission(localStorage, session.user.id, workspace.id, id);
      } catch {
        setStorageError(t('任务已提交，但本机记录清理失败。再次进入时请核对该任务。'));
      }
      setRecovery(null);
      pendingRequest.current = null;
      setQuote(null);
      setSnapshot(null);
      await refresh();
      if (mounted.current) onCreated?.(job);
    } catch (error) {
      setQuote(null);
      if (error instanceof ApiError && submissionWasRejected(error)) {
        removePendingSubmission(localStorage, session.user.id, workspace.id, id);
        setRecovery(null);
        pendingRequest.current = null;
        setQuote(null);
      }
      throw error;
    }
  }
  async function estimate() {
    await action.run(
      async () => {
        if (!validated.success) throw new Error(t('请检查必填参数与数值范围。'));
        if (recovery) throw new Error(t('请先核对上次提交结果。'));
        let pending = pendingRequest.current;
        if (!pending || JSON.stringify(pending.input) !== JSON.stringify(input)) {
          const payload = prepareInput ? await prepareInput(input) : input;
          if (!mounted.current) return;
          const data = quoteFactory
            ? await quoteFactory(payload)
            : await api<Quote>(
                '/quotes',
                { method: 'POST', body: JSON.stringify(payload) },
                workspace!.id,
              );
          pending = { quote: data, input: structuredClone(payload), id: crypto.randomUUID() };
          pendingRequest.current = pending;
        }
        setSnapshot(pending.input);
        setQuote(pending.quote);
        requestId.current = pending.id;
        if (!confirmGeneration) await dispatch(pending.quote, pending.input, pending.id);
      },
      confirmGeneration ? undefined : t('任务已提交，可在任务中心查看进度'),
    );
  }
  async function submit() {
    if (!quote || !snapshot || !requestId.current) return;
    await action.run(
      () => dispatch(quote, snapshot, requestId.current!),
      t('任务已提交，可在任务中心查看进度'),
    );
  }
  async function recover() {
    if (!recovery || !session || !workspace) return;
    await action.run(async () => {
      try {
        const job = await api<Job>(`/jobs/by-request/${recovery.requestId}`, {}, workspace.id);
        removePendingSubmission(localStorage, session.user.id, workspace.id, recovery.requestId);
        setRecovery(null);
        setQuote(null);
        pendingRequest.current = null;
        await refresh();
        if (mounted.current) onCreated?.(job);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setRecoveryMissing(true);
          return;
        }
        throw error;
      }
    }, t('提交结果已核对'));
  }
  return (
    <div className="submit-block">
      {storageError && <Notice tone="warning">{storageError}</Notice>}
      {recovery && (
        <Notice tone="warning">
          <strong>{t('上次提交结果待核对')}</strong>
          <p>
            {recovery.input.prompt || t('已确认的创作任务')} · {recovery.quote.maxCredits}{' '}
            {t('额度上限')}
          </p>
          <p>{t('核对不会再次生成。请先找回原任务，避免重复提交。')}</p>
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
        <span className="muted">
          <Coins size={14} />
          {operation?.available
            ? confirmGeneration
              ? t('提交前确认实际估价')
              : t('按报价直接提交并预留额度')
            : t('连接服务后估价')}
        </span>
        <Button
          busy={action.busy}
          disabled={
            !canEdit ||
            !valid ||
            !validated.success ||
            !operation?.available ||
            !!recovery ||
            !!journal.error
          }
          onClick={() => void estimate()}
        >
          <Sparkles size={16} />
          {t(label)}
        </Button>
      </div>
      <Modal
        open={!!quote && confirmGeneration}
        onClose={() => {
          if (!action.busy) setQuote(null);
        }}
        title={t('确认创作')}
        description={t('本次任务会按以下配置执行，任务开始后可在任务中心查看结果。')}
      >
        {quote && snapshot && (
          <>
            <dl className="detail-list">
              <div>
                <dt>{t('处理方式')}</dt>
                <dd>{operation?.name ?? snapshot.operation}</dd>
              </div>
              <div>
                <dt>{t('生成模型')}</dt>
                <dd>{String(snapshot.options.model ?? snapshot.providerId)}</dd>
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
                  {operation &&
                    t(
                      operation.unit === 'second' ? '秒' : operation.unit === 'image' ? '张' : '次',
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
            {snapshot.operation === 'media.import' && (
              <Notice>
                {t(
                  '解析服务按调用另行收费，链接失效或解析后无法下载也可能收费。确认仅对当前链接执行一次；连接中断时请先核对原任务。',
                )}
              </Notice>
            )}
            <Notice>
              {t(
                '这里显示的是工作空间额度。供应商可能按实际调用另行收取费用。失败与取消按实际执行情况结算。',
              )}
            </Notice>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setQuote(null)}>
                {t('继续编辑')}
              </Button>
              <Button busy={action.busy} onClick={() => void submit()}>
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

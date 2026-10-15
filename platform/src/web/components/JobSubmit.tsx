import { jobInputSchema } from '../../contracts/jobs';
import { t } from '../lib/i18n';
import { useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Coins, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, post, useRefresh } from '../lib/api';
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
}: {
  input: JobInput;
  operation: Operation | undefined;
  valid?: boolean;
  onCreated?: (job: Job) => void;
  label?: string;
  forceConfirmation?: boolean;
}) {
  const { canEdit, session } = useStudio();
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
    try {
      const job = await post<Job>('/jobs', {
        input: payload,
        quoteId: data.id,
        clientRequestId: id,
      });
      pendingRequest.current = null;
      setQuote(null);
      setSnapshot(null);
      await refresh();
      onCreated?.(job);
    } catch (error) {
      if (error instanceof ApiError && ['QUOTE_EXPIRED', 'QUOTE_NOT_FOUND'].includes(error.code)) {
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
        let pending = pendingRequest.current;
        if (!pending || JSON.stringify(pending.input) !== JSON.stringify(input)) {
          const data = await post<Quote>('/quotes', input);
          pending = { quote: data, input: structuredClone(input), id: crypto.randomUUID() };
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
  return (
    <div className="submit-block">
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
          disabled={!canEdit || !valid || !validated.success || !operation?.available}
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
                  {snapshot.assetIds.length + snapshot.referenceAssetIds.length}
                  {t('项')}
                </dd>
              </div>
              <div>
                <dt>{t('输出')}</dt>
                <dd>
                  {quote.units}
                  {t('项')}
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

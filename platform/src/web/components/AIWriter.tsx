import type { EntitlementsDto } from './Entitlements';
import { dateTime, qs, type Page } from '../lib/api';
import { t } from '../lib/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import type { AssetDto } from '../../contracts/core';
import { jobInput, type Capabilities, type Job, type Operation } from '../lib/tasks';
import { useApi } from '../lib/api';
import { JobSubmit } from './JobSubmit';
import { designPlanResultSchema, type DesignPlan } from '../../contracts/design-plan';
import { DesignPlanResult } from './DesignPlanResult';
import { useModelCapability } from '../lib/use-model-capability';
import { ModelCapabilityStatus } from './ModelCapabilityStatus';
import {
  Badge,
  Button,
  Field,
  Loading,
  Modal,
  Notice,
  Pagination,
  ErrorState,
  useAction,
} from './ui';

type WriterMode = 'ideas' | 'design-plan';
export const writerRequestLimit = (operation?: Pick<Operation, 'providerId'>) =>
  operation?.providerId === 'dify' ? 8000 : 12000;
const writerModes = [
  { value: 'ideas', label: '创作建议' },
  { value: 'design-plan', label: '完整设计方案' },
] as const;

export function writerModeAvailability(operations: Operation[], mode: WriterMode) {
  const supported = operations.filter(
    (operation) =>
      operation.id === 'text.assist' && (mode === 'ideas' || operation.providerId === 'openai'),
  );
  const available = supported.some((operation) => operation.available);
  const reason = available
    ? null
    : (supported.find((operation) => operation.reason)?.reason ??
      (mode === 'design-plan'
        ? '当前空间没有支持完整设计方案的文字服务。图片生成服务不能用于生成设计方案。'
        : '当前空间没有可用的创作建议服务，请在设置中连接文字服务。'));
  return { operations: supported, available, reason };
}

export function AIWriterModeControls({
  mode,
  operations,
  ready,
  onChange,
}: {
  mode: WriterMode;
  operations: Operation[];
  ready: boolean;
  onChange: (mode: WriterMode) => void;
}) {
  const availability = {
    ideas: writerModeAvailability(operations, 'ideas'),
    'design-plan': writerModeAvailability(operations, 'design-plan'),
  };
  const selected = availability[mode];
  return (
    <>
      <div className="segments" role="group" aria-label={t('助手模式')}>
        {writerModes.map((option) => (
          <button
            type="button"
            key={option.value}
            className={mode === option.value ? 'active' : ''}
            aria-pressed={mode === option.value}
            disabled={!ready || !availability[option.value].available}
            title={ready ? t(availability[option.value].reason ?? option.label) : undefined}
            onClick={() => onChange(option.value)}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
      {ready && !selected.available ? (
        <Notice tone="warning">
          <strong>{t(mode === 'design-plan' ? '完整设计方案暂不可用' : '创作建议暂不可用')}</strong>
          <p>{t(selected.reason!)}</p>
          <p>{t('已有需求与历史结果仍保留，可以继续查看、复制或采用已生成的内容。')}</p>
          <div className="inline-actions">
            {mode === 'design-plan' && availability.ideas.available && (
              <Button variant="secondary" onClick={() => onChange('ideas')}>
                {t('切换到创作建议')}
              </Button>
            )}
            <Link className="text-button" to="/settings">
              {t('查看服务设置')}
            </Link>
          </div>
        </Notice>
      ) : ready && !availability['design-plan'].available ? (
        <p className="field-hint">
          {t('完整设计方案暂不可用')}：{t(availability['design-plan'].reason!)}
        </p>
      ) : null}
    </>
  );
}

export function AIWriter({
  open,
  onClose,
  onCloseAutoFocus,
  prompt,
  assets,
  projectId,
  onAccept,
  onAcceptPlan,
  technical,
}: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  prompt: string;
  assets: AssetDto[];
  projectId?: string;
  onAccept: (text: string) => void;
  onAcceptPlan?: (plan: DesignPlan, directionIndex: number) => void;
  technical?: DesignPlan['technical'];
}) {
  const [request, setRequest] = useState(prompt);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setRequest(prompt);
    }
    wasOpen.current = open;
  }, [open, prompt]);
  const [provider, setProvider] = useState('');
  const [assistantMode, setAssistantMode] = useState<WriterMode>('ideas');
  const [jobId, setJobId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const history = useApi<Page<Job>>(
    `/jobs${qs({ projectId, operation: 'text.assist', page: historyPage, pageSize: 10 })}`,
    open && !!projectId,
  );
  const caps = useApi<Capabilities>('/capabilities', open);
  const entitlements = useApi<EntitlementsDto>('/entitlements', open);
  const query = useApi<Job>(
    `/jobs/${jobId ?? ''}`,
    open && !!jobId,
    open && jobId ? 3000 : undefined,
  );
  const capabilitiesReady = !!caps.data && !caps.isLoading && !caps.error;
  const modeAvailability = writerModeAvailability(caps.data?.operations ?? [], assistantMode);
  const operations = modeAvailability.operations;
  const operation =
    operations.find((op) => op.providerId === provider) ??
    operations.find((op) => op.available) ??
    operations[0];
  const requestLimit = writerRequestLimit(operation);
  const capability = useModelCapability({
    operation,
    model: operation?.models[0],
    inputMode: assets.length ? 'image' : 'text',
    enabled: open && capabilitiesReady,
  });
  const requestTooLong = request.length > requestLimit;
  const requestDescriptionId = useId();
  const input = jobInput({
    operation: 'text.assist',
    providerId: operation?.providerId ?? 'openai',
    capabilityRevision: capability.revision,
    prompt: request,
    assetIds: assets.map((a) => a.id),
    referenceAssetIds: [],
    ...(projectId ? { projectId } : {}),
    options: { ...technical, model: operation?.models[0]?.id, assistantMode },
  });
  const results = query.data?.items ?? [];
  const action = useAction();
  return (
    <Modal
      open={open}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('AI 创作助手')}
      description={t('完善需求、组织画面细节或起草创意方案。生成前会明确确认报价。')}
      wide
    >
      <AIWriterModeControls
        mode={assistantMode}
        operations={caps.data?.operations ?? []}
        ready={capabilitiesReady}
        onChange={(mode) => {
          setAssistantMode(mode);
          // A service selected in another mode may no longer be available.
          // Let the destination mode choose its first usable service.
          setProvider('');
          setJobId(null);
        }}
      />
      {caps.isLoading && <Loading label={t('正在读取可用的创作服务…')} />}
      {caps.error && <ErrorState error={caps.error} retry={caps.refetch} />}
      {assistantMode === 'design-plan' && (
        <Notice>{t('生成包含目标、受众、视觉方向、文案与物料规划的设计方案。')}</Notice>
      )}
      {!!history.data?.items.length && (
        <Field label={t('本项目已保存的建议与方案')}>
          <select
            value={jobId ?? ''}
            onChange={(event) => {
              const selected = history.data.items.find((job) => job.id === event.target.value);
              setJobId(selected?.id ?? null);
              if (selected)
                setAssistantMode(
                  selected.input.options.assistantMode === 'design-plan' ? 'design-plan' : 'ideas',
                );
            }}
          >
            <option value="">{t('选择历史任务')}</option>
            {history.data.items.map((job) => (
              <option key={job.id} value={job.id}>
                {dateTime(job.createdAt)} ·{' '}
                {t(job.input.options.assistantMode === 'design-plan' ? '设计方案' : '创作建议')} ·{' '}
                {job.input.prompt.slice(0, 50)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {projectId && operation?.providerId === 'openai' && (
        <p className="field-hint">{t('会参考本项目最近的创作对话，最多 8 条、6000 字符。')}</p>
      )}
      {history.data && (
        <Pagination
          page={historyPage}
          total={history.data.total}
          pageSize={history.data.pageSize}
          onPage={setHistoryPage}
        />
      )}
      {history.error && <ErrorState error={history.error} retry={history.refetch} />}
      {query.error && <ErrorState error={query.error} retry={query.refetch} />}
      <Field label={t('你的需求')}>
        <textarea
          aria-label={t('你的需求')}
          aria-invalid={requestTooLong || undefined}
          aria-describedby={`${requestDescriptionId}-count${requestTooLong ? ` ${requestDescriptionId}-error` : ''}`}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={5}
          placeholder={t('例如：帮我把这份需求整理成一个清晰、可执行的产品主图创作提示词…')}
        />
        <span className="field-hint" id={`${requestDescriptionId}-count`}>
          {t('{count} / {limit} 字符')
            .replace('{count}', String(request.length))
            .replace('{limit}', String(requestLimit))}
        </span>
        {requestTooLong && (
          <span className="field-error" id={`${requestDescriptionId}-error`} role="alert">
            {t(
              '当前服务最多支持 {limit} 个字符，已超出 {excess} 个。请缩短需求后再生成；现有内容已完整保留。',
            )
              .replace('{limit}', String(requestLimit))
              .replace('{excess}', String(request.length - requestLimit))}
          </span>
        )}
      </Field>
      <Field label={t('文案服务')}>
        <select
          value={operation?.providerId ?? ''}
          disabled={!capabilitiesReady || !modeAvailability.available}
          onChange={(e) => setProvider(e.target.value)}
        >
          {!operations.length && <option value="">{t('当前模式没有可用的文案服务')}</option>}
          {operations.map((op) => (
            <option key={op.providerId} value={op.providerId} disabled={!op.available}>
              {op.providerId} · {op.models[0]?.name ?? op.name}
              {op.available ? '' : t('（未连接）')}
            </option>
          ))}
        </select>
      </Field>
      {operation?.providerId === 'dify' && !!assets.length ? (
        <Notice tone="warning">{t('当前创作策划仅处理文字，请先在创作框移除附件后生成。')}</Notice>
      ) : (
        !!assets.length && (
          <p className="field-hint">
            {t('同时参考当前选择的')}
            {assets.length}
            {t('份素材。')}
          </p>
        )
      )}
      {entitlements.data && (
        <p className="field-hint">
          {t('今日文案免费剩余')} {entitlements.data.freeTextAssist.remaining} /{' '}
          {entitlements.data.freeTextAssist.limit} · {t('下次重置：')}
          {dateTime(entitlements.data.freeTextAssist.resetAt)}
          <br />
          {t('免费次数按工作空间统计，提交即消耗，失败不返还；供应商仍可能收费。')}
        </p>
      )}
      <ModelCapabilityStatus capability={capability} />
      <JobSubmit
        forceConfirmation
        input={input}
        operation={operation}
        valid={
          capabilitiesReady &&
          capability.canGenerate &&
          modeAvailability.available &&
          !!request.trim() &&
          !requestTooLong &&
          !(operation?.providerId === 'dify' && assets.length > 0)
        }
        label={assistantMode === 'design-plan' ? t('生成设计方案') : t('生成创作建议')}
        onCreated={(job) => setJobId(job.id)}
      />
      {query.data && ['queued', 'running'].includes(query.data.status) && (
        <Loading label={query.data.stage} />
      )}
      <div className="section-spaced">
        {query.data?.errorMessage && <Notice tone="warning">{query.data.errorMessage}</Notice>}
        {results.map((item) => {
          const structured = designPlanResultSchema.safeParse(item.resultData);
          if (structured.success)
            return (
              <DesignPlanResult
                key={item.id}
                plan={structured.data.plan}
                onApply={
                  onAcceptPlan
                    ? (plan, index) => {
                        onAcceptPlan(plan, index);
                        onClose();
                      }
                    : undefined
                }
              />
            );
          const text = item.resultText;
          if (!text) return null;
          return (
            <div className="assistant-result" key={item.id}>
              <Badge tone="green">{t('真实生成建议')}</Badge>
              <pre>{text}</pre>
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  onClick={() =>
                    void action.run(() => navigator.clipboard.writeText(text), '建议已复制')
                  }
                >
                  <Copy size={15} />
                  {t('复制')}
                </Button>
                <Button
                  onClick={() => {
                    onAccept(text);
                    onClose();
                  }}
                >
                  <Check size={15} />
                  {t('采用这份建议')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

import type { EntitlementsDto } from './Entitlements';
import { dateTime } from '../lib/api';
import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { AssetDto } from '../../contracts/core';
import { jobInput, type Capabilities, type Job } from '../lib/tasks';
import { useApi } from '../lib/api';
import { JobSubmit } from './JobSubmit';
import { Badge, Button, Field, Loading, Modal, Notice, Segments, useAction } from './ui';
export function AIWriter({
  open,
  onClose,
  prompt,
  assets,
  projectId,
  onAccept,
}: {
  open: boolean;
  onClose: () => void;
  prompt: string;
  assets: AssetDto[];
  projectId?: string;
  onAccept: (text: string) => void;
}) {
  const [request, setRequest] = useState(prompt);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setRequest(prompt);
      setJobId(null);
    }
    wasOpen.current = open;
  }, [open, prompt]);
  const [provider, setProvider] = useState('');
  const [assistantMode, setAssistantMode] = useState<'ideas' | 'design-plan'>('ideas');
  const [jobId, setJobId] = useState<string | null>(null);
  const caps = useApi<Capabilities>('/capabilities', open);
  const entitlements = useApi<EntitlementsDto>('/entitlements', open);
  const query = useApi<Job>(
    `/jobs/${jobId ?? ''}`,
    open && !!jobId,
    open && jobId ? 3000 : undefined,
  );
  const operations =
    caps.data?.operations.filter(
      (op) => op.id === 'text.assist' && (assistantMode === 'ideas' || op.providerId === 'openai'),
    ) ?? [];
  const operation =
    operations.find((op) => op.providerId === provider) ??
    operations.find((op) => op.available) ??
    operations[0];
  const input = jobInput({
    operation: 'text.assist',
    providerId: operation?.providerId ?? 'openai',
    prompt: request,
    assetIds: assets.map((a) => a.id),
    referenceAssetIds: [],
    ...(projectId ? { projectId } : {}),
    options: { model: operation?.models[0]?.id, assistantMode },
  });
  const texts =
    query.data?.items.flatMap((item) => (item.resultText ? [item.resultText] : [])) ?? [];
  const action = useAction();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('AI 创作助手')}
      description={t('完善需求、组织画面细节或起草创意方案。生成前会明确确认报价。')}
      wide
    >
      <Segments
        value={assistantMode}
        onChange={(mode) => {
          setAssistantMode(mode);
          setJobId(null);
        }}
        options={[
          { value: 'ideas', label: '创作建议' },
          { value: 'design-plan', label: '完整设计方案' },
        ]}
      />
      {assistantMode === 'design-plan' && (
        <Notice>{t('生成包含目标、受众、视觉方向、文案与物料规划的设计方案。')}</Notice>
      )}
      {projectId && operation?.providerId === 'openai' && (
        <p className="field-hint">{t('会参考本项目最近的创作对话，最多 8 条、6000 字符。')}</p>
      )}
      <Field label={t('你的需求')}>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          maxLength={12000}
          rows={5}
          placeholder={t('例如：帮我把这份需求整理成一个清晰、可执行的产品主图创作提示词…')}
        />
      </Field>
      <Field label={t('文案服务')}>
        <select value={operation?.providerId ?? ''} onChange={(e) => setProvider(e.target.value)}>
          {operations.map((op) => (
            <option key={op.providerId} value={op.providerId}>
              {op.providerId} · {op.models[0]?.name ?? op.name}
              {op.available ? '' : t('（未连接）')}
            </option>
          ))}
        </select>
      </Field>
      {!!assets.length && (
        <p className="field-hint">
          {t('同时参考当前选择的')}
          {assets.length}
          {t('份素材。')}
        </p>
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
      <JobSubmit
        forceConfirmation
        input={input}
        operation={operation}
        valid={!!request.trim()}
        label={assistantMode === 'design-plan' ? t('生成设计方案') : t('生成创作建议')}
        onCreated={(job) => setJobId(job.id)}
      />
      {query.data && ['queued', 'running'].includes(query.data.status) && (
        <Loading label={query.data.stage} />
      )}
      <div className="section-spaced">
        {query.data?.errorMessage && <Notice tone="warning">{query.data.errorMessage}</Notice>}
        {texts.map((text, index) => (
          <div className="assistant-result" key={index}>
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
        ))}
      </div>
    </Modal>
  );
}

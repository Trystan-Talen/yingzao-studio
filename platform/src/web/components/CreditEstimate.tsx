import { Coins } from 'lucide-react';
import { estimateCreationCredits } from '../../contracts/credit-estimate';
import type { CreditDto, JobInput, OperationCapability } from '../../contracts/jobs';
import { useApi } from '../lib/api';
import { t } from '../lib/i18n';
import '../styles/credit-estimate.css';

/** Reads account balance only; never prepares a brief, quote, project or generation. */
export function CreditEstimate({
  input,
  operation,
  ready = true,
}: {
  input: JobInput;
  operation: OperationCapability | undefined;
  ready?: boolean;
}) {
  const estimate = ready ? estimateCreationCredits(input, operation) : undefined;
  const balance = useApi<CreditDto>('/credits', !!operation?.available);
  const available =
    !balance.error && Number.isFinite(balance.data?.available)
      ? balance.data?.available
      : undefined;
  const insufficient =
    estimate?.status === 'ready' && available !== undefined && available < estimate.credits;
  return (
    <div className="credit-estimate" aria-live="polite" aria-atomic="true">
      <span className="credit-estimate-value">
        <Coins size={15} aria-hidden="true" />
        {estimate?.status === 'ready'
          ? t('预计 {credits} 积分').replace('{credits}', String(estimate.credits))
          : t(ready ? '积分暂无法预估' : '积分待核对')}
      </span>
      <span
        className="credit-estimate-note"
        title={t('工作空间积分预估，以最终确认为准；供应商费用另计。')}
      >
        {t('空间积分 · 供应商费用另计')}
      </span>
      {insufficient && (
        <span className="credit-estimate-warning" role="status">
          {t('可用 {credits} 积分，可能不足').replace('{credits}', String(available))}
        </span>
      )}
    </div>
  );
}

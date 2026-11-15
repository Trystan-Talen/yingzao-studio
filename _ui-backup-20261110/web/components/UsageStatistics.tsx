import { t } from '../lib/i18n';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { put, qs, useApi, useRefresh, type Page } from '../lib/api';
import { Badge, Button, Confirm, Empty, ErrorState, Field, Loading, Notice, useAction } from './ui';
import { useStudio } from '../context';
interface MemberBudget {
  userId: string;
  displayName: string;
  creditLimit: number | null;
  spent: number;
  reserved: number;
}
export function TeamCreditSettings() {
  const { isAdmin } = useStudio();
  const settings = useApi<{ mode: 'shared' | 'allocated'; concurrencyLimit: number }>(
    '/credits/settings',
  );
  const [nextMode, setNextMode] = useState<'shared' | 'allocated' | null>(null);
  const action = useAction();
  const refresh = useRefresh();
  return (
    <div className="section-spaced">
      <Field label={t('团队额度使用方式')}>
        <select
          value={settings.data?.mode ?? 'shared'}
          disabled={!isAdmin || settings.isLoading}
          onChange={(e) => setNextMode(e.target.value as 'shared' | 'allocated')}
        >
          <option value="shared">{t('共享额度')}</option>
          <option value="allocated">{t('按成员分配')}</option>
        </select>
      </Field>
      <p className="field-hint">
        {t(
          '共享模式下成员使用团队可用额度，并遵守个人上限。分配模式下，未分配预算的成员不能提交新任务。',
        )}
      </p>
      <Confirm
        open={!!nextMode}
        onClose={() => setNextMode(null)}
        title={t('变更团队额度方式？')}
        description={t(
          '已有任务的预留与结算记录保留。切换至分配模式后，请为每位需要创作的成员设置预算。',
        )}
        busy={action.busy}
        onConfirm={() =>
          void action.run(async () => {
            await put('/credits/settings', { mode: nextMode });
            setNextMode(null);
            await refresh();
          }, '额度模式已更新')
        }
      />
    </div>
  );
}
export function UsageStatistics() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const query = useApi<Page<{ userId: string; displayName: string; spent: number; jobs: number }>>(
    `/usage${qs({ from, to })}`,
    !from || !to || from <= to,
  );
  const budgets = useApi<Page<MemberBudget>>('/credits/members');
  function exportCsv() {
    const safe = (value: string) =>
      `"${(/^[=+@\-\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
    const lines = [
      '成员,成功结算任务,已用额度',
      ...(query.data?.items ?? []).map((item) =>
        [safe(item.displayName), item.jobs, item.spent].join(','),
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usage-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="section-spaced">
      <div className="toolbar">
        <div className="inline-actions">
          <Field label={t('开始日期')}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('结束日期')}>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Button variant="secondary" disabled={!query.data?.items.length} onClick={exportCsv}>
          <Download size={15} />
          {t('导出统计')}
        </Button>
      </div>
      {from && to && from > to && <Notice tone="warning">{t('结束日期不能早于开始日期。')}</Notice>}
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : query.data?.items.length ? (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('成员')}</th>
                <th>{t('成功结算任务')}</th>
                <th>{t('已使用额度')}</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((item) => (
                <tr key={item.userId}>
                  <td>{item.displayName}</td>
                  <td>{item.jobs}</td>
                  <td>{item.spent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={t('所选日期没有已结算任务')}
          description={t('统计来自真实账本，不包含灵感示例或未执行的草稿。')}
        />
      )}
      <div className="section-heading section-spaced">
        <h2>{t('成员预算与预留')}</h2>
        <Badge>{t('当前状态')}</Badge>
      </div>
      {budgets.error ? (
        <ErrorState error={budgets.error} />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('成员')}</th>
                <th>{t('预算上限')}</th>
                <th>{t('累计使用')}</th>
                <th>{t('当前预留')}</th>
                <th>{t('预算余量')}</th>
              </tr>
            </thead>
            <tbody>
              {budgets.data?.items.map((item) => (
                <tr key={item.userId}>
                  <td>{item.displayName}</td>
                  <td>{item.creditLimit ?? '共享额度'}</td>
                  <td>{item.spent}</td>
                  <td>{item.reserved}</td>
                  <td>
                    {item.creditLimit === null
                      ? t('遵循空间余额')
                      : Math.max(0, item.creditLimit - item.spent - item.reserved)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

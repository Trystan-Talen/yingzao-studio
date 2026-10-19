import type { CreditBucketDto } from '../../contracts/credits';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { dateTime, useApi } from '../lib/api';
import { t } from '../lib/i18n';
import { Badge, Button, Empty, ErrorState, Loading, Notice, Pagination } from './ui';

const sourceLabels: Record<CreditBucketDto['source'], string> = {
  initial: '初始额度',
  legacy: '历史导入',
  subscription: '会员额度',
  pack: '额度包',
  referral: '推荐奖励',
  redemption: '兑换额度',
  manual: '管理员调整',
  'legacy-refund': '历史退款',
};
const statusLabels = { active: '有效', archived: '已封存', expired: '已失效' };
const pageSize = 20;

export function CreditBuckets({
  endpoint = '/credits/buckets',
  apiAccount = false,
}: {
  endpoint?: string;
  apiAccount?: boolean;
}) {
  const query = useApi<CreditBucketDto[]>(endpoint, true, 30000);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const all = query.data ?? [];
  const filtered = all.filter((item) => status === 'all' || item.status === status);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(1), [status]);
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [filtered.length, page]);
  const now = Date.now();
  const expiring = all.reduce((sum, item) => {
    const expires = item.expiresAt ? Date.parse(item.expiresAt) : Number.POSITIVE_INFINITY;
    return (
      sum +
      (item.status === 'active' && expires >= now && expires <= now + 30 * 86400000
        ? item.available
        : 0)
    );
  }, 0);
  return (
    <section className="section-spaced credit-buckets">
      <div className="section-heading">
        <div>
          <h2>{t('额度来源与有效期')}</h2>
          <p className="muted">{t('每笔额度分别记录有效期，封存额度不能用于新任务。')}</p>
        </div>
        <Button variant="ghost" onClick={() => void query.refetch()} busy={query.isFetching}>
          <RefreshCw size={15} />
          {t('刷新')}
        </Button>
      </div>
      <Notice>
        {t(
          apiAccount
            ? '接口额度包自付款起有效 1 年，再次购买会延长本账户尚未失效的额度包。网页会员额度不计入此账户。'
            : '每笔会员额度分别遵循对应合同的到期、封存和续费规则；请查看对应订单条款。额度包自付款起有效 1 年，再次购买会延长尚未失效的同类额度包。',
        )}
      </Notice>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : (
        <>
          <div className="stat-grid section-spaced">
            <div className="stat-card">
              <span>{t('当前可用')}</span>
              <strong>{all.reduce((sum, item) => sum + item.available, 0).toLocaleString()}</strong>
              <small>{t('各有效来源的可用额度合计')}</small>
            </div>
            <div className="stat-card">
              <span>{t('封存不可用')}</span>
              <strong>{all.reduce((sum, item) => sum + item.archived, 0).toLocaleString()}</strong>
              <small>{t('不包含已经预留给任务的额度')}</small>
            </div>
            <div className="stat-card">
              <span>{t('30 天内到期')}</span>
              <strong>{expiring.toLocaleString()}</strong>
              <small>{t('仅统计当前仍可用的额度')}</small>
            </div>
          </div>
          <div className="toolbar section-spaced">
            <h3>{t('来源记录')}</h3>
            <select
              aria-label={t('额度有效状态')}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">{t('全部状态')}</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </div>
          {visible.length ? (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('来源')}</th>
                    <th>{t('状态')}</th>
                    <th>{t('原始发放')}</th>
                    <th>{t('可用 / 封存')}</th>
                    <th>{t('在途预留')}</th>
                    <th>{t('有效期')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{t(sourceLabels[item.source])}</strong>
                        <small className="block muted">{dateTime(item.createdAt)}</small>
                      </td>
                      <td>
                        <Badge
                          tone={
                            item.status === 'active'
                              ? 'green'
                              : item.status === 'archived'
                                ? 'orange'
                                : 'neutral'
                          }
                        >
                          {t(statusLabels[item.status])}
                        </Badge>
                      </td>
                      <td className="numeric">{item.granted.toLocaleString()}</td>
                      <td className="numeric">
                        {item.available.toLocaleString()} / {item.archived.toLocaleString()}
                      </td>
                      <td className="numeric">{item.reserved.toLocaleString()}</td>
                      <td>
                        {item.expiresAt
                          ? dateTime(item.expiresAt)
                          : t(
                              item.source === 'legacy' || item.source === 'legacy-refund'
                                ? '历史有效期未知，当前不设到期'
                                : '未设置到期时间',
                            )}
                        {item.archiveUntil && (
                          <small className="block muted">
                            {t('封存截止：')}
                            {dateTime(item.archiveUntil)}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={t('没有符合筛选的额度来源')}
              description={t('额度发放后会在这里显示来源和有效期。')}
            />
          )}
          <Pagination page={page} total={filtered.length} pageSize={pageSize} onPage={setPage} />
          <p className="muted section-spaced">
            {t(
              '到期或封存不会重复扣减在途预留；任务完成后按原来源结算。恢复和延长有效期以已确认付款或管理员审计记录为准。',
            )}
          </p>
        </>
      )}
    </section>
  );
}

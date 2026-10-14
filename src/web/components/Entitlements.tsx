import type { z } from 'zod';
import type { EntitlementsSchema } from '../../contracts/entitlements';
import { dateTime, useApi } from '../lib/api';
import { t } from '../lib/i18n';
import { Badge, ErrorState, Loading, Notice } from './ui';
export type EntitlementsDto = z.infer<typeof EntitlementsSchema>;
const labels = {
  projects: '项目',
  seats: '团队席位',
  brands: '品牌',
  characters: '人物',
  apiKeys: 'API 密钥',
};
export const entitlementLabels: Record<string, string> = {
  ...labels,
  concurrency: '并发任务上限',
  textAssistDailyFreeUnits: '每日文案免费次数',
};
export function EntitlementsPanel() {
  const query = useApi<EntitlementsDto>('/entitlements');
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={query.refetch} />;
  if (!query.data) return null;
  const data = query.data;
  return (
    <section className="panel settings-panel">
      <div className="section-heading">
        <h2>{t('当前空间权益')}</h2>
        <Badge>{data.source === 'subscription' ? t('有效订阅权益') : t('基础权益')}</Badge>
      </div>
      <div className="stat-grid four">
        {Object.entries(labels).map(([key, label]) => (
          <div className="stat-card" key={key}>
            <span>{t(label)}</span>
            <strong>
              {data.used[key as keyof typeof labels]} / {data.limits[key as keyof typeof labels]}
            </strong>
            <small>{t('已用 / 上限')}</small>
          </div>
        ))}
        <div className="stat-card">
          <span>{t('并发任务上限')}</span>
          <strong>{data.limits.concurrency}</strong>
        </div>
      </div>
      <Notice>{t('权益限制在创建资源和提交任务时检查；已有资源不会因额度调整而被删除。')}</Notice>
      <div className="section-spaced">
        <h3>{t('每日文案免费次数')}</h3>
        <p>
          {data.freeTextAssist.remaining} / {data.freeTextAssist.limit} · {t('下次重置：')}
          {dateTime(data.freeTextAssist.resetAt)}
        </p>
        <p className="muted">
          {t(
            '按 UTC 日期与工作空间统计，成功提交即消耗次数，失败不会返还。它不等同于余额，也不代表供应商免费。',
          )}
        </p>
      </div>
    </section>
  );
}

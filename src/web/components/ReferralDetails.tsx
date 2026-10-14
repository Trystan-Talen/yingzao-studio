import { useState } from 'react';
import { t } from '../lib/i18n';
import { dateTime, downloadFile, money, useApi, type Page } from '../lib/api';
import { ErrorState, Loading, Notice, Pagination, Button, useAction } from './ui';
export interface ReferralSummary {
  inviteCode: string | null;
  inviteUrl: string | null;
  qualifiedCount: number;
  rewardCredits: number;
  providerConfigured: boolean;
  registeredCount: number;
  registrationEnabled: boolean;
  rewardsEnabled: boolean;
  channelEnabled: boolean;
  rewardRule: { credits: number; minimumPaidMinor: number; currency: string } | null;
}
export function ReferralDetails({ info }: { info: ReferralSummary | undefined }) {
  const action = useAction();
  const [page, setPage] = useState(1);
  const records = useApi<
    Page<{
      id: string;
      registeredAt: string;
      qualified: boolean;
      rewardCredits: number;
      reversedCredits: number;
    }>
  >(`/referrals/records?page=${page}&pageSize=20`);
  const channel = useApi<
    ReferralSummary & { paidOrderCount: number; paidAmountMinor: number; currency: string }
  >('/referrals/channel/summary', !!info?.channelEnabled);
  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <span>{t('已归因注册')}</span>
          <strong>{info?.registeredCount ?? 0}</strong>
        </div>
      </div>
      <Notice>
        {info?.registrationEnabled
          ? t('推荐链接可用于注册归因，是否获得奖励以实际规则和付款核验为准。')
          : t('自由注册尚未开放。推荐链接不会绕过注册规则，有效团队邀请仍可用于注册。')}
      </Notice>
      {info?.rewardsEnabled && info.rewardRule ? (
        <p className="muted">
          {t('奖励条件')}：{t('最低已支付金额')}{' '}
          {money(info.rewardRule.minimumPaidMinor, info.rewardRule.currency)} ·{' '}
          {t('每次符合条件奖励')} {info.rewardRule.credits} {t('额度')}
        </p>
      ) : (
        <Notice>{t('推荐奖励未启用，当前只保留注册归因，不承诺现金或额度奖励。')}</Notice>
      )}
      <h2 className="section-spaced">{t('推荐记录')}</h2>
      {records.isLoading ? (
        <Loading />
      ) : records.error ? (
        <ErrorState error={records.error} retry={records.refetch} />
      ) : records.data?.items.length ? (
        <>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('注册时间')}</th>
                  <th>{t('达成条件')}</th>
                  <th>{t('奖励额度')}</th>
                  <th>{t('已冲回额度')}</th>
                </tr>
              </thead>
              <tbody>
                {records.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{dateTime(item.registeredAt)}</td>
                    <td>{item.qualified ? t('已达成') : t('未达成')}</td>
                    <td>{item.rewardCredits}</td>
                    <td>{item.reversedCredits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={records.data.pageSize}
            total={records.data.total}
            onPage={setPage}
          />
        </>
      ) : (
        <p className="muted">{t('暂无推荐注册记录')}</p>
      )}
      {info?.channelEnabled && (
        <section className="section-spaced">
          <div className="section-heading">
            <h2>{t('渠道概览')}</h2>
            <Button
              variant="secondary"
              busy={action.busy}
              onClick={() =>
                void action.run(
                  () => downloadFile('/api/v1/referrals/channel/export', 'referral-channel.csv'),
                  '渠道报表已下载',
                )
              }
            >
              {t('导出渠道报表')}
            </Button>
          </div>
          {channel.error ? (
            <ErrorState error={channel.error} retry={channel.refetch} />
          ) : channel.data ? (
            <div className="stat-grid">
              <div className="stat-card">
                <span>{t('已付款订单')}</span>
                <strong>{channel.data.paidOrderCount}</strong>
              </div>
              <div className="stat-card">
                <span>{t('已付款金额')}</span>
                <strong>{money(channel.data.paidAmountMinor, channel.data.currency)}</strong>
              </div>
            </div>
          ) : (
            <Loading />
          )}
        </section>
      )}
    </>
  );
}

import { useState } from 'react';
import { t } from '../lib/i18n';
import { dateTime, downloadFile, money, useApi, type Page } from '../lib/api';
import { ErrorState, Loading, Notice, Pagination, Button, useAction } from './ui';
import type { ReferralRuleDto } from '../../contracts/referrals';
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
  rewardRule: ReferralRuleDto | null;
}
function RuleDetails({ rule }: { rule: ReferralRuleDto }) {
  if (rule.missingConfiguration?.length)
    return (
      <Notice>
        {t('自动返奖尚未就绪')}：{rule.missingConfiguration.map((reason) => t(reason)).join('；')}
      </Notice>
    );
  if (!rule.enabled) return <p className="muted">{t('该版本未启用奖励')}</p>;
  if (!rule.policy)
    return (
      <p className="muted">
        {t('最低已支付金额')} {money(rule.minimumPaidMinor, rule.currency)} ·{' '}
        {t('每位被邀请人首次达标奖励一次')} {rule.credits} {t('额度')} · {t('计入邀请人的个人空间')}
      </p>
    );
  const policy = rule.policy;
  const rounding = {
    unconfigured: '未配置',
    floor: '向下取整',
    ceil: '向上取整',
    nearest: '四舍五入',
  };
  const membership = {
    unconfigured: '会员资格要求未配置',
    none: '不额外要求会员身份',
    'referrer-active-at-payment': '付款时邀请人须为有效个人会员',
    'invitee-active-at-payment': '付款时被邀请人须为有效个人会员',
    'both-active-at-payment': '付款时双方须为有效个人会员',
  };
  return (
    <div className="muted">
      <p>
        {t(
          '注册后30天内首次购买个人会员：邀请人获得套餐算力15%，被邀请人获得10%。奖励发放后7天有效，分别计入双方个人空间。',
        )}
      </p>
      <p>{t('算力包、团队订阅、接口充值和测试付款不参与；退款按比例冲回奖励。')}</p>
      <p>
        {t('本部署已确认规则')}：{t(rounding[policy.rounding])} ·{' '}
        {t(membership[policy.membershipRequirement])}
      </p>
    </div>
  );
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
      rule?: ReferralRuleDto;
      qualificationStatus?: string;
      qualificationReason?: string;
      rewards?: { role: string; credits: number; reversedCredits: number; expiresAt: string }[];
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
      {info?.rewardRule ? (
        <section>
          <h3>{t('当前新注册适用规则')}</h3>
          <RuleDetails rule={info.rewardRule} />
        </section>
      ) : (
        <Notice>{t('推荐奖励未启用，当前只保留注册归因，不承诺现金或额度奖励。')}</Notice>
      )}
      <p className="muted">
        {t('历史邀请按注册时保存的规则结算，不随当前规则更新；累计奖励不等于当前可用余额。')}
      </p>
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
                  <th>{t('注册时适用规则')}</th>
                </tr>
              </thead>
              <tbody>
                {records.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{dateTime(item.registeredAt)}</td>
                    <td>
                      {item.qualificationStatus === 'blocked'
                        ? t('待配置或核对')
                        : item.qualified
                          ? t('已达成')
                          : t('未达成')}
                      {item.qualificationReason && (
                        <p className="muted">{t(item.qualificationReason)}</p>
                      )}
                    </td>
                    <td>{item.rewardCredits}</td>
                    <td>{item.reversedCredits}</td>
                    <td>
                      {item.rule && (
                        <details>
                          <summary>
                            {t('规则版本')} {item.rule.version}
                          </summary>
                          <RuleDetails rule={item.rule} />
                          {item.rewards?.map((reward) => (
                            <p key={reward.role}>
                              {reward.role === 'referrer' ? t('邀请人') : t('被邀请人')}：
                              {reward.credits} {t('额度')} · {t('已冲回额度')}{' '}
                              {reward.reversedCredits} · {t('到期时间')}{' '}
                              {dateTime(reward.expiresAt)}
                            </p>
                          ))}
                        </details>
                      )}
                    </td>
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

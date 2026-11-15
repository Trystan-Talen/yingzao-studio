import { useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { useStudio } from '../context';
import { dateTime, useApi } from '../lib/api';
import { t } from '../lib/i18n';
import { Badge, Button, Empty, ErrorState, Field, Loading, Notice, Pagination } from './ui';

type DeliveryState =
  'queued' | 'sending' | 'retry' | 'accepted' | 'failed' | 'reconciliation_required' | 'cancelled';
interface MailStatus {
  id: string;
  workspaceId: string;
  status: DeliveryState;
  attempts: number;
  nextAttemptAt: string | null;
  errorCode: string | null;
  smtpResponseCode: number | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
}
export interface MailDeliveryStatusDto {
  enabled: boolean;
  items: MailStatus[];
}
export type InvitationMailDelivery =
  { status: 'disabled' | 'not-applicable' } | { status: 'queued' | 'existing'; id: string };
const labels: Record<DeliveryState, string> = {
  queued: '邮件已排队',
  sending: '正在投递',
  retry: '等待重试',
  accepted: '邮件服务器已接受',
  failed: '投递失败',
  reconciliation_required: '投递结果待核对',
  cancelled: '已取消',
};
export function MailDeliveryStatus() {
  const { isAdmin } = useStudio();
  const result = useApi<MailDeliveryStatusDto>('/mail-deliveries', isAdmin, 15_000);
  const [filter, setFilter] = useState<DeliveryState | ''>('');
  const [page, setPage] = useState(1);
  if (!isAdmin)
    return (
      <Empty
        icon={<Mail size={28} />}
        title={t('邮件记录仅供空间管理员查看')}
        description={t('请联系当前空间的创建者或管理员。')}
      />
    );
  if (result.isLoading) return <Loading />;
  if (result.error) return <ErrorState error={result.error} retry={result.refetch} />;
  const items = (result.data?.items ?? []).filter((item) => !filter || item.status === filter);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(items.length / 10)));
  return (
    <section className="panel settings-panel section-spaced mail-delivery-panel">
      <div className="section-heading">
        <div>
          <h2>{t('邮件投递状态')}</h2>
          <p className="muted">
            {t('当前工作空间最近 50 条投递记录。这里只展示状态，不展示收件人或邮件正文。')}
          </p>
        </div>
        <Button variant="secondary" busy={result.isFetching} onClick={() => void result.refetch()}>
          <RefreshCw size={15} />
          {t('刷新')}
        </Button>
      </div>
      <Notice tone={result.data?.enabled ? 'info' : 'warning'}>
        {result.data?.enabled
          ? t('邮件服务已启用。排队不代表发送成功；服务器已接受也不保证邮件进入收件箱。')
          : t('当前未启用邮件服务。团队邀请仍可复制链接后自行发送。')}
      </Notice>
      <Field label={t('投递状态')}>
        <select
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as typeof filter);
            setPage(1);
          }}
        >
          <option value="">{t('全部状态')}</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </Field>
      {!items.length ? (
        <Empty
          icon={<Mail size={28} />}
          title={t('暂无符合条件的邮件记录')}
          description={t('启用服务后，符合规则的团队邀请与支持通知会记录实际投递状态。')}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('记录')}</th>
                  <th>{t('投递状态')}</th>
                  <th>{t('尝试次数')}</th>
                  <th>{t('下次重试')}</th>
                  <th>{t('更新时间')}</th>
                  <th>{t('状态详情')}</th>
                </tr>
              </thead>
              <tbody>
                {items.slice((currentPage - 1) * 10, currentPage * 10).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <code title={item.id}>{item.id.slice(0, 8)}</code>
                      <small className="muted">{dateTime(item.createdAt)}</small>
                    </td>
                    <td>
                      <Badge
                        tone={
                          item.status === 'accepted'
                            ? 'green'
                            : ['failed', 'reconciliation_required'].includes(item.status)
                              ? 'orange'
                              : 'neutral'
                        }
                      >
                        {t(labels[item.status])}
                      </Badge>
                    </td>
                    <td>{item.attempts}</td>
                    <td>{dateTime(item.nextAttemptAt)}</td>
                    <td>{dateTime(item.updatedAt)}</td>
                    <td>
                      {item.status === 'accepted' ? (
                        <span>
                          {t('服务器接受时间')}: {dateTime(item.acceptedAt)}
                        </span>
                      ) : item.errorCode ? (
                        <code>{item.errorCode}</code>
                      ) : (
                        '—'
                      )}
                      {item.smtpResponseCode !== null && (
                        <small className="muted">SMTP {item.smtpResponseCode}</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={currentPage} total={items.length} pageSize={10} onPage={setPage} />
        </>
      )}
      <p className="field-hint">
        {t('等待重试由服务端按计划处理；结果待核对时不会自动重复发送。此页不提供强制重发。')}
      </p>
    </section>
  );
}

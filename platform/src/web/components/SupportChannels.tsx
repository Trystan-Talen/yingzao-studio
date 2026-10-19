import { useState } from 'react';
import type { SupportChannelsDto } from '../../contracts/support';
import { t } from '../lib/i18n';
import { useApi } from '../lib/api';
import { Button, ErrorState, Loading, Notice } from './ui';

export function SupportChannels() {
  const channels = useApi<SupportChannelsDto>('/support/channels');
  const [showQr, setShowQr] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [qrAttempt, setQrAttempt] = useState(0);
  const data = channels.data;
  return (
    <section className="panel support-channels" aria-label={t('联系与反馈渠道')}>
      <h2>{t('联系与反馈渠道')}</h2>
      {channels.isLoading ? (
        <Loading />
      ) : channels.error ? (
        <ErrorState error={channels.error} retry={channels.refetch} />
      ) : data ? (
        <>
          <div className="support-channel-grid">
            <div>
              <h3>{t('本实例客服')}</h3>
              {data.phone || data.wechatQrUrl ? (
                <dl className="detail-list">
                  {data.phone && (
                    <div>
                      <dt>{t('联系电话')}</dt>
                      <dd>
                        <a href={`tel:${data.phone.replace(/[^\d+]/g, '')}`}>
                          <bdi dir="ltr">{data.phone}</bdi>
                        </a>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{t('服务时间')}</dt>
                    <dd>{data.hours ?? t('服务时间尚未公布')}</dd>
                  </div>
                </dl>
              ) : (
                <p className="muted">{t('此实例尚未配置客服联系方式，可使用本地工单记录问题。')}</p>
              )}
              {data.wechatQrUrl && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setShowQr(!showQr)}
                    aria-expanded={showQr}
                  >
                    {t(showQr ? '收起微信二维码' : '查看微信二维码')}
                  </Button>
                  {showQr && (
                    <div className="support-qr">
                      {qrFailed ? (
                        <Notice tone="warning">
                          <p>{t('二维码暂时无法加载，请重试或使用其他联系方式。')}</p>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setQrFailed(false);
                              setQrAttempt(qrAttempt + 1);
                            }}
                          >
                            {t('重新加载')}
                          </Button>
                        </Notice>
                      ) : (
                        <img
                          key={qrAttempt}
                          src={data.wechatQrUrl}
                          alt={t('本实例客服微信二维码')}
                          referrerPolicy="no-referrer"
                          onError={() => setQrFailed(true)}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <h3>{t('调研与使用指南')}</h3>
              {data.feedbackUrl ? (
                <p>
                  <a
                    className="text-button"
                    href={data.feedbackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('打开反馈问卷 ↗')}
                  </a>
                </p>
              ) : (
                <p className="muted">{t('此实例尚未配置外部反馈问卷。')}</p>
              )}
              {data.guideUrl && (
                <p>
                  <a
                    className="text-button"
                    href={data.guideUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('打开使用指南 ↗')}
                  </a>
                </p>
              )}
              {(data.feedbackUrl || data.guideUrl) && (
                <p className="muted">{t('将在新标签页打开实例负责人配置的外部页面。')}</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

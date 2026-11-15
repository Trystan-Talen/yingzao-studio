import { useState } from 'react';
import type { PasswordRecoveryStatus } from '../../contracts/password-auth';
import { post, useApi } from '../lib/api';
import { Button, ErrorState, Loading, Notice, useAction } from './ui';
import { t } from '../lib/i18n';

export function PasswordSecurity() {
  const status = useApi<PasswordRecoveryStatus>('/auth/password/status');
  const [requested, setRequested] = useState(false);
  const action = useAction();
  if (status.isLoading) return <Loading />;
  if (status.error) return <ErrorState error={status.error} retry={status.refetch} />;
  return (
    <div id="local-password" className="section-spaced" tabIndex={-1}>
      <h3>{t('本地密码')}</h3>
      <p className="muted">
        {status.data?.hasLocalPassword
          ? t('已设置本地密码。忘记密码时可通过已启用的邮件恢复流程重新设置。')
          : t('尚未设置本地密码。验证账户邮箱后可添加密码登录，已有谷歌关联会保留。')}
      </p>
      {!status.data?.enabled && (
        <Notice>{t('此实例尚未启用邮件密码恢复，请继续使用已有登录方式。')}</Notice>
      )}
      {status.data?.hasLocalPassword && status.data.enabled && (
        <a className="text-button" href="/password/forgot">
          {t('通过邮件重新设置密码')}
        </a>
      )}
      {status.data?.canSetLocalPassword && (
        <>
          <p className="field-hint">
            {t('验证邮件将发送至')} {status.data.deliveryEmail}
            {t('。请在发起操作的同一浏览器会话中打开邮件链接。')}
          </p>
          {requested ? (
            <Notice tone="success">
              {t(
                '设置请求已受理，请检查账户邮箱。若未收到，请等待一分钟后重试；邮件是否实际收到取决于投递服务。',
              )}
            </Notice>
          ) : null}
          <Button
            variant="secondary"
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                await post('/auth/password/setup-request', {});
                setRequested(true);
              })
            }
          >
            {requested ? t('重新申请设置邮件') : t('发送设置本地密码邮件')}
          </Button>
        </>
      )}
    </div>
  );
}

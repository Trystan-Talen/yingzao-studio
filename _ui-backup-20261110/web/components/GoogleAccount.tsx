import { useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import type { GoogleStatusDto } from '../../contracts/google-auth';
import { api, dateTime, useApi } from '../lib/api';
import { t } from '../lib/i18n';
import { Badge, Button, ErrorState, Field, Loading, Modal, Notice, useAction } from './ui';

type GoogleBegin = { authorizationUrl: string; expiresAt: string };

function openGoogleAuthorization(result: GoogleBegin) {
  const url = new URL(result.authorizationUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com')
    throw new Error(t('授权地址无法验证，请重新开始。'));
  window.location.assign(url.href);
}

export function GoogleCallbackNotice({
  result,
  code,
}: {
  result: string | null;
  code: string | null;
}) {
  if (result !== 'error') return null;
  return (
    <Notice tone="warning">
      {code === 'GOOGLE_EMAIL_LINK_REQUIRED'
        ? t('此邮箱已有本地账户。请先使用密码登录，再在设置中明确关联 Google 账户。')
        : t('Google 授权未完成。请重新开始，或使用已有登录方式。')}
    </Notice>
  );
}

export function GoogleLoginButton({
  inviteToken,
  referralCode,
}: {
  inviteToken?: string;
  referralCode?: string;
}) {
  const status = useApi<GoogleStatusDto>('/auth/google/status');
  const action = useAction();
  if (!status.data?.available) return null;
  return (
    <div className="google-login">
      <Button
        variant="secondary"
        busy={action.busy}
        onClick={() =>
          void action.run(async () => {
            const result = await api<GoogleBegin>(
              '/auth/google/start',
              {
                method: 'POST',
                body: JSON.stringify({
                  ...(inviteToken ? { inviteToken } : {}),
                  ...(referralCode ? { referralCode } : {}),
                }),
              },
              null,
            );
            openGoogleAuthorization(result);
          })
        }
      >
        <span aria-hidden="true" className="google-monogram">
          G
        </span>
        {t('使用 Google 继续')}
      </Button>
      <p className="field-hint">{t('新账户仍受当前注册与团队邀请规则限制。')}</p>
    </div>
  );
}

export function GoogleAccount() {
  const status = useApi<GoogleStatusDto>('/auth/google/status');
  const [mode, setMode] = useState<'link' | 'unlink' | null>(null);
  const [password, setPassword] = useState('');
  const action = useAction();
  const close = () => {
    setMode(null);
    setPassword('');
  };
  if (status.isLoading) return <Loading />;
  if (status.error) return <ErrorState error={status.error} retry={status.refetch} />;
  return (
    <div className="section-spaced">
      <div className="section-heading">
        <h3>Google</h3>
        <Badge tone={status.data?.linked ? 'green' : 'neutral'}>
          {status.data?.linked ? t('已关联') : t('未关联')}
        </Badge>
      </div>
      {status.data?.identity && (
        <dl className="detail-list">
          <div>
            <dt>{t('关联邮箱')}</dt>
            <dd>{status.data.identity.email}</dd>
          </div>
          <div>
            <dt>{t('关联时间')}</dt>
            <dd>{dateTime(status.data.identity.linkedAt)}</dd>
          </div>
        </dl>
      )}
      {!status.data?.available && (
        <p className="muted">{t('此实例尚未启用可用的 Google 登录服务。')}</p>
      )}
      {status.data?.available && !status.data.linked && status.data.hasLocalPassword && (
        <>
          <p className="muted">
            {t('使用当前本地密码确认后，前往 Google 完成关联；相同邮箱不会自动合并账户。')}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setPassword('');
              setMode('link');
            }}
          >
            <Link2 size={15} />
            {t('关联 Google 账户')}
          </Button>
        </>
      )}
      {status.data?.linked && !status.data.hasLocalPassword && (
        <p className="muted">
          {t('此账户通过 Google 创建，尚未设置本地密码，不能解除唯一登录方式。')}{' '}
          <a href="#local-password">{t('前往本地密码设置')}</a>
        </p>
      )}
      {status.data?.linked && status.data.hasLocalPassword && (
        <>
          <p className="muted">
            {t('仅已有本地密码的账户可解除关联，不能移除唯一登录方式。解除后其他会话将退出。')}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setPassword('');
              setMode('unlink');
            }}
          >
            <Unlink size={15} />
            {t('解除 Google 关联')}
          </Button>
        </>
      )}
      <Modal
        open={mode !== null}
        onClose={close}
        title={mode === 'unlink' ? t('解除 Google 关联') : t('关联 Google 账户')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(
              async () => {
                if (!mode) return;
                if (mode === 'unlink') {
                  await api(
                    '/auth/google/unlink',
                    { method: 'POST', body: JSON.stringify({ password }) },
                    null,
                  );
                  close();
                  await status.refetch();
                } else {
                  const result = await api<GoogleBegin>(
                    '/auth/google/link-start',
                    { method: 'POST', body: JSON.stringify({ password }) },
                    null,
                  );
                  setPassword('');
                  openGoogleAuthorization(result);
                }
              },
              mode === 'unlink' ? 'Google 关联已解除' : undefined,
            );
          }}
        >
          <Notice>
            {mode === 'unlink'
              ? t('此操作会解除关联并撤销其他会话。当前会话保留。')
              : t('确认本地密码后会跳转到 Google。请核对将要关联的账户。')}
          </Notice>
          <Field label={t('当前本地密码')}>
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={close}>
              {t('取消')}
            </Button>
            <Button type="submit" busy={action.busy}>
              {mode === 'unlink' ? t('确认解除关联') : t('验证并前往 Google')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

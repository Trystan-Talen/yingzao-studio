import { t } from '../lib/i18n';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post, useApi } from '../lib/api';
import { useStudio } from '../context';
import { Button, ErrorState, Field, Loading, Notice, useAction } from '../components/ui';
import { readIdentityInvite, clearIdentityInvite } from '../components/IdentityAccounts';
export function IdentityRegistration() {
  const [search] = useSearchParams(),
    registrationId = search.get('id') ?? '';
  const valid = /^[0-9a-f-]{36}$/i.test(registrationId);
  const status = useApi<{
    provider: 'sms' | 'wechat';
    registrationId: string;
    emailVerified: false;
  }>(`/auth/identity/registration?id=${encodeURIComponent(registrationId)}`, valid);
  const [invite] = useState(readIdentityInvite),
    [email, setEmail] = useState(''),
    [displayName, setDisplayName] = useState(''),
    [password, setPassword] = useState(''),
    [confirmPassword, setConfirmPassword] = useState('');
  const action = useAction(),
    { refreshSession } = useStudio(),
    navigate = useNavigate();
  return (
    <main className="page" style={{ maxWidth: 520, margin: '48px auto' }}>
      <section className="panel settings-panel">
        <h1>{t('补全账户注册')}</h1>
        <Notice>
          {t(
            '手机或微信已完成本次身份验证。请补全真实邮箱和本地密码；自填邮箱尚未验证。现有邮箱需要先登录，再在账户设置显式绑定，不会自动合并账户。',
          )}
        </Notice>
        {!valid ? (
          <Notice tone="warning">{t('注册验证已失效，请从登录页重新开始。')}</Notice>
        ) : status.isLoading ? (
          <Loading />
        ) : status.error ? (
          <ErrorState error={status.error} retry={status.refetch} />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                if (password !== confirmPassword) throw new Error(t('两次输入的密码不一致'));
                await post('/auth/identity/register', {
                  registrationId,
                  email,
                  displayName,
                  password,
                  confirmPassword,
                  ...invite,
                });
                setPassword('');
                setConfirmPassword('');
                clearIdentityInvite();
                await refreshSession();
                navigate('/', { replace: true });
              });
            }}
          >
            {invite.inviteToken && (
              <p className="muted">{t('已保留发起页面的团队邀请；注册邮箱必须与邀请目标一致。')}</p>
            )}
            <Field label={t('账户称呼')}>
              <input
                required
                maxLength={120}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
              />
            </Field>
            <Field label={t('真实账户邮箱')}>
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </Field>
            <Field label={t('本地登录密码')} hint={t('12至128个字符。')}>
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label={t('确认本地密码')}>
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" busy={action.busy}>
              {t('完成注册并登录')}
            </Button>
          </form>
        )}
        <p>
          <Link to="/login">{t('返回已有账户登录')}</Link>
        </p>
      </section>
    </main>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PasswordRecoveryStatus } from '../../contracts/password-auth';
import { post, useApi } from '../lib/api';
import { Button, ErrorState, Field, Loading, Notice, useAction } from '../components/ui';
import { useStudio } from '../context';
import { t } from '../lib/i18n';

export function PasswordRecovery() {
  const reset = location.pathname === '/password/reset';
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [requested, setRequested] = useState(false);
  const status = useApi<PasswordRecoveryStatus>('/auth/password/status');
  const action = useAction();
  const { refreshSession } = useStudio();
  const navigate = useNavigate();
  const invalidToken = reset && !/^[A-Za-z0-9_-]{43}$/.test(token);
  return (
    <main className="page" style={{ maxWidth: 520, margin: '48px auto' }}>
      <section className="panel settings-panel">
        <Link to="/login" className="wordmark">
          {t('映造')}
        </Link>
        <h1>{reset ? t('设置新的本地密码') : t('忘记密码')}</h1>
        {status.isLoading ? (
          <Loading />
        ) : status.error ? (
          <ErrorState error={status.error} retry={status.refetch} />
        ) : (
          <>
            {!status.data?.enabled && (
              <Notice>
                {t(
                  '此实例尚未启用邮件密码恢复。请使用已有登录方式，或联系实例管理员启用邮件服务。',
                )}
              </Notice>
            )}
            {invalidToken && (
              <Notice tone="warning">{t('链接已失效或缺少令牌，请重新申请。')}</Notice>
            )}
            {requested ? (
              <Notice tone="success">
                {t(
                  '如果此邮箱可通过密码恢复，你将收到恢复邮件。请检查邮箱和垃圾邮件文件夹，也可继续使用已有登录方式。',
                )}
              </Notice>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void action.run(async () => {
                    if (reset) {
                      if (password !== confirm) throw new Error(t('两次输入的密码不一致'));
                      await post('/auth/password/complete', {
                        token,
                        newPassword: password,
                        confirmPassword: confirm,
                      });
                      setPassword('');
                      setConfirm('');
                      history.replaceState(null, '', '/password/reset');
                      await refreshSession();
                      navigate('/login?password=changed', { replace: true });
                    } else {
                      await post('/auth/password/forgot', { email });
                      setRequested(true);
                    }
                  });
                }}
              >
                {reset ? (
                  <>
                    <Notice>
                      {t(
                        '成功后所有网页会话都会退出。请重新登录，并在接口密钥管理页检查独立凭据。',
                      )}
                    </Notice>
                    <Field label={t('新密码')} hint={t('12至128个字符。')}>
                      <input
                        autoFocus
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </Field>
                    <Field label={t('确认新密码')}>
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      {t(
                        '输入现有账户邮箱。仅通过谷歌登录的账户，请先使用谷歌登录，再到设置添加本地密码。',
                      )}
                    </p>
                    <Field label={t('账户邮箱')}>
                      <input
                        autoFocus
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </Field>
                  </>
                )}
                <Button
                  type="submit"
                  busy={action.busy}
                  disabled={!status.data?.enabled || invalidToken}
                >
                  {reset ? t('保存密码并退出会话') : t('申请密码恢复邮件')}
                </Button>
              </form>
            )}
            <p>
              <Link to="/login">{t('返回登录')}</Link>
              {reset && (
                <>
                  {' '}
                  · <Link to="/password/forgot">{t('重新申请恢复邮件')}</Link>
                </>
              )}
            </p>
          </>
        )}
      </section>
    </main>
  );
}

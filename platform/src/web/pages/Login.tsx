import { t } from '../lib/i18n';
import { useState } from 'react';
import { ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { post, useApi } from '../lib/api';
import { Button, Field, Loading, Notice, useAction } from '../components/ui';
import { useStudio } from '../context';
import { GoogleCallbackNotice, GoogleLoginButton } from '../components/GoogleAccount';
import { IdentityLoginButtons } from '../components/IdentityAccounts';
export function Login() {
  const { refreshSession } = useStudio();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const referralCode = search.get('ref') ?? undefined;
  const invite =
    search.get('invite') ?? new URLSearchParams(location.hash.slice(1)).get('token') ?? undefined;
  const status = useApi<{ setupRequired: boolean; registrationEnabled: boolean }>('/auth/status');
  const [register, setRegister] = useState(!!invite || location.pathname === '/register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const action = useAction();
  const registration =
    !!status.data?.setupRequired || (register && (!!status.data?.registrationEnabled || !!invite));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      await post(
        registration ? '/auth/register' : '/auth/login',
        registration
          ? {
              email,
              password,
              displayName: name,
              ...(invite ? { inviteToken: invite } : {}),
              ...(referralCode ? { referralCode } : {}),
            }
          : { email, password },
      );
      await refreshSession();
      if (registration || !invite) navigate('/', { replace: true });
    });
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <a className="wordmark" href="/">
          <span className="brand-mark">{t('映')}</span>
          <strong>
            {t('映造')}
            <span>Studio</span>
          </strong>
        </a>
        <div>
          <p className="eyebrow">A SPACE FOR YOUR NEXT IDEA</p>
          <h1>
            {t('把想象，')}
            <br />
            {t('变成看得见的作品。')}
          </h1>
          <p>{t('图片、视频与品牌资产，在一个安静、专注的创作空间里发生。')}</p>
        </div>
        <div className="login-art">
          <img src="/gallery/botanical-serum.webp" alt={t('自然风格产品摄影灵感')} />
          <img src="/gallery/amber-perfume.webp" alt={t('琥珀香水摄影灵感')} />
        </div>
        <span className="small muted">{t('原创灵感示例 · 映造 Studio')}</span>
      </section>
      <section className="login-form-area">
        <div className="login-form">
          <span className="login-symbol">
            <Sparkles size={28} />
          </span>
          <h2>{registration ? t('创建你的工作空间') : t('欢迎回到映造')}</h2>
          <p className="muted">
            {registration
              ? t('用一个账户，开始有序而自由的创作。')
              : t('登录后继续你的创作与项目。')}
          </p>
          {referralCode && !status.data?.registrationEnabled && !invite && (
            <Notice>{t('当前暂未开放自由注册。推荐链接不会绕过注册或团队邀请规则。')}</Notice>
          )}
          <GoogleCallbackNotice result={search.get('google')} code={search.get('code')} />
          {search.get('password') === 'changed' && (
            <Notice tone="success">
              {t('密码已更新，所有网页会话已退出。请使用新密码或已有谷歌登录方式重新登录。')}
            </Notice>
          )}
          {status.isLoading ? (
            <Loading />
          ) : (
            <form onSubmit={submit}>
              {registration && (
                <Field label={t('你的称呼')}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    required
                    maxLength={120}
                  />
                </Field>
              )}
              <Field label={t('邮箱')}>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </Field>
              <Field
                label={t('密码')}
                hint={registration ? t('至少12位，建议混合字母、数字和符号。') : undefined}
              >
                <input
                  type="password"
                  autoComplete={registration ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={registration ? 12 : 1}
                  maxLength={128}
                />
              </Field>
              {!registration && (
                <Link className="text-button" to="/password/forgot">
                  {t('忘记密码？')}
                </Link>
              )}
              <Button type="submit" busy={action.busy}>
                {registration ? t('创建并开始创作') : t('登录工作空间')}
                <ArrowUpRight size={17} />
              </Button>
              {!status.data?.setupRequired && (status.data?.registrationEnabled || invite) && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setRegister(!register)}
                >
                  {register ? t('已有账户？返回登录') : t('创建新账户')}
                </button>
              )}
            </form>
          )}
          {!status.data?.setupRequired && (
            <GoogleLoginButton inviteToken={invite} referralCode={referralCode} />
          )}
          <IdentityLoginButtons inviteToken={invite} referralCode={referralCode} />
          <div className="login-note">
            <LockKeyhole size={15} />
            <span>{t('你的原始素材与创作记录保存在所属工作空间。')}</span>
          </div>
          {status.data?.setupRequired && (
            <Notice>{t('首次启动：创建者将成为此本地实例的管理员。')}</Notice>
          )}
        </div>
      </section>
    </div>
  );
}

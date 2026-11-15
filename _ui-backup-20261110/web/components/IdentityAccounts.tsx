import { t } from '../lib/i18n';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { IdentityResult, IdentityStatus } from '../../contracts/identity-auth';
import { post, useApi } from '../lib/api';
import { useStudio } from '../context';
import { Button, ErrorState, Field, Loading, Modal, Notice, useAction } from './ui';
const inviteKey = 'yingzao:identity-registration-context';
export function rememberIdentityInvite(input: { inviteToken?: string; referralCode?: string }) {
  sessionStorage.setItem(inviteKey, JSON.stringify(input));
}
export function readIdentityInvite(): { inviteToken?: string; referralCode?: string } {
  try {
    const value = JSON.parse(sessionStorage.getItem(inviteKey) ?? '{}') as {
      inviteToken?: unknown;
      referralCode?: unknown;
    };
    return {
      ...(typeof value.inviteToken === 'string' && value.inviteToken.length <= 200
        ? { inviteToken: value.inviteToken }
        : {}),
      ...(typeof value.referralCode === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value.referralCode)
        ? { referralCode: value.referralCode }
        : {}),
    };
  } catch {
    return {};
  }
}
export function clearIdentityInvite() {
  sessionStorage.removeItem(inviteKey);
}
function openWechat(result: { authorizationUrl: string }) {
  const url = new URL(result.authorizationUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'open.weixin.qq.com' ||
    url.pathname !== '/connect/qrconnect'
  )
    throw new Error(t('微信授权地址不正确，请联系实例管理员'));
  location.assign(url.href);
}
export function IdentityLoginButtons(props: { inviteToken?: string; referralCode?: string }) {
  const status = useApi<IdentityStatus>('/auth/identity/status');
  const [open, setOpen] = useState(false),
    [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [challenge, setChallenge] = useState<string | null>(null);
  const action = useAction(),
    { refreshSession } = useStudio(),
    navigate = useNavigate();
  if (status.isLoading) return null;
  if (status.error) return <ErrorState error={status.error} retry={status.refetch} />;
  return (
    <div className="section-spaced">
      {new URLSearchParams(location.search).get('identity') === 'error' && (
        <Notice tone="warning">{t('微信验证未完成，未创建新的登录会话。请重新发起。')}</Notice>
      )}
      <div className="inline-actions">
        <Button
          variant="secondary"
          disabled={!status.data?.sms.ready}
          onClick={() => {
            setOpen(true);
            setChallenge(null);
            setCode('');
          }}
        >
          {t('手机验证码登录')}
        </Button>
        <Button
          variant="secondary"
          disabled={!status.data?.wechat.ready}
          busy={action.busy}
          onClick={() =>
            void action.run(async () => {
              rememberIdentityInvite(props);
              openWechat(await post('/auth/wechat/start', {}));
            })
          }
        >
          {t('微信扫码登录')}
        </Button>
      </div>
      {!status.data?.sms.ready && <p className="muted small">{t(status.data?.sms.reason ?? '')}</p>}
      {!status.data?.wechat.ready && (
        <p className="muted small">{t(status.data?.wechat.reason ?? '')}</p>
      )}
      <Modal
        open={open}
        onClose={() => {
          if (!action.busy) {
            setOpen(false);
            setCode('');
          }
        }}
        title={t('手机验证码登录')}
        description={t('仅支持中国大陆手机号。首次验证后仍需补全账户，并遵守注册或邀请规则。')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              if (!challenge) {
                rememberIdentityInvite(props);
                const result = await post<{ challengeId: string }>('/auth/sms/send', {
                  purpose: 'login',
                  phone,
                });
                setChallenge(result.challengeId);
                setCode('');
              } else {
                const result = await post<IdentityResult>('/auth/sms/verify', {
                  challengeId: challenge,
                  code,
                });
                setCode('');
                if (result.registrationId)
                  navigate(
                    `/auth/complete-registration?id=${encodeURIComponent(result.registrationId)}`,
                  );
                else {
                  await refreshSession();
                  navigate('/', { replace: true });
                }
                setOpen(false);
              }
            });
          }}
        >
          <Field label={t('中国大陆手机号')}>
            <input
              type="tel"
              autoComplete="tel-national"
              required
              disabled={!!challenge}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={15}
            />
          </Field>
          {challenge && (
            <>
              <Notice>
                {t(
                  '申请已受理。请填写实际收到的六位验证码，5分钟内有效，最多尝试5次。受理不代表运营商已送达。',
                )}
              </Notice>
              <Field label={t('短信验证码')}>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
            </>
          )}
          <div className="modal-actions">
            {challenge && (
              <Button
                type="button"
                variant="secondary"
                disabled={action.busy}
                onClick={() => {
                  setChallenge(null);
                  setCode('');
                }}
              >
                {t('更换号码或重新申请')}
              </Button>
            )}
            <Button type="submit" busy={action.busy}>
              {challenge ? t('验证并继续') : t('申请短信验证码')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
type Mode = 'bind' | 'change' | 'sms-unlink' | 'wechat-link' | 'wechat-unlink';
export function IdentityAccounts() {
  const status = useApi<IdentityStatus>('/auth/identity/status');
  const { refreshSession } = useStudio();
  const action = useAction();
  const [mode, setMode] = useState<Mode | null>(null),
    [password, setPassword] = useState(''),
    [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [challenge, setChallenge] = useState<string | null>(null),
    [oldProof, setOldProof] = useState<string | null>(null);
  function close() {
    setMode(null);
    setPassword('');
    setCode('');
    setChallenge(null);
    setOldProof(null);
    setPhone('');
  }
  if (status.isLoading) return <Loading />;
  if (status.error) return <ErrorState error={status.error} retry={status.refetch} />;
  const local = status.data?.hasLocalPassword;
  const oldStage = mode === 'change' && !oldProof;
  const titles: Record<Mode, string> = {
    bind: t('绑定手机号'),
    change: t('换绑手机号'),
    'sms-unlink': t('解除手机号'),
    'wechat-link': t('关联微信'),
    'wechat-unlink': t('解除微信关联'),
  };
  async function completed() {
    close();
    await status.refetch();
    await refreshSession();
  }
  return (
    <section className="section-spaced" aria-label={t('手机与微信登录')}>
      <h3>{t('手机与微信登录')}</h3>
      {!status.data?.emailVerified && (
        <p className="muted small">
          {t('本系统尚未记录邮箱验证。短信或微信关联不会把自填邮箱标记为已验证。')}
        </p>
      )}
      {!local && (
        <Notice>
          {t('请先')}
          <Link to="#local-password">{t('安全设置本地密码')}</Link>
          {t('，再绑定或解除其他登录方式。')}
        </Notice>
      )}
      <h4>{t('手机号')}</h4>
      <p>
        {status.data?.phone ? `${t('已验证：')}${status.data.phone.masked}` : t('尚未绑定手机号')}
      </p>
      {!status.data?.sms.ready && <p className="muted">{t(status.data?.sms.reason ?? '')}</p>}
      <div className="inline-actions">
        <Button
          variant="secondary"
          disabled={!local || !status.data?.sms.ready}
          onClick={() => {
            close();
            setMode(status.data?.phone ? 'change' : 'bind');
          }}
        >
          {status.data?.phone ? t('换绑手机号') : t('绑定手机号')}
        </Button>
        {status.data?.phone && (
          <Button
            variant="ghost"
            disabled={!local}
            onClick={() => {
              close();
              setMode('sms-unlink');
            }}
          >
            {t('解除手机号')}
          </Button>
        )}
      </div>
      <h4>{t('微信')}</h4>
      <p>{status.data?.wechatLinked ? t('已关联微信身份') : t('尚未关联微信身份')}</p>
      {!status.data?.wechat.ready && <p className="muted">{t(status.data?.wechat.reason ?? '')}</p>}
      <Button
        variant="secondary"
        disabled={!local || (!status.data?.wechatLinked && !status.data?.wechat.ready)}
        onClick={() => {
          close();
          setMode(status.data?.wechatLinked ? 'wechat-unlink' : 'wechat-link');
        }}
      >
        {status.data?.wechatLinked ? t('解除微信关联') : t('关联微信')}
      </Button>
      <Modal
        open={!!mode}
        onClose={() => {
          if (!action.busy) close();
        }}
        title={mode ? titles[mode] : t('账户登录方式')}
        description={t('请重新确认本地密码。成功变更后，其他网页会话会退出。')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              if (!mode) return;
              if (mode === 'wechat-link') {
                openWechat(await post('/auth/wechat/link-start', { password }));
                setPassword('');
                return;
              }
              if (mode === 'sms-unlink' || mode === 'wechat-unlink') {
                await post(`/auth/${mode === 'sms-unlink' ? 'sms' : 'wechat'}/unlink`, {
                  password,
                });
                await completed();
                return;
              }
              if (!challenge) {
                const result = await post<{ challengeId: string }>(
                  '/auth/sms/send',
                  mode === 'bind'
                    ? { purpose: 'bind', phone, password }
                    : oldStage
                      ? { purpose: 'change-old', password }
                      : { purpose: 'change-new', phone, oldChallengeId: oldProof },
                );
                setChallenge(result.challengeId);
                setPassword('');
                setCode('');
              } else {
                const result = await post<IdentityResult>('/auth/sms/verify', {
                  challengeId: challenge,
                  code,
                });
                setCode('');
                if (oldStage && result.verified) {
                  setOldProof(challenge);
                  setChallenge(null);
                } else await completed();
              }
            });
          }}
        >
          {!challenge && !oldProof && (
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
          )}
          {mode === 'change' && (
            <Notice>
              {oldStage
                ? t('先验证当前号码 {phone}。旧号不能使用时，请勿继续换绑。').replace(
                    '{phone}',
                    status.data?.phone?.masked ?? '',
                  )
                : t('原号码已验证，请填写并验证新号码。完整成功前原号码继续保留。')}
            </Notice>
          )}
          {(mode === 'bind' || (mode === 'change' && !!oldProof)) && !challenge && (
            <Field label={t('新的中国大陆手机号')}>
              <input
                type="tel"
                autoComplete="tel-national"
                required
                maxLength={15}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
          )}
          {challenge && (
            <>
              <Notice>{t('短信申请已受理，5分钟内有效。请填写实际收到的验证码。')}</Notice>
              <Field label={t('短信验证码')}>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
            </>
          )}
          <div className="modal-actions">
            <Button type="button" variant="secondary" onClick={close} disabled={action.busy}>
              {t('取消')}
            </Button>
            <Button type="submit" busy={action.busy}>
              {challenge
                ? t('确认验证码')
                : mode?.includes('unlink')
                  ? t('确认解除')
                  : mode === 'wechat-link'
                    ? t('验证并前往微信')
                    : t('申请验证短信')}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

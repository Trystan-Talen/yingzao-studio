import { t } from '../lib/i18n';
import { LANGUAGES, PLATFORMS } from '../../contracts/catalog';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, LockKeyhole, PlugZap, Save, ShieldCheck } from 'lucide-react';
import type { ProviderSettingDto, CapabilitiesDto } from '../../contracts/jobs';
import { patch, post, put, useApi, useRefresh, type Page } from '../lib/api';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Segments,
  useAction,
} from '../components/ui';
import { useStudio } from '../context';
import { GoogleAccount, GoogleCallbackNotice } from '../components/GoogleAccount';
import { MailDeliveryStatus } from '../components/MailDeliveryStatus';
export function Settings() {
  const { isAdmin } = useStudio();
  const [search, setSearch] = useSearchParams();
  const tab =
    search.get('tab') === 'providers'
      ? 'providers'
      : search.get('tab') === 'mail' && isAdmin
        ? 'mail'
        : 'profile';
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="A STUDIO THAT FEELS LIKE YOU"
        title={t('设置')}
        description={t('管理个人偏好与工作空间的生成服务。')}
      />
      <Segments
        value={tab}
        onChange={(value) => setSearch(value === 'profile' ? {} : { tab: value })}
        options={[
          { value: 'profile', label: '个人偏好' },
          { value: 'providers', label: '生成服务' },
          ...(isAdmin ? [{ value: 'mail', label: '邮件投递' }] : []),
        ]}
      />
      <GoogleCallbackNotice result={search.get('google')} code={search.get('code')} />
      {tab === 'profile' ? (
        <ProfileSettings />
      ) : tab === 'mail' ? (
        <MailDeliveryStatus />
      ) : (
        <ProviderSettings />
      )}
    </div>
  );
}
function ProfileSettings() {
  const { session, refreshSession } = useStudio();
  const [name, setName] = useState(session?.user.displayName ?? '');
  const [theme, setTheme] = useState(session?.user.preferences.theme ?? 'system');
  const [locale, setLocale] = useState(session?.user.preferences.locale ?? 'zh-CN');
  const [defaultPlatform, setDefaultPlatform] = useState(
    session?.user.preferences.defaultPlatform ?? '通用电商',
  );
  const [defaultCreationLanguage, setDefaultCreationLanguage] = useState(
    session?.user.preferences.defaultCreationLanguage ?? 'zh-CN',
  );
  const [confirm, setConfirm] = useState(session?.user.preferences.confirmGeneration ?? true);
  const action = useAction();
  return (
    <div className="settings-columns">
      <section className="panel settings-panel">
        <h2>{t('个人资料')}</h2>
        <p className="muted">{t('这些信息只在你的账户与授权的工作空间中显示。')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await patch('/auth/me', {
                displayName: name,
                preferences: {
                  theme,
                  locale,
                  confirmGeneration: confirm,
                  defaultPlatform,
                  defaultCreationLanguage,
                },
              });
              await refreshSession();
            }, '个人偏好已保存');
          }}
        >
          <Field label={t('显示名称')}>
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('账户邮箱')}>
            <input value={session?.user.email ?? ''} readOnly />
          </Field>
          <div className="form-grid">
            <Field label={t('界面主题')}>
              <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
                <option value="system">{t('跟随系统')}</option>
                <option value="light">{t('浅色')}</option>
                <option value="dark">{t('深色')}</option>
              </select>
            </Field>
            <Field label={t('界面语言')}>
              <select value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)}>
                <option value="zh-CN">{t('简体中文')}</option>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label={t('默认发布平台')}>
              <select value={defaultPlatform} onChange={(e) => setDefaultPlatform(e.target.value)}>
                {PLATFORMS.map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('默认创作语言')}>
              <select
                value={defaultCreationLanguage}
                onChange={(e) =>
                  setDefaultCreationLanguage(e.target.value as typeof defaultCreationLanguage)
                }
              >
                {LANGUAGES.map((value) => (
                  <option key={value.id} value={value.id}>
                    {t(value.name)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            {t('生成前显示配置与费用确认')}
          </label>
          <p className="field-hint">
            {t(
              '关闭后，点击创作会按服务端报价直接预留额度并提交；服务商可能另行收取费用，空间预算限制始终生效。',
            )}
          </p>
          <Button type="submit" busy={action.busy}>
            <Save size={15} />
            {t('保存设置')}
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() =>
              void action.run(async () => {
                await patch('/auth/me', { preferences: { onboardingCompleted: false } });
                await refreshSession();
              })
            }
          >
            {t('重新打开入门引导')}
          </Button>
        </form>
      </section>
      <section className="panel settings-panel">
        <span className="feature-symbol">
          <ShieldCheck size={23} />
        </span>
        <h2>{t('账户安全')}</h2>
        <p className="muted">
          {t('会话通过受保护的 Cookie 管理。退出其他会话后，它们需要重新登录。')}
        </p>
        <Button
          variant="secondary"
          busy={action.busy}
          onClick={() => void action.run(() => post('/auth/logout-others'), '其他会话已退出')}
        >
          <LockKeyhole size={15} />
          {t('退出其他会话')}
        </Button>
        <hr />
        <h3>{t('外部账户登录')}</h3>
        <p className="muted">{t('仅展示当前实例实际可用的登录方式，不会发送演示验证码。')}</p>
        <GoogleAccount />
      </section>
    </div>
  );
}
function ProviderSettings() {
  const { isAdmin } = useStudio();
  const settings = useApi<Page<ProviderSettingDto>>('/providers', isAdmin);
  const caps = useApi<CapabilitiesDto>('/capabilities');
  const [editing, setEditing] = useState<ProviderSettingDto | null>(null);
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [removeSecret, setRemoveSecret] = useState(false);
  const action = useAction();
  const refresh = useRefresh();
  if (!isAdmin)
    return (
      <Empty
        icon={<KeyRound size={32} />}
        title={t('服务配置由空间管理员管理')}
        description={t('你可以继续编辑草稿；需要新增服务时，请联系当前空间的创建者或管理员。')}
      />
    );
  return (
    <div className="section-spaced">
      <Notice>
        {t('密钥仅在服务端使用。配置与真实调用验证分别显示；连接状态不代表已进行过付费生成。')}
      </Notice>
      {settings.isLoading ? (
        <Loading />
      ) : settings.error ? (
        <ErrorState error={settings.error} retry={settings.refetch} />
      ) : (
        <div className="provider-grid">
          {settings.data?.items.map((provider) => (
            <article className="panel provider-card" key={provider.providerId}>
              <div className="section-heading">
                <span className="provider-icon">
                  <PlugZap size={25} />
                </span>
                <Badge tone={provider.configured && provider.enabled ? 'green' : 'neutral'}>
                  {provider.configured && provider.enabled ? t('已连接') : t('未连接')}
                </Badge>
              </div>
              <h2>{provider.name}</h2>
              <p>
                {provider.providerId === 'openai'
                  ? t('图片生成与文案辅助')
                  : provider.providerId === 'fal'
                    ? t('视频生成与素材参考')
                    : t('电商图片创作与处理工具')}
              </p>
              <dl className="detail-list">
                <div>
                  <dt>{t('密钥状态')}</dt>
                  <dd>{provider.keyHint ?? '尚未配置'}</dd>
                </div>
                <div>
                  <dt>{t('真实调用')}</dt>
                  <dd>{provider.liveVerified ? t('已经验证') : t('尚未验证')}</dd>
                </div>
                <div>
                  <dt>{t('配置来源')}</dt>
                  <dd>
                    {
                      { workspace: '当前空间', environment: '实例环境', none: '未配置' }[
                        provider.source
                      ]
                    }
                  </dd>
                </div>
              </dl>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(provider);
                  setSecret('');
                  setEnabled(provider.enabled);
                  setRemoveSecret(false);
                }}
              >
                {t('管理连接')}
              </Button>
            </article>
          ))}
        </div>
      )}
      <section className="panel section-spaced">
        <div className="panel-heading">
          <h2>{t('能力与服务状态')}</h2>
          <Badge>{t('实时能力清单')}</Badge>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('能力')}</th>
                <th>{t('服务')}</th>
                <th>{t('状态')}</th>
                <th>{t('说明')}</th>
              </tr>
            </thead>
            <tbody>
              {caps.data?.operations.map((operation) => (
                <tr key={`${operation.id}:${operation.providerId}`}>
                  <td>{operation.name}</td>
                  <td>{operation.providerId}</td>
                  <td>
                    <Badge tone={operation.available ? 'green' : 'neutral'}>
                      {operation.available ? t('可用') : t('未连接')}
                    </Badge>
                  </td>
                  <td>{t(operation.reason ?? '按提交前报价执行')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Modal
        open={!!editing}
        onClose={() => {
          setEditing(null);
          setSecret('');
        }}
        title={`配置 ${editing?.name ?? '生成服务'}`}
        description={t('密钥不会在保存后回显，也不会写入浏览器存储。')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              if (!editing) return;
              await put('/providers', {
                providerId: editing.providerId,
                enabled,
                ...(secret.trim() ? { secret: secret.trim() } : {}),
                ...(removeSecret ? { removeSecret: true } : {}),
              });
              setSecret('');
              setEditing(null);
              await refresh();
            }, '服务配置已保存');
          }}
        >
          <Field
            label={t('服务密钥')}
            hint={
              editing?.configured
                ? t('留空保留已有密钥；填写新密钥则替换。')
                : t('填写供应商提供的真实服务密钥。')
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              minLength={10}
              disabled={removeSecret}
            />
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {t('启用此连接')}
          </label>
          {editing?.source === 'workspace' && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={removeSecret}
                onChange={(e) => {
                  setRemoveSecret(e.target.checked);
                  if (e.target.checked) setSecret('');
                }}
              />
              {t('移除当前空间保存的密钥')}
            </label>
          )}
          <Notice>{t('保存配置不会提交生成任务。外部服务费用以供应商账单为准。')}</Notice>
          <div className="modal-actions">
            <Button type="submit" busy={action.busy}>
              {t('保存连接')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

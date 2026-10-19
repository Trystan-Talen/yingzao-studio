import { t } from '../lib/i18n';
import { useState } from 'react';
import { Code2, Copy, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { API_SCOPES } from '../../contracts/core';
import type { CreditDto } from '../../contracts/jobs';
import { Link } from 'react-router-dom';
import { dateTime, post, remove, useApi, useRefresh, type Page } from '../lib/api';
import {
  Badge,
  Button,
  Confirm,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  useAction,
} from '../components/ui';
import { useStudio } from '../context';
interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}
export function Developer() {
  const { isAdmin, workspace } = useStudio();
  const [page, setPage] = useState(1);
  const keys = useApi<Page<ApiKey>>(`/api-keys?pageSize=100&page=${page}`, isAdmin);
  const apiCredits = useApi<CreditDto>('/credits/api', isAdmin, 15000);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['projects:read', 'assets:read', 'jobs:read']);
  const [expires, setExpires] = useState('');
  const [limit, setLimit] = useState('');
  const [secret, setSecret] = useState('');
  const [revoke, setRevoke] = useState<ApiKey | null>(null);
  const action = useAction();
  const refresh = useRefresh();
  const example = `curl '${location.origin}/api/v1/projects' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'x-workspace-id: ${workspace?.id ?? 'WORKSPACE_ID'}'`;
  return (
    <div className="page">
      <PageHeader
        eyebrow="BUILD ON YOUR CREATIVE WORKSPACE"
        title={t('开发者')}
        description={t('让你的应用，与同一个创作工作空间连接。')}
        action={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={17} />
              {t('创建 API Key')}
            </Button>
          )
        }
      />
      <div className="developer-intro">
        <span className="feature-symbol">
          <Code2 size={28} />
        </span>
        <div>
          <h2>{t('一套 API，连接素材与创作。')}</h2>
          <p>
            {t(
              '访问项目与素材、提交真实任务、查询执行状态。接口密钥沿用空间权限，任务使用独立接口额度。',
            )}
          </p>
        </div>
        <a className="button secondary" href="/api/docs" target="_blank" rel="noreferrer">
          {t('查看 API 文档 ↗')}
        </a>
      </div>
      {isAdmin && (
        <section className="panel settings-panel section-spaced">
          <h2>{t('接口独立额度账户')}</h2>
          <p className="muted">{t('平台创作额度，与网页账户分别充值和结算，不是现金余额。')}</p>
          {apiCredits.isLoading ? (
            <Loading />
          ) : apiCredits.error ? (
            <ErrorState error={apiCredits.error} retry={apiCredits.refetch} />
          ) : (
            <div className="stat-grid">
              <div className="stat-card">
                <span>{t('可用额度')}</span>
                <strong>{apiCredits.data?.available.toLocaleString() ?? '—'}</strong>
              </div>
              <div className="stat-card">
                <span>{t('任务预留')}</span>
                <strong>{apiCredits.data?.reserved.toLocaleString() ?? '—'}</strong>
              </div>
              <div className="stat-card">
                <span>{t('累计使用')}</span>
                <strong>{apiCredits.data?.spent.toLocaleString() ?? '—'}</strong>
              </div>
            </div>
          )}
          <div className="inline-actions section-spaced">
            <Link className="button secondary" to="/usage?account=api&tab=plans">
              {t('充值接口额度')}
            </Link>
            <Link className="button secondary" to="/usage?account=api&tab=ledger">
              {t('查看接口用量')}
            </Link>
          </div>
        </section>
      )}
      {!isAdmin ? (
        <Empty icon={<ShieldCheck size={32} />} title={t('只有创建者与管理员可以管理密钥')} />
      ) : keys.isLoading ? (
        <Loading />
      ) : keys.error ? (
        <ErrorState error={keys.error} retry={keys.refetch} />
      ) : keys.data?.items.length ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>{t('空间 API Key')}</h2>
            <span className="muted">{t('完整密钥仅创建时显示一次')}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('名称 / 前缀')}</th>
                  <th>{t('权限')}</th>
                  <th>{t('最近使用')}</th>
                  <th>{t('到期')}</th>
                  <th>{t('状态')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.data.items.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <strong>{key.name}</strong>
                      <code>{key.prefix}…</code>
                    </td>
                    <td>
                      <div className="tag-list">
                        {key.scopes.map((scope) => (
                          <Badge key={scope}>{scope}</Badge>
                        ))}
                      </div>
                    </td>
                    <td>{dateTime(key.lastUsedAt)}</td>
                    <td>{dateTime(key.expiresAt)}</td>
                    <td>
                      <Badge tone={key.revokedAt ? 'neutral' : 'green'}>
                        {key.revokedAt ? t('已撤销') : t('有效')}
                      </Badge>
                    </td>
                    <td>
                      {!key.revokedAt && (
                        <Button variant="ghost" onClick={() => setRevoke(key)}>
                          <Trash2 size={15} />
                          {t('撤销')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <Empty
          icon={<KeyRound size={32} />}
          title={t('创建你的第一个 API Key')}
          description={t('按需授予最小权限，密钥可以随时撤销。')}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} />
              {t('创建 API Key')}
            </Button>
          }
        />
      )}
      <div className="settings-columns">
        <section className="panel settings-panel">
          <h2>{t('第一次请求')}</h2>
          <p className="muted">{t('把 YOUR_API_KEY 替换为刚创建的密钥。')}</p>
          <pre className="code-block">{example}</pre>
          <Button
            variant="secondary"
            onClick={() =>
              void action.run(() => navigator.clipboard.writeText(example), '示例已复制')
            }
          >
            <Copy size={15} />
            {t('复制示例')}
          </Button>
        </section>
        <section className="panel settings-panel">
          <h2>{t('不同的密钥，各有用途。')}</h2>
          <p>{t('这里创建的是映造工作空间 API Key，用于访问本系统。')}</p>
          <p className="muted">
            {t(
              '模型供应商密钥在“设置 → 生成服务”管理。没有供应商配置时，API 会清楚返回能力未连接，不会生成虚拟结果。',
            )}
          </p>
        </section>
      </div>
      {keys.data && (
        <Pagination
          page={page}
          total={keys.data.total}
          pageSize={keys.data.pageSize}
          onPage={setPage}
        />
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title={t('创建 API Key')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const created = await post<{ key: ApiKey; secret: string }>('/api-keys', {
                name,
                scopes,
                expiresAt: expires ? new Date(expires).toISOString() : null,
                creditLimit: limit ? Number(limit) : null,
              });
              setSecret(created.secret);
              setCreating(false);
              setName('');
              await refresh();
            });
          }}
        >
          <Field label={t('密钥名称')}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              placeholder={t('例如：商品内容自动化')}
            />
          </Field>
          <div className="field">
            <span className="field-label">{t('可用权限')}</span>
            <div className="scope-options">
              {API_SCOPES.map((scope) => (
                <label className="checkbox" key={scope}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) =>
                      setScopes(
                        e.target.checked ? [...scopes, scope] : scopes.filter((s) => s !== scope),
                      )
                    }
                  />
                  {scope}
                </label>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <Field label={t('到期日期（可选）')}>
              <input
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label={t('额度上限（可选）')}>
              <input
                type="number"
                min={1}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </Field>
          </div>
          <div className="modal-actions">
            <Button type="submit" busy={action.busy} disabled={!scopes.length}>
              {t('创建密钥')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!secret}
        onClose={() => setSecret('')}
        title={t('保存你的新密钥')}
        description={t('完整密钥只显示这一次。关闭后无法再次查看。')}
      >
        <pre className="secret-block">{secret}</pre>
        <Notice>{t('请保存在可信的密钥管理器中，不要放入公开仓库或前端代码。')}</Notice>
        <div className="modal-actions">
          <Button
            variant="secondary"
            onClick={() =>
              void action.run(() => navigator.clipboard.writeText(secret), '密钥已复制')
            }
          >
            {t('复制密钥')}
          </Button>
          <Button onClick={() => setSecret('')}>{t('我已妥善保存')}</Button>
        </div>
      </Modal>
      <Confirm
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title={t('撤销 API Key？')}
        description={t('撤销后所有使用此密钥的请求将立即失效，此密钥无法恢复。')}
        busy={action.busy}
        onConfirm={() =>
          void action.run(async () => {
            if (!revoke) return;
            await remove(`/api-keys/${revoke.id}`);
            setRevoke(null);
            await refresh();
          }, '密钥已撤销')
        }
      />
    </div>
  );
}

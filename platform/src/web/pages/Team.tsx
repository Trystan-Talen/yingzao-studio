import { t } from '../lib/i18n';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Download,
  Plus,
  Settings2,
  Shield,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { TeamCreation } from '../components/TeamCreation';
import {
  api,
  dateTime,
  downloadFile,
  patch,
  post,
  qs,
  remove,
  useApi,
  useRefresh,
  type Page,
} from '../lib/api';
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
  Segments,
  useAction,
} from '../components/ui';
import { useStudio } from '../context';
import { TeamCreditSettings } from '../components/UsageStatistics';
import type {
  InvitationMailDelivery,
  MailDeliveryStatusDto,
} from '../components/MailDeliveryStatus';
interface Member {
  id: string;
  user: { id: string; displayName: string; email: string | null };
  role: string;
  nickname: string;
  creditLimit: number | null;
  createdAt: string;
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}
interface Preview {
  rows: { row: number; values: Record<string, unknown>; valid: boolean; errors: string[] }[];
  validCount: number;
  invalidCount: number;
}
interface ImportResult {
  items: {
    row: number;
    status: string;
    message?: string;
    email?: string;
    invitation?: { inviteUrl: string };
  }[];
}
const roles: Record<string, string> = {
  owner: '创建者',
  admin: '管理员',
  member: '成员',
  viewer: '只读成员',
};
export function Team() {
  const { workspace, session, isAdmin, refreshSession } = useStudio();
  const [tab, setTab] = useState<'members' | 'invitations' | 'activity' | 'settings'>('members');
  const [q, setQ] = useState('');
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [expires, setExpires] = useState(7);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteDelivery, setInviteDelivery] = useState<InvitationMailDelivery | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [nickname, setNickname] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState(workspace?.name ?? '');
  const [danger, setDanger] = useState<'leave' | 'archive' | 'transfer' | null>(null);
  const [transfer, setTransfer] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const members = useApi<Page<Member>>(
    `/members${qs({ q, pageSize: 100, page })}`,
    workspace?.kind === 'team',
  );
  const invitations = useApi<Page<Invitation>>(
    `/invitations?pageSize=100&page=${page}`,
    isAdmin && tab === 'invitations',
  );
  const audit = useApi<
    Page<{ id: string; actorId: string; action: string; resourceType: string; createdAt: string }>
  >(`/audit-events?pageSize=100&page=${page}`, isAdmin && tab === 'activity');
  const refresh = useRefresh();
  const mailStatus = useApi<MailDeliveryStatusDto>('/mail-deliveries', isAdmin && invite);
  const action = useAction();
  const navigate = useNavigate();
  async function importFile(file: File | undefined) {
    if (!file) return;
    await action.run(async () => {
      const data = new FormData();
      data.set('file', file);
      setPreview(await api<Preview>('/members/import/preview', { method: 'POST', body: data }));
      setImportResult(null);
    });
    if (input.current) input.current.value = '';
  }
  async function closeSpace() {
    await action.run(
      async () => {
        if (!workspace || !danger) return;
        await post(`/workspaces/${workspace.id}/${danger}`, {
          confirm: true,
          ...(danger === 'transfer' ? { userId: transfer } : {}),
        });
        await refreshSession();
        setDanger(null);
        if (danger !== 'transfer') navigate('/');
        await refresh();
      },
      danger === 'transfer' ? '所有权已转让' : '空间状态已更新',
    );
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="BETTER WORK, TOGETHER"
        title={t('团队')}
        description={t('共享创作空间，让成员、素材和用量井然有序。')}
        action={
          workspace?.kind === 'team' && isAdmin ? (
            <>
              <Button variant="secondary" onClick={() => input.current?.click()} busy={action.busy}>
                <Upload size={16} />
                {t('导入成员')}
              </Button>
              <Button
                onClick={() => {
                  setInvite(true);
                  setRole('member');
                }}
              >
                <UserPlus size={17} />
                {t('邀请成员')}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                setName('');
                setCreate(true);
              }}
            >
              <Plus size={17} />
              {t('创建团队')}
            </Button>
          )
        }
      />
      {workspace?.kind !== 'team' ? (
        <div className="team-intro">
          <span className="feature-symbol">
            <Users size={36} />
          </span>
          <h2>{t('好作品，和好伙伴一起完成。')}</h2>
          <p>{t('创建独立的团队空间，共享项目与素材，为不同成员设置角色和额度上限。')}</p>
          <Button
            onClick={() => {
              setName('');
              setCreate(true);
            }}
          >
            {t('创建团队空间')}
            <ArrowUpRight size={16} />
          </Button>
          <div className="team-benefits">
            <span>
              <Shield size={18} />
              {t('角色与权限')}
            </span>
            <span>
              <Users size={18} />
              {t('共享资产')}
            </span>
            <span>
              <Settings2 size={18} />
              {t('成员预算')}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="team-overview">
            <div>
              <span className="workspace-avatar large">{workspace.name.slice(0, 1)}</span>
              <div>
                <h2>{workspace.name}</h2>
                <p className="muted">
                  {members.data?.total ?? '—'}
                  {t('位成员 ·')}
                  {t(roles[workspace.role]!)}
                </p>
              </div>
            </div>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={() =>
                  void action.run(
                    () => downloadFile('/api/v1/members/export?format=xlsx', 'team-members.xlsx'),
                    '成员表已导出',
                  )
                }
              >
                <Download size={16} />
                {t('导出成员')}
              </Button>
            )}
          </div>
          <Segments
            value={tab}
            onChange={(value) => {
              setTab(value);
              setPage(1);
            }}
            options={[
              { value: 'members', label: '团队成员' },
              ...(isAdmin
                ? [
                    { value: 'invitations' as const, label: '邀请记录' },
                    { value: 'activity' as const, label: '活动日志' },
                  ]
                : []),
              { value: 'settings', label: '团队设置' },
            ]}
          />
          {tab === 'members' ? (
            <>
              <div className="toolbar">
                <input
                  placeholder={t('搜索成员名称…')}
                  aria-label={t('搜索成员')}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
                <span className="muted">{t('成员预算包含已用与预留额度')}</span>
              </div>
              {members.isLoading ? (
                <Loading />
              ) : members.error ? (
                <ErrorState error={members.error} retry={members.refetch} />
              ) : (
                <div className="panel table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('成员')}</th>
                        <th>{t('角色')}</th>
                        <th>{t('备注')}</th>
                        <th>{t('预算上限')}</th>
                        <th>{t('加入时间')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {members.data?.items.map((member) => (
                        <tr key={member.id}>
                          <td>
                            <div className="member-cell">
                              <span className="user-avatar">
                                {member.user.displayName.slice(0, 1)}
                              </span>
                              <div>
                                <strong>{member.user.displayName}</strong>
                                <small>{member.user.email ?? '邮箱受权限保护'}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Badge tone={member.role === 'owner' ? 'green' : 'neutral'}>
                              {t(roles[member.role]!)}
                            </Badge>
                          </td>
                          <td>{member.nickname || '—'}</td>
                          <td>
                            {member.creditLimit === null
                              ? t('共享额度')
                              : member.creditLimit.toLocaleString()}
                          </td>
                          <td>{dateTime(member.createdAt)}</td>
                          <td>
                            {isAdmin && member.role !== 'owner' && (
                              <div className="inline-actions">
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setEditing(member);
                                    setRole(member.role);
                                    setNickname(member.nickname);
                                    setCreditLimit(
                                      member.creditLimit === null ? '' : String(member.creditLimit),
                                    );
                                  }}
                                >
                                  {t('管理')}
                                </Button>
                                <Button variant="ghost" onClick={() => setDeleting(member)}>
                                  {t('移除')}
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : tab === 'invitations' ? (
            <section className="section-spaced">
              {invitations.error ? (
                <ErrorState error={invitations.error} />
              ) : invitations.data?.items.length ? (
                <div className="panel table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('邮箱')}</th>
                        <th>{t('角色')}</th>
                        <th>{t('有效期')}</th>
                        <th>{t('状态')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.data.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.email}</td>
                          <td>{t(roles[item.role]!)}</td>
                          <td>{dateTime(item.expiresAt)}</td>
                          <td>
                            <Badge>
                              {item.revokedAt
                                ? t('已撤销')
                                : item.consumedAt
                                  ? t('已加入')
                                  : new Date(item.expiresAt) < new Date()
                                    ? t('已过期')
                                    : t('待加入')}
                            </Badge>
                          </td>
                          <td>
                            {!item.revokedAt && !item.consumedAt && (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  void action.run(async () => {
                                    await remove(`/invitations/${item.id}`);
                                    await refresh();
                                  }, '邀请已撤销')
                                }
                              >
                                {t('撤销')}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title={t('还没有邀请记录')}
                  description={t('邀请链接仅创建时显示，可复制后自行发送。')}
                />
              )}
            </section>
          ) : tab === 'activity' ? (
            <section className="section-spaced">
              {audit.error ? (
                <ErrorState error={audit.error} />
              ) : audit.data?.items.length ? (
                <div className="panel table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('操作')}</th>
                        <th>{t('资源类型')}</th>
                        <th>{t('成员')}</th>
                        <th>{t('时间')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.data.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.action}</td>
                          <td>{item.resourceType}</td>
                          <td>
                            {members.data?.items.find((m) => m.user.id === item.actorId)?.user
                              .displayName ?? '团队成员'}
                          </td>
                          <td>{dateTime(item.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title={t('暂时没有活动记录')} />
              )}
            </section>
          ) : (
            <div className="settings-columns">
              <section className="panel settings-panel">
                <h2>{t('空间资料')}</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action.run(async () => {
                      await patch(`/workspaces/${workspace.id}`, { name });
                      await refreshSession();
                    }, '团队名称已保存');
                  }}
                >
                  <Field label={t('团队名称')}>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      disabled={!isAdmin}
                    />
                  </Field>
                  {isAdmin && (
                    <Button type="submit" busy={action.busy}>
                      {t('保存')}
                    </Button>
                  )}
                </form>
                <hr />
                <h3>{t('成员额度')}</h3>
                <TeamCreditSettings />
                <p className="muted">
                  {t('可以在成员管理中设置预算上限，在用量页面查看预留与结算记录。')}
                </p>
                <Button variant="secondary" onClick={() => navigate('/usage')}>
                  {t('查看用量')}
                </Button>
              </section>
              <section className="panel settings-panel">
                <h2>{t('团队生命周期')}</h2>
                {workspace.role === 'owner' ? (
                  <>
                    <Field label={t('转让给另一位成员')}>
                      <select value={transfer} onChange={(e) => setTransfer(e.target.value)}>
                        <option value="">{t('选择接任创建者')}</option>
                        {members.data?.items
                          .filter((m) => m.user.id !== session?.user.id)
                          .map((member) => (
                            <option value={member.user.id} key={member.id}>
                              {member.user.displayName}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Button
                      variant="secondary"
                      disabled={!transfer}
                      onClick={() => setDanger('transfer')}
                    >
                      {t('转让所有权')}
                    </Button>
                    <hr />
                    <h3>{t('解散团队')}</h3>
                    <p className="muted">
                      {t('仅创建者可解散。系统会检查在途任务与待处理订单，内容会归档保留。')}
                    </p>
                    <Button variant="danger" onClick={() => setDanger('archive')}>
                      {t('解散并归档')}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      {t('退出后将无法访问此团队的项目与素材，团队原件不会复制到个人空间。')}
                    </p>
                    <Button variant="danger" onClick={() => setDanger('leave')}>
                      {t('退出团队')}
                    </Button>
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
      <input
        ref={input}
        type="file"
        accept=".csv,.xlsx"
        hidden
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {(() => {
        const result =
          tab === 'members'
            ? members.data
            : tab === 'invitations'
              ? invitations.data
              : tab === 'activity'
                ? audit.data
                : null;
        return result ? (
          <Pagination
            page={page}
            total={result.total}
            pageSize={result.pageSize}
            onPage={setPage}
          />
        ) : null;
      })()}
      <TeamCreation open={create} onClose={() => setCreate(false)} />
      <Modal
        open={invite}
        onClose={() => setInvite(false)}
        title={t('邀请团队成员')}
        description={
          mailStatus.data?.enabled
            ? t('生成专属链接并将邀请邮件加入投递队列。仅指定邮箱的账户可以加入。')
            : t('生成专属链接；邮件服务未启用时请自行发送链接。仅指定邮箱的账户可以加入。')
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const result = await post<{
                inviteUrl: string;
                mailDelivery?: InvitationMailDelivery;
              }>('/invitations', {
                email,
                role,
                expiresInDays: expires,
              });
              setInviteUrl(result.inviteUrl);
              setInviteDelivery(result.mailDelivery ?? null);
              setInvite(false);
              setEmail('');
              await refresh();
            });
          }}
        >
          <Field label={t('成员邮箱')}>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="form-grid">
            <Field label={t('加入角色')}>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">{t('成员')}</option>
                <option value="admin">{t('管理员')}</option>
                <option value="viewer">{t('只读成员')}</option>
              </select>
            </Field>
            <Field label={t('有效期')}>
              <select value={expires} onChange={(e) => setExpires(Number(e.target.value))}>
                {[1, 3, 7].map((value) => (
                  <option key={value} value={value}>
                    {value}
                    {t('天')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="modal-actions">
            <Button type="submit" busy={action.busy}>
              {t('创建邀请链接')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!inviteUrl}
        onClose={() => setInviteUrl('')}
        title={t('邀请链接已创建')}
        description={t('关闭后不会再次显示完整邀请令牌。请保管好链接。')}
      >
        <Notice>
          {inviteDelivery?.status === 'queued'
            ? t('邀请邮件已排队，尚不代表送达。可在设置中查看实际投递状态。')
            : inviteDelivery?.status === 'existing'
              ? t('此邀请已有邮件投递记录，未重复排队。请在设置中核对实际状态。')
              : t('当前未自动发送邮件，请复制链接后自行发送给成员。')}
        </Notice>
        <Field label={t('专属邀请链接')}>
          <input readOnly value={inviteUrl} />
        </Field>
        <div className="modal-actions">
          <Button
            onClick={() =>
              void action.run(() => navigator.clipboard.writeText(inviteUrl), '邀请链接已复制')
            }
          >
            {t('复制链接')}
          </Button>
        </div>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t('管理成员')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              if (!editing) return;
              await patch(`/members/${editing.id}`, {
                role,
                nickname,
                creditLimit: creditLimit === '' ? null : Number(creditLimit),
              });
              setEditing(null);
              await refresh();
            }, '成员设置已保存');
          }}
        >
          <Field label={t('成员角色')}>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">{t('成员')}</option>
              <option value="admin">{t('管理员')}</option>
              <option value="viewer">{t('只读成员')}</option>
            </select>
          </Field>
          <Field label={t('备注名称')}>
            <input value={nickname} maxLength={100} onChange={(e) => setNickname(e.target.value)} />
          </Field>
          <Field label={t('额度上限')} hint={t('留空使用共享额度；不能低于已使用与预留的额度。')}>
            <input
              type="number"
              min={0}
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <Button type="submit" busy={action.busy}>
              {t('保存成员设置')}
            </Button>
          </div>
        </form>
      </Modal>
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('移除团队成员？')}
        description={t('此成员将立即失去空间访问权限，其团队素材会保留。')}
        busy={action.busy}
        onConfirm={() =>
          void action.run(async () => {
            if (!deleting) return;
            await remove(`/members/${deleting.id}`);
            setDeleting(null);
            await refresh();
          }, '成员已移除')
        }
      />
      <Confirm
        open={!!danger}
        onClose={() => setDanger(null)}
        title={
          danger === 'transfer'
            ? t('确认转让所有权？')
            : danger === 'archive'
              ? t('确认解散并归档团队？')
              : t('确认退出团队？')
        }
        description={
          danger === 'transfer'
            ? t('你将变为管理员。新的创建者将有权解散团队与转让所有权。')
            : t('此操作会改变团队访问权限。尚有在途任务或未结账业务时，系统将阻止操作。')
        }
        busy={action.busy}
        onConfirm={() => void closeSpace()}
      />
      <Modal
        open={!!preview || !!importResult}
        onClose={() => {
          setPreview(null);
          setImportResult(null);
        }}
        title={t('成员批量导入')}
        wide
      >
        {preview && !importResult ? (
          <>
            <Notice>
              {preview.validCount}
              {t('行有效，')}
              {preview.invalidCount}{' '}
              {t('行需要修正。导入不会自动发送邀请。已有成员仅更新备注与预算。')}
            </Notice>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('行')}</th>
                    <th>{t('邮箱')}</th>
                    <th>{t('角色')}</th>
                    <th>{t('校验')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>{String(row.values.email ?? '')}</td>
                      <td>{String(row.values.role ?? '')}</td>
                      <td>
                        {row.valid ? (
                          <Badge tone="green">{t('可导入')}</Badge>
                        ) : (
                          <span className="field-error">{row.errors.join('；')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <Button
                variant="secondary"
                onClick={() =>
                  void action.run(
                    () =>
                      downloadFile(
                        '/api/v1/members/import/template?format=xlsx',
                        'members-template.xlsx',
                      ),
                    '模板已下载',
                  )
                }
              >
                {t('下载模板')}
              </Button>
              <Button
                busy={action.busy}
                disabled={!preview.validCount || preview.invalidCount > 0}
                onClick={() =>
                  void action.run(async () => {
                    setImportResult(
                      await post<ImportResult>('/members/import', {
                        rows: preview.rows.map((row) => row.values),
                        confirm: true,
                      }),
                    );
                    await refresh();
                  }, '导入完成，请检查逐行结果')
                }
              >
                {t('确认导入')}
                {preview.validCount}
                {t('行')}
              </Button>
            </div>
          </>
        ) : (
          importResult && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('行')}</th>
                    <th>{t('邮箱')}</th>
                    <th>{t('结果')}</th>
                    <th>{t('说明')}</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.items.map((row) => (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>{row.email ?? '—'}</td>
                      <td>{row.status}</td>
                      <td>
                        {row.message ?? ''}
                        {row.invitation && (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              void action.run(
                                () =>
                                  navigator.clipboard.writeText(row.invitation?.inviteUrl ?? ''),
                                '邀请链接已复制',
                              )
                            }
                          >
                            {t('复制邀请')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Modal>
    </div>
  );
}

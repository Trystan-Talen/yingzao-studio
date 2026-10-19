import { ReferralDetails, type ReferralSummary } from '../components/ReferralDetails';
import { SupportChannels } from '../components/SupportChannels';
import { t } from '../lib/i18n';
import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  LifeBuoy,
  MessageSquare,
  Plus,
  Send,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { dateTime, post, useApi, useRefresh, type Page } from '../lib/api';
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
  Pagination,
  Segments,
  useAction,
} from '../components/ui';
interface Ticket {
  id: string;
  subject: string;
  category: string;
  status: string;
  message: string;
  createdAt: string;
  resolution?: {
    decision: 'approved' | 'rejected';
    reason: string;
    refundedCredits: number;
    items: { itemId: string; credits: number }[];
    resolvedAt: string;
  } | null;
  replies?: { id: string; message: string; createdAt: string; authorId: string }[];
}
const help = [
  {
    title: '如何开始第一次创作？',
    body: '在灵感广场输入需求，或打开一张灵感卡片创建草稿。选择图片或视频、模型与参考素材，连接服务后查看报价并确认执行。未连接服务时仍可保存草稿、管理素材和编辑画布。',
  },
  {
    title: '额度与供应商费用有什么区别？',
    body: '工作空间额度用于控制任务预算和记录使用情况。接入的模型服务可能另行收费，以供应商账单为准。开发演示空间的额度明确标为本机测试额度，不表示真实付款或赠款。',
  },
  {
    title: '部分成功或等待核对是什么意思？',
    body: '批量任务逐项保存结果。部分成功时，已经完成的素材仍然可用。等待核对表示远端请求结果尚不明确，系统会保留预留额度以避免重复执行，需要确认远端结果后结算。',
  },
  {
    title: '我的图片与文档会保存在哪里？',
    body: '素材原件保存在你部署的映造实例中，访问受工作空间权限限制。预览与缩略图独立于原件。上传的文本、PDF、DOCX会尝试提取参考正文，解析失败会明确显示原因。',
  },
  {
    title: '如何恢复误删的项目或素材？',
    body: '打开项目或素材页的回收站，找到对应条目并恢复。删除不会立即清理原始文件；恢复素材后，引用它的画布可重新显示。',
  },
  {
    title: '品牌与人物会训练模型吗？',
    body: '品牌保存色板、字体和风格参考图，人物保存角色参考素材。它们是创作输入，不代表模型训练或身份认证。依赖真实认证的能力会单独检查状态。',
  },
];
export function Support() {
  const [tab, setTab] = useState<'help' | 'tickets' | 'referrals'>('help');
  const [expanded, setExpanded] = useState(0);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('support');
  const [message, setMessage] = useState('');
  const [jobId, setJobId] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [ticketPage, setTicketPage] = useState(1);
  const tickets = useApi<Page<Ticket>>(
    `/support/tickets?pageSize=100&page=${ticketPage}`,
    tab === 'tickets',
  );
  const ticket = useApi<Ticket>(`/support/tickets/${detail ?? ''}`, !!detail);
  const referrals = useApi<ReferralSummary>('/referrals', tab === 'referrals');
  const action = useAction();
  const refresh = useRefresh();
  return (
    <div className="page">
      <PageHeader
        eyebrow="A LITTLE HELP, A LONG WAY"
        title={t('帮助与支持')}
        description={t('让每一次创作都走得更顺畅。')}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} />
            {t('提交工单')}
          </Button>
        }
      />
      <Segments
        value={tab}
        onChange={setTab}
        options={[
          { value: 'help', label: '使用帮助' },
          { value: 'tickets', label: '我的工单' },
          { value: 'referrals', label: '邀请与奖励' },
        ]}
      />
      {tab === 'help' ? (
        <>
          <SupportChannels />
          <div className="support-cards">
            <Link to="/settings?tab=providers">
              <span className="feature-symbol">
                <LifeBuoy size={24} />
              </span>
              <h3>{t('连接创作服务')}</h3>
              <p>{t('从配置真实模型服务开始。')}</p>
              <span>{t('管理服务 ↗')}</span>
            </Link>
            <Link to="/developer">
              <span className="feature-symbol">
                <BookOpen size={24} />
              </span>
              <h3>{t('开发者文档')}</h3>
              <p>{t('让你的应用接入创作工作空间。')}</p>
              <span>{t('查看开发者入口 ↗')}</span>
            </Link>
            <button
              onClick={() => {
                setCategory('feedback');
                setCreating(true);
              }}
            >
              <span className="feature-symbol">
                <MessageSquare size={24} />
              </span>
              <h3>{t('分享你的建议')}</h3>
              <p>{t('把遇到的问题或新的想法告诉我们。')}</p>
              <span>{t('提交反馈 ↗')}</span>
            </button>
          </div>
          <section className="faq">
            <h2>{t('常见问题')}</h2>
            {help.map((item, index) => (
              <article key={item.title}>
                <button
                  onClick={() => setExpanded(expanded === index ? -1 : index)}
                  aria-expanded={expanded === index}
                >
                  <strong>{t(item.title)}</strong>
                  {expanded === index ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
                {expanded === index && <p>{t(item.body)}</p>}
              </article>
            ))}
          </section>
        </>
      ) : tab === 'tickets' ? (
        <section className="section-spaced">
          {tickets.isLoading ? (
            <Loading />
          ) : tickets.error ? (
            <ErrorState error={tickets.error} retry={tickets.refetch} />
          ) : tickets.data?.items.length ? (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('主题')}</th>
                    <th>{t('类型')}</th>
                    <th>{t('状态')}</th>
                    <th>{t('创建时间')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tickets.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.subject}</strong>
                      </td>
                      <td>
                        {{ feedback: '反馈', appeal: '申诉', support: '支持' }[item.category] ??
                          item.category}
                      </td>
                      <td>
                        <Badge>
                          {t(
                            (
                              {
                                open: '待处理',
                                resolved: '已处理',
                                withdrawn: '已撤回',
                                closed: '已关闭',
                              } as Record<string, string>
                            )[item.status] ?? item.status,
                          )}
                        </Badge>
                      </td>
                      <td>{dateTime(item.createdAt)}</td>
                      <td>
                        <Button variant="ghost" onClick={() => setDetail(item.id)}>
                          {t('查看记录')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={<MessageSquare size={32} />}
              title={t('暂时没有工单')}
              description={t('可以提交反馈、支持请求，或关联任务发起申诉。')}
              action={<Button onClick={() => setCreating(true)}>{t('提交工单')}</Button>}
            />
          )}
        </section>
      ) : (
        <div className="section-spaced">
          {referrals.isLoading ? (
            <Loading />
          ) : referrals.error ? (
            <ErrorState error={referrals.error} />
          ) : (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <span>{t('有效邀请')}</span>
                  <strong>{referrals.data?.qualifiedCount ?? 0}</strong>
                </div>
                <div className="stat-card">
                  <span>{t('已获得奖励额度')}</span>
                  <strong>{referrals.data?.rewardCredits ?? 0}</strong>
                </div>
              </div>
              {referrals.data?.inviteUrl ? (
                <section className="panel settings-panel">
                  <Field label={t('你的邀请链接')}>
                    <input value={referrals.data.inviteUrl} readOnly />
                  </Field>
                  <Button
                    onClick={() =>
                      void action.run(
                        () => navigator.clipboard.writeText(referrals.data?.inviteUrl ?? ''),
                        '邀请链接已复制',
                      )
                    }
                  >
                    {t('复制邀请链接')}
                  </Button>
                </section>
              ) : (
                <Notice>
                  {t(
                    '邀请奖励规则尚未启用。当前没有现金或额度奖励承诺，真实奖励启用后会在这里列出条件与记录。',
                  )}
                </Notice>
              )}
              <ReferralDetails info={referrals.data} />
            </>
          )}
        </div>
      )}
      {tab === 'tickets' && tickets.data && (
        <Pagination
          page={ticketPage}
          total={tickets.data.total}
          pageSize={tickets.data.pageSize}
          onPage={setTicketPage}
        />
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('提交工单')}
        description={t('记录保存在当前工作空间。未接入客服渠道时，提交不代表已发送给外部客服。')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await post('/support/tickets', {
                subject,
                category,
                message,
                ...(jobId.trim() ? { jobId: jobId.trim() } : {}),
                assetIds: [],
              });
              setCreating(false);
              setSubject('');
              setMessage('');
              setJobId('');
              setTab('tickets');
              await refresh();
            }, '工单已保存，状态为待处理');
          }}
        >
          <Field label={t('问题类型')}>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="support">{t('使用支持')}</option>
              <option value="feedback">{t('产品反馈')}</option>
              <option value="appeal">{t('任务申诉')}</option>
            </select>
          </Field>
          <Field label={t('主题')}>
            <input
              required
              maxLength={120}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field label={t('详细说明')}>
            <textarea
              required
              rows={5}
              maxLength={10000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          <Field
            label={category === 'appeal' ? t('关联任务 ID（必填）') : t('关联任务 ID（可选）')}
          >
            <input
              required={category === 'appeal'}
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder={t('可从任务详情复制')}
            />
          </Field>
          <div className="modal-actions">
            <Button type="submit" busy={action.busy}>
              <Send size={15} />
              {t('提交工单')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={ticket.data?.subject ?? '工单详情'}
        description={ticket.data ? `创建于 ${dateTime(ticket.data.createdAt)}` : undefined}
      >
        {ticket.isLoading ? (
          <Loading />
        ) : ticket.error ? (
          <ErrorState error={ticket.error} />
        ) : (
          ticket.data && (
            <>
              <Notice>{ticket.data.message}</Notice>
              {ticket.data.resolution && (
                <section className="assistant-result">
                  <div className="section-heading">
                    <h3>{t('审核结果')}</h3>
                    <Badge>
                      {ticket.data.resolution.decision === 'approved' ? t('已通过') : t('未通过')}
                    </Badge>
                  </div>
                  <p>{ticket.data.resolution.reason}</p>
                  <p>
                    {t('已返还额度')} {ticket.data.resolution.refundedCredits} ·{' '}
                    {dateTime(ticket.data.resolution.resolvedAt)}
                  </p>
                  {ticket.data.resolution.items.map((item) => (
                    <p className="muted" key={item.itemId}>
                      {item.itemId} · {item.credits} {t('额度')}
                    </p>
                  ))}
                </section>
              )}
              <div className="conversation-list">
                {ticket.data.replies?.map((item) => (
                  <div className="message" key={item.id}>
                    <p>{item.message}</p>
                    <small>{dateTime(item.createdAt)}</small>
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async () => {
                    await post(`/support/tickets/${detail}/replies`, { message: reply });
                    setReply('');
                    await refresh();
                  }, '补充说明已保存');
                }}
              >
                <Field label={t('补充说明')}>
                  <textarea
                    disabled={['withdrawn', 'resolved', 'closed'].includes(ticket.data.status)}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    required
                    rows={3}
                  />
                </Field>
                <div className="modal-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={
                      !!ticket.data.resolution ||
                      ['withdrawn', 'resolved', 'closed'].includes(ticket.data.status)
                    }
                    onClick={() =>
                      void action.run(async () => {
                        await post(`/support/tickets/${detail}/withdraw`);
                        setDetail(null);
                        await refresh();
                      }, '工单已撤回')
                    }
                  >
                    {t('撤回工单')}
                  </Button>
                  <Button
                    type="submit"
                    busy={action.busy}
                    disabled={['withdrawn', 'resolved', 'closed'].includes(ticket.data.status)}
                  >
                    {t('保存补充')}
                  </Button>
                </div>
              </form>
            </>
          )
        )}
      </Modal>
    </div>
  );
}

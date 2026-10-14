import { EntitlementsPanel, entitlementLabels } from '../components/Entitlements';
import { CreditBuckets } from '../components/CreditBuckets';
import { useSearchParams } from 'react-router-dom';
import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { FileText, Gift, Plus, Receipt, Wallet } from 'lucide-react';
import type { CreditDto } from '../../contracts/jobs';
import type { StripeInvoiceDocument } from '../../contracts/billing';
import { dateTime, money, patch, post, remove, useApi, useRefresh, type Page } from '../lib/api';
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
import { UsageStatistics } from '../components/UsageStatistics';
interface Ledger {
  id: string;
  kind: string;
  amount: number;
  balanceAfter: number;
  reservedAfter: number;
  description: string;
  createdAt: string;
  jobId: string | null;
}
interface Plan {
  id: string;
  name: string;
  kind: string;
  priceMinor: number;
  currency: string;
  interval: string | null;
  credits: number;
  limits: Record<string, number>;
  providerConfigured: boolean;
}
interface Order {
  id: string;
  number: string;
  kind: string;
  status: string;
  amountMinor: number;
  currency: string;
  planId: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedMinor: number;
  invoiceableMinor: number;
  paymentEnvironment: string;
  billingDocumentAvailable: boolean;
}
interface Title {
  id: string;
  type: string;
  name: string;
  taxId: string | null;
  email: string | null;
}
interface Invoice {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  orderIds: string[];
  downloadAvailable: boolean;
  providerConfigured: boolean;
  delivery: string;
  fileUrl: string | null;
  failureReason: string | null;
}
interface Subscription {
  id: string;
  status: string;
  planId: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}
const invoiceLabels: Record<string, string> = {
  draft: '草稿',
  pending: '已登记申请，未发送',
  withdrawn: '已撤回',
  'review-required': '退款后需重新核对',
  issued: '已开具',
  failed: '未完成',
};
const orderLabels: Record<string, string> = {
  draft: '草稿',
  pending: '待支付',
  paid: '已支付',
  failed: '失败',
  cancelled: '已关闭',
  requested: '已申请',
  processing: '处理中',
  issued: '已开具',
  rejected: '未通过',
};
export function Usage() {
  const { workspace, isAdmin } = useStudio();
  const [search] = useSearchParams();
  const fromCheckout = search.get('checkout');
  const [tab, setTab] = useState<
    'ledger' | 'buckets' | 'statistics' | 'plans' | 'orders' | 'invoices'
  >(
    ['ledger', 'buckets', 'statistics', 'plans', 'orders', 'invoices'].includes(
      search.get('tab') ?? '',
    )
      ? (search.get('tab') as 'ledger' | 'buckets' | 'statistics' | 'plans' | 'orders' | 'invoices')
      : 'ledger',
  );
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  useEffect(() => setPage(1), [tab, filter]);
  const credits = useApi<CreditDto>('/credits', true, 15000);
  const ledger = useApi<Page<Ledger>>(
    `/credits/ledger?pageSize=100&page=${page}${filter === 'all' ? '' : `&kind=${filter}`}`,
    tab === 'ledger',
  );
  const plans = useApi<Page<Plan>>('/plans?pageSize=100', tab === 'plans');
  const orders = useApi<Page<Order>>(
    `/orders?pageSize=100&page=${page}`,
    (tab === 'orders' || tab === 'invoices') && isAdmin,
    fromCheckout === 'success' ? 5000 : undefined,
  );
  const subscriptions = useApi<Page<Subscription>>('/subscriptions', tab === 'plans');
  const titles = useApi<Page<Title>>('/invoice-titles', tab === 'invoices' && isAdmin);
  const invoices = useApi<Page<Invoice>>(
    `/invoices?pageSize=100&page=${page}`,
    tab === 'invoices' && isAdmin,
  );
  const [redeem, setRedeem] = useState(false);
  const [code, setCode] = useState('');
  const [purchase, setPurchase] = useState<Plan | null>(null);
  const [editingTitle, setEditingTitle] = useState<Title | null>(null);
  const [titleModal, setTitleModal] = useState(false);
  const [titleType, setTitleType] = useState('company');
  const [titleName, setTitleName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [email, setEmail] = useState('');
  const [invoiceDetailId, setInvoiceDetailId] = useState<string | null>(null);
  const [billingOrderId, setBillingOrderId] = useState<string | null>(null);
  const billingDocument = useApi<StripeInvoiceDocument>(
    `/orders/${billingOrderId}/billing-document`,
    !!billingOrderId,
  );
  const [invoiceWithdraw, setInvoiceWithdraw] = useState(false);
  const [invoiceReason, setInvoiceReason] = useState('');
  const invoiceDetail = useApi<
    Invoice & {
      events: { id: string; kind: string; createdAt: string; details: Record<string, unknown> }[];
    }
  >(`/invoices/${invoiceDetailId}`, !!invoiceDetailId);
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [selectedTitle, setSelectedTitle] = useState('');
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const action = useAction();
  const refresh = useRefresh();
  useEffect(() => {
    if (fromCheckout) void refresh();
  }, [fromCheckout]);
  return (
    <div className="page">
      <PageHeader
        eyebrow="KNOW WHERE YOUR CREATIVITY GOES"
        title={t('用量与订单')}
        description={t('清楚了解每一次创作的预留、结算与记录。')}
        action={
          <Button variant="secondary" onClick={() => setRedeem(true)}>
            <Gift size={16} />
            {t('兑换额度')}
          </Button>
        }
      />
      {fromCheckout === 'success' && <Notice>{t('正在确认支付，请以订单状态为准。')}</Notice>}
      {fromCheckout === 'cancelled' && (
        <Notice>{t('已返回工作空间，订单是否支付以实际状态为准。')}</Notice>
      )}
      {workspace?.isDemo && (
        <Notice>
          {t(
            '当前空间使用本机测试额度，没有现金价值，也不代表真实付款。供应商实际费用以其账单为准。',
          )}
        </Notice>
      )}
      <div className="stat-grid four">
        <div className="stat-card primary-stat">
          <span>
            <Wallet size={17} />
            {t('可用额度')}
          </span>
          <strong>{credits.data?.available.toLocaleString() ?? '—'}</strong>
          <small>{credits.data?.isDemo ? t('本机测试额度') : t('创作额度')}</small>
        </div>
        <div className="stat-card">
          <span>{t('账户余额')}</span>
          <strong>{credits.data?.balance.toLocaleString() ?? '—'}</strong>
          <small>{t('包含尚未结算的预留')}</small>
        </div>
        <div className="stat-card">
          <span>{t('任务预留')}</span>
          <strong>{credits.data?.reserved.toLocaleString() ?? '—'}</strong>
          <small>{t('处理中与待核对任务')}</small>
        </div>
        <div className="stat-card">
          <span>{t('累计使用')}</span>
          <strong>{credits.data?.spent.toLocaleString() ?? '—'}</strong>
          <small>{t('已完成任务的实际结算')}</small>
        </div>
      </div>
      <Segments
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ledger', label: '额度明细' },
          { value: 'buckets', label: '来源与有效期' },
          { value: 'statistics', label: '成员统计' },
          { value: 'plans', label: '套餐与权益' },
          ...(isAdmin
            ? [
                { value: 'orders' as const, label: '订单' },
                { value: 'invoices' as const, label: '发票与抬头' },
              ]
            : []),
        ]}
      />
      {tab === 'plans' && (
        <div className="section-spaced">
          <EntitlementsPanel />
        </div>
      )}
      {tab === 'ledger' ? (
        <section className="section-spaced">
          <div className="toolbar">
            <h2>{t('额度账本')}</h2>
            <select
              aria-label={t('账本筛选')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">{t('全部记录')}</option>
              <option value="grant">{t('获得额度')}</option>
              <option value="reserve">{t('预留')}</option>
              <option value="settle">{t('消费')}</option>
              <option value="release">{t('释放')}</option>
            </select>
          </div>
          {ledger.isLoading ? (
            <Loading />
          ) : ledger.error ? (
            <ErrorState error={ledger.error} retry={ledger.refetch} />
          ) : ledger.data?.items.filter((item) => filter === 'all' || item.kind === filter)
              .length ? (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('说明')}</th>
                    <th>{t('类型')}</th>
                    <th>{t('额度')}</th>
                    <th>{t('结余')}</th>
                    <th>{t('时间')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.items
                    .filter((item) => filter === 'all' || item.kind === filter)
                    .map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.description}</strong>
                          {item.jobId && (
                            <small className="muted">
                              {t('任务')}
                              {item.jobId.slice(0, 8)}
                            </small>
                          )}
                        </td>
                        <td>
                          <Badge>
                            {t(
                              {
                                grant: '获得',
                                reserve: '预留',
                                settle: '消费',
                                release: '释放',
                                refund: '退款',
                              }[item.kind] ?? item.kind,
                            )}
                          </Badge>
                        </td>
                        <td className="numeric">
                          {item.kind === 'settle'
                            ? '-'
                            : item.kind === 'grant' || item.kind === 'refund'
                              ? '+'
                              : ''}
                          {item.amount}
                        </td>
                        <td className="numeric">{item.balanceAfter}</td>
                        <td>{dateTime(item.createdAt)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={t('这里还没有额度变动')}
              description={t('真实的任务提交与结算会逐笔记录。')}
            />
          )}
        </section>
      ) : tab === 'buckets' ? (
        <CreditBuckets />
      ) : tab === 'statistics' ? (
        <UsageStatistics />
      ) : tab === 'plans' ? (
        <section className="section-spaced">
          {plans.isLoading ? (
            <Loading />
          ) : plans.error ? (
            <ErrorState error={plans.error} />
          ) : plans.data?.items.length ? (
            <div className="plans-grid">
              {plans.data.items.map((plan) => (
                <article className="panel plan-card" key={plan.id}>
                  <Badge>{plan.kind === 'credits' ? t('额度包') : t('订阅方案')}</Badge>
                  <h2>{plan.name}</h2>
                  <p className="plan-price">
                    {money(plan.priceMinor, plan.currency)}
                    <small>
                      {plan.interval ? ` / ${t(plan.interval === 'month' ? '月' : '年')}` : ''}
                    </small>
                  </p>
                  <p>
                    {plan.credits.toLocaleString()}
                    {t('创作额度')}
                  </p>
                  <ul>
                    {Object.entries(plan.limits).map(([key, value]) => (
                      <li key={key}>
                        {t(entitlementLabels[key] ?? key)}：{value}
                      </li>
                    ))}
                  </ul>
                  <Button variant="secondary" disabled={!isAdmin} onClick={() => setPurchase(plan)}>
                    {plan.providerConfigured ? t('选择方案') : t('查看并保存订单草稿')}
                  </Button>
                  {!plan.providerConfigured && (
                    <span className="field-hint">{t('支付服务未配置，不会发放购买额度。')}</span>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title={t('暂无已发布套餐')}
              description={t('管理员配置真实商业方案后，将在这里展示。')}
            />
          )}
          {!!subscriptions.data?.items.length && (
            <section className="panel settings-panel">
              <h2>{t('当前订阅')}</h2>
              {subscriptions.data?.items.map((item) => (
                <div className="version-row" key={item.id}>
                  <div>
                    <strong>{item.planId}</strong>
                    <p>
                      {item.status}
                      {t('· 到期')}
                      {dateTime(item.currentPeriodEnd)}
                    </p>
                  </div>
                  {isAdmin && !item.cancelAtPeriodEnd && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void action.run(
                          () => post(`/subscriptions/${item.id}/cancel`),
                          '已提交取消续订请求',
                        )
                      }
                    >
                      {t('取消续订')}
                    </Button>
                  )}
                </div>
              ))}
            </section>
          )}
        </section>
      ) : tab === 'orders' ? (
        <section className="section-spaced">
          {orders.isLoading ? (
            <Loading />
          ) : orders.error ? (
            <ErrorState error={orders.error} />
          ) : orders.data?.items.length ? (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('订单编号')}</th>
                    <th>{t('金额')}</th>
                    <th>{t('状态')}</th>
                    <th>{t('创建时间')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orders.data.items.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.number}</strong>
                      </td>
                      <td>{money(order.amountMinor, order.currency)}</td>
                      <td>
                        <Badge tone={order.status === 'paid' ? 'green' : 'neutral'}>
                          {t(orderLabels[order.status] ?? order.status)}
                        </Badge>
                      </td>
                      <td>{dateTime(order.createdAt)}</td>
                      <td>
                        {order.billingDocumentAvailable && (
                          <Button variant="secondary" onClick={() => setBillingOrderId(order.id)}>
                            {t('Stripe 账单')}
                          </Button>
                        )}
                        {['draft', 'pending'].includes(order.status) && (
                          <div className="inline-actions">
                            <Button
                              variant="secondary"
                              busy={action.busy}
                              onClick={() =>
                                void action.run(async () => {
                                  const checkout = await post<{ checkoutUrl: string }>(
                                    `/orders/${order.id}/checkout`,
                                  );
                                  window.location.assign(checkout.checkoutUrl);
                                })
                              }
                            >
                              {t('前往支付')}
                            </Button>
                            <Button variant="ghost" onClick={() => setCancelOrder(order)}>
                              {t('关闭')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={<Receipt size={32} />}
              title={t('还没有订单')}
              description={t('真实方案的订单与支付状态会保存在这里。')}
              action={
                <Button variant="secondary" onClick={() => setTab('plans')}>
                  {t('查看套餐')}
                </Button>
              }
            />
          )}
        </section>
      ) : (
        <section className="section-spaced">
          <div className="section-heading">
            <h2>{t('发票记录')}</h2>
            <div className="inline-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setEditingTitle(null);
                  setTitleType('company');
                  setTitleName('');
                  setTaxId('');
                  setEmail('');
                  setTitleModal(true);
                }}
              >
                <Plus size={15} />
                {t('新增抬头')}
              </Button>
              <Button onClick={() => setInvoiceModal(true)}>
                <FileText size={15} />
                {t('申请发票')}
              </Button>
            </div>
          </div>
          {invoices.error ? (
            <ErrorState error={invoices.error} />
          ) : invoices.data?.items.length ? (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('申请时间')}</th>
                    <th>{t('金额')}</th>
                    <th>{t('状态')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{dateTime(item.createdAt)}</td>
                      <td>{money(item.amountMinor, item.currency)}</td>
                      <td>
                        <Badge>{t(invoiceLabels[item.status] ?? item.status)}</Badge>
                      </td>
                      <td>
                        <Button variant="ghost" onClick={() => setInvoiceDetailId(item.id)}>
                          {t('查看申请')}
                        </Button>
                        {item.status === 'draft' && (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              void action.run(async () => {
                                await post(`/invoices/${item.id}/submit`);
                                await refresh();
                              }, '申请已登记，尚未发送至开票服务')
                            }
                          >
                            {t('登记开票申请')}
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
              icon={<FileText size={32} />}
              title={t('暂无发票申请')}
              description={t(
                '仅已支付且有可申请余额的订单可以登记申请。服务未连接时不会发送开票请求或生成正式发票。',
              )}
            />
          )}
          <h2 className="section-spaced">{t('已保存抬头')}</h2>
          <div className="title-grid">
            {titles.data?.items.map((title) => (
              <article className="panel title-card" key={title.id}>
                <Badge>{title.type === 'company' ? t('企业') : t('个人')}</Badge>
                <h3>{title.name}</h3>
                <p>{title.taxId ?? '个人抬头'}</p>
                <span className="muted">{title.email ?? '未设置邮箱'}</span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingTitle(title);
                    setTitleType(title.type);
                    setTitleName(title.name);
                    setTaxId(title.taxId ?? '');
                    setEmail(title.email ?? '');
                    setTitleModal(true);
                  }}
                >
                  {t('编辑抬头')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void action.run(async () => {
                      await remove(`/invoice-titles/${title.id}`);
                      await refresh();
                    }, '抬头已删除')
                  }
                >
                  {t('删除抬头')}
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}
      {(() => {
        const result =
          tab === 'ledger'
            ? ledger.data
            : tab === 'orders'
              ? orders.data
              : tab === 'invoices'
                ? invoices.data
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
      <Modal
        open={!!billingOrderId}
        onClose={() => setBillingOrderId(null)}
        title={t('Stripe 账单')}
      >
        <Notice>{t('这是支付服务商提供的订阅账单，不代表本地税务发票已开具。')}</Notice>
        {billingDocument.isLoading ? (
          <Loading />
        ) : billingDocument.error ? (
          <ErrorState error={billingDocument.error} retry={billingDocument.refetch} />
        ) : (
          billingDocument.data && (
            <div className="section-spaced">
              <div className="inline-actions">
                {billingDocument.data.hostedUrl && (
                  <a
                    className="button secondary"
                    href={billingDocument.data.hostedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('查看服务商账单')}
                  </a>
                )}
                {billingDocument.data.pdfUrl && (
                  <a
                    className="button secondary"
                    href={billingDocument.data.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('打开账单 PDF')}
                  </a>
                )}
              </div>
              {!billingDocument.data.hostedUrl && !billingDocument.data.pdfUrl && (
                <Notice>{t('服务商暂未提供此账单的查看链接。')}</Notice>
              )}
            </div>
          )
        )}
      </Modal>
      <Modal
        open={!!invoiceDetailId}
        onClose={() => setInvoiceDetailId(null)}
        title={t('开票申请详情')}
      >
        {invoiceDetail.isLoading ? (
          <Loading />
        ) : invoiceDetail.error ? (
          <ErrorState error={invoiceDetail.error} retry={invoiceDetail.refetch} />
        ) : (
          invoiceDetail.data && (
            <>
              <dl className="detail-list">
                <div>
                  <dt>{t('状态')}</dt>
                  <dd>
                    {t(invoiceLabels[invoiceDetail.data.status] ?? invoiceDetail.data.status)}
                  </dd>
                </div>
                <div>
                  <dt>{t('申请金额')}</dt>
                  <dd>{money(invoiceDetail.data.amountMinor, invoiceDetail.data.currency)}</dd>
                </div>
                <div>
                  <dt>{t('发送状态')}</dt>
                  <dd>
                    {invoiceDetail.data.delivery === 'not-sent'
                      ? t('未发送')
                      : invoiceDetail.data.delivery}
                  </dd>
                </div>
              </dl>
              <Notice>
                {t('当前没有接通正式开票服务。记录仅为本地申请，不代表已发送或已开具发票。')}
              </Notice>
              {invoiceDetail.data.failureReason && (
                <Notice tone="warning">{t(invoiceDetail.data.failureReason)}</Notice>
              )}
              <h3>{t('申请记录')}</h3>
              {invoiceDetail.data.events.map((event) => (
                <div className="search-result" key={event.id}>
                  <span>
                    {t(
                      (
                        {
                          created: '创建申请',
                          submitted: '登记申请',
                          withdrawn: '撤回申请',
                          'refund-review-required': '退款后核对',
                        } as Record<string, string>
                      )[event.kind] ?? event.kind,
                    )}
                  </span>
                  <small>{dateTime(event.createdAt)}</small>
                </div>
              ))}
              {['draft', 'pending', 'review-required'].includes(invoiceDetail.data.status) && (
                <Button variant="danger" onClick={() => setInvoiceWithdraw(true)}>
                  {t('撤回申请')}
                </Button>
              )}
            </>
          )
        )}
      </Modal>
      <Modal
        open={invoiceWithdraw}
        onClose={() => setInvoiceWithdraw(false)}
        title={t('撤回开票申请')}
        description={t('撤回后释放可申请金额，申请及撤回记录仍然保留。')}
      >
        <Field label={t('撤回原因')}>
          <textarea
            rows={3}
            value={invoiceReason}
            onChange={(e) => setInvoiceReason(e.target.value)}
            maxLength={500}
          />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setInvoiceWithdraw(false)}>
            {t('取消')}
          </Button>
          <Button
            variant="danger"
            busy={action.busy}
            disabled={!invoiceReason.trim()}
            onClick={() =>
              void action.run(async () => {
                await post(`/invoices/${invoiceDetailId}/withdraw`, { reason: invoiceReason });
                setInvoiceWithdraw(false);
                setInvoiceReason('');
                await refresh();
              }, '申请已撤回')
            }
          >
            {t('确认撤回')}
          </Button>
        </div>
      </Modal>
      <Modal
        open={redeem}
        onClose={() => setRedeem(false)}
        title={t('兑换额度')}
        description={t('仅有效且符合当前空间规则的兑换码可以入账。')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await post('/credits/redeem', { code });
              setRedeem(false);
              setCode('');
              await refresh();
            }, '兑换成功，额度已入账');
          }}
        >
          <Field label={t('兑换码')}>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </Field>
          <div className="modal-actions">
            <Button type="submit" busy={action.busy}>
              {t('确认兑换')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!purchase}
        onClose={() => setPurchase(null)}
        title={t('确认方案')}
        description={t('订单价格以服务端快照为准。创建草稿不会自动充值。')}
      >
        {purchase && (
          <>
            <dl className="detail-list">
              <div>
                <dt>{t('方案')}</dt>
                <dd>{purchase.name}</dd>
              </div>
              <div>
                <dt>{t('价格')}</dt>
                <dd>{money(purchase.priceMinor, purchase.currency)}</dd>
              </div>
              <div>
                <dt>{t('额度')}</dt>
                <dd>{purchase.credits}</dd>
              </div>
            </dl>
            {!purchase.providerConfigured && (
              <Notice>{t('支付服务尚未连接。可以保存订单草稿，连接真实商户服务后再支付。')}</Notice>
            )}
            <div className="modal-actions">
              <Button
                busy={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await post('/orders', { planId: purchase.id });
                    setPurchase(null);
                    setTab('orders');
                    await refresh();
                  }, '订单已创建')
                }
              >
                {t('创建订单')}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={titleModal}
        onClose={() => setTitleModal(false)}
        title={editingTitle ? t('编辑发票抬头') : t('新增发票抬头')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await (
                editingTitle
                  ? (data: unknown) => patch(`/invoice-titles/${editingTitle.id}`, data)
                  : (data: unknown) => post('/invoice-titles', data)
              )({
                type: titleType,
                name: titleName,
                taxId: titleType === 'company' ? taxId : null,
                email: email || null,
              });
              setTitleModal(false);
              setTitleName('');
              setTaxId('');
              setEmail('');
              await refresh();
            }, '发票抬头已保存');
          }}
        >
          <Field label={t('抬头类型')}>
            <select value={titleType} onChange={(e) => setTitleType(e.target.value)}>
              <option value="company">{t('企业')}</option>
              <option value="personal">{t('个人')}</option>
            </select>
          </Field>
          <Field label={t('抬头名称')}>
            <input value={titleName} onChange={(e) => setTitleName(e.target.value)} required />
          </Field>
          {titleType === 'company' && (
            <Field label={t('纳税人识别号')}>
              <input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                required
                maxLength={40}
              />
            </Field>
          )}
          <Field label={t('接收邮箱（可选）')}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="modal-actions">
            <Button type="submit" busy={action.busy}>
              {t('保存抬头')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={invoiceModal} onClose={() => setInvoiceModal(false)} title={t('申请发票')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await post('/invoices', { titleId: selectedTitle, orderIds: selectedOrders });
              setInvoiceModal(false);
              setSelectedOrders([]);
              await refresh();
            }, '发票申请已保存');
          }}
        >
          <Field label={t('发票抬头')}>
            <select
              value={selectedTitle}
              onChange={(e) => setSelectedTitle(e.target.value)}
              required
            >
              <option value="">{t('选择已保存的抬头')}</option>
              {titles.data?.items.map((title) => (
                <option key={title.id} value={title.id}>
                  {title.name}
                </option>
              ))}
            </select>
          </Field>
          <span className="field-label">{t('选择已支付订单')}</span>
          {orders.data?.items
            .filter((order) => order.invoiceableMinor > 0)
            .map((order) => (
              <label className="checkbox" key={order.id}>
                <input
                  type="checkbox"
                  checked={selectedOrders.includes(order.id)}
                  onChange={(e) =>
                    setSelectedOrders(
                      e.target.checked
                        ? [...selectedOrders, order.id]
                        : selectedOrders.filter((id) => id !== order.id),
                    )
                  }
                />
                {order.number} · {money(order.invoiceableMinor, order.currency)}
              </label>
            ))}
          {!orders.data?.items.some((order) => order.status === 'paid') && (
            <Empty title={t('暂无可开票的已支付订单')} />
          )}
          <div className="modal-actions">
            <Button
              type="submit"
              disabled={!selectedOrders.length || !selectedTitle}
              busy={action.busy}
            >
              {t('保存发票申请')}
            </Button>
          </div>
        </form>
      </Modal>
      <Confirm
        open={!!cancelOrder}
        onClose={() => setCancelOrder(null)}
        title={t('关闭这笔订单？')}
        description={t('只有尚未支付的订单可以关闭。')}
        busy={action.busy}
        onConfirm={() =>
          void action.run(async () => {
            if (!cancelOrder) return;
            await post(`/orders/${cancelOrder.id}/cancel`);
            setCancelOrder(null);
            await refresh();
          }, '订单已关闭')
        }
      />
    </div>
  );
}

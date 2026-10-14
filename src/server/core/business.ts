import { ReferralService } from './referrals';
import { EntitlementService } from './entitlements';
import * as inputs from '../../contracts/core';
import type { BillingAdapter } from '../billing/contracts';
import {
  ApiKeyInputSchema,
  InvoiceTitleInputSchema,
  TicketInputSchema,
  type Actor,
} from '../../contracts/core';
import { AppError } from '../errors';
import {
  CoreContext,
  type Row,
  type ListQuery,
  str,
  nullable,
  json,
  num,
  id,
  now,
  token,
  hash,
} from './shared';
export class BusinessService {
  private billing: BillingAdapter | null = null;
  constructor(private c: CoreContext) {}
  setBilling(adapter: BillingAdapter) {
    this.billing = adapter;
  }
  private keyDto(r: Row) {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      name: str(r, 'name'),
      prefix: str(r, 'prefix'),
      scopes: json<string[]>(r.scopes_json, []),
      creditLimit: r.credit_limit === null ? null : num(r, 'credit_limit'),
      createdAt: str(r, 'created_at'),
      lastUsedAt: nullable(r, 'last_used_at'),
      expiresAt: nullable(r, 'expires_at'),
      revokedAt: nullable(r, 'revoked_at'),
    };
  }
  keys(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'manage');
    return this.c.page(
      'SELECT * FROM api_keys WHERE workspace_id=? ORDER BY created_at DESC,id',
      [wid],
      q,
      (r) => this.keyDto(r),
    );
  }
  createKey(actor: Actor, wid: string, raw: unknown) {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'manage');
      new EntitlementService(this.c).assertCreate(wid, 'apiKeys');
      const input = ApiKeyInputSchema.parse(raw);
      if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now())
        throw new AppError(400, 'INVALID_EXPIRATION', '过期时间必须在未来');
      const kid = id(),
        secret = `yz_${token()}`,
        date = now();
      this.c.run(
        'INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL)',
        kid,
        wid,
        actor.userId,
        input.name,
        secret.slice(0, 10),
        hash(secret),
        JSON.stringify([...new Set(input.scopes)]),
        input.creditLimit ?? null,
        date,
        input.expiresAt ?? null,
      );
      this.c.audit(actor, wid, 'api-key.create', 'api-key', kid);
      return { key: this.keyDto(this.c.get('SELECT * FROM api_keys WHERE id=?', kid)!), secret };
    });
  }
  revokeKey(actor: Actor, wid: string, kid: string) {
    this.c.requireAccess(actor, wid, 'manage');
    if (!this.c.get('SELECT id FROM api_keys WHERE id=? AND workspace_id=?', kid, wid))
      throw new AppError(404, 'NOT_FOUND', '密钥不存在');
    const date = now();
    this.c.run('UPDATE api_keys SET revoked_at=? WHERE id=?', date, kid);
    this.c.audit(actor, wid, 'api-key.revoke', 'api-key', kid);
    return { id: kid, revokedAt: date };
  }
  plans(q: ListQuery) {
    return this.c.page(
      'SELECT * FROM plans WHERE active=1 ORDER BY price_minor,id',
      [],
      q,
      (r) => ({
        id: str(r, 'id'),
        name: str(r, 'name'),
        kind: str(r, 'kind'),
        priceMinor: num(r, 'price_minor'),
        currency: str(r, 'currency'),
        interval: nullable(r, 'interval'),
        credits: num(r, 'credits'),
        limits: json(r.limits_json, {}),
        catalogMode: str(r, 'catalog_mode'),
        catalogVersion: num(r, 'catalog_version'),
        providerConfigured:
          (this.billing?.isConfigured() ?? false) && this.billing!.canCheckoutPlan(str(r, 'id')),
      }),
    );
  }
  subscriptions(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'manage');
    return this.c.page(
      'SELECT * FROM subscriptions WHERE workspace_id=? ORDER BY created_at DESC,id',
      [wid],
      q,
      (r) => ({
        id: str(r, 'id'),
        workspaceId: wid,
        planId: str(r, 'plan_id'),
        status: str(r, 'status'),
        currentPeriodStart: nullable(r, 'current_period_start'),
        currentPeriodEnd: nullable(r, 'current_period_end'),
        cancelAtPeriodEnd: !!r.cancel_at_period_end,
        providerId: nullable(r, 'provider_id'),
        createdAt: str(r, 'created_at'),
        updatedAt: str(r, 'updated_at'),
      }),
    );
  }
  cancelSubscription(actor: Actor, wid: string, sid: string) {
    if (this.billing) return this.billing.cancelSubscription(actor, wid, sid);
    this.c.requireAccess(actor, wid, 'manage');
    if (!this.c.get('SELECT id FROM subscriptions WHERE id=? AND workspace_id=?', sid, wid))
      throw new AppError(404, 'NOT_FOUND', '订阅不存在');
    throw new AppError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      '尚未连接支付服务，无法变更外部续费授权',
    );
  }
  private orderDto(r: Row) {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      number: str(r, 'number'),
      kind: str(r, 'kind'),
      status: str(r, 'status'),
      amountMinor: num(r, 'amount_minor'),
      currency: str(r, 'currency'),
      planId: nullable(r, 'plan_id'),
      providerId: nullable(r, 'provider_id'),
      billingDocumentAvailable:
        !!r.provider_invoice_id && ['paid', 'refunded'].includes(str(r, 'status')),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
      paidAt: nullable(r, 'paid_at'),
      paymentEnvironment: str(r, 'payment_environment'),
      refundedMinor: num(r, 'refunded_minor'),
      invoiceableMinor: Math.max(
        0,
        num(r, 'amount_minor') -
          num(r, 'refunded_minor') -
          (this.c.get<{ amount: number }>(
            'SELECT COALESCE(SUM(amount_minor),0) amount FROM invoice_orders WHERE order_id=? AND released_at IS NULL',
            str(r, 'id'),
          )?.amount ?? 0),
      ),
    };
  }
  orders(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'manage');
    return this.c.page(
      'SELECT * FROM orders WHERE workspace_id=? ORDER BY created_at DESC,id',
      [wid],
      q,
      (r) => this.orderDto(r),
    );
  }
  getOrder(actor: Actor, wid: string, oid: string) {
    this.c.requireAccess(actor, wid, 'manage');
    return this.orderDto(this.c.resource('orders', wid, oid));
  }
  createOrder(actor: Actor, wid: string, raw: unknown) {
    this.c.requireAccess(actor, wid, 'manage');
    const { planId } = inputs.CreateOrderInputSchema.parse(raw);
    const plan = this.c.get('SELECT * FROM plans WHERE id=? AND active=1', planId);
    if (!plan) throw new AppError(404, 'NOT_FOUND', '套餐不存在');
    const oid = id(),
      date = now(),
      number = `YZ${Date.now()}${oid.slice(0, 8)}`;
    this.c.run(
      'INSERT INTO orders(id,workspace_id,number,kind,status,amount_minor,currency,plan_id,plan_snapshot_json,provider_id,created_by,created_at,updated_at,paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)',
      oid,
      wid,
      number,
      str(plan, 'kind'),
      'draft',
      num(plan, 'price_minor'),
      str(plan, 'currency'),
      planId,
      JSON.stringify(plan),
      null,
      actor.userId,
      date,
      date,
    );
    this.c.audit(actor, wid, 'order.create', 'order', oid);
    return this.getOrder(actor, wid, oid);
  }
  checkout(actor: Actor, wid: string, oid: string) {
    if (this.billing) return this.billing.checkout(actor, wid, oid);
    this.getOrder(actor, wid, oid);
    throw new AppError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      '支付服务未配置；订单已保存为草稿，尚未支付或发放额度',
    );
  }
  billingDocument(actor: Actor, wid: string, oid: string) {
    this.getOrder(actor, wid, oid);
    if (this.billing) return this.billing.invoiceDocument(actor, wid, oid);
    throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', '支付服务未配置，无法查询服务商账单');
  }
  cancelOrder(actor: Actor, wid: string, oid: string) {
    return this.c.transaction(() => {
      const order = this.getOrder(actor, wid, oid);
      if (order.status !== 'draft')
        throw new AppError(409, 'ORDER_STATE_CONFLICT', '仅未提交支付的草稿可本地取消');
      this.c.run("UPDATE orders SET status='cancelled',updated_at=? WHERE id=?", now(), oid);
      return this.getOrder(actor, wid, oid);
    });
  }
  private titleDto(r: Row) {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      type: str(r, 'type'),
      name: str(r, 'name'),
      taxId: nullable(r, 'tax_id'),
      email: nullable(r, 'email'),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }
  titles(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'manage');
    return this.c.page(
      'SELECT * FROM invoice_titles WHERE workspace_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id',
      [wid],
      q,
      (r) => this.titleDto(r),
    );
  }
  createTitle(actor: Actor, wid: string, raw: unknown) {
    this.c.requireAccess(actor, wid, 'manage');
    const input = InvoiceTitleInputSchema.parse(raw),
      tid = id(),
      date = now();
    this.c.run(
      'INSERT INTO invoice_titles VALUES (?,?,?,?,?,?,?,?,NULL)',
      tid,
      wid,
      input.type,
      input.name,
      input.taxId,
      input.email,
      date,
      date,
    );
    return this.titleDto(this.c.resource('invoice_titles', wid, tid));
  }
  updateTitle(actor: Actor, wid: string, tid: string, raw: unknown) {
    this.c.requireAccess(actor, wid, 'manage');
    this.c.resource('invoice_titles', wid, tid);
    const input = InvoiceTitleInputSchema.parse(raw);
    this.c.run(
      'UPDATE invoice_titles SET type=?,name=?,tax_id=?,email=?,updated_at=? WHERE id=?',
      input.type,
      input.name,
      input.taxId,
      input.email,
      now(),
      tid,
    );
    return this.titleDto(this.c.resource('invoice_titles', wid, tid));
  }
  removeTitle(actor: Actor, wid: string, tid: string) {
    this.c.requireAccess(actor, wid, 'manage');
    this.c.resource('invoice_titles', wid, tid);
    const date = now();
    this.c.run('UPDATE invoice_titles SET deleted_at=?,updated_at=? WHERE id=?', date, date, tid);
    return { id: tid, deletedAt: date };
  }
  private invoiceDto(r: Row) {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      orderIds: this.c
        .all('SELECT order_id FROM invoice_orders WHERE invoice_id=?', str(r, 'id'))
        .map((o) => str(o, 'order_id')),
      titleSnapshot: json(r.title_snapshot_json, {}),
      status: str(r, 'status'),
      amountMinor: num(r, 'amount_minor'),
      currency: str(r, 'currency'),
      providerId: nullable(r, 'provider_id'),
      downloadAvailable: false,
      providerConfigured: false,
      delivery: 'not-sent' as const,
      fileUrl: null,
      failureReason:
        str(r, 'status') === 'review-required' ? '关联订单发生退款，申请金额需重新核对' : null,
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }
  invoices(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'manage');
    return this.c.page(
      'SELECT * FROM invoice_requests WHERE workspace_id=? ORDER BY created_at DESC,id',
      [wid],
      q,
      (r) => this.invoiceDto(r),
    );
  }
  createInvoice(actor: Actor, wid: string, raw: unknown) {
    const input = inputs.CreateInvoiceInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'manage');
      const title = this.titleDto(this.c.resource('invoice_titles', wid, input.titleId));
      const orders = [...new Set(input.orderIds)].map((oid) => this.getOrder(actor, wid, oid));
      if (orders.some((o) => o.status !== 'paid'))
        throw new AppError(409, 'UNPAID_ORDER', '仅已支付订单可申请发票');
      if (new Set(orders.map((o) => o.currency)).size !== 1)
        throw new AppError(400, 'CURRENCY_MISMATCH', '不能合并不同币种');
      if (
        orders.some((o) =>
          this.c.get(
            'SELECT order_id FROM invoice_orders WHERE order_id=? AND released_at IS NULL',
            o.id,
          ),
        )
      )
        throw new AppError(409, 'ALREADY_INVOICED', '订单已关联发票申请');
      if (orders.some((o) => o.invoiceableMinor <= 0))
        throw new AppError(409, 'NO_INVOICEABLE_AMOUNT', '所选订单没有可申请金额');
      const iid = id(),
        date = now();
      this.c.run(
        'INSERT INTO invoice_requests VALUES (?,?,?,?,?,?,NULL,NULL,?,?,?)',
        iid,
        wid,
        JSON.stringify(title),
        'draft',
        orders.reduce((sum, o) => sum + o.invoiceableMinor, 0),
        orders[0]!.currency,
        actor.userId,
        date,
        date,
      );
      for (const order of orders)
        this.c.run(
          'INSERT INTO invoice_orders(invoice_id,order_id,amount_minor) VALUES (?,?,?)',
          iid,
          order.id,
          order.invoiceableMinor,
        );
      this.c.audit(actor, wid, 'invoice.create', 'invoice', iid);
      return this.invoiceDto(this.c.resource('invoice_requests', wid, iid));
    });
  }
  invoice(actor: Actor, wid: string, iid: string) {
    this.c.requireAccess(actor, wid, 'manage');
    return {
      ...this.invoiceDto(this.c.resource('invoice_requests', wid, iid)),
      events: this.c
        .all(
          'SELECT id,kind,created_at,details_json FROM invoice_events WHERE invoice_id=? ORDER BY created_at,id',
          iid,
        )
        .map((r) => ({
          id: str(r, 'id'),
          kind: str(r, 'kind'),
          createdAt: str(r, 'created_at'),
          details: json(r.details_json, {}),
        })),
    };
  }
  submitInvoice(actor: Actor, wid: string, iid: string) {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'manage');
      const request = this.c.resource('invoice_requests', wid, iid);
      if (request.status === 'pending') return this.invoice(actor, wid, iid);
      if (request.status !== 'draft')
        throw new AppError(
          409,
          'INVOICE_STATE_CONFLICT',
          '仅草稿可以登记申请；需要重新核对的申请请先撤回',
        );
      const allocations = this.c.all(
        'SELECT io.amount_minor,o.amount_minor paid_minor,o.refunded_minor,o.status FROM invoice_orders io JOIN orders o ON o.id=io.order_id WHERE io.invoice_id=? AND io.released_at IS NULL',
        iid,
      );
      if (
        !allocations.length ||
        allocations.some(
          (a) =>
            a.status !== 'paid' ||
            num(a, 'amount_minor') > num(a, 'paid_minor') - num(a, 'refunded_minor'),
        )
      )
        throw new AppError(409, 'INVOICE_AMOUNT_CHANGED', '订单可开金额已经改变，请撤回并重新申请');
      this.c.run(
        "UPDATE invoice_requests SET status='pending',updated_at=? WHERE id=?",
        now(),
        iid,
      );
      this.c.run(
        'INSERT INTO invoice_events VALUES(?,?,?,?,?,?)',
        id(),
        iid,
        actor.userId,
        'local-requested',
        JSON.stringify({
          delivery: 'not-sent',
          message: '申请已在本机登记，未连接正式开票服务，尚未发送或开具',
        }),
        now(),
      );
      this.c.audit(actor, wid, 'invoice.local-requested', 'invoice', iid);
      return this.invoice(actor, wid, iid);
    });
  }
  withdrawInvoice(actor: Actor, wid: string, iid: string, raw: unknown) {
    const input = inputs.InvoiceWithdrawInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'manage');
      const request = this.c.resource('invoice_requests', wid, iid);
      if (request.status === 'withdrawn') return this.invoice(actor, wid, iid);
      if (!['draft', 'pending', 'review-required'].includes(str(request, 'status')))
        throw new AppError(409, 'INVOICE_STATE_CONFLICT', '已进入外部开票处理的记录不能本地撤回');
      this.c.run(
        "UPDATE invoice_requests SET status='withdrawn',updated_at=? WHERE id=?",
        now(),
        iid,
      );
      this.c.run(
        'UPDATE invoice_orders SET released_at=? WHERE invoice_id=? AND released_at IS NULL',
        now(),
        iid,
      );
      this.c.run(
        'INSERT INTO invoice_events VALUES(?,?,?,?,?,?)',
        id(),
        iid,
        actor.userId,
        'withdrawn',
        JSON.stringify({ reason: input.reason }),
        now(),
      );
      this.c.audit(actor, wid, 'invoice.withdrawn', 'invoice', iid, { reason: input.reason });
      return this.invoice(actor, wid, iid);
    });
  }
  tickets(actor: Actor, wid: string, q: ListQuery) {
    const access = this.c.requireAccess(actor, wid, 'read'),
      manage = ['owner', 'admin'].includes(access.role);
    return this.c.page(
      `SELECT * FROM support_tickets WHERE workspace_id=?${manage ? '' : ' AND created_by=?'} ORDER BY created_at DESC,id`,
      manage ? [wid] : [wid, actor.userId],
      q,
      (r) => this.ticketDto(r),
    );
  }
  private ticketDto(r: Row) {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      createdBy: str(r, 'created_by'),
      subject: str(r, 'subject'),
      category: str(r, 'category'),
      message: str(r, 'message'),
      jobId: nullable(r, 'job_id'),
      assetIds: json<string[]>(r.asset_ids_json, []),
      status: str(r, 'status'),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }
  createTicket(actor: Actor, wid: string, raw: unknown) {
    const access = this.c.requireAccess(actor, wid, 'read');
    const input = TicketInputSchema.parse(raw);
    if (input.category === 'appeal' && !input.jobId)
      throw new AppError(400, 'APPEAL_JOB_REQUIRED', '任务申诉必须关联具体任务');
    for (const aid of input.assetIds) this.c.resource('assets', wid, aid);
    if (input.jobId) {
      const table = this.c.get("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'");
      if (
        !table ||
        !this.c.get(
          `SELECT id FROM jobs WHERE id=? AND workspace_id=?${['owner', 'admin'].includes(access.role) ? '' : ' AND user_id=?'}`,
          input.jobId,
          wid,
          ...(['owner', 'admin'].includes(access.role) ? [] : [actor.userId]),
        )
      )
        throw new AppError(404, 'NOT_FOUND', '关联任务不存在');
    }
    const tid = id(),
      date = now();
    this.c.run(
      'INSERT INTO support_tickets VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      tid,
      wid,
      actor.userId,
      input.subject,
      input.category,
      input.message,
      input.jobId ?? null,
      JSON.stringify(input.assetIds),
      'open',
      date,
      date,
    );
    this.c.audit(actor, wid, 'ticket.create', 'ticket', tid);
    return this.ticketDto(this.c.resource('support_tickets', wid, tid));
  }
  ticket(actor: Actor, wid: string, tid: string) {
    const access = this.c.requireAccess(actor, wid, 'read'),
      row = this.c.resource('support_tickets', wid, tid);
    if (row.created_by !== actor.userId && !['owner', 'admin'].includes(access.role))
      throw new AppError(404, 'NOT_FOUND', '工单不存在');
    return {
      ...this.ticketDto(row),
      resolution: this.resolution(tid),
      replies: this.c
        .all('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY created_at,id', tid)
        .map((r) => ({
          id: str(r, 'id'),
          userId: str(r, 'user_id'),
          message: str(r, 'message'),
          createdAt: str(r, 'created_at'),
        })),
    };
  }
  private resolution(tid: string) {
    const row = this.c.get('SELECT * FROM support_resolutions WHERE ticket_id=?', tid);
    if (!row) return null;
    return {
      decision: str(row, 'decision') as 'approved' | 'rejected',
      reason: str(row, 'reason'),
      refundedCredits: num(row, 'refunded_credits'),
      resolvedAt: str(row, 'created_at'),
      items: this.c
        .all(
          'SELECT item_id,credits FROM support_refunds WHERE resolution_id=? ORDER BY item_id',
          str(row, 'id'),
        )
        .map((i) => ({ itemId: str(i, 'item_id'), credits: num(i, 'credits') })),
    };
  }
  reply(actor: Actor, wid: string, tid: string, raw: unknown) {
    return this.c.transaction(() => {
      const ticket = this.ticket(actor, wid, tid);
      if (ticket.status !== 'open')
        throw new AppError(409, 'TICKET_CLOSED', '已撤回的工单不能补充');
      const { message } = inputs.TicketReplyInputSchema.parse(raw),
        messageId = id();
      this.c.run(
        'INSERT INTO ticket_messages VALUES (?,?,?,?,?)',
        messageId,
        tid,
        actor.userId,
        message,
        now(),
      );
      this.c.run('UPDATE support_tickets SET updated_at=? WHERE id=?', now(), tid);
      this.c.hooks.onSupportReplyCreated?.({ workspaceId: wid, ticketId: tid, messageId });
      return this.ticket(actor, wid, tid);
    });
  }
  withdraw(actor: Actor, wid: string, tid: string) {
    const ticket = this.ticket(actor, wid, tid);
    if (ticket.createdBy !== actor.userId) throw new AppError(403, 'FORBIDDEN', '仅提交者可撤回');
    if (ticket.status === 'resolved')
      throw new AppError(409, 'TICKET_CLOSED', '已审核申诉不能撤回');
    this.c.run("UPDATE support_tickets SET status='withdrawn',updated_at=? WHERE id=?", now(), tid);
    return this.ticket(actor, wid, tid);
  }
  referrals(actor: Actor, wid: string) {
    this.c.requireAccess(actor, wid, 'read');
    let row = this.c.get('SELECT * FROM referrals WHERE user_id=?', actor.userId);
    if (!row) {
      const rid = id(),
        code = token().slice(0, 16);
      this.c.run(
        'INSERT OR IGNORE INTO referrals VALUES (?,?,?,?)',
        rid,
        actor.userId,
        code,
        now(),
      );
      row = this.c.get('SELECT * FROM referrals WHERE user_id=?', actor.userId)!;
    }
    return {
      inviteCode: str(row, 'code'),
      inviteUrl: `${this.c.config.publicOrigin}/register?ref=${str(row, 'code')}`,
      ...new ReferralService(this.c).summary(actor, wid),
    };
  }
  notifications(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'read');
    return this.c.page(
      'SELECT * FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC,id',
      [wid, actor.userId],
      q,
      (r) => ({
        id: str(r, 'id'),
        title: str(r, 'title'),
        message: str(r, 'message'),
        readAt: nullable(r, 'read_at'),
        createdAt: str(r, 'created_at'),
      }),
    );
  }
  readNotification(actor: Actor, wid: string, nid: string) {
    this.c.requireAccess(actor, wid, 'read');
    if (
      !this.c.get(
        'SELECT id FROM notifications WHERE id=? AND workspace_id=? AND user_id=?',
        nid,
        wid,
        actor.userId,
      )
    )
      throw new AppError(404, 'NOT_FOUND', '通知不存在');
    const date = now();
    this.c.run('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=?', date, nid);
    return { id: nid, readAt: date };
  }
}

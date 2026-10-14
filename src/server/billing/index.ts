import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../../contracts/core';
import type { DatabaseContext } from '../db/connection';
import type { CoreServices } from '../core';
import type { AppConfig } from '../config';
import type { CreditService } from '../tasks/credits';
import { AppError } from '../errors';
import { now } from '../tasks/types';
import {
  createStripeGateway,
  type StripeGateway,
  type StripeEvent,
  type CheckoutSession,
} from './stripe-gateway';
import { createBillingStore, iso, type OrderRow } from './store';
import type { BillingAdapter, CheckoutResult } from './contracts';
export type { BillingAdapter, CheckoutResult } from './contracts';
interface CheckoutRow {
  order_id: string;
  idempotency_key: string;
  session_id: string | null;
  checkout_url: string | null;
  expires_at: string | null;
  created_at: string;
}
export function createBillingService(
  db: DatabaseContext,
  core: CoreServices,
  config: AppConfig,
  credits: CreditService,
  gatewayOverride?: StripeGateway,
) {
  const store = createBillingStore(db, core, credits),
    { sql, atomic } = store;
  const key = config.billing?.stripeSecretKey,
    webhookSecret = config.billing?.stripeWebhookSecret;
  const environment = key?.startsWith('sk_live_') ? 'live' : 'test';
  const configured = Boolean(
    key && webhookSecret && (!config.demoMode || key.startsWith('sk_test_')),
  );
  function canCheckoutPlan(planId: string) {
    const plan = sql
      .prepare('SELECT catalog_mode FROM plans WHERE id=? AND active=1')
      .get(planId) as { catalog_mode: string } | undefined;
    return configured && !!plan && (environment === 'test' || plan.catalog_mode === 'official');
  }
  const gateway = gatewayOverride ?? (key ? createStripeGateway(key) : null);
  function requireGateway() {
    if (!configured || !gateway)
      throw new AppError(
        503,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        '支付服务未配置；订单保留草稿，尚未支付或发放额度',
      );
    return gateway;
  }
  const external = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'PAYMENT_PROVIDER_ERROR',
        '暂时无法确认支付服务结果，请稍后重新查询；不会依据跳转页面入账',
      );
    }
  };
  function checkoutResult(oid: string, s: CheckoutSession): CheckoutResult {
    if (
      !s.url ||
      new URL(s.url).hostname !== 'checkout.stripe.com' ||
      new URL(s.url).protocol !== 'https:'
    )
      throw new AppError(409, 'CHECKOUT_CLOSED', '支付会话已结束，请刷新订单状态');
    return {
      orderId: oid,
      provider: 'stripe',
      checkoutUrl: s.url,
      url: s.url,
      expiresAt: iso(s.expires_at),
    };
  }
  async function checkout(actor: Actor, wid: string, oid: string): Promise<CheckoutResult> {
    core.requireAccess(actor, wid, 'manage');
    core.business.getOrder(actor, wid, oid);
    const api = requireGateway();
    const { order, record } = atomic(() => {
      const order = store.order(oid);
      const snapshot = store.plan(order);
      const workspace = sql.prepare('SELECT is_demo FROM workspaces WHERE id=?').get(wid) as {
        is_demo: number;
      };
      if (
        environment === 'live' &&
        (workspace.is_demo || snapshot.catalog_mode !== 'official' || !snapshot.approved_at)
      )
        throw new AppError(
          409,
          'UNAPPROVED_CATALOG',
          '演示空间或未经正式批准的套餐不得发起现金支付',
        );
      if (order.payment_environment !== 'unbound' && order.payment_environment !== environment)
        throw new AppError(
          409,
          'PAYMENT_ENVIRONMENT_MISMATCH',
          '此订单属于不同支付环境，请重新创建订单',
        );
      if (!['draft', 'pending'].includes(order.status))
        throw new AppError(409, 'ORDER_STATE_CONFLICT', '该订单已完成或已关闭');
      let record = sql.prepare('SELECT * FROM stripe_checkouts WHERE order_id=?').get(oid) as
        CheckoutRow | undefined;
      if (!record) {
        if (
          order.kind === 'subscription' &&
          sql
            .prepare(
              "SELECT 1 FROM subscriptions WHERE workspace_id=? AND status IN ('active','trialing','incomplete','past_due','unpaid')",
            )
            .get(wid)
        )
          throw new AppError(
            409,
            'SUBSCRIPTION_EXISTS',
            '当前空间已有订阅，请先在订阅管理中处理现有授权',
          );
        sql
          .prepare(
            'INSERT INTO stripe_checkouts(order_id,idempotency_key,created_at,updated_at) VALUES(?,?,?,?)',
          )
          .run(oid, `yingzao:checkout:${oid}`, now(), now());
        sql
          .prepare(
            "UPDATE orders SET status='pending',provider_id='stripe',payment_environment=?,updated_at=? WHERE id=?",
          )
          .run(environment, now(), oid);
        record = sql
          .prepare('SELECT * FROM stripe_checkouts WHERE order_id=?')
          .get(oid) as CheckoutRow;
      }
      return { order, record };
    });
    if (record.session_id) {
      const existing = await external(() => api.retrieveCheckout(record.session_id!));
      return checkoutResult(oid, existing);
    }
    if (Date.now() - Date.parse(record.created_at) > 23 * 60 * 60 * 1000)
      throw new AppError(
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
        '支付会话创建结果待核对，已停止自动重复创建',
      );
    const plan = store.plan(order),
      metadata = { order_id: order.id, workspace_id: wid };
    const session = await external(() =>
      api.createCheckout(
        {
          mode: plan.kind === 'subscription' ? 'subscription' : 'payment',
          client_reference_id: order.id,
          metadata,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: plan.currency.toLowerCase(),
                unit_amount: plan.price_minor,
                product_data: { name: plan.name },
                ...(plan.kind === 'subscription'
                  ? { recurring: { interval: plan.interval! } }
                  : {}),
              },
            },
          ],
          ...(plan.kind === 'subscription'
            ? { subscription_data: { metadata } }
            : { payment_intent_data: { metadata } }),
          success_url: `${config.publicOrigin}/usage?tab=orders&order=${order.id}&checkout=success`,
          cancel_url: `${config.publicOrigin}/usage?tab=orders&order=${order.id}&checkout=cancelled`,
        },
        record.idempotency_key,
      ),
    );
    if (session.metadata.order_id !== order.id || session.metadata.workspace_id !== wid)
      throw new AppError(409, 'CHECKOUT_MISMATCH', '支付会话与订单不匹配');
    atomic(() => {
      sql
        .prepare(
          'UPDATE stripe_checkouts SET session_id=?,checkout_url=?,expires_at=?,updated_at=? WHERE order_id=?',
        )
        .run(session.id, session.url ?? null, iso(session.expires_at), now(), oid);
      sql
        .prepare('UPDATE orders SET provider_session_id=?,updated_at=? WHERE id=?')
        .run(session.id, now(), oid);
    });
    return checkoutResult(oid, session);
  }
  async function cancelSubscription(actor: Actor, wid: string, id: string) {
    core.requireAccess(actor, wid, 'manage');
    const row = sql
      .prepare('SELECT * FROM subscriptions WHERE id=? AND workspace_id=?')
      .get(id, wid) as
      { provider_subscription_id: string | null; source_order_id: string | null } | undefined;
    if (!row) throw new AppError(404, 'NOT_FOUND', '订阅不存在');
    const api = requireGateway();
    if (!row.provider_subscription_id || !row.source_order_id)
      throw new AppError(409, 'SUBSCRIPTION_UNBOUND', '订阅尚未绑定支付服务');
    const sub = await external(() =>
      api.cancelSubscriptionAtPeriodEnd(
        row.provider_subscription_id!,
        `yingzao:cancel:${row.provider_subscription_id}:${randomUUID()}`,
      ),
    );
    atomic(() => store.syncSubscription(sub, store.order(row.source_order_id!)));
    return {
      id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: sub.items.data[0] ? iso(sub.items.data[0].current_period_end) : null,
    };
  }
  async function invoiceDocument(actor: Actor, wid: string, oid: string) {
    core.requireAccess(actor, wid, 'manage');
    core.business.getOrder(actor, wid, oid);
    const o = store.order(oid);
    if (!o.provider_invoice_id || !['paid', 'refunded'].includes(o.status))
      throw new AppError(404, 'BILLING_DOCUMENT_UNAVAILABLE', '此订单尚无支付服务商账单');
    if (o.payment_environment !== environment || o.provider_id !== 'stripe')
      throw new AppError(409, 'PAYMENT_ENVIRONMENT_MISMATCH', '账单属于不同支付环境');
    const invoice = await external(() => requireGateway().retrieveInvoice(o.provider_invoice_id!));
    // Query only the persisted invoice bound by a verified webhook, never an arbitrary client ID.
    if (
      invoice.id !== o.provider_invoice_id ||
      invoice.currency.toLowerCase() !== o.currency.toLowerCase() ||
      invoice.total !== o.amount_minor
    )
      throw new AppError(409, 'INVOICE_MISMATCH', '服务商账单与订单不一致，需要人工核对');
    const safeUrl = (value: string | null | undefined, hostname: string) => {
      if (!value) return null;
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== hostname ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443')
      )
        throw new AppError(502, 'INVALID_BILLING_DOCUMENT_URL', '服务商返回了无法确认的账单链接');
      return url.href;
    };
    // Access may have been revoked while the provider request was in flight.
    core.requireAccess(actor, wid, 'manage');
    core.business.getOrder(actor, wid, oid);
    return {
      orderId: oid,
      provider: 'stripe' as const,
      invoiceId: invoice.id,
      hostedUrl: safeUrl(invoice.hosted_invoice_url, 'invoice.stripe.com'),
      pdfUrl: safeUrl(invoice.invoice_pdf, 'pay.stripe.com'),
      kind: 'provider-billing-document' as const,
    };
  }
  function completeEvent(event: StripeEvent, objectId: string, apply: () => void) {
    return atomic(() => {
      if (sql.prepare('SELECT 1 FROM stripe_events WHERE event_id=?').get(event.id))
        return { received: true as const, duplicate: true };
      apply();
      sql
        .prepare('INSERT INTO stripe_events VALUES(?,?,?,?,?)')
        .run(event.id, event.type, objectId, event.created, now());
      return { received: true as const, duplicate: false };
    });
  }
  function validateBoundOrder(o: OrderRow) {
    if (
      o.payment_environment !== environment ||
      !sql.prepare('SELECT 1 FROM stripe_checkouts WHERE order_id=?').get(o.id)
    )
      throw new AppError(
        409,
        'PAYMENT_ENVIRONMENT_MISMATCH',
        '回调订单未在当前支付环境创建有效会话',
      );
  }
  function validateSession(session: CheckoutSession, o: OrderRow) {
    validateBoundOrder(o);
    const p = store.plan(o),
      item = session.line_items?.data[0];
    if (
      session.metadata.order_id !== o.id ||
      session.metadata.workspace_id !== o.workspace_id ||
      session.client_reference_id !== o.id ||
      session.mode !== (p.kind === 'subscription' ? 'subscription' : 'payment') ||
      session.amount_total !== o.amount_minor ||
      session.currency?.toLowerCase() !== o.currency.toLowerCase() ||
      session.line_items?.has_more ||
      session.line_items?.data.length !== 1 ||
      item?.quantity !== 1 ||
      item.price?.unit_amount !== o.amount_minor ||
      item.price.currency.toLowerCase() !== o.currency.toLowerCase() ||
      (o.provider_session_id && o.provider_session_id !== session.id)
    )
      throw new AppError(409, 'PAYMENT_MISMATCH', '支付金额、币种或内容与订单不一致，需要人工核对');
  }
  async function handleWebhook(raw: Buffer, signature: string) {
    if (raw.length > 1024 * 1024) throw new AppError(413, 'WEBHOOK_TOO_LARGE', '回调超过大小限制');
    const api = requireGateway();
    let event: StripeEvent;
    try {
      event = api.verifyWebhook(raw, signature, webhookSecret!);
    } catch {
      throw new AppError(400, 'WEBHOOK_SIGNATURE', '支付回调签名无效或过期');
    }
    if (raw.length > 1024 * 1024) throw new AppError(413, 'WEBHOOK_TOO_LARGE', '回调超过大小限制');
    if (event.livemode !== Boolean(key?.startsWith('sk_live_')))
      throw new AppError(400, 'WEBHOOK_MODE', '支付回调环境与当前配置不一致');
    const objectId = z.object({ id: z.string() }).parse(event.object).id;
    if (sql.prepare('SELECT 1 FROM stripe_events WHERE event_id=?').get(event.id))
      return { received: true as const, duplicate: true };
    if (
      [
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed',
        'checkout.session.expired',
      ].includes(event.type)
    ) {
      const session = await external(() => api.retrieveCheckout(objectId));
      const oid = session.metadata.order_id;
      if (!oid || !sql.prepare('SELECT 1 FROM orders WHERE id=?').get(oid))
        return completeEvent(event, objectId, () => {});
      const o = store.order(oid);
      validateSession(session, o);
      const sub = session.subscription
        ? await external(() => api.retrieveSubscription(session.subscription!))
        : null;
      return completeEvent(event, objectId, () => {
        sql
          .prepare(
            "UPDATE orders SET provider_id='stripe',provider_session_id=?,provider_payment_intent_id=COALESCE(?,provider_payment_intent_id),updated_at=? WHERE id=?",
          )
          .run(session.id, session.payment_intent, now(), o.id);
        sql
          .prepare(
            'UPDATE stripe_checkouts SET session_id=?,checkout_url=?,expires_at=?,updated_at=? WHERE order_id=?',
          )
          .run(session.id, session.url ?? null, iso(session.expires_at), now(), o.id);
        if (sub) store.syncSubscription(sub, o);
        if (session.mode === 'payment' && session.payment_status === 'paid')
          store.grant(store.order(o.id), `checkout:${session.id}`, store.plan(o).credits, {
            paidAt: iso(event.created),
          });
        else if (
          !['paid', 'refunded'].includes(store.order(o.id).status) &&
          (session.status === 'expired' || event.type === 'checkout.session.async_payment_failed')
        )
          sql.prepare("UPDATE orders SET status='failed',updated_at=? WHERE id=?").run(now(), o.id);
        store.linkRisk(store.order(o.id));
      });
    }
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoice = await external(() => api.retrieveInvoice(objectId)),
        sid = invoice.parent?.subscription_details?.subscription;
      if (!sid) return completeEvent(event, objectId, () => {});
      const sub = await external(() => api.retrieveSubscription(sid));
      const oid = sub.metadata.order_id;
      if (!oid || !sql.prepare('SELECT 1 FROM orders WHERE id=?').get(oid))
        return completeEvent(event, objectId, () => {});
      const source = store.order(oid);
      validateBoundOrder(source);
      store.validateSubscription(sub, source);
      return completeEvent(event, objectId, () => {
        store.syncSubscription(sub, source);
        if (invoice.status !== 'paid') return;
        if (
          !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason ?? '') ||
          invoice.amount_paid !== source.amount_minor ||
          invoice.total !== source.amount_minor ||
          invoice.currency.toLowerCase() !== source.currency.toLowerCase() ||
          invoice.lines.has_more ||
          invoice.lines.data.length !== 1 ||
          invoice.lines.data[0]?.quantity !== 1 ||
          invoice.lines.data[0]?.amount !== source.amount_minor
        )
          throw new AppError(409, 'INVOICE_MISMATCH', '账单与订阅快照不一致，未自动发放额度');
        let o = sql.prepare('SELECT * FROM orders WHERE provider_invoice_id=?').get(invoice.id) as
          OrderRow | undefined;
        if (!o) {
          if (invoice.billing_reason === 'subscription_create') {
            o = store.order(source.id);
            if (o.provider_invoice_id && o.provider_invoice_id !== invoice.id)
              throw new AppError(409, 'INVOICE_CONFLICT', '初始订阅已经关联其他账单');
          } else {
            const id = randomUUID();
            sql
              .prepare(
                "INSERT INTO orders(id,workspace_id,number,kind,status,amount_minor,currency,plan_id,plan_snapshot_json,provider_id,created_by,created_at,updated_at) VALUES(?,?,?,'subscription','pending',?,?,?,?, 'stripe',?,?,?)",
              )
              .run(
                id,
                source.workspace_id,
                `YZ${Date.now()}${id.slice(0, 8)}`,
                source.amount_minor,
                source.currency,
                source.plan_id,
                source.plan_snapshot_json,
                source.created_by,
                now(),
                now(),
              );
            sql
              .prepare('UPDATE orders SET payment_environment=? WHERE id=?')
              .run(source.payment_environment, id);
            o = store.order(id);
          }
        }
        const payment =
          invoice.payments?.data.find((p) => p.status === 'paid')?.payment.payment_intent ?? null;
        sql
          .prepare(
            'UPDATE orders SET provider_invoice_id=?,provider_payment_intent_id=COALESCE(?,provider_payment_intent_id),updated_at=? WHERE id=?',
          )
          .run(invoice.id, payment, now(), o.id);
        store.grant(store.order(o.id), `invoice:${invoice.id}`, store.plan(source).credits, {
          paidAt: iso(event.created),
          expiresAt: iso(sub.items.data[0]!.current_period_end),
        });
        store.linkRisk(store.order(o.id));
      });
    }
    if (
      [
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'customer.subscription.paused',
        'customer.subscription.resumed',
      ].includes(event.type)
    ) {
      const sub = await external(() => api.retrieveSubscription(objectId));
      const oid = sub.metadata.order_id;
      if (!oid || !sql.prepare('SELECT 1 FROM orders WHERE id=?').get(oid))
        return completeEvent(event, objectId, () => {});
      const source = store.order(oid);
      validateBoundOrder(source);
      return completeEvent(event, objectId, () => store.syncSubscription(sub, source));
    }
    if (
      [
        'charge.refunded',
        'charge.dispute.created',
        'charge.dispute.updated',
        'charge.dispute.closed',
        'radar.early_fraud_warning.created',
      ].includes(event.type)
    ) {
      const object = z
        .object({
          id: z.string(),
          charge: z.union([z.string(), z.object({ id: z.string() })]).optional(),
        })
        .parse(event.object);
      const chargeId =
        event.type === 'charge.refunded'
          ? object.id
          : typeof object.charge === 'string'
            ? object.charge
            : object.charge?.id;
      const charge = chargeId ? await external(() => api.retrieveCharge(chargeId)) : null;
      return completeEvent(event, objectId, () => {
        const o = charge?.payment_intent
          ? (sql
              .prepare('SELECT * FROM orders WHERE provider_payment_intent_id=?')
              .get(charge.payment_intent) as OrderRow | undefined)
          : undefined;
        sql
          .prepare(
            'INSERT INTO billing_risks(id,provider_event_id,kind,charge_id,payment_intent_id,order_id,workspace_id,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .run(
            randomUUID(),
            event.id,
            event.type,
            chargeId ?? null,
            charge?.payment_intent ?? null,
            o?.id ?? null,
            o?.workspace_id ?? null,
            charge?.amount_refunded ?? null,
            now(),
          );
        if (o) {
          if (event.type === 'charge.refunded' && charge) {
            sql
              .prepare(
                'UPDATE orders SET refunded_minor=MAX(refunded_minor,?),updated_at=? WHERE id=?',
              )
              .run(Math.min(charge.amount_refunded, o.amount_minor), now(), o.id);
            core.referrals.reversePurchase(o.id, charge.amount_refunded, event.id);
            const requests = sql
              .prepare(
                'SELECT invoice_id FROM invoice_orders WHERE order_id=? AND released_at IS NULL',
              )
              .all(o.id) as { invoice_id: string }[];
            for (const request of requests) {
              sql
                .prepare(
                  "UPDATE invoice_requests SET status='review-required',updated_at=? WHERE id=? AND status IN ('draft','pending')",
                )
                .run(now(), request.invoice_id);
              sql
                .prepare('INSERT INTO invoice_events VALUES(?,?,?,?,?,?)')
                .run(
                  randomUUID(),
                  request.invoice_id,
                  null,
                  'refund-review',
                  JSON.stringify({ orderId: o.id, refundedMinor: charge.amount_refunded }),
                  now(),
                );
            }
          }
          sql
            .prepare('UPDATE workspace_billing SET payment_review_required=1 WHERE workspace_id=?')
            .run(o.workspace_id);
          if (charge?.refunded)
            sql
              .prepare("UPDATE orders SET status='refunded',updated_at=? WHERE id=?")
              .run(now(), o.id);
          core.context.audit(
            {
              userId: o.created_by,
              authType: 'session',
              apiKeyId: null,
              workspaceId: null,
              scopes: [],
            },
            o.workspace_id,
            'billing.review-required',
            'order',
            o.id,
            { event: event.type, eventId: event.id },
          );
        }
      });
    }
    return completeEvent(event, objectId, () => {});
  }
  const adapter: BillingAdapter = {
    isConfigured: () => configured,
    canCheckoutPlan,
    checkout,
    cancelSubscription,
    invoiceDocument,
  };
  return { ...adapter, handleWebhook };
}
export type BillingService = ReturnType<typeof createBillingService>;

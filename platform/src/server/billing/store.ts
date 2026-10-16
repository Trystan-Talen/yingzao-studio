import { createRefundEvidence } from './refund-evidence';
import { createPrepaidMemberships } from './prepaid';
import { bindPaymentEnvironment } from './environment';
import { prepaidTermsSchema, promotionSnapshotSchema } from '../../contracts/promotions';
import { createBillingPeriods } from './periods';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseContext } from '../db/connection';
import type { CoreServices } from '../core';
import type { CreditService } from '../tasks/credits';
import { AppError } from '../errors';
import { now } from '../tasks/types';
import { addUtcMonths } from '../tasks/credit-lots';
import { PlanLimitsSchema } from '../../contracts/entitlements';
import type { Subscription } from './stripe-gateway';
import { billingChannelSchema, type BillingChannel } from '../../contracts/billing-channel';
export const planSnapshotSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(['credits', 'subscription']),
  price_minor: z.number().int().positive().max(99_999_999),
  currency: z.string().regex(/^[a-zA-Z]{3}$/),
  credits: z.number().int().min(0).max(1_000_000_000),
  interval: z.enum(['month', 'year']).nullable(),
  limits_json: z.string().default('{}'),
  catalog_mode: z.enum(['unapproved', 'demo', 'official']).default('unapproved'),
  approved_at: z.string().nullable().optional(),
  prepaid_terms_json: z.string().nullable().optional(),
  promotion_snapshot: promotionSnapshotSchema.nullable().optional(),
});
export type PlanSnapshot = z.infer<typeof planSnapshotSchema>;
export interface OrderRow {
  billing_channel?: BillingChannel;
  provider_id: string | null;
  id: string;
  workspace_id: string;
  number: string;
  kind: string;
  status: string;
  amount_minor: number;
  currency: string;
  plan_id: string;
  plan_snapshot_json: string;
  created_by: string;
  provider_session_id: string | null;
  provider_invoice_id: string | null;
  provider_payment_intent_id: string | null;
  payment_environment: 'unbound' | 'test' | 'live';
  refunded_minor: number;
}
export const orderChannel = (order: OrderRow): BillingChannel =>
  billingChannelSchema.parse(order.billing_channel ?? 'web');
export function matchesBillingChannel(metadata: Record<string, string>, order: OrderRow) {
  return metadata.billing_channel === undefined || metadata.billing_channel === orderChannel(order);
}
export const iso = (value: number) => new Date(value * 1000).toISOString();
export function createBillingStore(
  db: DatabaseContext,
  core: CoreServices,
  credits: CreditService,
) {
  const sql = db.sqlite;
  const periods = createBillingPeriods(db);
  const prepaid = createPrepaidMemberships(db);
  const refundEvidence = createRefundEvidence(db);
  const atomic = <T>(fn: () => T): T =>
    sql.inTransaction ? fn() : sql.transaction(fn).immediate();
  function order(id: string): OrderRow {
    const value = sql.prepare('SELECT * FROM orders WHERE id=?').get(id) as OrderRow | undefined;
    if (!value) throw new AppError(404, 'ORDER_NOT_FOUND', '支付订单不存在');
    return value;
  }
  function plan(o: OrderRow): PlanSnapshot {
    const value = planSnapshotSchema.safeParse(JSON.parse(o.plan_snapshot_json));
    if (
      !value.success ||
      value.data.id !== o.plan_id ||
      value.data.kind !== o.kind ||
      (value.data.kind === 'subscription' && !value.data.interval) ||
      value.data.price_minor !== o.amount_minor ||
      value.data.currency.toLowerCase() !== o.currency.toLowerCase()
    )
      throw new AppError(409, 'PLAN_SNAPSHOT_INVALID', '套餐价格快照无效，请重新创建订单');
    const limits = PlanLimitsSchema.safeParse(JSON.parse(value.data.limits_json));
    if (!limits.success) throw new AppError(409, 'PLAN_LIMITS_INVALID', '套餐权限配置无效');
    if (value.data.prepaid_terms_json)
      prepaidTermsSchema.parse(JSON.parse(value.data.prepaid_terms_json));
    if (
      value.data.promotion_snapshot &&
      value.data.promotion_snapshot.definition.priceMinor !== o.amount_minor
    )
      throw new AppError(409, 'PROMOTION_SNAPSHOT_INVALID', '活动价格与订单不一致');
    if (orderChannel(o) === 'api' && value.data.kind !== 'credits')
      throw new AppError(409, 'API_SUBSCRIPTION_UNSUPPORTED', '接口账户仅支持充值额度包');
    return value.data;
  }
  function grant(
    o: OrderRow,
    eventKey: string,
    amount: number,
    validity: { paidAt: string; expiresAt?: string },
  ) {
    if (!sql.inTransaction) throw new Error('Billing grant requires transaction');
    if (o.payment_environment === 'unbound')
      throw new AppError(409, 'PAYMENT_ENVIRONMENT_MISMATCH', '付款环境未核验，不能发放额度或会员');
    bindPaymentEnvironment(db, o.payment_environment);
    const existing = sql
      .prepare('SELECT * FROM billing_fulfillments WHERE event_key=?')
      .get(eventKey) as
      | {
          workspace_id: string;
          order_id: string;
          credits: number;
          billing_channel?: BillingChannel;
        }
      | undefined;
    if (existing) {
      if (
        existing.workspace_id !== o.workspace_id ||
        existing.order_id !== o.id ||
        existing.credits !== amount ||
        (existing.billing_channel ?? 'web') !== orderChannel(o)
      )
        throw new AppError(409, 'BILLING_CONFLICT', '支付入账记录不一致');
      return;
    }
    const source = o.kind === 'subscription' ? 'subscription' : 'pack';
    const savedPlan = plan(o),
      terms = savedPlan.prepaid_terms_json
        ? prepaidTermsSchema.parse(JSON.parse(savedPlan.prepaid_terms_json))
        : null;
    const expiresAt = terms
      ? prepaid.prepare(o.id, validity.paidAt, terms).creditExpiresAt
      : source === 'subscription'
        ? validity.expiresAt
        : addUtcMonths(validity.paidAt, 12);
    if (!expiresAt)
      throw new AppError(409, 'SUBSCRIPTION_PERIOD_MISSING', '会员入账必须有已核验的订阅有效期');
    const accountCredits = credits.forChannel(orderChannel(o));
    if (!terms)
      accountCredits.renewSource(o.workspace_id, o.created_by, source, expiresAt, eventKey);
    const granted = accountCredits.grant({
      workspaceId: o.workspace_id,
      userId: o.created_by,
      eventKey: `payment:${eventKey}`,
      amount,
      source,
      sourceId: o.id,
      expiresAt,
      archiveMonths: terms ? terms.creditArchiveMonths : source === 'subscription' ? 3 : 0,
      description: 'Stripe 已验证支付入账',
    });
    if (terms) prepaid.bindLot(o.id, granted.lotId ?? null);
    sql
      .prepare(
        'INSERT INTO billing_fulfillments(event_key,workspace_id,order_id,credits,created_at,billing_channel) VALUES(?,?,?,?,?,?)',
      )
      .run(eventKey, o.workspace_id, o.id, amount, now(), orderChannel(o));
    sql
      .prepare(
        "UPDATE orders SET status='paid',paid_at=COALESCE(paid_at,?),provider_id='stripe',updated_at=? WHERE id=?",
      )
      .run(validity.paidAt, now(), o.id);
    if (orderChannel(o) === 'web') core.referrals.qualifyPurchase(o.id);
    core.context.audit(
      { userId: o.created_by, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
      o.workspace_id,
      'billing.credit-grant',
      'order',
      o.id,
      { credits: amount, eventKey, billingChannel: orderChannel(o) },
    );
  }
  function validateSubscription(sub: Subscription, o: OrderRow) {
    const p = plan(o),
      item = sub.items.data[0];
    if (
      p.kind !== 'subscription' ||
      orderChannel(o) !== 'web' ||
      !matchesBillingChannel(sub.metadata, o) ||
      sub.metadata.order_id !== o.id ||
      sub.metadata.workspace_id !== o.workspace_id ||
      sub.items.data.length !== 1 ||
      !item ||
      item.quantity !== 1 ||
      item.price.unit_amount !== p.price_minor ||
      item.price.currency.toLowerCase() !== p.currency.toLowerCase() ||
      item.price.recurring?.interval !== p.interval
    )
      throw new AppError(409, 'SUBSCRIPTION_MISMATCH', '订阅与订单快照不匹配');
  }
  function syncSubscription(sub: Subscription, o: OrderRow) {
    validateSubscription(sub, o);
    if (sub.status === 'canceled')
      periods.recordEnding({
        subscriptionId: sub.id,
        endedAt: sub.ended_at ? iso(sub.ended_at) : null,
      });
    const item = sub.items.data[0]!;
    sql
      .prepare(
        `INSERT INTO subscriptions(id,workspace_id,plan_id,status,current_period_start,current_period_end,cancel_at_period_end,provider_id,created_at,updated_at,provider_subscription_id,source_order_id) VALUES(?,?,?,?,?,?,?,'stripe',?,?,?,?) ON CONFLICT(provider_subscription_id) WHERE provider_subscription_id IS NOT NULL DO UPDATE SET status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=excluded.updated_at`,
      )
      .run(
        randomUUID(),
        o.workspace_id,
        o.plan_id,
        sub.status,
        iso(item.current_period_start),
        iso(item.current_period_end),
        sub.cancel_at_period_end ? 1 : 0,
        now(),
        now(),
        sub.id,
        o.id,
      );
    const active = sql
      .prepare(
        "SELECT o.plan_snapshot_json FROM subscriptions s JOIN orders o ON o.id=s.source_order_id WHERE s.workspace_id=? AND s.status='active' AND s.current_period_end>?",
      )
      .all(o.workspace_id, now()) as { plan_snapshot_json: string }[];
    let concurrency = 2;
    for (const value of active) {
      const p = planSnapshotSchema.parse(JSON.parse(value.plan_snapshot_json));
      const limits = z
        .object({ concurrency: z.number().int().min(1).max(100).optional() })
        .parse(JSON.parse(p.limits_json));
      concurrency = Math.max(concurrency, limits.concurrency ?? 2);
    }
    sql
      .prepare('UPDATE workspace_billing SET concurrency_limit=? WHERE workspace_id=?')
      .run(concurrency, o.workspace_id);
  }
  function linkRisk(o: OrderRow) {
    if (!o.provider_payment_intent_id) return;
    refundEvidence.link(o.id, o.provider_payment_intent_id);
    sql
      .prepare(
        'UPDATE billing_risks SET order_id=?,workspace_id=?,billing_channel=? WHERE payment_intent_id=? AND order_id IS NULL',
      )
      .run(o.id, o.workspace_id, orderChannel(o), o.provider_payment_intent_id);
    const refunded = sql
      .prepare(
        "SELECT COALESCE(MAX(amount_minor),0) amount FROM billing_risks WHERE order_id=? AND kind='charge.refunded'",
      )
      .get(o.id) as { amount: number };
    if (refunded.amount) {
      sql
        .prepare('UPDATE orders SET refunded_minor=MAX(refunded_minor,?) WHERE id=?')
        .run(Math.min(refunded.amount, o.amount_minor), o.id);
      if (orderChannel(o) === 'web')
        core.referrals.reversePurchase(o.id, refunded.amount, `linked:${o.id}:${refunded.amount}`);
      if (orderChannel(o) === 'web') prepaid.refund(o.id, `linked:${o.id}:${refunded.amount}`);
    }
    if (
      sql
        .prepare(
          "SELECT 1 FROM billing_risks WHERE order_id=? AND kind='charge.refunded' AND amount_minor>=?",
        )
        .get(o.id, o.amount_minor)
    )
      sql.prepare("UPDATE orders SET status='refunded',updated_at=? WHERE id=?").run(now(), o.id);
    if (
      sql
        .prepare(
          "SELECT 1 FROM billing_risks WHERE workspace_id=? AND billing_channel=? AND status='review_required'",
        )
        .get(o.workspace_id, orderChannel(o))
    )
      hold(o.workspace_id, orderChannel(o), true);
  }
  function hold(wid: string, channel: BillingChannel, required: boolean) {
    sql
      .prepare(
        'UPDATE credit_accounts SET payment_review_required=? WHERE workspace_id=? AND billing_channel=?',
      )
      .run(required ? 1 : 0, wid, channel);
    if (channel === 'web')
      sql
        .prepare('UPDATE workspace_billing SET payment_review_required=? WHERE workspace_id=?')
        .run(required ? 1 : 0, wid);
  }
  return {
    sql,
    atomic,
    order,
    plan,
    grant,
    validateSubscription,
    syncSubscription,
    linkRisk,
    hold,
  };
}
export type BillingStore = ReturnType<typeof createBillingStore>;

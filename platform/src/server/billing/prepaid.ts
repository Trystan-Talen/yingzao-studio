import { randomUUID, createHash } from 'node:crypto';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { prepaidTermsSchema, type PrepaidTerms } from '../../contracts/promotions';
import { prepaidCreditExpiry, prepaidTimeline, type PrepaidPurchase } from './prepaid-timeline';
import { createCreditService } from '../tasks/credits';
import { referralRefundTarget } from '../../contracts/referrals';
import { now } from '../tasks/types';
interface PurchaseRow {
  order_id: string;
  workspace_id: string;
  user_id: string;
  plan_id: string;
  paid_at: string;
  terms_json: string;
  amount_minor: number;
  refunded_minor: number;
  credit_lot_id: string | null;
  reversed_credits: number;
  debt_credits: number;
}
export function createPrepaidMemberships(db: DatabaseContext) {
  const sql = db.sqlite,
    credits = createCreditService(db);
  const requireTransaction = () => {
    if (!sql.inTransaction) throw new Error('Prepaid membership mutation requires transaction');
  };
  const read = (wid: string, planId: string) =>
    sql
      .prepare(
        'SELECT * FROM prepaid_membership_purchases WHERE workspace_id=? AND plan_id=? ORDER BY paid_at,order_id',
      )
      .all(wid, planId) as PurchaseRow[];
  const input = (r: PurchaseRow): PrepaidPurchase => ({
    orderId: r.order_id,
    paidAt: r.paid_at,
    amountMinor: r.amount_minor,
    refundedMinor: r.refunded_minor,
    terms: prepaidTermsSchema.parse(JSON.parse(r.terms_json)),
  });
  function assertCheckout(wid: string, planId: string, terms: PrepaidTerms) {
    const w = sql.prepare('SELECT kind FROM workspaces WHERE id=?').get(wid) as
      { kind: string } | undefined;
    if (w?.kind !== terms.audience)
      throw new AppError(409, 'PREPAID_AUDIENCE', '此固定期会员不适用于当前空间类型');
    if (
      sql
        .prepare(
          "SELECT 1 FROM subscriptions WHERE workspace_id=? AND status IN('active','trialing','incomplete','past_due','unpaid') AND (current_period_end IS NULL OR current_period_end>?) AND (provider_id<>'stripe-prepaid' OR plan_id<>?) LIMIT 1",
        )
        .get(wid, now(), planId)
    )
      throw new AppError(
        409,
        'PREPAID_DIFFERENT_PLAN',
        '当前空间已有其他档位或自动续费会员，跨档叠加规则尚未配置，请先核对',
      );
    if (
      sql
        .prepare(
          "SELECT 1 FROM orders o JOIN stripe_checkouts c ON c.order_id=o.id WHERE o.workspace_id=? AND o.kind='subscription' AND o.status='pending' AND (o.plan_id<>? OR json_extract(o.plan_snapshot_json,'$.prepaid_terms_json') IS NULL) LIMIT 1",
        )
        .get(wid, planId)
    )
      throw new AppError(
        409,
        'PREPAID_DIFFERENT_PLAN',
        '当前空间有其他档位会员支付待核对，请先处理原订单',
      );
  }
  function sync(wid: string, planId: string) {
    const rows = read(wid, planId),
      timeline = prepaidTimeline(rows.map(input)),
      revision = createHash('sha256')
        .update(JSON.stringify(rows.map(input)))
        .digest('hex');
    for (const p of timeline) {
      const old = sql
        .prepare(
          "SELECT id FROM subscriptions WHERE source_order_id=? AND provider_id='stripe-prepaid'",
        )
        .get(p.orderId) as { id: string } | undefined;
      if (old)
        sql
          .prepare(
            'UPDATE subscriptions SET current_period_start=?,current_period_end=?,status=?,updated_at=? WHERE id=?',
          )
          .run(p.paidAt, p.periodEnd, p.active ? 'active' : 'canceled', now(), old.id);
      else
        sql
          .prepare(
            "INSERT INTO subscriptions(id,workspace_id,plan_id,status,current_period_start,current_period_end,cancel_at_period_end,provider_id,created_at,updated_at,source_order_id) VALUES(?,?,?,?,?,?,1,'stripe-prepaid',?,?,?)",
          )
          .run(
            randomUUID(),
            wid,
            planId,
            p.active ? 'active' : 'canceled',
            p.paidAt,
            p.periodEnd,
            now(),
            now(),
            p.orderId,
          );
      const row = rows.find((r) => r.order_id === p.orderId)!;
      // Calendar recomputation can shorten or extend a later purchase after a refund or late callback.
      if (row.credit_lot_id) {
        credits.reconcilePrepaidValidity({
          workspaceId: wid,
          userId: row.user_id,
          lotId: row.credit_lot_id,
          orderId: row.order_id,
          active: p.active,
          expiresAt: prepaidCreditExpiry(rows.map(input), p.orderId),
          eventKey: `prepaid-period:${row.order_id}:${revision}`,
        });
      }
    }
    const active = sql
      .prepare(
        "SELECT o.plan_snapshot_json FROM subscriptions s JOIN orders o ON o.id=s.source_order_id WHERE s.workspace_id=? AND s.status='active' AND s.current_period_start<=? AND s.current_period_end>?",
      )
      .all(wid, now(), now()) as { plan_snapshot_json: string }[];
    const concurrency = Math.max(
      2,
      ...active.map((r) =>
        Number(JSON.parse(JSON.parse(r.plan_snapshot_json).limits_json ?? '{}').concurrency ?? 2),
      ),
    );
    sql
      .prepare('UPDATE workspace_billing SET concurrency_limit=? WHERE workspace_id=?')
      .run(concurrency, wid);
    return timeline;
  }
  function prepare(orderId: string, paidAt: string, terms: PrepaidTerms) {
    requireTransaction();
    prepaidTermsSchema.parse(terms);
    const o = sql
      .prepare(
        'SELECT workspace_id,created_by,plan_id,amount_minor,kind,billing_channel FROM orders WHERE id=?',
      )
      .get(orderId) as {
      workspace_id: string;
      created_by: string;
      plan_id: string;
      amount_minor: number;
      kind: string;
      billing_channel: string;
    };
    if (!o || o.kind !== 'subscription' || o.billing_channel !== 'web')
      throw new AppError(409, 'PREPAID_ORDER', '固定期会员只能关联网页会员订单');
    const old = sql
      .prepare('SELECT * FROM prepaid_membership_purchases WHERE order_id=?')
      .get(orderId) as PurchaseRow | undefined;
    if (old) {
      if (
        old.paid_at !== paidAt ||
        old.terms_json !== JSON.stringify(terms) ||
        old.amount_minor !== o.amount_minor
      )
        throw new AppError(409, 'PREPAID_FACT_CONFLICT', '已保存的固定期付款事实冲突，需核对');
    } else
      sql
        .prepare(
          'INSERT INTO prepaid_membership_purchases(order_id,workspace_id,user_id,plan_id,paid_at,terms_json,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          orderId,
          o.workspace_id,
          o.created_by,
          o.plan_id,
          paidAt,
          JSON.stringify(terms),
          o.amount_minor,
          now(),
        );
    const period = sync(o.workspace_id, o.plan_id).find((p) => p.orderId === orderId)!;
    return {
      ...period,
      creditExpiresAt: prepaidCreditExpiry(read(o.workspace_id, o.plan_id).map(input), orderId),
    };
  }
  function bindLot(orderId: string, lotId: string | null) {
    requireTransaction();
    sql
      .prepare(
        'UPDATE prepaid_membership_purchases SET credit_lot_id=? WHERE order_id=? AND credit_lot_id IS NULL',
      )
      .run(lotId, orderId);
  }
  function refund(orderId: string, eventKey: string) {
    requireTransaction();
    const row = sql
      .prepare('SELECT * FROM prepaid_membership_purchases WHERE order_id=?')
      .get(orderId) as PurchaseRow | undefined;
    if (!row) return;
    const lists = sql
      .prepare('SELECT complete FROM billing_refund_collections WHERE order_id=?')
      .all(orderId) as { complete: number }[];
    if (!lists.length || lists.some((l) => !l.complete)) return { reviewRequired: true };
    const total = (
      sql
        .prepare(
          "SELECT COALESCE(SUM(amount_minor),0) total FROM billing_refund_facts WHERE order_id=? AND status='succeeded' AND first_succeeded_observed_at IS NOT NULL",
        )
        .get(orderId) as { total: number }
    ).total;
    const target = Math.min(row.amount_minor, total);
    if (target < row.refunded_minor)
      throw new AppError(409, 'PREPAID_REFUND_CONFLICT', '累计退款不能回退');
    if (target === row.refunded_minor) return { reviewRequired: row.debt_credits > 0 };
    let debt = 0,
      reversed = row.reversed_credits;
    if (row.credit_lot_id) {
      const lot = sql
        .prepare('SELECT granted FROM credit_lots WHERE id=?')
        .get(row.credit_lot_id) as { granted: number };
      reversed = referralRefundTarget(lot.granted, target, row.amount_minor);
      debt = credits.revokePrepaid({
        workspaceId: row.workspace_id,
        userId: row.user_id,
        orderId,
        lotId: row.credit_lot_id,
        targetReversed: reversed,
        eventKey: `prepaid-refund:${orderId}:${target}`,
        description: '按已核验退款撤回本次固定期会员来源，保留其他购买',
      }).debt;
    }
    sql
      .prepare(
        'UPDATE prepaid_membership_purchases SET refunded_minor=?,reversed_credits=?,debt_credits=debt_credits+? WHERE order_id=?',
      )
      .run(target, reversed, debt, orderId);
    sync(row.workspace_id, row.plan_id);
    if (debt) {
      sql
        .prepare(
          "INSERT OR IGNORE INTO billing_risks(id,provider_event_id,kind,order_id,workspace_id,amount_minor,created_at,billing_channel) VALUES(?,?,'prepaid-reversal-debt',?,?,0,?,'web')",
        )
        .run(randomUUID(), `prepaid:${eventKey}:${orderId}`, orderId, row.workspace_id, now());
      sql
        .prepare(
          "UPDATE credit_accounts SET payment_review_required=1 WHERE workspace_id=? AND billing_channel='web'",
        )
        .run(row.workspace_id);
      sql
        .prepare('UPDATE workspace_billing SET payment_review_required=1 WHERE workspace_id=?')
        .run(row.workspace_id);
    }
    return { reviewRequired: debt > 0 };
  }
  function activeAt(userId: string, at: string): 'active' | 'inactive' | 'unknown' {
    const rows = sql
      .prepare(
        "SELECT p.*,o.refunded_minor AS observed_refund FROM prepaid_membership_purchases p JOIN orders o ON o.id=p.order_id JOIN workspaces w ON w.id=p.workspace_id WHERE p.user_id=? AND p.paid_at<=? AND w.kind='personal' AND w.is_demo=0 AND o.payment_environment='live'",
      )
      .all(userId, at) as (PurchaseRow & { observed_refund: number })[];
    const groups = new Map<string, { minimum: PrepaidPurchase[]; maximum: PrepaidPurchase[] }>();
    for (const row of rows) {
      let minimum = 0,
        maximum = 0;
      if (row.observed_refund) {
        const lists = sql
          .prepare('SELECT complete FROM billing_refund_collections WHERE order_id=?')
          .all(row.order_id) as { complete: number }[];
        if (!lists.length || lists.some((l) => !l.complete)) maximum = row.amount_minor;
        else {
          const facts = sql
            .prepare(
              'SELECT amount_minor,refund_created_at,status,first_succeeded_observed_at FROM billing_refund_facts WHERE order_id=?',
            )
            .all(row.order_id) as {
            amount_minor: number;
            refund_created_at: string;
            status: string;
            first_succeeded_observed_at: string | null;
          }[];
          for (const f of facts) {
            if (!['failed', 'canceled'].includes(f.status) && f.refund_created_at <= at)
              maximum += f.amount_minor;
            if (
              f.status === 'succeeded' &&
              f.first_succeeded_observed_at &&
              f.first_succeeded_observed_at <= at
            )
              minimum += f.amount_minor;
          }
        }
      }
      const key = `${row.workspace_id}:${row.plan_id}`,
        group = groups.get(key) ?? { minimum: [], maximum: [] };
      group.minimum.push({ ...input(row), refundedMinor: minimum });
      group.maximum.push({ ...input(row), refundedMinor: maximum });
      groups.set(key, group);
    }
    let unknown = false;
    const active = (p: PrepaidPurchase[]) =>
      prepaidTimeline(p).some((t) => t.active && t.paidAt <= at && t.periodEnd > at);
    for (const g of groups.values()) {
      if (active(g.maximum)) return 'active';
      if (active(g.minimum)) unknown = true;
    }
    return unknown ? 'unknown' : 'inactive';
  }
  return { assertCheckout, prepare, bindLot, refund, activeAt };
}

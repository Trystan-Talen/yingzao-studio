/** Refund.created is a lower time bound, never a fabricated success timestamp.
 * https://docs.stripe.com/api/refunds/list
 * https://docs.stripe.com/api/refunds/object
 */
import type { DatabaseContext } from '../db/connection';
import type { Charge } from './stripe-gateway';
import { AppError } from '../errors';
import { now } from '../tasks/types';
export function createRefundEvidence(db: DatabaseContext, clock: () => string = now) {
  const sql = db.sqlite;
  function record(charge: Charge, orderId?: string) {
    if (!sql.inTransaction) throw new Error('Refund evidence requires transaction');
    const time = clock(),
      order = orderId
        ? (sql
            .prepare('SELECT currency,provider_payment_intent_id FROM orders WHERE id=?')
            .get(orderId) as
            { currency: string; provider_payment_intent_id: string | null } | undefined)
        : undefined;
    if (orderId && (!order || order.provider_payment_intent_id !== charge.payment_intent))
      throw new AppError(409, 'REFUND_EVIDENCE_CONFLICT', '退款记录与订单付款来源不一致');
    let complete = !!charge.refunds && !charge.refunds.has_more;
    const seen = new Set<string>();
    for (const refund of charge.refunds?.data ?? []) {
      if (
        seen.has(refund.id) ||
        refund.charge !== charge.id ||
        refund.payment_intent !== charge.payment_intent ||
        !refund.status ||
        ((order?.currency ?? charge.currency)?.toLowerCase() !== undefined &&
          refund.currency.toLowerCase() !== (order?.currency ?? charge.currency)!.toLowerCase())
      ) {
        complete = false;
        continue;
      }
      seen.add(refund.id);
      const created = new Date(refund.created * 1000);
      if (!Number.isFinite(created.getTime())) {
        complete = false;
        continue;
      }
      const old = sql
        .prepare("SELECT * FROM billing_refund_facts WHERE provider_id='stripe' AND refund_id=?")
        .get(refund.id) as
        | {
            charge_id: string;
            payment_intent_id: string | null;
            order_id: string | null;
            amount_minor: number;
            currency: string;
            refund_created_at: string;
            first_succeeded_observed_at: string | null;
          }
        | undefined;
      if (
        old &&
        (old.charge_id !== charge.id ||
          old.payment_intent_id !== charge.payment_intent ||
          (orderId && old.order_id && old.order_id !== orderId) ||
          old.amount_minor !== refund.amount ||
          old.currency !== refund.currency.toUpperCase() ||
          old.refund_created_at !== created.toISOString())
      ) {
        complete = false;
        continue;
      }
      if (old?.first_succeeded_observed_at && refund.status !== 'succeeded') complete = false;
      sql
        .prepare(
          "INSERT INTO billing_refund_facts VALUES('stripe',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider_id,refund_id) DO UPDATE SET order_id=COALESCE(billing_refund_facts.order_id,excluded.order_id),status=excluded.status,first_succeeded_observed_at=COALESCE(billing_refund_facts.first_succeeded_observed_at,excluded.first_succeeded_observed_at),observed_at=excluded.observed_at",
        )
        .run(
          refund.id,
          charge.id,
          charge.payment_intent,
          orderId ?? null,
          refund.amount,
          refund.currency.toUpperCase(),
          created.toISOString(),
          refund.status,
          refund.status === 'succeeded' ? time : null,
          time,
        );
    }
    const listedTotal = (charge.refunds?.data ?? [])
      .filter((refund) => refund.status !== 'failed' && refund.status !== 'canceled')
      .reduce((sum, refund) => sum + refund.amount, 0);
    if (!Number.isSafeInteger(listedTotal) || listedTotal !== charge.amount_refunded)
      complete = false;
    const previous = sql
      .prepare(
        "SELECT order_id,payment_intent_id FROM billing_refund_collections WHERE provider_id='stripe' AND charge_id=?",
      )
      .get(charge.id) as { order_id: string | null; payment_intent_id: string | null } | undefined;
    if (
      previous &&
      (previous.payment_intent_id !== charge.payment_intent ||
        (previous.order_id && orderId && previous.order_id !== orderId))
    )
      throw new AppError(409, 'REFUND_EVIDENCE_CONFLICT', '退款列表归属冲突');
    sql
      .prepare(
        "INSERT INTO billing_refund_collections VALUES('stripe',?,?,?,?,?) ON CONFLICT(provider_id,charge_id) DO UPDATE SET order_id=COALESCE(billing_refund_collections.order_id,excluded.order_id),complete=excluded.complete,observed_at=excluded.observed_at",
      )
      .run(charge.id, charge.payment_intent, orderId ?? null, complete ? 1 : 0, time);
  }
  function link(orderId: string, paymentIntentId: string) {
    if (!sql.inTransaction) throw new Error('Refund evidence linkage requires transaction');
    for (const table of ['billing_refund_facts', 'billing_refund_collections'])
      sql
        .prepare(`UPDATE ${table} SET order_id=? WHERE payment_intent_id=? AND order_id IS NULL`)
        .run(orderId, paymentIntentId);
  }
  function at(orderId: string, at: string, total: number): 'active' | 'inactive' | 'unknown' {
    const lists = sql
      .prepare('SELECT complete FROM billing_refund_collections WHERE order_id=?')
      .all(orderId) as { complete: number }[];
    if (!lists.length || lists.some((list) => !list.complete)) return 'unknown';
    const refunds = sql
      .prepare(
        'SELECT amount_minor,refund_created_at,status,first_succeeded_observed_at FROM billing_refund_facts WHERE order_id=?',
      )
      .all(orderId) as {
      amount_minor: number;
      refund_created_at: string;
      status: string;
      first_succeeded_observed_at: string | null;
    }[];
    const possible = refunds
      .filter(
        (refund) =>
          refund.refund_created_at <= at && !['failed', 'canceled'].includes(refund.status),
      )
      .reduce((sum, refund) => sum + refund.amount_minor, 0);
    const confirmed = refunds
      .filter(
        (refund) =>
          refund.status === 'succeeded' &&
          refund.first_succeeded_observed_at &&
          refund.first_succeeded_observed_at <= at,
      )
      .reduce((sum, refund) => sum + refund.amount_minor, 0);
    if (confirmed >= total) return 'inactive';
    if (possible < total) return 'active';
    return 'unknown';
  }
  return { record, link, at };
}

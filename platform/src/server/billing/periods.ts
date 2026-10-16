import { createRefundEvidence } from './refund-evidence';
import { createPrepaidMemberships } from './prepaid';
/** Immutable invoice facts, separate from the subscription's current status.
 * https://docs.stripe.com/api/invoices/object
 * https://docs.stripe.com/api/invoice-line-item/object
 */
import { z } from 'zod';
import type { DatabaseContext } from '../db/connection';
import type { Invoice } from './stripe-gateway';
import { AppError } from '../errors';
import { now } from '../tasks/types';
const date = z.iso.datetime().transform((value) => new Date(value).toISOString());
const periodInput = z
  .object({
    orderId: z.string().uuid(),
    invoiceId: z.string().min(1).max(255),
    subscriptionId: z.string().min(1).max(255),
    paidAt: date,
    periodStart: date,
    periodEnd: date,
  })
  .strict()
  .refine((v) => v.periodEnd > v.periodStart, { message: '账单服务周期无效' });
export function verifiedInvoicePeriod(invoice: Invoice) {
  const paid = invoice.status_transitions?.paid_at,
    period = invoice.lines.data[0]?.period;
  if (
    invoice.status !== 'paid' ||
    !paid ||
    !period ||
    !Number.isSafeInteger(paid) ||
    paid <= 0 ||
    period.end <= period.start ||
    invoice.lines.data.length !== 1 ||
    invoice.lines.has_more
  )
    throw new AppError(
      409,
      'INVOICE_PERIOD_EVIDENCE_MISSING',
      '账单缺少已核验付款时间或完整服务周期，须人工核对',
    );
  const iso = (value: number) => {
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime()))
      throw new AppError(409, 'INVOICE_PERIOD_EVIDENCE_MISSING', '账单时间无效，须人工核对');
    return date.toISOString();
  };
  return { paidAt: iso(paid), periodStart: iso(period.start), periodEnd: iso(period.end) };
}
export function createBillingPeriods(db: DatabaseContext) {
  const sql = db.sqlite;
  const refundEvidence = createRefundEvidence(db);
  const prepaidMemberships = createPrepaidMemberships(db);
  function record(raw: z.input<typeof periodInput>) {
    if (!sql.inTransaction) throw new Error('Billing period evidence requires transaction');
    const input = periodInput.parse(raw),
      order = sql
        .prepare('SELECT workspace_id,created_by,kind,billing_channel FROM orders WHERE id=?')
        .get(input.orderId) as
        | { workspace_id: string; created_by: string; kind: string; billing_channel: string }
        | undefined;
    if (!order || order.kind !== 'subscription' || order.billing_channel !== 'web')
      throw new AppError(409, 'BILLING_PERIOD_ORDER_MISMATCH', '服务周期只能关联网页订阅订单');
    const previous = sql
      .prepare(
        "SELECT * FROM billing_periods WHERE provider_id='stripe' AND (invoice_id=? OR order_id=?)",
      )
      .get(input.invoiceId, input.orderId) as
      | {
          invoice_id: string;
          subscription_id: string;
          order_id: string;
          workspace_id: string;
          user_id: string;
          period_start: string;
          period_end: string;
          paid_at: string;
        }
      | undefined;
    if (previous) {
      if (
        previous.invoice_id !== input.invoiceId ||
        previous.subscription_id !== input.subscriptionId ||
        previous.order_id !== input.orderId ||
        previous.workspace_id !== order.workspace_id ||
        previous.user_id !== order.created_by ||
        previous.period_start !== input.periodStart ||
        previous.period_end !== input.periodEnd ||
        previous.paid_at !== input.paidAt
      )
        throw new AppError(
          409,
          'BILLING_PERIOD_CONFLICT',
          '已核验账单周期或付款时间冲突，不能覆盖历史事实',
        );
      return;
    }
    sql
      .prepare("INSERT INTO billing_periods VALUES('stripe',?,?,?,?,?,?,?,?,?)")
      .run(
        input.invoiceId,
        input.subscriptionId,
        input.orderId,
        order.workspace_id,
        order.created_by,
        input.periodStart,
        input.periodEnd,
        input.paidAt,
        now(),
      );
  }
  function recordEnding(input: { subscriptionId: string; endedAt: string | null }) {
    if (!sql.inTransaction) throw new Error('Subscription ending evidence requires transaction');
    const endedAt = input.endedAt === null ? null : date.parse(input.endedAt);
    const old = sql
      .prepare(
        "SELECT ended_at FROM billing_subscription_endings WHERE provider_id='stripe' AND subscription_id=?",
      )
      .get(input.subscriptionId) as { ended_at: string | null } | undefined;
    if (old?.ended_at && endedAt && old.ended_at !== endedAt)
      throw new AppError(409, 'BILLING_PERIOD_CONFLICT', '订阅终止时间证据冲突，须人工核对');
    sql
      .prepare(
        "INSERT INTO billing_subscription_endings VALUES('stripe',?,?,?) ON CONFLICT(provider_id,subscription_id) DO UPDATE SET ended_at=COALESCE(billing_subscription_endings.ended_at,excluded.ended_at),observed_at=excluded.observed_at",
      )
      .run(input.subscriptionId, endedAt, now());
  }
  function activeAt(userId: string, paidAt: string): 'active' | 'inactive' | 'unknown' {
    const at = date.parse(paidAt);
    const prepaid = prepaidMemberships.activeAt(userId, at);
    if (prepaid === 'active') return 'active';
    const rows = sql
      .prepare(
        "SELECT p.*,e.subscription_id ending_id,e.ended_at,o.status,o.amount_minor FROM billing_periods p JOIN orders o ON o.id=p.order_id JOIN workspaces w ON w.id=p.workspace_id LEFT JOIN billing_subscription_endings e ON e.provider_id=p.provider_id AND e.subscription_id=p.subscription_id WHERE p.user_id=? AND w.kind='personal' AND w.is_demo=0 AND o.payment_environment='live' AND o.billing_channel='web' AND p.paid_at<=? AND p.period_start<=? AND p.period_end>?",
      )
      .all(userId, at, at, at) as {
      order_id: string;
      ending_id: string | null;
      ended_at: string | null;
      status: string;
      amount_minor: number;
    }[];
    let unknown = prepaid === 'unknown';
    for (const row of rows) {
      if (row.ending_id && !row.ended_at) {
        unknown = true;
        continue;
      }
      if (row.ended_at && row.ended_at <= at) continue;
      const fullRefund =
        row.status === 'refunded' ||
        !!sql
          .prepare(
            "SELECT 1 FROM billing_risks WHERE order_id=? AND kind='charge.refunded' AND amount_minor>=? LIMIT 1",
          )
          .get(row.order_id, row.amount_minor);
      if (fullRefund) {
        const status = refundEvidence.at(row.order_id, at, row.amount_minor);
        if (status === 'inactive') continue;
        if (status === 'unknown') {
          unknown = true;
          continue;
        }
      }
      return 'active';
    }
    const legacy = sql
      .prepare(
        "SELECT 1 FROM orders o JOIN workspaces w ON w.id=o.workspace_id WHERE o.created_by=? AND w.kind='personal' AND w.is_demo=0 AND o.kind='subscription' AND o.billing_channel='web' AND o.payment_environment='live' AND o.status IN('paid','refunded') AND o.paid_at<=? AND NOT EXISTS(SELECT 1 FROM billing_periods p WHERE p.order_id=o.id) AND NOT EXISTS(SELECT 1 FROM prepaid_membership_purchases p WHERE p.order_id=o.id) LIMIT 1",
      )
      .get(userId, at);
    return unknown || legacy ? 'unknown' : 'inactive';
  }
  return { record, recordEnding, activeAt };
}

import { prepaidTermsSchema, type PrepaidTerms } from '../../contracts/promotions';
import { addUtcMonths } from '../tasks/credit-lots';

export interface PrepaidPurchase {
  orderId: string;
  paidAt: string;
  amountMinor: number;
  refundedMinor: number;
  terms: PrepaidTerms;
}
/** Derive periods from payment facts, not callback arrival order. No other purchase's contribution is removed. */
export function prepaidTimeline(purchases: PrepaidPurchase[]) {
  let end = '';
  return [...purchases]
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.orderId.localeCompare(b.orderId))
    .map((p) => {
      const terms = prepaidTermsSchema.parse(p.terms);
      if (
        !Number.isSafeInteger(p.amountMinor) ||
        p.amountMinor <= 0 ||
        !Number.isSafeInteger(p.refundedMinor) ||
        p.refundedMinor < 0
      )
        throw new Error('Invalid prepaid refund basis');
      const start = end > p.paidAt ? end : p.paidAt;
      const fullEnd = addUtcMonths(start, terms.months);
      const duration = BigInt(Date.parse(fullEnd) - Date.parse(start));
      const remaining = Math.max(0, p.amountMinor - p.refundedMinor);
      const next = new Date(
        Date.parse(start) + Number((duration * BigInt(remaining)) / BigInt(p.amountMinor)),
      ).toISOString();
      if (remaining > 0) end = next;
      return {
        orderId: p.orderId,
        paidAt: p.paidAt,
        periodStart: start,
        periodEnd: next,
        active: remaining > 0,
      };
    });
}
/** A later payment only rescues an older source if its verified payment preceded that source's purge. */
export function prepaidCreditExpiry(purchases: PrepaidPurchase[], orderId: string) {
  const timeline = prepaidTimeline(purchases),
    index = timeline.findIndex((p) => p.orderId === orderId),
    row = timeline[index],
    purchase = purchases.find((p) => p.orderId === orderId);
  if (!row || !purchase) throw new Error('Prepaid purchase is missing');
  if (!row.active) return row.paidAt;
  let end = row.periodEnd;
  if (purchase.terms.creditValidity === 'same-plan-renewal')
    for (const later of timeline.slice(index + 1)) {
      if (!later.active) continue;
      if (later.paidAt >= addUtcMonths(end, purchase.terms.creditArchiveMonths)) break;
      if (later.periodEnd > end) end = later.periodEnd;
    }
  return end;
}

import { z } from 'zod';

export const prepaidTermsSchema = z
  .object({
    months: z.number().int().min(1).max(36),
    audience: z.enum(['personal', 'team']),
    stacking: z.literal('same-plan'),
    timeBasis: z.literal('utc-calendar-month'),
    refundPolicy: z.literal('proportional-duration'),
    creditArchiveMonths: z.union([z.literal(0), z.literal(3)]),
    creditValidity: z.enum(['purchase-period', 'same-plan-renewal']),
  })
  .strict()
  .refine(
    (v) =>
      v.creditValidity === 'same-plan-renewal'
        ? v.creditArchiveMonths === 3
        : v.creditArchiveMonths === 0,
    '同档续费恢复使用3个月封存；历史逐次到期合同不封存',
  );
export type PrepaidTerms = z.infer<typeof prepaidTermsSchema>;

const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString());
export const promotionSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(false),
    startsAt: instant,
    endsAt: instant,
    timeZone: z.string().refine((s) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }, '活动展示时区无效'),
    qualificationTime: z.literal('checkout-start'),
    priceMinor: z.number().int().positive().max(99_999_999),
    eligibility: z
      .enum(['unconfigured', 'all', 'first-web-purchase', 'first-personal-membership'])
      .default('unconfigured'),
    refundedPurchasesCount: z.boolean().nullable().default(null),
    evidenceReference: z.string().trim().max(2000).default(''),
  })
  .strict()
  .refine((p) => p.endsAt > p.startsAt, '活动结束须晚于开始');
export type Promotion = z.infer<typeof promotionSchema>;
export const promotionSnapshotSchema = z
  .object({
    definition: promotionSchema,
    originalPriceMinor: z.number().int().positive(),
  })
  .strict();
export type PromotionSnapshot = z.infer<typeof promotionSnapshotSchema>;
export interface PromotionOffer {
  definition: Promotion;
  status: 'disabled' | 'unconfigured' | 'upcoming' | 'ended' | 'ineligible' | 'available';
  reason: string;
  originalPriceMinor: number;
  priceMinor: number;
}
export function promotionMissing(p: Promotion) {
  return [
    ...(p.eligibility === 'unconfigured' ? ['首购资格范围未配置'] : []),
    ...(p.eligibility !== 'all' && p.refundedPurchasesCount === null
      ? ['退款历史是否计入首购未配置']
      : []),
    ...(!p.evidenceReference ? ['活动规则确认依据未配置'] : []),
  ];
}

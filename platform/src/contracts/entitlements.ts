import { z } from 'zod';
import { brandQuotaScopeSchema, brandQuotaSchema } from './brand-quota';
export const EntitlementLimitsSchema = z
  .object({
    projects: z.number().int().min(1).max(100000),
    seats: z.number().int().min(1).max(1000),
    brands: z.number().int().min(1).max(10000),
    characters: z.number().int().min(1).max(10000),
    apiKeys: z.number().int().min(0).max(1000),
    concurrency: z.number().int().min(1).max(100),
    textAssistDailyFreeUnits: z.number().int().min(0).max(10000),
  })
  .strict();
export const PlanLimitsSchema = EntitlementLimitsSchema.partial()
  .extend({
    brandQuotaScope: brandQuotaScopeSchema.optional(),
  })
  .refine(
    (value) => value.brandQuotaScope === undefined || value.brands !== undefined,
    '品牌额度作用域必须同时指定数量',
  );
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;
export type EntitlementLimits = z.infer<typeof EntitlementLimitsSchema>;
export type CountedResource = Exclude<
  keyof EntitlementLimits,
  'concurrency' | 'textAssistDailyFreeUnits'
>;
export const EntitlementsSchema = z.object({
  limits: EntitlementLimitsSchema,
  source: z.enum(['baseline', 'subscription']),
  subscriptionIds: z.array(z.string().uuid()),
  isDemo: z.boolean(),
  brandQuota: brandQuotaSchema.optional(),
  used: z.object({
    projects: z.number().int(),
    seats: z.number().int(),
    brands: z.number().int(),
    characters: z.number().int(),
    apiKeys: z.number().int(),
  }),
  freeTextAssist: z.object({
    limit: z.number().int(),
    used: z.number().int(),
    remaining: z.number().int(),
    resetAt: z.string().datetime(),
  }),
});

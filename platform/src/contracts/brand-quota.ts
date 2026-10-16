import { z } from 'zod';

export const brandQuotaScopeSchema = z.enum(['workspace', 'member']);
export type BrandQuotaScope = z.infer<typeof brandQuotaScopeSchema>;
export const brandQuotaSchema = z
  .object({
    scope: z.enum(['workspace', 'member', 'mixed']),
    workspaceLimit: z.number().int().nonnegative().nullable(),
    memberLimit: z.number().int().nonnegative().nullable(),
    workspaceUsed: z.number().int().nonnegative(),
    memberUsed: z.number().int().nonnegative(),
    canCreate: z.boolean(),
  })
  .strict();
export type BrandQuota = z.infer<typeof brandQuotaSchema>;

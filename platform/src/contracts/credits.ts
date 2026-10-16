import { billingChannelSchema } from './billing-channel';
import { z } from 'zod';
export const creditBucketSchema = z.object({
  id: z.string(),
  workspaceId: z.string().uuid(),
  billingChannel: billingChannelSchema.optional(),
  source: z.enum([
    'initial',
    'legacy',
    'subscription',
    'pack',
    'referral',
    'redemption',
    'manual',
    'legacy-refund',
  ]),
  sourceId: z.string().nullable(),
  granted: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  status: z.enum(['active', 'archived', 'expired']),
  expiresAt: z.string().datetime().nullable(),
  archiveUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CreditBucketDto = z.infer<typeof creditBucketSchema>;

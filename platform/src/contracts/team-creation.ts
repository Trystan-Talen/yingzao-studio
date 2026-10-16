import { z } from 'zod';
import type { PrepaidTerms, PromotionOffer } from './promotions';
import type { PlanLimits } from './entitlements';
export const TeamReservationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    planId: z.string().uuid(),
    expectedAmountMinor: z.number().int().positive(),
    expectedCatalogVersion: z.number().int().positive(),
  })
  .strict();
export interface TeamCreationStatus {
  mode: 'existing' | 'pending' | 'demo' | 'purchase';
  reason: string;
  existing: { id: string; name: string; accessible: boolean; archived: boolean } | null;
  pending: {
    workspaceId: string;
    name: string;
    order: {
      id: string;
      number: string;
      status: string;
      amountMinor: number;
      currency: string;
    } | null;
  } | null;
  plans: {
    id: string;
    name: string;
    priceMinor: number;
    currency: string;
    credits: number;
    catalogVersion: number;
    limits: PlanLimits;
    terms: PrepaidTerms;
    promotion: PromotionOffer | null;
    available: boolean;
    unavailableReason: string;
  }[];
}

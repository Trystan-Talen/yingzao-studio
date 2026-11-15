import { z } from 'zod';
import type { CreditDto } from './jobs';

export const MAX_LOCAL_TEST_GRANT = 100000;
export const localTestGrantInputSchema = z
  .object({
    amount: z.number().int().min(1).max(MAX_LOCAL_TEST_GRANT),
    requestId: z.string().uuid(),
  })
  .strict();
export type LocalTestGrantInput = z.infer<typeof localTestGrantInputSchema>;
export interface LocalTestGrantAvailabilityDto {
  available: boolean;
  maxCredits: number;
  reason: string | null;
}
export interface LocalTestGrantResultDto {
  granted: number;
  alreadyApplied: boolean;
  credits: CreditDto;
}

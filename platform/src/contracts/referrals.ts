import { z } from 'zod';

export const referralPolicySchema = z
  .object({
    kind: z.literal('personal-first-subscription-v1'),
    referrerBps: z.literal(1500).default(1500),
    inviteeBps: z.literal(1000).default(1000),
    registrationWindowDays: z.literal(30).default(30),
    rewardValidityDays: z.literal(7).default(7),
    rounding: z.enum(['unconfigured', 'floor', 'ceil', 'nearest']).default('unconfigured'),
    membershipRequirement: z
      .enum([
        'unconfigured',
        'none',
        'referrer-active-at-payment',
        'invitee-active-at-payment',
        'both-active-at-payment',
      ])
      .default('unconfigured'),
    evidenceReference: z.string().trim().max(2000).default(''),
  })
  .strict();
export type ReferralPolicy = z.infer<typeof referralPolicySchema>;
export function referralPolicyMissing(policy: ReferralPolicy): string[] {
  return [
    ...(policy.rounding === 'unconfigured' ? ['套餐算力比例的取整方式未配置'] : []),
    ...(policy.membershipRequirement === 'unconfigured' ? ['会员资格要求未配置'] : []),
    ...(!policy.evidenceReference ? ['规则确认依据未配置'] : []),
  ];
}
export function referralPolicyReady(policy: ReferralPolicy) {
  return referralPolicyMissing(policy).length === 0;
}
export function referralCredits(base: number, bps: number, rounding: ReferralPolicy['rounding']) {
  if (!Number.isSafeInteger(base) || base < 0 || !Number.isSafeInteger(bps) || bps < 0)
    throw new Error('Invalid referral credit basis');
  if (rounding === 'unconfigured') throw new Error('Referral rounding is not configured');
  const product = BigInt(base) * BigInt(bps);
  const adjustment = rounding === 'ceil' ? 9999n : rounding === 'nearest' ? 5000n : 0n;
  const result = Number((product + adjustment) / 10000n);
  if (!Number.isSafeInteger(result)) throw new Error('Referral credit limit exceeded');
  return result;
}
export function referralRefundTarget(credits: number, refundedMinor: number, paidMinor: number) {
  if (
    ![credits, refundedMinor, paidMinor].every(Number.isSafeInteger) ||
    credits < 0 ||
    refundedMinor < 0 ||
    paidMinor <= 0
  )
    throw new Error('Invalid referral refund amounts');
  const denominator = BigInt(paidMinor);
  const numerator = BigInt(credits) * BigInt(Math.min(refundedMinor, paidMinor));
  return Number((numerator + denominator - 1n) / denominator);
}
export interface ReferralRuleDto {
  version: number;
  enabled: boolean;
  credits: number;
  minimumPaidMinor: number;
  currency: string;
  policy: ReferralPolicy | null;
  missingConfiguration: string[];
}

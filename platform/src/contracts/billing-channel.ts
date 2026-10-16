import { z } from 'zod';

export const billingChannelSchema = z.enum(['web', 'api']);
export type BillingChannel = z.infer<typeof billingChannelSchema>;

/** Authentication fixes the spending account; request payloads cannot select it. */
export function channelForActor(actor: { authType: 'session' | 'apiKey' }): BillingChannel {
  return actor.authType === 'apiKey' ? 'api' : 'web';
}

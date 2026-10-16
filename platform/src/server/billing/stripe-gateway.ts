import Stripe from 'stripe';
import { z } from 'zod';
const metadata = z
  .record(z.string(), z.string())
  .nullish()
  .transform((value) => value ?? {});
const reference = z
  .union([z.string(), z.object({ id: z.string() })])
  .nullish()
  .transform((value) => (typeof value === 'string' ? value : (value?.id ?? null)));
const price = z.object({
  unit_amount: z.number().int().nullable(),
  currency: z.string(),
  recurring: z.object({ interval: z.string() }).nullish(),
});
export const checkoutSchema = z.object({
  id: z.string(),
  mode: z.string().nullable(),
  payment_status: z.string(),
  status: z.string().nullable(),
  amount_total: z.number().int().nullable(),
  currency: z.string().nullable(),
  metadata,
  client_reference_id: z.string().nullish(),
  url: z.string().url().nullish(),
  expires_at: z.number().int(),
  payment_intent: reference,
  invoice: reference,
  subscription: reference,
  customer: reference,
  line_items: z
    .object({
      data: z.array(z.object({ quantity: z.number().int().nullable(), price: price.nullable() })),
      has_more: z.boolean(),
    })
    .optional(),
});
export const subscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  metadata,
  customer: reference,
  cancel_at_period_end: z.boolean(),
  ended_at: z.number().int().positive().nullish(),
  items: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        current_period_start: z.number().int(),
        current_period_end: z.number().int(),
        quantity: z.number().int().optional(),
        price,
      }),
    ),
  }),
});
export const invoiceSchema = z.object({
  metadata,
  status_transitions: z.object({ paid_at: z.number().int().positive().nullable() }).nullish(),
  id: z.string(),
  status: z.string().nullable(),
  amount_paid: z.number().int(),
  total: z.number().int(),
  currency: z.string(),
  billing_reason: z.string().nullable(),
  parent: z
    .object({ subscription_details: z.object({ subscription: reference }).nullish() })
    .nullish(),
  payments: z
    .object({
      data: z.array(
        z.object({ status: z.string(), payment: z.object({ payment_intent: reference }) }),
      ),
      has_more: z.boolean(),
    })
    .optional(),
  lines: z.object({
    data: z.array(
      z.object({
        amount: z.number().int(),
        quantity: z.number().int().nullable(),
        period: z.object({ start: z.number().int(), end: z.number().int() }),
      }),
    ),
    has_more: z.boolean(),
  }),
  hosted_invoice_url: z.string().url().nullish(),
  invoice_pdf: z.string().url().nullish(),
});
export const refundSchema = z.object({
  id: z.string().min(1),
  charge: reference,
  payment_intent: reference,
  amount: z.number().int().positive(),
  currency: z.string(),
  created: z.number().int().positive(),
  status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']).nullable(),
});
export const chargeSchema = z.object({
  currency: z.string().optional(),
  refunds: z.object({ data: z.array(refundSchema).max(100), has_more: z.boolean() }).optional(),
  id: z.string(),
  payment_intent: reference,
  refunded: z.boolean(),
  amount_refunded: z.number().int(),
  amount: z.number().int(),
});
export type CheckoutSession = z.infer<typeof checkoutSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type Charge = z.infer<typeof chargeSchema>;
export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  object: unknown;
}
export type CheckoutParams = NonNullable<Parameters<Stripe['checkout']['sessions']['create']>[0]>;
export interface StripeGateway {
  verifyWebhook(raw: Buffer, signature: string, secret: string): StripeEvent;
  createCheckout(params: CheckoutParams, idempotencyKey: string): Promise<CheckoutSession>;
  retrieveCheckout(id: string): Promise<CheckoutSession>;
  retrieveSubscription(id: string): Promise<Subscription>;
  cancelSubscriptionAtPeriodEnd(id: string, idempotencyKey: string): Promise<Subscription>;
  retrieveInvoice(id: string): Promise<Invoice>;
  retrieveCharge(id: string): Promise<Charge>;
}
export function createStripeGateway(secret: string): StripeGateway {
  const stripe = new Stripe(secret, { maxNetworkRetries: 2, timeout: 20000 });
  return {
    verifyWebhook(raw, signature, webhookSecret) {
      const event = stripe.webhooks.constructEvent(raw, signature, webhookSecret, 300);
      return {
        id: event.id,
        type: event.type,
        created: event.created,
        livemode: event.livemode,
        object: event.data.object,
      };
    },
    async createCheckout(params, idempotencyKey) {
      return checkoutSchema.parse(
        await stripe.checkout.sessions.create(params, { idempotencyKey }),
      );
    },
    async retrieveCheckout(id) {
      return checkoutSchema.parse(
        await stripe.checkout.sessions.retrieve(id, { expand: ['line_items'] }),
      );
    },
    async retrieveSubscription(id) {
      return subscriptionSchema.parse(await stripe.subscriptions.retrieve(id));
    },
    async cancelSubscriptionAtPeriodEnd(id, idempotencyKey) {
      return subscriptionSchema.parse(
        await stripe.subscriptions.update(id, { cancel_at_period_end: true }, { idempotencyKey }),
      );
    },
    async retrieveInvoice(id) {
      return invoiceSchema.parse(await stripe.invoices.retrieve(id, { expand: ['payments'] }));
    },
    async retrieveCharge(id) {
      const charge = await stripe.charges.retrieve(id);
      // A bounded complete list provides refund timestamps; an incomplete list is explicit.
      const refunds = await stripe.refunds.list({ charge: id, limit: 100 });
      return chargeSchema.parse({ ...charge, refunds });
    },
  };
}

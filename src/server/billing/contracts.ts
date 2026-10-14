import type { Actor } from '../../contracts/core';
import type { StripeInvoiceDocument } from '../../contracts/billing';
export interface CheckoutResult {
  orderId: string;
  provider: 'stripe';
  checkoutUrl: string;
  url: string;
  expiresAt: string;
}
export interface SubscriptionCancellation {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}
export interface BillingAdapter {
  isConfigured(): boolean;
  canCheckoutPlan(planId: string): boolean;
  checkout(actor: Actor, workspaceId: string, orderId: string): Promise<CheckoutResult>;
  cancelSubscription(
    actor: Actor,
    workspaceId: string,
    subscriptionId: string,
  ): Promise<SubscriptionCancellation>;
  invoiceDocument(
    actor: Actor,
    workspaceId: string,
    orderId: string,
  ): Promise<StripeInvoiceDocument>;
}

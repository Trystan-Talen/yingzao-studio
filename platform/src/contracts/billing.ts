export interface StripeInvoiceDocument {
  orderId: string;
  provider: 'stripe';
  invoiceId: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
  kind: 'provider-billing-document';
}

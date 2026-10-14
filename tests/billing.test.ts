/** Isolated Stripe protocol fixtures. No live Checkout, charge, refund or network request is performed. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Actor } from '../src/contracts/core';
import type { AppConfig } from '../src/server/config';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createCreditService, type CreditService } from '../src/server/tasks/credits';
import { createBillingService, type BillingService } from '../src/server/billing';
import {
  createStripeGateway,
  checkoutSchema,
  subscriptionSchema,
  invoiceSchema,
  chargeSchema,
  type StripeGateway,
  type CheckoutSession,
  type Subscription,
  type Invoice,
  type Charge,
  type CheckoutParams,
} from '../src/server/billing/stripe-gateway';
import { AppError } from '../src/server/errors';
import { createBillingAdmin } from '../src/server/billing/admin';
let temp: string,
  db: DatabaseContext,
  core: CoreServices,
  credits: CreditService,
  billing: BillingService,
  config: AppConfig,
  actor: Actor,
  wid: string,
  planId: string;
let sessions: Map<string, CheckoutSession>,
  subscriptions: Map<string, Subscription>,
  invoices: Map<string, Invoice>,
  charges: Map<string, Charge>,
  createCalls: { params: CheckoutParams; key: string }[],
  cancelCalls: string[];
let gateway: StripeGateway;
const webhookSecret = 'whsec_isolated_signature_test',
  sdk = new Stripe('sk_test_fixture_only');
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'yingzao-billing-'));
  db = createDatabaseContext(join(temp, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(temp, 'test.sqlite'),
    storageDir: join(temp, 'media'),
    sessionSecret: 'test-secret',
    encryptionKey: 'test-encryption',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
    billing: { stripeSecretKey: 'sk_test_fixture_only', stripeWebhookSecret: webhookSecret },
  };
  credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (w, u) => credits.initialize(w, u, 100),
  });
  const registered = await core.auth.register({
    email: 'billing@example.local',
    password: 'BillingPassword2026!',
    displayName: 'Billing test',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
  planId = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,active) VALUES(?,?,?,?,?,?,?,?,1)',
    )
    .run(planId, 'Fixture credit package', 'credits', 9900, 'USD', null, 500, '{}');
  sessions = new Map();
  subscriptions = new Map();
  invoices = new Map();
  charges = new Map();
  createCalls = [];
  cancelCalls = [];
  const requireValue = <T>(map: Map<string, T>, id: string): T => {
    const value = map.get(id);
    if (!value) throw new Error(`Missing fixture ${id}`);
    return value;
  };
  gateway = {
    verifyWebhook: createStripeGateway('sk_test_fixture_only').verifyWebhook,
    async createCheckout(params, key) {
      createCalls.push({ params, key });
      const id = `cs_test_${createCalls.length}`,
        price = params.line_items![0]!.price_data!;
      const s = checkoutSchema.parse({
        id,
        mode: params.mode,
        payment_status: 'unpaid',
        status: 'open',
        amount_total: price.unit_amount,
        currency: price.currency,
        metadata: params.metadata,
        client_reference_id: params.client_reference_id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        payment_intent: null,
        subscription: null,
        customer: null,
        line_items: {
          has_more: false,
          data: [
            {
              quantity: 1,
              price: {
                unit_amount: price.unit_amount,
                currency: price.currency,
                recurring: price.recurring ?? null,
              },
            },
          ],
        },
      });
      sessions.set(id, s);
      return s;
    },
    async retrieveCheckout(id) {
      return requireValue(sessions, id);
    },
    async retrieveSubscription(id) {
      return requireValue(subscriptions, id);
    },
    async cancelSubscriptionAtPeriodEnd(id, key) {
      cancelCalls.push(key);
      const sub = requireValue(subscriptions, id);
      sub.cancel_at_period_end = true;
      return sub;
    },
    async retrieveInvoice(id) {
      return requireValue(invoices, id);
    },
    async retrieveCharge(id) {
      return requireValue(charges, id);
    },
  };
  billing = createBillingService(db, core, config, credits, gateway);
  core.business.setBilling(billing);
});
afterEach(async () => {
  closeDatabase(db);
  await rm(temp, { recursive: true, force: true });
});
async function event(
  type: string,
  id: string,
  extra: Record<string, unknown> = {},
  eventId = `evt_${randomUUID()}`,
) {
  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: config.billing?.stripeSecretKey?.startsWith('sk_live_') ?? false,
    data: { object: { id, ...extra } },
  });
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  return billing.handleWebhook(Buffer.from(payload), signature);
}
async function pendingOrder() {
  const o = core.business.createOrder(actor, wid, { planId });
  await billing.checkout(actor, wid, o.id);
  return { order: o, session: [...sessions.values()].at(-1)! };
}
function paid(s: CheckoutSession) {
  s.payment_status = 'paid';
  s.status = 'complete';
  if (s.mode === 'payment') s.payment_intent = `pi_${s.id}`;
  return s;
}
async function subscriptionOrder() {
  db.sqlite
    .prepare("UPDATE plans SET kind='subscription',interval='month',limits_json=? WHERE id=?")
    .run(JSON.stringify({ concurrency: 4 }), planId);
  const value = await pendingOrder();
  const seconds = Math.floor(Date.now() / 1000);
  const sub = subscriptionSchema.parse({
    id: 'sub_fixture',
    status: 'active',
    metadata: { order_id: value.order.id, workspace_id: wid },
    customer: 'cus_fixture',
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: 'si_fixture',
          current_period_start: seconds,
          current_period_end: seconds + 30 * 86400,
          quantity: 1,
          price: { unit_amount: 9900, currency: 'usd', recurring: { interval: 'month' } },
        },
      ],
    },
  });
  subscriptions.set(sub.id, sub);
  value.session.subscription = sub.id;
  return { ...value, sub };
}
function invoice(sub: Subscription, id = 'in_initial', reason = 'subscription_create') {
  const value = invoiceSchema.parse({
    id,
    status: 'paid',
    amount_paid: 9900,
    total: 9900,
    currency: 'usd',
    billing_reason: reason,
    parent: { subscription_details: { subscription: sub.id } },
    payments: {
      has_more: false,
      data: [{ status: 'paid', payment: { payment_intent: `pi_${id}` } }],
    },
    lines: {
      has_more: false,
      data: [
        {
          amount: 9900,
          quantity: 1,
          period: {
            start: sub.items.data[0]!.current_period_start,
            end: sub.items.data[0]!.current_period_end,
          },
        },
      ],
    },
  });
  invoices.set(value.id, value);
  return value;
}
describe('Stripe checkout and verified fulfillment', () => {
  it('exposes only the verified, same-space invoice document and rejects foreign or unsafe links', async () => {
    const { order, sub } = await subscriptionOrder();
    await expect(billing.invoiceDocument(actor, wid, order.id)).rejects.toMatchObject({
      code: 'BILLING_DOCUMENT_UNAVAILABLE',
    });
    const bill = invoice(sub);
    bill.hosted_invoice_url = 'https://invoice.stripe.com/i/fixture';
    bill.invoice_pdf = 'https://pay.stripe.com/invoice/fixture/pdf';
    await event('invoice.paid', bill.id);
    expect(core.business.getOrder(actor, wid, order.id).billingDocumentAvailable).toBe(true);
    expect(await core.business.billingDocument(actor, wid, order.id)).toMatchObject({
      orderId: order.id,
      invoiceId: bill.id,
      hostedUrl: bill.hosted_invoice_url,
      pdfUrl: bill.invoice_pdf,
      kind: 'provider-billing-document',
    });
    const other = core.auth.createWorkspace(actor.userId, 'Other billing space', 'team');
    await expect(billing.invoiceDocument(actor, other.id, order.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      billing.invoiceDocument(
        { ...actor, authType: 'apiKey', apiKeyId: 'invalid', workspaceId: wid },
        wid,
        order.id,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    bill.invoice_pdf = 'https://pay.stripe.com.evil.example/invoice/pdf';
    await expect(billing.invoiceDocument(actor, wid, order.id)).rejects.toMatchObject({
      code: 'INVALID_BILLING_DOCUMENT_URL',
    });
    bill.invoice_pdf = 'http://pay.stripe.com/invoice/pdf';
    await expect(billing.invoiceDocument(actor, wid, order.id)).rejects.toMatchObject({
      code: 'INVALID_BILLING_DOCUMENT_URL',
    });
    bill.invoice_pdf = null;
    bill.hosted_invoice_url = null;
    expect(await billing.invoiceDocument(actor, wid, order.id)).toMatchObject({
      pdfUrl: null,
      hostedUrl: null,
    });
    bill.total += 1;
    await expect(billing.invoiceDocument(actor, wid, order.id)).rejects.toMatchObject({
      code: 'INVOICE_MISMATCH',
    });
  });
  it('rechecks invoice permissions after a remote request and never returns provider links after revocation', async () => {
    const { order, sub } = await subscriptionOrder();
    const bill = invoice(sub);
    await event('invoice.paid', bill.id);
    gateway.retrieveInvoice = async () => {
      db.sqlite
        .prepare("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?")
        .run(wid, actor.userId);
      return bill;
    };
    await expect(billing.invoiceDocument(actor, wid, order.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('keeps unconfigured checkout and demo live keys disabled without mutating the draft', async () => {
    const o = core.business.createOrder(actor, wid, { planId });
    const missing = createBillingService(db, core, { ...config, billing: {} }, credits, gateway);
    await expect(missing.checkout(actor, wid, o.id)).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    });
    const liveDemo = createBillingService(
      db,
      core,
      {
        ...config,
        demoMode: true,
        billing: { ...config.billing, stripeSecretKey: 'sk_live_forbidden' },
      },
      credits,
      gateway,
    );
    expect(liveDemo.isConfigured()).toBe(false);
    expect(core.business.getOrder(actor, wid, o.id).status).toBe('draft');
    expect(createCalls).toHaveLength(0);
  });
  it('creates hosted checkout from frozen server prices and reuses its persisted session', async () => {
    const o = core.business.createOrder(actor, wid, { planId });
    db.sqlite.prepare('UPDATE plans SET price_minor=12300,credits=999 WHERE id=?').run(planId);
    const first = await core.business.checkout(actor, wid, o.id),
      second = await core.business.checkout(actor, wid, o.id);
    expect(first).toMatchObject({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      provider: 'stripe',
    });
    expect(second).toEqual(first);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.params.line_items?.[0]?.price_data?.unit_amount).toBe(9900);
    expect(createCalls[0]?.params.success_url).toContain('/usage?tab=orders&order=');
    expect(core.business.getOrder(actor, wid, o.id).status).toBe('pending');
    expect(credits.account(wid).balance).toBe(100);
    expect(() => core.business.cancelOrder(actor, wid, o.id)).toThrow(AppError);
  });
  it('does not grant unpaid completions and fulfills async success exactly once across different events', async () => {
    const { order, session } = await pendingOrder();
    await event('checkout.session.completed', session.id);
    expect(credits.account(wid).balance).toBe(100);
    paid(session);
    const id = 'evt_deduplicated';
    expect(
      (await event('checkout.session.async_payment_succeeded', session.id, {}, id)).duplicate,
    ).toBe(false);
    expect(
      (await event('checkout.session.async_payment_succeeded', session.id, {}, id)).duplicate,
    ).toBe(true);
    await event('checkout.session.completed', session.id);
    expect(credits.account(wid).balance).toBe(600);
    expect(core.business.getOrder(actor, wid, order.id).status).toBe('paid');
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM billing_fulfillments').get()).toEqual({
      n: 1,
    });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) n FROM credit_ledger WHERE event_key LIKE 'payment:%'")
        .get(),
    ).toEqual({ n: 1 });
  });
  it('rejects bad signatures, wrong amounts and foreign-workspace checkout before granting', async () => {
    const { order, session } = await pendingOrder();
    await expect(billing.handleWebhook(Buffer.from('{}'), 'invalid')).rejects.toMatchObject({
      code: 'WEBHOOK_SIGNATURE',
    });
    paid(session);
    session.amount_total = 1;
    await expect(event('checkout.session.completed', session.id)).rejects.toMatchObject({
      code: 'PAYMENT_MISMATCH',
    });
    const other = core.team.create(actor, { name: 'Other' });
    await expect(billing.checkout(actor, other.id, order.id)).rejects.toThrow(AppError);
    expect(credits.account(wid).balance).toBe(100);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM stripe_events').get()).toEqual({ n: 0 });
  });
  it('does not create a second remote session after ambiguous creation beyond the idempotency window', async () => {
    gateway.createCheckout = async () => {
      throw new Error('connection lost after submission');
    };
    const o = core.business.createOrder(actor, wid, { planId });
    await expect(billing.checkout(actor, wid, o.id)).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_ERROR',
    });
    db.sqlite.prepare('UPDATE stripe_checkouts SET created_at=?').run('2000-01-01T00:00:00.000Z');
    await expect(billing.checkout(actor, wid, o.id)).rejects.toMatchObject({
      code: 'PAYMENT_RECONCILIATION_REQUIRED',
    });
    expect(core.business.getOrder(actor, wid, o.id).status).toBe('pending');
  });
});
describe('subscription lifecycle and auditable payment risk', () => {
  it('fulfills an initial invoice arriving before checkout, then renews once per invoice', async () => {
    const { sub, session, order } = await subscriptionOrder();
    const initial = invoice(sub);
    await event('invoice.paid', initial.id);
    paid(session);
    await event('checkout.session.completed', session.id);
    expect(
      db.sqlite.prepare('SELECT provider_payment_intent_id FROM orders WHERE id=?').get(order.id),
    ).toEqual({ provider_payment_intent_id: 'pi_in_initial' });
    await event('invoice.paid', initial.id);
    expect(credits.account(wid).balance).toBe(600);
    expect(core.business.getOrder(actor, wid, order.id).status).toBe('paid');
    expect(
      db.sqlite.prepare('SELECT provider_payment_intent_id FROM orders WHERE id=?').get(order.id),
    ).toEqual({ provider_payment_intent_id: 'pi_in_initial' });
    const renewal = invoice(sub, 'in_renewal', 'subscription_cycle');
    await event('invoice.paid', renewal.id);
    await event('invoice.paid', renewal.id);
    expect(credits.account(wid).balance).toBe(1100);
    expect(core.business.orders(actor, wid, {}).items).toHaveLength(2);
    expect(core.business.subscriptions(actor, wid, {}).items).toHaveLength(1);
    expect(
      db.sqlite
        .prepare('SELECT concurrency_limit FROM workspace_billing WHERE workspace_id=?')
        .get(wid),
    ).toEqual({ concurrency_limit: 4 });
  });
  it('uses fresh subscription state for stale notifications and cancels only after Stripe confirmation', async () => {
    const { sub } = await subscriptionOrder();
    await event('customer.subscription.created', sub.id);
    const local = core.business.subscriptions(actor, wid, {}).items[0]!;
    const cancelled = await core.business.cancelSubscription(actor, wid, local.id);
    expect(cancelled).toMatchObject({ cancelAtPeriodEnd: true });
    expect(cancelCalls).toHaveLength(1);
    expect(credits.account(wid).balance).toBe(100);
    sub.status = 'canceled';
    await event('customer.subscription.updated', sub.id);
    await event('customer.subscription.created', sub.id);
    expect(core.business.subscriptions(actor, wid, {}).items[0]?.status).toBe('canceled');
    expect(
      db.sqlite
        .prepare('SELECT concurrency_limit FROM workspace_billing WHERE workspace_id=?')
        .get(wid),
    ).toEqual({ concurrency_limit: 2 });
  });
  it('records refunds, holds new reservations and never creates negative balances', async () => {
    const { session, order } = await pendingOrder();
    paid(session);
    await event('checkout.session.completed', session.id);
    const charge = chargeSchema.parse({
      id: 'ch_refund',
      payment_intent: session.payment_intent,
      refunded: true,
      amount_refunded: 9900,
      amount: 9900,
    });
    charges.set(charge.id, charge);
    await event('charge.refunded', charge.id);
    expect(core.business.getOrder(actor, wid, order.id).status).toBe('refunded');
    expect(credits.account(wid).balance).toBe(600);
    expect(() => credits.reserve(wid, actor.userId, 1, randomUUID(), randomUUID())).toThrowError(
      expect.objectContaining({ code: 'PAYMENT_REVIEW_REQUIRED' }),
    );
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM billing_risks').get()).toEqual({ n: 1 });
  });
  it('links a risk arriving before payment fulfillment and holds the credited space', async () => {
    const { session } = await pendingOrder();
    paid(session);
    const charge = chargeSchema.parse({
      id: 'ch_early',
      payment_intent: session.payment_intent,
      refunded: false,
      amount_refunded: 0,
      amount: 9900,
    });
    charges.set(charge.id, charge);
    await event('charge.dispute.created', 'dp_fixture', { charge: charge.id });
    await event('checkout.session.completed', session.id);
    expect(db.sqlite.prepare('SELECT workspace_id FROM billing_risks').get()).toEqual({
      workspace_id: wid,
    });
    expect(() => credits.reserve(wid, actor.userId, 1, randomUUID(), randomUUID())).toThrow(
      AppError,
    );
    expect(credits.account(wid).balance).toBe(600);
  });
});

it('integrates a verified live-mode fixture with referral rewards and partial-refund invoice review', async () => {
  // Explicit gateway fixtures: no live Stripe network call or money movement occurs.
  const owner = actor,
    ownerWorkspace = wid,
    admin = createBillingAdmin(db),
    reason = 'Administrator configured these rules for isolated protocol tests.';
  admin.configureReferrals({
    actorUserId: owner.userId,
    reason,
    registrationEnabled: true,
    rewardsEnabled: true,
    rewardCredits: 50,
    minimumPaidMinor: 1000,
    currency: 'USD',
  });
  admin.importPlans({
    version: 1,
    actorUserId: owner.userId,
    reason,
    confirmCommercialCatalog: true,
    plans: [
      {
        id: planId,
        name: 'Approved fixture',
        kind: 'credits',
        priceMinor: 9900,
        currency: 'USD',
        credits: 500,
        interval: null,
      },
    ],
  });
  const ref = core.business.referrals(owner, ownerWorkspace),
    registered = await core.auth.register({
      email: 'buyer@example.local',
      password: 'BuyerPassword2026!',
      displayName: 'Buyer',
      referralCode: ref.inviteCode,
    });
  actor = { ...owner, userId: registered.user.id };
  wid = registered.workspace.id;
  config = {
    ...config,
    billing: { stripeSecretKey: 'sk_live_fixture_only', stripeWebhookSecret: webhookSecret },
  };
  billing = createBillingService(db, core, config, credits, gateway);
  core.business.setBilling(billing);
  const { session, order } = await pendingOrder();
  paid(session);
  await event('checkout.session.completed', session.id);
  expect(credits.account(ownerWorkspace).balance).toBe(150);
  expect(core.business.referrals(owner, ownerWorkspace).qualifiedCount).toBe(1);
  const title = core.business.createTitle(actor, wid, {
      type: 'personal',
      name: 'Buyer',
      email: null,
      taxId: null,
    }),
    request = core.business.createInvoice(actor, wid, { titleId: title.id, orderIds: [order.id] });
  core.business.submitInvoice(actor, wid, request.id);
  const charge = chargeSchema.parse({
    id: 'ch_partial_fixture',
    payment_intent: session.payment_intent,
    refunded: false,
    amount_refunded: 1000,
    amount: 9900,
  });
  charges.set(charge.id, charge);
  await event('charge.refunded', charge.id);
  await event('charge.refunded', charge.id);
  expect(credits.account(ownerWorkspace).balance).toBe(144);
  expect(core.business.getOrder(actor, wid, order.id).refundedMinor).toBe(1000);
  expect(core.business.invoice(actor, wid, request.id).status).toBe('review-required');
  core.business.withdrawInvoice(actor, wid, request.id, { reason: 'Refund amount correction' });
  expect(
    core.business.createInvoice(actor, wid, { titleId: title.id, orderIds: [order.id] })
      .amountMinor,
  ).toBe(8900);
});

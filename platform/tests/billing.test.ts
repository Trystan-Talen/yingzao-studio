/** Isolated Stripe protocol fixtures. No live Checkout, charge, refund or network request is performed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepaidTermsSchema, promotionSchema } from '../src/contracts/promotions';
import { createPrepaidMemberships } from '../src/server/billing/prepaid';
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
async function setupBilling(environment: 'test' | 'live' = 'test') {
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
    billing: {
      stripeSecretKey: `sk_${environment}_fixture_only`,
      stripeWebhookSecret: webhookSecret,
    },
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
}
beforeEach(() => setupBilling());
afterEach(async () => {
  vi.useRealTimers();
  closeDatabase(db);
  await rm(temp, { recursive: true, force: true });
});

function fixedTerms() {
  return prepaidTermsSchema.parse({
    months: 1,
    audience: 'personal',
    stacking: 'same-plan',
    timeBasis: 'utc-calendar-month',
    refundPolicy: 'proportional-duration',
    creditArchiveMonths: 0,
    creditValidity: 'purchase-period',
  });
}
async function prepaidPending(paidAt: string, terms: unknown = fixedTerms()) {
  db.sqlite
    .prepare(
      "UPDATE plans SET kind='subscription',interval='month',prepaid_terms_json=?,limits_json=? WHERE id=?",
    )
    .run(JSON.stringify(terms), JSON.stringify({ concurrency: 4 }), planId);
  const order = core.business.createOrder(actor, wid, {
    planId,
    expectedAmountMinor:
      db.sqlite.prepare('SELECT promotion_json FROM plans WHERE id=?').get(planId) &&
      (JSON.parse(
        (
          db.sqlite.prepare('SELECT promotion_json FROM plans WHERE id=?').get(planId) as {
            promotion_json: string | null;
          }
        ).promotion_json ?? 'null',
      )?.priceMinor ??
        9900),
  });
  await billing.checkout(actor, wid, order.id);
  const session = [...sessions.values()].at(-1)!;
  const seconds = Math.floor(Date.parse(paidAt) / 1000);
  const receipt = invoiceSchema.parse({
    id: `in_prepaid_${order.id}`,
    status: 'paid',
    status_transitions: { paid_at: seconds },
    metadata: { order_id: order.id, workspace_id: wid },
    amount_paid: order.amountMinor,
    total: order.amountMinor,
    currency: order.currency,
    billing_reason: 'manual',
    lines: {
      has_more: false,
      data: [
        { amount: order.amountMinor, quantity: 1, period: { start: seconds, end: seconds + 1 } },
      ],
    },
  });
  invoices.set(receipt.id, receipt);
  session.invoice = receipt.id;
  return { order, session, receipt };
}
function prepaidRefund(session: CheckoutSession, amount: number) {
  const charge = chargeSchema.parse({
    id: `ch_${session.id}`,
    payment_intent: session.payment_intent,
    amount: session.amount_total,
    amount_refunded: amount,
    refunded: amount === session.amount_total,
    currency: 'usd',
    refunds: {
      has_more: false,
      data: [
        {
          id: `re_${session.id}_${amount}`,
          charge: `ch_${session.id}`,
          payment_intent: session.payment_intent,
          amount,
          currency: 'usd',
          created: Math.floor(Date.now() / 1000),
          status: 'succeeded',
        },
      ],
    },
  });
  charges.set(charge.id, charge);
  return charge;
}

async function teamPayment(paidAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()) {
  createBillingAdmin(db).importPlans({
    actorUserId: actor.userId,
    reason: 'Approved isolated team opening protocol fixture.',
    version: 1,
    confirmCommercialCatalog: true,
    plans: [
      {
        id: planId,
        name: 'Explicit team fixture',
        kind: 'subscription',
        priceMinor: 9900,
        currency: 'USD',
        credits: 500,
        interval: 'month',
        limits: { seats: 20, concurrency: 4 },
        prepaidTerms: { ...fixedTerms(), audience: 'team' },
      },
    ],
  });
  const reservation = core.teamCreation.reserve(actor, {
    name: 'Paid fixture team',
    planId,
    expectedAmountMinor: 9900,
    expectedCatalogVersion: core.teamCreation.status(actor).plans[0]!.catalogVersion,
  });
  const teamWid = reservation.pending!.workspaceId,
    order = reservation.pending!.order!;
  await billing.checkout(actor, teamWid, order.id);
  const session = [...sessions.values()].at(-1)!;
  const seconds = Math.floor(Date.parse(paidAt) / 1000);
  const receipt = invoiceSchema.parse({
    id: `in_team_${order.id}`,
    status: 'paid',
    status_transitions: { paid_at: seconds },
    metadata: { order_id: order.id, workspace_id: teamWid },
    amount_paid: order.amountMinor,
    total: order.amountMinor,
    currency: order.currency,
    billing_reason: 'manual',
    lines: {
      has_more: false,
      data: [
        { amount: order.amountMinor, quantity: 1, period: { start: seconds, end: seconds + 1 } },
      ],
    },
  });
  invoices.set(receipt.id, receipt);
  session.invoice = receipt.id;
  paid(session);
  return { teamWid, order, session };
}
it('activates a reserved team only after verified team payment and preserves the same team across duplicate events and refunds', async () => {
  const value = await teamPayment();
  expect(core.auth.listWorkspaces(actor).some((w) => w.id === value.teamWid)).toBe(false);
  await expect(billing.handleWebhook(Buffer.from('{}'), 'invalid')).rejects.toMatchObject({
    code: 'WEBHOOK_SIGNATURE',
  });
  expect(core.auth.listWorkspaces(actor).some((w) => w.id === value.teamWid)).toBe(false);
  await event('checkout.session.completed', value.session.id);
  await event('checkout.session.completed', value.session.id);
  expect(core.auth.listWorkspaces(actor).find((w) => w.id === value.teamWid)?.role).toBe('owner');
  expect(
    db.sqlite.prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?').get(value.teamWid),
  ).toEqual({ n: 1 });
  expect(core.entitlements.effective(value.teamWid).limits.seats).toBe(20);
  expect(core.teamCreation.status(actor).mode).toBe('existing');
  expect(() => core.team.create(actor, { name: 'Second' })).toThrow(/已占用/);
  const refund = prepaidRefund(value.session, 9900);
  await event('charge.refunded', refund.id);
  expect(core.auth.listWorkspaces(actor).find((w) => w.id === value.teamWid)?.role).toBe('owner');
  expect(core.entitlements.effective(value.teamWid).source).toBe('baseline');
  expect(() => credits.reserve(value.teamWid, actor.userId, 1, randomUUID(), randomUUID())).toThrow(
    AppError,
  );
});
it('does not activate a fully refunded reservation when the refund callback precedes payment fulfillment', async () => {
  const value = await teamPayment();
  await event('charge.refunded', prepaidRefund(value.session, 9900).id);
  await event('checkout.session.completed', value.session.id);
  expect(core.auth.listWorkspaces(actor).some((w) => w.id === value.teamWid)).toBe(false);
  expect(core.teamCreation.status(actor).pending?.order?.status).toBe('refunded');
  expect(core.entitlements.effective(value.teamWid).source).toBe('baseline');
});
it('records verified delayed team activation even when its paid membership period has already expired', async () => {
  const value = await teamPayment('2025-01-01T00:00:00.000Z');
  await event('checkout.session.completed', value.session.id);
  expect(core.teamCreation.status(actor).mode).toBe('existing');
  expect(core.auth.listWorkspaces(actor).find((w) => w.id === value.teamWid)?.role).toBe('owner');
  expect(core.entitlements.effective(value.teamWid).source).toBe('baseline');
});

it('fulfills fixed-term memberships once from verified payment time and stacks same-plan payments despite reversed callbacks', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
  const first = await prepaidPending('2027-01-01T00:00:00.000Z');
  vi.setSystemTime(new Date('2027-01-02T00:00:00.000Z'));
  const second = await prepaidPending('2027-01-02T00:00:00.000Z');
  expect(createCalls[0]!.params.mode).toBe('payment');
  expect(createCalls[0]!.params.invoice_creation?.enabled).toBe(true);
  paid(second.session);
  await event('checkout.session.completed', second.session.id);
  paid(first.session);
  await event('checkout.session.completed', first.session.id);
  await event('checkout.session.completed', first.session.id);
  const subs = core.business.subscriptions(actor, wid, {}).items;
  expect(subs).toHaveLength(2);
  expect(subs.find((s) => s.currentPeriodEnd === '2027-03-01T00:00:00.000Z')).toBeTruthy();
  expect(core.entitlements.effective(wid).limits.concurrency).toBe(4);
  expect(credits.account(wid).balance).toBe(1100);
  expect(db.sqlite.prepare('SELECT paid_at FROM orders WHERE id=?').get(first.order.id)).toEqual({
    paid_at: '2027-01-01T00:00:00.000Z',
  });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM prepaid_membership_purchases').get()).toEqual({
    n: 2,
  });
});
it('reverses only a refunded fixed-term purchase and its own credit lot, including refund arriving before fulfillment', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
  const first = await prepaidPending('2027-01-01T00:00:00.000Z'),
    second = await prepaidPending('2027-01-01T00:00:01.000Z');
  paid(second.session);
  await event('checkout.session.completed', second.session.id);
  paid(first.session);
  const refund = prepaidRefund(first.session, 9900);
  await event('charge.refunded', refund.id);
  await event('checkout.session.completed', first.session.id);
  await event('charge.refunded', refund.id);
  const lots = credits.buckets(wid);
  expect(lots.find((l) => l.sourceId === first.order.id)?.available).toBe(0);
  expect(lots.find((l) => l.sourceId === second.order.id)?.available).toBe(500);
  expect(credits.account(wid).balance).toBe(600);
  expect(
    core.business.subscriptions(actor, wid, {}).items.find((s) => s.status === 'active')
      ?.currentPeriodEnd,
  ).toBe('2027-02-01T00:00:01.000Z');
  expect(
    db.sqlite
      .prepare(
        'SELECT refunded_minor,reversed_credits FROM prepaid_membership_purchases WHERE order_id=?',
      )
      .get(first.order.id),
  ).toEqual({ refunded_minor: 9900, reversed_credits: 500 });
});
const renewalTerms = () => ({
  ...fixedTerms(),
  creditArchiveMonths: 3,
  creditValidity: 'same-plan-renewal',
});
it('restores same-plan archived credits, renews their archive deadline and never revives a fully refunded source', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
  const first = await prepaidPending('2027-01-01T00:00:00.000Z', renewalTerms());
  paid(first.session);
  await event('checkout.session.completed', first.session.id);
  const job = randomUUID(),
    item = randomUUID();
  credits.reserve(wid, actor.userId, 100, job, item);
  credits.finish(wid, actor.userId, 100, job, item, true);
  vi.setSystemTime(new Date('2027-02-10T00:00:00.000Z'));
  expect(credits.buckets(wid).find((l) => l.sourceId === first.order.id)).toMatchObject({
    archived: 400,
    archiveUntil: '2027-05-01T00:00:00.000Z',
  });
  const second = await prepaidPending('2027-02-10T00:00:00.000Z', renewalTerms());
  paid(second.session);
  await event('checkout.session.completed', second.session.id);
  expect(credits.buckets(wid).find((l) => l.sourceId === first.order.id)).toMatchObject({
    available: 400,
    expiresAt: '2027-03-10T00:00:00.000Z',
    archiveUntil: '2027-06-10T00:00:00.000Z',
  });
  const refunded = prepaidRefund(first.session, 9900);
  await event('charge.refunded', refunded.id);
  const third = await prepaidPending('2027-02-10T00:00:01.000Z', renewalTerms());
  paid(third.session);
  await event('checkout.session.completed', third.session.id);
  expect(credits.buckets(wid).find((l) => l.sourceId === first.order.id)).toMatchObject({
    remaining: 0,
    available: 0,
    status: 'expired',
  });
  expect(credits.account(wid).balance).toBe(1100);
});
it('removes refunded archived amounts without taking another source and restores only the remainder on renewal', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
  const first = await prepaidPending('2027-01-01T00:00:00.000Z', renewalTerms());
  paid(first.session);
  await event('checkout.session.completed', first.session.id);
  vi.setSystemTime(new Date('2027-02-10T00:00:00.000Z'));
  expect(credits.account(wid).balance).toBe(100);
  const refunded = prepaidRefund(first.session, 4950);
  await event('charge.refunded', refunded.id);
  expect(credits.account(wid).balance).toBe(100);
  expect(credits.buckets(wid).find((l) => l.sourceId === first.order.id)?.archived).toBe(250);
  const second = await prepaidPending('2027-02-10T00:00:00.000Z', renewalTerms());
  paid(second.session);
  await event('checkout.session.completed', second.session.id);
  expect(credits.buckets(wid).find((l) => l.sourceId === first.order.id)?.available).toBe(250);
  expect(credits.account(wid).balance).toBe(850);
});
it.each([
  ['2027-04-30T00:00:00.000Z', 500],
  ['2027-05-02T00:00:00.000Z', 0],
] as const)(
  'uses actual renewal payment time %s against the three-month archival cutoff even for late callbacks',
  async (paidAt, restored) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const first = await prepaidPending('2027-01-01T00:00:00.000Z', renewalTerms());
    paid(first.session);
    await event('checkout.session.completed', first.session.id);
    vi.setSystemTime(new Date(paidAt));
    const renewal = await prepaidPending(paidAt, renewalTerms());
    vi.setSystemTime(new Date('2027-05-03T00:00:00.000Z'));
    expect(credits.buckets(wid).find((l) => l.sourceId === first.order.id)?.status).toBe('expired');
    paid(renewal.session);
    await event('checkout.session.completed', renewal.session.id);
    expect(credits.buckets(wid).find((l) => l.sourceId === first.order.id)?.available).toBe(
      restored,
    );
    expect(credits.account(wid).balance).toBe(600 + restored);
  },
);
it.each([false, true])(
  'reclaims only failed refunded reservations; successful=%s keeps the attributable debt',
  async (success) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const value = await prepaidPending('2027-01-01T00:00:00.000Z', renewalTerms());
    paid(value.session);
    await event('checkout.session.completed', value.session.id);
    const job = randomUUID(),
      item = randomUUID();
    credits.reserve(wid, actor.userId, 400, job, item);
    await event('charge.refunded', prepaidRefund(value.session, 4950).id);
    expect(
      db.sqlite
        .prepare('SELECT debt_credits FROM prepaid_membership_purchases WHERE order_id=?')
        .get(value.order.id),
    ).toEqual({ debt_credits: 150 });
    credits.finish(wid, actor.userId, 400, job, item, success);
    credits.finish(wid, actor.userId, 400, job, item, success);
    expect(
      db.sqlite
        .prepare('SELECT debt_credits FROM prepaid_membership_purchases WHERE order_id=?')
        .get(value.order.id),
    ).toEqual({ debt_credits: success ? 150 : 0 });
    expect(credits.account(wid)).toEqual({ balance: success ? 100 : 350, reserved: 0 });
  },
);
it('does not charge released reservations again after an audited manual repayment has cleared their debt', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
  const value = await prepaidPending('2027-01-01T00:00:00.000Z', renewalTerms());
  paid(value.session);
  await event('checkout.session.completed', value.session.id);
  const job = randomUUID(),
    item = randomUUID();
  credits.reserve(wid, actor.userId, 400, job, item);
  await event('charge.refunded', prepaidRefund(value.session, 4950).id);
  credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'manual-repayment',
    source: 'manual',
    amount: 150,
    description: 'Explicit local repayment fixture',
  });
  const risks = db.sqlite
    .prepare("SELECT id FROM billing_risks WHERE workspace_id=? AND status='review_required'")
    .all(wid) as { id: string }[];
  createBillingAdmin(db).resolveRisks({
    actorUserId: actor.userId,
    workspaceId: wid,
    riskIds: risks.map((r) => r.id),
    reason:
      'Operator has reviewed exact original refund sources and approved this local repayment fixture.',
    evidenceReference: 'fixture: repayment before failed task',
    confirmedManuallyHandled: true,
    creditsToRevoke: 150,
  });
  credits.finish(wid, actor.userId, 400, job, item, false);
  expect(credits.account(wid)).toEqual({ balance: 500, reserved: 0 });
  expect(credits.buckets(wid).find((l) => l.sourceId === value.order.id)?.available).toBe(400);
  expect(
    db.sqlite
      .prepare('SELECT debt_credits FROM prepaid_membership_purchases WHERE order_id=?')
      .get(value.order.id),
  ).toEqual({ debt_credits: 0 });
});
it('keeps incomplete refund evidence for review without inventing a fixed-term reversal', async () => {
  const value = await prepaidPending(new Date(Math.floor(Date.now() / 1000) * 1000).toISOString());
  paid(value.session);
  await event('checkout.session.completed', value.session.id);
  const charge = chargeSchema.parse({
    id: 'ch_unknown_prepaid',
    payment_intent: value.session.payment_intent,
    amount: 9900,
    amount_refunded: 9900,
    refunded: true,
  });
  charges.set(charge.id, charge);
  await event('charge.refunded', charge.id);
  expect(
    db.sqlite
      .prepare('SELECT refunded_minor FROM prepaid_membership_purchases WHERE order_id=?')
      .get(value.order.id),
  ).toEqual({ refunded_minor: 0 });
  expect(
    db.sqlite
      .prepare('SELECT payment_review_required FROM workspace_billing WHERE workspace_id=?')
      .get(wid),
  ).toEqual({ payment_review_required: 1 });
  // Full refund is visible but the actual completed time has not been established.
  db.sqlite.prepare("UPDATE orders SET payment_environment='live' WHERE id=?").run(value.order.id);
  expect(createPrepaidMemberships(db).activeAt(actor.userId, new Date().toISOString())).toBe(
    'unknown',
  );
});
it('freezes a timed first-purchase price, prevents competing checkouts and grants only after the paid receipt is verified', async () => {
  const current = Date.now(),
    p = promotionSchema.parse({
      id: randomUUID(),
      version: 1,
      name: 'Test offer',
      enabled: true,
      startsAt: new Date(current - 3600000).toISOString(),
      endsAt: new Date(current + 7200000).toISOString(),
      timeZone: 'UTC',
      qualificationTime: 'checkout-start',
      priceMinor: 700,
      eligibility: 'first-personal-membership',
      refundedPurchasesCount: true,
      evidenceReference: 'Explicit test-only campaign policy',
    });
  db.sqlite.prepare('UPDATE plans SET promotion_json=? WHERE id=?').run(JSON.stringify(p), planId);
  const first = await prepaidPending(new Date(Math.floor(current / 1000) * 1000).toISOString());
  expect(first.order.amountMinor).toBe(700);
  expect(createCalls[0]!.params.expires_at).toBe(Math.floor(Date.parse(p.endsAt) / 1000));
  const second = core.business.createOrder(actor, wid, { planId, expectedAmountMinor: 700 });
  await expect(billing.checkout(actor, wid, second.id)).rejects.toMatchObject({
    code: 'PROMOTION_PENDING',
  });
  paid(first.session);
  first.session.invoice = null;
  await expect(event('checkout.session.completed', first.session.id)).rejects.toMatchObject({
    code: 'PREPAID_RECEIPT_PENDING',
  });
  expect(credits.account(wid).balance).toBe(100);
  first.session.invoice = first.receipt.id;
  await event('checkout.session.completed', first.session.id);
  expect(
    db.sqlite.prepare('SELECT status FROM promotion_claims WHERE order_id=?').get(first.order.id),
  ).toEqual({ status: 'consumed' });
  expect(
    core.business.plans({}, actor, wid).items.find((x) => x.id === planId)?.promotion?.status,
  ).toBe('ineligible');
  expect(() => core.business.createOrder(actor, wid, { planId, expectedAmountMinor: 700 })).toThrow(
    /价格或优惠资格/,
  );
});

it('honors an explicitly configured checkout-start offer when its original asynchronous payment completes after the campaign', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
  const p = promotionSchema.parse({
    id: randomUUID(),
    version: 1,
    name: 'Checkout-start fixture',
    enabled: true,
    startsAt: '2026-12-31T00:00:00Z',
    endsAt: '2027-01-01T02:00:00Z',
    timeZone: 'UTC',
    qualificationTime: 'checkout-start',
    priceMinor: 700,
    eligibility: 'all',
    evidenceReference: 'Explicit checkout-start policy fixture',
  });
  db.sqlite.prepare('UPDATE plans SET promotion_json=? WHERE id=?').run(JSON.stringify(p), planId);
  const original = await prepaidPending('2027-01-02T00:00:00.000Z');
  vi.setSystemTime(new Date('2027-01-02T00:00:00.000Z'));
  expect(() => core.business.createOrder(actor, wid, { planId, expectedAmountMinor: 700 })).toThrow(
    /价格或优惠资格/,
  );
  paid(original.session);
  await event('checkout.session.async_payment_succeeded', original.session.id);
  expect(core.business.getOrder(actor, wid, original.order.id)).toMatchObject({
    status: 'paid',
    amountMinor: 700,
    paidAt: '2027-01-02T00:00:00.000Z',
  });
  expect(credits.account(wid).balance).toBe(600);
});
it('blocks competing prepaid tiers before payment and preserves the first checkout response identity after a network loss', async () => {
  const value = await prepaidPending(new Date(Math.floor(Date.now() / 1000) * 1000).toISOString());
  const otherId = randomUUID();
  db.sqlite
    .prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,prepaid_terms_json) VALUES(?,'Other tier','subscription',12000,'USD','month',900,'{}',?)",
    )
    .run(otherId, JSON.stringify(fixedTerms()));
  expect(() => core.business.createOrder(actor, wid, { planId: otherId })).toThrow(/其他档位/);
  // Same-tier repeat is allowed; simulate a provider result reaching the server but losing the response.
  const next = core.business.createOrder(actor, wid, { planId });
  const original = gateway.createCheckout;
  let lost: CheckoutSession | undefined;
  let calls = 0;
  gateway.createCheckout = async (params, key) => {
    calls++;
    if (lost) return lost;
    lost = await original(params, key);
    throw new Error('isolated response loss');
  };
  await expect(billing.checkout(actor, wid, next.id)).rejects.toMatchObject({
    code: 'PAYMENT_PROVIDER_ERROR',
  });
  const recovered = await billing.checkout(actor, wid, next.id);
  expect(recovered.orderId).toBe(next.id);
  expect(calls).toBe(2);
  expect(
    db.sqlite.prepare('SELECT COUNT(*) n FROM stripe_checkouts WHERE order_id=?').get(next.id),
  ).toEqual({ n: 1 });
  expect(createCalls.filter((c) => c.params.client_reference_id === next.id)).toHaveLength(1);
  expect(value.session.mode).toBe('payment');
});
it('does not resolve prepaid reversal debt for zero credits, then audits and clears only the selected purchase debt', async () => {
  const value = await prepaidPending(new Date(Math.floor(Date.now() / 1000) * 1000).toISOString());
  paid(value.session);
  await event('checkout.session.completed', value.session.id);
  const job = randomUUID(),
    item = randomUUID();
  credits.reserve(wid, actor.userId, 400, job, item);
  credits.finish(wid, actor.userId, 400, job, item, true);
  const charge = prepaidRefund(value.session, 9900);
  await event('charge.refunded', charge.id);
  const debt = db.sqlite
    .prepare('SELECT debt_credits FROM prepaid_membership_purchases WHERE order_id=?')
    .get(value.order.id) as { debt_credits: number };
  expect(debt.debt_credits).toBe(400);
  const risks = db.sqlite
    .prepare("SELECT id FROM billing_risks WHERE workspace_id=? AND status='review_required'")
    .all(wid) as { id: string }[];
  const admin = createBillingAdmin(db),
    resolution = {
      actorUserId: actor.userId,
      workspaceId: wid,
      riskIds: risks.map((r) => r.id),
      reason: 'Explicit isolated prepaid debt reconciliation test',
      evidenceReference: 'fixture: consumed source verified',
      confirmedManuallyHandled: true,
    };
  expect(() => admin.resolveRisks({ ...resolution, creditsToRevoke: 0 })).toThrow(/冲正数/);
  credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'debt-repayment-fixture',
    amount: 400,
    source: 'manual',
    description: 'Explicit local fixture repayment',
  });
  admin.resolveRisks({ ...resolution, creditsToRevoke: 400 });
  expect(
    db.sqlite
      .prepare('SELECT debt_credits FROM prepaid_membership_purchases WHERE order_id=?')
      .get(value.order.id),
  ).toEqual({ debt_credits: 0 });
  expect(
    db.sqlite
      .prepare('SELECT payment_review_required FROM workspace_billing WHERE workspace_id=?')
      .get(wid),
  ).toEqual({ payment_review_required: 0 });
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
    status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
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
    const other = core.auth.createWorkspace(actor.userId, 'Other', 'team');
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
  it('persists individual refund timestamps without backdating observed success to the webhook', async () => {
    const { session, order } = await pendingOrder();
    paid(session);
    await event('checkout.session.completed', session.id);
    const created = Math.floor(Date.now() / 1000) - 100;
    const charge = chargeSchema.parse({
      id: 'ch_refund_facts',
      payment_intent: session.payment_intent,
      currency: 'usd',
      refunded: true,
      amount_refunded: 9900,
      amount: 9900,
      refunds: {
        has_more: false,
        data: [
          {
            id: 're_partial',
            charge: 'ch_refund_facts',
            payment_intent: session.payment_intent,
            amount: 4000,
            currency: 'usd',
            created,
            status: 'succeeded',
          },
          {
            id: 're_final',
            charge: 'ch_refund_facts',
            payment_intent: session.payment_intent,
            amount: 5900,
            currency: 'usd',
            created: created + 90,
            status: 'succeeded',
          },
        ],
      },
    });
    charges.set(charge.id, charge);
    await event('charge.refunded', charge.id);
    expect(
      db.sqlite.prepare('SELECT order_id,complete FROM billing_refund_collections').get(),
    ).toEqual({ order_id: order.id, complete: 1 });
    const facts = db.sqlite
      .prepare(
        'SELECT order_id,refund_created_at,first_succeeded_observed_at FROM billing_refund_facts ORDER BY refund_created_at',
      )
      .all() as {
      order_id: string;
      refund_created_at: string;
      first_succeeded_observed_at: string;
    }[];
    expect(facts).toHaveLength(2);
    expect(
      facts.every(
        (fact) =>
          fact.order_id === order.id && fact.first_succeeded_observed_at > fact.refund_created_at,
      ),
    ).toBe(true);
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
  closeDatabase(db);
  await rm(temp, { recursive: true, force: true });
  await setupBilling('live');
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

it('freezes the billed invoice period and actual paid time when the live subscription has advanced', async () => {
  const { order, sub } = await subscriptionOrder();
  const bill = invoice(sub);
  bill.status_transitions!.paid_at! -= 3600;
  const expectedEnd = new Date(bill.lines.data[0]!.period.end * 1000).toISOString();
  const expectedPaid = new Date(bill.status_transitions!.paid_at! * 1000).toISOString();
  sub.items.data[0]!.current_period_start = sub.items.data[0]!.current_period_end;
  sub.items.data[0]!.current_period_end += 30 * 86400;
  await event('invoice.paid', bill.id);
  expect(credits.buckets(wid).find((lot) => lot.sourceId === order.id)?.expiresAt).toBe(
    expectedEnd,
  );
  expect(db.sqlite.prepare('SELECT paid_at FROM orders WHERE id=?').get(order.id)).toEqual({
    paid_at: expectedPaid,
  });
  expect(
    db.sqlite
      .prepare('SELECT period_end,paid_at FROM billing_periods WHERE order_id=?')
      .get(order.id),
  ).toEqual({ period_end: expectedEnd, paid_at: expectedPaid });
  const balance = credits.account(wid);
  await event('invoice.paid', bill.id);
  expect(credits.account(wid)).toEqual(balance);
});
it('requires invoice payment-time evidence before granting, without substituting receipt time', async () => {
  const { order, sub } = await subscriptionOrder();
  const bill = invoice(sub);
  bill.status_transitions = undefined;
  await expect(event('invoice.paid', bill.id)).rejects.toMatchObject({
    code: 'INVOICE_PERIOD_EVIDENCE_MISSING',
  });
  expect(credits.account(wid)).toEqual({ balance: 100, reserved: 0 });
  expect(
    db.sqlite.prepare('SELECT 1 FROM billing_periods WHERE order_id=?').get(order.id),
  ).toBeUndefined();
});

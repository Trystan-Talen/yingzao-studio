/** Independent local financial regressions. No payment provider is called. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createCreditService } from '../src/server/tasks/credits';
import { createBillingStore } from '../src/server/billing/store';
import { createPrepaidMemberships } from '../src/server/billing/prepaid';
import { createRefundEvidence } from '../src/server/billing/refund-evidence';
import { chargeSchema, checkoutSchema } from '../src/server/billing/stripe-gateway';
import { createBillingService } from '../src/server/billing';
import { createBillingAdmin } from '../src/server/billing/admin';
import type { Actor } from '../src/contracts/core';
import type { PrepaidTerms } from '../src/contracts/promotions';
let db: ReturnType<typeof createDatabaseContext>,
  core: ReturnType<typeof createCoreServices>,
  credits: ReturnType<typeof createCreditService>,
  store: ReturnType<typeof createBillingStore>,
  actor: Actor,
  wid: string,
  planId: string;
const terms: PrepaidTerms = {
  months: 1,
  audience: 'personal',
  stacking: 'same-plan',
  timeBasis: 'utc-calendar-month',
  refundPolicy: 'proportional-duration',
  creditArchiveMonths: 0,
  creditValidity: 'purchase-period',
};
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  db = createDatabaseContext(':memory:');
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  credits = createCreditService(db);
  core = createCoreServices(
    db,
    {
      storageDir: '/tmp/unused-promotion-review',
      publicOrigin: 'http://127.0.0.1:5174',
      sessionSecret: 'fixture',
      demoMode: false,
    } as never,
    { onWorkspaceCreated: (w, u) => credits.initialize(w, u, 0) },
  );
  const user = await core.auth.register({
    email: 'review@example.local',
    password: 'PromotionReview2026!',
    displayName: 'Review fixture',
  });
  actor = {
    userId: user.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = user.workspace.id;
  planId = randomUUID();
  db.sqlite
    .prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,prepaid_terms_json) VALUES(?,'Independent fixed-term fixture','subscription',100,'USD','month',100,?,?)",
    )
    .run(planId, JSON.stringify({ concurrency: 4 }), JSON.stringify(terms));
  store = createBillingStore(db, core, credits);
});
afterEach(() => {
  closeDatabase(db);
  vi.useRealTimers();
});
function purchase(paidAt: string, environment: 'test' | 'live' = 'live') {
  const order = core.business.createOrder(actor, wid, { planId });
  db.sqlite
    .transaction(() => {
      db.sqlite
        .prepare('UPDATE orders SET payment_environment=?,provider_payment_intent_id=? WHERE id=?')
        .run(environment, `pi_${order.id}`, order.id);
      store.grant(store.order(order.id), `checkout:${order.id}`, 100, { paidAt });
    })
    .immediate();
  return order.id;
}
function useRenewalTerms() {
  db.sqlite
    .prepare('UPDATE plans SET prepaid_terms_json=? WHERE id=?')
    .run(
      JSON.stringify({ ...terms, creditArchiveMonths: 3, creditValidity: 'same-plan-renewal' }),
      planId,
    );
}
function refundPurchase(orderId: string, amount: number, key = randomUUID()) {
  const charge = chargeSchema.parse({
    id: `ch_${orderId}`,
    payment_intent: `pi_${orderId}`,
    currency: 'usd',
    amount: 100,
    amount_refunded: amount,
    refunded: amount === 100,
    refunds: {
      has_more: false,
      data: [
        {
          id: `re_${key}`,
          charge: `ch_${orderId}`,
          payment_intent: `pi_${orderId}`,
          amount,
          currency: 'usd',
          created: Date.now() / 1000,
          status: 'succeeded',
        },
      ],
    },
  });
  return db.sqlite
    .transaction(() => {
      createRefundEvidence(db).record(charge, orderId);
      db.sqlite
        .prepare('UPDATE orders SET refunded_minor=?,status=? WHERE id=?')
        .run(amount, amount === 100 ? 'refunded' : 'paid', orderId);
      return createPrepaidMemberships(db).refund(orderId, key);
    })
    .immediate();
}

it('restores only an archived source remainder over repeated renewal and expiry cycles', () => {
  useRenewalTerms();
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  const first = purchase('2026-10-01T00:00:00.000Z');
  vi.setSystemTime(new Date('2026-11-10T00:00:00.000Z'));
  expect(credits.account(wid).balance).toBe(0);
  refundPurchase(first, 50);
  expect(credits.buckets(wid).find((b) => b.sourceId === first)?.archived).toBe(50);
  const second = purchase('2026-11-10T00:00:00.000Z');
  expect(credits.account(wid).balance).toBe(150);
  vi.setSystemTime(new Date('2026-12-15T00:00:00.000Z'));
  expect(credits.account(wid).balance).toBe(0);
  purchase('2026-12-15T00:00:00.000Z');
  expect(credits.account(wid).balance).toBe(250);
  expect(credits.buckets(wid).find((b) => b.sourceId === first)?.available).toBe(50);
  expect(credits.buckets(wid).find((b) => b.sourceId === second)?.available).toBe(100);
  expect(credits.account(wid).balance).toBe(250);
});

it('does not keep refundable reservation debt after a failed job has destroyed the original source', () => {
  useRenewalTerms();
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  const first = purchase('2026-10-01T00:00:00.000Z'),
    job = randomUUID(),
    item = randomUUID();
  credits.reserve(wid, actor.userId, 40, job, item);
  vi.setSystemTime(new Date('2026-11-10T00:00:00.000Z'));
  expect(credits.account(wid)).toEqual({ balance: 40, reserved: 40 });
  refundPurchase(first, 100);
  credits.finish(wid, actor.userId, 40, job, item, false);
  expect(credits.account(wid)).toEqual({ balance: 0, reserved: 0 });
  expect(credits.buckets(wid).find((b) => b.sourceId === first)?.remaining).toBe(0);
  expect(
    db.sqlite
      .prepare('SELECT debt_credits FROM prepaid_membership_purchases WHERE order_id=?')
      .get(first),
  ).toEqual({ debt_credits: 0 });
});
it('shortens remaining later-purchase credit validity when refunding an earlier stacked purchase', () => {
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  const earlier = purchase('2026-10-01T00:00:00.000Z');
  vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  const later = purchase('2026-10-20T00:00:00.000Z');
  const refund = chargeSchema.parse({
    id: 'ch_earlier',
    payment_intent: `pi_${earlier}`,
    currency: 'usd',
    amount: 100,
    amount_refunded: 100,
    refunded: true,
    refunds: {
      has_more: false,
      data: [
        {
          id: 're_earlier',
          charge: 'ch_earlier',
          payment_intent: `pi_${earlier}`,
          amount: 100,
          currency: 'usd',
          created: Date.now() / 1000,
          status: 'succeeded',
        },
      ],
    },
  });
  db.sqlite
    .transaction(() => {
      createRefundEvidence(db).record(refund, earlier);
      db.sqlite
        .prepare("UPDATE orders SET refunded_minor=100,status='refunded' WHERE id=?")
        .run(earlier);
      createPrepaidMemberships(db).refund(earlier, 'refund-fixture');
    })
    .immediate();
  expect(
    db.sqlite
      .prepare(
        "SELECT current_period_end FROM subscriptions WHERE source_order_id=? AND provider_id='stripe-prepaid'",
      )
      .get(later),
  ).toEqual({ current_period_end: '2026-11-20T00:00:00.000Z' });
  expect(
    db.sqlite.prepare('SELECT expires_at FROM credit_lots WHERE source_id=?').get(later),
  ).toEqual({ expires_at: '2026-11-20T00:00:00.000Z' });
  vi.setSystemTime(new Date('2026-11-25T00:00:00.000Z'));
  expect(credits.account(wid).balance).toBe(0);
});
it('makes purchased fixed-term concurrency usable by the worker rather than leaving the old workspace cap', () => {
  purchase('2026-10-20T00:00:00.000Z');
  expect(core.entitlements.effective(wid).limits.concurrency).toBe(4);
  expect(
    db.sqlite
      .prepare('SELECT concurrency_limit FROM workspace_billing WHERE workspace_id=?')
      .get(wid),
  ).toEqual({ concurrency_limit: 4 });
});

it('validates preserved promotion fields against a changed catalog price and purchase mode', () => {
  const admin = createBillingAdmin(db),
    base = {
      id: planId,
      name: 'Catalog review fixture',
      kind: 'subscription' as const,
      priceMinor: 100,
      currency: 'USD',
      credits: 100,
      interval: 'month' as const,
    };
  const save = (plan: unknown) =>
    admin.importPlans({
      actorUserId: actor.userId,
      reason: 'Explicit isolated catalog consistency verification',
      version: 1,
      confirmCommercialCatalog: true,
      plans: [plan],
    });
  save({
    ...base,
    prepaidTerms: terms,
    promotion: {
      id: randomUUID(),
      version: 1,
      name: 'Fixture offer',
      enabled: true,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z',
      timeZone: 'UTC',
      priceMinor: 70,
      eligibility: 'all',
      refundedPurchasesCount: null,
      evidenceReference: 'fixture: explicit local rule',
      qualificationTime: 'checkout-start',
    },
  });
  expect(() => save({ ...base, priceMinor: 50 })).toThrow();
  expect(() => save({ ...base, prepaidTerms: null })).toThrow();
});

it('blocks a new recurring checkout while a prepaid membership checkout is still unresolved', async () => {
  const recurringId = randomUUID();
  db.sqlite
    .prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits) VALUES(?,'Recurring fixture','subscription',100,'USD','month',100)",
    )
    .run(recurringId);
  const first = core.business.createOrder(actor, wid, { planId }),
    second = core.business.createOrder(actor, wid, { planId: recurringId });
  let calls = 0;
  const billing = createBillingService(
    db,
    core,
    {
      billing: { stripeSecretKey: 'sk_test_fixture', stripeWebhookSecret: 'whsec_fixture' },
      demoMode: false,
      publicOrigin: 'http://127.0.0.1:5174',
    } as never,
    credits,
    {
      createCheckout: async (params: {
        mode: string;
        metadata: Record<string, string>;
        client_reference_id: string;
      }) => {
        const id = `cs_review_${++calls}`;
        return checkoutSchema.parse({
          id,
          mode: params.mode,
          metadata: params.metadata,
          client_reference_id: params.client_reference_id,
          payment_status: 'unpaid',
          status: 'open',
          amount_total: 100,
          currency: 'usd',
          url: `https://checkout.stripe.com/c/pay/${id}`,
          expires_at: Date.now() / 1000 + 1800,
          payment_intent: null,
          subscription: null,
          customer: null,
        });
      },
    } as never,
  );
  await billing.checkout(actor, wid, first.id);
  await expect(billing.checkout(actor, wid, second.id)).rejects.toMatchObject({
    code: 'SUBSCRIPTION_EXISTS',
  });
  expect(calls).toBe(1);
});

it('keeps retrospective fixed-term eligibility unknown between refund creation and observed success', () => {
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  const earlier = purchase('2026-10-01T00:00:00.000Z');
  vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  purchase('2026-10-20T00:00:00.000Z');
  vi.setSystemTime(new Date('2026-12-10T00:00:00.000Z'));
  const refund = chargeSchema.parse({
    id: 'ch_history',
    payment_intent: `pi_${earlier}`,
    currency: 'usd',
    amount: 100,
    amount_refunded: 100,
    refunded: true,
    refunds: {
      has_more: false,
      data: [
        {
          id: 're_history',
          charge: 'ch_history',
          payment_intent: `pi_${earlier}`,
          amount: 100,
          currency: 'usd',
          created: Date.parse('2026-11-10T00:00:00.000Z') / 1000,
          status: 'succeeded',
        },
      ],
    },
  });
  db.sqlite
    .transaction(() => {
      createRefundEvidence(db).record(refund, earlier);
      db.sqlite
        .prepare("UPDATE orders SET refunded_minor=100,status='refunded' WHERE id=?")
        .run(earlier);
      createPrepaidMemberships(db).refund(earlier, 'history-fixture');
    })
    .immediate();
  const service = createPrepaidMemberships(db);
  expect(service.activeAt(actor.userId, '2026-11-05T00:00:00.000Z')).toBe('active');
  expect(service.activeAt(actor.userId, '2026-11-25T00:00:00.000Z')).toBe('unknown');
  expect(service.activeAt(actor.userId, '2026-12-11T00:00:00.000Z')).toBe('inactive');
});

const liveService = () =>
  createBillingService(
    db,
    core,
    {
      billing: { stripeSecretKey: 'sk_live_fixture', stripeWebhookSecret: 'whsec_fixture' },
      demoMode: false,
      publicOrigin: 'http://127.0.0.1:5174',
    } as never,
    credits,
    {} as never,
  );
it('rejects switching a test prepaid database to live and preserves its balance, membership and timeline', () => {
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  purchase('2026-10-01T00:00:00.000Z', 'test');
  const snapshot = () => ({
    balance: credits.account(wid),
    memberships: db.sqlite.prepare('SELECT * FROM subscriptions').all(),
    purchases: db.sqlite.prepare('SELECT * FROM prepaid_membership_purchases').all(),
    lots: db.sqlite.prepare('SELECT * FROM credit_lots').all(),
  });
  const before = snapshot();
  vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  expect(liveService).toThrow(expect.objectContaining({ code: 'PAYMENT_DATABASE_ENVIRONMENT' }));
  expect(() => purchase('2026-10-20T00:00:00.000Z', 'live')).toThrow(
    expect.objectContaining({ code: 'PAYMENT_DATABASE_ENVIRONMENT' }),
  );
  expect(snapshot()).toEqual(before);
});

it.each(['credits', 'automatic-subscription'] as const)(
  'rejects live startup over pre-binding legacy test %s payment facts',
  (kind) => {
    const subscription = kind === 'automatic-subscription';
    db.sqlite
      .prepare('UPDATE plans SET kind=?,interval=?,prepaid_terms_json=NULL WHERE id=?')
      .run(subscription ? 'subscription' : 'credits', subscription ? 'month' : null, planId);
    const order = core.business.createOrder(actor, wid, { planId });
    // Explicit legacy fixture, predating environment binding; do not call the new guarded store.
    db.sqlite
      .prepare("UPDATE orders SET status='paid',payment_environment='test',paid_at=? WHERE id=?")
      .run('2026-10-01T00:00:00.000Z', order.id);
    credits.grant({
      workspaceId: wid,
      userId: actor.userId,
      eventKey: `legacy:${order.id}`,
      amount: 100,
      source: subscription ? 'subscription' : 'pack',
      sourceId: order.id,
      expiresAt: '2026-11-01T00:00:00.000Z',
      archiveMonths: 0,
      description: 'Explicit pre-binding test payment fixture',
    });
    if (subscription)
      db.sqlite
        .prepare(
          "INSERT INTO subscriptions(id,workspace_id,plan_id,status,current_period_start,current_period_end,provider_id,created_at,updated_at,source_order_id) VALUES(?,?,?,'active',?,?,'stripe',?,?,?)",
        )
        .run(
          randomUUID(),
          wid,
          planId,
          '2026-10-01T00:00:00.000Z',
          '2026-11-01T00:00:00.000Z',
          '2026-10-01T00:00:00.000Z',
          '2026-10-01T00:00:00.000Z',
          order.id,
        );
    const before = credits.account(wid);
    expect(before.balance).toBe(100);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM billing_environment_binding').get()).toEqual({
      n: 0,
    });
    expect(liveService).toThrow(expect.objectContaining({ code: 'PAYMENT_DATABASE_ENVIRONMENT' }));
    expect(credits.account(wid)).toEqual(before);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM billing_environment_binding').get()).toEqual({
      n: 0,
    });
  },
);

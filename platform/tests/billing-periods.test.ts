import { createRefundEvidence } from '../src/server/billing/refund-evidence';
import { createPrepaidMemberships } from '../src/server/billing/prepaid';
import { chargeSchema } from '../src/server/billing/stripe-gateway';
import { it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createBillingPeriods, verifiedInvoicePeriod } from '../src/server/billing/periods';
import { invoiceSchema } from '../src/server/billing/stripe-gateway';
let db: ReturnType<typeof createDatabaseContext>, uid: string, wid: string, orderId: string;
const start = '2026-10-01T00:00:00.000Z',
  end = '2026-11-01T00:00:00.000Z';
beforeEach(async () => {
  db = createDatabaseContext(':memory:');
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  const core = createCoreServices(db, {
    storageDir: '/tmp/unused-period-fixture',
    sessionSecret: 'fixture',
    publicOrigin: 'http://127.0.0.1:5174',
    demoMode: false,
  } as never);
  const user = await core.auth.register({
    email: 'period@example.local',
    password: 'PeriodFixture2026!',
    displayName: 'Fixture',
  });
  uid = user.user.id;
  wid = user.workspace.id;
  orderId = randomUUID();
  db.sqlite
    .prepare(
      "INSERT INTO orders(id,workspace_id,number,kind,status,amount_minor,currency,plan_snapshot_json,created_by,created_at,updated_at,paid_at,payment_environment,billing_channel) VALUES(?,?,?,'subscription','paid',100,'USD','{}',?,?,?,?,'live','web')",
    )
    .run(orderId, wid, orderId, uid, start, start, start);
});
afterEach(() => closeDatabase(db));
function record() {
  const periods = createBillingPeriods(db);
  db.sqlite
    .transaction(() =>
      periods.record({
        orderId,
        invoiceId: 'in_old',
        subscriptionId: 'sub_existing',
        paidAt: start,
        periodStart: start,
        periodEnd: end,
      }),
    )
    .immediate();
  return periods;
}
it('uses immutable verified coverage rather than the later subscription status', () => {
  const periods = record();
  db.sqlite
    .transaction(() =>
      periods.recordEnding({ subscriptionId: 'sub_existing', endedAt: '2026-10-20T00:00:00.000Z' }),
    )
    .immediate();
  expect(periods.activeAt(uid, '2026-10-10T00:00:00.000Z')).toBe('active');
  expect(periods.activeAt(uid, '2026-10-21T00:00:00.000Z')).toBe('inactive');
  expect(periods.activeAt(randomUUID(), '2026-10-10T00:00:00.000Z')).toBe('inactive');
});
it('keeps legacy or missing termination evidence unknown and never guesses', () => {
  const periods = createBillingPeriods(db);
  expect(periods.activeAt(uid, '2026-10-10T00:00:00.000Z')).toBe('unknown');
  record();
  db.sqlite
    .transaction(() => periods.recordEnding({ subscriptionId: 'sub_existing', endedAt: null }))
    .immediate();
  expect(periods.activeAt(uid, '2026-10-10T00:00:00.000Z')).toBe('unknown');
});
it('rejects changes to an already verified invoice period and accepts exact replay', () => {
  const periods = record();
  expect(() => record()).not.toThrow();
  expect(() =>
    db.sqlite
      .transaction(() =>
        periods.record({
          orderId,
          invoiceId: 'in_old',
          subscriptionId: 'sub_existing',
          paidAt: start,
          periodStart: start,
          periodEnd: '2026-12-01T00:00:00.000Z',
        }),
      )
      .immediate(),
  ).toThrow();
  expect(periods.activeAt(uid, '2026-11-10T00:00:00.000Z')).toBe('inactive');
});
it('reads payment time and the billed service period from the verified invoice', () => {
  const invoice = invoiceSchema.parse({
    id: 'in_old',
    status: 'paid',
    amount_paid: 100,
    total: 100,
    currency: 'usd',
    billing_reason: 'subscription_create',
    status_transitions: { paid_at: Date.parse(start) / 1000 },
    parent: { subscription_details: { subscription: 'sub_existing' } },
    lines: {
      has_more: false,
      data: [
        {
          amount: 100,
          quantity: 1,
          period: { start: Date.parse(start) / 1000, end: Date.parse(end) / 1000 },
        },
      ],
    },
  });
  expect(verifiedInvoicePeriod(invoice)).toEqual({
    paidAt: start,
    periodStart: start,
    periodEnd: end,
  });
  expect(() => verifiedInvoicePeriod({ ...invoice, status_transitions: undefined })).toThrow();
});

it('does not reinterpret an early partial-refund event as the later full-refund time', () => {
  const periods = record();
  db.sqlite.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(orderId);
  db.sqlite
    .prepare("INSERT INTO stripe_events VALUES('evt_partial','charge.refunded','ch_current',?,?)")
    .run(Date.parse('2026-10-02T00:00:00.000Z') / 1000, '2026-10-10T00:00:00.000Z');
  // The handler retrieved a later, cumulatively fully-refunded charge for this old event.
  db.sqlite
    .prepare(
      "INSERT INTO billing_risks(id,provider_event_id,kind,order_id,workspace_id,amount_minor,created_at,billing_channel) VALUES(?,'evt_partial','charge.refunded',?,?,100,?,'web')",
    )
    .run(randomUUID(), orderId, wid, '2026-10-10T00:00:00.000Z');
  expect(periods.activeAt(uid, '2026-10-05T00:00:00.000Z')).toBe('unknown');
});

function refundSnapshot(complete = true) {
  return chargeSchema.parse({
    id: 'ch_latest',
    payment_intent: 'pi_latest',
    currency: 'usd',
    amount: 100,
    amount_refunded: 100,
    refunded: true,
    refunds: {
      has_more: !complete,
      data: [
        {
          id: 're_partial',
          charge: 'ch_latest',
          payment_intent: 'pi_latest',
          amount: 40,
          currency: 'usd',
          created: Date.parse('2026-10-02T00:00:00.000Z') / 1000,
          status: 'succeeded',
        },
        {
          id: 're_final',
          charge: 'ch_latest',
          payment_intent: 'pi_latest',
          amount: 60,
          currency: 'usd',
          created: Date.parse('2026-10-08T00:00:00.000Z') / 1000,
          status: 'succeeded',
        },
      ],
    },
  });
}
it('uses per-refund creation and confirmed-observation bounds, not the old webhook time', () => {
  const periods = record();
  db.sqlite
    .prepare(
      "UPDATE orders SET status='refunded',provider_payment_intent_id='pi_latest' WHERE id=?",
    )
    .run(orderId);
  const evidence = createRefundEvidence(db, () => '2026-10-10T00:00:00.000Z');
  db.sqlite.transaction(() => evidence.record(refundSnapshot(), orderId)).immediate();
  expect(periods.activeAt(uid, '2026-10-05T00:00:00.000Z')).toBe('active');
  // A refund record's creation time does not prove when it succeeded.
  expect(periods.activeAt(uid, '2026-10-09T00:00:00.000Z')).toBe('unknown');
  expect(periods.activeAt(uid, '2026-10-11T00:00:00.000Z')).toBe('inactive');
});
it('links early refund evidence later and keeps incomplete lists unknown', () => {
  const periods = record(),
    evidence = createRefundEvidence(db, () => '2026-10-10T00:00:00.000Z');
  db.sqlite.transaction(() => evidence.record(refundSnapshot())).immediate();
  db.sqlite
    .prepare(
      "UPDATE orders SET status='refunded',provider_payment_intent_id='pi_latest' WHERE id=?",
    )
    .run(orderId);
  db.sqlite.transaction(() => evidence.link(orderId, 'pi_latest')).immediate();
  expect(periods.activeAt(uid, '2026-10-05T00:00:00.000Z')).toBe('active');
  db.sqlite.transaction(() => evidence.record(refundSnapshot(false), orderId)).immediate();
  expect(periods.activeAt(uid, '2026-10-05T00:00:00.000Z')).toBe('unknown');
});

it('includes fixed-term historical coverage and does not misclassify expired prepaid facts as unknown legacy invoices', () => {
  const planId = randomUUID();
  db.sqlite
    .prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency) VALUES(?,'Fixed term fixture','subscription',100,'USD')",
    )
    .run(planId);
  db.sqlite.prepare('UPDATE orders SET plan_id=? WHERE id=?').run(planId, orderId);
  db.sqlite
    .transaction(() =>
      createPrepaidMemberships(db).prepare(orderId, start, {
        months: 1,
        audience: 'personal',
        stacking: 'same-plan',
        timeBasis: 'utc-calendar-month',
        refundPolicy: 'proportional-duration',
        creditArchiveMonths: 0,
        creditValidity: 'purchase-period',
      }),
    )
    .immediate();
  const periods = createBillingPeriods(db);
  expect(periods.activeAt(uid, '2026-10-10T00:00:00.000Z')).toBe('active');
  expect(periods.activeAt(uid, '2026-11-02T00:00:00.000Z')).toBe('inactive');
});

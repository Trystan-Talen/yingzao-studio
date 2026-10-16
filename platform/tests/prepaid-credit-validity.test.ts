/** Real local accounting; no remote payment is performed. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createCreditService } from '../src/server/tasks/credits';
import { createBillingStore } from '../src/server/billing/store';
import type { Actor } from '../src/contracts/core';
let db: ReturnType<typeof createDatabaseContext>,
  credits: ReturnType<typeof createCreditService>,
  wid: string,
  uid: string,
  orderId: string,
  lotId: string;
const at = (value: string) => vi.setSystemTime(new Date(value));
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2027-01-01T00:00:00.000Z');
  db = createDatabaseContext(':memory:');
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  credits = createCreditService(db);
  const core = createCoreServices(
    db,
    {
      storageDir: '/tmp/unused-prepaid-credit-test',
      sessionSecret: 'test',
      publicOrigin: 'http://127.0.0.1:5174',
      isProduction: false,
      demoMode: false,
    },
    { onWorkspaceCreated: (w, u) => credits.initialize(w, u, 0) },
  );
  const result = await core.auth.register({
    email: 'prepaid-credit@example.local',
    password: 'TestPassword2026!',
    displayName: 'Test fixture',
  });
  wid = result.workspace.id;
  uid = result.user.id;
  const actor: Actor = {
      userId: uid,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    planId = randomUUID();
  db.sqlite
    .prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,prepaid_terms_json) VALUES(?,'Accounting fixture','subscription',100,'USD','month',100,?)",
    )
    .run(
      planId,
      JSON.stringify({
        months: 1,
        audience: 'personal',
        stacking: 'same-plan',
        timeBasis: 'utc-calendar-month',
        refundPolicy: 'proportional-duration',
        creditArchiveMonths: 0,
        creditValidity: 'purchase-period',
      }),
    );
  orderId = core.business.createOrder(actor, wid, { planId }).id;
  db.sqlite.prepare("UPDATE orders SET payment_environment='test' WHERE id=?").run(orderId);
  const store = createBillingStore(db, core, credits);
  db.sqlite
    .transaction(() =>
      store.grant(store.order(orderId), `payment:${orderId}`, 100, {
        paidAt: new Date().toISOString(),
      }),
    )
    .immediate();
  lotId = (
    db.sqlite
      .prepare('SELECT credit_lot_id FROM prepaid_membership_purchases WHERE order_id=?')
      .get(orderId) as { credit_lot_id: string }
  ).credit_lot_id;
});
afterEach(() => {
  closeDatabase(db);
  vi.useRealTimers();
});
function validity(expiresAt: string, eventKey: string) {
  return credits.reconcilePrepaidValidity({
    workspaceId: wid,
    userId: uid,
    orderId,
    lotId,
    expiresAt,
    eventKey,
    active: true,
  });
}
function reverse(targetReversed: number, eventKey: string) {
  return credits.revokePrepaid({
    workspaceId: wid,
    userId: uid,
    orderId,
    lotId,
    targetReversed,
    eventKey,
    description: 'Verified local refund fixture',
  });
}
function consume(amount: number, finish: boolean) {
  const job = randomUUID(),
    item = randomUUID();
  credits.reserve(wid, uid, amount, job, item);
  if (finish) credits.finish(wid, uid, amount, job, item, true);
  return { job, item, amount };
}
it('reverses restored valid credits instead of counting their earlier expiry twice', () => {
  consume(20, true);
  const held = consume(10, false);
  at('2027-02-02T00:00:00.000Z');
  expect(credits.account(wid)).toEqual({ balance: 10, reserved: 10 });
  validity('2027-03-01T00:00:00.000Z', 'corrected-period-1');
  expect(credits.account(wid)).toEqual({ balance: 80, reserved: 10 });
  expect(reverse(50, 'refund-50')).toEqual({ deducted: 50, expired: 0, debt: 0 });
  expect(credits.account(wid)).toEqual({ balance: 30, reserved: 10 });
  at('2027-03-02T00:00:00.000Z');
  expect(credits.account(wid).balance).toBe(10);
  validity('2027-04-01T00:00:00.000Z', 'corrected-period-2');
  validity('2027-04-01T00:00:00.000Z', 'corrected-period-2');
  expect(credits.account(wid)).toEqual({ balance: 30, reserved: 10 });
  credits.finish(wid, uid, held.amount, held.job, held.item, false);
  expect(reverse(100, 'refund-100')).toEqual({ deducted: 30, expired: 0, debt: 20 });
  expect(credits.account(wid)).toEqual({ balance: 0, reserved: 0 });
});
it('does not restore expired amounts already attributed to refunds or touch unrelated lots', () => {
  consume(20, true);
  consume(10, false);
  at('2027-02-02T00:00:00.000Z');
  expect(reverse(50, 'expired-refund-50')).toEqual({ deducted: 0, expired: 50, debt: 0 });
  const unrelated = credits.grant({
    workspaceId: wid,
    userId: uid,
    source: 'manual',
    amount: 200,
    eventKey: 'other-source',
    description: 'Unrelated fixture',
  }).lotId!;
  validity('2027-03-01T00:00:00.000Z', 'corrected-period');
  expect(credits.account(wid)).toEqual({ balance: 230, reserved: 10 });
  expect(reverse(100, 'expired-refund-100')).toEqual({ deducted: 20, expired: 0, debt: 30 });
  expect(credits.buckets(wid).find((l) => l.id === unrelated)?.available).toBe(200);
  expect(() =>
    credits.reconcilePrepaidValidity({
      workspaceId: wid,
      userId: uid,
      orderId,
      lotId: unrelated,
      eventKey: 'wrong-lot',
      active: true,
      expiresAt: '2027-04-01T00:00:00.000Z',
    }),
  ).toThrow();
});

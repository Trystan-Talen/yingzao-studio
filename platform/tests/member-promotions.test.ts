import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createPromotions } from '../src/server/billing/promotions';
import { prepaidTimeline } from '../src/server/billing/prepaid-timeline';
import { promotionSchema, type PrepaidTerms } from '../src/contracts/promotions';
import type { Actor } from '../src/contracts/core';
let db: DatabaseContext, core: CoreServices, actor: Actor, wid: string, planId: string;
const terms: PrepaidTerms = {
  months: 1,
  audience: 'personal',
  stacking: 'same-plan',
  timeBasis: 'utc-calendar-month',
  refundPolicy: 'proportional-duration',
  creditArchiveMonths: 0,
  creditValidity: 'purchase-period',
};
const definition = () =>
  promotionSchema.parse({
    id: randomUUID(),
    version: 1,
    name: 'Isolated promotion fixture',
    enabled: true,
    startsAt: '2027-01-01T08:00:00+08:00',
    endsAt: '2027-02-01T08:00:00+08:00',
    timeZone: 'Asia/Shanghai',
    qualificationTime: 'checkout-start',
    priceMinor: 700,
    eligibility: 'first-personal-membership',
    refundedPurchasesCount: true,
    evidenceReference: 'Test policy only; not original-site inferred policy',
  });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-15T00:00:00.000Z'));
  db = createDatabaseContext(':memory:');
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  core = createCoreServices(db, {
    storageDir: '/tmp/unused-promotion-fixture',
    sessionSecret: 'fixture',
    publicOrigin: 'http://127.0.0.1:5174',
    demoMode: false,
  } as never);
  const r = await core.auth.register({
    email: 'promotions@example.local',
    password: 'PromotionFixture2027!',
    displayName: 'Promotion fixture',
  });
  actor = { userId: r.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] };
  wid = r.workspace.id;
  planId = randomUUID();
  db.sqlite
    .prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json) VALUES(?, 'Fixed term fixture','subscription',1000,'USD','month',100,'{}')",
    )
    .run(planId);
});
afterEach(() => {
  closeDatabase(db);
  vi.useRealTimers();
});
it('keeps timed and unconfigured offers distinct, canonicalizes offsets and never silently discounts an ineligible account', () => {
  const p = definition(),
    service = createPromotions(db),
    offer = (at: string, extra = {}) =>
      service.offer(JSON.stringify({ ...p, ...extra }), 1000, actor.userId, wid, 'live', at)!;
  expect(offer('2026-12-31T23:59:59.999Z').status).toBe('upcoming');
  expect(offer('2027-01-01T00:00:00.000Z').priceMinor).toBe(700);
  expect(offer('2027-02-01T00:00:00.000Z')).toMatchObject({ status: 'ended', priceMinor: 1000 });
  expect(
    offer('2027-01-15T00:00:00.000Z', {
      eligibility: 'unconfigured',
      refundedPurchasesCount: null,
      evidenceReference: '',
    }),
  ).toMatchObject({ status: 'unconfigured', priceMinor: 1000 });
  const paid = core.business.createOrder(actor, wid, { planId });
  db.sqlite
    .prepare("UPDATE orders SET status='paid',payment_environment='live',paid_at=? WHERE id=?")
    .run('2027-01-10T00:00:00.000Z', paid.id);
  expect(offer('2027-01-15T00:00:00.000Z').status).toBe('ineligible');
  expect(service.offer(JSON.stringify(p), 1000, actor.userId, wid, 'test')!.status).toBe(
    'available',
  );
});
it('reserves first-purchase eligibility across spaces, keeps unknown outcomes reserved and releases only verified failure', () => {
  const service = createPromotions(db),
    snapshot = { definition: definition(), originalPriceMinor: 1000 };
  const otherWid = core.auth.createWorkspace(
    actor.userId,
    'Second personal fixture',
    'personal',
  ).id;
  const first = core.business.createOrder(actor, wid, { planId }),
    second = core.business.createOrder(actor, otherWid, { planId });
  const attempt = (orderId: string) =>
    db.sqlite
      .transaction(() =>
        service.assertCheckout({
          orderId,
          userId: actor.userId,
          workspaceId: orderId === first.id ? wid : otherWid,
          environment: 'live',
          snapshot,
        }),
      )
      .immediate();
  expect(attempt(first.id)).toBeGreaterThan(Date.now() / 1000);
  expect(() => attempt(second.id)).toThrow(/待确认/);
  expect(attempt(first.id)).toBeGreaterThan(Date.now() / 1000);
  db.sqlite.transaction(() => service.complete(first.id, false)).immediate();
  expect(attempt(second.id)).toBeGreaterThan(Date.now() / 1000);
});
it('requires renewed consent when catalog terms change at the same price', () => {
  const shown = core.business.plans({}, actor, wid).items.find((p) => p.id === planId)!;
  db.sqlite
    .prepare('UPDATE plans SET catalog_version=catalog_version+1,credits=999 WHERE id=?')
    .run(planId);
  expect(() =>
    core.business.createOrder(actor, wid, {
      planId,
      expectedAmountMinor: shown.priceMinor,
      expectedCatalogVersion: shown.catalogVersion,
    }),
  ).toThrowError(expect.objectContaining({ code: 'ORDER_TERMS_CHANGED' }));
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM orders').get()).toEqual({ n: 0 });
});
it('refuses new checkout near expiry without losing a previously reserved request identity', () => {
  const service = createPromotions(db),
    p = definition();
  const order = core.business.createOrder(actor, wid, { planId });
  expect(() =>
    db.sqlite
      .transaction(() =>
        service.assertCheckout({
          orderId: order.id,
          userId: actor.userId,
          workspaceId: wid,
          environment: 'live',
          snapshot: { definition: p, originalPriceMinor: 1000 },
          at: '2027-01-31T23:40:00.000Z',
        }),
      )
      .immediate(),
  ).toThrow(/剩余时间/);
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM promotion_claims').get()).toEqual({ n: 0 });
});
it('derives same-plan periods from payment order, supports quarter/month-end terms, and refunds only the selected contribution', () => {
  const a = {
    orderId: 'a',
    paidAt: '2027-01-31T12:00:00.000Z',
    amountMinor: 1000,
    refundedMinor: 0,
    terms,
  };
  const b = { ...a, orderId: 'b', paidAt: '2027-02-01T12:00:00.000Z' };
  expect(prepaidTimeline([b, a])).toEqual(prepaidTimeline([a, b]));
  expect(prepaidTimeline([a, b])[1]!.periodEnd).toBe('2027-03-28T12:00:00.000Z');
  expect(prepaidTimeline([{ ...a, terms: { ...terms, months: 3 } }])[0]!.periodEnd).toBe(
    '2027-04-30T12:00:00.000Z',
  );
  const refunded = prepaidTimeline([{ ...a, refundedMinor: 1000 }, b]);
  expect(refunded[0]!.active).toBe(false);
  expect(refunded[1]!.periodEnd).toBe('2027-03-01T12:00:00.000Z');
  const half = prepaidTimeline([{ ...a, refundedMinor: 500 }])[0]!;
  expect(Date.parse(half.periodEnd) - Date.parse(half.periodStart)).toBe(14 * 86400000);
});

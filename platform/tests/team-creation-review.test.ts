/** Independent team authorization fixtures; no provider request or real payment is made. */
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
import { createCreditService, type CreditService } from '../src/server/tasks/credits';
import { createBillingAdmin } from '../src/server/billing/admin';
import { createBillingService, type BillingService } from '../src/server/billing';
import { createBillingStore } from '../src/server/billing/store';
import type { StripeGateway } from '../src/server/billing/stripe-gateway';
import type { Actor } from '../src/contracts/core';
import type { AppConfig } from '../src/server/config';

let db: DatabaseContext,
  core: CoreServices,
  credits: CreditService,
  billing: BillingService,
  actor: Actor,
  personalWid: string,
  planId: string;
const providerRequest = vi.fn(async (): Promise<never> => {
  throw new Error('No external provider request is allowed in this independent fixture');
});
beforeEach(async () => {
  db = createDatabaseContext(':memory:');
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  const config = {
    storageDir: '/tmp/team-review-media-unused',
    sessionSecret: 'fixture',
    publicOrigin: 'http://127.0.0.1:5174',
    isProduction: false,
    demoMode: false,
    billing: {
      stripeSecretKey: 'sk_test_independent_fixture',
      stripeWebhookSecret: 'whsec_fixture',
    },
  } as AppConfig;
  credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (wid, uid) => credits.initialize(wid, uid, 0),
  });
  const registered = await core.auth.register({
    email: 'independent-team@example.test',
    displayName: 'Independent team review',
    password: 'TeamReview2026!',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  personalWid = registered.workspace.id;
  planId = randomUUID();
  createBillingAdmin(db).importPlans({
    actorUserId: actor.userId,
    reason: 'Independent isolated team authorization and activation fixture.',
    confirmCommercialCatalog: true,
    version: 1,
    plans: [
      {
        id: planId,
        name: 'Independent approved team month',
        kind: 'subscription',
        priceMinor: 700,
        currency: 'USD',
        credits: 100,
        interval: 'month',
        limits: { seats: 20 },
        prepaidTerms: {
          months: 1,
          audience: 'team',
          stacking: 'same-plan',
          timeBasis: 'utc-calendar-month',
          refundPolicy: 'proportional-duration',
          creditArchiveMonths: 3,
          creditValidity: 'same-plan-renewal',
        },
      },
    ],
  });
  billing = createBillingService(db, core, config, credits, {
    createCheckout: providerRequest,
    retrieveCheckout: providerRequest,
  } as unknown as StripeGateway);
  core.business.setBilling(billing);
  providerRequest.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDatabase(db);
});
function reserve() {
  return core.teamCreation.reserve(actor, {
    name: 'Independent pending team',
    planId,
    expectedAmountMinor: 700,
    expectedCatalogVersion: 1,
  }).pending!;
}
function anotherUser() {
  const uid = randomUUID(),
    date = new Date().toISOString();
  db.sqlite
    .prepare(
      'INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(uid, `${uid}@team-review.example.test`, 'no-login-fixture', 'Other account', date, date);
  return { ...actor, userId: uid };
}
function fulfill(oid: string, paidAt = new Date().toISOString()) {
  const store = createBillingStore(db, core, credits);
  core.context.transaction(() => {
    db.sqlite
      .prepare(
        "UPDATE orders SET payment_environment='test',provider_payment_intent_id=? WHERE id=?",
      )
      .run(`pi_${oid}`, oid);
    store.grant(store.order(oid), `independent:${oid}`, 100, { paidAt });
  });
  return store;
}

it('rejects foreign users and cross-workspace order IDs before invoking a payment provider', async () => {
  const pending = reserve(),
    foreign = anotherUser(),
    oid = pending.order!.id;
  expect(() => core.business.getOrder(actor, personalWid, oid)).toThrow('内容不存在');
  expect(() => core.business.cancelOrder(actor, personalWid, oid)).toThrow('内容不存在');
  await expect(billing.checkout(actor, personalWid, oid)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(billing.checkout(foreign, pending.workspaceId, oid)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    billing.checkout({ ...actor, authType: 'apiKey' }, pending.workspaceId, oid),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(providerRequest).not.toHaveBeenCalled();
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM stripe_checkouts').get()).toEqual({ n: 0 });
  expect(
    db.sqlite
      .prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?')
      .get(pending.workspaceId),
  ).toEqual({ n: 0 });
  expect(credits.account(pending.workspaceId)).toMatchObject({ balance: 0, reserved: 0 });
});

it('does not reuse a cancelled draft as payment or allocate another team while replacing its order', async () => {
  const first = reserve();
  core.business.cancelOrder(actor, first.workspaceId, first.order!.id);
  const next = reserve();
  expect(next.workspaceId).toBe(first.workspaceId);
  expect(next.order!.id).not.toBe(first.order!.id);
  await expect(billing.checkout(actor, first.workspaceId, first.order!.id)).rejects.toMatchObject({
    code: 'ORDER_STATE_CONFLICT',
  });
  expect(providerRequest).not.toHaveBeenCalled();
  expect(core.teamCreation.status(actor).pending?.order?.id).toBe(next.order!.id);
  expect(db.sqlite.prepare("SELECT COUNT(*) n FROM workspaces WHERE kind='team'").get()).toEqual({
    n: 1,
  });
});

it.each([false, true])(
  'uses an older verified order in the same reservation after replacing its closed draft, fullyRefunded=%s',
  (fullyRefunded) => {
    const first = reserve(),
      originalOrderId = first.order!.id;
    core.business.cancelOrder(actor, first.workspaceId, originalOrderId);
    const replacement = reserve();
    expect(replacement.order!.id).not.toBe(originalOrderId);
    if (fullyRefunded)
      db.sqlite
        .prepare(
          'INSERT INTO billing_risks(id,provider_event_id,kind,charge_id,payment_intent_id,amount_minor,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'independent-old-order-refund',
          'charge.refunded',
          'ch_old_order',
          `pi_${originalOrderId}`,
          700,
          'review_required',
          new Date().toISOString(),
        );
    const store = fulfill(originalOrderId);
    core.context.transaction(() => {
      store.linkRisk(store.order(originalOrderId));
      core.teamCreation.activateVerifiedPurchase(originalOrderId);
    });
    expect(
      db.sqlite
        .prepare('SELECT order_id,state FROM team_provisioning WHERE workspace_id=?')
        .get(first.workspaceId),
    ).toEqual({ order_id: replacement.order!.id, state: fullyRefunded ? 'pending' : 'active' });
    if (fullyRefunded) {
      expect(() => core.requireAccess(actor, first.workspaceId, 'read')).toThrow('尚未核验');
    } else {
      expect(core.requireAccess(actor, first.workspaceId, 'owner').role).toBe('owner');
      core.context.transaction(() => core.teamCreation.activateVerifiedPurchase(originalOrderId));
      expect(
        db.sqlite
          .prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?')
          .get(first.workspaceId),
      ).toEqual({ n: 1 });
    }
    expect(providerRequest).not.toHaveBeenCalled();
  },
);

it('rolls back the workspace and permanent slot if expected commercial terms are stale', () => {
  expect(() =>
    core.teamCreation.reserve(actor, {
      name: 'Must roll back',
      planId,
      expectedAmountMinor: 699,
      expectedCatalogVersion: 1,
    }),
  ).toThrow('价格');
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM team_account_slots').get()).toEqual({ n: 0 });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM team_provisioning').get()).toEqual({ n: 0 });
  expect(db.sqlite.prepare("SELECT COUNT(*) n FROM workspaces WHERE kind='team'").get()).toEqual({
    n: 0,
  });
  expect(reserve().order).not.toBeNull();
});

it('keeps an unpaid team closed without fulfillment and activates a real fulfillment exactly once', () => {
  const pending = reserve(),
    oid = pending.order!.id;
  core.context.transaction(() => core.teamCreation.activateVerifiedPurchase(oid));
  expect(() => core.requireAccess(actor, pending.workspaceId, 'read')).toThrow('尚未核验');
  fulfill(oid);
  core.context.transaction(() => core.teamCreation.activateVerifiedPurchase(oid));
  core.context.transaction(() => core.teamCreation.activateVerifiedPurchase(oid));
  expect(core.requireAccess(actor, pending.workspaceId, 'owner').role).toBe('owner');
  expect(
    db.sqlite
      .prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?')
      .get(pending.workspaceId),
  ).toEqual({ n: 1 });
  expect(
    db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='team.activated'").get(),
  ).toEqual({ n: 1 });
  expect(credits.account(pending.workspaceId)).toMatchObject({ balance: 100, reserved: 0 });
});

it('records late expired paid activation without current membership rights', () => {
  const pending = reserve(),
    oid = pending.order!.id;
  fulfill(oid, '2025-01-01T00:00:00.000Z');
  core.context.transaction(() => core.teamCreation.activateVerifiedPurchase(oid));
  expect(core.teamCreation.status(actor).mode).toBe('existing');
  expect(core.entitlements.effective(pending.workspaceId).source).toBe('baseline');
  expect(credits.account(pending.workspaceId).balance).toBe(0);
});

it('links an earlier full-refund risk before activation and leaves the reservation closed', () => {
  const pending = reserve(),
    oid = pending.order!.id;
  db.sqlite
    .prepare(
      'INSERT INTO billing_risks(id,provider_event_id,kind,charge_id,payment_intent_id,amount_minor,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(
      randomUUID(),
      'independent-full-refund',
      'charge.refunded',
      'ch_independent',
      `pi_${oid}`,
      700,
      'review_required',
      new Date().toISOString(),
    );
  const store = fulfill(oid);
  core.context.transaction(() => {
    store.linkRisk(store.order(oid));
    core.teamCreation.activateVerifiedPurchase(oid);
  });
  expect(core.business.getOrder(actor, pending.workspaceId, oid).status).toBe('refunded');
  expect(core.teamCreation.status(actor).mode).toBe('pending');
  expect(() => core.requireAccess(actor, pending.workspaceId, 'read')).toThrow('尚未核验');
  expect(
    db.sqlite
      .prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?')
      .get(pending.workspaceId),
  ).toEqual({ n: 0 });
});

it('rejects a transfer to an account whose unpaid reservation already consumes its slot', () => {
  const pending = reserve(),
    other = anotherUser();
  const source = core.auth.createWorkspace(other.userId, 'Other existing team', 'team');
  const date = new Date().toISOString();
  db.sqlite
    .prepare(
      "INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,'member',?,?)",
    )
    .run(randomUUID(), source.id, actor.userId, date, date);
  expect(() =>
    core.team.transfer(other, source.id, { userId: actor.userId, confirm: true }),
  ).toThrow('已占用');
  expect(core.requireAccess(other, source.id, 'owner').role).toBe('owner');
  expect(core.teamCreation.status(actor).pending?.workspaceId).toBe(pending.workspaceId);
});

it('keeps both account slots after ownership transfer and archive, including deletion protection', () => {
  const pending = reserve(),
    other = anotherUser();
  fulfill(pending.order!.id);
  core.context.transaction(() => core.teamCreation.activateVerifiedPurchase(pending.order!.id));
  const date = new Date().toISOString();
  db.sqlite
    .prepare(
      "INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,'member',?,?)",
    )
    .run(randomUUID(), pending.workspaceId, other.userId, date, date);
  core.team.transfer(actor, pending.workspaceId, { userId: other.userId, confirm: true });
  core.team.archive(other, pending.workspaceId, { confirm: true });
  for (const who of [actor, other]) {
    expect(core.teamCreation.status(who)).toMatchObject({
      mode: 'existing',
      existing: { id: pending.workspaceId, archived: true, accessible: false },
    });
    expect(() => core.team.create(who, { name: 'Bypass' })).toThrow('已占用');
  }
  expect(() =>
    db.sqlite.prepare('DELETE FROM team_account_slots WHERE user_id=?').run(actor.userId),
  ).toThrow('cannot be reset');
  expect(
    db.sqlite
      .prepare('SELECT COUNT(*) n FROM team_account_slots WHERE workspace_id=?')
      .get(pending.workspaceId),
  ).toEqual({ n: 2 });
});

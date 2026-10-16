import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createBillingAdmin } from '../src/server/billing/admin';
import type { Actor } from '../src/contracts/core';
let db: ReturnType<typeof createDatabaseContext>,
  core: ReturnType<typeof createCoreServices>,
  owner: Actor,
  member: Actor,
  wid: string;
const date = '2026-10-16T00:00:00.000Z';
const teamTerms = {
  months: 1,
  audience: 'team',
  stacking: 'same-plan',
  timeBasis: 'utc-calendar-month',
  refundPolicy: 'proportional-duration',
  creditArchiveMonths: 3,
  creditValidity: 'same-plan-renewal',
};
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(date));
  db = createDatabaseContext(':memory:');
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  db.sqlite
    .prepare(
      "UPDATE entitlement_defaults SET limits_json=json_set(limits_json,'$.brands',1) WHERE id='standard'",
    )
    .run();
  core = createCoreServices(db, {
    storageDir: '/tmp/brand-quota-fixture',
    sessionSecret: 'fixture',
    publicOrigin: 'http://127.0.0.1:5174',
    demoMode: false,
  } as never);
  const registered = await core.auth.register({
    email: 'brand-owner@example.test',
    displayName: 'Brand owner',
    password: 'BrandQuotaFixture2026!',
  });
  owner = {
    userId: registered.user.id,
    authType: 'session',
    workspaceId: null,
    apiKeyId: null,
    scopes: [],
  };
  wid = core.auth.createWorkspace(owner.userId, '品牌成员额度夹具', 'team', false).id;
  member = { ...owner, userId: randomUUID() };
  db.sqlite
    .prepare(
      'INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      member.userId,
      'brand-member@example.test',
      'fixture-no-login',
      'Brand member',
      date,
      date,
    );
  db.sqlite
    .prepare(
      "INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,'member',?,?)",
    )
    .run(randomUUID(), wid, member.userId, date, date);
});
afterEach(() => {
  closeDatabase(db);
  vi.useRealTimers();
});
function subscription(limit: number, scope?: 'workspace' | 'member', existingPlanId?: string) {
  const planId = existingPlanId ?? randomUUID(),
    sid = randomUUID();
  db.sqlite
    .prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,prepaid_terms_json,catalog_mode,catalog_version,approved_at,approved_by) VALUES(?,'品牌额度测试','subscription',100,'USD','month',0,?,?,'official',1,?,?) ON CONFLICT(id) DO UPDATE SET limits_json=excluded.limits_json,catalog_version=plans.catalog_version+1",
    )
    .run(
      planId,
      JSON.stringify({ brands: limit, ...(scope ? { brandQuotaScope: scope } : {}) }),
      JSON.stringify(teamTerms),
      date,
      owner.userId,
    );
  const order = core.business.createOrder(owner, wid, { planId });
  db.sqlite
    .prepare("UPDATE orders SET status='paid',payment_environment='live',paid_at=? WHERE id=?")
    .run(date, order.id);
  db.sqlite
    .prepare(
      "INSERT INTO subscriptions(id,workspace_id,plan_id,status,current_period_start,current_period_end,provider_id,created_at,updated_at,source_order_id) VALUES(?,?,?,'active',?,?,'stripe-prepaid',?,?,?)",
    )
    .run(sid, wid, planId, date, '2026-11-16T00:00:00.000Z', date, date, order.id);
  return { planId, orderId: order.id, sid };
}
const create = (actor: Actor, name: string) => core.references.createBrand(actor, wid, { name });
it('counts a new explicit member contract separately for each creator', () => {
  subscription(2, 'member');
  create(owner, 'Owner 1');
  create(owner, 'Owner 2');
  create(member, 'Member 1');
  create(member, 'Member 2');
  expect(() => create(owner, 'Owner 3')).toThrow();
  expect(() => create(member, 'Member 3')).toThrow();
  expect(core.entitlements.get(member, wid)).toMatchObject({
    used: { brands: 4 },
    brandQuota: {
      scope: 'member',
      memberLimit: 2,
      workspaceLimit: null,
      memberUsed: 2,
      workspaceUsed: 4,
      canCreate: false,
    },
  });
});
it('keeps an absent scope as the historical workspace contract without rewriting the order', () => {
  const { orderId } = subscription(2),
    before = db.sqlite.prepare('SELECT plan_snapshot_json FROM orders WHERE id=?').get(orderId);
  create(owner, 'Historical 1');
  create(member, 'Historical 2');
  expect(() => create(owner, 'Historical 3')).toThrow();
  expect(core.entitlements.get(owner, wid)).toMatchObject({
    brandQuota: { scope: 'workspace', workspaceLimit: 2, memberLimit: null },
  });
  expect(
    db.sqlite.prepare('SELECT plan_snapshot_json FROM orders WHERE id=?').get(orderId),
  ).toEqual(before);
});
it('preserves separate old workspace and new member eligibility without adding their numeric limits', () => {
  const previous = subscription(3);
  subscription(2, 'member', previous.planId);
  create(owner, 'Mixed owner 1');
  create(owner, 'Mixed owner 2');
  create(member, 'Mixed member 1');
  create(member, 'Mixed member 2');
  expect(() => create(owner, 'Cannot add 3+2')).toThrow();
  expect(core.entitlements.get(owner, wid)).toMatchObject({
    brandQuota: {
      scope: 'mixed',
      workspaceLimit: 3,
      memberLimit: 2,
      workspaceUsed: 4,
      memberUsed: 2,
      canCreate: false,
    },
  });
});
it('uses the original creator quota on restoration instead of the administrator performing the restore', () => {
  subscription(2, 'member');
  const first = create(member, 'Member old');
  create(member, 'Member kept');
  core.references.removeBrand(member, wid, first.id);
  create(member, 'Member replacement');
  expect(() => core.references.restoreBrand(owner, wid, first.id)).toThrow();
  expect(core.references.brands(owner, wid, {}).items).toHaveLength(2);
});
it('keeps existing brands on expiry while refusing new resources above the baseline', () => {
  const { sid } = subscription(2, 'member');
  const first = create(owner, 'Existing 1');
  create(owner, 'Existing 2');
  db.sqlite.prepare('UPDATE subscriptions SET current_period_end=? WHERE id=?').run(date, sid);
  expect(core.references.updateBrand(owner, wid, first.id, { name: 'Still editable' }).name).toBe(
    'Still editable',
  );
  expect(core.references.brands(owner, wid, {}).items).toHaveLength(2);
  expect(() => create(owner, 'Above baseline')).toThrow();
});
it('does not apply schema defaults when renaming a private brand', async () => {
  const image = await core.assets.ingest(owner, wid, {
    buffer: await sharp({ create: { width: 20, height: 20, channels: 3, background: '#334455' } })
      .png()
      .toBuffer(),
    name: 'owned.png',
    mimeType: 'image/png',
  });
  const brand = core.references.createBrand(owner, wid, {
    name: 'Private original',
    description: 'Keep this description',
    colors: ['#aabbcc'],
    fonts: ['Original font'],
    referenceAssetIds: [image.id],
    coverAssetId: image.id,
    visibility: 'private',
  });
  const renamed = core.references.updateBrand(owner, wid, brand.id, { name: 'Private renamed' });
  expect(renamed).toMatchObject({
    description: brand.description,
    colors: brand.colors,
    fonts: brand.fonts,
    referenceAssetIds: brand.referenceAssetIds,
    coverAssetId: image.id,
    visibility: 'private',
  });
  expect(() => core.references.getBrand(member, wid, brand.id)).toThrow();
});
it('only imports member scope with an explicit approved team membership contract and validates preserved terms', () => {
  const admin = createBillingAdmin(db),
    id = randomUUID();
  const save = (prepaidTerms?: unknown) =>
    admin.importPlans({
      actorUserId: owner.userId,
      reason: 'Explicit isolated member quota contract verification',
      version: 1,
      confirmCommercialCatalog: true,
      plans: [
        {
          id,
          name: 'Member brand contract',
          kind: 'subscription',
          priceMinor: 100,
          currency: 'USD',
          credits: 0,
          interval: 'month',
          limits: { brands: 2, brandQuotaScope: 'member' },
          ...(prepaidTerms !== undefined ? { prepaidTerms } : {}),
        },
      ],
    });
  expect(() => save(null)).toThrow();
  expect(() => save({ ...teamTerms, audience: 'personal' })).toThrow();
  save(teamTerms);
  save();
  expect(() => save(null)).toThrow();
  expect(
    JSON.parse(
      (
        db.sqlite.prepare('SELECT limits_json FROM plans WHERE id=?').get(id) as {
          limits_json: string;
        }
      ).limits_json,
    ),
  ).toEqual({ brands: 2, brandQuotaScope: 'member' });
});
it('lists only deleted brands visible to this user and workspace without exposing private recycle records', () => {
  subscription(5, 'member');
  const shared = create(owner, 'Shared recycle');
  const privateOwner = core.references.createBrand(owner, wid, {
    name: 'Owner private recycle',
    visibility: 'private',
  });
  const privateMember = core.references.createBrand(member, wid, {
    name: 'Member private recycle',
    visibility: 'private',
  });
  for (const [actor, brand] of [
    [owner, shared],
    [owner, privateOwner],
    [member, privateMember],
  ] as const)
    core.references.removeBrand(actor, wid, brand.id);
  expect(core.references.brands(owner, wid, {}).items).toEqual([]);
  expect(
    core.references
      .brands(owner, wid, { deleted: true })
      .items.map((b) => b.id)
      .sort(),
  ).toEqual([shared.id, privateOwner.id].sort());
  expect(
    core.references
      .brands(member, wid, { deleted: true })
      .items.map((b) => b.id)
      .sort(),
  ).toEqual([shared.id, privateMember.id].sort());
  expect(() => core.references.restoreBrand(member, wid, privateOwner.id)).toThrow();
  const foreign = core.auth.createWorkspace(owner.userId, 'Foreign brands', 'personal', false).id;
  expect(core.references.brands(owner, foreign, { deleted: true }).items).toEqual([]);
  expect(() => core.references.brands(member, foreign, { deleted: true })).toThrow();
  expect(() => core.references.restoreBrand(owner, foreign, shared.id)).toThrow();
});

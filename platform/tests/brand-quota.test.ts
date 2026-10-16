import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { brandQuotaSchema, brandQuotaScopeSchema } from '../src/contracts/brand-quota';
import { readBrandQuota } from '../src/server/core/brand-quota';
import { CoreContext } from '../src/server/core/shared';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';

let db: DatabaseContext, c: CoreContext, wid: string, owner: string, member: string, planId: string;
const stamp = '2026-10-16T00:00:00.000Z';
const teamTerms = {
  months: 1,
  audience: 'team',
  stacking: 'same-plan',
  timeBasis: 'utc-calendar-month',
  refundPolicy: 'proportional-duration',
  creditArchiveMonths: 3,
  creditValidity: 'same-plan-renewal',
};
function user() {
  const id = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(id, `${id}@brand-quota.example.test`, 'no-login-fixture', '配额夹具', stamp, stamp);
  return id;
}
function workspace(kind: 'team' | 'personal' = 'team', demo = false) {
  const id = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO workspaces(id,name,kind,is_demo,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(id, '配额空间夹具', kind, Number(demo), owner, stamp, stamp);
  for (const [uid, role] of [
    [owner, 'owner'],
    [member, 'member'],
  ])
    db.sqlite
      .prepare(
        'INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run(randomUUID(), id, uid, role, stamp, stamp);
  return id;
}
function baseline(id: 'standard' | 'demo', brands: number) {
  const old = JSON.parse(
    (
      db.sqlite.prepare('SELECT limits_json FROM entitlement_defaults WHERE id=?').get(id) as {
        limits_json: string;
      }
    ).limits_json,
  );
  db.sqlite
    .prepare('UPDATE entitlement_defaults SET limits_json=? WHERE id=?')
    .run(JSON.stringify({ ...old, brands }), id);
}
function contract(
  limits: unknown,
  input: {
    workspaceId?: string;
    status?: string;
    orderStatus?: string;
    start?: string;
    end?: string;
    snapshot?: Record<string, unknown>;
  } = {},
) {
  const id = randomUUID(),
    subscriptionId = randomUUID(),
    target = input.workspaceId ?? wid;
  db.sqlite
    .prepare(
      'INSERT INTO orders(id,workspace_id,number,kind,status,amount_minor,currency,plan_id,plan_snapshot_json,created_by,created_at,updated_at,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      target,
      id,
      'subscription',
      input.orderStatus ?? 'paid',
      700,
      'USD',
      planId,
      JSON.stringify({
        id: planId,
        name: '同档已批准团队合同夹具',
        kind: 'subscription',
        price_minor: 700,
        currency: 'USD',
        credits: 100,
        interval: 'month',
        catalog_mode: 'official',
        catalog_version: 1,
        approved_at: stamp,
        approved_by: owner,
        prepaid_terms_json: JSON.stringify(teamTerms),
        ...input.snapshot,
        limits_json: JSON.stringify(limits),
      }),
      owner,
      stamp,
      stamp,
      stamp,
    );
  db.sqlite
    .prepare(
      'INSERT INTO subscriptions(id,workspace_id,plan_id,status,current_period_start,current_period_end,provider_id,source_order_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      subscriptionId,
      target,
      planId,
      input.status ?? 'active',
      input.start ?? '2020-01-01T00:00:00.000Z',
      input.end ?? '2099-01-01T00:00:00.000Z',
      'stripe-prepaid',
      id,
      stamp,
      stamp,
    );
  return { id, subscriptionId };
}
function brand(uid = owner, deleted = false) {
  const id = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO brands(id,workspace_id,name,created_by,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(id, wid, '已有真实品牌记录', uid, stamp, stamp, deleted ? stamp : null);
  return id;
}
beforeEach(() => {
  db = createDatabaseContext(':memory:');
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  c = new CoreContext(
    db,
    {
      storageDir: '/tmp/brand-quota-unused',
      sessionSecret: 'fixture',
      publicOrigin: 'http://127.0.0.1:5174',
      isProduction: false,
      demoMode: false,
    },
    {},
  );
  owner = user();
  member = user();
  wid = workspace();
  planId = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO plans(id,name,kind,price_minor,currency,credits,interval,limits_json) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(planId, '同档配额合同夹具', 'subscription', 700, 'USD', 100, 'month', '{}');
  baseline('standard', 1);
  baseline('demo', 3);
});
afterEach(() => closeDatabase(db));

it('validates the explicit scope and nullable two-scope quota contract', () => {
  expect(brandQuotaScopeSchema.parse('member')).toBe('member');
  expect(brandQuotaScopeSchema.safeParse('mixed').success).toBe(false);
  expect(
    brandQuotaSchema.parse({
      scope: 'mixed',
      workspaceLimit: 1,
      memberLimit: 2,
      workspaceUsed: 3,
      memberUsed: 1,
      canCreate: true,
    }).scope,
  ).toBe('mixed');
  expect(
    brandQuotaSchema.safeParse({
      scope: 'member',
      workspaceLimit: null,
      memberLimit: 1,
      workspaceUsed: 0,
      memberUsed: -1,
      canCreate: true,
    }).success,
  ).toBe(false);
});

it('uses the configured standard or demo baseline and rejects missing or archived workspaces', () => {
  expect(readBrandQuota(c, wid, owner)).toEqual({
    scope: 'workspace',
    workspaceLimit: 1,
    memberLimit: null,
    workspaceUsed: 0,
    memberUsed: 0,
    canCreate: true,
  });
  expect(readBrandQuota(c, workspace('team', true), owner).workspaceLimit).toBe(3);
  expect(() => readBrandQuota(c, randomUUID(), owner)).toThrow('工作空间不存在');
  db.sqlite.prepare('UPDATE workspaces SET archived_at=? WHERE id=?').run(stamp, wid);
  expect(() => readBrandQuota(c, wid, owner)).toThrow('工作空间不存在');
});

it('treats an old explicit numeric brand limit with no scope as workspace without rewriting its snapshot', () => {
  const saved = contract({ brands: 2, seats: 20 });
  const before = db.sqlite
    .prepare('SELECT plan_snapshot_json FROM orders WHERE id=?')
    .get(saved.id);
  brand(owner);
  expect(readBrandQuota(c, wid, member)).toMatchObject({
    scope: 'workspace',
    workspaceLimit: 2,
    memberLimit: null,
    workspaceUsed: 1,
    memberUsed: 0,
    canCreate: true,
  });
  brand(member);
  expect(readBrandQuota(c, wid, owner).canCreate).toBe(false);
  expect(
    db.sqlite.prepare('SELECT plan_snapshot_json FROM orders WHERE id=?').get(saved.id),
  ).toEqual(before);
});

it('uses member-only capacity separately for each creator and never adds the baseline workspace allowance', () => {
  contract({ brands: 2, brandQuotaScope: 'member' });
  brand(owner);
  brand(owner);
  brand(owner);
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    scope: 'member',
    workspaceLimit: null,
    memberLimit: 2,
    workspaceUsed: 3,
    memberUsed: 3,
    canCreate: false,
  });
  expect(readBrandQuota(c, wid, member)).toMatchObject({
    workspaceLimit: null,
    memberLimit: 2,
    memberUsed: 0,
    canCreate: true,
  });
  brand(member);
  brand(member);
  expect(readBrandQuota(c, wid, member).canCreate).toBe(false);
});

it('retains mixed eligibility with either remaining scope, without summing their allowances', () => {
  contract({ brands: 2 });
  contract({ brands: 3, brandQuotaScope: 'member' });
  brand(owner);
  brand(owner);
  brand(owner);
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    scope: 'mixed',
    workspaceLimit: 2,
    memberLimit: 3,
    workspaceUsed: 3,
    memberUsed: 3,
    canCreate: false,
  });
  expect(readBrandQuota(c, wid, member).canCreate).toBe(true);
  contract({ brands: 4, brandQuotaScope: 'workspace' });
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    workspaceLimit: 4,
    memberLimit: 3,
    canCreate: true,
  });
});

it('takes the maximum within each scope rather than adding same-scope contracts', () => {
  contract({ brands: 2 });
  contract({ brands: 5 });
  contract({ brands: 1, brandQuotaScope: 'member' });
  contract({ brands: 3, brandQuotaScope: 'member' });
  for (let index = 0; index < 5; index++) brand(owner);
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    workspaceLimit: 5,
    memberLimit: 3,
    canCreate: false,
  });
});

it('falls back to baseline after expiry and ignores future, unpaid or inactive subscription contracts', () => {
  const active = contract({ brands: 3, brandQuotaScope: 'member' });
  brand(owner);
  brand(owner);
  expect(readBrandQuota(c, wid, owner).canCreate).toBe(true);
  db.sqlite
    .prepare('UPDATE subscriptions SET current_period_end=? WHERE id=?')
    .run('2020-01-02T00:00:00.000Z', active.subscriptionId);
  contract({ brands: 99 }, { start: '2099-01-01T00:00:00.000Z', end: '2100-01-01T00:00:00.000Z' });
  contract({ brands: 99 }, { orderStatus: 'refunded' });
  contract({ brands: 99 }, { status: 'canceled' });
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    scope: 'workspace',
    workspaceLimit: 1,
    memberLimit: null,
    workspaceUsed: 2,
    canCreate: false,
  });
});

it('uses baseline when paid contracts have no explicit brands value, keeping numeric snapshots untouched', () => {
  contract({ seats: 20 });
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    scope: 'workspace',
    workspaceLimit: 1,
    memberLimit: null,
  });
});

it.each(['workspace', 'member'])(
  'rejects an explicit %s scope without an explicit brands number',
  (scope) => {
    contract({ seats: 20, brandQuotaScope: scope });
    expect(() => readBrandQuota(c, wid, owner)).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'BRAND_QUOTA_INVALID' }),
    );
  },
);

it.each([
  { catalog_mode: 'demo' },
  { approved_at: null },
  { prepaid_terms_json: null },
  { prepaid_terms_json: '{invalid' },
  { prepaid_terms_json: JSON.stringify({ ...teamTerms, audience: 'personal' }) },
])('rejects member scope without an approved explicit team snapshot: %j', (snapshot) => {
  contract({ brands: 2, brandQuotaScope: 'member' }, { snapshot });
  expect(() => readBrandQuota(c, wid, owner)).toThrow(
    expect.objectContaining({ statusCode: 409, code: 'BRAND_QUOTA_INVALID' }),
  );
});

it('counts only undeleted brands by original creator across delete and restore', () => {
  contract({ brands: 2, brandQuotaScope: 'member' });
  const first = brand(owner),
    restored = brand(owner, true);
  brand(member);
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    workspaceUsed: 2,
    memberUsed: 1,
    canCreate: true,
  });
  db.sqlite.prepare('UPDATE brands SET deleted_at=NULL WHERE id=?').run(restored);
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    workspaceUsed: 3,
    memberUsed: 2,
    canCreate: false,
  });
  db.sqlite.prepare('UPDATE brands SET deleted_at=? WHERE id=?').run(stamp, first);
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    workspaceUsed: 2,
    memberUsed: 1,
    canCreate: true,
  });
});

it('does not grant member eligibility to a departed creator or reassign their existing brands', () => {
  contract({ brands: 2, brandQuotaScope: 'member' });
  brand(member);
  db.sqlite.prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=?').run(wid, member);
  expect(readBrandQuota(c, wid, member)).toMatchObject({
    scope: 'member',
    memberLimit: 2,
    memberUsed: 1,
    canCreate: false,
  });
  expect(readBrandQuota(c, wid, owner)).toMatchObject({
    workspaceUsed: 1,
    memberUsed: 0,
    canCreate: true,
  });
});

it('rejects unknown scope or member-only contracts in a personal workspace', () => {
  const invalid = contract({ brands: 2, brandQuotaScope: 'unknown' });
  expect(() => readBrandQuota(c, wid, owner)).toThrow();
  db.sqlite
    .prepare("UPDATE subscriptions SET status='canceled' WHERE id=?")
    .run(invalid.subscriptionId);
  contract({ brands: 2, brandQuotaScope: 'member' }, { workspaceId: personal() });
  function personal() {
    const id = workspace('personal');
    expect(() => readBrandQuota(c, id, owner)).not.toThrow();
    return id;
  }
  const personalWid = (
    db.sqlite.prepare("SELECT id FROM workspaces WHERE kind='personal'").get() as { id: string }
  ).id;
  expect(() => readBrandQuota(c, personalWid, owner)).toThrow();
});

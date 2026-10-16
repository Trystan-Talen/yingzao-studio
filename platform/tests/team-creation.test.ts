import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import type { Actor } from '../src/contracts/core';
import { randomUUID } from 'node:crypto';
import { createBillingAdmin } from '../src/server/billing/admin';
import { prepaidTermsSchema } from '../src/contracts/promotions';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { registerCoreRoutes } from '../src/server/core';
import { AppError } from '../src/server/errors';
let folder: string, db: DatabaseContext, core: CoreServices, actor: Actor;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-team-creation-'));
  db = createDatabaseContext(join(folder, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  core = createCoreServices(db, {
    storageDir: join(folder, 'media'),
    sessionSecret: 'fixture',
    publicOrigin: 'http://127.0.0.1:5174',
    isProduction: false,
    demoMode: false,
  });
  const result = await core.auth.register({
    email: 'team-owner@example.test',
    password: 'TeamFixture2026!',
    displayName: 'Fixture owner',
  });
  actor = {
    userId: result.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
});
afterEach(async () => {
  closeDatabase(db);
  await rm(folder, { recursive: true, force: true });
});

it('does not let the old workspace endpoint create a team without team purchase', () => {
  expect(() => core.team.create(actor, { name: 'Unpaid team' })).toThrow(/团队会员/);
  expect(db.sqlite.prepare("SELECT COUNT(*) n FROM workspaces WHERE kind='team'").get()).toEqual({
    n: 0,
  });
});
it('keeps legacy teams accessible but refuses a second creation after archive', () => {
  const old = core.auth.createWorkspace(actor.userId, 'Legacy team', 'team');
  core.team.archive(actor, old.id, { confirm: true });
  expect(() => core.team.create(actor, { name: 'Replacement' })).toThrow(/已占用/);
  expect(db.sqlite.prepare("SELECT COUNT(*) n FROM workspaces WHERE kind='team'").get()).toEqual({
    n: 1,
  });
});
it('limits an explicitly marked demo account to one local team experience', () => {
  core.context.config.demoMode = true;
  const team = core.team.create(actor, { name: 'Demo team' });
  expect(team.isDemo).toBe(true);
  expect(() => core.team.create(actor, { name: 'Second demo team' })).toThrow(/已占用/);
});

function teamPlan(audience: 'personal' | 'team' = 'team') {
  const planId = randomUUID();
  createBillingAdmin(db).importPlans({
    actorUserId: actor.userId,
    reason: 'Explicit isolated team creation policy fixture.',
    version: 1,
    confirmCommercialCatalog: true,
    plans: [
      {
        id: planId,
        name: 'Synthetic membership',
        kind: 'subscription',
        priceMinor: 700,
        currency: 'USD',
        credits: 100,
        interval: 'month',
        limits: { seats: 20 },
        prepaidTerms: prepaidTermsSchema.parse({
          months: 1,
          audience,
          stacking: 'same-plan',
          timeBasis: 'utc-calendar-month',
          refundPolicy: 'proportional-duration',
          creditArchiveMonths: 3,
          creditValidity: 'same-plan-renewal',
        }),
      },
    ],
  });
  return planId;
}
function configured() {
  const unavailable = async (): Promise<never> => {
    throw new Error('No external requests in this fixture');
  };
  core.business.setBilling({
    isConfigured: () => true,
    canCheckoutPlan: () => true,
    environment: () => 'test',
    checkout: unavailable,
    cancelSubscription: unavailable,
    invoiceDocument: unavailable,
  });
}
function reserve(planId: string) {
  return core.teamCreation.reserve(actor, {
    name: 'Reserved team',
    planId,
    expectedAmountMinor: 700,
    expectedCatalogVersion: 1,
  });
}
it('does not mistake a personal plan or missing gateway for team eligibility', () => {
  const personal = teamPlan('personal');
  expect(core.teamCreation.status(actor).plans).toHaveLength(0);
  configured();
  expect(() => reserve(personal)).toThrow(/明确适用于团队/);
  const team = teamPlan();
  core.business.setBilling({
    isConfigured: () => false,
    canCheckoutPlan: () => false,
    checkout: async () => {
      throw new Error('unused');
    },
    cancelSubscription: async () => {
      throw new Error('unused');
    },
    invoiceDocument: async () => {
      throw new Error('unused');
    },
  });
  expect(core.teamCreation.status(actor).plans[0]?.available).toBe(false);
  expect(() => reserve(team)).toThrow(/支付服务未配置/);
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM team_account_slots').get()).toEqual({ n: 0 });
});
it('reserves one recoverable order without content membership and blocks old order routes from changing audience or channel', () => {
  configured();
  const planId = teamPlan(),
    personal = teamPlan('personal');
  const status = reserve(planId),
    pending = status.pending!;
  expect(status.mode).toBe('pending');
  expect(reserve(planId).pending?.order?.id).toBe(pending.order?.id);
  expect(core.auth.listWorkspaces(actor).some((w) => w.id === pending.workspaceId)).toBe(false);
  for (const permission of ['read', 'write', 'manage', 'owner'] as const)
    expect(() => core.requireAccess(actor, pending.workspaceId, permission)).toThrow(/尚未核验/);
  expect(() => core.team.activate(actor, pending.workspaceId)).toThrow(/尚未核验/);
  expect(() =>
    core.team.invite(actor, pending.workspaceId, { email: 'other@example.test', role: 'member' }),
  ).toThrow(/尚未核验/);
  const foreign = { ...actor, userId: randomUUID() };
  expect(() => core.business.getOrder(foreign, pending.workspaceId, pending.order!.id)).toThrow(
    /仅预留创建者/,
  );
  expect(() =>
    core.business.getOrder(
      { ...actor, authType: 'apiKey' },
      pending.workspaceId,
      pending.order!.id,
    ),
  ).toThrow(/仅预留创建者/);
  expect(() => core.business.createOrder(actor, pending.workspaceId, { planId: personal })).toThrow(
    /明确适用于团队/,
  );
  expect(() =>
    core.business.createOrder(actor, pending.workspaceId, { planId, billingChannel: 'api' }),
  ).toThrow(/仅预留创建者/);
  expect(() => core.business.createOrder(actor, pending.workspaceId, { planId })).toThrow(
    /已有团队付款/,
  );
  core.business.cancelOrder(actor, pending.workspaceId, pending.order!.id);
  const next = reserve(planId);
  expect(next.pending?.workspaceId).toBe(pending.workspaceId);
  expect(next.pending?.order?.id).not.toBe(pending.order!.id);
  expect(db.sqlite.prepare("SELECT COUNT(*) n FROM workspaces WHERE kind='team'").get()).toEqual({
    n: 1,
  });
  expect(
    db.sqlite
      .prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?')
      .get(pending.workspaceId),
  ).toEqual({ n: 0 });
});
it('serializes independent connection reservations into the same team and rejects an already-owned transfer target', () => {
  configured();
  const planId = teamPlan();
  const secondDb = createDatabaseContext(join(folder, 'test.sqlite'));
  try {
    const otherCore = createCoreServices(secondDb, core.context.config);
    otherCore.business.setBilling({
      isConfigured: () => true,
      canCheckoutPlan: () => true,
      checkout: async () => {
        throw new Error('unused');
      },
      cancelSubscription: async () => {
        throw new Error('unused');
      },
      invoiceDocument: async () => {
        throw new Error('unused');
      },
    });
    const first = reserve(planId);
    const second = otherCore.teamCreation.reserve(actor, {
      name: 'Concurrent request',
      planId,
      expectedAmountMinor: 700,
      expectedCatalogVersion: 1,
    });
    expect(second.pending?.workspaceId).toBe(first.pending?.workspaceId);
    expect(second.pending?.order?.id).toBe(first.pending?.order?.id);
  } finally {
    closeDatabase(secondDb);
  }
});
it('preserves the original creation slot across transfer and refuses targets with another team', () => {
  const team = core.auth.createWorkspace(actor.userId, 'Legacy team', 'team');
  const uid = randomUUID(),
    other = { ...actor, userId: uid },
    date = new Date().toISOString();
  db.sqlite
    .prepare(
      'INSERT INTO users(id,email,password_hash,display_name,preferences_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(uid, 'member@example.test', 'fixture', 'Member', '{}', date, date);
  db.sqlite
    .prepare(
      "INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,'member',?,?)",
    )
    .run(randomUUID(), team.id, uid, date, date);
  core.team.transfer(actor, team.id, { userId: uid, confirm: true });
  expect(core.auth.listWorkspaces(other).find((w) => w.id === team.id)?.role).toBe('owner');
  expect(() => core.team.create(actor, { name: 'Again' })).toThrow(/已占用/);
  expect(() => core.team.create(other, { name: 'Again' })).toThrow(/已占用/);
  const legacySecond = core.auth.createWorkspace(actor.userId, 'Other legacy team', 'team');
  db.sqlite
    .prepare(
      "INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,'member',?,?)",
    )
    .run(randomUUID(), legacySecond.id, uid, date, date);
  expect(() => core.team.transfer(actor, legacySecond.id, { userId: uid, confirm: true })).toThrow(
    /已占用/,
  );
  expect(core.auth.listWorkspaces(actor).find((w) => w.id === legacySecond.id)?.role).toBe('owner');
});

it('enforces the same pending-team boundary through old HTTP endpoints', async () => {
  configured();
  const pending = reserve(teamPlan()).pending!;
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({ error: { code: error.code } });
    return reply.code(500).send({ error: { code: 'INTERNAL' } });
  });
  await registerCoreRoutes(app, core);
  const headers = {
    cookie: `studio_session=${core.auth.session(actor.userId)}`,
    'x-workspace-id': pending.workspaceId,
  };
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/workspaces',
          headers,
          payload: { name: 'Bypass' },
        })
      ).statusCode,
    ).toBe(409);
    for (const url of ['/api/v1/projects', '/api/v1/assets', '/api/v1/members']) {
      const response = await app.inject({ method: 'GET', url, headers });
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error.code).toBe('TEAM_NOT_ACTIVE');
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/workspaces/${pending.workspaceId}/activate`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/orders/${pending.order!.id}`, headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/orders/${pending.order!.id}/cancel`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/workspaces', headers }))
        .json()
        .data.items.some((w: { id: string }) => w.id === pending.workspaceId),
    ).toBe(false);
  } finally {
    await app.close();
  }
});

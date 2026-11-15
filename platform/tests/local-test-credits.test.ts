/** Local budget administration only: isolated SQLite; no payment or model requests. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';
import { createLocalTestCreditService } from '../src/server/tasks/local-test-credits';

let app: Awaited<ReturnType<typeof createApp>>, config: AppConfig, folder: string;
let actor: Actor, wid: string, cookie: string;
const network = vi.fn(() => {
  throw new Error('External calls forbidden');
});
beforeEach(async () => {
  vi.stubGlobal('fetch', network);
  network.mockClear();
  folder = await mkdtemp(join(tmpdir(), 'yingzao-local-credit-'));
  config = {
    host: '127.0.0.1',
    port: 4316,
    publicOrigin: 'http://127.0.0.1:5176',
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'local-credit-session-fixture',
    encryptionKey: 'local-credit-encryption-fixture',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
  };
  app = await createApp(config, { serveWeb: false });
  const account = await app.services.core.auth.register({
    email: 'installation-admin@example.local',
    password: 'LocalCreditFixture2026!',
    displayName: '安装管理员',
  });
  wid = account.workspace.id;
  cookie = `studio_session=${account.sessionToken}`;
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
});
afterEach(async () => {
  await app.app.close();
  await rm(folder, { recursive: true, force: true });
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
function request(
  method: 'GET' | 'POST',
  payload?: object,
  workspaceId = wid,
  session = cookie,
  remoteAddress = '127.0.0.1',
) {
  return app.app.inject({
    method,
    url: '/api/v1/credits/local-test-grant',
    headers: { cookie: session, origin: config.publicOrigin, 'x-workspace-id': workspaceId },
    remoteAddress,
    ...(payload ? { payload } : {}),
  });
}
function counts() {
  const sql = app.services.db.sqlite;
  return {
    web: app.services.credits.forChannel('web').account(wid).balance,
    api: app.services.credits.forChannel('api').account(wid).balance,
    grants: (
      sql
        .prepare("SELECT COUNT(*) n FROM credit_lots WHERE event_key LIKE 'local-test-grant:%'")
        .get() as { n: number }
    ).n,
    audits: (
      sql
        .prepare("SELECT COUNT(*) n FROM audit_events WHERE action='credits.local-test-grant'")
        .get() as { n: number }
    ).n,
    orders: (sql.prepare('SELECT COUNT(*) n FROM orders').get() as { n: number }).n,
  };
}

it('exposes availability only for this local installation administrator and credits the current web account', async () => {
  expect(counts()).toEqual({ web: 0, api: 0, grants: 0, audits: 0, orders: 0 });
  const availability = await request('GET');
  expect(availability.statusCode).toBe(200);
  expect(availability.headers['cache-control']).toContain('no-store');
  expect(availability.json().data).toEqual({ available: true, maxCredits: 100000, reason: null });
  const result = await request('POST', { amount: 1000, requestId: randomUUID() });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data).toMatchObject({
    granted: 1000,
    alreadyApplied: false,
    credits: { billingChannel: 'web', balance: 1000, available: 1000, reserved: 0 },
  });
  expect(counts()).toEqual({ web: 1000, api: 0, grants: 1, audits: 1, orders: 0 });
  const lot = app.services.db.sqlite
    .prepare(
      "SELECT source,granted,remaining,billing_channel FROM credit_lots WHERE event_key LIKE 'local-test-grant:%'",
    )
    .get();
  expect(lot).toEqual({ source: 'manual', granted: 1000, remaining: 1000, billing_channel: 'web' });
});

it('persists replay identity and rejects amount or workspace changes for the same request', async () => {
  const payload = { amount: 1000, requestId: randomUUID() };
  const responses = await Promise.all([request('POST', payload), request('POST', payload)]);
  expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(responses.map((r) => r.json().data.alreadyApplied).sort()).toEqual([false, true]);
  expect((await request('POST', { ...payload, amount: 2000 })).statusCode).toBe(409);
  const team = app.services.core.auth.createWorkspace(actor.userId, '隔离测试团队', 'team');
  expect((await request('POST', payload, team.id)).statusCode).toBe(409);
  expect(app.services.credits.account(team.id).balance).toBe(0);
  expect(counts()).toEqual({ web: 1000, api: 0, grants: 1, audits: 1, orders: 0 });
});

it.each([0, -1, 1.5, 100001, Number.MAX_SAFE_INTEGER])(
  'rejects invalid grant amount %s without changing budget',
  async (amount) => {
    expect((await request('POST', { amount, requestId: randomUUID() })).statusCode).toBe(400);
    expect(counts()).toEqual({ web: 0, api: 0, grants: 0, audits: 0, orders: 0 });
  },
);

it('accepts the exact upper bound and rejects client-selected target or billing channel fields', async () => {
  expect(
    (await request('POST', { amount: 100000, requestId: randomUUID(), userId: actor.userId }))
      .statusCode,
  ).toBe(400);
  expect(
    (await request('POST', { amount: 100000, requestId: randomUUID(), billingChannel: 'api' }))
      .statusCode,
  ).toBe(400);
  expect((await request('POST', { amount: 100000, requestId: randomUUID() })).statusCode).toBe(200);
  expect(counts().web).toBe(100000);
});

it.each(['production', 'public-host', 'public-origin', 'remote-peer'] as const)(
  'disables grants for %s deployment/request',
  async (mode) => {
    if (mode === 'production') config.isProduction = true;
    if (mode === 'public-host') config.host = '0.0.0.0';
    if (mode === 'public-origin') config.publicOrigin = 'https://studio.example';
    const peer = mode === 'remote-peer' ? '203.0.113.22' : '127.0.0.1';
    const availability = await request('GET', undefined, wid, cookie, peer);
    expect(availability.statusCode).toBe(200);
    expect(availability.json().data.available).toBe(false);
    expect(
      (await request('POST', { amount: 1000, requestId: randomUUID() }, wid, cookie, peer))
        .statusCode,
    ).toBe(403);
    expect(counts().web).toBe(0);
  },
);

it('does not grant installation privileges to another personal-space owner or team administrator', async () => {
  const team = app.services.core.auth.createWorkspace(actor.userId, '安装边界测试', 'team');
  const invite = app.services.core.team.invite(actor, team.id, {
    email: 'team-admin@example.local',
    role: 'admin',
  });
  const member = await app.services.core.auth.register({
    email: 'team-admin@example.local',
    password: 'LocalCreditFixture2026!',
    displayName: '团队管理员',
    inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
  });
  const memberCookie = `studio_session=${member.sessionToken}`;
  for (const target of [member.workspace.id, team.id]) {
    expect((await request('GET', undefined, target, memberCookie)).json().data.available).toBe(
      false,
    );
    expect(
      (await request('POST', { amount: 1000, requestId: randomUUID() }, target, memberCookie))
        .statusCode,
    ).toBe(403);
  }
  expect(counts()).toEqual({ web: 0, api: 0, grants: 0, audits: 0, orders: 0 });
});

it('requires authenticated web sessions, workspace access, and same-origin mutation', async () => {
  expect((await request('GET', undefined, wid, '')).statusCode).toBe(401);
  expect(
    (await request('POST', { amount: 1000, requestId: randomUUID() }, randomUUID())).statusCode,
  ).toBe(403);
  const foreign = await app.app.inject({
    method: 'POST',
    url: '/api/v1/credits/local-test-grant',
    headers: { cookie, origin: 'https://foreign.example', 'x-workspace-id': wid },
    payload: { amount: 1000, requestId: randomUUID() },
  });
  expect(foreign.statusCode).toBe(403);
  const apiKey = app.services.core.business.createKey(actor, wid, {
    name: '隔离测试密钥',
    scopes: ['credits:read'],
  });
  const keyActor: Actor = {
    ...actor,
    authType: 'apiKey',
    apiKeyId: apiKey.key.id,
    workspaceId: wid,
    scopes: ['credits:read'],
  };
  const service = createLocalTestCreditService(app.services);
  expect(service.availability(keyActor, wid, '127.0.0.1').available).toBe(false);
  expect(() =>
    service.grant(keyActor, wid, '127.0.0.1', { amount: 1000, requestId: randomUUID() }),
  ).toThrow('网页登录');
  expect(counts().web).toBe(0);
});

it('rolls back the grant if its mandatory audit cannot be written', async () => {
  const fail = vi.spyOn(app.services.core.context, 'audit').mockImplementation(() => {
    throw new Error('audit fixture failure');
  });
  const response = await request('POST', { amount: 1000, requestId: randomUUID() });
  expect(response.statusCode).toBe(500);
  expect(counts()).toEqual({ web: 0, api: 0, grants: 0, audits: 0, orders: 0 });
  fail.mockRestore();
});

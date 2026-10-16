/** Local SQLite and deterministic provider fixtures; no paid or external requests. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { createWorker } from '../src/worker/runner';
import type { ProviderAdapter } from '../src/server/tasks/types';

let folder: string;
let instance: Awaited<ReturnType<typeof createApp>>;
let actor: Actor;
let wid: string;
let cookie: string;
let png: Buffer;
const workers: ReturnType<typeof createWorker>[] = [];
const origin = 'http://127.0.0.1:5174';
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-takeover-'));
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: origin,
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'takeover-fixture-session',
    encryptionKey: 'takeover-fixture-encryption',
    isProduction: false,
    demoMode: true,
    environmentSecrets: {
      openai: 'fixture-not-a-real-key',
      fal: 'fixture-not-a-real-key',
      flyelep: 'fixture-not-a-real-key',
    },
  };
  instance = await createApp(config, { serveWeb: false });
  const registered = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: {
      email: 'takeover@example.local',
      password: 'TakeoverFixture2026!',
      displayName: '测试创作者',
    },
  });
  expect(registered.statusCode, registered.body).toBe(201);
  cookie = String(registered.headers['set-cookie']).split(';')[0]!;
  const user = registered.json().data;
  wid = user.workspace.id;
  actor = {
    userId: user.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#446655' } })
    .png()
    .toBuffer();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const worker of workers.splice(0)) await worker.stop();
  await instance.app.close();
  await rm(folder, { recursive: true, force: true });
});
const headers = (workspace = wid) => ({ cookie, origin, 'x-workspace-id': workspace });
function input(overrides: Record<string, unknown> = {}): JobInput {
  return jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: '商品创作',
    ...overrides,
  });
}
function worker(adapter: ProviderAdapter) {
  const value = createWorker(instance.services, { [adapter.id]: adapter });
  workers.push(value);
  return value;
}
describe('independent API accounting', () => {
  function keyActor(limit: number | null = null) {
    const value = instance.services.core.business.createKey(actor, wid, {
      name: 'channel fixture',
      scopes: ['jobs:read', 'jobs:write', 'credits:read'],
      creditLimit: limit,
    });
    return {
      value,
      api: {
        ...actor,
        authType: 'apiKey',
        apiKeyId: value.key.id,
        workspaceId: wid,
        scopes: value.key.scopes,
      } as Actor,
    };
  }
  it('starts API at zero and rejects web quotes before reserving', () => {
    const { api } = keyActor(8),
      web = instance.services.balance(actor, wid);
    expect(instance.services.balance(api, wid).balance).toBe(0);
    const value = input(),
      webQuote = instance.services.quote(actor, wid, value);
    expect(() => instance.services.submit(api, wid, value, webQuote.id, randomUUID())).toThrow();
    const apiQuote = instance.services.quote(api, wid, value);
    expect(() => instance.services.submit(api, wid, value, apiQuote.id, randomUUID())).toThrow();
    expect(instance.services.balance(actor, wid)).toEqual(web);
  });
  it('only session administrators can inspect the independent API account', async () => {
    const { value } = keyActor();
    const admin = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/credits/api',
      headers: headers(),
    });
    expect(admin.statusCode, admin.body).toBe(200);
    expect(admin.json().data.balance).toBe(0);
    const key = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/credits/api',
      headers: { authorization: `Bearer ${value.secret}`, 'x-workspace-id': wid },
    });
    expect(key.statusCode).toBe(403);
  });
  function fundApi(amount = 100) {
    instance.services.credits.forChannel('api').grant({
      workspaceId: wid,
      userId: actor.userId,
      eventKey: randomUUID(),
      amount,
      source: 'manual',
      description: 'Isolated API fixture',
    });
  }
  function apiSubmit(api: Actor, requestId = randomUUID()) {
    const value = input(),
      quote = instance.services.quote(api, wid, value);
    return {
      job: instance.services.submit(api, wid, value, quote.id, requestId),
      quote,
      value,
      requestId,
    };
  }
  it('isolates settlement, cancellation, retry, request identity and Key spending caps', async () => {
    const { api } = keyActor(16);
    fundApi();
    const web = instance.services.balance(actor, wid);
    const first = apiSubmit(api);
    expect(first.quote.billingChannel).toBe('api');
    expect(first.job.billingChannel).toBe('api');
    expect(instance.services.balance(api, wid)).toMatchObject({ balance: 100, reserved: 8 });
    expect(() =>
      instance.services.submit(actor, wid, first.value, first.quote.id, first.requestId),
    ).toThrow();
    const run = worker({
      id: 'openai',
      execute: async () => ({
        state: 'complete',
        outputs: [{ buffer: png, mimeType: 'image/png', name: 'fixture.png' }],
      }),
    });
    await run.runItem(run.claim()!);
    expect(instance.services.balance(api, wid)).toMatchObject({
      balance: 92,
      reserved: 0,
      spent: 8,
    });
    const second = apiSubmit(api);
    expect(() => apiSubmit(api)).toThrowError(/密钥/);
    instance.services.cancel(actor, wid, second.job.id);
    expect(instance.services.balance(api, wid)).toMatchObject({ balance: 92, reserved: 0 });
    expect(() => instance.services.retryQuote(actor, wid, second.job.id)).toThrowError(/计费渠道/);
    const retry = instance.services.retryQuote(api, wid, second.job.id);
    expect(() =>
      instance.services.submit(actor, wid, second.value, retry.id, randomUUID()),
    ).toThrow();
    expect(instance.services.balance(actor, wid)).toEqual(web);
    const apiLedger = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/credits/api/ledger',
      headers: headers(),
    });
    expect(
      apiLedger
        .json()
        .data.items.every((row: { billingChannel: string }) => row.billingChannel === 'api'),
    ).toBe(true);
    const webLedger = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/credits/ledger',
      headers: headers(),
    });
    expect(
      webLedger
        .json()
        .data.items.every((row: { billingChannel: string }) => row.billingChannel === 'web'),
    ).toBe(true);
    expect(
      instance.services.credits.buckets(wid).every((row) => row.billingChannel === 'web'),
    ).toBe(true);
    expect(
      instance.services.credits
        .forChannel('api')
        .buckets(wid)
        .every((row) => row.billingChannel === 'api'),
    ).toBe(true);
  });
  it('does not consume web free assistant quota for API requests or web allocated budgets', () => {
    const { api } = keyActor();
    fundApi();
    instance.services.credits.setMode(wid, 'allocated', actor.userId);
    instance.services.db.sqlite
      .prepare(
        "UPDATE entitlement_defaults SET limits_json=json_set(limits_json,'$.textAssistDailyFreeUnits',1)",
      )
      .run();
    const text = input({ operation: 'text.assist' });
    expect(instance.services.quote(actor, wid, text).maxCredits).toBe(0);
    const quote = instance.services.quote(api, wid, text);
    expect(quote.maxCredits).toBeGreaterThan(0);
    expect(() => instance.services.submit(api, wid, text, quote.id, randomUUID())).not.toThrow();
  });
  it('keeps expiry and operation replay within their frozen channel', () => {
    const credits = instance.services.credits,
      api = credits.forChannel('api'),
      eventKey = randomUUID();
    const raw = {
      workspaceId: wid,
      userId: actor.userId,
      eventKey,
      amount: 50,
      source: 'manual' as const,
      description: 'Channel expiry fixture',
    };
    credits.grant(raw);
    expect(() => api.grant(raw)).toThrowError(/原事件/);
    const lot = api.grant({
      ...raw,
      eventKey: randomUUID(),
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    expect(api.account(wid)).toEqual({ balance: 0, reserved: 0 });
    expect(credits.account(wid)).toEqual({ balance: 1050, reserved: 0 });
    expect(api.buckets(wid).find((row) => row.id === lot.lotId)?.status).toBe('expired');
  });
  it('denies non-administrator session access to API balance and sources', async () => {
    instance.services.db.sqlite
      .prepare("UPDATE memberships SET role='member' WHERE workspace_id=? AND user_id=?")
      .run(wid, actor.userId);
    for (const path of ['/credits/api', '/credits/api/ledger', '/credits/api/buckets']) {
      const res = await instance.app.inject({
        method: 'GET',
        url: `/api/v1${path}`,
        headers: headers(),
      });
      expect(res.statusCode, res.body).toBe(403);
    }
  });
});

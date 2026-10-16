/** Persistent database environment isolation; no provider/network is used. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createBillingService } from '../src/server/billing';
import { createCoreServices } from '../src/server/core';
import { createCreditService } from '../src/server/tasks/credits';
import { boundPaymentEnvironment, bindPaymentEnvironment } from '../src/server/billing/environment';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';
let folder: string,
  db: ReturnType<typeof createDatabaseContext>,
  core: ReturnType<typeof createCoreServices>,
  credits: ReturnType<typeof createCreditService>,
  config: AppConfig,
  actor: Actor,
  wid: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'payment-env-'));
  db = createDatabaseContext(join(folder, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  config = {
    storageDir: join(folder, 'media'),
    publicOrigin: 'http://127.0.0.1:5174',
    sessionSecret: 'fixture',
    isProduction: false,
    demoMode: false,
    billing: {},
  } as AppConfig;
  credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (w, u) => credits.initialize(w, u, 0),
  });
  const user = await core.auth.register({
    email: 'environment@example.local',
    password: 'Environment2027!',
    displayName: 'Environment fixture',
  });
  wid = user.workspace.id;
  actor = {
    userId: user.user.id,
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
const service = (environment?: 'test' | 'live') =>
  createBillingService(
    db,
    core,
    {
      ...config,
      billing: environment
        ? { stripeSecretKey: `sk_${environment}_fixture`, stripeWebhookSecret: 'whsec_fixture' }
        : {},
    },
    credits,
  );
function historical(environment: 'test' | 'live' | 'unbound', kind: 'credits' | 'subscription') {
  const id = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits) VALUES(?,?,?,?,?,?,?)',
    )
    .run(id, 'Historical fixture', kind, 100, 'USD', kind === 'subscription' ? 'month' : null, 100);
  const order = core.business.createOrder(actor, wid, { planId: id });
  db.sqlite
    .prepare("UPDATE orders SET status='paid',payment_environment=?,paid_at=? WHERE id=?")
    .run(environment, new Date().toISOString(), order.id);
}
it('does not bind disabled payments and then keeps enabled API/worker instances on one durable environment', () => {
  expect(service().isConfigured()).toBe(false);
  expect(boundPaymentEnvironment(db)).toBeUndefined();
  expect(service('test').isConfigured()).toBe(true);
  const second = createDatabaseContext(join(folder, 'test.sqlite'));
  try {
    expect(() => bindPaymentEnvironment(second, 'test')).not.toThrow();
    expect(() => bindPaymentEnvironment(second, 'live')).toThrowError(
      expect.objectContaining({ code: 'PAYMENT_DATABASE_ENVIRONMENT' }),
    );
    expect(boundPaymentEnvironment(second)).toBe('test');
  } finally {
    closeDatabase(second);
  }
  expect(() => service('live')).toThrowError(
    expect.objectContaining({ code: 'PAYMENT_DATABASE_ENVIRONMENT' }),
  );
  expect(service().environment?.()).toBe('test');
  expect(() => db.sqlite.prepare('DELETE FROM billing_environment_binding').run()).toThrow();
});
it.each(['credits', 'subscription'] as const)(
  'rejects live startup over legacy test %s purchases before a lock existed',
  (kind) => {
    historical('test', kind);
    expect(() => service('live')).toThrowError(
      expect.objectContaining({ code: 'PAYMENT_DATABASE_ENVIRONMENT' }),
    );
    expect(boundPaymentEnvironment(db)).toBeUndefined();
    expect(service('test').isConfigured()).toBe(true);
  },
);
it('requires explicit reconciliation for historical unverified or mixed payment environments', () => {
  historical('unbound', 'credits');
  expect(() => service('test')).toThrowError(
    expect.objectContaining({ code: 'PAYMENT_DATABASE_ENVIRONMENT' }),
  );
  expect(() => service('live')).toThrowError(
    expect.objectContaining({ code: 'PAYMENT_DATABASE_ENVIRONMENT' }),
  );
  expect(boundPaymentEnvironment(db)).toBeUndefined();
  expect(service().isConfigured()).toBe(false);
});

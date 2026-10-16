/** Isolated payment fixtures and temporary SQLite only; no external payment requests. */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Actor } from '../src/contracts/core';
import type { BillingChannel } from '../src/contracts/billing-channel';
import type { AppConfig } from '../src/server/config';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createCreditService, type CreditService } from '../src/server/tasks/credits';
import { createBillingService, type BillingService } from '../src/server/billing';
import { createBillingAdmin } from '../src/server/billing/admin';
import {
  checkoutSchema,
  chargeSchema,
  type CheckoutSession,
  type StripeGateway,
  type Charge,
} from '../src/server/billing/stripe-gateway';
let temp: string, db: DatabaseContext, core: CoreServices, credits: CreditService;
let billing: BillingService, actor: Actor, wid: string, planId: string;
let sessions: Map<string, CheckoutSession>, charge: Charge;
const query = { page: 1, pageSize: 100 };
const reason = 'Isolated operator verification of the payment channel and source evidence.';
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'yingzao-api-billing-'));
  db = createDatabaseContext(join(temp, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(temp, 'test.sqlite'),
    storageDir: join(temp, 'media'),
    sessionSecret: 'fixture-secret',
    encryptionKey: 'fixture-encryption',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
    billing: { stripeSecretKey: 'sk_test_fixture_only', stripeWebhookSecret: 'whsec_fixture_only' },
  };
  credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (w, u) => credits.initialize(w, u, 100),
  });
  const registered = await core.auth.register({
    email: 'api-billing@example.local',
    password: 'IsolatedPassword2026!',
    displayName: 'Billing fixture',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
  planId = randomUUID();
  db.sqlite
    .prepare(
      'INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,active) VALUES(?,?,?,?,?,?,?,?,1)',
    )
    .run(planId, 'Fixture package', 'credits', 9900, 'USD', null, 500, '{}');
  sessions = new Map();
  const gateway: StripeGateway = {
    verifyWebhook(raw) {
      return JSON.parse(raw.toString());
    },
    async createCheckout(params) {
      const price = params.line_items![0]!.price_data!,
        id = `cs_api_fixture_${sessions.size}`;
      const session = checkoutSchema.parse({
        id,
        mode: params.mode,
        payment_status: 'unpaid',
        status: 'open',
        amount_total: price.unit_amount,
        currency: price.currency,
        metadata: params.metadata,
        client_reference_id: params.client_reference_id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        payment_intent: null,
        subscription: null,
        customer: null,
        line_items: {
          has_more: false,
          data: [
            {
              quantity: 1,
              price: {
                unit_amount: price.unit_amount,
                currency: price.currency,
                recurring: price.recurring ?? null,
              },
            },
          ],
        },
      });
      sessions.set(id, session);
      return session;
    },
    async retrieveCheckout(id) {
      return sessions.get(id)!;
    },
    async retrieveCharge() {
      return charge;
    },
    async retrieveInvoice() {
      throw new Error('Unexpected invoice call');
    },
    async retrieveSubscription() {
      throw new Error('Unexpected subscription call');
    },
    async cancelSubscriptionAtPeriodEnd() {
      throw new Error('Unexpected cancellation call');
    },
  };
  billing = createBillingService(db, core, config, credits, gateway);
  core.business.setBilling(billing);
});
afterEach(async () => {
  closeDatabase(db);
  await rm(temp, { recursive: true, force: true });
});
function event(type: string, id: string, created = Math.floor(Date.now() / 1000)) {
  return billing.handleWebhook(
    Buffer.from(
      JSON.stringify({
        id: `evt_${randomUUID()}`,
        type,
        created,
        livemode: false,
        object: { id },
      }),
    ),
    'fixture-only',
  );
}
async function order(channel: BillingChannel) {
  const value = core.business.createOrder(actor, wid, { planId, billingChannel: channel });
  await billing.checkout(actor, wid, value.id);
  return { order: value, session: [...sessions.values()].at(-1)! };
}
function paid(session: CheckoutSession, intent = `pi_${session.id}`) {
  session.payment_status = 'paid';
  session.status = 'complete';
  session.payment_intent = intent;
}
async function refund(session: CheckoutSession) {
  charge = chargeSchema.parse({
    id: `ch_${session.id}`,
    payment_intent: session.payment_intent,
    amount: 9900,
    amount_refunded: 9900,
    refunded: true,
    currency: 'usd',
  });
  await event('charge.refunded', charge.id);
}
function hold(channel: BillingChannel) {
  return db.sqlite
    .prepare(
      'SELECT payment_review_required FROM credit_accounts WHERE workspace_id=? AND billing_channel=?',
    )
    .get(wid, channel);
}
describe('independent API billing account', () => {
  it('records the verified payment time when a webhook arrives later', async () => {
    const value = await order('web');
    paid(value.session);
    const paidAt = Math.floor(Date.now() / 1000) - 2 * 86400;
    await event('checkout.session.completed', value.session.id, paidAt);
    expect(core.business.getOrder(actor, wid, value.order.id).paidAt).toBe(
      new Date(paidAt * 1000).toISOString(),
    );
  });
  it('renews only the purchased account sources and preserves web package expiry', async () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const grant = (channel: BillingChannel) =>
      credits.forChannel(channel).grant({
        workspaceId: wid,
        userId: actor.userId,
        eventKey: `fixture:${channel}:${randomUUID()}`,
        amount: 20,
        source: 'pack',
        expiresAt,
        description: 'Isolated expiring package fixture',
      }).lotId!;
    const webLot = grant('web'),
      apiLot = grant('api');
    const value = await order('api');
    paid(value.session);
    await event('checkout.session.completed', value.session.id);
    expect(credits.buckets(wid).find((lot) => lot.id === webLot)?.expiresAt).toBe(expiresAt);
    expect(
      Date.parse(
        credits
          .forChannel('api')
          .buckets(wid)
          .find((lot) => lot.id === apiLot)!.expiresAt!,
      ),
    ).toBeGreaterThan(Date.parse(expiresAt));
    expect(credits.account(wid).balance).toBe(120);
    expect(credits.forChannel('api').account(wid).balance).toBe(520);
  });
  it('returns an approved API appeal to its original account and source exactly once', () => {
    const api = credits.forChannel('api'),
      jobId = randomUUID(),
      itemId = randomUUID();
    api.grant({
      workspaceId: wid,
      userId: actor.userId,
      eventKey: `fixture:${randomUUID()}`,
      amount: 100,
      source: 'manual',
      description: 'Isolated API appeal fixture',
    });
    api.reserve(wid, actor.userId, 10, jobId, itemId);
    api.finish(wid, actor.userId, 10, jobId, itemId, true);
    const date = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO jobs(id,workspace_id,user_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,settled_credits,created_at,updated_at,billing_channel) VALUES(?,?,?,'image.generate','fixture','','{}','fixture',?,'fixture','succeeded','complete',10,10,?,?,'api')",
      )
      .run(jobId, wid, actor.userId, randomUUID(), date, date);
    db.sqlite
      .prepare(
        "INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,credits,next_attempt_at,created_at,updated_at,billing_channel) VALUES(?,?,?,?,0,'{}','succeeded',10,?,?,?,'api')",
      )
      .run(itemId, jobId, wid, actor.userId, date, date, date);
    const ticket = core.business.createTicket(actor, wid, {
      subject: 'API settled item quality review',
      category: 'appeal',
      message: 'Review the original API task and return only its settled amount.',
      jobId,
    });
    const input = {
      actorUserId: actor.userId,
      workspaceId: wid,
      ticketId: ticket.id,
      decision: 'approved',
      reason,
      evidenceReference: 'fixture:api-appeal',
      items: [{ itemId, credits: 10 }],
    };
    const admin = createBillingAdmin(db);
    expect(api.account(wid).balance).toBe(90);
    expect(admin.resolveAppeal(input)).toMatchObject({
      refundedCredits: 10,
      alreadyProcessed: false,
    });
    expect(admin.resolveAppeal(input)).toMatchObject({ alreadyProcessed: true });
    expect(api.account(wid).balance).toBe(100);
    expect(credits.account(wid).balance).toBe(100);
    expect(api.buckets(wid)).toHaveLength(1);
    expect(credits.buckets(wid)).toHaveLength(1);
  });
  it('freezes the order channel and grants only API credits while retaining separate order lists', async () => {
    expect(credits.forChannel('api').account(wid).balance).toBe(0);
    const value = await order('api');
    expect(value.order.billingChannel).toBe('api');
    expect(value.session.metadata.billing_channel).toBe('api');
    expect(core.business.orders(actor, wid, query).total).toBe(0);
    expect(core.business.orders(actor, wid, query, 'api').total).toBe(1);
    paid(value.session);
    await event('checkout.session.completed', value.session.id);
    await event('checkout.session.completed', value.session.id);
    expect(credits.forChannel('api').account(wid).balance).toBe(500);
    expect(credits.account(wid).balance).toBe(100);
    expect(db.sqlite.prepare('SELECT billing_channel FROM billing_fulfillments').get()).toEqual({
      billing_channel: 'api',
    });
  });
  it('rejects explicit channel conflicts before granting, and accepts legacy missing channel metadata', async () => {
    const value = await order('api');
    paid(value.session);
    value.session.metadata.billing_channel = 'web';
    await expect(event('checkout.session.completed', value.session.id)).rejects.toMatchObject({
      code: 'PAYMENT_MISMATCH',
    });
    expect(credits.forChannel('api').account(wid).balance).toBe(0);
    delete value.session.metadata.billing_channel;
    await event('checkout.session.completed', value.session.id);
    expect(credits.forChannel('api').account(wid).balance).toBe(500);
    expect(credits.account(wid).balance).toBe(100);
  });
  it('keeps older web orders compatible and rejects API subscriptions and key-managed recharge', async () => {
    const legacy = core.business.createOrder(actor, wid, { planId });
    expect(legacy.billingChannel).toBe('web');
    await billing.checkout(actor, wid, legacy.id);
    const session = [...sessions.values()][0]!;
    delete session.metadata.billing_channel;
    paid(session);
    await event('checkout.session.completed', session.id);
    expect(credits.account(wid).balance).toBe(600);
    db.sqlite
      .prepare("UPDATE plans SET kind='subscription',interval='month' WHERE id=?")
      .run(planId);
    expect(() => core.business.createOrder(actor, wid, { planId, billingChannel: 'api' })).toThrow(
      expect.objectContaining({ code: 'API_SUBSCRIPTION_UNSUPPORTED' }),
    );
    expect(() =>
      core.business.createOrder(
        { ...actor, authType: 'apiKey', apiKeyId: 'invalid', workspaceId: wid },
        wid,
        { planId, billingChannel: 'api' },
      ),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(credits.forChannel('api').account(wid).balance).toBe(0);
  });
  it('holds and resolves API refund risk without touching the web account or its independent risk hold', async () => {
    const api = await order('api'),
      web = await order('web');
    paid(api.session);
    paid(web.session);
    await event('checkout.session.completed', api.session.id);
    await event('checkout.session.completed', web.session.id);
    await refund(api.session);
    expect(hold('api')).toEqual({ payment_review_required: 1 });
    expect(hold('web')).toEqual({ payment_review_required: 0 });
    expect(
      db.sqlite
        .prepare('SELECT payment_review_required FROM workspace_billing WHERE workspace_id=?')
        .get(wid),
    ).toEqual({ payment_review_required: 0 });
    await refund(web.session);
    const risks = db.sqlite.prepare('SELECT id,billing_channel FROM billing_risks').all() as {
      id: string;
      billing_channel: BillingChannel;
    }[];
    const admin = createBillingAdmin(db);
    const input = {
      actorUserId: actor.userId,
      workspaceId: wid,
      reason,
      evidenceReference: 'fixture:payment-channel',
      confirmedManuallyHandled: true,
      creditsToRevoke: 40,
    };
    expect(() => admin.resolveRisks({ ...input, riskIds: risks.map((r) => r.id) })).toThrow(
      expect.objectContaining({ code: 'BILLING_CHANNEL_MISMATCH' }),
    );
    admin.resolveRisks({
      ...input,
      riskIds: risks.filter((r) => r.billing_channel === 'api').map((r) => r.id),
    });
    expect(credits.forChannel('api').account(wid).balance).toBe(460);
    expect(credits.account(wid).balance).toBe(600);
    expect(hold('api')).toEqual({ payment_review_required: 0 });
    expect(hold('web')).toEqual({ payment_review_required: 1 });
  });
  it('links an early unbound refund back to the persisted API order before placing its hold', async () => {
    const api = await order('api');
    paid(api.session, 'pi_early_api');
    await refund(api.session);
    expect(hold('api')).toEqual({ payment_review_required: 0 });
    await event('checkout.session.completed', api.session.id);
    expect(
      db.sqlite.prepare('SELECT workspace_id,billing_channel FROM billing_risks').get(),
    ).toEqual({ workspace_id: wid, billing_channel: 'api' });
    expect(hold('api')).toEqual({ payment_review_required: 1 });
    expect(hold('web')).toEqual({ payment_review_required: 0 });
  });
});

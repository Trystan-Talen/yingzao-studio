/** Local workflow and accounting tests use synthetic records, not claims of external verification/payment. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import type { AppConfig } from '../src/server/config';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { IdentityService, type IdentityProvider } from '../src/server/core/identity';
import { createCreditService, type CreditService } from '../src/server/tasks/credits';
import { createBillingAdmin } from '../src/server/billing/admin';
import { createBillingService } from '../src/server/billing';
import { AppError } from '../src/server/errors';
let folder: string,
  db: DatabaseContext,
  core: CoreServices,
  credits: CreditService,
  actor: Actor,
  wid: string,
  config: AppConfig,
  admin: ReturnType<typeof createBillingAdmin>,
  png: Buffer;
const reason = 'Installation administrator reviewed and approved this configuration.';
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-quality-'));
  db = createDatabaseContext(join(folder, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'test-secret',
    encryptionKey: 'test-encryption',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
  };
  credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (w, u) => credits.initialize(w, u, 100),
  });
  const registered = await core.auth.register({
    email: 'owner@example.local',
    password: 'OwnerPassword2026!',
    displayName: 'Owner',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
  admin = createBillingAdmin(db);
  png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#886655' } })
    .png()
    .toBuffer();
});
afterEach(async () => {
  closeDatabase(db);
  await rm(folder, { recursive: true, force: true });
});
function program(enabled = true) {
  return admin.configureReferrals({
    actorUserId: actor.userId,
    reason,
    registrationEnabled: enabled,
    rewardsEnabled: enabled,
    rewardCredits: 50,
    minimumPaidMinor: 1000,
    currency: 'USD',
  });
}
async function referred() {
  program();
  const info = core.business.referrals(actor, wid);
  const reg = await core.auth.register({
    email: 'referred@example.local',
    password: 'ReferredPassword2026!',
    displayName: 'Referred',
    referralCode: info.inviteCode,
  });
  return { reg, ref: info, who: { ...actor, userId: reg.user.id } as Actor };
}
function importPlan() {
  const id = randomUUID();
  admin.importPlans({
    version: 1,
    actorUserId: actor.userId,
    reason,
    confirmCommercialCatalog: true,
    plans: [
      {
        id,
        name: 'Approved package',
        kind: 'credits',
        priceMinor: 2000,
        currency: 'USD',
        credits: 200,
        interval: null,
        limits: {},
        active: true,
      },
    ],
  });
  return id;
}
function paidOrder(who = actor, space = wid, planId = importPlan(), environment = 'live') {
  const order = core.business.createOrder(who, space, { planId });
  db.sqlite
    .prepare("UPDATE orders SET status='paid',payment_environment=? WHERE id=?")
    .run(environment, order.id);
  return order;
}
function qualify(orderId: string) {
  db.sqlite.transaction(() => core.referrals.qualifyPurchase(orderId)).immediate();
}
async function character() {
  const a = await core.assets.ingest(actor, wid, {
    buffer: png,
    name: 'reference.png',
    mimeType: 'image/png',
  });
  return core.references.createCharacter(actor, wid, {
    name: 'Reference',
    referenceAssetIds: [a.id],
  });
}
const authorization = {
  acknowledged: true,
  statementVersion: 'reference-use-v1',
  subjectRelationship: 'self',
};
describe('reference authorization is distinct from identity verification', () => {
  it('requires an explicit declaration and never creates a verification session without a configured provider', async () => {
    const item = await character();
    expect(item.authorization.status).toBe('not-declared');
    expect(() => core.identity.assertCanReference(actor, wid, item.id)).toThrow(AppError);
    expect(() =>
      core.identity.authorize(actor, wid, item.id, { ...authorization, acknowledged: false }),
    ).toThrow();
    core.identity.authorize(actor, wid, item.id, authorization);
    expect(core.identity.assertCanReference(actor, wid, item.id).referenceAssetIds).toEqual(
      item.referenceAssetIds,
    );
    expect(core.references.getCharacter(actor, wid, item.id).verification.status).toBe(
      'unverified',
    );
    await expect(core.identity.startVerification(actor, wid, item.id)).rejects.toMatchObject({
      code: 'FACE_PROVIDER_UNAVAILABLE',
    });
    expect(core.identity.verification(actor, wid, item.id)).toMatchObject({
      configured: false,
      sessions: [],
    });
  });
  it('revokes new references and binds consent to the actual asset revision while preserving renames', async () => {
    const item = await character();
    core.identity.authorize(actor, wid, item.id, authorization);
    core.references.updateCharacter(actor, wid, item.id, {
      name: 'Renamed',
      referenceAssetIds: item.referenceAssetIds,
    });
    expect(core.identity.getAuthorization(actor, wid, item.id).status).toBe('active');
    core.identity.withdraw(actor, wid, item.id, { reason: 'Consent revoked' });
    expect(() => core.identity.assertCanReference(actor, wid, item.id)).toThrow(AppError);
    core.identity.authorize(actor, wid, item.id, authorization);
    const a = await core.assets.ingest(actor, wid, {
      buffer: png,
      name: 'new.png',
      mimeType: 'image/png',
    });
    core.references.updateCharacter(actor, wid, item.id, { referenceAssetIds: [a.id] });
    expect(core.identity.getAuthorization(actor, wid, item.id)).toMatchObject({
      status: 'stale',
      referenceRevision: 2,
    });
    expect(core.references.getCharacter(actor, wid, item.id).verification.status).toBe(
      'unverified',
    );
  });
  it('accepts verification only from a server provider and rejects cross-space access and expired evidence', async () => {
    const item = await character();
    core.identity.authorize(actor, wid, item.id, authorization);
    const provider: IdentityProvider = {
      id: 'test-fixture',
      createSession: async () => ({
        id: 'remote-test',
        url: 'https://identity.example/session',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
      poll: async () => ({
        status: 'active',
        evidenceReference: 'fixture-proof',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    };
    const service = new IdentityService(core.context, provider);
    const started = await service.startVerification(actor, wid, item.id);
    expect(started.sessions[0]?.status).toBe('processing');
    await service.poll(actor, wid, item.id, started.sessions[0]!.id);
    expect(core.references.getCharacter(actor, wid, item.id).verification.status).toBe('verified');
    const other = core.team.create(actor, { name: 'Other' });
    expect(() => service.getAuthorization(actor, other.id, item.id)).toThrow(AppError);
    db.sqlite.prepare("UPDATE identity_sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
    db.sqlite
      .prepare("UPDATE character_profiles SET verification_expires_at='2000-01-01T00:00:00.000Z'")
      .run();
    expect(service.verification(actor, wid, item.id).sessions[0]?.status).toBe('expired');
    expect(core.references.getCharacter(actor, wid, item.id).verification.status).toBe('expired');
  });
});
describe('referral registration and configured live-purchase rewards', () => {
  it('keeps referral registration closed by default and attributes an enabled registration atomically', async () => {
    const code = core.business.referrals(actor, wid).inviteCode;
    expect(core.business.referrals(actor, wid)).toMatchObject({
      registrationEnabled: false,
      rewardsEnabled: false,
      providerConfigured: false,
    });
    await expect(
      core.auth.register({
        email: 'new@example.local',
        password: 'NewUserPassword2026!',
        displayName: 'New',
        referralCode: code,
      }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_CLOSED' });
    const { reg, ref } = await referred();
    expect(core.business.referrals(actor, wid).registeredCount).toBe(1);
    expect(core.auth.listWorkspaces({ ...actor, userId: reg.user.id })).toHaveLength(1);
    await expect(
      core.auth.register({
        email: 'referred@example.local',
        password: 'ReferredPassword2026!',
        displayName: 'Again',
        referralCode: ref.inviteCode,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_EXISTS' });
    expect(core.business.referrals(actor, wid).registeredCount).toBe(1);
    expect(() =>
      db.sqlite.transaction(() => core.referrals.attribute(actor.userId, code)).immediate(),
    ).toThrow(AppError);
  });
  it('rewards one first qualifying live purchase, never test payments, and exposes no invitee identity', async () => {
    const { reg, who } = await referred();
    const test = paidOrder(who, reg.workspace.id, importPlan(), 'test');
    qualify(test.id);
    expect(credits.account(wid).balance).toBe(100);
    const paid = paidOrder(who, reg.workspace.id);
    qualify(paid.id);
    qualify(paid.id);
    qualify(paidOrder(who, reg.workspace.id).id);
    expect(credits.account(wid).balance).toBe(150);
    expect(core.business.referrals(actor, wid)).toMatchObject({
      registeredCount: 1,
      qualifiedCount: 1,
      rewardCredits: 50,
    });
    const records = core.referrals.records(actor, wid, {});
    expect(records.items).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('referred@example.local');
    expect(records.items[0]?.qualified).toBe(true);
  });
  it('reverses partial refunds cumulatively and records debt instead of overdrawing reserved credits', async () => {
    const { reg, who } = await referred(),
      order = paidOrder(who, reg.workspace.id);
    qualify(order.id);
    db.sqlite
      .transaction(() => core.referrals.reversePurchase(order.id, 1000, 'refund-half'))
      .immediate();
    db.sqlite
      .transaction(() => core.referrals.reversePurchase(order.id, 1000, 'refund-half-duplicate'))
      .immediate();
    expect(credits.account(wid).balance).toBe(125);
    // Synthetic spend leaves only 10 available credits; the second half cannot be fully reclaimed.
    credits.debit({
      workspaceId: wid,
      userId: actor.userId,
      eventKey: 'fixture:consume-to-10',
      amount: credits.account(wid).balance - 10,
      description: 'Test fixture prior consumption',
    });
    db.sqlite
      .transaction(() => core.referrals.reversePurchase(order.id, 2000, 'refund-full'))
      .immediate();
    expect(credits.account(wid).balance).toBe(0);
    expect(
      db.sqlite.prepare('SELECT reversed_credits,debt_credits FROM referral_rewards').get(),
    ).toEqual({ reversed_credits: 50, debt_credits: 15 });
    expect(core.business.referrals(actor, wid).rewardCredits).toBe(0);
    expect(() => credits.reserve(wid, actor.userId, 1, randomUUID(), randomUUID())).toThrow(
      AppError,
    );
  });
  it('requires explicit channel approval and exports only authorized aggregate/opaque attribution records', async () => {
    await referred();
    expect(() => core.referrals.channelSummary(actor, wid)).toThrow(AppError);
    admin.approveChannel({
      actorUserId: actor.userId,
      userId: actor.userId,
      enabled: true,
      reason,
    });
    expect(core.referrals.channelSummary(actor, wid)).toMatchObject({
      registeredCount: 1,
      cashSettlementEnabled: false,
    });
    expect(core.referrals.channelCsv(actor, wid)).not.toContain('@');
    admin.approveChannel({
      actorUserId: actor.userId,
      userId: actor.userId,
      enabled: false,
      reason,
    });
    expect(() => core.referrals.channelCsv(actor, wid)).toThrow(AppError);
  });
  it('holds a referral recipient when a refund exceeds the remaining unallocated pool', async () => {
    const { reg, who } = await referred(),
      order = paidOrder(who, reg.workspace.id);
    qualify(order.id);
    credits.setMode(wid, 'allocated', actor.userId);
    credits.budget(wid, actor.userId, 150);
    db.sqlite
      .transaction(() => core.referrals.reversePurchase(order.id, 2000, 'refund-allocated'))
      .immediate();
    expect(credits.account(wid).balance).toBe(100);
    const risk = db.sqlite
      .prepare('SELECT id,kind FROM billing_risks WHERE workspace_id=?')
      .get(wid) as { id: string; kind: string };
    expect(risk.kind).toBe('referral-budget-reconciliation');
    const input = {
      actorUserId: actor.userId,
      workspaceId: wid,
      riskIds: [risk.id],
      reason,
      evidenceReference: 'merchant-reviewed:123',
      confirmedManuallyHandled: true,
    };
    expect(() => admin.resolveRisks(input)).toThrow(AppError);
    credits.budget(wid, actor.userId, 100);
    expect(admin.resolveRisks(input).holdReleased).toBe(true);
    expect(credits.account(wid).balance).toBe(100);
  });
});
describe('commercial approvals and manually resolved payment risks', () => {
  it('imports validated official plans with immutable order snapshots and rejects non-admin changes', async () => {
    const pid = importPlan(),
      order = core.business.createOrder(actor, wid, { planId: pid });
    const old = JSON.parse(
      (
        db.sqlite.prepare('SELECT plan_snapshot_json FROM orders WHERE id=?').get(order.id) as {
          plan_snapshot_json: string;
        }
      ).plan_snapshot_json,
    );
    admin.importPlans({
      version: 1,
      actorUserId: actor.userId,
      reason,
      confirmCommercialCatalog: true,
      plans: [
        {
          id: pid,
          name: 'Next version',
          kind: 'credits',
          priceMinor: 3000,
          currency: 'USD',
          credits: 300,
          interval: null,
        },
      ],
    });
    expect(old.catalog_mode).toBe('official');
    expect(old.price_minor).toBe(2000);
    expect(db.sqlite.prepare('SELECT catalog_version FROM plans WHERE id=?').get(pid)).toEqual({
      catalog_version: 2,
    });
    expect(() =>
      admin.importPlans({
        version: 1,
        actorUserId: randomUUID(),
        reason,
        confirmCommercialCatalog: true,
        plans: [
          {
            id: randomUUID(),
            name: 'Unapproved',
            kind: 'credits',
            priceMinor: 1,
            currency: 'USD',
            credits: 1,
            interval: null,
          },
        ],
      }),
    ).toThrow(AppError);
  });
  it('blocks cash checkout for demo/unapproved snapshots before making any Stripe request', async () => {
    const pid = importPlan();
    db.sqlite.prepare("UPDATE plans SET catalog_mode='demo',approved_at=NULL WHERE id=?").run(pid);
    const order = core.business.createOrder(actor, wid, { planId: pid });
    const billing = createBillingService(
      db,
      core,
      {
        ...config,
        billing: {
          stripeSecretKey: 'sk_live_fixture_no_network',
          stripeWebhookSecret: 'whsec_fixture',
        },
      },
      credits,
    );
    expect(billing.canCheckoutPlan(pid)).toBe(false);
    await expect(billing.checkout(actor, wid, order.id)).rejects.toMatchObject({
      code: 'UNAPPROVED_CATALOG',
    });
    expect(core.business.getOrder(actor, wid, order.id).status).toBe('draft');
  });
  it('resolves only the named manually handled risks and releases hold only after all risks are resolved', () => {
    const risks = [randomUUID(), randomUUID()];
    for (const id of risks)
      db.sqlite
        .prepare(
          'INSERT INTO billing_risks(id,provider_event_id,kind,workspace_id,created_at) VALUES(?,?,?,?,?)',
        )
        .run(id, `evt_${id}`, 'charge.dispute.created', wid, new Date().toISOString());
    db.sqlite
      .prepare('UPDATE workspace_billing SET payment_review_required=1 WHERE workspace_id=?')
      .run(wid);
    const input = {
      actorUserId: actor.userId,
      workspaceId: wid,
      riskIds: [risks[0]!],
      reason,
      evidenceReference: 'merchant-ticket:12345',
      confirmedManuallyHandled: true,
      creditsToRevoke: 10,
    };
    expect(() => admin.resolveRisks({ ...input, confirmedManuallyHandled: false })).toThrow();
    expect(admin.resolveRisks(input)).toMatchObject({ holdReleased: false, unresolved: 1 });
    expect(credits.account(wid).balance).toBe(90);
    expect(() => admin.resolveRisks(input)).toThrow(AppError);
    expect(() =>
      admin.resolveRisks({ ...input, riskIds: [risks[1]!], creditsToRevoke: 1000 }),
    ).toThrow(AppError);
    expect(
      admin.resolveRisks({ ...input, riskIds: [risks[1]!], creditsToRevoke: 0 }),
    ).toMatchObject({ holdReleased: true, unresolved: 0 });
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM operator_audit WHERE action='billing.risks-manually-resolved'",
        )
        .get(),
    ).toEqual({ n: 2 });
  });
});
describe('invoice requests stay local and reflect refundable amounts', () => {
  it('allocates only net paid amounts, registers local requests, and preserves withdrawn allocation history', () => {
    const order = paidOrder();
    db.sqlite.prepare('UPDATE orders SET refunded_minor=500 WHERE id=?').run(order.id);
    const title = core.business.createTitle(actor, wid, {
      type: 'personal',
      name: 'Invoice title',
      taxId: null,
      email: null,
    });
    const draft = core.business.createInvoice(actor, wid, {
      orderIds: [order.id],
      titleId: title.id,
    });
    expect(draft.amountMinor).toBe(1500);
    expect(core.business.getOrder(actor, wid, order.id).invoiceableMinor).toBe(0);
    const pending = core.business.submitInvoice(actor, wid, draft.id);
    expect(pending).toMatchObject({
      status: 'pending',
      providerConfigured: false,
      delivery: 'not-sent',
      downloadAvailable: false,
      fileUrl: null,
    });
    expect(core.business.submitInvoice(actor, wid, draft.id).events).toHaveLength(1);
    const withdrawn = core.business.withdrawInvoice(actor, wid, draft.id, {
      reason: 'Correcting request',
    });
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.orderIds).toEqual([order.id]);
    expect(core.business.getOrder(actor, wid, order.id).invoiceableMinor).toBe(1500);
    const next = core.business.createInvoice(actor, wid, {
      orderIds: [order.id],
      titleId: title.id,
    });
    expect(next.amountMinor).toBe(1500);
    expect(next.id).not.toBe(draft.id);
  });
});

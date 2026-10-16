import { createBillingPeriods } from '../src/server/billing/periods';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Actor } from '../src/contracts/core';
import {
  referralCredits,
  referralRefundTarget,
  referralPolicySchema,
  type ReferralPolicy,
} from '../src/contracts/referrals';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import { createCreditService, type CreditService } from '../src/server/tasks/credits';
import { createBillingAdmin } from '../src/server/billing/admin';

let dir: string, db: DatabaseContext, core: CoreServices, credits: CreditService;
let owner: Actor, ownerSpace: string, invitee: Actor, inviteeSpace: string;
let admin: ReturnType<typeof createBillingAdmin>;
const reason = 'Synthetic local fixture: explicitly approved referral configuration.';
const policy = referralPolicySchema.parse({
  kind: 'personal-first-subscription-v1',
  rounding: 'floor',
  membershipRequirement: 'none',
  evidenceReference: 'fixture: approved explicit eligibility and rounding',
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T00:00:00.000Z'));
  dir = await mkdtemp(join(tmpdir(), 'yingzao-referral-policy-'));
  db = createDatabaseContext(join(dir, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  credits = createCreditService(db);
  core = createCoreServices(
    db,
    {
      publicOrigin: 'http://127.0.0.1:5174',
      storageDir: join(dir, 'media'),
      sessionSecret: 'local-test-secret',
      isProduction: false,
      demoMode: false,
    },
    { onWorkspaceCreated: (w, u) => credits.initialize(w, u, 100) },
  );
  const registered = await core.auth.register({
    email: 'owner@example.local',
    password: 'ReferralOwner2026!',
    displayName: 'Owner',
  });
  owner = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  ownerSpace = registered.workspace.id;
  admin = createBillingAdmin(db);
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  closeDatabase(db);
  await rm(dir, { recursive: true, force: true });
});
async function refer(p: ReferralPolicy = policy) {
  admin.configureReferrals({
    actorUserId: owner.userId,
    reason,
    registrationEnabled: true,
    rewardsEnabled: true,
    rewardCredits: 0,
    minimumPaidMinor: 1,
    currency: 'USD',
    policy: p,
  });
  const code = core.business.referrals(owner, ownerSpace).inviteCode;
  const registered = await core.auth.register({
    email: 'invitee@example.local',
    password: 'ReferralInvitee2026!',
    displayName: 'Invitee',
    referralCode: code,
  });
  invitee = { ...owner, userId: registered.user.id };
  inviteeSpace = registered.workspace.id;
}
function order(
  options: {
    kind?: 'subscription' | 'credits';
    credits?: number;
    space?: string;
    paidAt?: string;
    environment?: string;
  } = {},
) {
  const planId = randomUUID(),
    kind = options.kind ?? 'subscription';
  admin.importPlans({
    version: 1,
    actorUserId: owner.userId,
    reason,
    confirmCommercialCatalog: true,
    plans: [
      {
        id: planId,
        name: 'Synthetic package',
        kind,
        priceMinor: 2000,
        currency: 'USD',
        credits: options.credits ?? 200,
        interval: kind === 'subscription' ? 'month' : null,
        active: true,
      },
    ],
  });
  const o = core.business.createOrder(invitee, options.space ?? inviteeSpace, { planId });
  db.sqlite
    .prepare("UPDATE orders SET status='paid',payment_environment=?,paid_at=? WHERE id=?")
    .run(options.environment ?? 'live', options.paidAt ?? new Date().toISOString(), o.id);
  return o;
}
function qualify(id: string) {
  db.sqlite.transaction(() => core.referrals.qualifyPurchase(id)).immediate();
}
function rewardItems() {
  return db.sqlite.prepare('SELECT * FROM referral_reward_items ORDER BY role').all() as {
    role: string;
    credits: number;
    workspace_id: string;
    expires_at: string;
    debt_credits: number;
    reversed_credits: number;
    credit_lot_id: string;
  }[];
}
describe('versioned personal subscription referral rewards', () => {
  it('defaults incomplete choices to blocked, with a precise public reason and no balance change', async () => {
    await refer(referralPolicySchema.parse({ kind: 'personal-first-subscription-v1' }));
    qualify(order().id);
    expect(rewardItems()).toEqual([]);
    expect(
      core.business.referrals(owner, ownerSpace).rewardRule?.missingConfiguration,
    ).toHaveLength(3);
    expect(core.referrals.records(owner, ownerSpace, {}).items[0]).toMatchObject({
      qualificationStatus: 'blocked',
    });
    expect(credits.account(ownerSpace).balance).toBe(100);
  });
  it('grants both percentages from immutable package credits once, to personal spaces, expiring in seven days', async () => {
    await refer();
    const o = order();
    db.sqlite
      .prepare('UPDATE plans SET credits=1000 WHERE id=(SELECT plan_id FROM orders WHERE id=?)')
      .run(o.id);
    qualify(o.id);
    qualify(o.id);
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
    qualify(order().id);
    const items = rewardItems();
    expect(items.map((i) => [i.role, i.credits, i.workspace_id])).toEqual([
      ['invitee', 20, inviteeSpace],
      ['referrer', 30, ownerSpace],
    ]);
    expect(items.every((i) => i.expires_at === '2026-10-08T00:00:00.000Z')).toBe(true);
    expect(credits.account(ownerSpace).balance).toBe(130);
    expect(credits.account(inviteeSpace).balance).toBe(120);
    vi.setSystemTime(new Date('2026-10-08T00:00:00.000Z'));
    expect(credits.account(ownerSpace).balance).toBe(100);
    expect(credits.account(inviteeSpace).balance).toBe(100);
  });
  it('does not apply a later configuration to an existing registration snapshot', async () => {
    await refer();
    admin.configureReferrals({
      actorUserId: owner.userId,
      reason,
      registrationEnabled: true,
      rewardsEnabled: true,
      rewardCredits: 100,
      minimumPaidMinor: 1,
      currency: 'USD',
      policy: null,
    });
    qualify(order().id);
    expect(rewardItems().map((i) => i.credits)).toEqual([20, 30]);
    expect(core.referrals.records(owner, ownerSpace, {}).items[0]?.rule.policy?.kind).toBe(
      policy.kind,
    );
  });
  it.each([
    ['inside', '2026-10-30T23:59:59.999Z', true],
    ['boundary', '2026-10-31T00:00:00.000Z', true],
    ['outside', '2026-10-31T00:00:00.001Z', false],
  ] as const)(
    'uses verified payment time even with a delayed callback: %s',
    async (_label, paidAt, eligible) => {
      await refer();
      const o = order({ paidAt });
      vi.setSystemTime(new Date('2026-11-05T00:00:00.000Z'));
      qualify(o.id);
      expect(rewardItems().length).toBe(eligible ? 2 : 0);
    },
  );
  it('excludes packs and test payments without consuming the first personal subscription opportunity', async () => {
    await refer();
    qualify(order({ kind: 'credits' }).id);
    qualify(order({ environment: 'test' }).id);
    expect(rewardItems()).toEqual([]);
    qualify(order().id);
    expect(rewardItems()).toHaveLength(2);
  });
  it('recognizes the first known actual purchase across personal spaces and after its refund', async () => {
    await refer();
    const earlier = order({ paidAt: '2026-10-02T00:00:00.000Z' });
    db.sqlite
      .prepare("UPDATE orders SET status='refunded',refunded_minor=amount_minor WHERE id=?")
      .run(earlier.id);
    const secondSpace = core.auth.createWorkspace(
      invitee.userId,
      'Second personal space',
      'personal',
    );
    const later = order({ space: secondSpace.id, paidAt: '2026-10-03T00:00:00.000Z' });
    qualify(later.id);
    expect(rewardItems()).toEqual([]);
    expect(core.referrals.records(owner, ownerSpace, {}).items[0]).toMatchObject({
      qualificationStatus: 'ineligible',
    });
  });
  it('holds an existing reward for review when a late callback reveals an earlier first purchase', async () => {
    await refer();
    const later = order({ paidAt: '2026-10-03T00:00:00.000Z' });
    qualify(later.id);
    const earlier = order({ paidAt: '2026-10-02T00:00:00.000Z' });
    qualify(earlier.id);
    qualify(earlier.id);
    expect(rewardItems()).toHaveLength(2);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM billing_risks WHERE kind='referral-first-purchase-conflict'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(core.referrals.records(owner, ownerSpace, {}).items[0]?.qualificationStatus).toBe(
      'blocked',
    );
    expect(() =>
      credits.reserve(ownerSpace, owner.userId, 1, randomUUID(), randomUUID()),
    ).toThrow();
  });
  it('excludes team and API purchases while keeping a later personal subscription eligible', async () => {
    await refer();
    const team = core.auth.createWorkspace(invitee.userId, 'Synthetic team', 'team');
    qualify(order({ space: team.id }).id);
    const api = order({ kind: 'credits' });
    db.sqlite.prepare("UPDATE orders SET billing_channel='api' WHERE id=?").run(api.id);
    qualify(api.id);
    expect(rewardItems()).toEqual([]);
    qualify(order().id);
    expect(rewardItems()).toHaveLength(2);
  });
  it('enforces the explicitly configured member requirement at the verified payment time', async () => {
    await refer({ ...policy, membershipRequirement: 'referrer-active-at-payment' });
    const o = order();
    qualify(o.id);
    expect(rewardItems()).toEqual([]);
    expect(core.referrals.records(owner, ownerSpace, {}).items[0]?.qualificationReason).toContain(
      '邀请人',
    );
    const planId = db.sqlite.prepare('SELECT plan_id FROM orders WHERE id=?').get(o.id) as {
      plan_id: string;
    };
    const membershipOrder = { ...o, id: randomUUID() };
    db.sqlite
      .prepare(
        "INSERT INTO orders(id,workspace_id,number,kind,status,amount_minor,currency,plan_id,plan_snapshot_json,created_by,created_at,updated_at,paid_at,payment_environment,billing_channel) SELECT ?,?,?,kind,'paid',amount_minor,currency,plan_id,plan_snapshot_json,?,?,?,?,'live','web' FROM orders WHERE id=?",
      )
      .run(
        membershipOrder.id,
        ownerSpace,
        `fixture-${membershipOrder.id}`,
        owner.userId,
        '2026-09-30T00:00:00.000Z',
        '2026-09-30T00:00:00.000Z',
        '2026-09-30T00:00:00.000Z',
        o.id,
      );
    db.sqlite
      .prepare(
        "INSERT INTO subscriptions(id,workspace_id,plan_id,status,current_period_start,current_period_end,created_at,updated_at,source_order_id) VALUES(?,?,?,'active',?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        ownerSpace,
        planId.plan_id,
        '2026-09-30T00:00:00.000Z',
        '2026-10-30T00:00:00.000Z',
        '2026-09-30T00:00:00.000Z',
        '2026-09-30T00:00:00.000Z',
        membershipOrder.id,
      );
    // Current subscription state alone cannot prove an earlier paid membership.
    qualify(o.id);
    expect(rewardItems()).toHaveLength(0);
    db.sqlite
      .transaction(() =>
        createBillingPeriods(db).record({
          orderId: membershipOrder.id,
          invoiceId: 'in_membership_fixture',
          subscriptionId: 'sub_membership_fixture',
          paidAt: '2026-09-30T00:00:00.000Z',
          periodStart: '2026-09-30T00:00:00.000Z',
          periodEnd: '2026-10-30T00:00:00.000Z',
        }),
      )
      .immediate();
    db.sqlite
      .prepare("UPDATE subscriptions SET status='canceled' WHERE source_order_id=?")
      .run(membershipOrder.id);
    qualify(o.id);
    expect(rewardItems()).toHaveLength(2);
  });
  it('records two independently resolvable debts without deducting other purchased credits', async () => {
    await refer();
    const o = order();
    qualify(o.id);
    credits.debit({
      workspaceId: ownerSpace,
      userId: owner.userId,
      eventKey: 'fixture:spend-referrer',
      amount: 30,
      description: 'Synthetic spend from expiring reward',
    });
    credits.debit({
      workspaceId: inviteeSpace,
      userId: invitee.userId,
      eventKey: 'fixture:spend-invitee',
      amount: 20,
      description: 'Synthetic spend from expiring reward',
    });
    db.sqlite
      .transaction(() => core.referrals.reversePurchase(o.id, 2000, 'full-consumed'))
      .immediate();
    expect(credits.account(ownerSpace).balance).toBe(100);
    expect(credits.account(inviteeSpace).balance).toBe(100);
    expect(rewardItems().map((i) => [i.role, i.debt_credits])).toEqual([
      ['invitee', 20],
      ['referrer', 30],
    ]);
    const risks = db.sqlite.prepare('SELECT id,workspace_id FROM billing_risks').all() as {
      id: string;
      workspace_id: string;
    }[];
    const input = {
      actorUserId: owner.userId,
      workspaceId: inviteeSpace,
      riskIds: risks.filter((r) => r.workspace_id === inviteeSpace).map((r) => r.id),
      reason,
      evidenceReference: 'fixture:manual-review',
      confirmedManuallyHandled: true,
    };
    expect(() => admin.resolveRisks({ ...input, creditsToRevoke: 19 })).toThrow();
    expect(admin.resolveRisks({ ...input, creditsToRevoke: 20 }).holdReleased).toBe(true);
    expect(rewardItems().map((i) => [i.role, i.debt_credits])).toEqual([
      ['invitee', 0],
      ['referrer', 30],
    ]);
    expect(() =>
      credits.reserve(ownerSpace, owner.userId, 1, randomUUID(), randomUUID()),
    ).toThrow();
  });
  it('does not extend referral expiry when a member buys another subscription', async () => {
    await refer();
    qualify(order().id);
    db.sqlite
      .transaction(() =>
        credits.renewSource(
          ownerSpace,
          owner.userId,
          'subscription',
          '2027-01-01T00:00:00.000Z',
          'fixture-renew',
        ),
      )
      .immediate();
    expect(rewardItems().every((i) => i.expires_at === '2026-10-08T00:00:00.000Z')).toBe(true);
    expect(
      credits
        .buckets(ownerSpace)
        .filter((i) => i.source === 'referral')
        .every((i) => i.expiresAt === '2026-10-08T00:00:00.000Z'),
    ).toBe(true);
  });
  it('rolls both rewards back if the second grant fails', async () => {
    await refer();
    const o = order();
    db.sqlite.exec(
      "CREATE TRIGGER fail_referral_item BEFORE INSERT ON referral_reward_items WHEN NEW.role='invitee' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    expect(() => qualify(o.id)).toThrow('fixture failure');
    expect(rewardItems()).toEqual([]);
    expect(credits.account(ownerSpace).balance).toBe(100);
  });
  it('reverses both rewards cumulatively and never consumes another credit source after expiry', async () => {
    await refer();
    const o = order();
    qualify(o.id);
    db.sqlite.transaction(() => core.referrals.reversePurchase(o.id, 1000, 'half')).immediate();
    db.sqlite
      .transaction(() => core.referrals.reversePurchase(o.id, 1000, 'half-again'))
      .immediate();
    expect(credits.account(ownerSpace).balance).toBe(115);
    expect(credits.account(inviteeSpace).balance).toBe(110);
    vi.setSystemTime(new Date('2026-10-09T00:00:00.000Z'));
    db.sqlite.transaction(() => core.referrals.reversePurchase(o.id, 2000, 'full')).immediate();
    expect(credits.account(ownerSpace).balance).toBe(100);
    expect(credits.account(inviteeSpace).balance).toBe(100);
    expect(rewardItems().map((i) => [i.reversed_credits, i.debt_credits])).toEqual([
      [20, 0],
      [30, 0],
    ]);
  });
});
it('requires an explicit integer rounding choice and calculates from credits without currency conversion', () => {
  expect(() => referralCredits(3, 1500, 'unconfigured')).toThrow();
  expect(referralCredits(3, 1500, 'floor')).toBe(0);
  expect(referralCredits(3, 1500, 'ceil')).toBe(1);
  expect(referralCredits(5, 1500, 'nearest')).toBe(1);
  expect(referralRefundTarget(150_000_000, 99_999_998, 99_999_999)).toBe(149_999_999);
  expect(referralRefundTarget(30, 1, 2000)).toBe(1);
});
it('migrates an already awarded fixed-rule database without rewriting snapshots or replaying grants', async () => {
  const migrationDir = join(dir, 'before-policy');
  await mkdir(migrationDir);
  for (const file of await readdir(resolve('migrations'))) {
    if (file.endsWith('.sql') && file < '0024')
      await copyFile(resolve('migrations', file), join(migrationDir, file));
  }
  const legacy = createDatabaseContext(join(dir, 'legacy.sqlite'));
  try {
    migrateDatabase(legacy, { migrationsDir: migrationDir });
    const legacyCredits = createCreditService(legacy);
    const old = createCoreServices(
      legacy,
      {
        publicOrigin: 'http://127.0.0.1:5174',
        storageDir: join(dir, 'legacy-media'),
        sessionSecret: 'test',
        isProduction: false,
        demoMode: false,
      },
      { onWorkspaceCreated: (w, u) => legacyCredits.initialize(w, u, 100) },
    );
    const a = await old.auth.register({
      email: 'old-owner@example.local',
      password: 'LegacyOwnerPassword2026!',
      displayName: 'Old owner',
    });
    const who: Actor = { ...owner, userId: a.user.id };
    // These rows model pre-0024 persistence; current management APIs require later tables.
    const oldCode = 'legacy-referral-fixture';
    legacy.sqlite
      .prepare('INSERT INTO referrals(id,user_id,code,created_at) VALUES(?,?,?,?)')
      .run(randomUUID(), who.userId, oldCode, new Date().toISOString());
    expect(
      (legacy.sqlite.pragma('table_info(referral_program)') as { name: string }[]).some(
        (column) => column.name === 'policy_json',
      ),
    ).toBe(false);
    expect(
      legacy.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='team_provisioning'").get(),
    ).toBeUndefined();
    legacy.sqlite
      .prepare(
        "UPDATE referral_program SET registration_enabled=1,rewards_enabled=1,reward_credits=50,minimum_paid_minor=1000 WHERE id='default'",
      )
      .run();
    const b = await old.auth.register({
      email: 'old-invitee@example.local',
      password: 'LegacyInviteePassword2026!',
      displayName: 'Old invitee',
      referralCode: oldCode,
    });
    const pid = randomUUID();
    legacy.sqlite
      .prepare(
        "INSERT INTO plans(id,name,kind,price_minor,currency,credits,interval,active,catalog_mode) VALUES(?,'Legacy approved package','credits',2000,'USD',200,NULL,1,'official')",
      )
      .run(pid);
    const o = { id: randomUUID() },
      oldPlan = legacy.sqlite.prepare('SELECT * FROM plans WHERE id=?').get(pid),
      createdAt = new Date().toISOString();
    legacy.sqlite
      .prepare(
        "INSERT INTO orders(id,workspace_id,number,kind,status,amount_minor,currency,plan_id,plan_snapshot_json,created_by,created_at,updated_at) VALUES(?,?,?,'credits','draft',2000,'USD',?,?,?,?,?)",
      )
      .run(
        o.id,
        b.workspace.id,
        `legacy-${o.id}`,
        pid,
        JSON.stringify(oldPlan),
        b.user.id,
        createdAt,
        createdAt,
      );
    legacy.sqlite
      .prepare("UPDATE orders SET status='paid',payment_environment='live' WHERE id=?")
      .run(o.id);
    legacy.sqlite.transaction(() => old.referrals.qualifyPurchase(o.id)).immediate();
    const snapshot = legacy.sqlite
      .prepare('SELECT program_snapshot_json FROM referral_attributions')
      .get();
    const rewards = legacy.sqlite.prepare('SELECT id,credits FROM referral_rewards').all();
    const oldGrants = legacy.sqlite.prepare('SELECT * FROM credit_lots ORDER BY id').all();
    const oldLedger = legacy.sqlite.prepare('SELECT * FROM credit_ledger ORDER BY id').all();
    expect(legacyCredits.account(a.workspace.id).balance).toBe(150);
    migrateDatabase(legacy, { migrationsDir: resolve('migrations') });
    migrateDatabase(legacy, { migrationsDir: resolve('migrations') });
    legacy.sqlite.transaction(() => old.referrals.qualifyPurchase(o.id)).immediate();
    expect(
      legacy.sqlite.prepare('SELECT program_snapshot_json FROM referral_attributions').get(),
    ).toEqual(snapshot);
    expect(legacy.sqlite.prepare('SELECT id,credits FROM referral_rewards').all()).toEqual(rewards);
    expect(legacy.sqlite.prepare('SELECT * FROM credit_lots ORDER BY id').all()).toEqual(oldGrants);
    expect(legacy.sqlite.prepare('SELECT * FROM credit_ledger ORDER BY id').all()).toEqual(
      oldLedger,
    );
    expect(legacy.sqlite.prepare('SELECT COUNT(*) n FROM referral_reward_items').get()).toEqual({
      n: 0,
    });
    expect(legacyCredits.account(a.workspace.id).balance).toBe(150);
  } finally {
    closeDatabase(legacy);
  }
});

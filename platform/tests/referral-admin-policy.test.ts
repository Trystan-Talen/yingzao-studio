import { it, expect } from 'vitest';
import { resolve } from 'node:path';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createBillingAdmin } from '../src/server/billing/admin';
import { referralPolicySchema } from '../src/contracts/referrals';
it('preserves selected policy on old operator updates and requires explicit null to select legacy rules', async () => {
  const db = createDatabaseContext(':memory:');
  try {
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    const core = createCoreServices(db, {
      storageDir: '/tmp/unused-policy-admin',
      sessionSecret: 'fixture',
      publicOrigin: 'http://127.0.0.1:5174',
      demoMode: false,
    } as never);
    const user = await core.auth.register({
      email: 'policy-admin@example.local',
      password: 'PolicyAdminFixture2026!',
      displayName: 'Policy fixture',
    });
    const admin = createBillingAdmin(db),
      policy = referralPolicySchema.parse({ kind: 'personal-first-subscription-v1' });
    const raw = {
      actorUserId: user.user.id,
      reason: 'Local isolated operator policy compatibility test',
      registrationEnabled: true,
      rewardsEnabled: true,
      rewardCredits: 0,
      minimumPaidMinor: 1,
      currency: 'CNY',
    };
    admin.configureReferrals({ ...raw, policy });
    const before = db.sqlite
      .prepare("SELECT policy_json FROM referral_program WHERE id='default'")
      .get();
    admin.configureReferrals({ ...raw, registrationEnabled: false });
    expect(
      db.sqlite.prepare("SELECT policy_json FROM referral_program WHERE id='default'").get(),
    ).toEqual(before);
    expect(() => admin.configureReferrals({ ...raw, policy: null })).toThrow();
    expect(
      db.sqlite.prepare("SELECT policy_json FROM referral_program WHERE id='default'").get(),
    ).toEqual(before);
    admin.configureReferrals({ ...raw, policy: null, rewardCredits: 10 });
    expect(
      db.sqlite.prepare("SELECT policy_json FROM referral_program WHERE id='default'").get(),
    ).toEqual({ policy_json: null });
  } finally {
    closeDatabase(db);
  }
});

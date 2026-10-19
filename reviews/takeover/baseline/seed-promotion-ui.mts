/** Explicit isolated UI fixtures; imports a test catalog only, never pays or grants credits. */
import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createDatabaseContext, closeDatabase } from '../../../platform/src/server/db/connection';
import { createBillingAdmin } from '../../../platform/src/server/billing/admin';
const root = resolve(import.meta.dirname, '../../..');
const path = join(root, 'platform/var/takeover/baseline-app/demo.sqlite');
const db = createDatabaseContext(path);
try {
  const migration = db.sqlite.prepare("SELECT checksum FROM schema_migrations WHERE name='0028-member-promotions.sql'").get() as { checksum: string } | undefined;
  if (migration?.checksum !== 'bf044c2943fde90d19f438d78db6d21d63a47ec072b053dd5a7b70396171dc2c') throw new Error('Wait for the frozen isolated migration; this script does not migrate databases');
  const actor = db.sqlite.prepare('SELECT user_id FROM installation_owner WHERE singleton=1').get() as { user_id: string };
  const disabling = process.argv.includes('--disable');
  const now = Date.now();
  const names = ['当前优惠', '尚未开始', '资格待配置', '活动已结束'];
  const plans = names.map((name, index) => ({
    id: `83a3487c-e8bc-4c3a-b15b-18492ee71b1${index}`,
    name: `测试夹具·${name}（不付款）`, kind: 'subscription' as const, priceMinor: 1000,
    currency: 'USD', credits: 100, interval: 'month' as const, limits: { concurrency: 3 }, active: !disabling,
    prepaidTerms: { months: 1, audience: 'personal', stacking: 'same-plan', timeBasis: 'utc-calendar-month', refundPolicy: 'proportional-duration', creditArchiveMonths: 3, creditValidity: 'same-plan-renewal' },
    promotion: { id: `7a5084dd-5ff4-44b6-93ed-f013a716627${index}`, version: 1, name: `本机界面验证·${name}`, enabled: !disabling,
      startsAt: new Date(now + (index === 1 ? 48 : index === 3 ? -48 : -1) * 3600000).toISOString(),
      endsAt: new Date(now + (index === 1 ? 72 : index === 3 ? -24 : 24) * 3600000).toISOString(), timeZone: 'Asia/Singapore', qualificationTime: 'checkout-start', priceMinor: 700,
      eligibility: index === 2 ? 'unconfigured' : 'all', refundedPurchasesCount: null,
      evidenceReference: 'isolated-ui-fixture: explicit local terms; not original pricing; no remote charge',
    },
  }));
  const result = createBillingAdmin(db).importPlans({ actorUserId: actor.user_id, reason: '明确标注的本机隔离界面测试夹具，仅检查展示与订单草稿，不付款、不发放额度。', version: 1, confirmCommercialCatalog: true, plans });
  await writeFile(join(root, 'reviews/takeover/baseline/promotion-ui-fixture.json'), JSON.stringify({ createdAt: new Date().toISOString(), disabled: disabling, plans: plans.map((p) => ({ id: p.id, name: p.name })), result }, null, 2) + '\n');
  console.log(JSON.stringify({ disabled: disabling, plans: plans.map((p) => ({ id: p.id, name: p.name })) }));
} finally { closeDatabase(db); }

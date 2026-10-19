import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { TRANSLATIONS } from '../../src/web/lib/i18n';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

const languages = [
  {
    id: 'en',
    membership: 'Fixed-term membership',
    duration: '3 months (one payment)',
    eligible: 'Currently eligible for this promotion',
    upcoming: 'The promotion has not started',
    first: 'The account’s first personal workspace membership purchase',
    order: 'Fixed term: 3 months · No automatic renewal',
    original: 'Original price',
    personal: 'Individual billing details',
    email: 'No email set',
    api: 'API credits and orders',
    webAccount: 'Web creation account',
    apiAccount: 'API credit account',
    confirm: 'Confirm plan',
    review: 'Review and save an order draft',
    referrals: 'Invitations and rewards',
    missing: 'Membership requirements are not configured',
    buckets:
      'Each membership credit lot follows its own contract’s expiry, archiving and renewal rules. Check the corresponding order terms.',
  },
  {
    id: 'ar',
    membership: 'عضوية محددة المدة',
    duration: '3 أشهر (دفعة واحدة)',
    eligible: 'تستوفي شروط العرض حاليًا',
    upcoming: 'لم يبدأ العرض بعد',
    first: 'أول شراء لعضوية مساحة شخصية لهذا الحساب',
    order: 'مدة محددة: 3 أشهر · دون تجديد تلقائي',
    original: 'السعر الأصلي',
    personal: 'بيانات فوترة فردية',
    email: 'لم يُحدد بريد إلكتروني',
    api: 'أرصدة الواجهة البرمجية والطلبات',
    webAccount: 'حساب الإنشاء عبر الويب',
    apiAccount: 'حساب أرصدة الواجهة البرمجية',
    confirm: 'تأكيد الخطة',
    review: 'مراجعة مسودة طلب وحفظها',
    referrals: 'الدعوات والمكافآت',
    missing: 'لم تُضبط متطلبات العضوية',
    buckets:
      'تتبع كل دفعة من أرصدة العضوية قواعد عقدها الخاصة بالانتهاء والأرشفة والتجديد. راجع شروط الطلب المقابل.',
  },
] as const;

async function account(page: Page, studio: Studio, locale: 'en' | 'ar') {
  const owner = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: owner.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  studio.services.core.auth.update(actor, { preferences: { locale } });
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return { owner, actor };
}

for (const language of languages) {
  test(`translates ${language.id} credit copy while keeping real values and user fields without starting payment`, async ({
    page,
    studio,
  }) => {
    const { owner } = await account(page, studio, language.id);
    const sql = studio.services.db.sqlite;
    const planId = randomUUID();
    const now = new Date().toISOString();
    const terms = {
      months: 3,
      audience: 'personal',
      stacking: 'same-plan',
      timeBasis: 'utc-calendar-month',
      refundPolicy: 'proportional-duration',
      creditArchiveMonths: 0,
      creditValidity: 'purchase-period',
    };
    const promotion = {
      id: randomUUID(),
      version: 1,
      // These intentionally match dictionary keys: administrator content stays unchanged.
      name: '活动已结束',
      enabled: true,
      startsAt: new Date(Date.now() - 86400000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      timeZone: 'Asia/Shanghai',
      qualificationTime: 'checkout-start',
      priceMinor: 12345,
      eligibility: 'first-personal-membership',
      refundedPurchasesCount: true,
      evidenceReference: 'Isolated synthetic locale fixture',
    };
    const insertPlan = sql.prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,active,catalog_mode,prepaid_terms_json,promotion_json) VALUES(?,?,'subscription',19999,'USD','month',321,'{}',1,'official',?,?)",
    );
    insertPlan.run(planId, '固定期会员', JSON.stringify(terms), JSON.stringify(promotion));
    insertPlan.run(
      randomUUID(),
      'Upcoming synthetic plan',
      JSON.stringify(terms),
      JSON.stringify({
        ...promotion,
        id: randomUUID(),
        startsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      }),
    );
    // Historical display fixtures only; no order/payment service is invoked.
    sql
      .prepare(
        "INSERT INTO orders(id,workspace_id,number,kind,status,amount_minor,currency,plan_id,plan_snapshot_json,created_by,created_at,updated_at) VALUES(?,?,?,'subscription','draft',12345,'USD',?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        owner.workspace.id,
        'SYNTHETIC-LOCALE-ORDER',
        planId,
        JSON.stringify({
          prepaid_terms_json: JSON.stringify(terms),
          promotion_snapshot: { definition: promotion, originalPriceMinor: 19999 },
        }),
        owner.user.id,
        now,
        now,
      );
    sql
      .prepare(
        "INSERT INTO invoice_titles(id,workspace_id,type,name,created_at,updated_at) VALUES(?,?,'personal','个人抬头',?,?)",
      )
      .run(randomUUID(), owner.workspace.id, now, now);
    const mutations: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/v1/') && request.method() !== 'GET')
        mutations.push(`${request.method()} ${url.pathname}`);
    });
    await page.goto(`${studio.origin}/usage?tab=plans`);
    await expect(page.locator('html')).toHaveAttribute('lang', language.id);
    const card = page
      .locator('.plan-card')
      .filter({ has: page.getByRole('heading', { name: '固定期会员', exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.badge')).toHaveText(language.membership);
    await expect(card.locator('h2')).toHaveText('固定期会员');
    await expect(card.locator('strong')).toHaveText('活动已结束');
    await expect(card).toContainText(language.duration);
    await expect(card).toContainText(language.eligible);
    await expect(card).toContainText(language.first);
    await expect(card).toContainText('Asia/Shanghai');
    const dates = [promotion.startsAt, promotion.endsAt].map((value) =>
      new Intl.DateTimeFormat(language.id, {
        timeZone: promotion.timeZone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value)),
    );
    for (const date of dates) await expect(card).toContainText(date);
    await expect(
      page.locator('.plan-card').filter({ hasText: 'Upcoming synthetic plan' }),
    ).toContainText(language.upcoming);
    const actualAmount = new Intl.NumberFormat(language.id, {
      style: 'currency',
      currency: 'USD',
    }).format(123.45);
    await expect(card.locator('.plan-price')).toContainText(actualAmount);
    await card.getByRole('button', { name: language.review, exact: true }).click();
    const modal = page.getByRole('dialog', { name: language.confirm, exact: true });
    await expect(modal).toContainText(actualAmount);
    await expect(modal).toContainText('固定期会员');
    await page.screenshot({
      path: `${studio.folder}/credits-plan-${language.id}.png`,
      fullPage: true,
    });
    await page.goto(`${studio.origin}/usage?tab=orders`);
    const row = page.locator('tbody tr').filter({ hasText: 'SYNTHETIC-LOCALE-ORDER' });
    await expect(row).toContainText(language.order);
    await expect(row).toContainText(language.original);
    await expect(row).toContainText('活动已结束');
    await expect(row).toContainText(actualAmount);
    await page.goto(`${studio.origin}/usage?tab=invoices`);
    const title = page.locator('.title-card');
    await expect(title.getByRole('heading', { name: '个人抬头', exact: true })).toBeVisible();
    await expect(title).toContainText(language.personal);
    await expect(title).toContainText(language.email);
    await page.goto(`${studio.origin}/usage?tab=buckets`);
    await expect(page.locator('.credit-buckets .notice')).toContainText(language.buckets);
    await page.goto(`${studio.origin}/usage?account=api`);
    await expect(page.getByRole('heading', { name: language.api, exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: language.webAccount, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: language.apiAccount, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${studio.folder}/credits-api-${language.id}.png`,
      fullPage: true,
    });
    expect(
      mutations.filter((request) => /orders|checkout|invoices|invoice-titles/.test(request)),
    ).toEqual([]);
    expect(sql.prepare('SELECT COUNT(*) n FROM orders').get()).toEqual({ n: 1 });
    expect(sql.prepare('SELECT COUNT(*) n FROM stripe_checkouts').get()).toEqual({ n: 0 });
  });

  test(`distinguishes ${language.id} historical zero-archive and three-month renewal contract copy`, async ({
    page,
    studio,
  }) => {
    await account(page, studio, language.id);
    const sql = studio.services.db.sqlite;
    const keys = {
      legacyCard: '一次付款，同档期限顺延；额度按各次购买对应期限到期，不封存。',
      renewalCard: '同档续费可叠加与恢复封存额度；到期封存3个月。',
      legacyNotice: '额度按本次购买对应期限到期，不封存；续购不会统一延长旧额度。',
      renewalNotice:
        '同档续费会延长仍有效的剩余额度，并恢复尚在3个月封存期内的额度；重新计算到期与封存时限，超过封存期清零的额度不恢复。',
    };
    const expected = (key: string) => {
      const text = TRANSLATIONS[key]?.[language.id];
      expect(text, `Missing ${language.id} dictionary key: ${key}`).toBeTruthy();
      expect(text).not.toBe(key);
      return text!;
    };
    const insert = sql.prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,active,catalog_mode,prepaid_terms_json) VALUES(?,?,'subscription',12345,'USD','month',321,'{}',1,'official',?)",
    );
    for (const variant of [
      {
        name: 'Historical local contract',
        creditArchiveMonths: 0,
        creditValidity: 'purchase-period',
      },
      {
        name: 'Current local renewal contract',
        creditArchiveMonths: 3,
        creditValidity: 'same-plan-renewal',
      },
    ]) {
      insert.run(
        randomUUID(),
        variant.name,
        JSON.stringify({
          months: 3,
          audience: 'personal',
          stacking: 'same-plan',
          timeBasis: 'utc-calendar-month',
          refundPolicy: 'proportional-duration',
          creditArchiveMonths: variant.creditArchiveMonths,
          creditValidity: variant.creditValidity,
        }),
      );
    }
    for (const [name, cardKey, noticeKey, opposite] of [
      ['Historical local contract', keys.legacyCard, keys.legacyNotice, keys.renewalNotice],
      ['Current local renewal contract', keys.renewalCard, keys.renewalNotice, keys.legacyNotice],
    ]) {
      await page.goto(`${studio.origin}/usage?tab=plans`);
      const card = page
        .locator('.plan-card')
        .filter({ has: page.getByRole('heading', { name, exact: true }) });
      await expect(card).toContainText(expected(cardKey!));
      await card.getByRole('button', { name: language.review, exact: true }).click();
      const modal = page.getByRole('dialog', { name: language.confirm, exact: true });
      await expect(modal).toContainText(expected(noticeKey!));
      await expect(modal).not.toContainText(expected(opposite!));
      await page.screenshot({
        path: `${studio.folder}/credits-contract-${language.id}-${name === 'Historical local contract' ? '0' : '3'}.png`,
        fullPage: true,
      });
    }
    expect(sql.prepare('SELECT COUNT(*) n FROM orders').get()).toEqual({ n: 0 });
    expect(sql.prepare('SELECT COUNT(*) n FROM stripe_checkouts').get()).toEqual({ n: 0 });
  });

  test(`translates ${language.id} referral membership configuration without enabling rewards`, async ({
    page,
    studio,
  }) => {
    await account(page, studio, language.id);
    const policy = {
      kind: 'personal-first-subscription-v1',
      rounding: 'floor',
      membershipRequirement: 'unconfigured',
      evidenceReference: 'Synthetic locale fixture; not a confirmed reward policy',
    };
    studio.services.db.sqlite
      .prepare("UPDATE referral_program SET policy_json=? WHERE id='default'")
      .run(JSON.stringify(policy));
    await page.goto(`${studio.origin}/support`);
    await page.getByRole('button', { name: language.referrals, exact: true }).click();
    await expect(page.locator('main')).toContainText(language.missing);
    await expect(page.locator('main')).not.toContainText('会员资格要求未配置');
    await page.screenshot({
      path: `${studio.folder}/credits-referral-${language.id}.png`,
      fullPage: true,
    });
    expect(
      studio.services.db.sqlite
        .prepare("SELECT rewards_enabled FROM referral_program WHERE id='default'")
        .get(),
    ).toEqual({ rewards_enabled: 0 });
    expect(
      studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM referral_rewards').get(),
    ).toEqual({ n: 0 });
  });
}

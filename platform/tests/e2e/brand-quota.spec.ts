import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { test, expect, type Studio } from './fixtures';
import { t } from '../../src/web/lib/i18n';

test.use({ recoveryEnabled: false, smsEnabled: false });
async function session(page: Page, studio: Studio, token: string) {
  await page
    .context()
    .addCookies([
      { name: 'studio_session', value: token, url: studio.origin, httpOnly: true, sameSite: 'Lax' },
    ]);
  await page.goto(`${studio.origin}/brands`);
}
const actorFor = (id: string): Actor => ({
  userId: id,
  authType: 'session',
  apiKeyId: null,
  workspaceId: null,
  scopes: [],
});
const card = (page: Page, name: string) =>
  page.locator('.identity-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
async function create(page: Page, name: string) {
  await page.getByRole('button', { name: '创建品牌', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建品牌', exact: true });
  await dialog.getByLabel('品牌名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '保存品牌', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page, name)).toBeVisible();
}
async function remove(page: Page, name: string) {
  await card(page, name).getByRole('button', { name: '删除', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除这个品牌？', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(card(page, name)).toHaveCount(0);
}
async function memberContract(studio: Studio) {
  const owner = await studio.existingIdentitySession(),
    core = studio.services.core,
    sql = studio.services.db.sqlite;
  const actor = actorFor(owner.user.id),
    workspace = core.auth.createWorkspace(owner.user.id, '本机品牌合同团队', 'team');
  const invite = core.team.invite(actor, workspace.id, {
    email: 'member-brand@example.test',
    role: 'member',
  });
  const member = await core.auth.register({
    email: 'member-brand@example.test',
    password: 'BrandMemberFixture2026!',
    displayName: 'Brand member',
    inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
  });
  for (const id of [owner.user.id, member.user.id])
    sql
      .prepare(
        "UPDATE users SET active_workspace_id=?,preferences_json=json_set(preferences_json,'$.onboardingCompleted',json('true')) WHERE id=?",
      )
      .run(workspace.id, id);
  const date = new Date(Date.now() - 60_000).toISOString(),
    end = new Date(Date.now() + 30 * 86400_000).toISOString(),
    pid = randomUUID();
  const terms = {
    months: 1,
    audience: 'team',
    stacking: 'same-plan',
    timeBasis: 'utc-calendar-month',
    refundPolicy: 'proportional-duration',
    creditArchiveMonths: 3,
    creditValidity: 'same-plan-renewal',
  };
  sql
    .prepare(
      "INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,prepaid_terms_json,catalog_mode,catalog_version,approved_at,approved_by) VALUES(?,'本机明确成员品牌合同','subscription',100,'USD','month',0,?,?,'official',1,?,?)",
    )
    .run(
      pid,
      JSON.stringify({ brands: 2, brandQuotaScope: 'member' }),
      JSON.stringify(terms),
      date,
      owner.user.id,
    );
  const order = core.business.createOrder(actor, workspace.id, { planId: pid });
  sql
    .prepare("UPDATE orders SET status='paid',payment_environment='live',paid_at=? WHERE id=?")
    .run(date, order.id);
  sql
    .prepare(
      "INSERT INTO subscriptions(id,workspace_id,plan_id,status,current_period_start,current_period_end,provider_id,created_at,updated_at,source_order_id) VALUES(?,?,?,'active',?,?,'stripe-prepaid',?,?,?)",
    )
    .run(randomUUID(), workspace.id, pid, date, end, date, date, order.id);
  return { owner, member, actor, wid: workspace.id };
}

test('enforces per-member brand quotas in real create/delete/restore controls without making a payment', async ({
  page,
  studio,
}) => {
  const { owner, member, actor, wid } = await memberContract(studio);
  await session(page, studio, owner.sessionToken);
  await expect(page.locator('[aria-label="品牌额度"]')).toContainText('每成员品牌上限');
  await create(page, 'Owner品牌一');
  await create(page, 'Owner品牌二');
  await expect(page.getByRole('button', { name: '创建品牌', exact: true })).toBeDisabled();
  const forced = await page.request.post(`${studio.origin}/api/v1/brands`, {
    headers: { origin: studio.origin, 'x-workspace-id': wid },
    data: { name: '不可超额' },
  });
  expect(forced.status()).toBe(409);
  await session(page, studio, member.sessionToken);
  await create(page, 'Member品牌一');
  await create(page, 'Member品牌二');
  await expect(page.getByRole('button', { name: '创建品牌', exact: true })).toBeDisabled();
  await session(page, studio, owner.sessionToken);
  await remove(page, 'Owner品牌一');
  await create(page, 'Owner替补品牌');
  const trash = page.getByRole('button', { name: '回收记录', exact: true });
  await trash.click();
  await card(page, 'Owner品牌一').getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByText('已达到对应合同的品牌数量上限', { exact: true })).toBeVisible();
  await expect(card(page, 'Owner品牌一')).toBeVisible();
  await trash.click();
  await remove(page, 'Owner替补品牌');
  await trash.click();
  await card(page, 'Owner品牌一').getByRole('button', { name: '恢复', exact: true }).click();
  await expect(card(page, 'Owner品牌一')).toHaveCount(0);
  await trash.click();
  await expect(card(page, 'Owner品牌一')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建品牌', exact: true })).toBeDisabled();
  for (const locale of ['en', 'ar'] as const) {
    const labels = {
      en: { deletedRecords: 'Deleted records', restore: 'Restore', empty: 'No deleted records' },
      ar: {
        deletedRecords: 'السجلات المحذوفة',
        restore: 'استعادة',
        empty: 'لا توجد سجلات محذوفة',
      },
    }[locale];
    studio.services.core.auth.update(actor, { preferences: { locale } });
    await page.reload();
    const summary = page.locator(`[aria-label="${t('品牌额度', locale)}"]`);
    await expect(summary).toContainText(t('每成员品牌上限', locale));
    expect(await summary.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    await expect(card(page, 'Owner品牌一')).toBeVisible();
    await expect(card(page, 'Owner品牌一').locator('.identity-body > p')).toHaveText(
      t('为下一次创作建立一致的视觉参考。', locale),
    );
    await expect(card(page, 'Owner品牌一').locator('.brand-collage')).toHaveAttribute(
      'aria-label',
      `${t('编辑品牌', locale)} Owner品牌一`,
    );
    await page.getByRole('button', { name: labels.deletedRecords, exact: true }).click();
    const deletedCard = card(page, 'Owner替补品牌');
    await expect(
      deletedCard.getByRole('heading', { name: 'Owner替补品牌', exact: true }),
    ).toBeVisible();
    await expect(deletedCard.locator('.identity-body > p')).toHaveText(
      t('为下一次创作建立一致的视觉参考。', locale),
    );
    expect(
      (await deletedCard.locator('.badge, .brand-colors, .card-actions').allTextContents()).join(
        ' ',
      ),
    ).not.toMatch(/[\u4e00-\u9fff]/);
    await deletedCard.getByRole('button', { name: labels.restore, exact: true }).click();
    await expect(
      page.getByText(
        locale === 'en'
          ? 'The brand limit for the applicable contract has been reached.'
          : 'تم بلوغ حد العلامات التجارية للعقد المعمول به.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: join(studio.folder, `brand-quota-${locale}.png`),
      fullPage: true,
    });
    await page
      .getByRole('textbox', { name: t('搜索品牌', locale), exact: true })
      .fill('no-brand-match');
    await expect(page.getByRole('heading', { name: labels.empty, exact: true })).toBeVisible();
    expect(await page.locator('.empty').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
  }
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM billing_fulfillments').get(),
  ).toEqual({ n: 0 });
});

test('preserves brand editors through delayed reads and saves, handles missing references and removes assets without submitting', async ({
  page,
  studio,
}) => {
  const owner = await studio.existingIdentitySession(),
    core = studio.services.core,
    actor = actorFor(owner.user.id),
    wid = owner.workspace.id;
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#9a557b' } })
    .png()
    .toBuffer();
  const asset = await core.assets.ingest(actor, wid, {
    buffer: png,
    name: 'brand-reference.png',
    mimeType: 'image/png',
  });
  const a = core.references.createBrand(actor, wid, {
    name: 'Brand A',
    visibility: 'private',
    referenceAssetIds: [asset.id],
  });
  const b = core.references.createBrand(actor, wid, { name: 'Brand B' });
  await session(page, studio, owner.sessionToken);
  const dialog = page.getByRole('dialog', { name: '品牌参考', exact: true });
  let release!: () => void, saw!: () => void;
  const hold = new Promise<void>((resolve) => {
      release = resolve;
    }),
    seen = new Promise<void>((resolve) => {
      saw = resolve;
    });
  await page.route(
    `**/api/v1/assets/${asset.id}`,
    async (route) => {
      const response = await route.fetch();
      saw();
      await hold;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await card(page, a.name).getByRole('button', { name: '编辑品牌', exact: true }).click();
  await seen;
  await expect(dialog.getByRole('button', { name: '保存品牌', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '关闭', exact: true }).first().click();
  await card(page, b.name).getByRole('button', { name: '编辑品牌', exact: true }).click();
  await dialog.getByLabel('品牌名称', { exact: true }).fill('B当前草稿');
  release();
  await expect(dialog.locator('.asset-chip')).toHaveCount(0);
  await expect(dialog.getByLabel('品牌名称', { exact: true })).toHaveValue('B当前草稿');
  await dialog.getByRole('button', { name: '关闭', exact: true }).first().click();
  await page.route(
    `**/api/v1/assets/${asset.id}`,
    (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'FIXTURE_LOAD_FAILED', message: '品牌读取失败夹具' },
        }),
      }),
    { times: 1 },
  );
  await card(page, a.name).getByRole('button', { name: '编辑品牌', exact: true }).click();
  await expect(dialog).toContainText('品牌读取失败夹具');
  await expect(dialog.getByRole('button', { name: '保存品牌', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog.locator('.asset-chip')).toHaveCount(1);
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && new URL(r.url()).pathname === `/api/v1/brands/${a.id}`) writes++;
  });
  await dialog.getByRole('button', { name: '移除brand-reference.png', exact: true }).click();
  await expect(dialog.locator('.asset-chip')).toHaveCount(0);
  expect(writes).toBe(0);
  expect(core.references.getBrand(actor, wid, a.id).referenceAssetIds).toEqual([asset.id]);
  await dialog.getByRole('button', { name: '关闭', exact: true }).first().click();
  core.assets.remove(actor, wid, asset.id);
  await card(page, a.name).getByRole('button', { name: '编辑品牌', exact: true }).click();
  await expect(dialog).toContainText('明确移除失效引用');
  await expect(dialog.getByRole('button', { name: '保存品牌', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: /移除失效引用/ }).click();
  let releaseSave!: () => void, sawSave!: () => void;
  const saved = new Promise<void>((resolve) => {
      sawSave = resolve;
    }),
    saveHold = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
  await page.route(
    `**/api/v1/brands/${a.id}`,
    async (route) => {
      const response = await route.fetch();
      sawSave();
      await saveHold;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await dialog.getByRole('button', { name: '保存品牌', exact: true }).click();
  await saved;
  await dialog.getByRole('button', { name: '关闭', exact: true }).first().click();
  await card(page, b.name).getByRole('button', { name: '编辑品牌', exact: true }).click();
  await dialog.getByLabel('品牌名称', { exact: true }).fill('B仍在编辑，不可被A响应关闭');
  releaseSave();
  await expect(dialog.getByRole('button', { name: '保存品牌', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('品牌名称', { exact: true })).toHaveValue(
    'B仍在编辑，不可被A响应关闭',
  );
  expect(core.references.getBrand(actor, wid, a.id).referenceAssetIds).toEqual([]);
  expect(core.references.getBrand(actor, wid, a.id).visibility).toBe('private');
  await page.screenshot({ path: join(studio.folder, 'brand-recovery-races.png'), fullPage: true });
});

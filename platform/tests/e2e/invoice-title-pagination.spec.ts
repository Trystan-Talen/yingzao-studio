import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { createBillingAdmin } from '../../src/server/billing/admin';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function titles(page: Page, studio: Studio) {
  const account = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: account.user.id,
    authType: 'session',
    workspaceId: null,
    apiKeyId: null,
    scopes: [],
  };
  const wid = account.workspace.id;
  const core = studio.services.core;
  const saved = Array.from({ length: 101 }, (_, index) => {
    const title = core.business.createTitle(actor, wid, {
      type: 'personal',
      name: `隔离分页抬头${String(index + 1).padStart(3, '0')}`,
    });
    studio.services.db.sqlite
      .prepare('UPDATE invoice_titles SET updated_at=? WHERE id=?')
      .run(new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(), title.id);
    return title;
  });
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/usage?tab=invoices`);
  return { actor, wid, core, oldest: saved[0]! };
}

test('reaches and edits a saved invoice title beyond the first 100 records', async ({
  page,
  studio,
}) => {
  const { actor, wid, core, oldest } = await titles(page, studio);
  expect(core.business.titles(actor, wid, {}).total).toBe(101);
  await expect(page.getByRole('heading', { name: oldest.name, exact: true })).toHaveCount(0);
  // The record exists, so a user must have an actual path to the next page.
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  const list = page.getByRole('region', { name: '已保存抬头', exact: true });
  const card = list.locator('.title-card').filter({ hasText: oldest.name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '编辑抬头', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('抬头名称').fill('旧抬头仍可编辑');
  await editor.getByRole('button', { name: '保存抬头', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(core.business.titles(actor, wid, { pageSize: 100 }).items).toContainEqual(
    expect.objectContaining({ id: oldest.id, name: '旧抬头仍可编辑' }),
  );
  await list.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(list.getByRole('heading', { name: '旧抬头仍可编辑', exact: true })).toBeVisible();
});

test('keeps an off-page selected title for an actual invoice and clears it after deleting the last-page title', async ({
  page,
  studio,
}) => {
  const { actor, wid, core, oldest } = await titles(page, studio);
  const planId = randomUUID();
  createBillingAdmin(studio.services.db).importPlans({
    actorUserId: actor.userId,
    reason: 'Synthetic local invoice-title pagination fixture; no external payment.',
    version: 1,
    confirmCommercialCatalog: true,
    plans: [
      {
        id: planId,
        name: '隔离抬头分页额度包',
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
  const order = core.business.createOrder(actor, wid, { planId });
  studio.services.db.sqlite
    .prepare("UPDATE orders SET status='paid',payment_environment='test' WHERE id=?")
    .run(order.id);
  await page.getByRole('button', { name: '申请发票', exact: true }).click();
  const request = page.getByRole('dialog', { name: '申请发票', exact: true });
  const select = request.getByRole('combobox', { name: '发票抬头', exact: true });
  await expect(select.locator(`option[value="${oldest.id}"]`)).toHaveCount(0);
  await request.getByRole('button', { name: '下一页', exact: true }).click();
  const picker = request.getByRole('region', { name: '已保存抬头', exact: true });
  await select.selectOption(oldest.id);
  await picker.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(select).toHaveValue(oldest.id);
  await expect(select.locator(`option[value="${oldest.id}"]`)).toHaveText(oldest.name);
  await request.getByRole('checkbox', { name: new RegExp(order.number) }).check();
  await request.getByRole('button', { name: '保存发票申请', exact: true }).click();
  await expect(request).toHaveCount(0);
  const invoice = core.business.invoices(actor, wid, {}).items[0]!;
  expect(invoice).toMatchObject({
    titleSnapshot: { id: oldest.id, name: oldest.name },
    amountMinor: 2000,
    orderIds: [order.id],
  });
  const list = page.getByRole('region', { name: '已保存抬头', exact: true });
  await list.getByRole('button', { name: '下一页', exact: true }).click();
  await list
    .locator('.title-card')
    .filter({ hasText: oldest.name })
    .getByRole('button', { name: '删除抬头', exact: true })
    .click();
  await expect(list.locator('.title-card')).toHaveCount(100);
  expect(core.business.titles(actor, wid, {}).total).toBe(100);
  await page.getByRole('button', { name: '申请发票', exact: true }).click();
  await expect(select).toHaveValue('');
  await expect(select.locator(`option[value="${oldest.id}"]`)).toHaveCount(0);
  expect(core.business.invoice(actor, wid, invoice.id).titleSnapshot).toMatchObject({
    name: oldest.name,
  });
});

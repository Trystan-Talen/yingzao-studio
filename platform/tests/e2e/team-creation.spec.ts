import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createBillingAdmin } from '../../src/server/billing/admin';
import type { Actor } from '../../src/contracts/core';
import { test, expect, type Studio } from './fixtures';
test.use({ recoveryEnabled: false, smsEnabled: false });
async function account(page: Page, studio: Studio) {
  const owner = await studio.existingIdentitySession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const actor: Actor = {
    userId: owner.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  return { owner, actor };
}
function plan(studio: Studio, actor: Actor) {
  const id = randomUUID();
  createBillingAdmin(studio.services.db).importPlans({
    actorUserId: actor.userId,
    reason: 'Explicit local browser team purchase fixture. No external payment.',
    version: 1,
    confirmCommercialCatalog: true,
    plans: [
      {
        id,
        name: '测试夹具·团队会员（不付款）',
        kind: 'subscription',
        priceMinor: 700,
        currency: 'USD',
        credits: 100,
        interval: 'month',
        limits: { seats: 20, concurrency: 4 },
        prepaidTerms: {
          months: 1,
          audience: 'team',
          stacking: 'same-plan',
          timeBasis: 'utc-calendar-month',
          refundPolicy: 'proportional-duration',
          creditArchiveMonths: 3,
          creditValidity: 'same-plan-renewal',
        },
      },
    ],
  });
  return id;
}
async function open(page: Page, studio: Studio) {
  await page.goto(`${studio.origin}/team`);
  await page.getByRole('button', { name: '创建团队', exact: true }).click();
  return page.getByRole('dialog', { name: '创建团队空间' });
}
test('shows missing team contract and payment configuration without creating a usable team', async ({
  page,
  studio,
}, info) => {
  const { actor } = await account(page, studio);
  const dialog = await open(page, studio);
  await expect(
    dialog.getByText('尚未配置明确适用于团队的固定期会员套餐，暂不可开通团队。'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存团队开通订单' })).toBeDisabled();
  const id = plan(studio, actor);
  await dialog.getByRole('button', { name: '刷新套餐' }).click();
  await dialog.getByLabel('团队会员套餐').selectOption(id);
  await expect(dialog.getByText('支付服务未配置，暂不可开通团队')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存团队开通订单' })).toBeDisabled();
  expect(
    studio.services.db.sqlite.prepare("SELECT COUNT(*) n FROM workspaces WHERE kind='team'").get(),
  ).toEqual({ n: 0 });
  await page.screenshot({
    path: join(studio.folder, `${info.project.name}-team-creation-unconfigured.png`),
    fullPage: true,
  });
});
test('recovers the same unpaid team order after refresh and lets its creator close the draft', async ({
  page,
  studio,
}, info) => {
  const { actor } = await account(page, studio);
  const id = plan(studio, actor);
  const never = async (): Promise<never> => {
    throw new Error('No external payment in browser fixture');
  };
  studio.services.core.business.setBilling({
    isConfigured: () => true,
    canCheckoutPlan: () => true,
    environment: () => 'test',
    checkout: never,
    cancelSubscription: never,
    invoiceDocument: never,
  });
  let dialog = await open(page, studio);
  await dialog.getByLabel('团队名称').fill('测试夹具·待开通团队');
  await dialog.getByLabel('团队会员套餐').selectOption(id);
  const reservations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/team-creation'))
      reservations.push(request.url());
  });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' && response.url().endsWith('/api/v1/team-creation'),
    ),
    dialog.getByRole('button', { name: '刷新套餐' }).click(),
  ]);
  expect(reservations, 'Refreshing available plans must never save a purchase reservation').toEqual(
    [],
  );
  expect(studio.services.core.teamCreation.status(actor).pending).toBeNull();
  await dialog.getByRole('button', { name: '保存团队开通订单' }).click();
  await expect(dialog.getByText('订单草稿已保存，尚未付款或开通团队。')).toBeVisible();
  const before = studio.services.core.teamCreation.status(actor).pending!;
  expect(
    studio.services.core.auth.listWorkspaces(actor).some((w) => w.id === before.workspaceId),
  ).toBe(false);
  dialog = await open(page, studio);
  await expect(dialog.getByText(before.order!.number, { exact: false })).toBeVisible();
  expect(studio.services.core.teamCreation.status(actor).pending?.order?.id).toBe(before.order!.id);
  await page.screenshot({
    path: join(studio.folder, `${info.project.name}-team-order-recovered.png`),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: '关闭未付款草稿' }).click();
  await expect(dialog.getByText('原订单已关闭，尚未开通团队；可重新选择套餐。')).toBeVisible();
  expect(
    studio.services.db.sqlite
      .prepare('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?')
      .get(before.workspaceId),
  ).toEqual({ n: 0 });
});
test('guides a legacy team owner into the existing team instead of offering another creation', async ({
  page,
  studio,
}, info) => {
  const { actor } = await account(page, studio);
  const team = studio.services.core.auth.createWorkspace(actor.userId, '测试夹具·已有团队', 'team');
  const dialog = await open(page, studio);
  await expect(
    dialog.getByText('此账号已占用一个团队名额，已有团队保持可用；转让或解散不会恢复名额。'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存团队开通订单' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '进入已有团队', exact: false }).click();
  await expect(page.getByRole('heading', { name: team.name, exact: true })).toBeVisible();
  await page.screenshot({
    path: join(studio.folder, `${info.project.name}-team-existing-guidance.png`),
    fullPage: true,
  });
});

test('translates the team gate in English and Arabic while preserving user team names', async ({
  page,
  studio,
}, info) => {
  const { actor } = await account(page, studio);
  const userTeamName = '用户团队名保持原样';
  for (const language of [
    {
      locale: 'en',
      create: 'Create team',
      title: 'Create team workspace',
      existing: 'Open existing team',
    },
    {
      locale: 'ar',
      create: 'إنشاء فريق',
      title: 'إنشاء مساحة عمل للفريق',
      existing: 'فتح الفريق الحالي',
    },
  ] as const) {
    studio.services.core.auth.update(actor, { preferences: { locale: language.locale } });
    await page.goto(`${studio.origin}/team`);
    await page.getByRole('button', { name: language.create, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: language.title });
    await expect(dialog).toBeVisible();
    expect((await dialog.innerText()).replaceAll(userTeamName, '')).not.toMatch(/[\u3400-\u9fff]/u);
    if (language.locale === 'en') {
      studio.services.core.auth.createWorkspace(actor.userId, userTeamName, 'team');
      await page.goto(`${studio.origin}/team`);
      await page.getByRole('button', { name: language.create, exact: true }).click();
    }
    await expect(dialog.getByRole('button', { name: new RegExp(language.existing) })).toContainText(
      userTeamName,
    );
    expect((await dialog.innerText()).replaceAll(userTeamName, '')).not.toMatch(/[\u3400-\u9fff]/u);
    await page.screenshot({
      path: join(studio.folder, `${info.project.name}-team-gate-${language.locale}.png`),
      fullPage: true,
    });
  }
});

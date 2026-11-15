import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { LocalTestGrantInput } from '../../src/contracts/local-test-credits';
import { test, expect, type Studio } from './fixtures';

async function openUsage(
  page: Page,
  studio: Studio,
  email = 'local-credit-owner@example.test',
  inviteToken?: string,
) {
  const account = await studio.services.core.auth.register({
    email,
    password: 'LocalCreditFixture2026!',
    displayName: '本机额度验收',
    ...(inviteToken ? { inviteToken } : {}),
  });
  studio.services.core.auth.update(
    { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    { preferences: { onboardingCompleted: true, theme: 'dark' } },
  );
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/usage`);
  return account;
}

test('the local installation owner adds internal credits once and sees the refreshed balance', async ({
  page,
  studio,
}) => {
  const account = await openUsage(page, studio);
  let submitted: LocalTestGrantInput | undefined;
  let submissions = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/v1/credits/local-test-grant'
    ) {
      submissions++;
      submitted = request.postDataJSON() as LocalTestGrantInput;
    }
  });
  await page.getByRole('button', { name: '增加测试额度', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '增加测试额度', exact: true });
  await expect(modal).toContainText('不是现金或模型服务商余额');
  const amount = modal.getByRole('spinbutton', { name: /^增加积分/ });
  await expect(amount).toHaveValue('1000');
  await amount.fill('25');
  await modal
    .getByRole('button', { name: '确认增加', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(modal).toHaveCount(0);
  expect(submissions).toBe(1);
  await expect(page.locator('.stat-card.primary-stat strong')).toHaveText('25');
  const replay = await page.request.post(`${studio.origin}/api/v1/credits/local-test-grant`, {
    headers: { origin: studio.origin, 'x-workspace-id': account.workspace.id },
    data: submitted,
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data).toMatchObject({
    alreadyApplied: true,
    granted: 25,
    credits: { balance: 25 },
  });
  expect(
    studio.services.db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM credit_ledger WHERE description='本地测试额度（内部预算，无现金价值）'",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM orders').get()).toEqual({
    n: 0,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: join(studio.folder, 'local-test-credit-balance.png'),
    fullPage: true,
  });
});

test('a lost credit response survives reload and retries the same request without duplicate credit', async ({
  page,
  studio,
}) => {
  await openUsage(page, studio);
  const requests: LocalTestGrantInput[] = [];
  let loseResponse = true;
  await page.route('**/api/v1/credits/local-test-grant', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON() as LocalTestGrantInput);
    if (!loseResponse) return route.continue();
    loseResponse = false;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    await route.fulfill({
      status: 503,
      json: { error: { code: 'FIXTURE_LOST_RESPONSE', message: '模拟回执丢失，核对同一次增加。' } },
    });
  });
  await page.getByRole('button', { name: '增加测试额度', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '增加测试额度', exact: true });
  await modal.getByRole('spinbutton', { name: /^增加积分/ }).fill('42');
  await modal.getByRole('button', { name: '确认增加', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('模拟回执丢失');
  await page.reload();
  await page.getByRole('button', { name: '增加测试额度', exact: true }).click();
  modal = page.getByRole('dialog', { name: '增加测试额度', exact: true });
  await expect(modal.getByRole('spinbutton', { name: /^增加积分/ })).toHaveValue('42');
  await expect(modal.getByRole('spinbutton', { name: /^增加积分/ })).toBeDisabled();
  await modal.getByRole('button', { name: '核对此次增加', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(page.locator('.stat-card.primary-stat strong')).toHaveText('42');
  expect(
    studio.services.db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM credit_ledger WHERE description='本地测试额度（内部预算，无现金价值）'",
      )
      .get(),
  ).toEqual({ n: 1 });
});

test('a workspace owner without installation ownership has no local grant control', async ({
  page,
  studio,
}) => {
  const owner = await studio.services.core.auth.register({
    email: 'installation-owner@example.test',
    password: 'LocalCreditFixture2026!',
    displayName: '安装管理员',
  });
  const actor = {
    userId: owner.user.id,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const team = studio.services.core.auth.createWorkspace(owner.user.id, '隔离权限检查', 'team');
  const invite = studio.services.core.team.invite(actor, team.id, {
    email: 'different-owner@example.test',
    role: 'admin',
  });
  const account = await openUsage(
    page,
    studio,
    'different-owner@example.test',
    new URL(invite.inviteUrl).hash.slice('#token='.length),
  );
  const permission = await page.request.get(`${studio.origin}/api/v1/credits/local-test-grant`, {
    headers: { 'x-workspace-id': account.workspace.id },
  });
  expect(permission.status()).toBe(200);
  expect((await permission.json()).data.available).toBe(false);
  await expect(page.getByRole('button', { name: '兑换额度', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '增加测试额度', exact: true })).toHaveCount(0);
  expect(
    studio.services.db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM credit_ledger WHERE description='本地测试额度（内部预算，无现金价值）'",
      )
      .get(),
  ).toEqual({ n: 0 });
});

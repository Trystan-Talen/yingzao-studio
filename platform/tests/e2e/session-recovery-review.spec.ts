import { test, expect } from './fixtures';

test('forgot-password navigation and return to login work without reloading', async ({
  page,
  studio,
}) => {
  await studio.existingIdentitySession();
  await page.goto(`${studio.origin}/login`);
  await page.getByRole('link', { name: '忘记密码？', exact: true }).click();
  await expect(page).toHaveURL(`${studio.origin}/password/forgot`);
  await expect(page.getByRole('heading', { name: '忘记密码', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回登录', exact: true }).click();
  await expect(page).toHaveURL(`${studio.origin}/login`);
  await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '忘记密码', exact: true })).toBeVisible();
  expect(studio.smtp.messages).toHaveLength(0);
});

test('session retry returns to login when a temporary server error becomes an expired session', async ({
  page,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  let unavailable = true;
  await page.route('**/api/v1/auth/me', async (route) => {
    if (!unavailable) return route.continue();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '隔离测试：服务暂不可用' } }),
    });
  });
  await page.goto(`${studio.origin}/login`);
  await expect(page.getByRole('alert')).toContainText('隔离测试：服务暂不可用');
  unavailable = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('邮箱', { exact: true }).fill(account.user.email);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录工作空间', exact: true }).click();
  await expect(page.getByRole('main')).toBeVisible();
  expect((await page.request.get(`${studio.origin}/api/v1/auth/me`)).status()).toBe(200);
});

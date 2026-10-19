import { test, expect } from './fixtures';

const initialPassword = 'BrowserOriginal2026!';
const nextPassword = 'BrowserReplacement2026!';

test('new user recovers through a real local email, loses old sessions and logs in with the new password', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('Browser owner');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-owner@example.test');
  await page.getByLabel(/^密码/).fill(initialPassword);
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await expect
    .poll(() => studio.services.db.sqlite.prepare('SELECT count(*) n FROM users').get())
    .toEqual({ n: 1 });
  await expect(page.getByRole('button', { name: '创建并开始创作' })).toHaveCount(0);
  await page.goto(`${studio.origin}/password/forgot`);
  await page.getByLabel('账户邮箱').fill('browser-owner@example.test');
  await page.getByRole('button', { name: '申请密码恢复邮件' }).click();
  await expect(
    page.getByText('如果此邮箱可通过密码恢复，你将收到恢复邮件。', { exact: false }),
  ).toBeVisible();
  const token = await studio.latestToken();
  await studio.restartWorker();
  await page.goto(`${studio.origin}/password/reset#token=${token}`);
  await page.reload();
  await page.getByLabel(/^新密码/).fill(nextPassword);
  await page.getByLabel('确认新密码', { exact: true }).fill('DoesNotMatch2026!');
  await page.getByRole('button', { name: '保存密码并退出会话' }).click();
  await expect(page.getByText('两次输入的密码不一致', { exact: true })).toBeVisible();
  expect(
    studio.services.db.sqlite.prepare('SELECT consumed_at FROM password_requests').get(),
  ).toEqual({ consumed_at: null });
  await page.getByLabel('确认新密码', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: '保存密码并退出会话' }).click();
  await expect(page).toHaveURL(`${studio.origin}/login?password=changed`);
  expect(
    studio.services.db.sqlite
      .prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL')
      .get(),
  ).toEqual({ n: 0 });
  const replay = await page.request.post(`${studio.origin}/api/v1/auth/password/complete`, {
    headers: { origin: studio.origin },
    data: { token, newPassword: nextPassword, confirmPassword: nextPassword },
  });
  expect(replay.status()).toBe(400);
  await page.getByLabel('邮箱', { exact: true }).fill('browser-owner@example.test');
  await page.getByLabel('密码', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByText('邮箱或密码错误', { exact: true })).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page).toHaveURL(`${studio.origin}/`);
  expect((await page.request.get(`${studio.origin}/api/v1/auth/me`)).status()).toBe(200);
  expect(studio.services.db.sqlite.prepare('SELECT password_revision FROM users').get()).toEqual({
    password_revision: 1,
  });
});

test('Google-only fixture must keep its login until mailbox proof adds a local password in the initiating browser', async ({
  page,
  context,
  browser,
  studio,
}) => {
  const account = await studio.googleOnlySession();
  await context.addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/settings`);
  await expect(
    page.getByText('此账户通过 Google 创建，尚未设置本地密码，不能解除唯一登录方式。', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '解除 Google 关联', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '发送设置本地密码邮件' }).click();
  const token = await studio.latestToken();
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto(`${studio.origin}/password/reset#token=${token}`);
    await other.getByLabel(/^新密码/).fill(nextPassword);
    await other.getByLabel('确认新密码', { exact: true }).fill(nextPassword);
    await other.getByRole('button', { name: '保存密码并退出会话' }).click();
    await expect(
      other.getByText('请在发起设置的同一浏览器登录会话中打开链接，或重新登录并申请', {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      studio.services.db.sqlite.prepare('SELECT consumed_at FROM password_requests').get(),
    ).toEqual({ consumed_at: null });
  } finally {
    await otherContext.close();
  }
  await page.goto(`${studio.origin}/password/reset#token=${token}`);
  await page.getByLabel(/^新密码/).fill(nextPassword);
  await page.getByLabel('确认新密码', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: '保存密码并退出会话' }).click();
  await expect(page).toHaveURL(`${studio.origin}/login?password=changed`);
  expect(
    studio.services.db.sqlite
      .prepare('SELECT local_password_enabled,password_revision FROM users')
      .get(),
  ).toEqual({ local_password_enabled: 1, password_revision: 1 });
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM external_identities').get(),
  ).toEqual({ n: 1 });
  await page.getByLabel('邮箱', { exact: true }).fill('google-only@example.test');
  await page.getByLabel('密码', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page).toHaveURL(`${studio.origin}/`);
  await page.goto(`${studio.origin}/settings`);
  await page.getByRole('button', { name: '解除 Google 关联', exact: true }).click();
  await page.getByLabel('当前本地密码', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: '确认解除关联', exact: true }).click();
  await expect
    .poll(() =>
      studio.services.db.sqlite.prepare('SELECT count(*) n FROM external_identities').get(),
    )
    .toEqual({ n: 0 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: `${studio.folder}/account-settings.png`, fullPage: true });
});

test.describe('explicitly disabled recovery', () => {
  test.use({ recoveryEnabled: false });
  test('is readable without a session and sends no fabricated messages', async ({
    page,
    studio,
  }) => {
    await page.goto(`${studio.origin}/password/forgot`);
    await expect(page.getByText('此实例尚未启用邮件密码恢复。', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '申请密码恢复邮件' })).toBeDisabled();
    expect(studio.smtp.messages).toHaveLength(0);
    expect(
      studio.services.db.sqlite.prepare('SELECT count(*) n FROM password_requests').get(),
    ).toEqual({ n: 0 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: `${studio.folder}/recovery-disabled.png`, fullPage: true });
  });
});

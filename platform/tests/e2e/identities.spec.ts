import { test, expect } from './fixtures';

test.describe('local SMS protocol fixture', () => {
  test.use({ smsEnabled: true });
  test('binds through actual UI, logs out, and signs in using a separately delivered one-time SMS', async ({
    page,
    studio,
  }) => {
    const password = 'BrowserPhonePassword2026!';
    await page.goto(studio.origin);
    await page.getByLabel('你的称呼', { exact: true }).fill('Phone owner');
    await page.getByLabel('邮箱', { exact: true }).fill('phone-owner@example.test');
    await page.getByLabel(/^密码/).fill(password);
    await page.getByRole('button', { name: '创建并开始创作', exact: true }).click();
    await page.getByRole('button', { name: '稍后设置', exact: true }).click();
    await page.goto(`${studio.origin}/settings`);
    await page.getByRole('button', { name: '绑定手机号', exact: true }).click();
    const binding = page.getByRole('dialog', { name: '绑定手机号', exact: true });
    await binding.getByLabel('当前本地密码', { exact: true }).fill(password);
    await binding.getByLabel('新的中国大陆手机号', { exact: true }).fill('13800138000');
    await binding.getByRole('button', { name: '申请验证短信', exact: true }).click();
    const first = await studio.latestSmsCode();
    await binding.getByLabel('短信验证码', { exact: true }).fill(first);
    await binding.getByRole('button', { name: '确认验证码', exact: true }).click();
    await expect(binding).toHaveCount(0);
    await expect(page.getByText('已验证：+86 138••••8000', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '关联微信', exact: true })).toBeDisabled();
    await studio.advanceIdentityClock(61_000);
    const mobileNavigation = page.getByRole('button', { name: '展开导航', exact: true });
    if (await mobileNavigation.isVisible()) await mobileNavigation.click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('button', { name: '手机验证码登录', exact: true }).click();
    const login = page.getByRole('dialog', { name: '手机验证码登录', exact: true });
    await login.getByLabel('中国大陆手机号', { exact: true }).fill('13800138000');
    await login.getByRole('button', { name: '申请短信验证码', exact: true }).click();
    await expect.poll(() => studio.sms!.messages.length).toBe(2);
    const next = studio.sms!.messages.at(-1)!.code;
    await login.getByLabel('短信验证码', { exact: true }).fill(next);
    await login.getByRole('button', { name: '验证并继续', exact: true }).click();
    await expect(login).toHaveCount(0);
    const session = await page.request.get(`${studio.origin}/api/v1/auth/me`);
    expect(session.status()).toBe(200);
    expect((await session.json()).data.user.email).toBe('phone-owner@example.test');
    expect(
      studio.services.db.sqlite
        .prepare('SELECT count(*) n FROM sms_challenges WHERE consumed_at IS NOT NULL')
        .get(),
    ).toEqual({ n: 2 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `${studio.folder}/phone-login-completed.png`, fullPage: true });
  });
});

test('shows unavailable external identity methods without fake codes or QR images', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await expect(page.getByRole('button', { name: '手机验证码登录', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '微信扫码登录', exact: true })).toBeDisabled();
  await expect(page.getByText('短信登录未启用', { exact: true })).toBeVisible();
  await expect(page.getByText('微信登录未启用', { exact: true })).toBeVisible();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM sms_challenges').get()).toEqual({
    n: 0,
  });
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM wechat_auth_flows').get(),
  ).toEqual({ n: 0 });
});
test('can detach existing identity fixtures with a password after both providers are disabled', async ({
  page,
  context,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
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
  await expect(page.getByRole('button', { name: '换绑手机号', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '解除手机号', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '解除手机号', exact: true }).click();
  const phoneDialog = page.getByRole('dialog', { name: '解除手机号', exact: true });
  await phoneDialog.getByLabel('当前本地密码', { exact: true }).fill(account.password);
  await phoneDialog.getByRole('button', { name: '确认解除', exact: true }).click();
  await expect(phoneDialog).toHaveCount(0);
  await expect(page.getByText('尚未绑定手机号', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '解除微信关联', exact: true }).click();
  const wechatDialog = page.getByRole('dialog', { name: '解除微信关联', exact: true });
  await wechatDialog.getByLabel('当前本地密码', { exact: true }).fill(account.password);
  await wechatDialog.getByRole('button', { name: '确认解除', exact: true }).click();
  await expect(wechatDialog).toHaveCount(0);
  await expect(page.getByText('尚未关联微信身份', { exact: true })).toBeVisible();
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM phone_identities').get(),
  ).toEqual({ n: 0 });
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM wechat_identities').get(),
  ).toEqual({ n: 0 });
});

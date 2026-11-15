import type { Page } from '@playwright/test';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function account(page: Page, studio: Studio) {
  const owner = await studio.existingIdentitySession();
  await page
    .context()
    .addCookies([{ name: 'studio_session', value: owner.sessionToken, url: studio.origin }]);
  return owner;
}

async function saveTheme(page: Page, value: 'light' | 'dark' | 'system') {
  await page.getByRole('combobox', { name: '界面主题', exact: true }).selectOption(value);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/me') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  expect((await saved).status()).toBe(200);
}

test('new accounts explicitly default to dark while the operating system uses light', async ({
  page,
  studio,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const owner = await account(page, studio);
  expect(owner.user.preferences.theme).toBe('dark');
  await page.goto(`${studio.origin}/settings`);
  await expect(page.getByRole('combobox', { name: '界面主题', exact: true })).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('legacy system preference keeps the brand dark theme across operating-system changes without rewriting storage', async ({
  page,
  studio,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const owner = await account(page, studio);
  const preferences = {
    ...owner.user.preferences,
    onboardingCompleted: true,
    theme: 'system',
  };
  const storedPreferences = JSON.stringify(preferences);
  studio.services.db.sqlite
    .prepare('UPDATE users SET preferences_json=? WHERE id=?')
    .run(storedPreferences, owner.user.id);
  await page.goto(`${studio.origin}/settings`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('combobox', { name: '界面主题', exact: true })).toHaveValue('system');
  await expect(page.getByRole('option', { name: '默认（深色）', exact: true })).toHaveAttribute(
    'value',
    'system',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('combobox', { name: '界面主题', exact: true })).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const record = studio.services.db.sqlite
    .prepare('SELECT preferences_json FROM users WHERE id=?')
    .get(owner.user.id) as { preferences_json: string };
  expect(record.preferences_json).toBe(storedPreferences);
  await page.screenshot({ path: `${studio.folder}/legacy-default-dark.png`, fullPage: true });
  if (testInfo.project.name === 'desktop') {
    // Synthetic fixture account; never capture private live-user content.
    await page.goto(studio.origin);
    await expect(
      page.getByRole('heading', { name: '今天想映造什么？', exact: true }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({
      path: `${studio.folder}/legacy-default-dark-home.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('explicit light and dark choices are not overridden by operating-system changes', async ({
  page,
  studio,
}) => {
  await account(page, studio);
  await page.goto(`${studio.origin}/settings`);
  await saveTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await saveTheme(page, 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('combobox', { name: '界面主题', exact: true })).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('a legacy account without a theme keeps dark appearance without rewriting stored preferences', async ({
  page,
  studio,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const owner = await account(page, studio);
  const preferences = { onboardingCompleted: true, locale: 'zh-CN', defaultPlatform: '通用电商' };
  studio.services.db.sqlite
    .prepare('UPDATE users SET preferences_json=? WHERE id=?')
    .run(JSON.stringify(preferences), owner.user.id);
  await page.goto(`${studio.origin}/settings`);
  await expect(page.getByRole('combobox', { name: '界面主题', exact: true })).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const record = studio.services.db.sqlite
    .prepare('SELECT preferences_json FROM users WHERE id=?')
    .get(owner.user.id) as { preferences_json: string };
  expect(JSON.parse(record.preferences_json)).toEqual(preferences);
});

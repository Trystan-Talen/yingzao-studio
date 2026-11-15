import { join } from 'node:path';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

test('keeps five primary destinations and every secondary destination reachable without a media request', async ({
  page,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const mediaWrites: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/api\/v1\/(creative-briefs\/prepare|quotes|jobs)$/.test(new URL(request.url()).pathname)
    )
      mediaWrites.push(request.url());
  });
  await page.goto(studio.origin + '/projects');
  const mobileToggle = page.getByRole('button', { name: '展开导航', exact: true });
  const mobile = await mobileToggle.isVisible();
  if (mobile) await mobileToggle.click();
  const nav = page
    .getByRole('navigation', { name: '主导航', exact: true })
    .filter({ visible: true });
  await expect(nav.getByRole('link')).toHaveCount(5);
  for (const [name, href] of [
    ['创作', '/'],
    ['灵感', '/inspiration'],
    ['任务', '/tasks'],
    ['素材', '/assets'],
    ['工具', '/tools'],
  ] as const)
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  if (!mobile) {
    const bounds = await page.locator('.yz-rail').boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(84);
    expect(bounds!.width).toBeLessThanOrEqual(88);
    const mainBounds = await page.locator('.yz-main').boundingBox();
    expect(mainBounds!.x).toBeCloseTo(bounds!.x + bounds!.width, 0);
    await page.getByRole('button', { name: '更多', exact: true }).click();
  }
  const drawer = page.getByRole('dialog', { name: mobile ? '导航' : '更多', exact: true });
  for (const [name, href] of [
    ['项目', '/projects'],
    ['商品详情页', '/detail-pages'],
    ['品牌', '/brands'],
    ['人物', '/characters'],
    ['团队', '/team'],
    ['用量与订单', '/usage'],
    ['开发者', '/developer'],
    ['设置', '/settings'],
    ['帮助与支持', '/support'],
  ] as const) {
    const link = drawer.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', href);
  }
  await page.screenshot({ path: join(studio.folder, 'complete-navigation.png'), fullPage: true });
  await drawer.getByRole('link', { name: '项目', exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.goto(studio.origin + '/workbench?kind=video');
  if (mobile) await mobileToggle.click();
  await expect(
    page
      .getByRole('navigation', { name: '主导航', exact: true })
      .filter({ visible: true })
      .getByRole('link', { name: '创作', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  if (mobile) await page.keyboard.press('Escape');
  if (mobile) {
    await page.getByRole('link', { name: '任务', exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(studio.origin + '/tasks');
    await expect(page.getByRole('heading', { name: '任务中心', exact: true })).toBeVisible();
  } else {
    const progress = page.getByRole('button', { name: '当前进度', exact: true });
    await progress.click();
    await expect(page.getByRole('dialog', { name: '当前进度', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(progress).toBeFocused();
  }
  expect(mediaWrites).toEqual([]);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

for (const locale of [
  {
    id: 'en',
    theme: 'light',
    dir: 'ltr',
    navigation: 'Navigation',
    toggle: 'Expand navigation',
    more: 'More',
    create: 'Create',
    space: 'Switch workspace',
    account: 'Account & sign out',
    signOut: 'Sign out',
    back: 'Back to navigation',
    current: 'Current activity',
    tasks: 'Task',
  },
  {
    id: 'ar',
    theme: 'dark',
    dir: 'rtl',
    navigation: 'التنقل',
    toggle: 'فتح التنقل',
    more: 'المزيد',
    create: 'إنشاء',
    space: 'تبديل مساحة العمل',
    account: 'الحساب وتسجيل الخروج',
    signOut: 'تسجيل الخروج',
    back: 'العودة إلى التنقل',
    current: 'النشاط الحالي',
    tasks: 'المهمة',
  },
] as const) {
  test(
    'keeps ' + locale.id + ' navigation, account actions, direction and chosen theme intact',
    async ({ page, studio }) => {
      const account = await studio.existingIdentitySession();
      studio.services.db.sqlite.prepare('UPDATE users SET preferences_json=? WHERE id=?').run(
        JSON.stringify({
          ...account.user.preferences,
          onboardingCompleted: true,
          locale: locale.id,
          theme: locale.theme,
        }),
        account.user.id,
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
      await page.goto(studio.origin + '/projects');
      await expect(page.locator('html')).toHaveAttribute('dir', locale.dir);
      await expect(page.locator('html')).toHaveAttribute('data-theme', locale.theme);
      const mobileToggle = page.locator('.yz-mobile-menu');
      const mobile = await mobileToggle.isVisible();
      if (!mobile) {
        const rail = await page.locator('.yz-rail').boundingBox();
        const main = await page.locator('.yz-main').boundingBox();
        if (locale.dir === 'rtl') expect(main!.x + main!.width).toBeCloseTo(rail!.x, 0);
        else expect(main!.x).toBeCloseTo(rail!.x + rail!.width, 0);
      }
      if (mobile) {
        await mobileToggle.click();
        await page
          .getByRole('dialog', { name: locale.navigation, exact: true })
          .getByRole('button')
          .filter({ hasText: locale.space })
          .click();
      } else await page.getByRole('button', { name: new RegExp('^' + locale.space) }).click();
      const spaces = page.getByRole('dialog', { name: locale.space, exact: true });
      await expect(spaces).toBeVisible();
      await expect(
        spaces.getByRole('button').filter({ hasText: account.workspace.name }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      if (mobile) {
        await mobileToggle.click();
        await page
          .getByRole('dialog', { name: locale.navigation, exact: true })
          .getByRole('button')
          .filter({ hasText: locale.account })
          .click();
      } else await page.getByRole('button', { name: new RegExp('^' + locale.account) }).click();
      const accountPanel = page.getByRole('dialog', { name: locale.account, exact: true });
      await expect(
        accountPanel.getByRole('button', { name: locale.signOut, exact: true }),
      ).toBeVisible();
      await expect(
        accountPanel.getByRole('heading', { name: account.user.displayName, exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: join(studio.folder, 'navigation-account-' + locale.id + '.png'),
        fullPage: true,
      });
      await accountPanel.getByRole('button', { name: locale.back, exact: true }).click();
      const returned = page.getByRole('dialog', {
        name: mobile ? locale.navigation : locale.more,
        exact: true,
      });
      await expect(returned).toBeVisible();
      await page.keyboard.press('Tab');
      expect(await returned.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('html')).toHaveAttribute('data-theme', locale.theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const preferences = (await (await page.request.get(studio.origin + '/api/v1/auth/me')).json())
        .data.user.preferences;
      expect(preferences.locale).toBe(locale.id);
      expect(preferences.theme).toBe(locale.theme);
      expect(preferences.defaultCreationLanguage).toBe('zh-CN');
      if (mobile) {
        const tasks = page
          .getByRole('link', { name: locale.tasks, exact: true })
          .filter({ visible: true });
        await expect(tasks).toBeVisible();
        await expect(tasks).toHaveAttribute('href', '/tasks');
      } else
        await expect(page.getByRole('button', { name: locale.current, exact: true })).toBeVisible();
      expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
        n: 0,
      });
    },
  );
}

test('switches the workspace through the existing session and signs out through the account panel', async ({
  page,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  const second = studio.services.core.auth.createWorkspace(
    account.user.id,
    '导航验证的第二个工作空间',
    'team',
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
  await page.goto(studio.origin + '/projects');
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'studio_session',
  )!.value;
  const mobileToggle = page.getByRole('button', { name: '展开导航', exact: true });
  const mobile = await mobileToggle.isVisible();
  if (mobile) {
    await mobileToggle.click();
    await page
      .getByRole('dialog', { name: '导航', exact: true })
      .getByRole('button')
      .filter({ hasText: '切换工作空间' })
      .click();
  } else await page.getByRole('button', { name: /^切换工作空间/ }).click();
  const workspacePanel = page.getByRole('dialog', { name: '切换工作空间', exact: true });
  await workspacePanel.getByRole('button').filter({ hasText: second.name }).click();
  await expect(workspacePanel).toBeHidden();
  await expect(page).toHaveURL(studio.origin + '/');
  await expect
    .poll(
      async () =>
        (await (await page.request.get(studio.origin + '/api/v1/auth/me')).json()).data
          .activeWorkspaceId,
    )
    .toBe(second.id);
  expect(
    (await page.context().cookies()).find((cookie) => cookie.name === 'studio_session')!.value,
  ).toBe(sessionCookie);
  if (mobile) {
    await mobileToggle.click();
    await page
      .getByRole('dialog', { name: '导航', exact: true })
      .getByRole('button')
      .filter({ hasText: '账户与退出' })
      .click();
  } else await page.getByRole('button', { name: /^账户与退出/ }).click();
  await page
    .getByRole('dialog', { name: '账户与退出', exact: true })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
  await expect
    .poll(async () =>
      (await page.context().cookies()).some((cookie) => cookie.name === 'studio_session'),
    )
    .toBe(false);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

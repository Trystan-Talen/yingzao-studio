import { join } from 'node:path';
import { test, expect } from './fixtures';

test.beforeEach(async ({ page, studio }) => {
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
  await page.goto(`${studio.origin}/projects`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('navigation closes the mobile drawer for account and support destinations', async ({
  page,
  studio,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const destination of [
    { label: '设置', path: '/settings' },
    { label: '帮助与支持', path: '/support' },
    { label: '查看额度明细', path: '/usage' },
    { label: '开发者', path: '/developer' },
  ]) {
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '导航', exact: true });
    await drawer.getByRole('link', { name: destination.label, exact: true }).click();
    await expect(page).toHaveURL(`${studio.origin}${destination.path}`);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: join(studio.folder, 'mobile-navigation.png'), fullPage: true });
});

test('uses Create as the single creation destination and removes duplicate home navigation', async ({
  page,
  studio,
}) => {
  await page.getByRole('main').focus();
  await page.keyboard.press('n');
  await expect(page).toHaveURL(`${studio.origin}/projects`);
  const toggle = page.getByRole('button', { name: '展开导航', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  const navigation = page
    .getByRole('navigation', { name: '主导航', exact: true })
    .filter({ visible: true });
  const home = navigation.getByRole('link', { name: '创作', exact: true });
  await expect(home).toHaveCount(1);
  await expect(home).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: '新建创作', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '创作首页', exact: true })).toHaveCount(0);
  await home.click();
  await expect(page).toHaveURL(
    (url) =>
      url.origin === studio.origin &&
      url.pathname === '/' &&
      (!url.search || url.search === '?kind=image'),
  );
  await expect(page).toHaveTitle('创作 · 映造 Studio');
  const brief = page.locator('.composer').getByRole('textbox', { name: '创作需求', exact: true });
  await brief.fill('创意');
  await brief.press('End');
  await brief.press('n');
  await expect(brief).toHaveValue('创意n');
  await expect(page).toHaveURL(
    (url) =>
      url.origin === studio.origin &&
      url.pathname === '/' &&
      (!url.search || url.search === '?kind=image'),
  );
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('global search exposes loading, a recoverable failure and a real project result', async ({
  page,
  studio,
}) => {
  const session = (await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json()).data;
  const headers = { origin: studio.origin, 'x-workspace-id': session.activeWorkspaceId };
  const create = await page.request.post(`${studio.origin}/api/v1/projects`, {
    headers,
    data: { name: '导航验收项目' },
  });
  expect(create.ok()).toBe(true);
  const project = (await create.json()).data;
  let mode: 'slow' | 'error' | 'real' = 'slow';
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/projects?*', async (route) => {
    if (!new URL(route.request().url()).searchParams.get('q')) return route.continue();
    if (mode === 'slow') await waiting;
    if (mode === 'error')
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '搜索暂时不可用' } }),
      });
    await route.continue();
  });
  await page
    .getByRole('button', { name: /^搜索项目/ })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '搜索项目', exact: true });
  await dialog.getByRole('textbox', { name: '搜索项目', exact: true }).fill('导航验收');
  try {
    await expect(dialog.getByRole('status')).toBeVisible();
  } finally {
    mode = 'error';
    release!();
  }
  await expect(dialog.getByRole('alert')).toContainText('搜索暂时不可用');
  await page.screenshot({ path: join(studio.folder, 'search-error.png'), fullPage: true });
  mode = 'real';
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await dialog.getByRole('button', { name: '导航验收项目', exact: true }).click();
  await expect(page).toHaveURL(`${studio.origin}/workbench/${project.id}`);
  await expect(dialog).toBeHidden();
  const saved = await page.request.get(`${studio.origin}/api/v1/projects/${project.id}`, {
    headers,
  });
  expect((await saved.json()).data.name).toBe('导航验收项目');
});

test('keyboard users can skip navigation and recover focus after closing search', async ({
  page,
}) => {
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: '跳到主要内容', exact: true });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(skip).toHaveCSS('opacity', '0');
  const search = page.getByRole('button', { name: /^搜索项目/ }).filter({ visible: true });
  await search.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '搜索项目', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
});

test('a conditionally mounted creation assistant restores focus to the available settings trigger', async ({
  page,
  studio,
}) => {
  await page.goto(`${studio.origin}/workbench`);
  await page.getByRole('button', { name: '更多创作设置', exact: true }).click();
  await page
    .getByRole('dialog', { name: '创作设置', exact: true })
    .locator('summary')
    .filter({ hasText: '更多偏好' })
    .click();
  const assistant = page.getByRole('button', { name: 'AI 帮我写', exact: true });
  await assistant.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'AI 创作助手', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '更多创作设置', exact: true })).toBeFocused();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('keeps navigation open when a delayed homepage module normalizes its creation-kind query', async ({
  page,
  studio,
}) => {
  let held = false;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/CreationLanding-*.js', async (route) => {
    const response = await route.fetch();
    held = true;
    await barrier;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await page.goto(studio.origin, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => held).toBe(true);
    const mobile = page.getByRole('button', { name: '展开导航', exact: true });
    const mobileVisible = await mobile.isVisible();
    await (
      mobileVisible ? mobile : page.getByRole('button', { name: '更多', exact: true })
    ).click();
    const drawer = page.getByRole('dialog', { name: mobileVisible ? '导航' : '更多', exact: true });
    await expect(drawer).toBeVisible();
    expect(new URL(page.url()).searchParams.has('kind')).toBe(false);
    release();
    await expect(page).toHaveURL(`${studio.origin}/?kind=image`);
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: '项目', exact: true }).click();
    await expect(page).toHaveURL(`${studio.origin}/projects`);
    await expect(drawer).toBeHidden();
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
  } finally {
    release();
  }
});

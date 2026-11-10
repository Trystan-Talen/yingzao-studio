import { join } from 'node:path';
import { test, expect } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

test.beforeEach(async ({ page, studio }) => {
  const account = await studio.experienceSession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
});

test('finds a saved draft from Home and returns to the exact brief without generating', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.locator('.entry-image').click();
  const brief = '陶瓷杯主图，自然光、暖白背景，保留杯身比例。';
  await page.getByRole('textbox', { name: '创作需求', exact: true }).fill(brief);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const destination = new URL(page.url()).pathname;
  await page.goto(studio.origin);
  const project = page.locator(`.home-session[href="${destination}"]`);
  await expect(project).toBeVisible();
  await project.click();
  await expect(page.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(brief);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(brief);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('searches the entire tool catalog and recovers from an empty search', async ({
  page,
  studio,
}) => {
  await page.goto(`${studio.origin}/tools`);
  const search = page.getByRole('textbox', { name: '搜索工具', exact: true });
  await search.fill('图片文字识别');
  await expect(page.locator('main .tool-card')).toHaveCount(1);
  await expect(page.locator('main .tool-card')).toHaveAttribute('href', '/advanced/image.ocr');
  await search.fill('不存在的工具xyz');
  await expect(page.locator('main .tool-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '没有找到相关工具', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect(search).toHaveValue('');
  expect(await page.locator('main .tool-card').count()).toBeGreaterThan(16);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('keeps detail-page preparation and its action within a notebook screen', async ({
  page,
  studio,
}) => {
  for (const height of [800, 712]) {
    await page.setViewportSize({ width: 1280, height });
    await page.goto(`${studio.origin}/detail-pages`);
    await expect(page.getByRole('textbox', { name: /^商品信息与创作要求/ })).toBeVisible();
    const submit = page.getByRole('button', { name: '开始整套策划', exact: true });
    await expect(submit).toBeDisabled();
    const bounds = await submit.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: join(studio.folder, `detail-first-screen-${height}.png`) });
  }
});

test('renders the complete product shell without overflow or page errors', async ({
  page,
  studio,
}, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const path of [
    '/',
    '/workbench?kind=image',
    '/workbench?kind=video',
    '/detail-pages',
    '/projects',
    '/assets',
    '/tasks',
    '/tools',
    '/inspiration',
    '/settings',
    '/usage',
    '/support',
    '/brands',
    '/characters',
    '/team',
    '/developer',
  ]) {
    await page.goto(`${studio.origin}${path}`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('此页面暂时无法显示', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await page.screenshot({
      path: join(
        studio.folder,
        `${testInfo.project.name}-${path.replace(/[^a-z]/g, '') || 'home'}.png`,
      ),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

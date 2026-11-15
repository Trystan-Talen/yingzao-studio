import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  creationRecords,
  expectNoHorizontalOverflow,
  openCreationRedesign,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

async function unobstructed(control: Locator) {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      control.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !!hit && (node === hit || node.contains(hit));
      }),
    )
    .toBe(true);
}

async function shell(page: Page, width: number, mobile = false) {
  const header = page.locator('.yz-topbar');
  await expect(header).toBeVisible();
  const headerBounds = await header.boundingBox();
  const mainBounds = await page.locator('.yz-main').boundingBox();
  const rail = page.locator('.yz-rail');
  expect(headerBounds!.height).toBeCloseTo(64, 0);
  expect(mainBounds!.x).toBeCloseTo(mobile ? 0 : 88, 0);
  expect(mainBounds!.width).toBeCloseTo(width - (mobile ? 0 : 88), 0);
  if (mobile) await expect(rail).toBeHidden();
  else {
    await expect(rail).toBeVisible();
    expect((await rail.boundingBox())!.width).toBeCloseTo(88, 0);
  }
  await expectNoHorizontalOverflow(page);
}

async function normalFlowCreation(page: Page) {
  const launch = page.getByRole('region', { name: '快速创作', exact: true });
  const discovery = page.getByRole('region', { name: '创作灵感', exact: true });
  const position = await launch.evaluate((node) => getComputedStyle(node).position);
  expect(['static', 'relative']).toContain(position);
  const launchBounds = (await launch.boundingBox())!;
  const discoveryBounds = (await discovery.boundingBox())!;
  expect(discoveryBounds.y).toBeGreaterThanOrEqual(launchBounds.y + launchBounds.height);
  const firstCard = page.locator('.studio-idea-card').first();
  await unobstructed(firstCard);
  const scrolledLaunch = (await launch.boundingBox())!;
  const cardBounds = (await firstCard.boundingBox())!;
  expect(cardBounds.y).toBeGreaterThanOrEqual(scrolledLaunch.y + scrolledLaunch.height);
  await page.evaluate(() => scrollTo(0, 0));
}

test('desktop studio visual states keep normal-flow creation above unobstructed artwork and keyboard controls without billable writes', async ({
  page,
  studio,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { account, composer, prompt, writes, headers } = await openCreationRedesign(page, studio);
  await expect(page.getByRole('heading', { name: '今天想映造什么？', exact: true })).toBeVisible();
  await expect(page.locator('.studio-idea-card')).toHaveCount(8);
  await expect(
    page.locator('.studio-shortcuts').getByRole('link', { name: /^商品详情页/ }),
  ).toHaveAttribute('href', '/detail-pages');
  await expect(composer.getByRole('group', { name: '创作方向', exact: true })).toBeVisible();
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  const credit = await page.request.get(`${studio.origin}/api/v1/credits`, { headers });
  expect(credit.status()).toBe(200);
  await expect(page.locator('.yz-credit strong')).toHaveText(
    (await credit.json()).data.available.toLocaleString(),
  );
  await shell(page, page.viewportSize()!.width);
  await normalFlowCreation(page);
  await unobstructed(prompt);
  await unobstructed(composer.getByRole('button', { name: '生成图片', exact: true }));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: join(studio.folder, 'consumer-desktop-home.png'),
    animations: 'disabled',
    scale: 'css',
  });

  await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await expect(settings.getByRole('combobox', { name: '创作类型', exact: true })).toBeVisible();
  await settings.getByText('更多偏好', { exact: true }).click();
  const controls = await settings.locator('select:visible').all();
  const reached = new Set<number>();
  await settings.getByRole('button', { name: '完成', exact: true }).focus();
  for (let step = 0; step < 36 && reached.size < controls.length; step++) {
    await page.keyboard.press('Shift+Tab');
    for (let index = 0; index < controls.length; index++) {
      if (await controls[index]!.evaluate((node) => node === document.activeElement)) {
        await unobstructed(controls[index]!);
        reached.add(index);
      }
    }
  }
  expect(reached.size).toBe(controls.length);
  expect(controls.length).toBeGreaterThanOrEqual(5);
  await writeFile(
    join(studio.folder, 'consumer-keyboard-controls.json'),
    JSON.stringify(
      {
        reachedSelects: reached.size,
        viewport: page.viewportSize(),
        composerBounds: await composer.boundingBox(),
        scrollContainer: await page.locator('.studio-compose-shell').evaluate((node) => ({
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          overflowY: getComputedStyle(node).overflowY,
        })),
      },
      null,
      2,
    ),
  );
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await unobstructed(composer.getByRole('button', { name: '生成图片', exact: true }));
  await normalFlowCreation(page);
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await expect(page).toHaveURL(/kind=video$/);
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: join(studio.folder, 'consumer-desktop-video.png'),
    animations: 'disabled',
    scale: 'css',
  });

  await page.goto(`${studio.origin}/?kind=image&asset=${account.reference.id}`);
  await page.getByRole('button', { name: '添加为参考', exact: true }).click();
  await expect(composer.locator('.asset-chip')).toContainText(account.reference.name);
  await prompt.fill('保留参考图里的商品外观，清晨窗边的自然光，完整展示商品，不增加文字。');
  await unobstructed(prompt);
  await unobstructed(composer.getByRole('button', { name: '生成图片', exact: true }));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: join(studio.folder, 'consumer-desktop-reference.png'),
    animations: 'disabled',
    scale: 'css',
  });
  studio.services.core.auth.update(
    { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    { preferences: { theme: 'dark' } },
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(prompt).toHaveValue(
    '保留参考图里的商品外观，清晨窗边的自然光，完整展示商品，不增加文字。',
  );
  await shell(page, page.viewportSize()!.width);
  await normalFlowCreation(page);
  await page.screenshot({
    path: join(studio.folder, 'consumer-desktop-dark.png'),
    animations: 'disabled',
    scale: 'css',
  });
  expect(writes).toEqual([]);
  expect(creationRecords(studio)).toEqual({
    briefs: 0,
    projects: 0,
    quotes: 0,
    jobs: 0,
    reserved: 0,
    settled: 0,
  });
});

test('mobile studio home keeps normal-flow creation, dark artwork, header credit access and the primary action unobstructed', async ({
  page,
  studio,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { account, composer, prompt, writes, headers } = await openCreationRedesign(page, studio);
  await expect(page.getByRole('heading', { name: '今天想映造什么？', exact: true })).toBeVisible();
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  await shell(page, page.viewportSize()!.width, true);
  await normalFlowCreation(page);
  await unobstructed(prompt);
  await unobstructed(composer.getByRole('button', { name: '生成图片', exact: true }));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: join(studio.folder, 'consumer-mobile-home.png'),
    animations: 'disabled',
    scale: 'css',
  });
  await page.screenshot({
    path: join(studio.folder, 'consumer-mobile-full.png'),
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  });
  const credit = await page.request.get(`${studio.origin}/api/v1/credits`, { headers });
  expect(credit.status()).toBe(200);
  await page.getByRole('button', { name: '展开导航', exact: true }).click();
  const navigation = page.getByRole('dialog', { name: '导航', exact: true });
  await expect(navigation.locator('.yz-panel-credit strong')).toHaveText(
    (await credit.json()).data.available.toLocaleString(),
  );
  await expect(
    navigation.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link'),
  ).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '展开导航', exact: true })).toBeFocused();
  studio.services.core.auth.update(
    { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    { preferences: { theme: 'dark' } },
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shell(page, page.viewportSize()!.width, true);
  await normalFlowCreation(page);
  await unobstructed(composer.getByRole('button', { name: '生成图片', exact: true }));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: join(studio.folder, 'consumer-mobile-dark.png'),
    animations: 'disabled',
    scale: 'css',
  });
  expect(writes).toEqual([]);
  expect(creationRecords(studio)).toEqual({
    briefs: 0,
    projects: 0,
    quotes: 0,
    jobs: 0,
    reserved: 0,
    settled: 0,
  });
});

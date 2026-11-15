import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';

test.use({ reducedMotion: 'reduce' });

async function minimumButtonContrast(button: Locator) {
  const foreground = await button.evaluate((element) =>
    getComputedStyle(element)
      .color.match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number),
  );
  const image = await sharp(await button.screenshot({ scale: 'css' }))
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true,
    });
  const luminance = (rgb: number[]) =>
    rgb.reduce((sum, channel, index) => {
      const value = channel / 255;
      return (
        sum +
        (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
          [0.2126, 0.7152, 0.0722][index]!
      );
    }, 0);
  const text = luminance(foreground);
  const samples: number[] = [];
  // Sample the actual rendered gradient above the text and inside rounded corners.
  for (let x = 32; x < image.info.width - 32; x += 5) {
    const offset = (6 * image.info.width + x) * 4;
    const background = luminance([...image.data.subarray(offset, offset + 3)]);
    samples.push((Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05));
  }
  expect(samples.length).toBeGreaterThan(5);
  return Math.min(...samples);
}

for (const theme of ['dark', 'light'] as const) {
  test(`brand action text remains readable in ${theme} theme`, async ({ page, studio }) => {
    await page.goto(studio.origin);
    await page.locator('.login-form form > .button').waitFor();
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    const submit = page.locator('.login-form form > .button');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${studio.folder}/brand-${theme}-normal.png` });
    const normal = await minimumButtonContrast(submit);
    expect.soft(normal, 'Normal action text contrast').toBeGreaterThanOrEqual(4.5);
    await submit.hover();
    await page.screenshot({ path: `${studio.folder}/brand-${theme}-hover.png` });
    const hover = await minimumButtonContrast(submit);
    await writeFile(
      `${studio.folder}/contrast-${theme}.json`,
      JSON.stringify({ theme, normal, hover }),
    );
    expect.soft(hover, 'Hovered action text contrast').toBeGreaterThanOrEqual(4.5);
  });
}

test('floating drawers fit narrow screens and restore trigger focus', async ({ page, studio }) => {
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
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(studio.origin);
    const trigger = page.getByRole('button', { name: '通知', exact: true });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: '通知', exact: true });
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: `${studio.folder}/notification-drawer-${width}.png` });
    const bounds = (await drawer.boundingBox())!;
    expect.soft(bounds.x, `Drawer start at ${width}px`).toBeGreaterThanOrEqual(9);
    expect.soft(bounds.x + bounds.width, `Drawer end at ${width}px`).toBeLessThanOrEqual(width - 9);
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(trigger).toBeFocused();
  }
});

test('desktop rail keeps account and workspace controls reachable on short screens', async ({
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
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(studio.origin);
    const rail = page.getByRole('complementary', { name: '工作空间导航' });
    const accountTrigger = rail.getByRole('button', { name: /^账户与退出/ });
    await accountTrigger.scrollIntoViewIfNeeded();
    const bounds = (await accountTrigger.boundingBox())!;
    await page.screenshot({ path: `${studio.folder}/short-rail-${viewport.height}.png` });
    expect
      .soft(bounds.y + bounds.height, 'Account trigger must be inside the viewport after scrolling')
      .toBeLessThanOrEqual(viewport.height);
    // A click must open the real account panel, not merely find an offscreen DOM node.
    if (bounds.y + bounds.height <= viewport.height) {
      await accountTrigger.click();
      await expect(page.getByRole('dialog', { name: '账户与退出', exact: true })).toBeVisible();
      await page.screenshot({ path: `${studio.folder}/short-account-open-${viewport.height}.png` });
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      const workspaceTrigger = rail.getByRole('button', { name: /^切换工作空间/ });
      await workspaceTrigger.click();
      await expect(page.getByRole('dialog', { name: '切换工作空间', exact: true })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    }
  }
});

test('home keeps its creative controls visible in both themes', async ({ page, studio }) => {
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(studio.origin);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    const brief = page.getByRole('textbox', { name: '创作需求', exact: true });
    await expect(brief).toBeVisible();
    await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `${studio.folder}/home-${theme}-desktop.png`,
      fullPage: true,
      scale: 'css',
    });
  }
});

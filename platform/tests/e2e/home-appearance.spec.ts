import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { t } from '../../src/web/lib/i18n';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

async function horizontalBounds(page: Page, controls: Locator) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    let box = (await control.boundingBox())!;
    if (box.x < 0 || box.x + box.width > width) {
      const canScroll = await control.evaluate((element) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (
            ['auto', 'scroll'].includes(getComputedStyle(parent).overflowX) &&
            parent.scrollWidth > parent.clientWidth
          )
            return true;
        }
        return false;
      });
      expect(canScroll, 'An offscreen control must have a real horizontal scroll container').toBe(
        true,
      );
      await control.scrollIntoViewIfNeeded();
      box = (await control.boundingBox())!;
    }
    expect(box.x, 'A visible control must start inside the viewport').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'A visible control must fit viewport width').toBeLessThanOrEqual(
      width,
    );
  }
}

for (const variant of [
  {
    locale: 'zh-CN',
    theme: 'dark',
    brief: '创作需求',
    save: '保存草稿',
    video: '视频创作',
    music: '背景音乐（可选）',
  },
  {
    locale: 'en',
    theme: 'light',
    brief: 'Creative brief',
    save: 'Save draft',
    video: 'Create a video',
    music: 'Background music (optional)',
  },
  {
    locale: 'ar',
    theme: 'light',
    brief: 'وصف العمل',
    save: 'حفظ المسودة',
    video: 'إنشاء فيديو',
    music: 'موسيقى خلفية (اختياري)',
  },
] as const) {
  test(`renders ${variant.locale} home in ${variant.theme} mode with usable keyboard controls and video materials`, async ({
    page,
    studio,
  }) => {
    const account = await studio.existingIdentitySession();
    studio.services.db.sqlite.prepare('UPDATE users SET preferences_json=? WHERE id=?').run(
      JSON.stringify({
        ...account.user.preferences,
        onboardingCompleted: true,
        locale: variant.locale,
        theme: variant.theme,
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
    await page.goto(studio.origin);
    await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
    await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
    await expect(page.locator('html')).toHaveAttribute(
      'dir',
      variant.locale === 'ar' ? 'rtl' : 'ltr',
    );
    await expect(page.locator('.studio-launch-heading h1')).toHaveText(
      t('好作品，从一个想法开始', variant.locale),
    );
    await expect(page.locator('.composer')).toHaveCount(1);
    const cards = page.locator('.studio-idea-card');
    await expect(cards).toHaveCount(8);
    for (const card of await cards.all()) {
      await horizontalBounds(page, card);
      await expect
        .poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
    }
    if (variant.locale !== 'zh-CN') {
      for (const region of ['.studio-launch-heading', '.studio-compose-shell', '.studio-discover'])
        expect(await page.locator(region).innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    }
    const quick = page.locator('.composer[data-presentation="quick"]');
    await page.evaluate(() => scrollTo(0, 0));
    await horizontalBounds(page, quick.locator('button, select, textarea'));
    for (const control of [
      quick.getByRole('textbox', { name: variant.brief, exact: true }),
      quick.getByRole('button', { name: t('生成图片', variant.locale), exact: true }),
      quick.locator('.credit-estimate'),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    await page.screenshot({ path: join(studio.folder, 'home-appearance.png'), fullPage: true });
    await page.goto(`${studio.origin}/workbench?kind=image`);
    await expect(page.locator('.studio-launch-heading h1')).toHaveText(
      t('好作品，从一个想法开始', variant.locale),
    );
    await expect(page.locator('.composer')).toHaveCount(1);
    const composer = page.locator('.composer[data-presentation="quick"]');
    const brief = composer.getByRole('textbox', { name: variant.brief, exact: true });
    await expect(brief).toBeVisible();
    const generate = composer.getByRole('button', {
      name: t('生成图片', variant.locale),
      exact: true,
    });
    const save = composer.getByRole('button', { name: variant.save, exact: true });
    await expect(generate).toBeVisible();
    await expect(save).toBeVisible();
    await page.screenshot({ path: join(studio.folder, 'home-appearance-first-screen.png') });
    await page.screenshot({
      path: join(studio.folder, 'home-appearance-full-page.png'),
      fullPage: true,
    });
    const bounds = {
      viewport: page.viewportSize(),
      brief: await brief.boundingBox(),
      generate: await generate.boundingBox(),
      save: await save.boundingBox(),
      estimate: await composer.locator('.credit-estimate').boundingBox(),
    };
    await writeFile(
      join(studio.folder, 'home-appearance.json'),
      JSON.stringify({ variant, bounds }, null, 2),
    );
    for (const box of [bounds.brief, bounds.generate, bounds.save, bounds.estimate]) {
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    await horizontalBounds(page, composer.locator('button, select, textarea'));
    if (variant.locale !== 'zh-CN') {
      for (const region of ['.studio-launch-heading', '.studio-compose-shell', '.studio-discover'])
        expect(await page.locator(region).innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    }

    const platform = composer.getByRole('combobox', {
      name: t('发布平台', variant.locale),
      exact: true,
    });
    await expect(platform).toBeVisible();
    await platform.focus();
    await expect(platform).toBeFocused();
    await composer
      .getByRole('button', { name: t('更多创作设置', variant.locale), exact: true })
      .click();
    const advanced = composer.locator('.composer-advanced');
    await expect(advanced).toBeVisible();
    const settings = ['生成模型', '比例', '清晰度', '创作类型', '参考品牌', '画面文字语言'].map(
      (name) => advanced.getByRole('combobox', { name: t(name, variant.locale), exact: true }),
    );
    await expect(advanced.locator('select:not(:disabled)')).toHaveCount(settings.length);
    // Expanded controls are above the compact footer: navigate backward from its disclosure.
    const reached = new Set<number>();
    for (let step = 0; step < 30 && reached.size < settings.length; step++) {
      await page.keyboard.press('Shift+Tab');
      for (let index = 0; index < settings.length; index++) {
        const control = settings[index]!;
        await expect(control).toBeEnabled();
        await expect(control).toBeVisible();
        if (await control.evaluate((element) => element === document.activeElement))
          reached.add(index);
      }
    }
    expect(reached.size, 'Keyboard traversal reaches every enabled setting without a pointer').toBe(
      settings.length,
    );
    await horizontalBounds(page, advanced.locator('select'));
    await page.screenshot({
      path: join(studio.folder, 'home-appearance-advanced.png'),
      fullPage: true,
    });

    await composer.getByRole('button', { name: variant.video, exact: true }).click();
    await composer
      .getByRole('combobox', { name: t('生成模型', variant.locale), exact: true })
      .selectOption('video.generate|fal|wan-2.6');
    await expect(composer.getByText(variant.music, { exact: true })).toBeVisible();
    await horizontalBounds(page, composer.locator('button, select, textarea'));
    const materials = (await composer
      .locator('.creative-prompt-surface > .composer-materials')
      .first()
      .boundingBox())!;
    const options = (await advanced.locator('.composer-specs').boundingBox())!;
    const overlapX =
      Math.min(materials.x + materials.width, options.x + options.width) -
      Math.max(materials.x, options.x);
    const overlapY =
      Math.min(materials.y + materials.height, options.y + options.height) -
      Math.max(materials.y, options.y);
    expect(
      overlapX <= 0 || overlapY <= 0,
      'Video materials and parameter controls do not overlap',
    ).toBe(true);
    await page.screenshot({
      path: join(studio.folder, 'home-appearance-video.png'),
      fullPage: true,
    });
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
  });
}

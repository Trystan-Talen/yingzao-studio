import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { t, TRANSLATIONS, type Locale } from '../../src/web/lib/i18n';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

const originalDisplayName = '首页用户原名';
// Cover every rotating image/video word and every greeting without depending on animation timing.
const homeStaticCopy = [
  '种草海报',
  '场景大片',
  '营销物料',
  '种草短片',
  '产品广告',
  '开箱视频',
  '品牌短片',
  '口播视频',
  '夜深了',
  '整套长图',
  '抠图 · 扩图 · 高清',
  '上传与复用',
  '海量案例',
  '今天想映造什么？',
  '参考图可直接拖到「添加素材」 · 生成的作品自动保存到项目，进度可在',
  '中查看',
  '服务商',
  '最高清晰度',
  '可选比例',
  '种',
  '商品主图',
  '白底图',
  '早上好',
  '中午好',
  '下午好',
  '晚上好',
] as const;

async function localizedHomeCopy(page: Page, locale: Locale) {
  await expect(page.locator('.yz-greeting')).toContainText(originalDisplayName);
  if (locale === 'zh-CN') return;
  await expect
    .soft(page.locator('.studio-launch-heading h1'))
    .not.toHaveAttribute('aria-label', /[\u4e00-\u9fff]/);
  // User display names and provider/model names remain their original content.
  for (const region of [
    '.studio-launch-heading h1',
    '.studio-compose-shell',
    '.studio-discover',
    '.yz-capabilities',
    '.yz-result-hint',
  ])
    expect.soft(await page.locator(region).innerText(), region).not.toMatch(/[\u4e00-\u9fff]/);
  const greeting = (await page.locator('.yz-greeting').innerText()).replace(
    `，${originalDisplayName}`,
    '',
  );
  expect
    .soft(greeting, 'The greeting is translated without rewriting the user name')
    .not.toMatch(/[\u4e00-\u9fff]/);
}

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
    studio.services.db.sqlite
      .prepare('UPDATE users SET preferences_json=?,display_name=? WHERE id=?')
      .run(
        JSON.stringify({
          ...account.user.preferences,
          onboardingCompleted: true,
          locale: variant.locale,
          theme: variant.theme,
        }),
        originalDisplayName,
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
    await expect(page.locator('.studio-launch-heading h1')).toHaveAttribute(
      'aria-label',
      t('今天想映造什么？', variant.locale),
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
    await localizedHomeCopy(page, variant.locale);
    if (variant.locale !== 'zh-CN') {
      const locale = variant.locale;
      const untranslated = homeStaticCopy.filter((key) => {
        const entry = Object.hasOwn(TRANSLATIONS, key) ? TRANSLATIONS[key] : undefined;
        return !entry?.[locale].trim() || /[\u4e00-\u9fff]/.test(entry[locale]);
      });
      expect
        .soft(untranslated, 'All static, rotating, and greeting copy has a translation')
        .toEqual([]);
    }
    const quick = page.locator('.composer[data-presentation="quick"]');
    await page.evaluate(() => scrollTo(0, 0));
    await horizontalBounds(page, quick.locator('button, select, textarea'));
    for (const control of [
      quick.getByRole('textbox', { name: variant.brief, exact: true }),
      quick.getByRole('combobox', { name: t('参考品牌', variant.locale), exact: true }),
      quick.getByRole('combobox', { name: t('参考产品', variant.locale), exact: true }),
      quick.getByRole('switch', { name: t('思考模式', variant.locale), exact: true }),
      quick.getByRole('button', { name: t('生成图片', variant.locale), exact: true }),
      quick.locator('.credit-estimate'),
    ]) {
      // Brand/product and planning controls stay visible in the main form. On a
      // phone the form can exceed one viewport; every action must remain reachable.
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    await page.screenshot({ path: join(studio.folder, 'home-appearance.png'), fullPage: true });
    await page.goto(`${studio.origin}/workbench?kind=image`);
    await expect(page.locator('.studio-launch-heading h1')).toHaveAttribute(
      'aria-label',
      t('今天想映造什么？', variant.locale),
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
    for (const control of [brief, generate, save, composer.locator('.credit-estimate')]) {
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    await horizontalBounds(page, composer.locator('button, select, textarea'));
    await localizedHomeCopy(page, variant.locale);

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
    const advanced = page.getByRole('dialog', { name: t('创作设置', variant.locale), exact: true });
    await expect(advanced).toBeVisible();
    const modelCard = advanced.locator('.composer-model-card');
    await expect(modelCard).toBeVisible();
    await expect(modelCard.locator('dt').first()).toHaveText(t('服务商', variant.locale));
    const ratioDetails = modelCard
      .getByText(t('可选比例', variant.locale), { exact: true })
      .locator('..')
      .locator('dd');
    await expect(ratioDetails).toBeVisible();
    expect(await ratioDetails.innerText()).toMatch(new RegExp(`^\\d+ ${t('种', variant.locale)}$`));
    if (variant.locale !== 'zh-CN') {
      expect
        .soft(await modelCard.locator('dt').allTextContents())
        .not.toEqual(expect.arrayContaining([expect.stringMatching(/[\u4e00-\u9fff]/)]));
      expect.soft(await ratioDetails.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    }
    await advanced.getByText(t('更多偏好', variant.locale), { exact: true }).click();
    const settings = ['生成模型', '比例', '清晰度', '创作类型', '画面文字语言'].map((name) =>
      advanced.getByRole('combobox', { name: t(name, variant.locale), exact: true }),
    );
    await expect(advanced.locator('select:not(:disabled)')).toHaveCount(settings.length);
    // Expanded controls are above the compact footer: navigate backward from its disclosure.
    const reached = new Set<number>();
    await advanced.getByRole('button', { name: t('完成', variant.locale), exact: true }).focus();
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

    await advanced.getByRole('button', { name: t('完成', variant.locale), exact: true }).click();
    await composer.getByRole('button', { name: variant.video, exact: true }).click();
    await composer
      .getByRole('button', { name: t('更多创作设置', variant.locale), exact: true })
      .click();
    await advanced
      .getByRole('combobox', { name: t('生成模型', variant.locale), exact: true })
      .selectOption('video.generate|fal|wan-2.6');
    await advanced.getByRole('button', { name: t('完成', variant.locale), exact: true }).click();
    await expect(composer.getByText(variant.music, { exact: true })).toBeVisible();
    await horizontalBounds(page, composer.locator('button, select, textarea'));
    const materials = (await composer
      .locator('.creative-prompt-surface > .composer-materials')
      .first()
      .boundingBox())!;
    const options = (await composer
      .getByRole('button', { name: t('更多创作设置', variant.locale), exact: true })
      .boundingBox())!;
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

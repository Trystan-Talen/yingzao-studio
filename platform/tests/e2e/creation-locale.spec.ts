import { join } from 'node:path';
import sharp from 'sharp';
import { test, expect } from './fixtures';
import { t } from '../../src/web/lib/i18n';
import type { JobInput } from '../../src/contracts/jobs';

test.use({ recoveryEnabled: false, smsEnabled: false });

for (const language of [
  {
    id: 'en',
    video: 'Create a video',
    brief: 'Creative brief',
    save: 'Save draft',
    music: 'Background music (optional)',
    generated: 'Generate video audio',
    notConnected: 'Connect a service in Settings',
    resize: 'Resize image',
    width: 'Output width (pixels)',
    height: 'Output height (pixels)',
    start: 'Start processing',
    confirm: 'Confirm and submit',
    complete: 'Completed',
    compare: 'Compare with original',
    region: 'Original and result comparison',
    original: 'Input original · 120 × 80',
    result: 'Processed result · 48 × 32',
    saved: 'Draft saved locally',
  },
  {
    id: 'ar',
    video: 'إنشاء فيديو',
    brief: 'وصف العمل',
    save: 'حفظ المسودة',
    music: 'موسيقى خلفية (اختياري)',
    generated: 'توليد صوت الفيديو',
    notConnected: 'اربط خدمة من الإعدادات',
    resize: 'تغيير حجم الصورة',
    width: 'عرض النتيجة (بكسل)',
    height: 'ارتفاع النتيجة (بكسل)',
    start: 'بدء المعالجة',
    confirm: 'تأكيد وإرسال',
    complete: 'مكتمل',
    compare: 'مقارنة بالأصل',
    region: 'مقارنة الأصل والنتيجة',
    original: 'الصورة الأصلية المدخلة · 120 × 80',
    result: 'نتيجة المعالجة · 48 × 32',
    saved: 'حُفظت المسودة محليًا',
  },
] as const) {
  test(`uses ${language.id} creation and local tool controls while retaining the original Chinese user content`, async ({
    page,
    studio,
  }) => {
    const translatedControl = (source: string) => {
      const label = t(source, language.id);
      expect(label, `The ${language.id} control must have a translated label`).not.toMatch(
        /[\u4e00-\u9fff]/,
      );
      return label;
    };
    const account = await studio.existingIdentitySession();
    studio.services.db.sqlite.prepare('UPDATE users SET preferences_json=? WHERE id=?').run(
      JSON.stringify({
        ...account.user.preferences,
        onboardingCompleted: true,
        locale: language.id,
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
    await page.goto(`${studio.origin}/workbench`);
    const composer = page.locator('.composer');
    const settings = page.getByRole('dialog', {
      name: translatedControl('创作设置'),
      exact: true,
    });
    const openSettings = () =>
      composer
        .getByRole('button', { name: translatedControl('更多创作设置'), exact: true })
        .click();
    const closeSettings = () =>
      settings.getByRole('button', { name: translatedControl('完成'), exact: true }).click();
    await composer.getByRole('button', { name: language.video, exact: true }).click();
    await composer
      .getByRole('button', { name: translatedControl('更多创作设置'), exact: true })
      .click();
    await settings
      .getByRole('combobox', { name: translatedControl('生成模型'), exact: true })
      .selectOption('video.generate|fal|wan-2.6');
    await settings
      .getByRole('combobox', { name: translatedControl('清晰度'), exact: true })
      .selectOption('720p');
    await closeSettings();
    await expect(composer.getByText(language.music, { exact: true })).toBeVisible();
    await expect(
      composer.locator('.submit-block').getByText(language.notConnected, { exact: false }),
    ).toBeVisible();
    await expect(
      composer.getByRole('button', { name: translatedControl('生成视频'), exact: true }),
    ).toBeDisabled();
    const audioNote = composer.locator('.notice').filter({ hasText: 'MP3/WAV' });
    await expect(audioNote).toHaveCount(1);
    expect(await audioNote.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    expect((await composer.locator('.notice').allTextContents()).join('\n')).not.toMatch(
      /[\u4e00-\u9fff]/,
    );
    const text = '用户输入保持中文，不因界面语言被改写。';
    const prompt = composer.getByRole('textbox', { name: language.brief, exact: true });
    await prompt.fill(text);
    await openSettings();
    await expect(settings).toBeVisible();
    await settings
      .locator('select')
      .filter({ has: page.locator('option[value="video.generate|fal|kling-o3-4k-reference"]') })
      .selectOption('video.generate|fal|kling-o3-4k-reference');
    await closeSettings();
    await composer.getByRole('checkbox', { name: language.generated, exact: true }).check();
    await composer.getByRole('button', { name: language.save, exact: true }).click();
    await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
    await page.reload();
    await expect(prompt).toHaveValue(text);
    await expect(
      composer.getByRole('checkbox', { name: language.generated, exact: true }),
    ).toBeChecked();
    const retainedValueWarning = translatedControl(
      '“{parameter}”的当前值不受此模型支持。原值已保留，请重新选择。',
    ).replace('{parameter}', translatedControl('清晰度'));
    await openSettings();
    await expect(settings.getByText(retainedValueWarning, { exact: false })).toBeVisible();
    await closeSettings();
    await expect(composer.locator('.composer-note[role="status"]')).toContainText(language.saved);
    const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
    const readDrafts = async () => {
      const messages = await page.request.get(
        `${studio.origin}/api/v1/projects/${projectId}/messages?pageSize=100`,
        { headers: { 'x-workspace-id': account.workspace.id } },
      );
      expect(messages.status()).toBe(200);
      return (await messages.json()).data.items
        .map((message: { metadata?: { draft?: JobInput } }) => message.metadata?.draft)
        .filter((draft: JobInput | undefined): draft is JobInput => !!draft) as JobInput[];
    };
    const originalDrafts = await readDrafts();
    expect(
      originalDrafts.some(
        (draft) =>
          draft.prompt === text &&
          draft.options.model === 'kling-o3-4k-reference' &&
          draft.options.resolution === '720p' &&
          draft.options.generateAudio === true,
      ),
    ).toBe(true);
    expect(originalDrafts.some((draft) => draft.options.resolution === '4K')).toBe(false);
    await expect(
      composer.getByRole('button', { name: translatedControl('生成视频'), exact: true }),
    ).toBeDisabled();
    await openSettings();
    await settings
      .getByRole('button', { name: translatedControl('采用当前模型的固定参数'), exact: true })
      .click();
    await expect(settings.getByText(retainedValueWarning, { exact: false })).toHaveCount(0);
    await closeSettings();
    await expect(prompt).toHaveValue(text);
    await expect(
      composer.getByRole('checkbox', { name: language.generated, exact: true }),
    ).toBeChecked();
    const fixedSaved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/projects/${projectId}/messages`,
    );
    await composer.getByRole('button', { name: language.save, exact: true }).click();
    expect((await fixedSaved).status()).toBe(200);
    await page.reload();
    await expect(prompt).toHaveValue(text);
    await expect(
      composer.getByRole('checkbox', { name: language.generated, exact: true }),
    ).toBeChecked();
    await openSettings();
    await expect(settings.getByText(retainedValueWarning, { exact: false })).toHaveCount(0);
    await closeSettings();
    const fixedDrafts = await readDrafts();
    expect(
      fixedDrafts.some(
        (draft) =>
          draft.prompt === text &&
          draft.options.model === 'kling-o3-4k-reference' &&
          draft.options.resolution === '4K' &&
          draft.options.generateAudio === true,
      ),
    ).toBe(true);
    // Adopting valid settings must not rewrite the earlier saved user draft.
    expect(fixedDrafts.some((draft) => draft.options.resolution === '720p')).toBe(true);
    await expect(
      composer.locator('.submit-block').getByText(language.notConnected, { exact: false }),
    ).toBeVisible();
    await expect(
      composer.getByRole('button', { name: translatedControl('生成视频'), exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: join(studio.folder, `creation-${language.id}.png`),
      fullPage: true,
    });

    await page.goto(`${studio.origin}/tools/local.resize`);
    await expect(page.getByRole('heading', { name: language.resize, exact: true })).toBeVisible();
    const source = await sharp({
      create: { width: 120, height: 80, channels: 4, background: '#2846a5' },
    })
      .png()
      .toBuffer();
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: '中文原件名.png', mimeType: 'image/png', buffer: source });
    await expect(page.locator('.asset-chip')).toContainText('中文原件名.png');
    await page.getByLabel(language.width, { exact: true }).fill('48');
    await page.getByLabel(language.height, { exact: true }).fill('32');
    await page.getByRole('button', { name: language.start, exact: true }).click();
    await page.getByRole('button', { name: language.confirm, exact: true }).click();
    const card = page.locator('.job-card');
    await expect(card.getByText(language.complete, { exact: true })).toBeVisible();
    await card.getByRole('button', { name: translatedControl('参数与详情'), exact: true }).click();
    await page.getByRole('button', { name: language.compare, exact: true }).click();
    const comparison = page.getByRole('region', { name: language.region, exact: true });
    await expect(comparison.getByText(language.original, { exact: true })).toBeVisible();
    await expect(comparison.getByText(language.result, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: join(studio.folder, `local-comparison-${language.id}.png`),
      fullPage: true,
    });
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 1,
    });
    expect(
      studio.services.db.sqlite
        .prepare("SELECT count(*) n FROM jobs WHERE provider_id<>'local'")
        .get(),
    ).toEqual({ n: 0 });
  });
}

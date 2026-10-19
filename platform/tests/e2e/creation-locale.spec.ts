import { join } from 'node:path';
import sharp from 'sharp';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

for (const language of [
  {
    id: 'en',
    video: 'Create a video',
    brief: 'Creative brief',
    save: 'Save draft',
    music: 'Background music (optional)',
    advanced: 'Model and advanced settings',
    generated: 'Generate video audio',
    notConnected: 'Service not connected',
    resize: 'Resize image',
    width: 'Output width (pixels)',
    height: 'Output height (pixels)',
    start: 'Start processing',
    confirm: 'Confirm and submit',
    complete: 'Completed',
    detail: 'View details',
    compare: 'Compare with original',
    region: 'Original and result comparison',
    original: 'Input original · 120 × 80',
    result: 'Processed result · 48 × 32',
    warning: 'This model does not support resolution 720p; changed to 4K.',
    saved: 'Canvas saved · Version 1',
  },
  {
    id: 'ar',
    video: 'إنشاء فيديو',
    brief: 'وصف العمل',
    save: 'حفظ المسودة',
    music: 'موسيقى خلفية (اختياري)',
    advanced: 'النموذج والإعدادات المتقدمة',
    generated: 'توليد صوت الفيديو',
    notConnected: 'الخدمة غير متصلة',
    resize: 'تغيير حجم الصورة',
    width: 'عرض النتيجة (بكسل)',
    height: 'ارتفاع النتيجة (بكسل)',
    start: 'بدء المعالجة',
    confirm: 'تأكيد وإرسال',
    complete: 'مكتمل',
    detail: 'عرض التفاصيل',
    compare: 'مقارنة بالأصل',
    region: 'مقارنة الأصل والنتيجة',
    original: 'الصورة الأصلية المدخلة · 120 × 80',
    result: 'نتيجة المعالجة · 48 × 32',
    warning: 'هذا النموذج لا يدعم دقة 720p؛ جرى التعديل إلى 4K.',
    saved: 'حُفظت اللوحة · الإصدار 1',
  },
] as const) {
  test(`uses ${language.id} creation and local tool controls while retaining the original Chinese user content`, async ({
    page,
    studio,
  }) => {
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
    await composer.getByRole('button', { name: language.video, exact: true }).click();
    await expect(composer.getByText(language.music, { exact: true })).toBeVisible();
    await expect(composer.getByText(language.notConnected, { exact: false })).toBeVisible();
    const audioNote = composer.locator('.notice').filter({ hasText: 'MP3/WAV' });
    await expect(audioNote).toHaveCount(1);
    expect(await audioNote.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    const text = '用户输入保持中文，不因界面语言被改写。';
    const prompt = composer.getByRole('textbox', { name: language.brief, exact: true });
    await prompt.fill(text);
    await composer.getByRole('button', { name: language.advanced, exact: true }).click();
    await composer
      .locator('select')
      .filter({ has: page.locator('option[value="kling-o3-4k-reference"]') })
      .selectOption('kling-o3-4k-reference');
    await composer.getByRole('checkbox', { name: language.generated, exact: true }).check();
    await composer.getByRole('button', { name: language.save, exact: true }).click();
    await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
    await page.reload();
    await expect(prompt).toHaveValue(text);
    await expect(
      composer.getByRole('checkbox', { name: language.generated, exact: true }),
    ).toBeChecked();
    await expect(composer.getByText(language.warning, { exact: true })).toBeVisible();
    await expect(page.getByText(language.saved, { exact: true })).toBeVisible();
    const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
    const messages = await page.request.get(
      `${studio.origin}/api/v1/projects/${projectId}/messages?pageSize=100`,
      { headers: { 'x-workspace-id': account.workspace.id } },
    );
    expect(messages.status()).toBe(200);
    expect(
      (await messages.json()).data.items.some(
        (message: { metadata?: { creationWarnings?: string[] } }) =>
          message.metadata?.creationWarnings?.includes('当前模型不支持清晰度 720p，已调整为 4K。'),
      ),
    ).toBe(true);
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
    await card.getByRole('button', { name: language.detail, exact: true }).click();
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

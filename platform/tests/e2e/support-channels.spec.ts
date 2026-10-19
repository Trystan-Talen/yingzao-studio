import { join } from 'node:path';
import sharp from 'sharp';
import { test, expect } from './fixtures';

test('shows truthful contact availability, retries the configured QR image and opens a separate survey', async ({
  page,
  context,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  await context.addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/support`);
  const card = page.getByRole('region', { name: '联系与反馈渠道', exact: true });
  await expect(card).toContainText('此实例尚未配置客服联系方式');
  await expect(card).toContainText('此实例尚未配置外部反馈问卷');
  await expect(card.getByRole('link')).toHaveCount(0);
  studio.services.core.context.config.support = {
    phone: '+1 (202) 555-0100',
    hours: 'Weekdays 09:00–18:00 UTC',
    wechatQrUrl: 'https://support.example.test/fixture-qr.png',
    feedbackUrl: 'https://survey.example.test/feedback',
    guideUrl: 'https://docs.example.test/guide',
  };
  const image = await sharp({
    create: { width: 160, height: 160, channels: 3, background: '#417c68' },
  })
    .png()
    .toBuffer();
  let imageRequests = 0;
  await page.route('https://support.example.test/fixture-qr.png', async (route) => {
    imageRequests++;
    if (imageRequests === 1) await route.abort('failed');
    else await route.fulfill({ status: 200, contentType: 'image/png', body: image });
  });
  await context.route('https://survey.example.test/feedback', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<title>Isolated survey navigation</title><h1>Fixture survey — no data submitted</h1>',
    }),
  );
  await page.reload();
  await expect(card.getByRole('link', { name: '+1 (202) 555-0100', exact: true })).toHaveAttribute(
    'href',
    'tel:+12025550100',
  );
  await expect(card).toContainText('Weekdays 09:00–18:00 UTC');
  expect(imageRequests).toBe(0);
  await card.getByRole('button', { name: '查看微信二维码', exact: true }).click();
  await expect(card).toContainText('二维码暂时无法加载');
  await card.getByRole('button', { name: '重新加载', exact: true }).click();
  const qr = card.getByRole('img', { name: '本实例客服微信二维码', exact: true });
  await expect(qr).toBeVisible();
  await expect.poll(() => qr.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(160);
  expect(imageRequests).toBe(2);
  const survey = card.getByRole('link', { name: '打开反馈问卷 ↗', exact: true });
  await expect(survey).toHaveAttribute('rel', 'noopener noreferrer');
  const popupPromise = context.waitForEvent('page');
  await survey.click();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading')).toHaveText('Fixture survey — no data submitted');
  await popup.close();
  await page.screenshot({
    path: join(studio.folder, 'configured-support-channels.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  for (const language of [
    { id: 'en', heading: 'Contact and feedback' },
    { id: 'ar', heading: 'التواصل والملاحظات' },
  ]) {
    studio.services.core.auth.update(
      {
        userId: account.user.id,
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      },
      { preferences: { locale: language.id } },
    );
    await page.reload();
    const translated = page.getByRole('region', { name: language.heading, exact: true });
    await expect(translated).toBeVisible();
    expect(await translated.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    await expect(translated).toContainText('Weekdays 09:00–18:00 UTC');
    await expect(translated.locator('a[href="tel:+12025550100"] bdi')).toHaveAttribute(
      'dir',
      'ltr',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: join(studio.folder, `support-channels-${language.id}.png`),
      fullPage: true,
    });
  }
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM support_tickets').get()).toEqual(
    { n: 0 },
  );
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import sharp from 'sharp';
import { test, expect } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

test('shows separate music and generated sound choices in a real quote without submitting a model task', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('音轨确认验收');
  await page.getByLabel('邮箱', { exact: true }).fill('audio-quote@example.test');
  await page.getByLabel(/^密码/).fill('AudioQuoteBrowserPassword2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  const me = await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json();
  // A nonfunctional fixture secret only makes local quote validation available.
  // No supplier call or task submission is allowed in this test.
  const configured = await page.request.put(`${studio.origin}/api/v1/providers`, {
    headers: { origin: studio.origin, 'x-workspace-id': me.data.activeWorkspaceId },
    data: { providerId: 'fal', enabled: true, secret: 'local-quote-fixture-not-a-real-key' },
  });
  expect(configured.status()).toBe(200);
  let submissions = 0;
  await page.route('**/api/v1/jobs', async (route) => {
    if (route.request().method() === 'POST') {
      submissions++;
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await page.goto(`${studio.origin}/workbench`);
  const composer = page.locator('.composer');
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  await composer
    .getByRole('combobox', { name: '生成模型', exact: true })
    .selectOption('video.generate|fal|wan-2.6');
  await composer.getByRole('combobox', { name: '时长', exact: true }).selectOption('5');
  // An explicit user choice must survive switching to a model that does not support it.
  await composer.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('720p');
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('核对文字与独立音轨，不调用外部模型');
  const picker = composer
    .locator('.asset-picker')
    .filter({ has: page.getByText('背景音乐（可选）', { exact: true }) });
  const file = join(studio.folder, 'quote-music.wav');
  await promisify(execFile)('ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=5',
    '-c:a',
    'pcm_s16le',
    '-y',
    file,
  ]);
  await picker.locator('input[type=file]').setInputFiles(file);
  await expect(picker.locator('.asset-chip')).toContainText('quote-music.wav');
  await composer.getByRole('button', { name: '生成视频', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByText('查看详细配置与计费', { exact: true }).click();
  const row = (label: string) =>
    confirmation
      .locator('.detail-list > div')
      .filter({ has: page.locator('dt').getByText(label, { exact: true }) });
  await expect(row('素材').locator('dd')).toHaveText('1项');
  await expect(row('背景音乐').locator('dd')).toHaveText('1项');
  await expect(row('处理任务').locator('dd')).toHaveText('1项');
  await expect(row('计费数量').locator('dd')).toHaveText('5秒');
  await expect(confirmation.locator('ol li')).toContainText('背景音乐');
  await page.screenshot({
    path: join(studio.folder, 'quote-background-music.png'),
    fullPage: true,
  });
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await picker.getByRole('button', { name: '移除quote-music.wav', exact: true }).click();
  // Project drafts preserve explicit settings; quick entry deliberately adopts a new model's defaults.
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  await expect(composer).not.toHaveAttribute('data-presentation', 'quick');
  await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  await composer
    .getByRole('combobox', { name: '生成模型', exact: true })
    .selectOption('video.generate|fal|kling-o3-4k-reference');
  const sound = composer.getByRole('checkbox', { name: '生成视频音轨', exact: true });
  await sound.check();
  const visualPicker = composer.locator('.asset-picker').filter({
    has: page.getByText('视频创作参考素材', { exact: true }),
  });
  await visualPicker.locator('input[type=file]').setInputFiles({
    name: 'quote-video-reference.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width: 400, height: 400, channels: 3, background: '#2288aa' } })
      .png()
      .toBuffer(),
  });
  await expect(visualPicker.locator('.asset-chip')).toContainText('quote-video-reference.png');
  await expect(composer.getByRole('button', { name: '生成视频', exact: true })).toBeDisabled();
  await composer.getByRole('button', { name: '采用当前模型的固定参数', exact: true }).click();
  await expect(sound).toBeChecked();
  const fixedQuote = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/quotes',
  );
  await composer.getByRole('button', { name: '生成视频', exact: true }).click();
  const fixedResponse = await fixedQuote;
  expect(fixedResponse.status()).toBe(200);
  expect(fixedResponse.request().postDataJSON()).toMatchObject({
    options: { model: 'kling-o3-4k-reference', resolution: '4K', generateAudio: true },
  });
  await confirmation.getByText('查看详细配置与计费', { exact: true }).click();
  await expect(row('生成视频音轨').locator('dd')).toHaveText('开启');
  await expect(row('素材').locator('dd')).toHaveText('1项');
  await page.screenshot({ path: join(studio.folder, 'quote-generated-sound.png'), fullPage: true });
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await sound.uncheck();
  await composer.getByRole('button', { name: '生成视频', exact: true }).click();
  await confirmation.getByText('查看详细配置与计费', { exact: true }).click();
  await expect(row('生成视频音轨').locator('dd')).toHaveText('关闭');
  expect(submissions).toBe(0);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

import sharp from 'sharp';
import { test, expect } from './fixtures';

test('does not attach a delayed image-mode upload to the video draft after switching creation kind', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('上传上下文独审');
  await page.getByLabel('邮箱', { exact: true }).fill('upload-context@example.test');
  await page.getByLabel(/^密码/).fill('UploadContextReview2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.goto(`${studio.origin}/workbench`);
  const composer = page.locator('.composer'),
    picker = composer.locator('.composer-materials > .asset-picker');
  const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  const imagePrompt = '图片模式的原需求，晚回上传只能回到这一份草稿。';
  const videoPrompt = '视频模式独立需求，不接收图片模式的晚回素材。';
  await prompt.fill(imagePrompt);
  const buffer = await sharp({
    create: { width: 80, height: 60, channels: 3, background: '#335577' },
  })
    .png()
    .toBuffer();
  let release!: () => void,
    ready = false;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/assets/upload', async (route) => {
    const response = await route.fetch();
    ready = true;
    await barrier;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await picker
      .locator('input[type=file]')
      .setInputFiles({ name: 'image-mode.png', mimeType: 'image/png', buffer });
    await expect.poll(() => ready).toBe(true);
    await composer.getByRole('button', { name: '视频创作', exact: true }).click();
    await prompt.fill(videoPrompt);
    release();
    await expect(picker.first().locator('.upload-drop-zone')).toHaveAttribute('aria-busy', 'false');
    await expect(composer.locator('.composer-materials .asset-chip')).toHaveCount(0);
    await expect(prompt).toHaveValue(videoPrompt);
    await composer.getByRole('button', { name: '图片创作', exact: true }).click();
    await expect(picker.locator('.asset-chip')).toHaveCount(1);
    await expect(picker.locator('.asset-chip')).toContainText('image-mode.png');
    await expect(prompt).toHaveValue(imagePrompt);
    await page.reload();
    await expect(picker.locator('.asset-chip')).toHaveCount(1);
    await expect(prompt).toHaveValue(imagePrompt);
    await composer.getByRole('button', { name: '视频创作', exact: true }).click();
    await expect(picker.locator('.asset-chip')).toHaveCount(0);
    await expect(prompt).toHaveValue(videoPrompt);
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
      n: 1,
    });
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    await page.screenshot({
      path: `${studio.folder}/upload-context-preserved.png`,
      fullPage: true,
    });
  } finally {
    release();
  }
});

test('preserves same-kind prompt edits while an accepted upload response is delayed', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('同模式上传独审');
  await page.getByLabel('邮箱', { exact: true }).fill('same-mode-upload@example.test');
  await page.getByLabel(/^密码/).fill('SameModeUpload2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.goto(`${studio.origin}/workbench`);
  const composer = page.locator('.composer'),
    picker = composer.locator('.composer-materials > .asset-picker'),
    prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  await prompt.fill('上传发起时的旧文字');
  const buffer = await sharp({
    create: { width: 80, height: 60, channels: 3, background: '#446688' },
  })
    .png()
    .toBuffer();
  let release!: () => void,
    ready = false;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/assets/upload', async (route) => {
    const response = await route.fetch();
    ready = true;
    await barrier;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await picker
      .locator('input[type=file]')
      .setInputFiles({ name: 'same-kind.png', mimeType: 'image/png', buffer });
    await expect.poll(() => ready).toBe(true);
    const edited = '上传等待期间编辑的新需求，素材完成不得覆盖它。';
    await prompt.fill(edited);
    release();
    await expect(picker.locator('.asset-chip')).toHaveCount(1);
    await expect(prompt).toHaveValue(edited);
    await page.reload();
    await expect(picker.locator('.asset-chip')).toHaveCount(1);
    await expect(prompt).toHaveValue(edited);
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
      n: 1,
    });
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
  } finally {
    release();
  }
});

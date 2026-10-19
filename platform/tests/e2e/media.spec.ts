import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { test, expect, type Studio } from './fixtures';

async function register(page: Page, studio: Studio) {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('Local media owner');
  await page.getByLabel('邮箱', { exact: true }).fill('local-media@example.test');
  await page.getByLabel(/^密码/).fill('LocalBrowserPassword2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await expect(page.getByRole('dialog', { name: '欢迎来到映造' })).toBeVisible();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '欢迎来到映造' })).toHaveCount(0);
  const session = await page.request.get(`${studio.origin}/api/v1/auth/me`);
  return { 'x-workspace-id': (await session.json()).data.activeWorkspaceId as string };
}

async function viewportEvidence(page: Page, studio: Studio, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: `${studio.folder}/${name}.png`, fullPage: true });
}

test('uploads a real image, confirms local resize, downloads actual pixels and restores history after worker restart', async ({
  page,
  studio,
}) => {
  const headers = await register(page, studio);
  await page.goto(`${studio.origin}/tools/local.resize`);
  await expect(page.getByRole('heading', { name: '图片缩放', exact: true })).toBeVisible();
  const source = await sharp({
    create: { width: 120, height: 80, channels: 4, background: '#2846a5' },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'real-input.png', mimeType: 'image/png', buffer: source });
  await expect(
    page.locator('.asset-chip').getByText('real-input.png', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('输出宽度（像素）', { exact: true }).fill('48');
  await page.getByLabel('输出高度（像素）', { exact: true }).fill('32');
  await page.getByRole('button', { name: '开始处理', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认创作' })).toBeVisible();
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  const card = page.locator('.job-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByText('已完成', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '查看详情', exact: true }).click();
  await page.getByRole('button', { name: '查看原图对比', exact: true }).click();
  const comparison = page.getByRole('region', { name: '原图与结果对比' });
  await expect(comparison.getByText('输入原图 · 120 × 80', { exact: true })).toBeVisible();
  await expect(comparison.getByText('处理结果 · 48 × 32', { exact: true })).toBeVisible();
  await expect(comparison.getByRole('img')).toHaveCount(2);
  await viewportEvidence(page, studio, 'local-resize-comparison');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载原件', exact: true }).click();
  const download = await downloadEvent;
  const path = `${studio.folder}/downloaded-output.png`;
  await download.saveAs(path);
  const pixels = await readFile(path);
  const metadata = await sharp(pixels).metadata();
  expect({ width: metadata.width, height: metadata.height, format: metadata.format }).toEqual({
    width: 48,
    height: 32,
    format: 'png',
  });
  expect([...(await sharp(pixels).ensureAlpha().raw().toBuffer())].slice(0, 4)).toEqual([
    40, 70, 165, 255,
  ]);
  const result = await page.request.get(`${studio.origin}/api/v1/jobs?pageSize=10`, { headers });
  expect(result.status()).toBe(200);
  const jobs = (await result.json()).data.items;
  expect(jobs).toHaveLength(1);
  expect(jobs[0].status).toBe('succeeded');
  expect(jobs[0].input.options.width).toBe(48);
  expect(jobs[0].input.options.height).toBe(32);
  expect(jobs[0].outputAssets).toHaveLength(1);
  const original = await page.request.get(
    new URL(jobs[0].outputAssets[0].originalUrl, studio.origin).toString(),
    { headers },
  );
  expect(original.status()).toBe(200);
  const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  expect(digest(await original.body())).toBe(digest(pixels));
  await expect
    .poll(() => studio.services.db.sqlite.prepare('SELECT count(*) n FROM job_downloads').get())
    .toEqual({ n: 1 });
  await studio.restartWorker();
  await page.reload();
  await expect(card).toHaveCount(1);
  await expect(card.getByText('已完成', { exact: true })).toBeVisible();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
  await viewportEvidence(page, studio, 'local-resize-history');
});

test('reuses an inspiration with its actual reference image and restores the persisted draft after refresh', async ({
  page,
  studio,
}) => {
  const headers = await register(page, studio);
  await page.goto(studio.origin);
  await page.getByRole('button', { name: '把清晨，装进一滴精华 · 以此创作', exact: true }).click();
  const prompt = '为隔离验收保留植物精华参考图和竖向构图，不调用外部模型。';
  const detail = page.getByRole('dialog', { name: '把清晨，装进一滴精华', exact: true });
  await detail.getByLabel(/^创作提示词/).fill(prompt);
  await detail.getByRole('button', { name: '以此创作', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(prompt);
  const reference = page.locator('.composer-materials .asset-chip').first();
  await expect(reference).toContainText('灵感参考 · 把清晨，装进一滴精华.webp');
  await expect(reference.locator('img')).toBeVisible();
  expect(
    await reference
      .locator('img')
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
  ).toBe(true);
  await expect(page.getByRole('combobox', { name: '比例', exact: true })).toHaveValue('2:3');
  const messages = await page.request.get(
    `${studio.origin}/api/v1/projects/${projectId}/messages?pageSize=100`,
    { headers },
  );
  expect(messages.status()).toBe(200);
  const draft = (await messages.json()).data.items.find(
    (message: { metadata?: { inspirationId?: string } }) =>
      message.metadata?.inspirationId === 'botanical-serum',
  ).metadata.draft;
  expect(draft.prompt).toBe(prompt);
  expect(draft.options.ratio).toBe('2:3');
  expect(draft.assetIds).toHaveLength(1);
  const asset = await page.request.get(`${studio.origin}/api/v1/assets/${draft.assetIds[0]}`, {
    headers,
  });
  expect(asset.status()).toBe(200);
  const assetData = (await asset.json()).data;
  expect(assetData.projectId).toBe(projectId);
  const content = await page.request.get(new URL(assetData.originalUrl, studio.origin).toString(), {
    headers,
  });
  const actual = await content.body();
  const source = await readFile('public/gallery/botanical-serum.webp');
  expect(createHash('sha256').update(actual).digest('hex')).toBe(
    createHash('sha256').update(source).digest('hex'),
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(prompt);
  await expect(reference).toContainText(assetData.name);
  await expect(page.getByRole('combobox', { name: '比例', exact: true })).toHaveValue('2:3');
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM projects').get()).toEqual({
    n: 1,
  });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM inspiration_reuses').get(),
  ).toEqual({ n: 1 });
  await viewportEvidence(page, studio, 'inspiration-draft');
});

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import type { AssetDto } from '../../src/contracts/core';
import type { JobInput } from '../../src/contracts/jobs';
import { originalInspirations } from '../../src/contracts/inspirations';
import { test, expect, type Studio } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

async function openHome(page: Page, studio: Studio, path = '/workbench') {
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
  await page.goto(`${studio.origin}${path}`);
  if (path === '/' || path === '/workbench') {
    await expect(page.locator('.studio-launch-heading h1')).toHaveText('好作品，从一个想法开始');
    await expect(page.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  }
  const response = await page.request.get(`${studio.origin}/api/v1/auth/me`);
  expect(response.status()).toBe(200);
  const session = (await response.json()).data;
  return {
    userId: session.user.id as string,
    workspaceId: session.activeWorkspaceId as string,
    headers: { 'x-workspace-id': session.activeWorkspaceId as string },
  };
}

async function firstScreenBounds(page: Page, controls: Record<string, Locator>) {
  const viewport = page.viewportSize()!;
  const bounds: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const [name, control] of Object.entries(controls)) {
    await expect(control, `${name} is visible before scrolling`).toBeVisible();
    const box = await control.boundingBox();
    expect(box, `${name} has a measurable rendered box`).not.toBeNull();
    expect(box!.x, `${name} begins inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.y, `${name} begins inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${name} fits viewport width`).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height, `${name} fits first-screen height`).toBeLessThanOrEqual(
      viewport.height,
    );
    bounds[name] = box!;
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );
  return { viewport, bounds };
}

test('offers one immediately usable creation composer, real idea previews and accessible directions', async ({
  page,
  studio,
}) => {
  await openHome(page, studio, '/');
  const quick = page.locator('.composer[data-presentation="quick"]');
  await expect(page.locator('.composer')).toHaveCount(1);
  await expect(quick).toHaveCount(1);
  const directions = quick.getByRole('group', { name: '创作方向', exact: true });
  await expect(directions.getByRole('button')).toHaveCount(4);
  await expect(directions.getByRole('button', { name: '主副图', exact: true })).toHaveCount(0);
  await expect(directions.getByRole('link', { name: /商品详情页/ })).toHaveAttribute(
    'href',
    '/detail-pages',
  );
  const cards = page.locator('.studio-idea-card');
  await expect(cards).toHaveCount(8);
  for (const card of await cards.all())
    await expect
      .poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  await firstScreenBounds(page, {
    heading: page.locator('.studio-launch-heading h1'),
    brief: quick.getByRole('textbox', { name: '创作需求', exact: true }),
    generate: quick.getByRole('button', { name: '生成图片', exact: true }),
    estimate: quick.locator('.credit-estimate'),
  });
  const generate = quick.getByRole('button', { name: '生成图片', exact: true });
  await expect(generate).toBeEnabled();
  await expect(quick.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  await expect(quick.getByRole('region', { name: '创作设置', exact: true })).toHaveCount(0);
  await generate.click();
  await expect(quick.getByRole('textbox', { name: '创作需求', exact: true })).toBeFocused();
  await expect(quick.locator('.quick-prompt-guidance')).toBeVisible();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM quotes').get()).toEqual({
    n: 0,
  });
  await page.screenshot({ path: join(studio.folder, 'creation-home.png'), fullPage: true });
  await quick.getByRole('button', { name: '视频创作', exact: true }).click();
  await expect(page).toHaveURL(`${studio.origin}/?kind=video`);
  await expect(quick.getByRole('button', { name: '视频创作', exact: true })).toHaveClass(/active/);
  await expect(quick.getByRole('button', { name: '生成视频', exact: true })).toBeEnabled();
  await expect(
    page.getByText('以下为静态画面灵感，可用于构思视频；不是视频成片。', { exact: true }),
  ).toBeVisible();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('keeps the natural-language brief and primary actions in the first screen with advanced settings collapsed', async ({
  page,
  studio,
}) => {
  await openHome(page, studio);
  const composer = page.locator('.new-workspace-compose .composer');
  const brief = composer.getByRole('textbox', { name: '创作需求', exact: true });
  const save = composer.getByRole('button', { name: '保存草稿', exact: true });
  const generate = composer.getByRole('button', { name: '生成图片', exact: true });
  const advanced = composer.getByRole('button', { name: '更多创作设置', exact: true });
  const platform = composer.getByRole('combobox', { name: '发布平台', exact: true });
  const bounds = await firstScreenBounds(page, {
    brief,
    image: composer.getByRole('button', { name: '图片创作', exact: true }),
    video: composer.getByRole('button', { name: '视频创作', exact: true }),
    material: composer.getByRole('button', { name: '添加素材', exact: true }),
    save,
    generate,
    advanced,
    platform,
    estimate: composer.locator('.credit-estimate'),
  });
  const minimumBriefHeight = await brief.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      Number.parseFloat(style.lineHeight) * 2 +
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom)
    );
  });
  expect(bounds.bounds.brief!.height).toBeGreaterThanOrEqual(minimumBriefHeight);
  expect(bounds.bounds.generate!.height).toBeGreaterThanOrEqual(38);
  await expect(platform).toBeVisible();
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await expect(generate).toBeEnabled();
  await expect(save).toBeEnabled();
  await expect(composer.getByRole('region', { name: '创作设置', exact: true })).toHaveCount(0);
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  await writeFile(
    join(studio.folder, 'creation-first-screen-bounds.json'),
    JSON.stringify(bounds, null, 2),
  );
  await page.screenshot({ path: join(studio.folder, 'creation-first-screen.png') });
  await page.screenshot({ path: join(studio.folder, 'creation-full-page.png'), fullPage: true });

  const idea = originalInspirations[0]!;
  const card = page.getByRole('button', { name: `预览灵感：${idea.title}`, exact: true });
  await expect
    .poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await card.click();
  const preview = page.getByRole('dialog', { name: idea.title, exact: true });
  await expect(
    composer.getByRole('textbox', { name: '创作需求', exact: true, includeHidden: true }),
  ).toHaveValue('');
  await preview.getByRole('button', { name: '使用这个想法', exact: true }).click();
  await expect(brief).toHaveValue(idea.prompt);
  await expect(brief).toBeFocused();
  await brief.clear();
  await advanced.click();
  await expect(composer.getByRole('button', { name: '收起高级设置', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(platform).toBeVisible();
  for (const name of ['生成模型', '比例', '清晰度'])
    await expect(composer.getByRole('combobox', { name, exact: true })).toBeVisible();
  await platform.selectOption('Amazon');
  await composer.getByRole('button', { name: '收起高级设置', exact: true }).click();
  await expect(platform).toBeVisible();
  await advanced.click();
  await expect(platform).toHaveValue('Amazon');
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('uploads a real reference from the creation workspace and preserves separate image/video drafts through refresh and project save', async ({
  page,
  studio,
}) => {
  const session = await openHome(page, studio);
  const composer = page.locator('.composer');
  const brief = composer.getByRole('textbox', { name: '创作需求', exact: true });
  const imagePrompt = '为这款植物精华设计一张留白充足、自然光照的商品主图。';
  const videoPrompt = '镜头缓缓推近产品，晨光沿玻璃瓶身移动，保持安静的自然氛围。';
  const source = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#cd785b' },
  })
    .png()
    .toBuffer();
  await brief.fill(imagePrompt);
  await composer.getByRole('button', { name: '添加素材', exact: true }).click();
  const materialDialog = page.getByRole('dialog', { name: '参考图片、视频或文档', exact: true });
  await expect(materialDialog).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await materialDialog.getByRole('button', { name: '上传', exact: true }).click();
  await (await chooser).setFiles({ name: '首页参考.png', mimeType: 'image/png', buffer: source });
  await expect(materialDialog.locator('.upload-row')).toContainText('已保存');
  await materialDialog.getByRole('button', { name: '完成选择', exact: true }).click();
  const reference = composer.locator('.asset-chip');
  await expect(reference).toHaveCount(1);
  await expect(reference).toContainText('首页参考.png');

  const uploaded = await page.request.get(`${studio.origin}/api/v1/assets?q=首页参考`, {
    headers: session.headers,
  });
  expect(uploaded.status()).toBe(200);
  const assets = (await uploaded.json()).data.items as AssetDto[];
  expect(assets).toHaveLength(1);
  const asset = assets[0]!;
  expect(asset).toMatchObject({
    kind: 'image',
    width: 640,
    height: 480,
    byteSize: source.length,
    source: 'upload',
  });
  const downloaded = await page.request.get(new URL(asset.originalUrl, studio.origin).toString());
  expect(downloaded.status()).toBe(200);
  expect(
    createHash('sha256')
      .update(await downloaded.body())
      .digest('hex'),
  ).toBe(createHash('sha256').update(source).digest('hex'));

  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await expect(brief).toHaveValue('');
  await expect(reference).toHaveCount(0);
  await brief.fill(videoPrompt);
  await page.reload();
  await expect(brief).toHaveValue(videoPrompt);
  await composer.getByRole('button', { name: '图片创作', exact: true }).click();
  await expect(brief).toHaveValue(imagePrompt);
  await expect(reference).toContainText('首页参考.png');
  await page.reload();
  await expect(brief).toHaveValue(imagePrompt);
  await expect(reference).toContainText('首页参考.png');
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  const response = await page.request.get(
    `${studio.origin}/api/v1/projects/${projectId}/messages`,
    {
      headers: session.headers,
    },
  );
  expect(response.status()).toBe(200);
  const messages = (await response.json()).data.items as { metadata?: { draft?: JobInput } }[];
  const draft = messages.filter((message) => message.metadata?.draft).at(-1)?.metadata?.draft;
  expect(draft).toMatchObject({ prompt: imagePrompt, assetIds: [asset.id] });
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    `yingzao:creation:v1:${session.userId}:${session.workspaceId}:${projectId}`,
  );
  await page.reload();
  await expect(brief).toHaveValue(imagePrompt);
  await expect(reference).toContainText('首页参考.png');
  await expect
    .poll(() => reference.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM projects').get()).toEqual({
    n: 1,
  });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('opens a redesigned inspiration card and reuses the original media in an editable persisted project', async ({
  page,
  studio,
}) => {
  const session = await openHome(page, studio, '/inspiration');
  const title = '把清晨，装进一滴精华';
  const card = page.locator('.inspiration-card').filter({
    has: page.getByRole('button', { name: `${title} · 预览灵感`, exact: true }),
  });
  await expect(card).toBeVisible();
  await expect
    .poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await card.getByRole('button', { name: `${title} · 预览灵感`, exact: true }).click();
  const detail = page.getByRole('dialog', { name: title, exact: true });
  const prompt = '保留这份灵感的自然光线，用于一款新的植物护肤产品。';
  await detail.locator('summary').filter({ hasText: '查看或调整提示词' }).click();
  await detail.getByLabel(/^创作提示词/).fill(prompt);
  await detail.getByRole('button', { name: '使用此灵感', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(prompt);
  await expect(page.locator('.composer .asset-chip')).toHaveCount(1);
  const response = await page.request.get(
    `${studio.origin}/api/v1/projects/${projectId}/messages`,
    {
      headers: session.headers,
    },
  );
  expect(response.status()).toBe(200);
  const messages = (await response.json()).data.items as {
    metadata?: { draft?: JobInput; inspirationId?: string };
  }[];
  const draft = messages.find((message) => message.metadata?.inspirationId === 'botanical-serum')
    ?.metadata?.draft;
  expect(draft).toMatchObject({ prompt, options: { ratio: '2:3' } });
  expect(draft?.assetIds).toHaveLength(1);
  const assetResponse = await page.request.get(
    `${studio.origin}/api/v1/assets/${draft!.assetIds[0]}`,
    {
      headers: session.headers,
    },
  );
  expect(assetResponse.status()).toBe(200);
  const asset = (await assetResponse.json()).data as AssetDto;
  expect(asset.projectId).toBe(projectId);
  const actual = await page.request.get(new URL(asset.originalUrl, studio.origin).toString());
  expect(actual.status()).toBe(200);
  expect(
    createHash('sha256')
      .update(await actual.body())
      .digest('hex'),
  ).toBe(
    createHash('sha256')
      .update(await readFile('public/gallery/botanical-serum.webp'))
      .digest('hex'),
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(prompt);
  await expect(page.locator('.composer .asset-chip')).toContainText(asset.name);
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM inspiration_reuses').get(),
  ).toEqual({ n: 1 });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

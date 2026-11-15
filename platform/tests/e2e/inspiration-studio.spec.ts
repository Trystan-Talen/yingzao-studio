import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import type { AssetDto } from '../../src/contracts/core';
import { test, expect, type Studio } from './fixtures';
import {
  creationRecords,
  expectInsideViewport,
  expectNoHorizontalOverflow,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

async function openStudio(page: Page, studio: Studio, path = '/inspiration') {
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
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  await page.goto(`${studio.origin}${path}`);
  await expect(page.getByRole('heading', { name: '灵感探索', exact: true })).toBeVisible();
  return {
    account,
    headers: { origin: studio.origin, 'x-workspace-id': account.workspace.id },
    writes,
  };
}

function expectNoGeneration(studio: Studio, writes: string[], projects = 0) {
  expect(creationRecords(studio)).toEqual({
    briefs: 0,
    projects,
    quotes: 0,
    jobs: 0,
    reserved: 0,
    settled: 0,
  });
  expect(writes.filter((path) => /\/(creative-briefs|quotes|jobs)(\/|$)/.test(path))).toEqual([]);
}

test('keeps rapid favorite search and media changes together before navigation renders', async ({
  page,
  studio,
}) => {
  const { headers, writes } = await openStudio(page, studio);
  expect(
    (
      await page.request.put(`${studio.origin}/api/v1/inspirations/botanical-serum/favorite`, {
        headers,
        data: { favorite: true },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`${studio.origin}/inspiration?kind=video&videoCategory=story&page=2`);
  await expect(page.getByRole('combobox', { name: '视频内容分类', exact: true })).toBeVisible();
  // Native events deliberately share a turn: awaiting a URL between controls hides this race.
  await page.evaluate(() => {
    const favorite = document.querySelector<HTMLButtonElement>(
      'button[aria-label="仅显示已收藏"]',
    )!;
    const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索灵感"]')!;
    const kind = document.querySelector<HTMLSelectElement>('select[aria-label="灵感类型"]')!;
    favorite.click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '精华');
    search.dispatchEvent(new Event('input', { bubbles: true }));
    kind.value = 'image';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect
    .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
    .toEqual({
      kind: 'image',
      favorite: 'true',
      q: '精华',
    });
  await expect(page.locator('.inspiration-studio-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: '显示全部灵感', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索灵感', exact: true })).toHaveValue('精华');
  await expect(page.getByRole('combobox', { name: '灵感类型', exact: true })).toHaveValue('image');
  await expect(page.locator('.inspiration-studio-card')).toHaveCount(1);
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
  await page.getByRole('link', { name: '灵感', exact: true }).click();
  await expect(page).toHaveURL(`${studio.origin}/inspiration`);
  await page.getByRole('textbox', { name: '搜索灵感', exact: true }).fill('柑橘');
  await expect
    .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
    .toEqual({
      q: '柑橘',
    });
  await page.goBack();
  await expect
    .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
    .toEqual({
      kind: 'image',
      favorite: 'true',
      q: '精华',
    });
  await page.getByRole('textbox', { name: '搜索灵感', exact: true }).fill('清晨');
  await expect
    .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
    .toEqual({
      kind: 'image',
      favorite: 'true',
      q: '清晨',
    });
  await expect(page.locator('.inspiration-studio-card')).toHaveCount(1);
  expectNoGeneration(studio, writes);
});

test('shows complete artwork before optional prompt editing and persists favorites without generating', async ({
  page,
  studio,
}) => {
  const { writes } = await openStudio(page, studio);
  const cards = page.locator('.inspiration-studio-card');
  await expect(cards).toHaveCount(8);
  await expect(page.locator('main h1')).toHaveCount(1);
  expect(
    await page
      .getByRole('textbox', { name: '搜索灵感', exact: true })
      .evaluate((input) => getComputedStyle(input).borderTopWidth),
  ).toBe('0px');
  const columns = await page
    .locator('.inspiration-studio-grid')
    .evaluate((gallery) => Number(getComputedStyle(gallery).columnCount));
  expect(columns).toBe(
    page.viewportSize()!.width > 1000 ? 4 : page.viewportSize()!.width > 700 ? 3 : 2,
  );
  for (const image of await cards.locator('.inspiration-studio-image img').all()) {
    await image.scrollIntoViewIfNeeded();
    // Verify the resting artwork; the approved hover animation deliberately zooms it.
    await page.mouse.move(0, 0);
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const dimensions = await image.evaluate((el) => {
      const img = el as HTMLImageElement;
      const rect = img.getBoundingClientRect();
      const frameElement = img.closest('button')!;
      const frame = frameElement.getBoundingClientRect();
      const frameStyle = getComputedStyle(frameElement);
      const horizontalBorder =
        parseFloat(frameStyle.borderLeftWidth) + parseFloat(frameStyle.borderRightWidth);
      const verticalBorder =
        parseFloat(frameStyle.borderTopWidth) + parseFloat(frameStyle.borderBottomWidth);
      return {
        displayedRatio: rect.width / rect.height,
        originalRatio: img.naturalWidth / img.naturalHeight,
        frameWidthGap: Math.abs(frame.width - horizontalBorder - rect.width),
        frameHeightGap: Math.abs(frame.height - verticalBorder - rect.height),
        fit: getComputedStyle(img).objectFit,
        transform: getComputedStyle(img).transform,
      };
    });
    // Natural image proportions keep all artwork visible without empty fixed-ratio frames.
    expect(dimensions.displayedRatio).toBeCloseTo(dimensions.originalRatio, 2);
    expect(dimensions.frameWidthGap).toBeLessThanOrEqual(1);
    expect(dimensions.frameHeightGap).toBeLessThanOrEqual(1);
    expect(dimensions.fit).toBe('contain');
    expect(dimensions.transform).toBe('none');
  }
  const originalViewport = page.viewportSize()!;
  if (originalViewport.width > 700) {
    await page.setViewportSize({ width: 1800, height: originalViewport.height });
    await expect(page.locator('.inspiration-studio-grid')).toHaveCSS('column-count', '4');
    const occupied = await cards.evaluateAll((items) => {
      const bounds = items.map((item) => item.getBoundingClientRect());
      const gallery = items[0]!.parentElement!.getBoundingClientRect();
      return {
        columns: new Set(bounds.map((rect) => Math.round(rect.x))).size,
        trailingGap: Math.abs(gallery.right - Math.max(...bounds.map((rect) => rect.right))),
      };
    });
    // Eight samples must fill the gallery rather than reserve an empty fifth column.
    expect(occupied.columns).toBe(4);
    expect(occupied.trailingGap).toBeLessThanOrEqual(1);
    await page.setViewportSize(originalViewport);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await expectNoHorizontalOverflow(page);
  const title = '把清晨，装进一滴精华';
  await page.screenshot({
    path: join(studio.folder, 'inspiration-gallery.png'),
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  });
  await page.getByRole('button', { name: `${title} · 预览灵感`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  const disclosure = dialog.locator('.inspiration-studio-prompt');
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(dialog.getByRole('textbox', { name: '创作提示词', exact: true })).not.toBeVisible();
  await expect(dialog.getByRole('button', { name: '使用此灵感', exact: true })).toBeEnabled();
  const detailImage = dialog.getByRole('img', { name: title, exact: true });
  await expect
    .poll(() => detailImage.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(1000);
  expect(await detailImage.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, 'inspiration-detail.png'),
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  });
  await expectInsideViewport(dialog.getByRole('button', { name: '使用此灵感', exact: true }), page);
  await disclosure.locator('summary').click();
  const prompt = dialog.getByRole('textbox', { name: '创作提示词', exact: true });
  const originalPrompt = await prompt.inputValue();
  await prompt.fill('');
  await expect(dialog.getByRole('alert')).toHaveText('请填写创作提示词后再使用此灵感。');
  await expect(dialog.getByRole('button', { name: '使用此灵感', exact: true })).toBeDisabled();
  await prompt.fill(originalPrompt);
  await expect(dialog.getByRole('button', { name: '使用此灵感', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: `收藏 ${title}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `取消收藏 ${title}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '仅显示已收藏', exact: true }).click();
  await expect(cards).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('favorite')).toBe('true');
  await page.reload();
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole('button', { name: '显示全部灵感', exact: true })).toBeVisible();
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM inspiration_favorites').get(),
  ).toEqual({ n: 1 });
  await page.getByRole('button', { name: `取消收藏 ${title}`, exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByRole('button', { name: '显示全部灵感', exact: true }).click();
  await expect(cards).toHaveCount(8);
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM inspiration_favorites').get(),
  ).toEqual({ n: 0 });
  expectNoGeneration(studio, writes);
});

test('recovers the same edited image draft after a lost response, retains its original and returns to URL filters', async ({
  page,
  studio,
}) => {
  const { headers, writes } = await openStudio(page, studio);
  const favorite = await page.request.put(
    `${studio.origin}/api/v1/inspirations/botanical-serum/favorite`,
    {
      headers,
      data: { favorite: true },
    },
  );
  expect(favorite.status()).toBe(200);
  const filters = new URLSearchParams({
    kind: 'image',
    category: '美妆护肤',
    q: '精华',
    platform: '通用电商',
    favorite: 'true',
  });
  const filteredUrl = `${studio.origin}/inspiration?${filters}`;
  await page.goto(filteredUrl);
  await expect(page.locator('.inspiration-studio-card')).toHaveCount(1);
  const title = '把清晨，装进一滴精华';
  await page.getByRole('button', { name: `${title} · 预览灵感`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.locator('.inspiration-studio-prompt summary').click();
  const customPrompt = '借用这份清晨配色，用我的完整原话保留细节，不添加文字。';
  await dialog.getByRole('textbox', { name: '创作提示词', exact: true }).fill(customPrompt);
  const requestIds: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/inspirations/botanical-serum/reuse')
    )
      requestIds.push((request.postDataJSON() as { requestId: string }).requestId);
  });
  let committed = false;
  await page.route('**/api/v1/inspirations/botanical-serum/reuse', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed = true;
    await route.abort('failed');
  });
  await dialog.getByRole('button', { name: '使用此灵感', exact: true }).click();
  await expect.poll(() => committed).toBe(true);
  await expect(page.getByRole('button', { name: '继续上次灵感复用', exact: true })).toBeVisible();
  await page.unroute('**/api/v1/inspirations/botanical-serum/reuse');
  await page.reload();
  await page.getByRole('button', { name: '继续上次灵感复用', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  const prompt = page.locator('.composer').getByRole('textbox', { name: '创作需求', exact: true });
  await expect(prompt).toHaveValue(customPrompt);
  await expect(page.locator('.composer .asset-chip')).toHaveCount(1);
  await page.reload();
  await expect(prompt).toHaveValue(customPrompt);
  await expect(page.locator('.composer .asset-chip')).toHaveCount(1);
  expect(requestIds).toHaveLength(2);
  expect(new Set(requestIds).size).toBe(1);
  const messages = (
    await (
      await page.request.get(`${studio.origin}/api/v1/projects/${projectId}/messages`, { headers })
    ).json()
  ).data;
  expect(messages.total).toBe(1);
  expect(messages.items[0].metadata).toMatchObject({
    inspirationId: 'botanical-serum',
    draft: {
      operation: 'image.generate',
      prompt: customPrompt,
      projectId,
      options: { platform: '通用电商', ratio: '2:3' },
    },
  });
  const assetIds = messages.items[0].metadata.draft.assetIds as string[];
  expect(assetIds).toHaveLength(1);
  const asset = (
    await (
      await page.request.get(`${studio.origin}/api/v1/assets/${assetIds[0]}`, { headers })
    ).json()
  ).data as AssetDto;
  const original = studio.services.db.sqlite
    .prepare(
      "SELECT a.sha256,a.byte_size,v.storage_key FROM assets a JOIN asset_variants v ON v.asset_id=a.id AND v.variant='original' WHERE a.id=?",
    )
    .get(asset.id) as { sha256: string; byte_size: number; storage_key: string };
  const served = await (
    await page.request.get(new URL(asset.originalUrl, studio.origin).href)
  ).body();
  const persisted = await readFile(join(studio.folder, 'media', original.storage_key));
  const publicOriginal = await readFile('public/gallery/botanical-serum.webp');
  const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  const hash = digest(publicOriginal);
  expect([digest(served), digest(persisted), original.sha256]).toEqual([hash, hash, hash]);
  expect([served.length, persisted.length, original.byte_size, asset.byteSize]).toEqual(
    Array<number>(4).fill(publicOriginal.length),
  );
  for (const table of ['assets', 'inspiration_reuses'])
    expect(studio.services.db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({
      n: 1,
    });
  expectNoGeneration(studio, writes, 1);
  await writeFile(
    join(studio.folder, 'inspiration-original-evidence.json'),
    JSON.stringify(
      {
        simulated: true,
        projectId,
        assetId: asset.id,
        requestIds,
        sha256: hash,
        byteSize: served.length,
        originalMatchesPublicApiDiskAndDatabase: true,
        generation: creationRecords(studio),
      },
      null,
      2,
    ),
  );
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByRole('textbox', { name: '搜索灵感', exact: true })).toHaveValue('精华');
  await expect(page.getByRole('button', { name: '美妆护肤', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('combobox', { name: '灵感类型', exact: true })).toHaveValue('image');
  await expect(page.getByRole('combobox', { name: '发布平台', exact: true })).toHaveValue(
    '通用电商',
  );
  await expect(page.getByRole('button', { name: '显示全部灵感', exact: true })).toBeVisible();
  await expect(page.locator('.inspiration-studio-card')).toHaveCount(1);
});

test('restores every video filter and page from the URL and resets only pagination when filters change', async ({
  page,
  studio,
}) => {
  const { account, headers, writes } = await openStudio(page, studio);
  const file = join(studio.folder, 'filter-video.mp4');
  await promisify(execFile)('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=160x120:r=20:d=3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    file,
  ]);
  const asset = await studio.services.core.assets.ingest(
    { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    account.workspace.id,
    { buffer: await readFile(file), name: 'filter-video.mp4', mimeType: 'video/mp4' },
  );
  for (let index = 0; index < 23; index++) {
    const response = await page.request.post(`${studio.origin}/api/v1/inspirations`, {
      headers,
      data: {
        title: `筛选样本 ${index + 1}`,
        category: '筛选行业',
        kind: 'video',
        videoCategory: 'story',
        tag: '隔离本机合成',
        platform: 'TikTok',
        ratio: '4:3',
        prompt: '筛选样本，保持原片，只保存草稿',
        source: '本机合成纯色视频，无第三方原件',
        assetId: asset.id,
      },
    });
    expect(response.status()).toBe(201);
    const inspiration = (await response.json()).data;
    expect(
      (
        await page.request.put(`${studio.origin}/api/v1/inspirations/${inspiration.id}/favorite`, {
          headers,
          data: { favorite: true },
        })
      ).status(),
    ).toBe(200);
    if (index === 0)
      expect(
        (
          await page.request.patch(`${studio.origin}/api/v1/inspirations/${inspiration.id}`, {
            headers,
            data: { archived: true },
          })
        ).status(),
      ).toBe(200);
  }
  const filters = {
    q: '筛选样本',
    category: '筛选行业',
    kind: 'video',
    videoCategory: 'story',
    platform: 'TikTok',
    favorite: 'true',
    archived: 'true',
    page: '2',
  };
  const url = `${studio.origin}/inspiration?${new URLSearchParams(filters)}`;
  await page.goto(url);
  const assertSecondPage = async () => {
    await expect(page.locator('.inspiration-studio-card')).toHaveCount(3);
    await expect(page.locator('.pagination')).toContainText('2 / 2');
    await expect(page.getByRole('textbox', { name: '搜索灵感', exact: true })).toHaveValue(
      '筛选样本',
    );
    await expect(page.getByRole('button', { name: '筛选行业', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('combobox', { name: '灵感类型', exact: true })).toHaveValue(
      'video',
    );
    await expect(page.getByRole('combobox', { name: '视频内容分类', exact: true })).toHaveValue(
      'story',
    );
    await expect(page.getByRole('combobox', { name: '发布平台', exact: true })).toHaveValue(
      'TikTok',
    );
    await expect(page.getByRole('button', { name: '显示全部灵感', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '包含已下架', exact: true })).toBeChecked();
  };
  await assertSecondPage();
  await page.reload();
  await assertSecondPage();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.locator('.inspiration-studio-card')).toHaveCount(20);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(
    Object.fromEntries(Object.entries(filters).filter(([key]) => key !== 'page')),
  );
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await assertSecondPage();
  await page.getByRole('combobox', { name: '视频内容分类', exact: true }).selectOption('');
  await expect(page.locator('.inspiration-studio-card')).toHaveCount(20);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  expect(new URL(page.url()).searchParams.has('videoCategory')).toBe(false);
  for (const key of ['q', 'category', 'kind', 'platform', 'favorite', 'archived'] as const)
    expect(new URL(page.url()).searchParams.get(key)).toBe(filters[key]);
  await page.getByRole('combobox', { name: '视频内容分类', exact: true }).selectOption('story');
  await page.getByRole('combobox', { name: '灵感类型', exact: true }).selectOption('image');
  await expect(page.locator('.inspiration-studio-card')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('videoCategory')).toBe(false);
  await expect(page.getByRole('combobox', { name: '视频内容分类', exact: true })).toHaveCount(0);
  expectNoGeneration(studio, writes);
});

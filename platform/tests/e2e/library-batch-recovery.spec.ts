import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function account(page: Page, studio: Studio) {
  const owner = await studio.existingIdentitySession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return owner;
}

async function files() {
  return Promise.all(
    ['#24704b', '#b54b32'].map(async (background, index) => ({
      name: `批次素材${index + 1}.png`,
      mimeType: 'image/png',
      buffer: await sharp({ create: { width: 96, height: 64, channels: 3, background } })
        .png()
        .toBuffer(),
    })),
  );
}

test('keeps every upload in its original workspace when switching spaces during a delayed batch', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const other = studio.services.core.auth.createWorkspace(
    owner.user.id,
    '批次隔离目标空间',
    'team',
    false,
  );
  await page.goto(`${studio.origin}/assets`);
  const sources = await files();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let ready = false;
  await page.route('**/api/v1/assets/upload', async (route) => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    ready = true;
    await barrier;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await page.locator('.page > input[type=file]').setInputFiles(sources);
    await expect.poll(() => ready).toBe(true);
    const openNavigation = page.getByRole('button', { name: '展开导航', exact: true });
    if (await openNavigation.isVisible()) await openNavigation.click();
    await page.locator('.workspace-switch:visible').click();
    await page.getByRole('button', { name: other.name, exact: true }).click();
    await expect
      .poll(async () => {
        const response = await page.request.get(`${studio.origin}/api/v1/auth/me`);
        return (await response.json()).data.activeWorkspaceId;
      })
      .toBe(other.id);
    await expect(page).toHaveURL(`${studio.origin}/`);
    release();
    await expect
      .poll(() => studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get())
      .toEqual({ n: 2 });
    expect(
      studio.services.db.sqlite.prepare('SELECT name,workspace_id FROM assets ORDER BY name').all(),
    ).toEqual([
      { name: '批次素材1.png', workspace_id: owner.workspace.id },
      { name: '批次素材2.png', workspace_id: owner.workspace.id },
    ]);
    const targetAssets = await page.request.get(`${studio.origin}/api/v1/assets`, {
      headers: { 'x-workspace-id': other.id },
    });
    expect((await targetAssets.json()).data.total).toBe(0);
    const originalAssets = await page.request.get(`${studio.origin}/api/v1/assets`, {
      headers: { 'x-workspace-id': owner.workspace.id },
    });
    const originalItems = (await originalAssets.json()).data.items as {
      name: string;
      originalUrl: string;
      width: number;
      height: number;
    }[];
    for (const source of sources) {
      const asset = originalItems.find((item) => item.name === source.name)!;
      expect([asset.width, asset.height]).toEqual([96, 64]);
      const original = await page.request.get(new URL(asset.originalUrl, studio.origin).href, {
        headers: { 'x-workspace-id': owner.workspace.id },
      });
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(source.buffer);
    }
    await page.goto(`${studio.origin}/assets`);
    await expect(page.getByRole('heading', { name: '素材库', exact: true })).toBeVisible();
    await expect(page.getByText('添加第一份创作素材', { exact: true })).toBeVisible();
    await expect(page.locator('.asset-card')).toHaveCount(0);
    await page.screenshot({
      path: `${studio.folder}/batch-workspace-isolation.png`,
      fullPage: true,
    });
  } finally {
    release();
  }
});

test('refreshes successful batch deletions and retries only remaining assets after a partial failure', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const assets: { id: string; name: string }[] = [];
  for (const file of await files()) {
    const response = await page.request.post(`${studio.origin}/api/v1/assets/upload`, {
      headers: { origin: studio.origin, 'x-workspace-id': owner.workspace.id },
      multipart: { file },
    });
    expect(response.status()).toBe(201);
    assets.push((await response.json()).data);
  }
  const failedId = assets[1]!.id;
  let failOnce = true;
  const deletions: string[] = [];
  await page.route('**/api/v1/assets/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    deletions.push(id);
    if (id === failedId && failOnce) {
      failOnce = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FIXTURE_UNAVAILABLE', message: '暂时无法删除' } }),
      });
    } else await route.continue();
  });
  await page.goto(`${studio.origin}/assets`);
  for (const asset of assets)
    await page.getByRole('checkbox', { name: `选择${asset.name}`, exact: true }).check();
  await page.locator('.selection-bar').getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await expect.poll(() => failOnce).toBe(false);
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await expect(page.locator('.selection-bar')).toContainText('已选择1项');
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.asset-card')).toHaveCount(0);
  expect(deletions).toEqual([assets[0]!.id, failedId, failedId]);
  expect(
    studio.services.db.sqlite
      .prepare('SELECT count(*) n FROM assets WHERE deleted_at IS NOT NULL')
      .get(),
  ).toEqual({ n: 2 });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
    n: 2,
  });
  await page.screenshot({ path: `${studio.folder}/batch-delete-recovered.png`, fullPage: true });
});

test('reports an unavailable project library and restores saved work through an explicit retry', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const headers = { origin: studio.origin, 'x-workspace-id': owner.workspace.id };
  const created = await page.request.post(`${studio.origin}/api/v1/projects`, {
    headers,
    data: { name: '网络恢复后继续的项目', kind: 'image' },
  });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).data.id as string;
  let unavailable = true;
  await page.route('**/api/v1/projects?*', async (route) => {
    if (!unavailable) return route.continue();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'FIXTURE_UNAVAILABLE', message: '最近项目暂时无法读取，请重试。' },
      }),
    });
  });
  await page.goto(`${studio.origin}/projects`);
  const recent = page.locator('.projects-page');
  await expect(recent).toContainText('最近项目暂时无法读取，请重试。');
  await expect(recent.locator('.project-card')).toHaveCount(0);
  await expect(recent.locator('.empty-state')).toHaveCount(0);
  unavailable = false;
  await recent.getByRole('button', { name: '重试', exact: true }).click();
  const project = recent.getByRole('link', { name: '网络恢复后继续的项目', exact: true });
  await expect(project).toBeVisible();
  await expect(project).toHaveAttribute('href', `/workbench/${projectId}`);
  await page.screenshot({ path: `${studio.folder}/recent-projects-recovered.png`, fullPage: true });
});

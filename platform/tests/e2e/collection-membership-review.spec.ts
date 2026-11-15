import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function setup(page: Page, studio: Studio) {
  const owner = await studio.existingIdentitySession();
  await page
    .context()
    .addCookies([{ name: 'studio_session', value: owner.sessionToken, url: studio.origin }]);
  const headers = { origin: studio.origin, 'x-workspace-id': owner.workspace.id };
  const assets: { id: string; name: string }[] = [];
  for (const [index, background] of ['#24704b', '#b54b32', '#234578'].entries()) {
    const response = await page.request.post(`${studio.origin}/api/v1/assets/upload`, {
      headers,
      multipart: {
        file: {
          name: `集合素材${index + 1}.png`,
          mimeType: 'image/png',
          buffer: await sharp({ create: { width: 64, height: 64, channels: 3, background } })
            .png()
            .toBuffer(),
        },
      },
    });
    expect(response.status()).toBe(201);
    assets.push((await response.json()).data);
  }
  const response = await page.request.post(`${studio.origin}/api/v1/collections`, {
    headers,
    data: { name: '保留完整归属的集合' },
  });
  expect(response.status()).toBe(201);
  const collection = (await response.json()).data as { id: string; name: string };
  const assigned = await page.request.put(
    `${studio.origin}/api/v1/collections/${collection.id}/assets`,
    { headers, data: { assetIds: [assets[0]!.id] } },
  );
  expect(assigned.status()).toBe(200);
  return { headers, assets, collection };
}

test('adding an asset preserves collection membership of an item in the recycle bin', async ({
  page,
  studio,
}) => {
  const { headers, assets, collection } = await setup(page, studio);
  const removed = await page.request.delete(`${studio.origin}/api/v1/assets/${assets[0]!.id}`, {
    headers,
  });
  expect(removed.status()).toBe(200);
  await page.goto(`${studio.origin}/assets`);
  await page.getByRole('checkbox', { name: `选择${assets[1]!.name}`, exact: true }).check();
  await page.getByRole('button', { name: '加入集合', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: collection.name }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const restored = await page.request.post(
    `${studio.origin}/api/v1/assets/${assets[0]!.id}/restore`,
    { headers },
  );
  expect(restored.status()).toBe(200);
  const result = await page.request.get(
    `${studio.origin}/api/v1/assets?collectionId=${collection.id}`,
    { headers },
  );
  expect((await result.json()).data.items.map((asset: { id: string }) => asset.id).sort()).toEqual(
    [assets[0]!.id, assets[1]!.id].sort(),
  );
  await page.getByRole('combobox', { name: '素材集合', exact: true }).selectOption(collection.id);
  await expect(page.locator('.asset-card')).toHaveCount(2);
  await page.screenshot({
    path: `${studio.folder}/collection-recycle-preserved.png`,
    fullPage: true,
  });
});

test('adding and removing selected assets preserves a concurrent collection addition', async ({
  page,
  studio,
}) => {
  const { headers, assets, collection } = await setup(page, studio);
  let inserted = false;
  await page.route(`**/api/v1/collections/${collection.id}/assets`, async (route) => {
    if (!inserted && ['PUT', 'PATCH'].includes(route.request().method())) {
      inserted = true;
      const other = await page.request.put(
        `${studio.origin}/api/v1/collections/${collection.id}/assets`,
        { headers, data: { assetIds: [assets[0]!.id, assets[2]!.id] } },
      );
      expect(other.status()).toBe(200);
    }
    await route.continue();
  });
  await page.goto(`${studio.origin}/assets`);
  await page.getByRole('checkbox', { name: `选择${assets[1]!.name}`, exact: true }).check();
  await page.getByRole('button', { name: '加入集合', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: collection.name }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('combobox', { name: '素材集合', exact: true }).selectOption(collection.id);
  await expect(page.locator('.asset-card')).toHaveCount(3);
  await page.getByRole('checkbox', { name: `选择${assets[1]!.name}`, exact: true }).check();
  await page.getByRole('button', { name: '移出当前集合', exact: true }).click();
  await expect(page.locator('.asset-card')).toHaveCount(2);
  const result = await page.request.get(
    `${studio.origin}/api/v1/assets?collectionId=${collection.id}`,
    { headers },
  );
  expect((await result.json()).data.items.map((asset: { id: string }) => asset.id).sort()).toEqual(
    [assets[0]!.id, assets[2]!.id].sort(),
  );
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
    n: 3,
  });
});

test('collection lookup failure offers retry instead of claiming the collection list is empty', async ({
  page,
  studio,
}) => {
  const { assets, collection } = await setup(page, studio);
  let unavailable = true;
  await page.route('**/api/v1/collections?*', async (route) => {
    if (!unavailable) return route.continue();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'FIXTURE_UNAVAILABLE', message: '集合暂时无法读取' } }),
    });
  });
  await page.goto(`${studio.origin}/assets`);
  await page.getByRole('checkbox', { name: `选择${assets[1]!.name}`, exact: true }).check();
  await page.getByRole('button', { name: '加入集合', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('集合暂时无法读取');
  await expect(dialog).not.toContainText('请先创建一个集合');
  unavailable = false;
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog.getByRole('button', { name: collection.name })).toBeVisible();
});

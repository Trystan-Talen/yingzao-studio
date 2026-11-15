import sharp from 'sharp';
import type { Actor } from '../../src/contracts/core';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

test('preserves edited product text on image-load retry and repairs recycled references before restoring', async ({
  page,
  studio,
}) => {
  const owner = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: owner.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const core = studio.services.core;
  const wid = owner.workspace.id;
  const buffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#126a5c' },
  })
    .png()
    .toBuffer();
  const asset = await core.assets.ingest(actor, wid, {
    buffer,
    name: 'product-reference.png',
    mimeType: 'image/png',
  });
  const product = core.knowledge.createProduct(actor, wid, {
    name: '原产品名称',
    facts: ['原事实'],
    referenceAssetIds: [asset.id],
  });
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/products`);
  await page.route(
    `**/api/v1/assets/${asset.id}`,
    (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'FIXTURE_LOAD_FAILED', message: '产品参考读取失败夹具' },
        }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: '编辑产品', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '产品资料', exact: true });
  await expect(dialog).toContainText('产品参考读取失败夹具');
  await dialog.getByRole('textbox', { name: '产品名称', exact: true }).fill('保留用户修改');
  await dialog.getByRole('textbox', { name: /^产品事实（每行一条）/ }).fill('容量为30毫升');
  await expect(dialog.getByRole('button', { name: '保存产品', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog.locator('.asset-chip')).toHaveCount(1);
  await expect(dialog.getByRole('textbox', { name: '产品名称', exact: true })).toHaveValue(
    '保留用户修改',
  );
  await expect(dialog.getByRole('textbox', { name: /^产品事实（每行一条）/ })).toHaveValue(
    '容量为30毫升',
  );
  await dialog.getByRole('button', { name: '保存产品', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(core.knowledge.getProduct(actor, wid, product.id)).toMatchObject({
    name: '保留用户修改',
    facts: ['容量为30毫升'],
    referenceAssetIds: [asset.id],
    version: 2,
  });

  core.knowledge.removeProduct(actor, wid, product.id);
  core.assets.remove(actor, wid, asset.id);
  await page.reload();
  await page.getByRole('button', { name: '回收记录', exact: true }).click();
  await page.getByRole('button', { name: '编辑产品', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '保存产品', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '移除不可用图片', exact: true }).click();
  await dialog.getByRole('button', { name: '保存产品', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const recycled = core.knowledge.listProducts(actor, wid, { deleted: true }).items[0];
  expect(recycled?.deletedAt).toBeTruthy();
  expect(recycled?.referenceAssetIds).toEqual([]);
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByRole('heading', { name: '保留用户修改', exact: true })).toHaveCount(0);
  expect(core.knowledge.getProduct(actor, wid, product.id).referenceAssetIds).toEqual([]);
});

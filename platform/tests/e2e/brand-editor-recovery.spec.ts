import sharp from 'sharp';
import type { Actor } from '../../src/contracts/core';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

for (const creating of [false, true]) {
  test(`preserves edits made during a delayed brand ${creating ? 'creation' : 'update'} and saves them to the same record`, async ({
    page,
    studio,
  }) => {
    const account = await studio.existingIdentitySession();
    const actor: Actor = {
      userId: account.user.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    const core = studio.services.core;
    const wid = account.workspace.id;
    const brand = creating
      ? null
      : core.references.createBrand(actor, wid, {
          name: '品牌保存中输入',
          description: '原始描述',
        });
    await page.context().addCookies([
      {
        name: 'studio_session',
        value: account.sessionToken,
        url: studio.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto(`${studio.origin}/brands`);
    await page
      .getByRole('button', { name: creating ? '创建品牌' : '编辑品牌', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: creating ? '创建品牌' : '品牌参考',
      exact: true,
    });
    await dialog.getByRole('textbox', { name: '品牌名称', exact: true }).fill('品牌保存中输入');
    await dialog.getByRole('textbox', { name: '品牌描述', exact: true }).fill('本次提交A');
    let release!: () => void;
    let signal!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saved = new Promise<void>((resolve) => {
      signal = resolve;
    });
    let writes = 0;
    page.on('request', (request) => {
      if (
        ['POST', 'PATCH'].includes(request.method()) &&
        /^\/api\/v1\/brands(?:\/[^/]+)?$/.test(new URL(request.url()).pathname)
      )
        writes++;
    });
    await page.route(
      creating ? '**/api/v1/brands' : `**/api/v1/brands/${brand!.id}`,
      async (route) => {
        const response = await route.fetch();
        signal();
        await held;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await dialog.getByRole('button', { name: '保存品牌', exact: true }).click();
    await saved;
    await dialog
      .getByRole('textbox', { name: '品牌描述', exact: true })
      .fill('提交后继续输入B，不应丢失');
    release();
    const continuing = page.getByRole('dialog', { name: '品牌参考', exact: true });
    await expect(continuing).toContainText('提交内容已保存，之后的修改仍未保存。');
    await expect(continuing.getByRole('textbox', { name: '品牌描述', exact: true })).toHaveValue(
      '提交后继续输入B，不应丢失',
    );
    const first = core.references.brands(actor, wid, {}).items;
    expect(first).toHaveLength(1);
    expect(first[0]?.description).toBe('本次提交A');
    expect(writes).toBe(1);
    await continuing.getByRole('button', { name: '保存品牌', exact: true }).click();
    await expect(continuing).toHaveCount(0);
    const final = core.references.brands(actor, wid, {}).items;
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ id: first[0]!.id, description: '提交后继续输入B，不应丢失' });
    expect(writes).toBe(2);
  });
}

test('brand conflicts preserve local edits, explicitly merge current fields and references, and can reload a later version', async ({
  page,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const core = studio.services.core;
  const wid = account.workspace.id;
  const brand = core.references.createBrand(actor, wid, {
    name: '最初品牌名',
    description: '旧描述',
  });
  const image = await core.assets.ingest(actor, wid, {
    buffer: await sharp({ create: { width: 24, height: 24, channels: 3, background: '#126a5c' } })
      .png()
      .toBuffer(),
    name: 'brand-latest.png',
    mimeType: 'image/png',
  });
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/brands`);
  await page.getByRole('button', { name: '编辑品牌', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '品牌参考', exact: true });
  await expect(dialog.getByRole('textbox', { name: '品牌描述', exact: true })).toHaveValue(
    '旧描述',
  );
  const remote = core.references.updateBrand(actor, wid, brand.id, {
    name: '其他窗口品牌名',
    description: '其他编辑已保存的新描述',
    referenceAssetIds: [image.id],
  });
  await dialog.getByRole('textbox', { name: '品牌名称', exact: true }).fill('本地只修改名称');
  await dialog.getByRole('button', { name: '保存品牌', exact: true }).click();
  await expect(dialog).toContainText('服务器最新记录');
  await expect(dialog).toContainText(remote.updatedAt);
  await expect(dialog).toContainText('双方已修改');
  await expect(dialog).toContainText('其他编辑已保存的新描述');
  await expect(dialog.getByRole('textbox', { name: '品牌名称', exact: true })).toHaveValue(
    '本地只修改名称',
  );
  expect(core.references.getBrand(actor, wid, brand.id)).toEqual(remote);
  await dialog.getByRole('button', { name: '合并最新记录并继续编辑', exact: true }).click();
  await expect(dialog.locator('.asset-chip')).toHaveCount(1);
  await expect(dialog.getByRole('textbox', { name: '品牌名称', exact: true })).toHaveValue(
    '本地只修改名称',
  );
  await expect(dialog.getByRole('textbox', { name: '品牌描述', exact: true })).toHaveValue(
    '其他编辑已保存的新描述',
  );
  expect(core.references.getBrand(actor, wid, brand.id)).toEqual(remote);
  await dialog.getByRole('button', { name: '保存品牌', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(core.references.getBrand(actor, wid, brand.id)).toMatchObject({
    name: '本地只修改名称',
    description: remote.description,
    referenceAssetIds: [image.id],
    coverAssetId: image.id,
  });

  await page.getByRole('button', { name: '编辑品牌', exact: true }).click();
  await dialog.getByRole('textbox', { name: '品牌描述', exact: true }).fill('本地后续未保存');
  const latest = core.references.updateBrand(actor, wid, brand.id, {
    description: '最终远端描述',
    referenceAssetIds: [],
    coverAssetId: null,
  });
  await dialog.getByRole('button', { name: '保存品牌', exact: true }).click();
  await expect(dialog).toContainText('最终远端描述');
  await dialog.getByRole('button', { name: '载入最新记录，放弃当前修改', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '品牌描述', exact: true })).toHaveValue(
    latest.description,
  );
  await expect(dialog.locator('.asset-chip')).toHaveCount(0);
  expect(core.references.getBrand(actor, wid, brand.id)).toEqual(latest);
});

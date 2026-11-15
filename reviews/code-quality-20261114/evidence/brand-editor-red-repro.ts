import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '../../tests/e2e/fixtures';
import type { Actor } from '../../src/contracts/core';

test.use({ recoveryEnabled: false, smsEnabled: false });

test('brand save must preserve changes typed while its response is delayed', async ({ page, studio }) => {
  const account = await studio.existingIdentitySession();
  const actor: Actor = { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] };
  const brand = studio.services.core.references.createBrand(actor, account.workspace.id, { name: '品牌保存中输入', description: '原始描述' });
  await page.context().addCookies([{ name: 'studio_session', value: account.sessionToken, url: studio.origin, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${studio.origin}/brands`);
  await page.getByRole('button', { name: '编辑品牌', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '品牌参考', exact: true });
  await dialog.getByRole('textbox', { name: '品牌描述', exact: true }).fill('本次提交A');
  let release!: () => void;
  let signal!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const saved = new Promise<void>(resolve => { signal = resolve; });
  await page.route(`**/api/v1/brands/${brand.id}`, async route => {
    const response = await route.fetch();
    signal();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  await dialog.getByRole('button', { name: '保存品牌', exact: true }).click();
  await saved;
  await dialog.getByRole('textbox', { name: '品牌描述', exact: true }).fill('提交后继续输入B，不应丢失');
  release();
  await expect(page.getByText('品牌参考已保存', { exact: true })).toBeVisible();
  const actual = {
    dialogCount: await dialog.count(),
    persistedDescription: studio.services.core.references.getBrand(actor, account.workspace.id, brand.id).description,
    expectedDraft: '提交后继续输入B，不应丢失',
  };
  await writeFile(join(studio.folder, 'delayed-brand-save.json'), JSON.stringify(actual, null, 2));
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '品牌描述', exact: true })).toHaveValue(actual.expectedDraft);
});

test('stale brand editor must not silently overwrite another saved field', async ({ page, studio }) => {
  const account = await studio.existingIdentitySession();
  const actor: Actor = { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] };
  const core = studio.services.core;
  const wid = account.workspace.id;
  const brand = core.references.createBrand(actor, wid, { name: '最初品牌名', description: '旧描述' });
  await page.context().addCookies([{ name: 'studio_session', value: account.sessionToken, url: studio.origin, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${studio.origin}/brands`);
  await page.getByRole('button', { name: '编辑品牌', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '品牌参考', exact: true });
  await expect(dialog.getByRole('textbox', { name: '品牌描述', exact: true })).toHaveValue('旧描述');
  core.references.updateBrand(actor, wid, brand.id, { description: '其他编辑已保存的新描述' });
  await dialog.getByLabel('品牌名称', { exact: true }).fill('本地只修改名称');
  await dialog.getByRole('button', { name: '保存品牌', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const final = core.references.getBrand(actor, wid, brand.id);
  await writeFile(join(studio.folder, 'stale-brand-save.json'), JSON.stringify({
    before: '其他编辑已保存的新描述', after: final.description, savedName: final.name,
    conflictPromptPresent: await page.getByText('记录已被修改', { exact: false }).count(),
  }, null, 2));
  expect(final.description).toBe('其他编辑已保存的新描述');
});

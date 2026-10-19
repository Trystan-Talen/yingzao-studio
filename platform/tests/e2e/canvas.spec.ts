import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import type { SceneDocumentV1 } from '../../src/contracts/scene';

async function panel(editor: Locator, name: '属性' | '图层' | '画布') {
  const mobile = editor.getByRole('tab', { name, exact: true });
  if (await mobile.isVisible()) await mobile.click();
  else if (name !== '画布')
    await editor.locator('.ce-panel-tabs').getByRole('button', { name, exact: true }).click();
}
async function number(editor: Locator, label: string, value: string) {
  const field = editor.getByRole('spinbutton', { name: label, exact: true });
  await field.fill(value);
  await field.press('Enter');
}

test('creates an editable canvas, uploads real pixels, edits layers, undoes, exports and restores the saved project', async ({
  page,
  browser,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('画布验收');
  await page.getByLabel('邮箱', { exact: true }).fill('canvas@example.test');
  await page.getByLabel(/^密码/).fill('CanvasBrowserPassword2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.goto(`${studio.origin}/projects`);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  const projectDialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await projectDialog.getByLabel('项目名称', { exact: true }).fill('真实画布闭环');
  await projectDialog.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  const prompt = page.getByRole('textbox', { name: '创作需求', exact: true });
  await prompt.fill('画布编辑期间保留这份创作需求');
  await page.getByRole('button', { name: '先从空白画布编辑', exact: true }).click();
  const editor = page.getByLabel('作品画布编辑器', { exact: true });
  await expect(editor).toBeVisible();
  await expect(prompt).toBeHidden();
  await page.getByRole('button', { name: '展开创作区', exact: true }).click();
  await expect(prompt).toHaveValue('画布编辑期间保留这份创作需求');
  await page.getByRole('button', { name: '收起创作区', exact: true }).click();
  await expect(prompt).toBeHidden();
  await panel(editor, '属性');
  await number(editor, '宽度 · px', '320');
  await number(editor, '高度 · px', '240');
  const source = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#e23b25' },
  })
    .png()
    .toBuffer();
  await editor.getByRole('button', { name: '素材', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '把灵感放进画布' })).toBeVisible();
  await editor
    .locator('input[type=file]')
    .setInputFiles({ name: 'canvas-real-pixels.png', mimeType: 'image/png', buffer: source });
  await expect(page.getByRole('dialog', { name: '把灵感放进画布' })).toHaveCount(0);
  await editor.getByRole('button', { name: '文字', exact: true }).click();
  await panel(editor, '属性');
  await editor.getByRole('textbox', { name: '内容', exact: true }).fill('画布闭环验收');
  await number(editor, '字号', '16');
  await number(editor, '宽度', '160');
  await number(editor, 'X', '20');
  await number(editor, 'Y', '20');
  await editor.getByRole('button', { name: '添加矩形', exact: true }).click();
  await editor.getByRole('button', { name: '撤销编辑', exact: true }).click();
  await editor.getByRole('button', { name: '重做', exact: true }).click();
  await panel(editor, '图层');
  await expect(editor.locator('.ce-layer')).toHaveCount(3);
  await editor.getByRole('button', { name: '撤销编辑', exact: true }).click();
  await expect(editor.locator('.ce-layer')).toHaveCount(2);
  const read = () => {
    const row = studio.services.db.sqlite
      .prepare('SELECT scene_json,revision FROM documents WHERE project_id=?')
      .get(projectId) as { scene_json: string; revision: number };
    return { scene: JSON.parse(row.scene_json) as SceneDocumentV1, revision: row.revision };
  };
  await expect.poll(() => read().scene.layers.length).toBe(2);
  const saved = read();
  expect(saved.scene.canvas).toMatchObject({ width: 320, height: 240 });
  expect(saved.scene.layers.find((layer) => layer.type === 'text')).toMatchObject({
    text: '画布闭环验收',
    x: 20,
    y: 20,
    fontSize: 16,
  });
  const media = saved.scene.layers.find((layer) => layer.type === 'image');
  expect(media).toMatchObject({ width: 64, height: 48, x: 128, y: 96 });
  expect(saved.revision).toBeGreaterThan(1);
  await panel(editor, '画布');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: `${studio.folder}/canvas-editable.png`, fullPage: true });
  await editor.getByRole('button', { name: '导出', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出作品' });
  await expect(exportDialog).toBeVisible();
  const downloading = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: '生成并下载', exact: true }).click();
  const download = await downloading;
  const path = `${studio.folder}/canvas-export.png`;
  await download.saveAs(path);
  const output = await readFile(path);
  expect(await sharp(output).metadata()).toMatchObject({ width: 320, height: 240, format: 'png' });
  expect([
    ...(await sharp(output)
      .extract({ left: 160, top: 120, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ]).toEqual([226, 59, 37]);
  await page.reload();
  await page.getByRole('button', { name: '画布编辑', exact: true }).click();
  await panel(editor, '图层');
  await expect(editor.locator('.ce-layer')).toHaveCount(2);
  await editor.getByRole('button', { name: '文字', exact: true }).last().click();
  await panel(editor, '属性');
  await expect(editor.getByRole('textbox', { name: '内容', exact: true })).toHaveValue(
    '画布闭环验收',
  );
  expect(read().scene).toEqual(saved.scene);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  await page.screenshot({
    path: `${studio.folder}/canvas-restored-properties.png`,
    fullPage: true,
  });
  await editor.getByRole('textbox', { name: '内容', exact: true }).fill('第二版，随后恢复');
  await expect.poll(() => read().revision).toBeGreaterThan(saved.revision);
  const secondRevision = read().revision;
  await page.getByRole('button', { name: '版本', exact: true }).click();
  const versions = page.getByRole('dialog', { name: '版本历史', exact: true });
  await versions
    .locator('.version-row')
    .filter({ has: page.getByText(`版本${saved.revision}`, { exact: true }) })
    .getByRole('button', { name: '恢复', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '恢复这个版本？', exact: true })
    .getByRole('button', { name: '确认恢复', exact: true })
    .click();
  await expect.poll(() => read().revision).toBe(secondRevision + 1);
  expect(read().scene).toEqual(saved.scene);
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const sharing = page.getByRole('dialog', { name: '分享项目', exact: true });
  await expect(sharing.getByLabel('允许下载原件')).not.toBeChecked();
  await sharing.getByRole('button', { name: '创建 7 天分享链接', exact: true }).click();
  const shareUrl = await sharing
    .getByRole('textbox', { name: '分享链接', exact: true })
    .inputValue();
  const token = new URLSearchParams(new URL(shareUrl).hash.slice(1)).get('token');
  const publicContext = await browser.newContext({ viewport: page.viewportSize()! });
  const external: string[] = [],
    errors: string[] = [];
  await publicContext.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === studio.origin) await route.continue();
    else {
      external.push(route.request().url());
      await route.abort();
    }
  });
  try {
    const shared = await publicContext.newPage();
    shared.on('pageerror', (error) => errors.push(error.message));
    await shared.goto(shareUrl);
    await expect(shared.getByRole('heading', { name: '真实画布闭环', exact: true })).toBeVisible();
    await expect(
      shared.getByText('此链接只提供预览，原件下载已关闭；预览仍可能被截图或保存。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(shared.getByRole('button', { name: '导出', exact: true })).toHaveCount(0);
    await expect(shared.getByRole('button', { name: '添加矩形', exact: true })).toHaveCount(0);
    if (media?.type !== 'image') throw new Error('Missing image fixture');
    const denied = await publicContext.request.post(`${studio.origin}/api/v1/public/shares/asset`, {
      data: { token, assetId: media.assetId, variant: 'original' },
    });
    expect(denied.status()).toBe(403);
    const preview = await publicContext.request.post(
      `${studio.origin}/api/v1/public/shares/asset`,
      {
        data: { token, assetId: media.assetId, variant: 'preview' },
      },
    );
    expect(preview.status()).toBe(200);
    await shared.screenshot({
      path: `${studio.folder}/canvas-anonymous-share.png`,
      fullPage: true,
    });
    await sharing.getByRole('button', { name: '撤销链接', exact: true }).click();
    await expect(sharing.getByText('已撤销', { exact: true })).toBeVisible();
    await shared.reload();
    await expect(shared.getByText('分享已过期或被撤销', { exact: true })).toBeVisible();
    await shared.screenshot({ path: `${studio.folder}/canvas-revoked-share.png`, fullPage: true });
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await publicContext.close();
  }
});

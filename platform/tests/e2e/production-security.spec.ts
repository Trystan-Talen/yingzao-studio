import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Locator } from '@playwright/test';
import type { SceneDocumentV1 } from '../../src/contracts/scene';
import { test, expect } from './fixtures';

test.use({ productionMode: true, recoveryEnabled: false, smsEnabled: false });

async function panel(editor: Locator, name: '属性' | '画布') {
  const mobile = editor.getByRole('tab', { name, exact: true });
  if (await mobile.isVisible()) await mobile.click();
  else if (name === '属性')
    await editor.locator('.ce-panel-tabs').getByRole('button', { name, exact: true }).click();
}

test('production security policy permits sign-in, real media and saved canvas exports without violations', async ({
  page,
  studio,
}) => {
  const violations: { directive: string; blockedURI: string }[] = [];
  await page.exposeFunction('__recordCspViolation', (item: (typeof violations)[number]) => {
    violations.push(item);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      void (
        window as unknown as {
          __recordCspViolation: (item: { directive: string; blockedURI: string }) => Promise<void>;
        }
      ).__recordCspViolation({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI,
      });
    });
  });
  const response = await page.goto(studio.origin);
  const policy = response?.headers()['content-security-policy'];
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await page.getByLabel('你的称呼', { exact: true }).fill('生产策略验收');
  await page.getByLabel('邮箱', { exact: true }).fill('production-policy@example.test');
  await page.getByLabel(/^密码/).fill('ProductionPolicyPassword2026!');
  await page.getByRole('button', { name: '创建并开始创作', exact: true }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '欢迎来到映造', exact: true })).toBeHidden();
  const mobileMenu = page.getByRole('button', { name: '展开导航', exact: true });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page
    .getByRole('button', { name: /账户与退出/ })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill('production-policy@example.test');
  await page.getByLabel('密码', { exact: true }).fill('ProductionPolicyPassword2026!');
  await page.getByRole('button', { name: '登录工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天想映造什么？', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch('/api/v1/auth/me')).status)).toBe(200);
  const cookie = (await page.context().cookies()).find((item) => item.name === 'studio_session');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });

  await page.goto(`${studio.origin}/assets`);
  const source = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#e23b25' },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: '生产策略素材.png', mimeType: 'image/png', buffer: source });
  const preview = page.getByRole('img', { name: '生产策略素材.png', exact: true });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await page.screenshot({ path: join(studio.folder, 'production-media.png'), fullPage: true });

  await page.goto(`${studio.origin}/projects`);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  const projectDialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await projectDialog.getByLabel('项目名称', { exact: true }).fill('生产策略画布');
  await projectDialog.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('button', { name: '先从空白画布编辑', exact: true }).click();
  const editor = page.getByLabel('作品画布编辑器', { exact: true });
  await panel(editor, '属性');
  for (const [label, value] of [
    ['宽度 · px', '160'],
    ['高度 · px', '120'],
  ]) {
    const field = editor.getByRole('spinbutton', { name: label, exact: true });
    await field.fill(value!);
    await field.press('Enter');
  }
  await editor.getByRole('button', { name: '素材', exact: true }).click();
  await page
    .getByRole('dialog', { name: '把灵感放进画布', exact: true })
    .getByRole('button', { name: /生产策略素材\.png/ })
    .click();
  const readScene = () => {
    const row = studio.services.db.sqlite
      .prepare('SELECT scene_json FROM documents WHERE project_id=?')
      .get(projectId) as { scene_json: string };
    return JSON.parse(row.scene_json) as SceneDocumentV1;
  };
  await expect.poll(() => readScene().layers.length).toBe(1);
  expect(readScene().canvas).toMatchObject({ width: 160, height: 120 });
  expect(readScene().layers[0]).toMatchObject({ type: 'image', width: 64, height: 48 });
  await panel(editor, '画布');
  await page.screenshot({ path: join(studio.folder, 'production-canvas.png'), fullPage: true });
  await editor.getByRole('button', { name: '导出', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: '导出作品', exact: true })
    .getByRole('button', { name: '生成并下载', exact: true })
    .click();
  const download = await downloading;
  const outputPath = join(studio.folder, 'production-canvas-export.png');
  await download.saveAs(outputPath);
  const output = await readFile(outputPath);
  const metadata = await sharp(output).metadata();
  expect(metadata).toMatchObject({ width: 160, height: 120, format: 'png' });
  expect([
    ...(await sharp(output)
      .extract({ left: 80, top: 60, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ]).toEqual([226, 59, 37]);
  await page.reload();
  await page.getByRole('button', { name: '画布编辑', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(readScene().layers).toHaveLength(1);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  await writeFile(
    join(studio.folder, 'production-security-summary.json'),
    JSON.stringify(
      {
        environment: '启用生产模式的隔离回环环境；未验证公网证书或外部服务。',
        policy,
        violations,
        output: { width: metadata.width, height: metadata.height, format: metadata.format },
        savedLayers: readScene().layers.length,
      },
      null,
      2,
    ),
  );
  expect(violations).toEqual([]);
});

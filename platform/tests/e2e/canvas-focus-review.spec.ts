import { test, expect } from './fixtures';
import type { SceneDocumentV1 } from '../../src/contracts/scene';

test('switches narrow-screen editor tabs with arrow keys without moving the selected layer', async ({
  page,
  studio,
}) => {
  // Keep the narrow-screen keyboard contract valid in the default desktop project as well.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('画布焦点独审');
  await page.getByLabel('邮箱', { exact: true }).fill('canvas-focus@example.test');
  await page.getByLabel(/^密码/).fill('CanvasFocusReview2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  const me = await page.request.get(`${studio.origin}/api/v1/auth/me`),
    wid = (await me.json()).data.activeWorkspaceId;
  const created = await page.request.post(`${studio.origin}/api/v1/projects`, {
    headers: { origin: studio.origin, 'x-workspace-id': wid },
    data: { name: '键盘焦点与几何隔离' },
  });
  expect(created.status()).toBe(201);
  const project = (await created.json()).data;
  await page.goto(`${studio.origin}/workbench/${project.id}`);
  await page.getByRole('button', { name: '先从空白画布编辑', exact: true }).click();
  const editor = page.getByLabel('作品画布编辑器', { exact: true });
  await editor.getByRole('button', { name: '添加矩形', exact: true }).click();
  const scene = () =>
    JSON.parse(
      (
        studio.services.db.sqlite
          .prepare('SELECT scene_json FROM documents WHERE project_id=?')
          .get(project.id) as { scene_json: string }
      ).scene_json,
    ) as SceneDocumentV1;
  await expect.poll(() => scene().layers.length).toBe(1);
  const original = scene().layers[0]!;
  const canvasTab = editor.getByRole('tab', { name: '画布', exact: true });
  await expect(canvasTab).toBeVisible();
  await canvasTab.focus();
  await canvasTab.press('ArrowRight');
  const layersTab = editor.getByRole('tab', { name: '图层', exact: true });
  await expect(layersTab).toHaveAttribute('aria-selected', 'true');
  await expect(layersTab).toBeFocused();
  await layersTab.press('ArrowRight');
  await expect(editor.getByRole('tab', { name: '属性', exact: true })).toBeFocused();
  await expect(editor.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue(
    String(original.x),
  );
  await expect(editor.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue(
    String(original.y),
  );
  await editor.getByRole('tab', { name: '画布', exact: true }).click();
  await editor.focus();
  await editor.press('ArrowRight');
  await expect.poll(() => scene().layers[0]?.x).toBe(original.x + 1);
  await editor.getByRole('button', { name: '添加矩形', exact: true }).click();
  await expect.poll(() => scene().layers.length).toBe(2);
  await editor.getByRole('button', { name: '添加矩形', exact: true }).press('ControlOrMeta+z');
  await expect.poll(() => scene().layers.length).toBe(1);
  expect(scene().layers[0]?.x).toBe(original.x + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: `${studio.folder}/canvas-tab-focus-preserved.png`,
    fullPage: true,
  });
});

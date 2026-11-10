import { join } from 'node:path';
import { test, expect } from './fixtures';
import { darkEvidence, openDarkFlow } from './dark-creation-flow.helpers';
import {
  creationRecords,
  expectInsideViewport,
  expectNoHorizontalOverflow,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

test('dark settings float without reflow and retain choices through escape and outside dismissal', async ({
  page,
  studio,
}, testInfo) => {
  const { composer, writes } = await openDarkFlow(page, studio);
  const trigger = composer.getByRole('button', { name: '更多创作设置', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  const before = await composer.boundingBox();
  expect(before).not.toBeNull();
  await trigger.click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await expect(settings).toBeVisible();
  await expect(composer.getByRole('dialog', { name: '创作设置', exact: true })).toHaveCount(0);
  const after = await composer.boundingBox();
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
  await expectInsideViewport(settings, page);
  await settings.getByRole('combobox', { name: '比例', exact: true }).selectOption('3:4');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(settings.getByRole('combobox', { name: '比例', exact: true })).toHaveValue('3:4');
  await expectInsideViewport(settings, page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, `settings-${testInfo.project.name}.png`),
    fullPage: true,
  });
  const rect = (await settings.boundingBox())!;
  // A normal pointer click on the backdrop, outside the dialog rectangle.
  await page.mouse.click(8, Math.max(4, Math.min(rect.y / 2, 80)));
  await expect(settings).toHaveCount(0);
  await trigger.click();
  await expect(settings.getByRole('combobox', { name: '比例', exact: true })).toHaveValue('3:4');
  const done = settings.getByRole('button', { name: '完成', exact: true });
  await done.scrollIntoViewIfNeeded();
  await expectInsideViewport(done, page);
  await done.click();
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText('3:4');
  await trigger.click();
  await settings.getByText('更多偏好', { exact: true }).click();
  await settings.getByRole('button', { name: 'AI 帮我写', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'AI 创作助手', exact: true });
  await expect(settings).toHaveCount(0);
  await expect(assistant).toBeVisible();
  await assistant.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(assistant).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(writes).toEqual([]);
  expect(creationRecords(studio)).toEqual({
    briefs: 0,
    projects: 0,
    quotes: 0,
    jobs: 0,
    reserved: 0,
    settled: 0,
  });
  await darkEvidence(studio, 'settings-evidence', {
    viewport: page.viewportSize(),
    before,
    after,
    noComposerHeightIncrease: true,
    escapeRestoredFocus: true,
    outsideDismissed: true,
    selectedRatioRetained: '3:4',
    assistantCloseRestoredSettingsFocus: true,
    writes,
  });
});

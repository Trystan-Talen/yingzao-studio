import type { Locator } from '@playwright/test';
import type { JobInput } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false });

async function advanced(composer: Locator) {
  const platform = composer.getByRole('combobox', { name: '发布平台', exact: true });
  if (!(await platform.isVisible()))
    await composer.getByRole('button', { name: '模型与高级设置', exact: true }).click();
  return {
    platform,
    language: composer.getByRole('combobox', { name: '画面文字语言', exact: true }),
  };
}

test('completes onboarding, applies persisted defaults to new drafts and preserves an existing project after defaults change', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('完整引导验收');
  await page.getByLabel('邮箱', { exact: true }).fill('onboarding-defaults@example.test');
  await page.getByLabel(/^密码/).fill('OnboardingDefaults2026!');
  await page.getByRole('button', { name: '创建并开始创作', exact: true }).click();
  const onboarding = page.getByRole('dialog', { name: '欢迎来到映造', exact: true });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole('combobox', { name: /^默认发布平台/ }).selectOption('Shopify');
  await onboarding.getByRole('combobox', { name: /^默认创作语言/ }).selectOption('ja');
  await onboarding.getByRole('button', { name: '开始我的创作', exact: true }).click();
  await expect(onboarding).toHaveCount(0);
  await page.reload();
  await expect(onboarding).toHaveCount(0);
  const session = (await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json()).data;
  expect(session.user.preferences).toMatchObject({
    onboardingCompleted: true,
    defaultPlatform: 'Shopify',
    defaultCreationLanguage: 'ja',
    locale: 'zh-CN',
  });
  const headers = { 'x-workspace-id': session.activeWorkspaceId };
  const savedDraft = async (projectId: string) => {
    const response = await page.request.get(
      `${studio.origin}/api/v1/projects/${projectId}/messages`,
      { headers },
    );
    expect(response.status()).toBe(200);
    const messages = (await response.json()).data.items as {
      metadata?: { draft?: JobInput };
    }[];
    return messages.filter((message) => message.metadata?.draft).at(-1)?.metadata?.draft;
  };
  await page.goto(`${studio.origin}/workbench`);
  const composer = page.locator('.composer');
  let controls = await advanced(composer);
  await expect(controls.platform).toHaveValue('Shopify');
  await expect(controls.language).toHaveValue('ja');
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('保留既有项目的日语需求');
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const oldId = new URL(page.url()).pathname.split('/').at(-1)!;
  const oldDraft = await savedDraft(oldId);
  expect(oldDraft).toMatchObject({
    prompt: '保留既有项目的日语需求',
    options: { platform: 'Shopify', language: 'ja' },
  });

  await page.goto(`${studio.origin}/settings`);
  await page.getByRole('button', { name: '重新打开入门引导', exact: true }).click();
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole('combobox', { name: /^默认发布平台/ }).selectOption('Amazon');
  await onboarding.getByRole('combobox', { name: /^默认创作语言/ }).selectOption('fr');
  await onboarding.getByRole('button', { name: '开始我的创作', exact: true }).click();
  await expect(onboarding).toHaveCount(0);
  await page.reload();
  const updated = (await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json()).data;
  expect(updated.user.preferences).toMatchObject({
    onboardingCompleted: true,
    defaultPlatform: 'Amazon',
    defaultCreationLanguage: 'fr',
    locale: 'zh-CN',
  });

  // Clear only this project's browser cache, so restoration must use the real server draft.
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    `yingzao:creation:v1:${session.user.id}:${session.activeWorkspaceId}:${oldId}`,
  );
  await page.goto(`${studio.origin}/workbench/${oldId}`);
  controls = await advanced(composer);
  await expect(controls.platform).toHaveValue('Shopify');
  await expect(controls.language).toHaveValue('ja');
  await expect(composer.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(
    '保留既有项目的日语需求',
  );
  expect(await savedDraft(oldId)).toEqual(oldDraft);

  await page.goto(`${studio.origin}/workbench`);
  controls = await advanced(composer);
  await expect(controls.platform).toHaveValue('Amazon');
  await expect(controls.language).toHaveValue('fr');
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('新项目采用法语默认值');
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const newId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(newId).not.toBe(oldId);
  expect(await savedDraft(newId)).toMatchObject({
    prompt: '新项目采用法语默认值',
    options: { platform: 'Amazon', language: 'fr' },
  });
  expect(await savedDraft(oldId)).toEqual(oldDraft);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM projects').get()).toEqual({
    n: 2,
  });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: `${studio.folder}/onboarding-defaults-new-project.png`,
    fullPage: true,
  });
});

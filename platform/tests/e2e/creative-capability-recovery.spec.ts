import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import type { JobInput } from '../../src/contracts/jobs';
import type { ModelCapabilitiesDto } from '../../src/contracts/model-capabilities';
import { test, expect } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

async function openSettings(composer: Locator) {
  const toggle = composer.getByRole('button', { name: /^(更多创作设置|收起高级设置)$/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

for (const { failureAt, confirmationDisabled } of [
  { failureAt: 'quote', confirmationDisabled: false },
  { failureAt: 'submission', confirmationDisabled: false },
  { failureAt: 'quote', confirmationDisabled: true },
] as const) {
  test(`preserves a bound video draft after a rejected ${failureAt}${confirmationDisabled ? ' with confirmation disabled' : ''}, reloads it and reuses its ready understanding`, async ({
    page,
    studio,
  }) => {
    const account = await studio.experienceSession();
    await page.context().addCookies([
      {
        name: 'studio_session',
        value: account.sessionToken,
        url: studio.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const preparations: JobInput[] = [];
    const quotes: JobInput[] = [];
    const capabilities: ModelCapabilitiesDto[] = [];
    let submissions = 0;
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      const path = new URL(request.url()).pathname;
      if (path === '/api/v1/creative-briefs/prepare')
        preparations.push(request.postDataJSON().input as JobInput);
      if (path === '/api/v1/quotes') quotes.push(request.postDataJSON() as JobInput);
      if (path === '/api/v1/jobs') submissions++;
    });
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname === '/api/v1/capabilities/model' && response.ok())
        capabilities.push((await response.json()).data as ModelCapabilitiesDto);
    });
    await page.goto(`${studio.origin}/workbench?kind=video`);
    const composer = page.locator('.composer');
    const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
    const platform = composer.getByRole('combobox', { name: '发布平台', exact: true });
    const ratio = composer.getByRole('combobox', { name: '比例', exact: true });
    const generate = composer.getByRole('button', { name: '生成视频', exact: true });
    const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
    await expect(prompt).toBeVisible();
    await openSettings(composer);
    await platform.selectOption('TikTok');
    await ratio.selectOption('9:16');
    await prompt.fill('月球上的猫，五秒竖屏水彩动画，不加文字。');
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(confirmation).toBeVisible();
    expect(preparations).toHaveLength(1);
    const projectId = quotes[0]!.projectId!;
    expect(projectId).toBeTruthy();
    await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
    if (confirmationDisabled)
      studio.services.core.auth.update(
        {
          userId: account.user.id,
          authType: 'session',
          apiKeyId: null,
          workspaceId: null,
          scopes: [],
        },
        { preferences: { confirmGeneration: false } },
      );
    await page.reload();
    await openSettings(composer);
    await expect(prompt).toHaveValue('月球上的猫，五秒竖屏水彩动画，不加文字。');
    const original = '月球上的猫，五秒竖屏水彩动画，不加文字。整体干净清新。';
    await prompt.fill(original);
    await expect(generate).toBeEnabled();
    let rejectOnce = failureAt === 'quote';
    await page.route('**/api/v1/quotes', async (route) => {
      if (rejectOnce) {
        rejectOnce = false;
        studio.services.settings.modelCapabilities.invalidate(account.workspace.id, 'seedance');
      }
      await route.continue();
    });
    const failed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          (failureAt === 'quote' ? '/api/v1/quotes' : '/api/v1/jobs') &&
        response.status() === 409,
    );
    await generate.click();
    if (failureAt === 'submission') {
      await expect(confirmation).toBeVisible();
      studio.services.settings.modelCapabilities.invalidate(account.workspace.id, 'seedance');
      await confirmation.getByRole('button', { name: '确认并提交', exact: true }).click();
    }
    const rejected = await failed;
    expect((await rejected.json()).error.code).toBe('CAPABILITY_CHANGED');
    expect(preparations).toHaveLength(2);
    expect(preparations[1]?.projectId).toBe(projectId);
    const readyId = quotes.at(-1)!.creativeBriefId;
    expect(readyId).toBeTruthy();
    await expect(composer).toContainText(
      '模型信息已重新核查，草稿已保留。请再次点击生成并确认报价。',
    );
    const quotesAfterRejection = quotes.length;
    expect(submissions).toBe(failureAt === 'submission' ? 1 : 0);
    await generate.click();
    await expect(confirmation).toBeVisible();
    expect(quotes).toHaveLength(quotesAfterRejection + 1);
    expect(quotes.at(-1)?.creativeBriefId).toBe(readyId);
    expect(preparations).toHaveLength(2);
    await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(prompt).toHaveValue(original);
    await expect(platform).toHaveValue('TikTok');
    await expect(ratio).toHaveValue('9:16');
    const draftKey = `yingzao:creation:v1:${account.user.id}:${account.workspace.id}:new`;
    const beforeReload = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
      draftKey,
    );
    expect(beforeReload.input).toMatchObject({
      prompt: original,
      projectId,
      creativeBriefId: readyId,
      options: { platform: 'TikTok', ratio: '9:16' },
    });
    await page.reload();
    await openSettings(composer);
    await expect(prompt).toHaveValue(original);
    await expect(platform).toHaveValue('TikTok');
    await expect(ratio).toHaveValue('9:16');
    await expect(generate).toBeEnabled();
    expect(preparations).toHaveLength(2);
    if (!confirmationDisabled) {
      const previousQuotes = quotes.length;
      await generate.click();
      await expect(confirmation).toBeVisible();
      expect(quotes).toHaveLength(previousQuotes + 1);
      expect(quotes.at(-1)).toMatchObject({
        prompt: original,
        projectId,
        creativeBriefId: readyId,
        capabilityRevision: capabilities.at(-1)!.revision,
        options: { platform: 'TikTok', ratio: '9:16' },
      });
      await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
    }
    const projectLink = composer.getByRole('link', { name: '继续此项目草稿', exact: true });
    await expect(projectLink).toHaveAttribute('href', `/workbench/${projectId}`);
    await projectLink.click();
    await expect(page).toHaveURL(`${studio.origin}/workbench/${projectId}`);
    await expect(page.getByRole('region', { name: '项目作品与编辑', exact: true })).toBeVisible();
    await openSettings(composer);
    await expect(prompt).toHaveValue(original);
    await expect(platform).toHaveValue('TikTok');
    await expect(ratio).toHaveValue('9:16');
    expect(preparations).toHaveLength(2);
    expect(submissions).toBe(failureAt === 'submission' ? 1 : 0);
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    expect(
      studio.services.db.sqlite
        .prepare("SELECT count(*) n FROM credit_ledger WHERE kind='settle'")
        .get(),
    ).toEqual({ n: 0 });
    await writeFile(
      join(studio.folder, `creative-capability-${failureAt}.json`),
      JSON.stringify({ beforeReload, preparations, quotes, submissions }, null, 2),
    );
  });
}

test('a stale video tab cannot erase the newer draft when it only refreshes model information', async ({
  page,
  studio,
}) => {
  const account = await studio.experienceSession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/workbench?kind=video`);
  const composer = page.locator('.composer');
  await openSettings(composer);
  await expect(composer.locator('.model-capability-status summary')).toContainText('参数已补齐');
  const stale = await page.context().newPage();
  try {
    await stale.goto(`${studio.origin}/workbench?kind=video`);
    const oldComposer = stale.locator('.composer');
    await openSettings(oldComposer);
    await expect(oldComposer.locator('.model-capability-status summary')).toContainText(
      '参数已补齐',
    );
    const original = '月球上的猫，五秒竖屏水彩动画，不加文字。整体干净清新。';
    const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
    await prompt.fill(original);
    await composer.getByRole('combobox', { name: '发布平台', exact: true }).selectOption('TikTok');
    await composer.getByRole('combobox', { name: '比例', exact: true }).selectOption('9:16');
    await composer.getByRole('button', { name: '生成视频', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
    const draftKey = `yingzao:creation:v1:${account.user.id}:${account.workspace.id}:new`;
    const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), draftKey);
    expect(before.input.prompt).toBe(original);
    const oldStatus = oldComposer.locator('.model-capability-status');
    const settingsBounds = await oldComposer.locator('.composer-advanced').boundingBox();
    const inspirationBounds = await stale.getByRole('region', { name: '创作灵感' }).boundingBox();
    expect(settingsBounds).not.toBeNull();
    expect(inspirationBounds).not.toBeNull();
    expect(settingsBounds!.y + settingsBounds!.height).toBeLessThanOrEqual(inspirationBounds!.y);
    await oldStatus.locator('summary').click();
    studio.services.settings.modelCapabilities.invalidate(account.workspace.id, 'seedance');
    const refreshed = stale.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/v1/capabilities/model',
    );
    await oldStatus.getByRole('button', { name: '刷新模型信息', exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    await expect(oldStatus.locator('summary')).toContainText('参数已补齐');
    const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), draftKey);
    await writeFile(
      join(studio.folder, 'stale-tab-draft.json'),
      JSON.stringify({ before, after }, null, 2),
    );
    expect(after.input).toMatchObject({
      prompt: original,
      creativeBriefId: before.input.creativeBriefId,
      projectId: before.input.projectId,
      options: { platform: 'TikTok', ratio: '9:16' },
    });
    await page.reload();
    await openSettings(composer);
    await expect(prompt).toHaveValue(original);
    await expect(composer.getByRole('combobox', { name: '发布平台', exact: true })).toHaveValue(
      'TikTok',
    );
    await expect(composer.getByRole('combobox', { name: '比例', exact: true })).toHaveValue('9:16');
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
  } finally {
    await stale.close();
  }
});

import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, type Studio } from './fixtures';

async function openConnections(page: Page, studio: Studio) {
  const account = await studio.services.core.auth.register({
    email: 'model-config@example.test',
    password: 'ModelConfigurationFixture2026!',
    displayName: '模型配置验收',
  });
  studio.services.core.auth.update(
    { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    { preferences: { onboardingCompleted: true, theme: 'dark' } },
  );
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${studio.origin}/settings?tab=models`);
  await expect(page.getByRole('heading', { name: '连接创作模型' })).toBeVisible();
  return account;
}

test('a failed background refresh retains other stage drafts and the successfully saved connection', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  await page.getByRole('button', { name: /图片生成/ }).click();
  await page.getByLabel(/^模型标识/).fill('unsaved-image-draft');
  await page.getByRole('button', { name: /文本规划/ }).click();
  await page
    .getByLabel('API Key（接口密钥）', { exact: true })
    .fill('synthetic-background-save-key');
  await page.getByLabel(/^模型标识/).fill('saved-text-model');
  await page.getByLabel('将此模型用于创作', { exact: true }).check();
  let failRefresh = false;
  await page.route('**/api/v1/model-connections', async (route) => {
    if (route.request().method() === 'PUT') {
      failRefresh = true;
      return route.continue();
    }
    if (!failRefresh) return route.continue();
    return route.fulfill({
      status: 503,
      json: { error: { code: 'FIXTURE_REFRESH_FAILED', message: '模拟配置后台刷新失败' } },
    });
  });
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  await expect(page.getByText('模拟配置后台刷新失败', { exact: true })).toBeVisible();
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'text')?.model).toBe(
    'saved-text-model',
  );
  await expect(page.getByRole('heading', { name: '连接创作模型', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('saved-text-model');
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: /图片生成/ }).click();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('unsaved-image-draft');
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('selecting an explicit Seedream model chooses its image protocol without rewriting model aliases', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  studio.services.settings.connections.update(account.workspace.id, {
    kind: 'image',
    protocol: 'openai-images',
    baseUrl: 'https://fixture.example/v1',
    modelsUrl: '',
    model: '',
    enabled: false,
    secret: 'synthetic-image-protocol-key',
  });
  studio.services.db.sqlite
    .prepare('UPDATE model_connections SET models_json=? WHERE workspace_id=? AND kind=?')
    .run(
      JSON.stringify(['doubao-seedream-5.0-lite', 'custom-image-alias']),
      account.workspace.id,
      'image',
    );
  await page.reload();
  await page.getByRole('button', { name: /图片生成/ }).click();
  const protocol = page.getByRole('combobox', { name: '接口协议', exact: true });
  await expect(protocol).toHaveValue('openai-images');
  await page.getByRole('button', { name: 'doubao-seedream-5.0-lite', exact: true }).click();
  await expect(protocol).toHaveValue('seedream-images');
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('doubao-seedream-5.0-lite');
  await protocol.selectOption('openai-images');
  await page.getByRole('button', { name: 'custom-image-alias', exact: true }).click();
  await expect(protocol).toHaveValue('openai-images');
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('custom-image-alias');
  await protocol.selectOption('seedream-images');
  await page.getByLabel(/^模型标识/).fill('another-custom-alias');
  await expect(protocol).toHaveValue('seedream-images');
  await protocol.selectOption('openai-images');
  await page.getByRole('button', { name: 'doubao-seedream-5.0-lite', exact: true }).click();
  await expect(protocol).toHaveValue('seedream-images');
  await page.getByLabel('将此模型用于创作', { exact: true }).check();
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'image')).toMatchObject(
    {
      protocol: 'seedream-images',
      model: 'doubao-seedream-5.0-lite',
    },
  );
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('configuration discovers before selecting a model, persists encrypted keys and keeps stage drafts', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  let discoveries = 0;
  // Synthetic directory only: the authenticated application routes and SQLite writes remain real.
  studio.services.settings.connections.refreshModels = async (workspaceId, kind) => {
    discoveries++;
    studio.services.db.sqlite
      .prepare(
        "UPDATE model_connections SET models_json=?,models_checked_at=?,discovery_status='connected' WHERE workspace_id=? AND kind=?",
      )
      .run(
        JSON.stringify(['sample-text-v1', 'sample-text-v2']),
        new Date().toISOString(),
        workspaceId,
        kind,
      );
    return studio.services.settings.connections.get(workspaceId, kind);
  };
  const secret = 'synthetic-model-secret-2026';
  await expect(page.getByLabel(/^服务地址/)).toHaveValue('https://xingyunyinli.com/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill(secret);
  await page.getByRole('button', { name: /图片生成/ }).click();
  await page.getByLabel(/^模型标识/).fill('draft-image-model');
  await page.getByRole('button', { name: /文本规划/ }).click();
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue(secret);
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('');
  await page.getByRole('button', { name: '保存并刷新模型', exact: true }).click();
  await expect(page.getByText('配置已保存，模型目录已同步。', { exact: true })).toBeVisible();
  expect(discoveries).toBe(1);
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'sample-text-v1', exact: true }).click();
  await page.getByLabel('将此模型用于创作', { exact: true }).check();
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /图片生成/ }).click();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('draft-image-model');
  await page.getByRole('button', { name: /文本规划/ }).click();
  const saved = studio.services.db.sqlite
    .prepare(
      'SELECT model,enabled,encrypted_secret FROM model_connections WHERE workspace_id=? AND kind=?',
    )
    .get(account.workspace.id, 'text') as {
    model: string;
    enabled: number;
    encrypted_secret: string;
  };
  expect(saved.model).toBe('sample-text-v1');
  expect(saved.enabled).toBe(1);
  expect(saved.encrypted_secret).not.toContain(secret);
  const response = await page.request.get(`${studio.origin}/api/v1/model-connections`, {
    headers: { 'x-workspace-id': account.workspace.id },
  });
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain(secret);
  await page.reload();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('sample-text-v1');
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('将此模型用于创作', { exact: true })).toBeChecked();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  await page.screenshot({
    path: join(studio.folder, 'model-connections-dark.png'),
    fullPage: true,
  });
});

test('directory failure preserves configuration, manual models work, and removing a key is explicit', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  studio.services.settings.connections.refreshModels = async (workspaceId, kind) => {
    studio.services.db.sqlite
      .prepare(
        "UPDATE model_connections SET discovery_status='unavailable',models_checked_at=? WHERE workspace_id=? AND kind=?",
      )
      .run(new Date().toISOString(), workspaceId, kind);
    return studio.services.settings.connections.get(workspaceId, kind);
  };
  await page.getByRole('button', { name: /图片生成/ }).click();
  await page
    .getByRole('combobox', { name: '接口协议', exact: true })
    .selectOption('seedream-images');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-image-secret-2026');
  await page.getByLabel(/^模型标识/).fill('sample-image-v1');
  await page.getByLabel('将此模型用于创作', { exact: true }).check();
  await page.getByRole('button', { name: '保存并刷新模型', exact: true }).click();
  await expect(
    page.getByText('配置已保存，模型目录暂未同步。可以手动填写模型标识。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('sample-image-v1');
  expect(
    studio.services.settings.connections.runtime(account.workspace.id, 'image')?.protocol,
  ).toBe('seedream-images');
  await page.reload();
  await page.getByRole('button', { name: /图片生成/ }).click();
  await expect(page.getByRole('combobox', { name: '接口协议', exact: true })).toHaveValue(
    'seedream-images',
  );
  await page.getByLabel('保存时移除此密钥', { exact: true }).check();
  await expect(page.getByRole('button', { name: '保存并刷新模型', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
  expect(
    studio.services.settings.connections.runtime(account.workspace.id, 'image'),
  ).toBeUndefined();
  await page.getByRole('button', { name: /视频生成/ }).click();
  await expect(page.getByLabel(/^模型目录地址/)).toHaveValue('https://xingyunyinli.com/v1/models');
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.screenshot({
    path: join(studio.folder, 'model-connections-light.png'),
    fullPage: true,
  });
});

test('saves and clears a separate vision model without replacing the planning model or calling either model', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  await page.getByLabel(/^服务地址/).fill('https://replica-config.invalid/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('unused-vision-fixture');
  await page.getByLabel(/^模型标识/).fill('fixture-text-model');
  await page.getByLabel(/^视觉分析模型/).fill('custom-vision-alias');
  await page.getByLabel('将此模型用于创作', { exact: true }).check();
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'text')).toMatchObject({
    model: 'fixture-text-model',
    visionModel: 'custom-vision-alias',
  });
  await page.reload();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('fixture-text-model');
  await expect(page.getByLabel(/^视觉分析模型/)).toHaveValue('custom-vision-alias');
  await page.getByLabel(/^视觉分析模型/).fill('');
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'text')).toMatchObject({
    model: 'fixture-text-model',
    visionModel: '',
  });
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get()).toEqual(
    { n: 0 },
  );
});

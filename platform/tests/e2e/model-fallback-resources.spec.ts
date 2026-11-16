import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { ModelDiscoveryInput } from '../../src/contracts/model-connections';
import { test, expect, type Studio } from './fixtures';

async function setup(page: Page, studio: Studio) {
  const account = await studio.services.core.auth.register({
    email: 'fallback-config@example.test',
    password: 'FallbackConfigurationFixture2026!',
    displayName: '备用资源验收',
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
  const discoveries: ModelDiscoveryInput[] = [];
  await page.route('**/api/v1/model-connections/discover', async (route) => {
    discoveries.push(route.request().postDataJSON() as ModelDiscoveryInput);
    await route.fulfill({
      json: {
        data: {
          models: ['gpt-image-1', 'gpt-image-2'],
          modelsCheckedAt: new Date().toISOString(),
          discoveryStatus: 'connected',
          discoveryMessage: '隔离模型目录已读取',
        },
      },
    });
  });
  const forbidden: string[] = [];
  await page.route(/\/api\/v1\/(?:creative-briefs\/prepare|quotes|jobs)$/, async (route) => {
    forbidden.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 409,
      json: { error: { code: 'ISOLATED_STOP', message: '配置验收不提交生成请求。' } },
    });
  });
  await page.goto(`${studio.origin}/settings?tab=models`);
  await expect(page.getByRole('heading', { name: '连接创作模型' })).toBeVisible();
  await page.getByRole('button', { name: /图片生成/ }).click();
  return { account, discoveries, forbidden };
}

function resources(page: Page) {
  return page.getByRole('group', { name: '接口资源', exact: true });
}

async function fillConnection(
  page: Page,
  host: string,
  secret: string,
  model: string,
  backup = false,
) {
  await page.getByLabel(/^服务地址/).fill(`https://${host}.invalid/v1`);
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill(secret);
  await expect(page.getByRole('button', { name: model, exact: true })).toBeVisible();
  await page.getByRole('button', { name: model, exact: true }).click();
  await page.getByLabel(backup ? '启用此备用资源' : '将此模型用于创作', { exact: true }).check();
}

async function save(page: Page) {
  const response = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === '/api/v1/model-connections' &&
      item.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
}

function noGeneration(studio: Studio, forbidden: string[]) {
  expect(forbidden).toEqual([]);
  for (const table of ['creative_briefs', 'quotes', 'jobs'])
    expect(studio.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
}

test('saves two independently discovered backups, preserves drafts across resources and stages, and removes one durably', async ({
  page,
  studio,
}) => {
  const { account, discoveries, forbidden } = await setup(page, studio);
  await expect(
    resources(page).getByRole('button', { name: '添加备用资源', exact: true }),
  ).toBeDisabled();
  await fillConnection(page, 'primary-fixture', 'synthetic-primary-key', 'gpt-image-2');
  await save(page);
  await resources(page).getByRole('button', { name: '添加备用资源', exact: true }).click();
  await page.getByLabel('资源名称', { exact: true }).fill('备用甲');
  await fillConnection(page, 'backup-a-fixture', 'synthetic-backup-a-key', 'gpt-image-1', true);
  const firstDiscovery = discoveries.find((item) => item.baseUrl.includes('backup-a-fixture'))!;
  expect(firstDiscovery.resourceId).toBeTruthy();
  expect(firstDiscovery.secret).toBe('synthetic-backup-a-key');
  await resources(page).getByRole('button', { name: '添加备用资源', exact: true }).click();
  await page.getByLabel('资源名称', { exact: true }).fill('备用乙');
  await fillConnection(page, 'backup-b-fixture', 'synthetic-backup-b-key', 'gpt-image-2', true);
  const secondDiscovery = discoveries.find((item) => item.baseUrl.includes('backup-b-fixture'))!;
  expect(secondDiscovery.resourceId).toBeTruthy();
  expect(secondDiscovery.resourceId).not.toBe(firstDiscovery.resourceId);
  expect(secondDiscovery.secret).toBe('synthetic-backup-b-key');
  await expect(
    resources(page).getByRole('button', { name: '添加备用资源', exact: true }),
  ).toHaveCount(0);

  await resources(page)
    .getByRole('button', { name: /备用甲/ })
    .click();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('gpt-image-1');
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue(
    'synthetic-backup-a-key',
  );
  await page.getByLabel('资源名称', { exact: true }).fill('备用甲已编辑');
  await page.getByRole('button', { name: /文本规划/ }).click();
  await page.getByLabel(/^服务地址/).fill('https://text-draft.invalid/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-text-draft-key');
  await page.getByRole('button', { name: /图片生成/ }).click();
  await resources(page)
    .getByRole('button', { name: /备用甲已编辑/ })
    .click();
  await expect(page.getByLabel(/^服务地址/)).toHaveValue('https://backup-a-fixture.invalid/v1');
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue(
    'synthetic-backup-a-key',
  );
  await resources(page)
    .getByRole('button', { name: /备用乙/ })
    .click();
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue(
    'synthetic-backup-b-key',
  );
  await save(page);

  const connection = studio.services.settings.connections.runtime(account.workspace.id, 'image')!;
  expect(connection).toMatchObject({ model: 'gpt-image-2', secret: 'synthetic-primary-key' });
  expect(connection.fallbackResources).toMatchObject([
    {
      id: firstDiscovery.resourceId,
      model: 'gpt-image-1',
      secret: 'synthetic-backup-a-key',
      baseUrl: 'https://backup-a-fixture.invalid/v1',
    },
    {
      id: secondDiscovery.resourceId,
      model: 'gpt-image-2',
      secret: 'synthetic-backup-b-key',
      baseUrl: 'https://backup-b-fixture.invalid/v1',
    },
  ]);
  await page.getByRole('button', { name: /文本规划/ }).click();
  await expect(page.getByLabel(/^服务地址/)).toHaveValue('https://text-draft.invalid/v1');
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue(
    'synthetic-text-draft-key',
  );
  expect(
    studio.services.settings.connections.runtime(account.workspace.id, 'text'),
  ).toBeUndefined();
  await page.reload();
  await page.getByRole('button', { name: /图片生成/ }).click();
  await resources(page)
    .getByRole('button', { name: /备用甲已编辑/ })
    .click();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('gpt-image-1');
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('启用此备用资源', { exact: true })).toBeChecked();
  await page.screenshot({
    path: join(studio.folder, 'saved-fallback-resources.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '移除备用资源', exact: true }).click();
  await expect(resources(page).getByRole('button', { name: /备用甲/ })).toHaveCount(0);
  await save(page);
  await page.reload();
  await page.getByRole('button', { name: /图片生成/ }).click();
  await expect(resources(page).getByRole('button', { name: /备用甲/ })).toHaveCount(0);
  await resources(page)
    .getByRole('button', { name: /备用乙/ })
    .click();
  await expect(page.getByLabel(/^服务地址/)).toHaveValue('https://backup-b-fixture.invalid/v1');
  expect(
    studio.services.settings.connections
      .get(account.workspace.id, 'image')
      .fallbackResources?.map((item) => item.id),
  ).toEqual([secondDiscovery.resourceId]);
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'image')?.secret).toBe(
    'synthetic-primary-key',
  );
  noGeneration(studio, forbidden);
});

test('scopes saved-key discovery to the selected backup and never reuses it automatically on another host', async ({
  page,
  studio,
}) => {
  const { account, discoveries, forbidden } = await setup(page, studio);
  studio.services.settings.connections.update(account.workspace.id, {
    kind: 'image',
    protocol: 'openai-images',
    baseUrl: 'https://same-host.invalid/primary',
    modelsUrl: '',
    model: 'gpt-image-2',
    enabled: true,
    secret: 'synthetic-primary-key',
    fallbackResources: [
      {
        id: 'backup-a',
        name: '资源甲',
        protocol: 'openai-images',
        baseUrl: 'https://same-host.invalid/backup-a',
        modelsUrl: '',
        model: 'gpt-image-1',
        enabled: true,
        secret: 'synthetic-a-key',
      },
      {
        id: 'backup-b',
        name: '资源乙',
        protocol: 'openai-images',
        baseUrl: 'https://same-host.invalid/backup-b',
        modelsUrl: '',
        model: 'gpt-image-2',
        enabled: true,
        secret: 'synthetic-b-key',
      },
    ],
  });
  await page.reload();
  await page.getByRole('button', { name: /图片生成/ }).click();
  await resources(page)
    .getByRole('button', { name: /资源甲/ })
    .click();
  await page.getByLabel(/^服务地址/).fill('https://same-host.invalid/backup-a-v2');
  await expect.poll(() => discoveries.length).toBe(1);
  expect(discoveries[0]).toMatchObject({
    resourceId: 'backup-a',
    baseUrl: 'https://same-host.invalid/backup-a-v2',
  });
  expect(discoveries[0]?.secret).toBeUndefined();
  await resources(page)
    .getByRole('button', { name: /资源乙/ })
    .click();
  await page.getByLabel(/^服务地址/).fill('https://same-host.invalid/backup-b-v2');
  await expect.poll(() => discoveries.length).toBe(2);
  expect(discoveries[1]).toMatchObject({
    resourceId: 'backup-b',
    baseUrl: 'https://same-host.invalid/backup-b-v2',
  });
  expect(discoveries[1]?.secret).toBeUndefined();
  await resources(page).getByRole('button', { name: '首选资源', exact: true }).click();
  await page.getByLabel(/^服务地址/).fill('https://same-host.invalid/primary-v2');
  await expect.poll(() => discoveries.length).toBe(3);
  expect(discoveries[2]?.resourceId).toBeUndefined();
  expect(discoveries[2]?.secret).toBeUndefined();
  await resources(page)
    .getByRole('button', { name: /资源乙/ })
    .click();
  await page.getByLabel(/^服务地址/).fill('https://different-host.invalid/v1');
  await expect(page.getByRole('button', { name: '刷新目录', exact: true })).toBeDisabled();
  const beforeNewKey = discoveries.length;
  await page.waitForTimeout(800);
  expect(discoveries).toHaveLength(beforeNewKey);
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-new-b-key');
  await expect.poll(() => discoveries.length).toBe(beforeNewKey + 1);
  expect(discoveries.at(-1)).toMatchObject({
    resourceId: 'backup-b',
    baseUrl: 'https://different-host.invalid/v1',
    secret: 'synthetic-new-b-key',
  });
  await page.getByLabel('保存时移除此密钥', { exact: true }).check();
  await expect(page.getByRole('button', { name: '刷新目录', exact: true })).toBeDisabled();
  await page.waitForTimeout(800);
  expect(discoveries).toHaveLength(beforeNewKey + 1);
  const original = studio.services.settings.connections.runtime(account.workspace.id, 'image')!;
  expect(original.secret).toBe('synthetic-primary-key');
  expect(original.fallbackResources?.map((item) => item.secret)).toEqual([
    'synthetic-a-key',
    'synthetic-b-key',
  ]);
  noGeneration(studio, forbidden);
});

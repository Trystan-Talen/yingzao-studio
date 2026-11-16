import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { draftStorageKey } from '../../src/web/lib/creation-recovery';
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
  // Draft directory reads use synthetic credentials and must never reach a real service.
  await page.route('**/api/v1/model-connections/discover', (route) =>
    route.fulfill({
      json: {
        data: {
          models: ['sample-text-v1', 'sample-text-v2'],
          modelsCheckedAt: new Date().toISOString(),
          discoveryStatus: 'connected',
          discoveryMessage: '已读取模型目录；目录不证明模型类型、参数或生成质量。',
        },
      },
    }),
  );
  await page.goto(`${studio.origin}/settings?tab=models`);
  await expect(page.getByRole('heading', { name: '连接创作模型' })).toBeVisible();
  return account;
}

async function saveCreationConnection(
  page: Page,
  kind: 'text' | 'image',
  model = kind === 'text' ? 'fixture-planner' : 'gpt-image-2',
) {
  await page.getByRole('button', { name: kind === 'text' ? /文本规划/ : /图片生成/ }).click();
  await page.getByLabel(/^服务地址/).fill('https://creation-fixture.invalid/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill(`unused-isolated-${kind}-key`);
  await page.getByLabel(/^模型标识/).fill(model);
  await page.getByLabel('将此模型用于创作', { exact: true }).check();
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/model-connections' &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
}

async function openHomeWithoutReload(page: Page) {
  await page.locator('a[aria-label="映造 · 创作"]:visible').first().click();
  const composer = page.locator('.composer[data-presentation="quick"]');
  await expect(composer).toBeVisible();
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('白色陶瓷杯放在浅灰色桌面上，自然窗光，正面商品摄影。');
  return composer;
}

async function forbidGenerationRequests(page: Page) {
  const attempted: string[] = [];
  // The native adapter uses its own HTTPS transport. Block the application entry
  // points too: these readiness checks must never create a plan or submit a model call.
  await page.route(/\/api\/v1\/(?:creative-briefs\/prepare|quotes|jobs)$/, (route) => {
    attempted.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 409,
      json: { error: { code: 'ISOLATED_STOP', message: '配置验收不提交生成请求。' } },
    });
  });
  return attempted;
}

function expectNoGenerationRecords(studio: Studio, attempted: string[]) {
  expect(attempted).toEqual([]);
  for (const table of ['creative_briefs', 'quotes', 'jobs'])
    expect(studio.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
}

test('saved text and image connections enable home generation without a page reload', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  const attempted = await forbidGenerationRequests(page);
  await saveCreationConnection(page, 'text');
  await saveCreationConnection(page, 'image');
  for (const kind of ['text', 'image'] as const)
    expect(studio.services.settings.connections.runtime(account.workspace.id, kind)).toMatchObject({
      model: kind === 'text' ? 'fixture-planner' : 'gpt-image-2',
      protocol: kind === 'text' ? 'openai-chat' : 'openai-images',
    });

  const composer = await openHomeWithoutReload(page);
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  await page.screenshot({
    path: join(studio.folder, 'configured-home-generation-ready.png'),
    fullPage: true,
  });
  await page.reload();
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  expectNoGenerationRecords(studio, attempted);
});

test('an image-only connection explains the missing text model and recovers through settings', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  const attempted = await forbidGenerationRequests(page);
  await saveCreationConnection(page, 'image');
  expect(
    studio.services.settings.connections.runtime(account.workspace.id, 'text'),
  ).toBeUndefined();
  const composer = await openHomeWithoutReload(page);
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  const missingConfiguration = composer
    .locator('.notice')
    .filter({ hasText: '思考模式需要文本模型' });
  await expect(missingConfiguration).toBeVisible();
  const configure = missingConfiguration.getByRole('link', { name: '模型配置', exact: true });
  await expect(configure).toBeVisible();
  await expect(configure).toHaveAttribute('href', '/settings?tab=models');
  await page.screenshot({
    path: join(studio.folder, 'image-only-home-missing-planner.png'),
    fullPage: true,
  });
  await composer.getByRole('switch', { name: '思考模式', exact: true }).uncheck();
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  await page.reload();
  await expect(composer.getByRole('switch', { name: '思考模式', exact: true })).not.toBeChecked();
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  await composer.getByRole('switch', { name: '思考模式', exact: true }).check();
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  await configure.click();
  await expect(page.getByRole('heading', { name: '连接创作模型' })).toBeVisible();
  await saveCreationConnection(page, 'text');
  await openHomeWithoutReload(page);
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  expectNoGenerationRecords(studio, attempted);
});

test('a saved draft keeps its prompt and reference when explicitly adopting a changed image model', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  const attempted = await forbidGenerationRequests(page);
  const oldModel = 'doubao-seedream-5.0-lite';
  await saveCreationConnection(page, 'text');
  await saveCreationConnection(page, 'image', oldModel);
  const composer = await openHomeWithoutReload(page);
  const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  const originalPrompt = await prompt.inputValue();
  const picker = composer.locator('.asset-picker-inline');
  await picker
    .locator('input[type=file]')
    .setInputFiles(join(process.cwd(), 'public/gallery/botanical-serum.webp'));
  await expect(picker.locator('.asset-chip')).toContainText('botanical-serum.webp');
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  const storageKey = draftStorageKey(account.user.id, account.workspace.id);
  const readSelection = () =>
    page.evaluate((key) => {
      const input = JSON.parse(localStorage.getItem(key) || '{}').input;
      return { model: input?.options.model, prompt: input?.prompt, assetIds: input?.assetIds };
    }, storageKey);
  await expect.poll(readSelection).toMatchObject({ model: oldModel, prompt: originalPrompt });
  const originalAssets = (await readSelection()).assetIds as string[];
  expect(originalAssets).toHaveLength(1);
  await page.reload();
  await expect(prompt).toHaveValue(originalPrompt);
  await expect(picker.locator('.asset-chip')).toContainText('botanical-serum.webp');

  const mobileNavigation = page.getByRole('button', { name: '展开导航', exact: true });
  const mobile = await mobileNavigation.isVisible();
  await (
    mobile ? mobileNavigation : page.getByRole('button', { name: '更多', exact: true })
  ).click();
  await page
    .getByRole('dialog', { name: mobile ? '导航' : '更多', exact: true })
    .getByRole('link', { name: '设置', exact: true })
    .click();
  await page.getByRole('button', { name: '模型配置', exact: true }).click();
  await saveCreationConnection(page, 'image');
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'image')).toMatchObject(
    {
      model: 'gpt-image-2',
      protocol: 'openai-images',
    },
  );
  await page.locator('a[aria-label="映造 · 创作"]:visible').first().click();

  const recovery = composer.getByRole('region', { name: '模型选择需要更新', exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText('模型配置已更新，草稿中的模型已不可用。');
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  await expect(prompt).toHaveValue(originalPrompt);
  await expect.poll(readSelection).toEqual({
    model: oldModel,
    prompt: originalPrompt,
    assetIds: originalAssets,
  });
  await page.screenshot({
    path: join(studio.folder, 'changed-model-draft-recovery.png'),
    fullPage: true,
  });
  await recovery
    .getByRole('button', { name: '使用已配置模型（gpt-image-2）', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('combobox', { name: '生成模型', exact: true })).toHaveValue(
    'image.generate|native|gpt-image-2',
  );
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  await expect(prompt).toHaveValue(originalPrompt);
  await expect(picker.locator('.asset-chip')).toContainText('botanical-serum.webp');
  await expect.poll(readSelection).toEqual({
    model: 'gpt-image-2',
    prompt: originalPrompt,
    assetIds: originalAssets,
  });
  await page.reload();
  await expect(recovery).toHaveCount(0);
  await expect(prompt).toHaveValue(originalPrompt);
  await expect(picker.locator('.asset-chip')).toContainText('botanical-serum.webp');
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  await page.screenshot({
    path: join(studio.folder, 'changed-model-draft-ready.png'),
    fullPage: true,
  });
  expectNoGenerationRecords(studio, attempted);
});

test.describe('demo model connection guidance', () => {
  test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

  test('saved connections retain the demo restriction and explain how to use real mode', async ({
    page,
    studio,
  }) => {
    const account = await openConnections(page, studio);
    const attempted = await forbidGenerationRequests(page);
    const guidance = page.getByRole('region', { name: '演示模式生成说明', exact: true });
    await expect(guidance).toBeVisible();
    await saveCreationConnection(page, 'text');
    await saveCreationConnection(page, 'image');
    await expect(guidance).toContainText('演示模式不调用自定义模型，请在正式模式配置并生成');
    await expect(guidance).toContainText('真实生成模式使用独立的账号、模型配置与数据');
    await expect(guidance).toContainText('请联系管理员提供正式模式入口。');
    const capabilities = await page.request.get(`${studio.origin}/api/v1/capabilities`, {
      headers: { 'x-workspace-id': account.workspace.id },
    });
    expect(capabilities.status()).toBe(200);
    const operations = (await capabilities.json()).data.operations as {
      id: string;
      providerId: string;
      available: boolean;
      reason: string;
    }[];
    expect(
      operations.find(
        (operation) => operation.id === 'image.generate' && operation.providerId === 'native',
      ),
    ).toMatchObject({
      available: false,
      reason: '演示模式不调用自定义模型，请在正式模式配置并生成',
    });
    await page.screenshot({
      path: join(studio.folder, 'configured-demo-real-mode-guidance.png'),
      fullPage: true,
    });
    expectNoGenerationRecords(studio, attempted);
  });
});

test('automatically lists models before saving or selecting a model', async ({ page, studio }) => {
  const account = await openConnections(page, studio);
  await page.getByLabel(/^服务地址/).fill('https://fixture.example/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-auto-key');
  await expect(page.getByRole('button', { name: 'sample-text-v2', exact: true })).toBeVisible();
  expect(studio.services.settings.connections.get(account.workspace.id, 'text').configured).toBe(
    false,
  );
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('');
  await page.screenshot({
    path: join(studio.folder, 'automatic-model-directory.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'sample-text-v2', exact: true }).click();
  await page.getByLabel('将此模型用于创作', { exact: true }).check();
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'text')?.model).toBe(
    'sample-text-v2',
  );
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('switching gateways shows the complete picker despite an old model value and saves the selected image model', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  await page.route('**/api/v1/model-connections/discover', (route) =>
    route.fulfill({
      json: {
        data: {
          models: ['gpt-4.1', 'gpt-image-1', 'gpt-image-2'],
          modelsCheckedAt: new Date().toISOString(),
          discoveryStatus: 'connected',
          discoveryMessage: '目录已同步',
        },
      },
    }),
  );
  await page.getByRole('button', { name: /图片生成/ }).click();
  await page.getByLabel(/^模型标识/).fill('doubao-seedream-5.0-lite');
  await page.getByLabel(/^服务地址/).fill('https://another-gateway.example/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-new-gateway-key');
  await expect(page.getByRole('button', { name: 'gpt-image-2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(page.getByRole('option', { name: 'gpt-image-2', exact: true })).toBeVisible();
  const options = page.getByRole('listbox', { name: '可选模型', exact: true }).getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('doubao-seedream-5.0-lite');
  const search = page.getByRole('combobox', { name: '搜索模型', exact: true });
  await search.fill('not-in-this-catalog');
  await expect(options).toHaveCount(0);
  await expect(
    page.getByText('没有匹配的模型，可修改搜索词或手动填写。', { exact: true }),
  ).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('doubao-seedream-5.0-lite');
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(options).toHaveCount(3);
  await search.fill('gpt-image');
  await expect(options).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(studio.folder, 'model-picker-ready.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await search.press('ArrowDown');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('gpt-image-2');
  await expect(page.getByRole('combobox', { name: '接口协议', exact: true })).toHaveValue(
    'openai-images',
  );
  await expect(search).toHaveCount(0);
  await page.getByLabel('将此模型用于创作', { exact: true }).check();
  await page.getByRole('button', { name: '仅保存配置', exact: true }).click();
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'image')).toMatchObject(
    {
      baseUrl: 'https://another-gateway.example/v1',
      protocol: 'openai-images',
      model: 'gpt-image-2',
    },
  );
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('model discovery animates pending work and exposes retryable errors and empty catalogs next to the fields', async ({
  page,
  studio,
}) => {
  await openConnections(page, studio);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.unroute('**/api/v1/model-connections/discover');
  studio.services.settings.connections.previewModels = async () => {
    await pending;
    return {
      models: [],
      modelsCheckedAt: new Date().toISOString(),
      discoveryStatus: 'unauthorized',
      discoveryMessage: '模型目录拒绝访问，请检查密钥与目录权限。',
    };
  };
  await page.getByLabel(/^服务地址/).fill('https://fixture.example/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-loading-key');
  const feedback = page.locator('.model-discovery-feedback');
  const directory = page.getByRole('region', { name: '模型目录', exact: true });
  await expect(feedback).toContainText('正在获取模型列表…');
  await expect(directory).toHaveAttribute('aria-busy', 'true');
  await expect(directory.getByText('目录未查询', { exact: true })).toHaveCount(0);
  await expect(
    directory.getByText('暂无模型目录，可先手动填写模型标识并保存。', { exact: true }),
  ).toHaveCount(0);
  await expect(feedback.locator('.model-discovery-spinner')).toHaveCSS(
    'animation-name',
    'model-directory-spin',
  );
  await expect(page.locator('.model-directory-skeleton > span').first()).toHaveCSS(
    'animation-name',
    'model-directory-shimmer',
  );
  await page.screenshot({
    path: join(studio.folder, 'model-directory-loading.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(feedback.locator('.model-discovery-spinner')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.model-directory-skeleton > span').first()).toHaveCSS(
    'animation-name',
    'none',
  );
  await page.getByLabel(/^模型标识/).fill('manual-draft');
  release();
  await expect(feedback).toContainText('模型列表获取失败');
  await expect(feedback).toContainText('请检查密钥与目录权限');
  await expect(directory).toHaveAttribute('aria-busy', 'false');
  studio.services.settings.connections.previewModels = async () => ({
    models: [],
    modelsCheckedAt: new Date().toISOString(),
    discoveryStatus: 'connected',
    discoveryMessage: '目录已同步',
  });
  await page.getByRole('button', { name: '重试获取模型', exact: true }).click();
  await expect(feedback).toContainText('已获取 0 个模型');
  await expect(feedback).toContainText('服务商返回了空目录');
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('manual-draft');
  expect(
    studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM model_connections').get(),
  ).toEqual({ n: 0 });
});

test('a stalled discovery times out without locking the model editor', async ({ page, studio }) => {
  await openConnections(page, studio);
  await page.clock.install();
  await page.route('**/api/v1/model-connections/discover', () => {});
  await page.getByLabel(/^服务地址/).fill('https://fixture.example/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-timeout-key');
  const request = page.waitForRequest('**/api/v1/model-connections/discover');
  await page.clock.runFor(650);
  await request;
  await page.clock.fastForward(12_100);
  await expect(page.locator('.model-discovery-feedback')).toContainText(
    '获取模型列表超时，请重试或手动填写模型。',
  );
  await expect(page.getByRole('button', { name: '重试获取模型', exact: true })).toBeEnabled();
  await page.getByLabel(/^模型标识/).fill('manual-after-timeout');
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('manual-after-timeout');
});

test('debounces input, ignores late catalogs and isolates drafts when switching stages', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  const requests: { kind: string; baseUrl: string; secret: string }[] = [];
  let finishOld!: () => void;
  const oldResponse = new Promise<void>((resolve) => {
    finishOld = resolve;
  });
  let oldFinished = false;
  await page.unroute('**/api/v1/model-connections/discover');
  // Keep the authenticated HTTP route real; only the upstream directory response is synthetic.
  studio.services.settings.connections.previewModels = async (_wid, input) => {
    requests.push({ kind: input.kind, baseUrl: input.baseUrl, secret: input.secret ?? '' });
    if (input.baseUrl.includes('old.example')) {
      await oldResponse;
      oldFinished = true;
    }
    return {
      models: [
        input.kind === 'image'
          ? 'image-preview'
          : input.baseUrl.includes('old.example')
            ? 'stale-preview'
            : 'latest-preview',
      ],
      modelsCheckedAt: new Date().toISOString(),
      discoveryStatus: 'connected',
      discoveryMessage: '目录已同步',
    };
  };
  await page.getByLabel(/^服务地址/).fill('https://old.example/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-old-key');
  await expect.poll(() => requests.length).toBe(1);
  await page.getByLabel(/^服务地址/).fill('https://latest.example/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-new-key');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-final-key');
  await expect(page.getByRole('button', { name: 'latest-preview', exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]?.secret).toBe('synthetic-final-key');
  finishOld();
  await expect.poll(() => oldFinished).toBe(true);
  await expect(page.getByRole('button', { name: 'stale-preview', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'latest-preview', exact: true }).click();
  await page.getByRole('button', { name: /图片生成/ }).click();
  await expect(page.getByRole('button', { name: 'latest-preview', exact: true })).toHaveCount(0);
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-image-key');
  await expect(page.getByRole('button', { name: 'image-preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /文本规划/ }).click();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('latest-preview');
  await expect(page.getByLabel('API Key（接口密钥）', { exact: true })).toHaveValue(
    'synthetic-final-key',
  );
  await expect(page.getByRole('button', { name: 'latest-preview', exact: true })).toBeVisible();
  expect(studio.services.settings.connections.get(account.workspace.id, 'text').configured).toBe(
    false,
  );
  expect(
    studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM model_connections').get(),
  ).toEqual({ n: 0 });
});

test('failed automatic discovery permits retry and manual models without persisting a draft', async ({
  page,
  studio,
}) => {
  await openConnections(page, studio);
  let attempts = 0;
  await page.route('**/api/v1/model-connections/discover', (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'FIXTURE_DIRECTORY_FAILURE', message: '模拟目录暂时不可用' } },
        })
      : route.fulfill({
          json: {
            data: {
              models: ['recovered-model'],
              modelsCheckedAt: new Date().toISOString(),
              discoveryStatus: 'connected',
              discoveryMessage: '目录已同步',
            },
          },
        });
  });
  await page.getByLabel(/^服务地址/).fill('https://fixture.example/v1');
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('synthetic-retry-key');
  await expect(page.getByText('模拟目录暂时不可用', { exact: true })).toBeVisible();
  await page.getByLabel(/^模型标识/).fill('manual-model');
  await page.getByRole('button', { name: '刷新目录', exact: true }).click();
  await expect(page.getByRole('button', { name: 'recovered-model', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^模型标识/)).toHaveValue('manual-model');
  expect(attempts).toBe(2);
  await page.getByLabel('API Key（接口密钥）', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'recovered-model', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新目录', exact: true })).toBeDisabled();
  expect(
    studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM model_connections').get(),
  ).toEqual({ n: 0 });
});

test('does not use a saved key automatically on another host or while removing the key', async ({
  page,
  studio,
}) => {
  const account = await openConnections(page, studio);
  studio.services.settings.connections.update(account.workspace.id, {
    kind: 'text',
    protocol: 'openai-chat',
    baseUrl: 'https://fixture.example/v1',
    modelsUrl: '',
    model: 'saved-model',
    enabled: true,
    secret: 'synthetic-saved-key',
  });
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/model-connections/discover')) requests++;
  });
  await page.reload();
  await page.getByLabel(/^服务地址/).fill('https://other.example/v1');
  await expect(page.getByRole('button', { name: '刷新目录', exact: true })).toBeDisabled();
  // Advance beyond the debounce interval to prove that no request is dispatched.
  await page.waitForTimeout(800);
  expect(requests).toBe(0);
  await page.getByLabel(/^服务地址/).fill('https://fixture.example/proxy/v2');
  await expect(page.getByRole('button', { name: 'sample-text-v1', exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByLabel('保存时移除此密钥', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'sample-text-v1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新目录', exact: true })).toBeDisabled();
  expect(studio.services.settings.connections.runtime(account.workspace.id, 'text')?.baseUrl).toBe(
    'https://fixture.example/v1',
  );
});

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

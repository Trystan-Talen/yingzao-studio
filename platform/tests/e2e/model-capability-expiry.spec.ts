import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import type { JobInput } from '../../src/contracts/jobs';
import type { ModelCapabilitiesDto } from '../../src/contracts/model-capabilities';
import { test, expect, type Studio } from './fixtures';

test.use({ experienceProviders: false, recoveryEnabled: false, smsEnabled: false });

const capabilityPath = '**/api/v1/capabilities/model?*';
const brief = '生成一张口红的电商主图，浅灰背景，自然光，保留红色管身。';

async function openNativeCreation(page: Page, studio: Studio) {
  const account = await studio.services.core.auth.register({
    email: 'capability-expiry@example.test',
    password: 'CapabilityExpiryFixture2026!',
    displayName: '模型有效期验收',
  });
  studio.services.core.auth.update(
    { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    { preferences: { onboardingCompleted: true, theme: 'dark' } },
  );
  for (const kind of ['text', 'image', 'video'] as const)
    studio.services.settings.connections.update(account.workspace.id, {
      kind,
      protocol:
        kind === 'text' ? 'openai-chat' : kind === 'image' ? 'openai-images' : 'seedance-native',
      baseUrl:
        kind === 'video'
          ? 'https://expiry-fixture.invalid/api/v3/contents/generations/tasks'
          : 'https://expiry-fixture.invalid/v1',
      modelsUrl: '',
      model:
        kind === 'text'
          ? 'fixture-planner'
          : kind === 'image'
            ? 'gpt-image-2'
            : 'doubao-seedance-2.0',
      enabled: true,
      secret: `unused-expiry-${kind}-key`,
    });
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
  const forbidden: string[] = [];
  // Native transport bypasses fetch guards. Always stop at the application boundary.
  await page.route(/\/api\/v1\/(?:creative-briefs\/prepare|quotes|jobs)$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/creative-briefs/prepare')
      preparations.push(route.request().postDataJSON().input as JobInput);
    else forbidden.push(path);
    return route.fulfill({
      status: 409,
      json: { error: { code: 'ISOLATED_STOP', message: '已收到生成点击；隔离验收不调用模型。' } },
    });
  });
  await page.goto(studio.origin);
  const composer = page.locator('.composer[data-presentation="quick"]');
  await expect(composer).toBeVisible();
  const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  await prompt.fill(brief);
  const generate = composer.getByRole('button', { name: '生成图片', exact: true });
  await expect(generate).toBeEnabled();
  return { account, composer, prompt, generate, preparations, forbidden };
}

async function capabilityResponse(page: Page, route: Route, duration: number) {
  const response = await route.fetch();
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: ModelCapabilitiesDto };
  body.data.expiresAt = new Date((await page.evaluate(() => Date.now())) + duration).toISOString();
  return { response, body };
}

function noGeneration(studio: Studio, forbidden: string[]) {
  expect(forbidden).toEqual([]);
  for (const table of ['creative_briefs', 'quotes', 'jobs'])
    expect(studio.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
}

test('renews expired native model information and the restored generate button dispatches the retained brief', async ({
  page,
  studio,
}) => {
  await page.clock.install();
  let queries = 0;
  await page.route(capabilityPath, async (route) => {
    queries++;
    const { response, body } = await capabilityResponse(
      page,
      route,
      queries === 1 ? 30_000 : 300_000,
    );
    await route.fulfill({ response, json: body });
  });
  const flow = await openNativeCreation(page, studio);
  expect(queries).toBe(1);
  await page.clock.fastForward(31_000);
  await expect.poll(() => queries).toBeGreaterThan(1);
  await expect(flow.generate).toBeEnabled();
  await expect(flow.prompt).toHaveValue(brief);
  await expect(flow.composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  await page.reload();
  await expect(flow.prompt).toHaveValue(brief);
  await expect(flow.generate).toBeEnabled();
  await flow.generate.click();
  await expect.poll(() => flow.preparations.length).toBe(1);
  expect(flow.preparations[0]).toMatchObject({
    providerId: 'native',
    prompt: brief,
    options: { model: 'gpt-image-2' },
  });
  noGeneration(studio, flow.forbidden);
  await page.screenshot({
    path: join(studio.folder, 'expired-model-renewed-click-dispatched.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('shows expiry refresh failures beside the home action and retries explicitly without a request loop', async ({
  page,
  studio,
}) => {
  await page.clock.install();
  let queries = 0;
  let failRefresh = true;
  await page.route(capabilityPath, async (route) => {
    queries++;
    if (queries > 1 && failRefresh) {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'FIXTURE_UNAVAILABLE', message: '隔离模型能力刷新失败' } },
      });
      return;
    }
    const { response, body } = await capabilityResponse(
      page,
      route,
      queries === 1 ? 30_000 : 300_000,
    );
    await route.fulfill({ response, json: body });
  });
  const flow = await openNativeCreation(page, studio);
  await page.clock.fastForward(31_000);
  await expect.poll(() => queries).toBe(2);
  await expect(flow.generate).toBeDisabled();
  const status = flow.composer.locator('.model-capability-status');
  await expect(status).toContainText('模型信息未能更新，请重试后再生成。');
  const retry = status.getByRole('button', { name: '重试核查', exact: true });
  await expect(retry).toBeVisible();
  await expect(flow.prompt).toHaveValue(brief);
  await page.clock.fastForward(120_000);
  expect(queries).toBe(2);
  await page.screenshot({
    path: join(studio.folder, 'expired-model-refresh-error-visible.png'),
    fullPage: true,
    animations: 'disabled',
  });
  failRefresh = false;
  await retry.click();
  await expect(flow.generate).toBeEnabled();
  await expect(flow.prompt).toHaveValue(brief);
  await flow.generate.click();
  await expect.poll(() => flow.preparations.length).toBe(1);
  expect(flow.preparations[0]).toMatchObject({
    providerId: 'native',
    prompt: brief,
    options: { model: 'gpt-image-2' },
  });
  noGeneration(studio, flow.forbidden);
});

test('an expired image response cannot replace a newer video selection or dispatch the old model', async ({
  page,
  studio,
}) => {
  await page.clock.install();
  let imageQueries = 0;
  let release!: () => void;
  let delayedStarted = false;
  let handled!: () => void;
  const staleHandled = new Promise<void>((done) => {
    handled = done;
  });
  const delayed = new Promise<void>((done) => {
    release = done;
  });
  await page.route(capabilityPath, async (route) => {
    const model = new URL(route.request().url()).searchParams.get('modelId');
    if (model === 'gpt-image-2') imageQueries++;
    const { response, body } = await capabilityResponse(
      page,
      route,
      model === 'gpt-image-2' && imageQueries === 1 ? 30_000 : 300_000,
    );
    if (model === 'gpt-image-2' && imageQueries === 2) {
      delayedStarted = true;
      await delayed;
    }
    await route.fulfill({ response, json: body }).catch(() => {
      /* Abandoned request may already be cancelled. */
    });
    if (model === 'gpt-image-2' && imageQueries === 2) handled();
  });
  try {
    const flow = await openNativeCreation(page, studio);
    await page.clock.fastForward(31_000);
    await expect.poll(() => delayedStarted).toBe(true);
    await expect(flow.generate).toBeDisabled();
    await flow.composer.getByRole('button', { name: '视频创作', exact: true }).click();
    const videoBrief = '红色口红放在浅灰桌面，镜头缓慢靠近，五秒产品短片。';
    await flow.prompt.fill(videoBrief);
    const generateVideo = flow.composer.getByRole('button', { name: '生成视频', exact: true });
    await expect(generateVideo).toBeEnabled();
    release();
    await staleHandled;
    await expect(flow.composer.locator('.composer-settings-model')).toContainText(
      'doubao-seedance-2.0',
    );
    await expect(generateVideo).toBeEnabled();
    await generateVideo.click();
    await expect.poll(() => flow.preparations.length).toBe(1);
    expect(flow.preparations[0]).toMatchObject({
      operation: 'video.generate',
      providerId: 'native',
      prompt: videoBrief,
      options: { model: 'doubao-seedance-2.0' },
    });
    noGeneration(studio, flow.forbidden);
  } finally {
    release();
  }
});

test('an expiry refresh that disables generation shows its reason even while the operation list remains available', async ({
  page,
  studio,
}) => {
  await page.clock.install();
  let queries = 0;
  const reason = '请在模型配置中启用文本与图片服务';
  await page.route(capabilityPath, async (route) => {
    queries++;
    const { response, body } = await capabilityResponse(
      page,
      route,
      queries === 1 ? 30_000 : 300_000,
    );
    if (queries > 1) {
      body.data.canGenerate = false;
      body.data.status = 'unavailable';
      body.data.reasonCode = 'NOT_CONFIGURED';
      body.data.reason = reason;
    }
    await route.fulfill({ response, json: body });
  });
  const flow = await openNativeCreation(page, studio);
  // The general operation response stays cached and available, as when another
  // client disables a saved connection after this page loaded its initial list.
  const operations = studio.services.settings.capabilities(flow.account.workspace.id).operations;
  expect(
    operations.find(
      (operation) => operation.id === 'image.generate' && operation.providerId === 'native',
    ),
  ).toMatchObject({ available: true });
  await page.clock.fastForward(31_000);
  await expect.poll(() => queries).toBe(2);
  const status = flow.composer.locator('.model-capability-status[data-blocking="true"]');
  await expect(status).toBeVisible();
  await expect(status.locator('summary')).toHaveText(reason);
  await expect(flow.generate).toBeDisabled();
  await expect(flow.prompt).toHaveValue(brief);
  expect(flow.preparations).toEqual([]);
  noGeneration(studio, flow.forbidden);
  await page.screenshot({
    path: join(studio.folder, 'expired-model-disabled-reason-visible.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

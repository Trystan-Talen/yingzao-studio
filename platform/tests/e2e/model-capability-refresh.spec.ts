import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page, Response } from '@playwright/test';
import type { JobInput } from '../../src/contracts/jobs';
import type { ModelCapabilitiesDto } from '../../src/contracts/model-capabilities';
import { test, expect, type Studio } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

const capabilityPath = '/api/v1/capabilities/model';
const selectedResponse = (modelId: string) => (response: Response) => {
  const url = new URL(response.url());
  return url.pathname === capabilityPath && url.searchParams.get('modelId') === modelId;
};

async function open(page: Page, studio: Studio) {
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
  await page.goto(studio.origin);
  await expect(page.getByRole('heading', { name: '今天想映造什么？', exact: true })).toBeVisible();
  return account;
}

function noGeneration(studio: Studio) {
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(
    studio.services.db.sqlite
      .prepare("SELECT count(*) n FROM credit_ledger WHERE kind='settle'")
      .get(),
  ).toEqual({ n: 0 });
}

const settingsFor = (composer: Locator) =>
  composer.page().getByRole('dialog', { name: '创作设置', exact: true });

async function closeSettings(composer: Locator) {
  await settingsFor(composer).getByRole('button', { name: '完成', exact: true }).click();
}

async function openSettings(composer: Locator) {
  await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  await expect(settingsFor(composer)).toBeVisible();
}

test('reads selected model metadata through the real API and presents fixed values with truthful provenance', async ({
  page,
  studio,
}) => {
  const loading = page.waitForResponse(selectedResponse('doubao-seedream-5.0-lite'));
  await open(page, studio);
  const response = await loading;
  expect(response.status()).toBe(200);
  const capability = (await response.json()).data as ModelCapabilitiesDto;
  expect(capability).toMatchObject({
    providerId: 'openai',
    operation: 'image.generate',
    modelId: 'doubao-seedream-5.0-lite',
    inputMode: 'text',
    status: 'limited',
    source: 'provider-documentation',
    modelVerified: true,
    parametersVerified: false,
    canGenerate: true,
  });
  expect(capability.revision).toBeTruthy();
  expect(Date.parse(capability.expiresAt)).toBeGreaterThan(Date.parse(capability.checkedAt));
  expect(studio.metadataRequests).toContain('https://preview.invalid/v1/models');
  const composer = page.locator('.composer[data-presentation="quick"]');
  await openSettings(composer);
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '清晰度', exact: true }),
  ).toHaveValue('2K');
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '生成数量', exact: true }),
  ).toHaveCount(0);
  await expect(settingsFor(composer).getByTestId('generation-output-size')).toContainText(
    '2048 × 2048',
  );
  const status = settingsFor(composer).locator('.model-capability-status');
  await status.locator('summary').click();
  await expect(status).toContainText('原厂文档与当前接入');
  await expect(status).toContainText('由当前服务固定');
  await expect(status).toContainText('没有独立的低、中、高画质选项');
  const refreshed = page.waitForResponse(selectedResponse(capability.modelId));
  await status.getByRole('button', { name: '刷新模型信息', exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  noGeneration(studio);
  await writeFile(
    join(studio.folder, 'model-capability.json'),
    JSON.stringify(
      { simulated: true, capability, metadataRequests: studio.metadataRequests },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: join(studio.folder, 'model-capability-provenance.png'),
    fullPage: true,
  });
});

test('blocks generation while model information is loading or failed and explicitly retries without losing the brief', async ({
  page,
  studio,
}) => {
  let release!: () => void;
  const delayed = new Promise<void>((done) => {
    release = done;
  });
  let first = true;
  await page.route(`**${capabilityPath}?**`, async (route) => {
    if (!first) return route.continue();
    first = false;
    await delayed;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'FIXTURE_UNAVAILABLE', message: '本机能力查询故障夹具' },
      }),
    });
  });
  try {
    await open(page, studio);
    const composer = page.locator('.composer[data-presentation="quick"]');
    const brief = composer.getByRole('textbox', { name: '创作需求', exact: true });
    const generate = composer.getByRole('button', { name: '生成图片', exact: true });
    await brief.fill('保留这段尚未提交的植物精华创意。');
    await expect(generate).toBeDisabled();
    await openSettings(composer);
    await expect(settingsFor(composer).locator('.model-capability-status summary')).toHaveText(
      '正在核查当前模型…',
    );
    noGeneration(studio);
    release();
    await expect(settingsFor(composer).locator('.model-capability-status summary')).toHaveText(
      '模型信息未能更新，请重试后再生成。',
    );
    await closeSettings(composer);
    await expect(generate).toBeDisabled();
    await openSettings(composer);
    await settingsFor(composer).getByRole('button', { name: '重试核查', exact: true }).click();
    await closeSettings(composer);
    await expect(generate).toBeEnabled();
    await expect(brief).toHaveValue('保留这段尚未提交的植物精华创意。');
    noGeneration(studio);
  } finally {
    release();
  }
});

test('ignores a delayed previous model response and quotes only the current model with its own revision', async ({
  page,
  studio,
}) => {
  let release!: () => void;
  let held!: () => void;
  const delayed = new Promise<void>((done) => {
    release = done;
  });
  const pending = new Promise<void>((done) => {
    held = done;
  });
  let first = true;
  await page.route(`**${capabilityPath}?**`, async (route) => {
    if (
      !first ||
      new URL(route.request().url()).searchParams.get('modelId') !== 'doubao-seedream-5.0-lite'
    )
      return route.continue();
    first = false;
    const response = await route.fetch();
    held();
    await delayed;
    await route.fulfill({ response });
  });
  try {
    await open(page, studio);
    await pending;
    const composer = page.locator('.composer[data-presentation="quick"]');
    await openSettings(composer);
    const model = settingsFor(composer).getByRole('combobox', { name: '生成模型', exact: true });
    const selected = page.waitForResponse(selectedResponse('9'));
    await model.selectOption('image.generate|flyelep|9');
    const current = (await (await selected).json()).data as ModelCapabilitiesDto;
    release();
    await expect(model).toHaveValue('image.generate|flyelep|9');
    await closeSettings(composer);
    await composer
      .getByRole('textbox', { name: '创作需求', exact: true })
      .fill('当前服务的海报创意，不能被迟到的旧模型替换。');
    await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
    const quoted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/quotes' &&
        response.request().method() === 'POST',
    );
    await composer.getByRole('button', { name: '生成图片', exact: true }).click();
    const response = await quoted;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({
      providerId: 'flyelep',
      capabilityRevision: current.revision,
      options: { model: '9' },
    });
    await page
      .getByRole('dialog', { name: '确认创作', exact: true })
      .getByRole('button', { name: '继续编辑', exact: true })
      .click();
    noGeneration(studio);
  } finally {
    release();
  }
});

test('preserves a now unsupported duration until explicit correction and quotes the corrected value with the refreshed proof', async ({
  page,
  studio,
}) => {
  const account = await open(page, studio);
  const composer = page.locator('.composer[data-presentation="quick"]');
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  const brief = composer.getByRole('textbox', { name: '创作需求', exact: true });
  await brief.fill('十秒慢镜头，保留原始文案直到我明确确认参数。');
  await openSettings(composer);
  const loaded = page.waitForResponse(selectedResponse('wan-2.6'));
  await settingsFor(composer)
    .getByRole('combobox', { name: '生成模型', exact: true })
    .selectOption('video.generate|fal|wan-2.6');
  const initial = (await (await loaded).json()).data as ModelCapabilitiesDto;
  await settingsFor(composer)
    .getByRole('combobox', { name: '清晰度', exact: true })
    .selectOption('720p');
  await settingsFor(composer)
    .getByRole('combobox', { name: '时长', exact: true })
    .selectOption('10');
  const status = settingsFor(composer).locator('.model-capability-status');
  await status.locator('summary').click();
  studio.setMetadataTransform((_url, body) => {
    const changed = structuredClone(body) as {
      models?: {
        openapi?: {
          components: { schemas: { Input: { properties: { duration: { enum: string[] } } } } };
        };
      }[];
    };
    if (changed.models?.[0]?.openapi)
      changed.models[0].openapi.components.schemas.Input.properties.duration.enum = ['5'];
    return changed;
  });
  // A user refresh intentionally respects the server's two-second refresh cooldown.
  await expect.poll(() => Date.now() - Date.parse(initial.fetchedAt!)).toBeGreaterThan(2100);
  const refresh = page.waitForResponse(selectedResponse('wan-2.6'));
  await status.getByRole('button', { name: '刷新模型信息', exact: true }).click();
  const current = (await (await refresh).json()).data as ModelCapabilitiesDto;
  expect(current.model.durations).toEqual([5]);
  expect(current.revision).not.toBe(initial.revision);
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '时长', exact: true }),
  ).toHaveCount(0);
  await expect(status).toContainText('“时长”的当前值不受此模型支持。原值已保留，请重新选择。');
  const key = `yingzao:creation:v1:${account.user.id}:${account.workspace.id}:new`;
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) || '{}').input?.options.duration,
        key,
      ),
    )
    .toBe(10);
  await closeSettings(composer);
  await expect(composer.getByRole('button', { name: '生成视频', exact: true })).toBeDisabled();
  await openSettings(composer);
  await status.locator('summary').click();
  await status.getByRole('button', { name: '采用当前模型的固定参数', exact: true }).click();
  await closeSettings(composer);
  await expect(brief).toHaveValue('十秒慢镜头，保留原始文案直到我明确确认参数。');
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) || '{}').input?.options.duration,
        key,
      ),
    )
    .toBe(5);
  const quoted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/quotes' &&
      response.request().method() === 'POST',
  );
  await composer.getByRole('button', { name: '生成视频', exact: true }).click();
  const response = await quoted;
  expect(response.status()).toBe(200);
  const input = response.request().postDataJSON() as JobInput;
  expect(input).toMatchObject({
    capabilityRevision: current.revision,
    options: { model: 'wan-2.6', duration: 5 },
  });
  await page
    .getByRole('dialog', { name: '确认创作', exact: true })
    .getByRole('button', { name: '继续编辑', exact: true })
    .click();
  noGeneration(studio);
  await writeFile(
    join(studio.folder, 'capability-correction.json'),
    JSON.stringify({ initial, current, quotedInput: input }, null, 2),
  );
});

test('disables an already open quote when its model information expires instead of submitting stale settings', async ({
  page,
  studio,
}) => {
  await page.route(`**${capabilityPath}?**`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.expiresAt = new Date(Date.now() + 5000).toISOString();
    await route.fulfill({ response, json: body });
  });
  await open(page, studio);
  const composer = page.locator('.composer[data-presentation="quick"]');
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('临时报价不能在能力信息过期后继续提交。');
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const quote = page.getByRole('dialog', { name: '确认创作', exact: true });
  const confirm = quote.getByRole('button', { name: '确认并提交', exact: true });
  await expect(confirm).toBeEnabled();
  await expect(confirm).toBeDisabled({ timeout: 10000 });
  await expect(quote).toContainText('设置或模型信息已改变，请返回编辑并重新确认报价。');
  noGeneration(studio);
  await quote.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(
    '临时报价不能在能力信息过期后继续提交。',
  );
});

test('documented image dimensions survive reload and reach the quote with their capability proof', async ({
  page,
  studio,
}) => {
  await open(page, studio);
  const composer = page.locator('.composer[data-presentation="quick"]');
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('横版三千像素档位的产品创意。');
  await openSettings(composer);
  await settingsFor(composer)
    .getByRole('combobox', { name: '清晰度', exact: true })
    .selectOption('3K');
  await settingsFor(composer)
    .getByRole('combobox', { name: '比例', exact: true })
    .selectOption('16:9');
  await expect(settingsFor(composer).getByTestId('generation-output-size')).toContainText(
    '4096 × 2304',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith('yingzao:creation:'))
          .map((key) => JSON.parse(localStorage.getItem(key) || '{}').input?.options)
          .some((o) => o?.resolution === '3K' && o?.ratio === '16:9'),
      ),
    )
    .toBe(true);
  await page.reload();
  await openSettings(composer);
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '清晰度', exact: true }),
  ).toHaveValue('3K');
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '比例', exact: true }),
  ).toHaveValue('16:9');
  await closeSettings(composer);
  const quoting = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/quotes' &&
      response.request().method() === 'POST',
  );
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const response = await quoting;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({
    capabilityRevision: expect.any(String),
    options: { ratio: '16:9', resolution: '3K' },
  });
  noGeneration(studio);
  await page.screenshot({
    path: join(studio.folder, 'documented-image-quote.png'),
    fullPage: true,
  });
});

test('documented video controls quote fifteen seconds with synchronized audio and 4K', async ({
  page,
  studio,
}) => {
  await open(page, studio);
  const composer = page.locator('.composer[data-presentation="quick"]');
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await openSettings(composer);
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '生成模型', exact: true }),
  ).toHaveValue('video.generate|seedance|doubao-seedance-2.0');
  await settingsFor(composer)
    .getByRole('combobox', { name: '清晰度', exact: true })
    .selectOption('4K');
  await settingsFor(composer)
    .getByRole('combobox', { name: '时长', exact: true })
    .selectOption('15');
  await settingsFor(composer)
    .getByRole('combobox', { name: '比例', exact: true })
    .selectOption('21:9');
  await closeSettings(composer);
  await composer.getByRole('checkbox', { name: '生成视频音轨', exact: true }).check();
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('十五秒雨林镜头，带有鸟鸣。');
  const quoting = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/quotes' &&
      response.request().method() === 'POST',
  );
  await composer.getByRole('button', { name: '生成视频', exact: true }).click();
  const response = await quoting;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({
    options: { ratio: '21:9', resolution: '4K', duration: 15, generateAudio: true },
  });
  expect((await response.json()).data.units).toBe(15);
  noGeneration(studio);
  await page.screenshot({
    path: join(studio.folder, 'documented-video-quote.png'),
    fullPage: true,
  });
});

test('home starts with ready defaults and an actionable empty prompt without creating a quote or job', async ({
  page,
  studio,
}) => {
  await open(page, studio);
  const composer = page.locator('.composer[data-presentation="quick"]');
  const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  const generate = composer.getByRole('button', { name: '生成图片', exact: true });
  await expect(generate).toBeEnabled();
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  await expect(settingsFor(composer)).toHaveCount(0);
  const viewport = page.viewportSize()!;
  for (const control of [prompt, composer.locator('.credit-estimate'), generate]) {
    const box = await control.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  }
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: join(studio.folder, 'gradient-home-ready.png') });
  let quoteRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/quotes') quoteRequests++;
  });
  await generate.click();
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveAttribute('aria-invalid', 'true');
  await expect(composer.locator('.quick-prompt-guidance')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(quoteRequests).toBe(0);
  noGeneration(studio);
  await openSettings(composer);
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '比例', exact: true }),
  ).toHaveValue('1:1');
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '清晰度', exact: true }),
  ).toHaveValue('2K');
  await closeSettings(composer);
  await prompt.fill('一座漂浮在云端的花园，柔和的电影光线。');
  await expect(composer.locator('.quick-prompt-guidance')).toHaveCount(0);
  const quoted = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/v1/quotes',
  );
  await generate.click();
  const body = (await quoted).postDataJSON() as JobInput;
  expect(body.options).toMatchObject({
    model: 'doubao-seedream-5.0-lite',
    ratio: '1:1',
    resolution: '2K',
    count: 1,
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(quoteRequests).toBe(1);
  noGeneration(studio);
});

test('home restores text entered before metadata is ready and finishes defaults without replacing an explicit saved choice', async ({
  page,
  studio,
}) => {
  let unavailable = true;
  await page.route(`**${capabilityPath}*`, async (route) => {
    if (unavailable)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UPSTREAM_UNAVAILABLE', message: 'isolated metadata unavailable' },
        }),
      });
    else await route.continue();
  });
  const account = await open(page, studio);
  const composer = page.locator('.composer[data-presentation="quick"]');
  const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  await prompt.fill('模型读取期间写下的想法，刷新后也应保留。');
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  await expect
    .poll(async () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) || '{}').modelDefaultsPending?.image,
        `yingzao:creation:v1:${account.user.id}:${account.workspace.id}:new`,
      ),
    )
    .toBe(true);
  unavailable = false;
  await page.reload();
  await expect(prompt).toHaveValue('模型读取期间写下的想法，刷新后也应保留。');
  await openSettings(composer);
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '清晰度', exact: true }),
  ).toHaveValue('2K');
  await settingsFor(composer)
    .getByRole('combobox', { name: '清晰度', exact: true })
    .selectOption('3K');
  await closeSettings(composer);
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  await page.reload();
  await openSettings(composer);
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '清晰度', exact: true }),
  ).toHaveValue('3K');
  await closeSettings(composer);
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await openSettings(composer);
  await settingsFor(composer)
    .getByRole('combobox', { name: '生成模型', exact: true })
    .selectOption('video.generate|seedance|doubao-seedance-2.0');
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '比例', exact: true }),
  ).toHaveValue('16:9');
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '清晰度', exact: true }),
  ).toHaveValue('720p');
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '时长', exact: true }),
  ).toHaveValue('5');
  await closeSettings(composer);
  await expect(composer.getByRole('button', { name: '生成视频', exact: true })).toBeEnabled();
  await expect(
    composer.getByRole('checkbox', { name: '生成视频音轨', exact: true }),
  ).not.toBeChecked();
  await composer.getByRole('button', { name: '图片创作', exact: true }).click();
  await expect(prompt).toHaveValue('模型读取期间写下的想法，刷新后也应保留。');
  await openSettings(composer);
  await expect(
    settingsFor(composer).getByRole('combobox', { name: '清晰度', exact: true }),
  ).toHaveValue('3K');
  noGeneration(studio);
});

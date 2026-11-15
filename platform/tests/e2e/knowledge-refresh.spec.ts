import sharp from 'sharp';
import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import type { CreativePreparation } from '../../src/contracts/creative-intent';
import { creativeInputFingerprint } from '../../src/contracts/creative-fingerprint';
import { test, expect, type Studio } from './fixtures';
import { confirmDarkFlow, openDarkFlow } from './dark-creation-flow.helpers';
import { creationRecords, waitForCreationResult } from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

async function openProductCreation(page: Page, studio: Studio, validUntil?: string) {
  const flow = await openDarkFlow(page, studio);
  const actor: Actor = {
    userId: flow.account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const product = studio.services.core.knowledge.createProduct(actor, flow.account.workspace.id, {
    name: '恢复资料产品',
    facts: ['容量30毫升'],
    validUntil,
  });
  await flow.prompt.fill('按所选资料绘制一只白杯，纯白背景，不添加文字。');
  await flow.composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await settings.getByText('更多偏好', { exact: true }).click();
  await settings.getByRole('combobox', { name: '参考产品', exact: true }).selectOption(product.id);
  await settings.getByRole('checkbox', { name: '使用创作记忆', exact: true }).uncheck();
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  return {
    ...flow,
    actor,
    product,
    generate: flow.composer.getByRole('button', { name: '生成图片', exact: true }),
    refresh: flow.composer.getByRole('button', {
      name: '按最新资料重新整理',
      exact: true,
      includeHidden: true,
    }),
    confirmation: page.getByRole('dialog', { name: '确认创作', exact: true }),
  };
}

test('rejects an expired failed-task retry and lets the preserved draft replan with renewed product facts', async ({
  page,
  studio,
}) => {
  const flow = await openProductCreation(page, studio);
  const expires = Date.now() + 12_000;
  studio.services.core.knowledge.updateProduct(
    flow.actor,
    flow.account.workspace.id,
    flow.product.id,
    { validUntil: new Date(expires).toISOString(), expectedVersion: 1 },
  );
  await flow.prompt.fill('模拟首次失败：按所选资料绘制一只白杯，纯白背景，不添加文字。');
  await flow.generate.click();
  const original = await confirmDarkFlow(page);
  const focused = page.locator('.focused-task');
  await expect(focused).toContainText('本机模拟首次失败');
  const records = creationRecords(studio);
  // Exercise natural expiry against the real server clock, without replacing API responses.
  await expect.poll(() => Date.now(), { timeout: 15_000 }).toBeGreaterThan(expires);
  const retrying = page.waitForResponse((response) =>
    response.url().endsWith(`/jobs/${original.id}/retry-quote`),
  );
  await focused.getByRole('button', { name: '为可重试项重新估价', exact: true }).click();
  const rejected = await retrying;
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).error.code).toBe('KNOWLEDGE_CONTEXT_EXPIRED');
  await expect(focused).toContainText('已保存方案引用的资料或偏好已过期');
  await expect(flow.confirmation).toHaveCount(0);
  expect(creationRecords(studio)).toEqual(records);
  studio.services.core.knowledge.updateProduct(
    flow.actor,
    flow.account.workspace.id,
    flow.product.id,
    { facts: ['续期后容量50毫升'], validUntil: null, expectedVersion: 2 },
  );
  await flow.refresh.click();
  await expect(flow.prompt).toHaveValue(original.prompt);
  expect(creationRecords(studio)).toEqual(records);
  await flow.prompt.fill('按所选资料绘制一只白杯，纯白背景，不添加文字。');
  const preparing = page.waitForResponse((response) =>
    response.url().endsWith('/creative-briefs/prepare'),
  );
  const quoting = page.waitForResponse((response) => response.url().endsWith('/quotes'));
  await flow.generate.click();
  const prepared = (await (await preparing).json()).data as CreativePreparation;
  expect(prepared.contextSources).toContainEqual(
    expect.objectContaining({
      kind: 'product',
      version: 3,
      content: expect.stringContaining('50毫升'),
    }),
  );
  const quoteResponse = await quoting;
  if (quoteResponse.status() === 409) {
    expect((await quoteResponse.json()).error.code).toBe('CAPABILITY_CHANGED');
    await expect(flow.composer).toContainText('模型信息已重新核查，草稿已保留');
    const briefCount = creationRecords(studio).briefs;
    await flow.generate.click();
    await expect(flow.confirmation).toBeVisible();
    expect(creationRecords(studio).briefs).toBe(briefCount);
  } else expect(quoteResponse.status()).toBe(201);
  await expect(flow.confirmation).toBeVisible();
  const created = await confirmDarkFlow(page);
  const completed = await waitForCreationResult(
    page,
    studio,
    created.id,
    flow.account.workspace.id,
  );
  expect(created.id).not.toBe(original.id);
  expect(completed.outputAssets).toHaveLength(1);
  expect(studio.services.get(flow.actor, flow.account.workspace.id, original.id).status).toBe(
    'failed',
  );
  expect(creationRecords(studio)).toMatchObject({ jobs: 2, settled: 1 });
});

test('refreshes an expired product cached in a continuously visible page after another client renews it', async ({
  page,
  studio,
}) => {
  await page.clock.install();
  const flow = await openProductCreation(page, studio, new Date(Date.now() + 60_000).toISOString());
  await flow.generate.click();
  await expect(flow.confirmation).toBeVisible();
  await flow.confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  // Age the cached date in the browser only; the API update is a separate client.
  await page.clock.fastForward(61_000);
  await flow.composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await settings.getByText('更多偏好', { exact: true }).click();
  await expect(
    settings.getByText('产品资料已过期，请更新资料或重新选择。', { exact: true }),
  ).toBeVisible();
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  studio.services.core.knowledge.updateProduct(
    flow.actor,
    flow.account.workspace.id,
    flow.product.id,
    {
      validUntil: '2099-01-01T00:00:00.000Z',
      facts: ['续期后容量50毫升'],
      expectedVersion: 1,
    },
  );
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  const original = await flow.prompt.inputValue();
  await flow.refresh.click();
  await expect(flow.generate).toBeEnabled();
  await expect(flow.prompt).toHaveValue(original);
  expect(creationRecords(studio)).toMatchObject({ briefs: 1, quotes: 1, jobs: 0 });
  const preparing = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/creative-briefs/prepare'),
  );
  await flow.generate.click();
  const prepared = (await (await preparing).json()).data as CreativePreparation;
  await expect(flow.confirmation).toBeVisible();
  expect(prepared.contextSources).toContainEqual(
    expect.objectContaining({
      kind: 'product',
      version: 2,
      expiresAt: '2099-01-01T00:00:00.000Z',
      content: expect.stringContaining('续期后容量50毫升'),
    }),
  );
  expect(creationRecords(studio)).toMatchObject({ briefs: 2, quotes: 2, jobs: 0 });
});

test('explicitly refreshes updated library sources without changing the request or reusing the previous quote', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openDarkFlow(page, studio);
  const actor: Actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const brand = studio.services.core.references.createBrand(actor, account.workspace.id, {
    name: '更新验收品牌',
    description: '旧品牌说明，清新青绿色。',
    colors: ['#126A5C'],
  });
  const product = studio.services.core.knowledge.createProduct(actor, account.workspace.id, {
    name: '更新验收香氛瓶',
    facts: ['容量30毫升'],
    brandId: brand.id,
    referenceAssetIds: [account.reference.id],
  });
  const original = '按照所选产品和品牌资料创作香氛主图，完整瓶身，纯白背景，不添加文字。';
  await prompt.fill(original);
  await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await settings.getByText('更多偏好', { exact: true }).click();
  await settings.getByRole('combobox', { name: '参考产品', exact: true }).selectOption(product.id);
  await settings.getByRole('checkbox', { name: '带入产品参考图', exact: true }).check();
  await settings.getByRole('checkbox', { name: '使用创作记忆', exact: true }).uncheck();
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  const generate = composer.getByRole('button', { name: '生成图片', exact: true });
  const preparing = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/creative-briefs/prepare'),
  );
  await generate.click();
  const first = (await (await preparing).json()).data as CreativePreparation;
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(confirmation).toBeVisible();
  const oldBrief = studio.services.db.sqlite
    .prepare('SELECT * FROM creative_briefs WHERE id=?')
    .get(first.id);
  const oldQuote = studio.services.db.sqlite.prepare('SELECT * FROM quotes').get();
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  const nextImage = await studio.services.core.assets.ingest(actor, account.workspace.id, {
    name: '更新后的产品图.png',
    mimeType: 'image/png',
    buffer: await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#D28722' },
    })
      .png()
      .toBuffer(),
  });
  studio.services.core.references.updateBrand(actor, account.workspace.id, brand.id, {
    description: '更新后的品牌说明，温暖琥珀色。',
    colors: ['#D28722'],
  });
  studio.services.core.knowledge.updateProduct(actor, account.workspace.id, product.id, {
    facts: ['容量50毫升'],
    referenceAssetIds: [nextImage.id],
    expectedVersion: product.version,
  });
  const refresh = composer.getByRole('button', { name: '按最新资料重新整理', exact: true });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(prompt).toHaveValue(original);
  await expect(refresh).toHaveCount(0);
  expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(1);
  expect(creationRecords(studio)).toMatchObject({ briefs: 1, quotes: 1, jobs: 0 });
  const refreshing = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/creative-briefs/prepare'),
  );
  await generate.click();
  const second = (await (await refreshing).json()).data as CreativePreparation;
  await expect(confirmation).toBeVisible();
  expect(second.id).not.toBe(first.id);
  expect(creativeInputFingerprint(second.input)).toBe(creativeInputFingerprint(first.input));
  expect(second.contextSources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'brand',
        content: expect.stringContaining('更新后的品牌说明'),
      }),
      expect.objectContaining({
        kind: 'product',
        version: 2,
        content: expect.stringContaining('容量50毫升'),
      }),
    ]),
  );
  await confirmation.getByText('本次采用的资料', { exact: true }).click();
  await expect(confirmation).toContainText('容量50毫升');
  await expect(confirmation).not.toContainText('容量30毫升');
  expect(
    studio.services.db.sqlite.prepare('SELECT * FROM creative_briefs WHERE id=?').get(first.id),
  ).toEqual(oldBrief);
  expect(
    studio.services.db.sqlite.prepare('SELECT * FROM quotes ORDER BY created_at LIMIT 1').get(),
  ).toEqual(oldQuote);
  expect(creationRecords(studio)).toMatchObject({ briefs: 2, quotes: 2, jobs: 0 });
  const accepted = await confirmDarkFlow(page);
  const completed = await waitForCreationResult(page, studio, accepted.id, account.workspace.id);
  expect(completed.input.creativeBriefId).toBe(second.id);
  expect(completed.items[0]?.referenceAssetIds).toContain(nextImage.id);
  expect(completed.items[0]?.referenceAssetIds).not.toContain(account.reference.id);
});

test('recovers an expired-source quote error with a new plan after a reload without silently calling the planner', async ({
  page,
  studio,
}) => {
  const flow = await openProductCreation(page, studio);
  let reject = true;
  // The server expiry rules have service tests; here exercise its exact UI error contract.
  await page.route('**/api/v1/quotes', async (route) => {
    if (!reject) return route.continue();
    reject = false;
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'KNOWLEDGE_CONTEXT_EXPIRED',
          message: '已保存方案引用的资料或偏好已过期，请重新整理需求。',
        },
      },
    });
  });
  await flow.generate.click();
  const restart = flow.composer.getByRole('button', { name: '重新检查', exact: true });
  await expect(restart).toBeVisible();
  const original = await flow.prompt.inputValue();
  const oldBrief = studio.services.db.sqlite.prepare('SELECT * FROM creative_briefs').get();
  studio.services.core.knowledge.updateProduct(
    flow.actor,
    flow.account.workspace.id,
    flow.product.id,
    {
      facts: ['更新后容量50毫升'],
      validUntil: '2099-01-01T00:00:00.000Z',
      expectedVersion: 1,
    },
  );
  await restart.click();
  expect(creationRecords(studio)).toMatchObject({ briefs: 1, quotes: 0, jobs: 0 });
  await page.reload();
  await expect(flow.prompt).toHaveValue(original);
  await expect(flow.generate).toBeEnabled();
  expect(creationRecords(studio)).toMatchObject({ briefs: 1, quotes: 0, jobs: 0 });
  const preparing = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/creative-briefs/prepare'),
  );
  await flow.generate.click();
  const prepared = (await (await preparing).json()).data as CreativePreparation;
  await expect(flow.confirmation).toBeVisible();
  expect(prepared.contextSources).toContainEqual(
    expect.objectContaining({
      kind: 'product',
      version: 2,
      content: expect.stringContaining('更新后容量50毫升'),
    }),
  );
  expect(
    studio.services.db.sqlite
      .prepare('SELECT * FROM creative_briefs ORDER BY created_at LIMIT 1')
      .get(),
  ).toEqual(oldBrief);
  expect(creationRecords(studio)).toMatchObject({ briefs: 2, quotes: 1, jobs: 0 });
});

test('locks source refresh during a submitted job and keeps it locked across unknown-result recovery', async ({
  page,
  studio,
}) => {
  const flow = await openProductCreation(page, studio);
  await flow.generate.click();
  await expect(flow.confirmation).toBeVisible();
  await flow.confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(flow.refresh).toBeEnabled();
  await flow.generate.click();
  await expect(flow.confirmation).toBeVisible();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready = false;
  let submittedJob: { id: string; projectId: string } | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/v1/jobs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      submittedJob = (await response.json()).data;
      ready = true;
      await barrier;
      await route.abort('failed');
    } finally {
      finish();
    }
  });
  try {
    await flow.confirmation.getByRole('button', { name: '确认并提交', exact: true }).click();
    await expect.poll(() => ready).toBe(true);
    await expect(flow.refresh).toBeDisabled();
    release();
    await finished;
    await expect(flow.composer.getByText('上次提交结果待核对', { exact: true })).toBeVisible();
    await expect(flow.refresh).toBeDisabled();
    expect(creationRecords(studio)).toMatchObject({ briefs: 1, quotes: 1, jobs: 1 });
    await page.reload();
    await expect(flow.composer.getByText('上次提交结果待核对', { exact: true })).toBeVisible();
    await expect(flow.refresh).toBeDisabled();
    await flow.composer.getByRole('button', { name: '核对提交结果', exact: true }).click();
    await expect(page).toHaveURL(
      `${studio.origin}/workbench/${submittedJob!.projectId}?job=${submittedJob!.id}`,
    );
    expect(creationRecords(studio)).toMatchObject({ briefs: 1, quotes: 1, jobs: 1 });
  } finally {
    release();
    if (ready) await finished;
  }
});

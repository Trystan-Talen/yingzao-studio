import { join } from 'node:path';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import type { CapabilitiesDto, JobDto, QuoteDto } from '../../src/contracts/jobs';
import { test, expect, type Studio } from './fixtures';
import {
  creationRecords,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  openCreationRedesign,
  saveAndVerifyCreationOriginal,
  waitForCreationResult,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

async function capabilities(page: Page, studio: Studio, workspaceId: string) {
  const response = await page.request.get(`${studio.origin}/api/v1/capabilities`, {
    headers: { 'x-workspace-id': workspaceId },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data as CapabilitiesDto;
}

async function confirm(page: Page) {
  const response = page.waitForResponse(
    (item) => item.request().method() === 'POST' && new URL(item.url()).pathname === '/api/v1/jobs',
  );
  await page
    .getByRole('dialog', { name: '确认创作', exact: true })
    .getByRole('button', { name: '确认并提交', exact: true })
    .click();
  const accepted = await response;
  expect(accepted.status()).toBe(202);
  return (await accepted.json()).data as JobDto;
}

for (const path of ['/', '/workbench?kind=image']) {
  test(`shows a numeric first-screen estimate with empty input at ${path}, and collapses settings without writes`, async ({
    page,
    studio,
  }) => {
    const { account, composer, prompt, writes } = await openCreationRedesign(page, studio, {
      path,
    });
    const caps = await capabilities(page, studio, account.workspace.id);
    const rate = caps.operations.find(
      (item) => item.id === 'image.generate' && item.providerId === 'openai',
    )!;
    const estimate = composer.locator('.credit-estimate');
    await expect(estimate).toContainText(`预计 ${rate.priceCredits} 积分`);
    await expect(prompt).toHaveValue('');
    await expectInsideViewport(estimate, page);
    await expectInsideViewport(
      composer.getByRole('button', { name: '生成图片', exact: true }),
      page,
    );
    await expect(page.getByRole('dialog', { name: '创作设置', exact: true })).toHaveCount(0);
    const platform = composer.getByRole('combobox', { name: '发布平台', exact: true });
    expect(
      await platform
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    ).toEqual(['通用电商', 'Amazon', 'TikTok', '抖音', '小红书', '淘宝']);
    await platform.selectOption('TikTok');
    await prompt.fill('窗边青绿色香氛瓶，保留我的原话。');
    await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
    await expect(settings).toBeVisible();
    await settings.getByRole('combobox', { name: '比例', exact: true }).selectOption('3:4');
    await expectNoHorizontalOverflow(page);
    await settings.getByRole('button', { name: '完成', exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(platform).toHaveValue('TikTok');
    await expect(prompt).toHaveValue('窗边青绿色香氛瓶，保留我的原话。');
    await expect(composer.getByRole('button', { name: '更多创作设置', exact: true })).toContainText(
      '3:4',
    );
    await expectNoHorizontalOverflow(page);
    expect(writes).toEqual([]);
    expect(creationRecords(studio)).toEqual({
      briefs: 0,
      projects: 0,
      quotes: 0,
      jobs: 0,
      reserved: 0,
      settled: 0,
    });
    await page.screenshot({
      path: join(studio.folder, 'empty-cost-and-collapsed-settings.png'),
      fullPage: true,
    });
  });
}

test.describe('multi-image estimates', () => {
  test.use({ experienceImageGateway: false });
  test('uses the current server rate and selected image count without preparing a billable quote', async ({
    page,
    studio,
  }) => {
    const { account, composer, writes } = await openCreationRedesign(page, studio);
    const caps = await capabilities(page, studio, account.workspace.id);
    const rate = caps.operations.find(
      (item) => item.id === 'image.generate' && item.providerId === 'openai',
    )!;
    await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
    await settings
      .getByRole('combobox', { name: '生成模型', exact: true })
      .selectOption('image.generate|openai|gpt-image-2.5-flare');
    const count = settings.getByRole('combobox', { name: '生成数量', exact: true });
    await expect(count).toBeEnabled();
    await count.selectOption('2');
    await expect(composer.locator('.credit-estimate-value')).toHaveText(
      `预计 ${rate.priceCredits * 2} 积分`,
    );
    await count.selectOption('1');
    await expect(composer.locator('.credit-estimate-value')).toHaveText(
      `预计 ${rate.priceCredits} 积分`,
    );
    expect(writes).toEqual([]);
    expect(creationRecords(studio)).toMatchObject({ briefs: 0, quotes: 0, jobs: 0, reserved: 0 });
  });
});

test('shows an unresolved capability as pending and an invalid rate as unknown, never as zero', async ({
  page,
  studio,
}) => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => (release = resolve));
  let modelReads = 0;
  await page.route('**/api/v1/capabilities/model?*', async (route) => {
    const response = await route.fetch();
    modelReads++;
    await barrier;
    await route.fulfill({ response });
  });
  const { composer, writes } = await openCreationRedesign(page, studio);
  try {
    await expect.poll(() => modelReads).toBeGreaterThan(0);
    await expect(composer.locator('.credit-estimate-value')).toHaveText('积分待核对');
    await expect(composer.locator('.credit-estimate-value')).not.toContainText('0');
  } finally {
    release();
  }
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/^预计 \d+ 积分$/);
  await page.route('**/api/v1/capabilities', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: CapabilitiesDto };
    for (const operation of body.data.operations)
      if (operation.id === 'image.generate' && operation.providerId === 'openai')
        operation.priceCredits = -1;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(composer.locator('.credit-estimate-value')).toHaveText('积分暂无法预估');
  expect(writes).toEqual([]);
  expect(creationRecords(studio)).toMatchObject({ briefs: 0, quotes: 0, jobs: 0, reserved: 0 });
});

test('warns about a stale low balance without bypassing or blocking the authoritative quote', async ({
  page,
  studio,
}) => {
  await page.route('**/api/v1/credits', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.available = 0;
    await route.fulfill({ response, json: body });
  });
  const { composer, prompt } = await openCreationRedesign(page, studio);
  await expect(composer.locator('.credit-estimate-warning')).toHaveText('可用 0 积分，可能不足');
  await prompt.fill('清晨窗边的青绿色香氛概念瓶，无文字。');
  const generate = composer.getByRole('button', { name: '生成图片', exact: true });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(creationRecords(studio)).toMatchObject({ quotes: 1, jobs: 0, reserved: 0, settled: 0 });
});

test('keeps the real local clarification chain free of quotes and tasks until the answer is complete', async ({
  page,
  studio,
}) => {
  const { composer, prompt, writes } = await openCreationRedesign(page, studio, {
    path: '/workbench?kind=image',
  });
  const original = '帮我做个高级一点';
  await prompt.fill(original);
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const brief = page.getByRole('region', { name: '创作需求检查', exact: true });
  await expect(brief.getByRole('heading', { name: '确认这一点', exact: true })).toBeVisible();
  const next = composer.getByRole('button', { name: '补充完成，继续', exact: true });
  await next.click();
  await expect(brief.getByRole('alert')).toHaveText('请先回答这一题。');
  const answer = brief.getByRole('textbox', { name: '画面里主要展示什么？', exact: true });
  await expect(answer).toBeFocused();
  expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(1);
  expect(creationRecords(studio)).toMatchObject({ briefs: 1, quotes: 0, jobs: 0, reserved: 0 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, 'clarification-missing-answer.png'),
    fullPage: true,
  });
  await answer.fill('青绿色磨砂香氛瓶，明亮窗边，保持完整轮廓。');
  await next.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(2);
  expect(creationRecords(studio)).toMatchObject({ briefs: 2, quotes: 1, jobs: 0, reserved: 0 });
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(prompt).toHaveValue(original);
  await expect(brief.getByText('需求已整理，查看详情', { exact: true })).toBeVisible();
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(2);
  expect(creationRecords(studio)).toMatchObject({ jobs: 0, reserved: 0, settled: 0 });
});

test('confirms a compact authoritative image quote once and retains the exact generated original', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openCreationRedesign(page, studio, {
    path: '/workbench?kind=image',
  });
  const original = '植物精华瓶的浅绿窗边主图，干净背景，不加文字。';
  await prompt.fill(original);
  const quoting = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/quotes',
  );
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const quoted = await quoting;
  expect(quoted.status()).toBe(200);
  const quote = (await quoted.json()).data as QuoteDto;
  const dialog = page.getByRole('dialog', { name: '确认创作', exact: true });
  const summary = dialog.getByRole('region', { name: '本次创作确认', exact: true });
  await expect(summary).toBeVisible();
  await expect(summary.locator('.media-quote-price strong')).toHaveText(String(quote.maxCredits));
  await expect(dialog.locator('.media-quote-details')).not.toHaveAttribute('open');
  await expect(dialog.locator('.detail-list')).toBeHidden();
  await expectInsideViewport(summary, page);
  await expectInsideViewport(dialog.getByRole('button', { name: '确认并提交', exact: true }), page);
  await expectNoHorizontalOverflow(page);
  expect(creationRecords(studio)).toMatchObject({
    briefs: 1,
    quotes: 1,
    jobs: 0,
    reserved: 0,
    settled: 0,
  });
  await page.screenshot({ path: join(studio.folder, 'compact-confirmation.png'), fullPage: true });
  await dialog.getByText('查看详细配置与计费', { exact: true }).click();
  await expect(dialog.locator('.detail-list')).toBeVisible();
  await expect(dialog.locator('.detail-list')).toContainText('预留额度上限');
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(prompt).toHaveValue(original);
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(1);
  const accepted = await confirm(page);
  const completed = await waitForCreationResult(page, studio, accepted.id, account.workspace.id);
  expect(completed.input.options).toMatchObject({ ratio: '1:1', resolution: '2K', count: 1 });
  expect(completed.projectId).toBeTruthy();
  const asset = completed.outputAssets[0]!;
  await page.reload();
  const task = page.locator('.focused-task');
  await expect(task.getByRole('img', { name: asset.name, exact: true })).toBeVisible();
  const downloaded = await saveAndVerifyCreationOriginal(
    page,
    studio,
    task.getByRole('button', { name: '下载原件', exact: true }),
    asset,
    'redesign-image.png',
  );
  expect(await sharp(downloaded).metadata()).toMatchObject({
    format: 'png',
    width: 960,
    height: 960,
  });
  expect(creationRecords(studio)).toMatchObject({ jobs: 1, reserved: 1, settled: 1 });
  expect(writes.filter((path) => path === '/api/v1/jobs')).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
});

test('updates video seconds pricing and creates one playable saved vertical original', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openCreationRedesign(page, studio, {
    path: '/workbench?kind=video',
  });
  const caps = await capabilities(page, studio, account.workspace.id);
  const rate = caps.operations.find(
    (item) => item.id === 'video.generate' && item.providerId === 'seedance',
  )!;
  expect(rate.unit).toBe('second');
  await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await settings
    .getByRole('combobox', { name: '生成模型', exact: true })
    .selectOption('video.generate|seedance|doubao-seedance-2.0');
  const duration = settings.getByRole('combobox', { name: '时长', exact: true });
  await duration.selectOption('10');
  await expect(composer.locator('.credit-estimate-value')).toHaveText(
    `预计 ${rate.priceCredits * 10} 积分`,
  );
  await duration.selectOption('5');
  await settings.getByRole('combobox', { name: '比例', exact: true }).selectOption('9:16');
  await expect(composer.locator('.credit-estimate-value')).toHaveText(
    `预计 ${rate.priceCredits * 5} 积分`,
  );
  expect(writes).toEqual([]);
  expect(creationRecords(studio)).toMatchObject({ briefs: 0, quotes: 0, jobs: 0, reserved: 0 });
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await prompt.fill('清晨窗边青绿色香氛瓶概念片，无人物文字，固定机位。');
  await composer.getByRole('button', { name: '生成视频', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(dialog.locator('.media-quote-specs')).toContainText('9:16');
  await expect(dialog.locator('.media-quote-specs')).toContainText('5 秒');
  await expect(dialog.locator('.media-quote-price strong')).toHaveText(
    String(rate.priceCredits * 5),
  );
  const accepted = await confirm(page);
  const completed = await waitForCreationResult(page, studio, accepted.id, account.workspace.id);
  const asset = completed.outputAssets[0]!;
  expect(asset).toMatchObject({ kind: 'video', width: 720, height: 1280, durationMs: 5000 });
  await page.reload();
  const task = page.locator('.focused-task');
  const video = task.locator('video');
  await expect(video).toHaveAttribute('src', asset.originalUrl);
  await expect.poll(() => video.evaluate((item: HTMLVideoElement) => item.duration)).toBe(5);
  await video.evaluate(async (item: HTMLVideoElement) => {
    item.muted = true;
    await item.play();
  });
  await expect
    .poll(() => video.evaluate((item: HTMLVideoElement) => item.currentTime))
    .toBeGreaterThan(0.2);
  await video.evaluate((item: HTMLVideoElement) => item.pause());
  await saveAndVerifyCreationOriginal(
    page,
    studio,
    task.getByRole('button', { name: '下载原件', exact: true }),
    asset,
    'redesign-video.mp4',
  );
  expect(creationRecords(studio)).toMatchObject({ jobs: 1, reserved: 1, settled: 1 });
  expect(writes.filter((path) => path === '/api/v1/jobs')).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
});

test('honors the existing no-confirmation preference without duplicate generation', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openCreationRedesign(page, studio, {
    confirm: false,
  });
  await prompt.fill('浅色窗边的植物精华概念主图。');
  const creating = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/jobs',
  );
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const response = await creating;
  expect(response.status()).toBe(202);
  const job = (await response.json()).data as JobDto;
  await waitForCreationResult(page, studio, job.id, account.workspace.id);
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toHaveCount(0);
  expect(writes.filter((path) => path === '/api/v1/creative-briefs/prepare')).toHaveLength(1);
  expect(writes.filter((path) => path === '/api/v1/quotes')).toHaveLength(1);
  expect(writes.filter((path) => path === '/api/v1/jobs')).toHaveLength(1);
  expect(creationRecords(studio)).toMatchObject({ jobs: 1, reserved: 1, settled: 1 });
});

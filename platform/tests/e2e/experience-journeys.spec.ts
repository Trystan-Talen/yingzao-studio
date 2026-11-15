import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import sharp from 'sharp';
import JSZip from 'jszip';
import type { JobDto } from '../../src/contracts/jobs';
import { test, expect, type Studio } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

async function openExperience(page: Page, studio: Studio) {
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
  return { ...account, headers: { 'x-workspace-id': account.workspace.id } };
}

async function openSettings(page: Page) {
  await page
    .locator('.composer')
    .getByRole('button', { name: '更多创作设置', exact: true })
    .click();
  return page.getByRole('dialog', { name: '创作设置', exact: true });
}

async function openAssistant(page: Page) {
  const settings = await openSettings(page);
  await settings.getByText('更多偏好', { exact: true }).click();
  await settings.getByRole('button', { name: 'AI 帮我写', exact: true }).click();
}

async function confirmSubmission(page: Page) {
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(confirmation).toBeVisible();
  if (await confirmation.locator('.media-quote-price').count())
    await expect(confirmation.locator('.media-quote-price')).toBeVisible();
  else await expect(confirmation.getByText('预留额度上限', { exact: true })).toBeVisible();
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/jobs',
  );
  await confirmation.getByRole('button', { name: '确认并提交', exact: true }).click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  await expect(confirmation).toBeHidden();
  return (await response.json()).data as JobDto;
}

async function completedJob(page: Page, studio: Studio, id: string, workspaceId: string) {
  const read = async () => {
    const response = await page.request.get(`${studio.origin}/api/v1/jobs/${id}`, {
      headers: { 'x-workspace-id': workspaceId },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data as JobDto;
  };
  await expect.poll(async () => (await read()).status, { timeout: 30000 }).toBe('succeeded');
  return read();
}

const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

test('explains the planning service input limit, preserves all text and accepts the exact boundary without submitting', async ({
  page,
  studio,
}) => {
  await openExperience(page, studio);
  await openAssistant(page);
  const assistant = page.getByRole('dialog', { name: 'AI 创作助手', exact: true });
  await assistant.getByRole('combobox', { name: '文案服务', exact: true }).selectOption('dify');
  const request = assistant.getByRole('textbox', { name: '你的需求', exact: true });
  const generate = assistant.getByRole('button', { name: '生成创作建议', exact: true });
  const oversized = '试'.repeat(8001);
  await request.fill(oversized);
  await expect(request).toHaveValue(oversized);
  expect(await request.getAttribute('maxlength')).toBeNull();
  await expect(request).toHaveAttribute('aria-invalid', 'true');
  await expect(assistant.getByText('8001 / 8000 字符', { exact: true })).toBeVisible();
  await expect(assistant.getByRole('alert')).toContainText('已超出 1 个');
  await expect(assistant.getByRole('alert')).toContainText('现有内容已完整保留');
  await expect(generate).toBeDisabled();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  const boundary = oversized.slice(0, 8000);
  await request.fill(boundary);
  await expect(request).not.toHaveAttribute('aria-invalid', 'true');
  await expect(assistant.getByRole('alert')).toHaveCount(0);
  await expect(assistant.getByText('8000 / 8000 字符', { exact: true })).toBeVisible();
  await expect(generate).toBeEnabled();
  await generate.click();
  const quote = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(quote).toBeVisible();
  await quote.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(quote).toBeHidden();
  await expect(request).toHaveValue(boundary);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  await page.screenshot({
    path: join(studio.folder, 'planning-input-boundary.png'),
    fullPage: true,
  });
});

test.describe('native text planning capabilities', () => {
  test.use({ experienceImageGateway: false });
  test('generates a design plan, applies an edited direction and preserves it without automatically generating an image', async ({
    page,
    studio,
  }) => {
    const account = await openExperience(page, studio);
    const composer = page.locator('.composer');
    const brief = composer.getByRole('textbox', { name: '创作需求', exact: true });
    await brief.fill('植物精华主图，透明瓶身，自然浅绿色背景。');
    await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
    const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect(composer).not.toHaveAttribute('data-presentation', 'quick');
    await openAssistant(page);
    const assistant = page.getByRole('dialog', { name: 'AI 创作助手', exact: true });
    await assistant.getByRole('button', { name: '完整设计方案', exact: true }).click();
    await assistant.getByRole('button', { name: '生成设计方案', exact: true }).click();
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    const accepted = await confirmSubmission(page);
    const completed = await completedJob(page, studio, accepted.id, account.workspace.id);
    expect(completed.input).toMatchObject({ operation: 'text.assist', projectId });
    expect(completed.items[0]?.resultData).toMatchObject({ type: 'design-plan', version: 1 });
    const directions = assistant.locator('.plan-direction');
    await expect(directions).toHaveCount(3);
    await assistant.getByRole('radio', { name: '方向 2', exact: true }).check();
    const revised = '微距展示植物精华瓶身与水滴，绿色背景，保持透明瓶形和白色泵头。';
    await assistant.getByRole('textbox', { name: '方向 2 画面要求', exact: true }).fill(revised);
    await assistant.getByRole('button', { name: '应用方向 2 到创作', exact: true }).click();
    await expect(assistant).toBeHidden();
    await expect.poll(() => brief.inputValue()).toContain(revised);
    const adopted = await brief.inputValue();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/projects/${projectId}/messages`,
    );
    await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(brief).toHaveValue(adopted);
    const rows = studio.services.db.sqlite
      .prepare('SELECT operation,status FROM jobs WHERE project_id=?')
      .all(projectId);
    expect(rows).toEqual([{ operation: 'text.assist', status: 'succeeded' }]);
    await page.screenshot({
      path: join(studio.folder, 'design-direction-adopted.png'),
      fullPage: true,
    });
  });
});

test('creates an image from the home entry, preserves its task after refresh and downloads the saved original', async ({
  page,
  studio,
}) => {
  const account = await openExperience(page, studio);
  await expect(page).toHaveURL(`${studio.origin}/?kind=image`);
  const composer = page.locator('.composer');
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('植物精华主图，浅绿色背景，自然晨光。');
  await openAssistant(page);
  const assistant = page.getByRole('dialog', { name: 'AI 创作助手', exact: true });
  await expect(assistant.getByText('完整设计方案暂不可用', { exact: false })).toBeVisible();
  await expect(assistant.getByRole('button', { name: '完整设计方案', exact: true })).toBeDisabled();
  await expect(assistant.getByRole('button', { name: '生成创作建议', exact: true })).toBeEnabled();
  const textService = assistant.getByRole('combobox', { name: '文案服务', exact: true });
  await textService.selectOption('dify');
  await expect(textService).toHaveValue('dify');
  await assistant.getByRole('button', { name: '关闭', exact: true }).click();
  const settings = await openSettings(page);
  await expect(settings.getByRole('combobox', { name: '生成模型', exact: true })).toHaveValue(
    'image.generate|openai|doubao-seedream-5.0-lite',
  );
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  const accepted = await confirmSubmission(page);
  await expect(page).toHaveURL(
    new RegExp(`/workbench/${accepted.projectId}\\?job=${accepted.id}$`),
  );
  const completed = await completedJob(page, studio, accepted.id, account.workspace.id);
  expect(completed.outputAssets).toHaveLength(1);
  const asset = completed.outputAssets[0]!;
  expect(asset).toMatchObject({ kind: 'image', width: 960, height: 960 });
  const card = page.locator('.focused-task .job-card');
  await expect(card.getByRole('img', { name: asset.name, exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByRole('img', { name: asset.name, exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await card.getByRole('button', { name: '下载原件', exact: true }).click();
  const downloadPath = join(studio.folder, 'image-original.png');
  await (await downloading).saveAs(downloadPath);
  const downloaded = await readFile(downloadPath);
  const original = await page.request.get(new URL(asset.originalUrl, studio.origin).toString());
  expect(original.status()).toBe(200);
  expect(digest(downloaded)).toBe(digest(await original.body()));
  expect(await sharp(downloaded).metadata()).toMatchObject({
    width: 960,
    height: 960,
    format: 'png',
  });
  await page.screenshot({ path: join(studio.folder, 'image-complete.png'), fullPage: true });
  await page.goto(`${studio.origin}/tasks`);
  await expect(page.locator('.task-list .job-card, .task-list .task-card').first()).toBeVisible();
  await page.getByRole('link', { name: '查看作品', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`job=${accepted.id}$`));
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
  await writeFile(
    join(studio.folder, 'image-journey.json'),
    JSON.stringify(
      {
        simulated: true,
        jobId: accepted.id,
        assetId: asset.id,
        sha256: digest(downloaded),
        downloadedBytes: downloaded.length,
      },
      null,
      2,
    ),
  );
});

test('creates a video, plays the saved media and restores the same output after refresh', async ({
  page,
  studio,
}) => {
  const account = await openExperience(page, studio);
  const composer = page.locator('.composer');
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await expect(page).toHaveURL(`${studio.origin}/?kind=video`);
  await expect(composer.getByRole('button', { name: '视频创作', exact: true })).toHaveClass(
    /active/,
  );
  const settings = await openSettings(page);
  const models = settings.getByRole('combobox', { name: '生成模型', exact: true });
  const option = await models
    .locator('option[value^="video.generate|seedance|"]')
    .first()
    .getAttribute('value');
  expect(option).toBeTruthy();
  await models.selectOption(option!);
  await settings.getByRole('combobox', { name: '比例', exact: true }).selectOption('9:16');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('植物精华短片，镜头缓缓推进，突出瓶身质感。');
  await composer.getByRole('button', { name: '生成视频', exact: true }).click();
  const accepted = await confirmSubmission(page);
  const completed = await completedJob(page, studio, accepted.id, account.workspace.id);
  expect(completed.outputAssets).toHaveLength(1);
  const asset = completed.outputAssets[0]!;
  expect(asset).toMatchObject({ kind: 'video', width: 720, height: 1280, durationMs: 5000 });
  const video = page.locator('.focused-task .creation-media video');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
    .toBe(720);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.2);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.reload();
  await expect(video).toHaveAttribute('src', asset.originalUrl);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration)).toBe(5);
  const downloading = page.waitForEvent('download');
  await page
    .locator('.focused-task')
    .getByRole('button', { name: '下载原件', exact: true })
    .click();
  const downloadPath = join(studio.folder, 'video-original.mp4');
  await (await downloading).saveAs(downloadPath);
  const original = await page.request.get(new URL(asset.originalUrl, studio.origin).toString());
  expect(digest(await readFile(downloadPath))).toBe(digest(await original.body()));
  await page.screenshot({ path: join(studio.folder, 'video-complete.png'), fullPage: true });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
});

test('plans six detail-page screens, confirms the edited plan and exports matching originals plus a long image', async ({
  page,
  studio,
}) => {
  test.setTimeout(90000);
  const account = await openExperience(page, studio);
  await page
    .getByRole('group', { name: '创作方向', exact: true })
    .getByRole('link', { name: /商品详情页/ })
    .click();
  const brief = page.getByRole('textbox', { name: /^商品信息与创作要求/ });
  await brief.fill('植物精华，透明瓶身和白色泵头，面向日常护肤人群，浅绿自然光风格。');
  const referencePane = page.locator('.detail-reference-pane');
  await referencePane.getByRole('button', { name: '添加素材', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '上传商品图片', exact: true });
  await picker.getByRole('button', { name: /示例植物精华\.webp/ }).click();
  await picker.getByRole('button', { name: '完成选择', exact: true }).click();
  await expect(referencePane.locator('.asset-chip')).toHaveCount(1);
  await page.getByRole('button', { name: '开始整套策划', exact: true }).click();
  const planning = await confirmSubmission(page);
  const planningResult = await completedJob(page, studio, planning.id, account.workspace.id);
  expect(planningResult.items[0]?.resultData?.type).toBe('detail-page-plan');
  const flow = page.getByRole('navigation', { name: '详情页创作流程', exact: true });
  await expect(flow.getByRole('button', { name: /确认方案/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
  const index = page.getByRole('navigation', { name: '选择要编辑的分屏', exact: true });
  await expect(index.getByRole('button')).toHaveCount(6);
  await expect(page.getByRole('button', { name: '继续，确认生成', exact: true })).toBeDisabled();
  await page
    .locator('.detail-screen-editor')
    .getByRole('textbox', { name: /^分屏标题/ })
    .fill('晨光中的植物精华');
  for (let screen = 0; screen < 6; screen++) {
    await expect(page.locator('.detail-screen-editor')).toHaveCount(1);
    await page
      .getByRole('button', { name: screen === 5 ? '确认本屏' : '确认本屏，下一屏', exact: true })
      .click();
  }
  await page
    .getByRole('checkbox', {
      name: '我已核对商品事实、文案和待确认信息，可用于本次生成。',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '继续，确认生成', exact: true }).click();
  await expect(flow.getByRole('button', { name: /生成与导出/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(page.locator('.detail-review-screens')).toContainText('晨光中的植物精华');
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
  await page.getByRole('button', { name: '确认 6 屏报价', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '确认创作', exact: true }).locator('ol li'),
  ).toHaveCount(6);
  const generation = await confirmSubmission(page);
  const result = await completedJob(page, studio, generation.id, account.workspace.id);
  expect(result.items).toHaveLength(6);
  expect(result.outputAssets).toHaveLength(6);
  expect(result.input.options.detailPagePlan?.screens[0]?.title).toBe('晨光中的植物精华');
  expect(result.input.referenceAssetIds).toEqual([account.reference.id]);
  await expect(page.getByRole('heading', { name: '整套详情页已就绪', exact: true })).toBeVisible();
  const images = page.locator('.detail-result-image img');
  const expectedSources = result.outputAssets
    .map((asset) => asset.previewUrl ?? asset.originalUrl)
    .sort();
  expect(new Set(expectedSources).size).toBe(6);
  async function verifyScreenImages() {
    await expect(images).toHaveCount(6);
    expect(
      await images.evaluateAll((items) => items.map((item) => item.getAttribute('src')).sort()),
    ).toEqual(expectedSources);
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate(
            (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
  }
  await verifyScreenImages();
  await page.reload();
  await verifyScreenImages();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载整套详情页', exact: true }).click();
  const path = join(studio.folder, 'detail-page-complete.zip');
  await (await downloading).saveAs(path);
  const archive = await JSZip.loadAsync(await readFile(path));
  const manifest = JSON.parse(
    await archive.file(`${generation.id}/detail-page-manifest.json`)!.async('string'),
  ) as {
    complete: boolean;
    screens: { assetId: string; file: string; title: string }[];
    longImage: { file: string; width: number; height: number };
  };
  expect(manifest.complete).toBe(true);
  expect(manifest.screens).toHaveLength(6);
  expect(manifest.screens[0]?.title).toBe('晨光中的植物精华');
  for (const screen of manifest.screens) {
    const asset = result.outputAssets.find((item) => item.id === screen.assetId)!;
    const original = await page.request.get(new URL(asset.originalUrl, studio.origin).toString());
    const exported = await archive.file(`${generation.id}/${screen.file}`)!.async('nodebuffer');
    expect(digest(exported)).toBe(digest(await original.body()));
    expect(await sharp(exported).metadata()).toMatchObject({ width: 960, height: 1280 });
  }
  expect(manifest.longImage).toMatchObject({ width: 750, height: 6000 });
  const longImage = await archive
    .file(`${generation.id}/${manifest.longImage.file}`)!
    .async('nodebuffer');
  expect(await sharp(longImage).metadata()).toMatchObject({
    width: 750,
    height: 6000,
    format: 'jpeg',
  });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 2 });
  await page.screenshot({ path: join(studio.folder, 'detail-complete.png'), fullPage: true });
  await writeFile(
    join(studio.folder, 'detail-journey.json'),
    JSON.stringify(
      {
        simulated: true,
        planningJobId: planning.id,
        generationJobId: generation.id,
        screenCount: manifest.screens.length,
        longImage: manifest.longImage,
      },
      null,
      2,
    ),
  );
});

test('keeps a failed attempt visible and creates exactly one separately confirmed retry', async ({
  page,
  studio,
}) => {
  const account = await openExperience(page, studio);
  await page
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('模拟首次失败：植物精华商品主图。');
  await page.getByRole('button', { name: '生成图片', exact: true }).click();
  const first = await confirmSubmission(page);
  await expect
    .poll(() =>
      studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(first.id),
    )
    .toEqual({ status: 'failed' });
  const focused = page.locator('.focused-task');
  await expect(focused).toContainText('本机模拟首次失败');
  await focused.getByRole('button', { name: '为可重试项重新估价', exact: true }).click();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
  const retry = await confirmSubmission(page);
  const completed = await completedJob(page, studio, retry.id, account.workspace.id);
  expect(completed.outputAssets).toHaveLength(1);
  expect(retry.id).not.toBe(first.id);
  expect(
    studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(first.id),
  ).toEqual({ status: 'failed' });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 2 });
  await page.goto(`${studio.origin}/tasks`);
  await expect(page.locator('.job-card')).toHaveCount(2);
  await expect(page.locator('.job-card').filter({ hasText: '本机模拟首次失败' })).toHaveCount(1);
  await page.screenshot({
    path: join(studio.folder, 'failed-attempt-and-retry.png'),
    fullPage: true,
  });
});

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false });

async function register(page: Page, studio: Studio) {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('Composer media owner');
  await page.getByLabel('邮箱', { exact: true }).fill('composer-media@example.test');
  await page.getByLabel(/^密码/).fill('ComposerMediaPassword2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '欢迎来到映造' })).toHaveCount(0);
  const response = await page.request.get(`${studio.origin}/api/v1/auth/me`);
  expect(response.status()).toBe(200);
  return {
    origin: studio.origin,
    'x-workspace-id': (await response.json()).data.activeWorkspaceId as string,
  };
}

test('persists real background music and the generated audio choice across save, model changes and refresh', async ({
  page,
  studio,
}) => {
  const headers = await register(page, studio);
  await page.goto(`${studio.origin}/workbench`);
  const composer = page.locator('.composer');
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  const picker = composer
    .locator('.asset-picker')
    .filter({ has: page.getByText('背景音乐（可选）', { exact: true }) });
  const file = join(studio.folder, 'background.wav');
  await promisify(execFile)('ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:duration=5',
    '-c:a',
    'pcm_s16le',
    '-y',
    file,
  ]);
  await picker.locator('input[type=file]').setInputFiles(file);
  await expect(picker.locator('.asset-chip')).toContainText('background.wav');
  await composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('保留独立背景音乐的本机浏览器验收');
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(picker.locator('.asset-chip')).toContainText('background.wav');
  await composer.getByRole('button', { name: '模型与高级设置', exact: true }).click();
  await composer
    .getByRole('combobox', { name: '生成模型', exact: true })
    .selectOption('kling-o3-4k-reference');
  await expect(
    composer.getByText('当前模型不支持背景音乐。原音频已保留，请移除音频或切换支持的模型后提交。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(picker.locator('.asset-chip')).toContainText('background.wav');
  const sound = composer.getByRole('checkbox', { name: '生成视频音轨', exact: true });
  await sound.check();
  await picker.getByRole('button', { name: '移除background.wav', exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/projects\/[0-9a-f-]+\/messages$/.test(new URL(response.url()).pathname),
  );
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(sound).toBeChecked();
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  const response = await page.request.get(
    `${studio.origin}/api/v1/projects/${projectId}/messages?pageSize=100`,
    { headers },
  );
  expect(response.status()).toBe(200);
  const drafts = (await response.json()).data.items
    .map(
      (entry: {
        metadata?: {
          draft?: { backgroundAudioAssetId?: string; options: { generateAudio?: boolean } };
        };
      }) => entry.metadata?.draft,
    )
    .filter(Boolean);
  expect(
    drafts.some((draft: { backgroundAudioAssetId?: string }) => !!draft.backgroundAudioAssetId),
  ).toBe(true);
  expect(
    drafts.some(
      (draft: { backgroundAudioAssetId?: string; options: { generateAudio?: boolean } }) =>
        draft.options.generateAudio === true && !draft.backgroundAudioAssetId,
    ),
  ).toBe(true);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  await page.screenshot({
    path: join(studio.folder, 'composer-audio-restored.png'),
    fullPage: true,
  });
});

test('returns an actual local output to the project composer without replacing the current prompt or submitting a second job', async ({
  page,
  studio,
}) => {
  const headers = await register(page, studio);
  await page.goto(`${studio.origin}/workbench`);
  const composer = page.locator('.composer');
  const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  const text = '保留当前未提交需求，并将刚完成的本机输出加入参考。';
  await prompt.fill(text);
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  const source = await sharp({
    create: { width: 120, height: 80, channels: 4, background: '#2846a5' },
  })
    .png()
    .toBuffer();
  const upload = await page.request.post(`${studio.origin}/api/v1/assets/upload`, {
    headers,
    multipart: {
      projectId,
      file: { name: 'local-result-input.png', mimeType: 'image/png', buffer: source },
    },
  });
  expect(upload.status()).toBe(201);
  const asset = (await upload.json()).data;
  const input = {
    operation: 'local.resize',
    providerId: 'local',
    projectId,
    assetIds: [asset.id],
    options: { width: 48, height: 32 },
  };
  const quote = await page.request.post(`${studio.origin}/api/v1/quotes`, { headers, data: input });
  expect(quote.status()).toBe(200);
  const submit = await page.request.post(`${studio.origin}/api/v1/jobs`, {
    headers,
    data: { input, quoteId: (await quote.json()).data.id, clientRequestId: randomUUID() },
  });
  expect(submit.status()).toBe(202);
  const jobId = (await submit.json()).data.id;
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${studio.origin}/api/v1/jobs/${jobId}`, { headers })
          ).json()
        ).data.status,
    )
    .toBe('succeeded');
  const job = (
    await (await page.request.get(`${studio.origin}/api/v1/jobs/${jobId}`, { headers })).json()
  ).data;
  expect(job.outputAssets).toHaveLength(1);
  const result = job.outputAssets[0];
  expect({ width: result.width, height: result.height }).toEqual({ width: 48, height: 32 });
  await page.reload();
  await expect(prompt).toHaveValue(text);
  await page.locator('.job-card').getByRole('button', { name: '查看详情', exact: true }).click();
  await page.getByRole('button', { name: '作为参考继续创作', exact: true }).click();
  await expect(prompt).toHaveValue(text);
  const reference = composer
    .locator('.composer-materials .asset-chip')
    .filter({ hasText: result.name });
  await expect(reference).toHaveCount(1);
  await expect(reference.locator('img')).toBeVisible();
  expect(
    await reference
      .locator('img')
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
  ).toBe(true);
  await page.reload();
  await expect(prompt).toHaveValue(text);
  await expect(reference).toHaveCount(1);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: join(studio.folder, 'local-output-returned.png'), fullPage: true });
});

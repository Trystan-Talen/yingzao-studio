import sharp from 'sharp';
import type { Page, Route } from '@playwright/test';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false });

async function register(page: Page, studio: Studio) {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('Creation race owner');
  await page.getByLabel('邮箱', { exact: true }).fill('creation-race@example.test');
  await page.getByLabel(/^密码/).fill('CreationRacePassword2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await expect(page.getByRole('dialog', { name: '欢迎来到映造' })).toBeVisible();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '欢迎来到映造' })).toHaveCount(0);
  const response = await page.request.get(`${studio.origin}/api/v1/auth/me`);
  expect(response.status()).toBe(200);
  const session = (await response.json()).data as {
    user: { id: string };
    activeWorkspaceId: string;
  };
  return { userId: session.user.id, workspaceId: session.activeWorkspaceId };
}

async function uploadReference(page: Page, name: string, background: string) {
  const buffer = await sharp({
    create: { width: 640, height: 480, channels: 4, background },
  })
    .png()
    .toBuffer();
  await page
    .locator('.composer input[type=file]')
    .first()
    .setInputFiles({ name, mimeType: 'image/png', buffer });
  const chip = page.locator('.composer-materials .asset-chip').filter({ hasText: name });
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('img')).toBeVisible();
  await expect(page.getByText('正在恢复参考素材，完成前暂不能提交。', { exact: true })).toHaveCount(
    0,
  );
}

for (const heldStep of ['project', 'message'] as const) {
  test(`keeps edits, both creation kinds and uploaded references while the ${heldStep} save response is delayed`, async ({
    page,
    studio,
  }) => {
    const owner = await register(page, studio);
    await page.goto(`${studio.origin}/workbench`);
    const composer = page.locator('.composer');
    const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
    await expect(prompt).toBeVisible();
    await prompt.fill('点击保存时的图片草稿；等待响应时还会继续编辑。');

    const matches = (url: URL) =>
      url.origin === studio.origin &&
      (heldStep === 'project'
        ? url.pathname === '/api/v1/projects'
        : /^\/api\/v1\/projects\/[0-9a-f-]{36}\/messages$/.test(url.pathname));
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let held = false;
    let ready = false;
    let responseStatus: number | null = null;
    let routeFailure: string | null = null;
    const handler = async (route: Route) => {
      if (route.request().method() !== 'POST' || held) {
        await route.fallback();
        return;
      }
      held = true;
      try {
        // The real isolated API commits first; only the browser's response is delayed.
        const response = await route.fetch({ timeout: 15_000, maxRedirects: 0, maxRetries: 0 });
        responseStatus = response.status();
        ready = true;
        await barrier;
        await route.fulfill({ response });
      } catch (error) {
        routeFailure = error instanceof Error ? error.message : 'Delayed response failed';
        await route.abort('failed').catch(() => undefined);
      } finally {
        finish();
      }
    };
    await page.route(matches, handler);
    try {
      await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
      await expect
        .poll(() => {
          if (routeFailure) throw new Error(routeFailure);
          return ready;
        })
        .toBe(true);
      expect(responseStatus).toBe(heldStep === 'project' ? 201 : 200);
      await expect(page).toHaveURL(`${studio.origin}/workbench`);

      const imagePrompt = '保存等待期间更新的图片需求：保留绿色包装与参考图片。';
      const videoPrompt = '保存等待期间切换到视频后的最新需求：镜头缓缓推进，保持产品外观。';
      const imageName = `${heldStep}-image-draft-reference.png`;
      const videoName = `${heldStep}-video-draft-reference.png`;
      await prompt.fill(imagePrompt);
      await uploadReference(page, imageName, '#167c44');
      await composer.getByRole('button', { name: '视频创作', exact: true }).click();
      await expect(prompt).toHaveValue('');
      await prompt.fill(videoPrompt);
      await uploadReference(page, videoName, '#264f9d');
      await expect(composer.getByRole('button', { name: '视频创作', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      const newKey = `yingzao:creation:v1:${owner.userId}:${owner.workspaceId}:new`;
      await expect
        .poll(() =>
          page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            return raw ? (JSON.parse(raw).input.prompt as string) : null;
          }, newKey),
        )
        .toBe(videoPrompt);
      release();
      await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
      const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
      const projectKey = `yingzao:creation:v1:${owner.userId}:${owner.workspaceId}:${projectId}`;
      await expect(prompt).toHaveValue(videoPrompt);
      await expect(composer.getByRole('button', { name: '视频创作', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(composer.locator('.asset-chip').filter({ hasText: videoName })).toHaveCount(1);

      const recovery = (await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        projectKey,
      )) as {
        input: { prompt: string; operation: string; projectId: string; assetIds: string[] };
        drafts: {
          image: { prompt: string; assetIds: string[] };
          video: { prompt: string; assetIds: string[] };
        };
      };
      expect(recovery.input).toMatchObject({
        prompt: videoPrompt,
        operation: 'video.generate',
        projectId,
      });
      expect(recovery.drafts.image.prompt).toBe(imagePrompt);
      expect(recovery.drafts.video.prompt).toBe(videoPrompt);
      expect(recovery.drafts.image.assetIds).toHaveLength(1);
      expect(recovery.drafts.video.assetIds).toHaveLength(1);
      expect(recovery.drafts.video.assetIds).not.toEqual(recovery.drafts.image.assetIds);
      expect(await page.evaluate((key) => localStorage.getItem(key), newKey)).toBeNull();

      await page.reload();
      await expect(prompt).toHaveValue(videoPrompt);
      await expect(composer.getByRole('button', { name: '视频创作', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(composer.locator('.asset-chip').filter({ hasText: videoName })).toHaveCount(1);
      await composer.getByRole('button', { name: '图片创作', exact: true }).click();
      await expect(prompt).toHaveValue(imagePrompt);
      await expect(composer.locator('.asset-chip').filter({ hasText: imageName })).toHaveCount(1);
      await page.reload();
      await expect(prompt).toHaveValue(imagePrompt);
      await expect(composer.getByRole('button', { name: '图片创作', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(composer.locator('.asset-chip').filter({ hasText: imageName })).toHaveCount(1);
      await composer.getByRole('button', { name: '视频创作', exact: true }).click();
      await expect(prompt).toHaveValue(videoPrompt);
      await expect(composer.locator('.asset-chip').filter({ hasText: videoName })).toHaveCount(1);

      const ids = [...recovery.drafts.image.assetIds, ...recovery.drafts.video.assetIds];
      for (const assetId of ids) {
        const asset = await page.request.get(`${studio.origin}/api/v1/assets/${assetId}`, {
          headers: { 'x-workspace-id': owner.workspaceId },
        });
        expect(asset.status()).toBe(200);
        expect((await asset.json()).data.kind).toBe('image');
      }
      expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM projects').get()).toEqual({
        n: 1,
      });
      expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
        n: 2,
      });
      expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
        n: 0,
      });
      await page.screenshot({
        path: `${studio.folder}/creation-race-${heldStep}.png`,
        fullPage: true,
      });
    } finally {
      release();
      if (held) await finished;
      await page.unroute(matches, handler);
    }
  });
}

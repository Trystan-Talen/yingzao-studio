import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test('recovers a video inspiration action-reference draft after a lost reuse response and refresh', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('视频灵感继承验收');
  await page.getByLabel('邮箱', { exact: true }).fill('inspiration-motion@example.test');
  await page.getByLabel(/^密码/).fill('VideoInspiration2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  const session = (await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json()).data,
    wid = session.activeWorkspaceId as string,
    headers = { origin: studio.origin, 'x-workspace-id': wid };
  const file = `${studio.folder}/owned-video.mp4`;
  await promisify(execFile)('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=purple:s=360x360:r=20:d=15.45',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    file,
  ]);
  const asset = await studio.services.core.assets.ingest(
    { userId: session.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    wid,
    { buffer: await readFile(file), name: '我的动作参考.mp4', mimeType: 'video/mp4' },
  );
  const created = await page.request.post(`${studio.origin}/api/v1/inspirations`, {
    headers,
    data: {
      title: '合成动作灵感',
      category: '视频独立验收',
      kind: 'video',
      tag: '本机合成',
      ratio: '1:1',
      prompt: '继承动作参考，等待补充主体',
      source: '本机合成，无第三方原件',
      assetId: asset.id,
    },
  });
  expect(created.status()).toBe(201);
  const inspiration = (await created.json()).data;
  await page.goto(studio.origin);
  await page.getByRole('button', { name: `${inspiration.title} · 以此创作`, exact: true }).click();
  const detail = page.getByRole('dialog', { name: inspiration.title, exact: true });
  await expect(detail.locator('video')).toHaveAttribute('src', /\/assets\//);
  let lost = false;
  await page.route(`**/api/v1/inspirations/${inspiration.id}/reuse`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    lost = true;
    await route.abort('failed');
  });
  await detail.getByRole('button', { name: '进入视频复刻', exact: true }).click();
  await expect.poll(() => lost).toBe(true);
  await expect(page.getByRole('button', { name: '继续上次灵感复用', exact: true })).toBeVisible();
  await page.unroute(`**/api/v1/inspirations/${inspiration.id}/reuse`);
  await page.reload();
  await page.getByRole('button', { name: '继续上次灵感复用', exact: true }).click();
  await expect(page).toHaveURL(/\/tools\/video-replica\?projectId=[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).searchParams.get('projectId')!;
  const assertDraft = async () => {
    await expect(page.getByLabel('创作说明', { exact: false })).toHaveValue(
      '继承动作参考，等待补充主体',
    );
    await expect(page.locator('.asset-chip')).toHaveCount(1);
    await expect(page.locator('.asset-chip')).toContainText('我的动作参考.mp4');
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(
      'kling-2.6-motion-standard',
    );
    await expect(page.getByRole('spinbutton', { name: '结束时间（秒）', exact: true })).toHaveValue(
      '15.45',
    );
    await expect(page.getByText(/^已继承参考视频；请补充主体图片/)).toBeVisible();
    await expect(page.getByRole('button', { name: '开始处理', exact: true })).toBeDisabled();
  };
  await assertDraft();
  await page.reload();
  await assertDraft();
  await page.getByRole('button', { name: '保存为项目', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workbench/${projectId}$`));
  await page.getByRole('link', { name: '继续编辑工具草稿 ↗', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tools/video-replica\\?projectId=${projectId}$`));
  await assertDraft();
  await page.getByRole('button', { name: '已核对，保留当前设置', exact: true }).click();
  await page.getByRole('button', { name: '保存为项目', exact: true }).click();
  await page.getByRole('link', { name: '继续编辑工具草稿 ↗', exact: true }).click();
  await page.reload();
  await expect(page.getByText(/^已继承参考视频；请补充主体图片/)).toHaveCount(0);
  const messages = (
    await (
      await page.request.get(`${studio.origin}/api/v1/projects/${projectId}/messages`, { headers })
    ).json()
  ).data;
  expect(messages.total).toBe(3);
  const latest = messages.items.find(
    (message: { metadata?: { creationWarnings?: string[] } }) =>
      message.metadata?.creationWarnings?.length === 0,
  );
  expect(latest.metadata.draft).toMatchObject({
    operation: 'video.motion-replica',
    assetIds: [],
    referenceAssetIds: [asset.id],
    options: { referenceAuthorized: false, keepMusicRhythm: true },
    creationWarnings: [],
  });
  for (const [table, n] of [
    ['projects', 1],
    ['assets', 1],
    ['inspiration_reuses', 1],
    ['jobs', 0],
  ] as const)
    expect(studio.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n,
    });
  await page.screenshot({
    path: `${studio.folder}/video-inspiration-recovered.png`,
    fullPage: true,
  });
});

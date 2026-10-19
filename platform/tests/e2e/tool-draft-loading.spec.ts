import { test, expect } from './fixtures';

test('blocks tool draft writes until project messages recover and offers a safe retry after a read failure', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('工具草稿恢复门禁');
  await page.getByLabel('邮箱', { exact: true }).fill('tool-draft-loading@example.test');
  await page.getByLabel(/^密码/).fill('ToolDraftLoading2026!');
  await page.getByRole('button', { name: '创建并开始创作' }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  const session = (await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json()).data,
    headers = { origin: studio.origin, 'x-workspace-id': session.activeWorkspaceId as string };
  const project = (
    await (
      await page.request.post(`${studio.origin}/api/v1/projects`, {
        headers,
        data: { name: '保留原工具草稿', kind: 'video' },
      })
    ).json()
  ).data;
  const written = await page.request.post(
    `${studio.origin}/api/v1/projects/${project.id}/messages`,
    {
      headers,
      data: {
        role: 'user',
        content: '不要用空草稿覆盖我的动作需求',
        metadata: {
          draft: {
            operation: 'video.motion-replica',
            providerId: 'fal',
            prompt: '不要用空草稿覆盖我的动作需求',
            projectId: project.id,
            options: {
              model: 'kling-2.6-motion-standard',
              mode: 'exact',
              replacementType: 'model',
              ratio: 'auto',
              resolution: 'auto',
              needText: false,
              trimEnd: 8,
              duration: 8,
            },
          },
        },
      },
    },
  );
  expect(written.status()).toBe(200);
  const url = `**/api/v1/projects/${project.id}/messages*`;
  let ready = false,
    release!: () => void;
  const barrier = new Promise<void>((done) => {
    release = done;
  });
  await page.route(url, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    ready = true;
    await barrier;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await page.goto(`${studio.origin}/tools/video-replica?projectId=${project.id}`);
    await expect.poll(() => ready).toBe(true);
    await expect(page.getByRole('button', { name: '保存为项目', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '开始处理', exact: true })).toBeDisabled();
    release();
    await expect(page.getByLabel('创作说明', { exact: false })).toHaveValue(
      '不要用空草稿覆盖我的动作需求',
    );
    await expect(page.getByRole('button', { name: '保存为项目', exact: true })).toBeEnabled();
  } finally {
    release();
    await page.unroute(url);
  }
  await page.route(url, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.abort('failed');
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '重试恢复项目草稿', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存为项目', exact: true })).toBeDisabled();
  await page.unroute(url);
  await page.getByRole('button', { name: '重试恢复项目草稿', exact: true }).click();
  await expect(page.getByLabel('创作说明', { exact: false })).toHaveValue(
    '不要用空草稿覆盖我的动作需求',
  );
  await expect(page.getByRole('button', { name: '保存为项目', exact: true })).toBeEnabled();
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM messages').get()).toEqual({
    n: 1,
  });
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
});

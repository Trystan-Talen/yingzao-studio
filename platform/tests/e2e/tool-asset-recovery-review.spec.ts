import sharp from 'sharp';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

test('locks tool inputs until delayed draft assets are restored, then saves the chosen replacement', async ({
  page,
  studio,
}) => {
  const owner = await studio.existingIdentitySession();
  await page
    .context()
    .addCookies([{ name: 'studio_session', value: owner.sessionToken, url: studio.origin }]);
  const headers = { origin: studio.origin, 'x-workspace-id': owner.workspace.id };
  const assets: { id: string; name: string }[] = [];
  for (const [index, background] of ['#24704b', '#b54b32'].entries()) {
    const response = await page.request.post(`${studio.origin}/api/v1/assets/upload`, {
      headers,
      multipart: {
        file: {
          name: `工具恢复素材${index + 1}.png`,
          mimeType: 'image/png',
          buffer: await sharp({ create: { width: 64, height: 64, channels: 3, background } })
            .png()
            .toBuffer(),
        },
      },
    });
    expect(response.status()).toBe(201);
    assets.push((await response.json()).data);
  }
  const created = await page.request.post(`${studio.origin}/api/v1/projects`, {
    headers,
    data: { name: '保持工具草稿素材选择', kind: 'image' },
  });
  const project = (await created.json()).data as { id: string };
  const saved = await page.request.post(`${studio.origin}/api/v1/projects/${project.id}/messages`, {
    headers,
    data: {
      role: 'user',
      content: '保持原工具草稿',
      metadata: {
        draft: {
          operation: 'local.resize',
          providerId: 'local',
          projectId: project.id,
          prompt: '保持原工具草稿',
          assetIds: [assets[0]!.id],
          options: { width: 300, height: 300 },
        },
      },
    },
  });
  expect(saved.status()).toBe(200);
  let ready = false;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/assets/${assets[0]!.id}`, async (route) => {
    const response = await route.fetch();
    ready = true;
    await barrier;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await page.goto(`${studio.origin}/tools/local.resize?projectId=${project.id}`);
    await expect.poll(() => ready).toBe(true);
    const form = page.locator('.tool-form');
    await expect(form).toHaveAttribute('inert', '');
    await expect(page.getByRole('button', { name: '保存为项目', exact: true })).toBeDisabled();
    release();
    await expect(form).not.toHaveAttribute('inert');
    await expect(form.locator('.asset-chip')).toContainText(assets[0]!.name);
    await form.getByRole('button', { name: `移除${assets[0]!.name}`, exact: true }).click();
    await form.getByRole('button', { name: '添加素材', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '原始图片', exact: true });
    await dialog.getByText(assets[1]!.name, { exact: true }).click();
    await dialog.getByRole('button', { name: '完成选择', exact: true }).click();
    await page.getByRole('button', { name: '保存为项目', exact: true }).click();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${studio.origin}/api/v1/projects/${project.id}/messages`,
          { headers },
        );
        const items = (await response.json()).data.items as {
          createdAt: string;
          metadata?: { draft?: { assetIds?: string[] } };
        }[];
        return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.metadata?.draft
          ?.assetIds;
      })
      .toEqual([assets[1]!.id]);
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    await page.goto(`${studio.origin}/tools/local.resize?projectId=${project.id}`);
    await expect(page.locator('.tool-form .asset-chip')).toContainText(assets[1]!.name);
  } finally {
    release();
  }
});

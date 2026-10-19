import sharp from 'sharp';
import type { Locator } from '@playwright/test';
import type { JobInput } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false });

async function upload(target: Locator, name: string, color: string) {
  const buffer = await sharp({
    create: { width: 72, height: 48, channels: 4, background: color },
  })
    .png()
    .toBuffer();
  await target.locator('input[type=file]').first().setInputFiles({
    name,
    mimeType: 'image/png',
    buffer,
  });
  const chip = target.locator('.asset-chip').filter({ hasText: name });
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('img')).toBeVisible();
}

test('restores ordered marketing modules and their own real references from the server, then preserves them while saving free creation', async ({
  page,
  studio,
}) => {
  await page.goto(studio.origin);
  await page.getByLabel('你的称呼', { exact: true }).fill('营销物料验收');
  await page.getByLabel('邮箱', { exact: true }).fill('material-designs@example.test');
  await page.getByLabel(/^密码/).fill('MaterialDesigns2026!');
  await page.getByRole('button', { name: '创建并开始创作', exact: true }).click();
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  const session = (await (await page.request.get(`${studio.origin}/api/v1/auth/me`)).json()).data;
  const headers = { 'x-workspace-id': session.activeWorkspaceId };
  await page.goto(`${studio.origin}/workbench`);
  const composer = page.locator('.composer');
  const kind = composer.getByRole('combobox', { name: '创作类型', exact: true });
  const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  await prompt.fill('春季上新：按物料构图与各自参考保存，不生成');
  await kind.selectOption('marketing');
  await composer.getByRole('combobox', { name: '每模块生成数量', exact: true }).selectOption('2');
  const planner = composer.locator('details.composer-materials');
  await planner.locator('summary').click();
  const modules = planner.locator('.design-module');
  await expect(modules).toHaveCount(3);
  const originals = [
    {
      name: '上市主视觉',
      ratio: '1:1',
      text: '蓝色包装，居中构图',
      asset: '蓝色主视觉.png',
      color: '#275ba9',
    },
    {
      name: '移动端卖点',
      ratio: '9:16',
      text: '绿色包装，竖版留白',
      asset: '绿色卖点.png',
      color: '#27894c',
    },
    { name: '场景补充', ratio: '4:3', text: '不使用专属参考的场景图' },
  ];
  for (let index = 0; index < originals.length; index++) {
    const item = originals[index]!;
    const module = modules.nth(index);
    await module.getByRole('textbox', { name: '模块名称', exact: true }).fill(item.name);
    await module.getByRole('combobox', { name: '模块比例', exact: true }).selectOption(item.ratio);
    await module.getByRole('textbox', { name: '模块构图与文案', exact: true }).fill(item.text);
    if (item.asset && item.color) await upload(module, item.asset, item.color);
  }
  await modules.nth(1).getByRole('button', { name: '上移模块', exact: true }).click();
  const expected = [originals[1]!, originals[0]!, originals[2]!];
  const assertModules = async () => {
    await expect(modules).toHaveCount(3);
    for (let index = 0; index < expected.length; index++) {
      const item = expected[index]!;
      const module = modules.nth(index);
      await expect(module.getByRole('textbox', { name: '模块名称', exact: true })).toHaveValue(
        item.name,
      );
      await expect(module.getByRole('combobox', { name: '模块比例', exact: true })).toHaveValue(
        item.ratio,
      );
      await expect(
        module.getByRole('textbox', { name: '模块构图与文案', exact: true }),
      ).toHaveValue(item.text);
      await expect(module.locator('.asset-chip')).toHaveCount(item.asset ? 1 : 0);
      if (item.asset) await expect(module.locator('.asset-chip')).toContainText(item.asset);
    }
  };
  await assertModules();
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  const key = `yingzao:creation:v1:${session.user.id}:${session.activeWorkspaceId}:${projectId}`;
  const latestDraft = async () => {
    const response = await page.request.get(
      `${studio.origin}/api/v1/projects/${projectId}/messages`,
      { headers },
    );
    expect(response.status()).toBe(200);
    const messages = (await response.json()).data.items as { metadata?: { draft?: JobInput } }[];
    return messages.filter((message) => message.metadata?.draft).at(-1)?.metadata?.draft;
  };
  const savedMarketing = await latestDraft();
  expect(savedMarketing?.options).toMatchObject({ kind: 'marketing', count: 2 });
  expect(savedMarketing?.options.designs?.map((item) => item.name)).toEqual(
    expected.map((item) => item.name),
  );
  expect(savedMarketing?.options.designs?.map((item) => item.assetIds.length)).toEqual([1, 1, 0]);
  expect(savedMarketing?.options.designs?.[0]?.assetIds).not.toEqual(
    savedMarketing?.options.designs?.[1]?.assetIds,
  );
  await page.evaluate((value) => localStorage.removeItem(value), key);
  await page.reload();
  await expect(kind).toHaveValue('marketing');
  await expect(prompt).toHaveValue('春季上新：按物料构图与各自参考保存，不生成');
  await planner.locator('summary').click();
  await assertModules();
  for (const item of savedMarketing?.options.designs ?? []) {
    for (const assetId of item.assetIds) {
      const response = await page.request.get(
        `${studio.origin}/api/v1/assets/${assetId}/content?variant=original`,
        {
          headers,
        },
      );
      expect(response.status()).toBe(200);
      const image = await sharp(await response.body())
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(image.info.width).toBe(72);
      expect(image.info.height).toBe(48);
      const wanted = item.name === '移动端卖点' ? [39, 137, 76] : [39, 91, 169];
      expect([...image.data.subarray(0, 3)]).toEqual(wanted);
    }
  }
  await modules
    .first()
    .getByRole('textbox', { name: '模块名称', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${studio.folder}/marketing-modules-restored.png`,
    fullPage: true,
  });
  await modules
    .last()
    .getByRole('textbox', { name: '模块构图与文案', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${studio.folder}/marketing-final-module.png`,
    fullPage: true,
  });

  await kind.selectOption('free');
  await expect(planner).toHaveCount(0);
  await prompt.fill('自由创作：保留模块草稿但当前只创作一张自由图');
  await composer.getByRole('combobox', { name: '比例', exact: true }).selectOption('3:2');
  await upload(composer.locator('.composer-materials').first(), '自由创作参考.png', '#a34b24');
  const freeSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/v1/projects/${projectId}/messages`,
  );
  await composer.getByRole('button', { name: '保存草稿', exact: true }).click();
  expect((await freeSave).status()).toBe(200);
  await expect(composer.getByText('草稿已保存到项目', { exact: false })).toBeVisible();
  const savedFree = await latestDraft();
  expect(savedFree).toMatchObject({
    prompt: '自由创作：保留模块草稿但当前只创作一张自由图',
    options: { kind: 'free', ratio: '3:2' },
  });
  expect(savedFree?.assetIds).toHaveLength(1);
  expect(savedFree?.options.designs).toEqual(savedMarketing?.options.designs);
  await page.evaluate((value) => localStorage.removeItem(value), key);
  await page.reload();
  await expect(kind).toHaveValue('free');
  await expect(prompt).toHaveValue('自由创作：保留模块草稿但当前只创作一张自由图');
  await expect(composer.getByRole('combobox', { name: '比例', exact: true })).toHaveValue('3:2');
  await expect(composer.locator('.asset-chip')).toHaveCount(1);
  await expect(composer.locator('.asset-chip')).toContainText('自由创作参考.png');
  await kind.selectOption('marketing');
  await planner.locator('summary').click();
  await assertModules();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM projects').get()).toEqual({
    n: 1,
  });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual({
    n: 3,
  });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: `${studio.folder}/free-creation-marketing-draft-retained.png`,
    fullPage: true,
  });
});

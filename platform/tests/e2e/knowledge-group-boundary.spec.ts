import sharp from 'sharp';
import type { JobDto, JobInput } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';
import { confirmDarkFlow, openDarkFlow } from './dark-creation-flow.helpers';
import { expectNoHorizontalOverflow } from './creation-redesign.helpers';

test.use({
  experienceProviders: true,
  experienceImageGateway: false,
  recoveryEnabled: false,
  smsEnabled: false,
});

test('keeps existing grouped creation usable without personal memory or a product', async ({
  page,
  studio,
}) => {
  const { composer, prompt, headers } = await openDarkFlow(page, studio);
  await prompt.fill('为虚构的蓝色杯子做概念商品主图与副图，允许概念设计。');
  await composer
    .getByRole('group', { name: '创作方向', exact: true })
    .getByRole('button', { name: '主副图', exact: true })
    .click();
  const quoted = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' && new URL(item.url()).pathname === '/api/v1/quotes',
  );
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const quote = await quoted;
  expect(quote.status()).toBe(200);
  const input = quote.request().postDataJSON() as JobInput;
  expect(input.useMemory).toBe(false);
  expect(input.productId).toBeUndefined();
  expect(input.options.designs).toHaveLength(3);
  const accepted = await confirmDarkFlow(page);
  let completed: JobDto | undefined;
  await expect
    .poll(
      async () => {
        const result = await page.request.get(`${studio.origin}/api/v1/jobs/${accepted.id}`, {
          headers,
        });
        expect(result.status()).toBe(200);
        completed = (await result.json()).data as JobDto;
        return completed.status;
      },
      { timeout: 30_000 },
    )
    .toBe('succeeded');
  expect(completed!.items).toHaveLength(3);
  expect(completed!.outputAssets).toHaveLength(3);
  for (const asset of completed!.outputAssets) {
    const response = await page.request.get(new URL(asset.originalUrl, studio.origin).toString());
    expect(response.status()).toBe(200);
    const image = await sharp(await response.body()).metadata();
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
  }
});

test('requires explicit product unlinking for groups and preserves single-creation preferences', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openDarkFlow(page, studio);
  const product = studio.services.core.knowledge.createProduct(
    {
      userId: account.user.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    account.workspace.id,
    {
      name: '分组边界合成产品',
      description: '仅用于隔离验收',
      facts: ['容量30毫升'],
      cautions: [],
      brandId: null,
      referenceAssetIds: [account.reference.id],
      visibility: 'private',
      validUntil: null,
    },
  );
  await prompt.fill('为虚构的蓝色杯子做概念商品主图与副图，允许概念设计。');
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  const open = async () => {
    await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
    const preferences = settings
      .locator('details')
      .filter({ has: page.getByText('更多偏好', { exact: true }) });
    if (
      !(await preferences.getAttribute('open')) &&
      !(await settings.getByRole('checkbox', { name: '使用创作记忆', exact: true }).isVisible())
    )
      await settings.getByText('更多偏好', { exact: true }).click();
  };
  const close = () => settings.getByRole('button', { name: '完成', exact: true }).click();
  const memory = settings.getByRole('checkbox', { name: '使用创作记忆', exact: true });
  const images = settings.getByRole('checkbox', { name: '带入产品参考图', exact: true });
  const selected = settings.getByRole('combobox', { name: '参考产品', exact: true });
  const kind = settings.getByRole('combobox', { name: '创作类型', exact: true });
  await open();
  await selected.selectOption(product.id);
  await images.check();
  await expect(memory).toBeChecked();
  await kind.selectOption('main-secondary');
  await expect(memory).toBeDisabled();
  await expect(memory).not.toBeChecked();
  await expect(images).toBeDisabled();
  await expect(images).not.toBeChecked();
  await expect(selected).toBeDisabled();
  await expect(selected).toHaveValue(product.id);
  await close();
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  await expect(composer).toContainText('分组物料暂不支持关联产品与个人记忆');
  expect(writes.filter((path) => /creative-briefs|quotes|jobs/.test(path))).toEqual([]);
  await open();
  await kind.selectOption('single');
  await expect(memory).toBeEnabled();
  await expect(memory).toBeChecked();
  await expect(images).toBeChecked();
  await expect(selected).toHaveValue(product.id);
  await kind.selectOption('main-secondary');
  await settings.getByRole('button', { name: '取消产品关联', exact: true }).click();
  await expect(selected).toHaveValue('');
  await expectNoHorizontalOverflow(page);
  await close();
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
  const quoted = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' && new URL(item.url()).pathname === '/api/v1/quotes',
  );
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const response = await quoted;
  expect(response.status()).toBe(200);
  const input = response.request().postDataJSON() as JobInput;
  expect(input.useMemory).toBe(false);
  expect(input.productId).toBeUndefined();
  expect(input.includeProductImages).toBeUndefined();
  expect(input.options.designs).toHaveLength(3);
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

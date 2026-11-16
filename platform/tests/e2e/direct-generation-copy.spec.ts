import { test, expect } from './fixtures';
import { openDarkFlow } from './dark-creation-flow.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

test('labels the implicit product brand accurately without creating a generation request', async ({
  page,
  studio,
}) => {
  const { account, composer } = await openDarkFlow(page, studio);
  const actor = {
    userId: account.user.id,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const brand = studio.services.core.references.createBrand(actor, account.workspace.id, {
    name: '默认关联文案品牌',
  });
  const product = studio.services.core.knowledge.createProduct(actor, account.workspace.id, {
    name: '默认关联文案产品',
    brandId: brand.id,
  });
  await page.reload();
  const brandSelection = composer.getByRole('combobox', { name: '参考品牌', exact: true });
  await expect(brandSelection.locator('option[value=""]')).toHaveText('不使用品牌');
  await composer.getByRole('combobox', { name: '参考产品', exact: true }).selectOption(product.id);
  await expect(brandSelection).toHaveValue('');
  await expect(brandSelection.locator('option[value=""]')).toHaveText('采用产品所属品牌');
  await expect(composer).toContainText('产品所属品牌：默认关联文案品牌');
  await composer.getByRole('combobox', { name: '参考产品', exact: true }).selectOption('');
  await expect(brandSelection.locator('option[value=""]')).toHaveText('不使用品牌');
  for (const table of ['creative_briefs', 'quotes', 'jobs'])
    expect(studio.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
});

test('explains in model settings that the text service is needed only for thinking mode', async ({
  page,
  studio,
}) => {
  await openDarkFlow(page, studio);
  await page.goto(`${studio.origin}/settings?tab=models`);
  await expect(
    page.getByText('图片生成需启用图片服务；视频生成还需视频服务。开启思考模式时才需要文本规划。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('生成图片需保存并启用文本规划与图片生成；生成视频还需启用视频生成。', {
      exact: true,
    }),
  ).toHaveCount(0);
});

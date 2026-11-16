import { join } from 'node:path';
import type { CreativePreparation } from '../../src/contracts/creative-intent';
import type { JobInput } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';
import { confirmDarkFlow, openDarkFlow } from './dark-creation-flow.helpers';
import {
  expectNoHorizontalOverflow,
  saveAndVerifyCreationOriginal,
  waitForCreationResult,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

test('selects visible brand and product, freezes direct-generation sources and saves the resulting image', async ({
  page,
  studio,
}, testInfo) => {
  const { account, composer, prompt } = await openDarkFlow(page, studio);
  const actor = {
    userId: account.user.id,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const brand = studio.services.core.references.createBrand(actor, account.workspace.id, {
    name: '直接生成测试品牌',
    description: '清新植物风格，品牌色为青绿色。',
    colors: ['#126A5C'],
  });
  const product = studio.services.core.knowledge.createProduct(actor, account.workspace.id, {
    name: '直接生成测试香氛',
    description: '用于对照测试的虚构香氛瓶。',
    facts: ['容量30毫升', '青绿色瓶身'],
    brandId: brand.id,
    referenceAssetIds: [account.reference.id],
  });
  await page.reload();
  const context = composer.getByRole('region', { name: '关联品牌与产品', exact: true });
  await expect(context).toBeVisible();
  await expect(context.getByRole('combobox', { name: '参考品牌', exact: true })).toBeVisible();
  await context.getByRole('combobox', { name: '参考品牌', exact: true }).selectOption(brand.id);
  await context.getByRole('combobox', { name: '参考产品', exact: true }).selectOption(product.id);
  await expect(context).toContainText('产品所属品牌：直接生成测试品牌');
  await context.getByRole('checkbox', { name: '带入产品参考图', exact: true }).check();
  await context.getByRole('switch', { name: '思考模式', exact: true }).uncheck();
  const original = '青绿色香氛瓶，完整瓶身，白色背景，不添加文字。';
  await prompt.fill(original);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, `${testInfo.project.name}-direct-context.png`),
    fullPage: true,
  });
  const preparing = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/creative-briefs/prepare'),
  );
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const response = await preparing;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().input).toMatchObject({
    planningMode: 'direct',
    brandId: brand.id,
    productId: product.id,
    includeProductImages: true,
    prompt: original,
  });
  const preparation = (await response.json()).data as CreativePreparation;
  expect(preparation.status).toBe('ready');
  expect(preparation.result.questions).toEqual([]);
  expect(preparation.contextSources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'brand', id: brand.id }),
      expect.objectContaining({ kind: 'product', id: product.id }),
    ]),
  );
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(confirmation).toContainText('思考模式已关闭');
  await confirmation.getByText('本次采用的资料', { exact: true }).click();
  await expect(confirmation).toContainText('容量30毫升');
  const job = await confirmDarkFlow(page);
  expect(job.input).toMatchObject({ planningMode: 'direct', productId: product.id });
  const completed = await waitForCreationResult(page, studio, job.id, account.workspace.id);
  const frozen = studio.services.db.sqlite
    .prepare('SELECT input_json FROM job_items WHERE job_id=?')
    .get(job.id) as { input_json: string };
  const execution = JSON.parse(frozen.input_json) as JobInput;
  expect(execution.prompt).toContain(original);
  expect(execution.prompt).toContain('容量30毫升');
  expect([...execution.assetIds, ...execution.referenceAssetIds]).toContain(account.reference.id);
  await saveAndVerifyCreationOriginal(
    page,
    studio,
    page.locator('.focused-task').getByRole('button', { name: '下载原件', exact: true }),
    completed.outputAssets[0]!,
    'direct-generation.png',
  );
});

test('keeps separate mode drafts and never reuses an assisted preparation after switching to direct', async ({
  page,
  studio,
}) => {
  const { composer, prompt } = await openDarkFlow(page, studio);
  const original = '白色陶瓷杯，白色背景，完整杯身，不添加文字。';
  await prompt.fill(original);
  const prepare = async () => {
    const response = page.waitForResponse(
      (item) =>
        item.request().method() === 'POST' && item.url().endsWith('/creative-briefs/prepare'),
    );
    await composer.getByRole('button', { name: '生成图片', exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(200);
    return (await result.json()).data as CreativePreparation;
  };
  const assisted = await prepare();
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await composer.getByRole('switch', { name: '思考模式', exact: true }).uncheck();
  await page.reload();
  await expect(composer.getByRole('switch', { name: '思考模式', exact: true })).not.toBeChecked();
  await expect(prompt).toHaveValue(original);
  const direct = await prepare();
  expect(direct.id).not.toBe(assisted.id);
  expect(direct.input.planningMode).toBe('direct');
  await expect(confirmation).toContainText('思考模式已关闭');
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await expect(composer.getByRole('switch', { name: '思考模式', exact: true })).not.toBeChecked();
  await composer.getByRole('switch', { name: '思考模式', exact: true }).check();
  await composer.getByRole('button', { name: '图片创作', exact: true }).click();
  await expect(composer.getByRole('switch', { name: '思考模式', exact: true })).not.toBeChecked();
  await expect(prompt).toHaveValue(original);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('keeps direct mode when entering reference recreation and blocks unsupported planning without silently enabling it', async ({
  page,
  studio,
}) => {
  const { composer } = await openDarkFlow(page, studio);
  await composer.getByRole('switch', { name: '思考模式', exact: true }).uncheck();
  await composer.getByRole('combobox', { name: '创作模式', exact: true }).selectOption('replica');
  await expect(composer.getByRole('switch', { name: '思考模式', exact: true })).not.toBeChecked();
  await expect(composer).toContainText('参考复刻与分组物料需要思考模式，请开启后继续。');
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  await composer.getByRole('switch', { name: '思考模式', exact: true }).check();
  await expect(composer).not.toContainText('参考复刻与分组物料需要思考模式，请开启后继续。');
  await composer.getByRole('combobox', { name: '创作模式', exact: true }).selectOption('original');
  await expect(composer.getByRole('switch', { name: '思考模式', exact: true })).not.toBeChecked();
  for (const table of ['creative_briefs', 'quotes', 'jobs'])
    expect(studio.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
});

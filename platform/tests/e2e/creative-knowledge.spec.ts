import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { MemoryDto, ProductDto } from '../../src/contracts/knowledge';
import type {
  CreativeIntentRequest,
  CreativePreparation,
} from '../../src/contracts/creative-intent';
import { test, expect } from './fixtures';
import { confirmDarkFlow, openDarkFlow } from './dark-creation-flow.helpers';
import {
  expectNoHorizontalOverflow,
  saveAndVerifyCreationOriginal,
  waitForCreationResult,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

function memoryUpdate(value: MemoryDto, content = value.content) {
  return {
    topic: value.topic,
    content,
    kind: value.kind,
    mediaType: value.mediaType,
    expiresAt: value.expiresAt,
    halfLifeDays: value.halfLifeDays,
    status: value.status,
    expectedVersion: value.version,
  };
}
function productUpdate(value: ProductDto, facts = value.facts) {
  return {
    name: value.name,
    description: value.description,
    facts,
    cautions: value.cautions,
    brandId: value.brandId,
    referenceAssetIds: value.referenceAssetIds,
    visibility: value.visibility,
    validUntil: value.validUntil,
    expectedVersion: value.version,
  };
}

test('creates reusable memory and product, freezes reviewed sources and saves a downloadable image', async ({
  page,
  studio,
}, testInfo) => {
  test.setTimeout(120_000);
  const { account, headers: workspaceHeaders } = await openDarkFlow(page, studio);
  const headers = { ...workspaceHeaders, origin: studio.origin };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const actor = {
    userId: account.user.id,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const brand = studio.services.core.references.createBrand(actor, account.workspace.id, {
    name: '合成测试品牌',
    description: '只供隔离验收使用的植物香氛品牌。',
    colors: ['#126A5C'],
  });

  await page.goto(`${studio.origin}/settings?tab=memory`);
  await page.getByRole('button', { name: '添加记忆', exact: true }).click();
  await page.getByRole('textbox', { name: '记忆主题' }).fill('画面留白');
  await page
    .getByRole('textbox', { name: '记忆内容' })
    .fill('通常偏好自然光和适度留白，本次明确要求优先。');
  await page.getByRole('combobox', { name: '记忆类型', exact: true }).selectOption('preference');
  await page.getByRole('button', { name: '保存记忆', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('画面留白', { exact: true })).toBeVisible();
  const memoriesResponse = await page.request.get(`${studio.origin}/api/v1/memories`, { headers });
  expect(memoriesResponse.status()).toBe(200);
  const memory = (await memoriesResponse.json()).data.items[0] as MemoryDto;
  expect(memory).toMatchObject({ kind: 'preference', version: 1, eligible: true });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, `${testInfo.project.name}-memory.png`),
    fullPage: true,
  });

  await page.goto(`${studio.origin}/products`);
  await page.getByRole('button', { name: '创建产品', exact: true }).first().click();
  await page.getByRole('textbox', { name: '产品名称' }).fill('合成青绿香氛瓶');
  await page.getByRole('textbox', { name: '产品描述' }).fill('验收专用概念产品。');
  await page
    .getByRole('textbox', { name: '产品事实（每行一条）' })
    .fill('容量为30毫升\n瓶身为青绿色');
  await page.getByRole('textbox', { name: '使用限制（每行一条）' }).fill('不得添加治疗功效宣称');
  await page.getByRole('combobox', { name: '关联品牌', exact: true }).selectOption(brand.id);
  await page.getByRole('dialog').getByRole('button', { name: '添加素材', exact: true }).click();
  const productImages = page.getByRole('dialog', { name: '产品参考图片', exact: true });
  await productImages.locator('.asset-select').filter({ hasText: account.reference.name }).click();
  await productImages.getByRole('button', { name: '完成选择', exact: true }).click();
  await page.getByRole('button', { name: '保存产品', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '合成青绿香氛瓶', exact: true })).toBeVisible();
  const productsResponse = await page.request.get(`${studio.origin}/api/v1/products`, { headers });
  expect(productsResponse.status()).toBe(200);
  const product = (await productsResponse.json()).data.items[0] as ProductDto;
  expect(product).toMatchObject({
    brandId: brand.id,
    facts: ['容量为30毫升', '瓶身为青绿色'],
    referenceAssetIds: [account.reference.id],
    version: 1,
  });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, `${testInfo.project.name}-products.png`),
    fullPage: true,
  });

  await page.goto(`${studio.origin}/workbench?kind=image`);
  const composer = page.locator('.composer');
  await composer
    .getByRole('textbox', { name: '创作需求' })
    .fill('青绿色香氛概念瓶，白色背景，完整瓶身，不添加文字。');
  await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await settings.getByText('更多偏好', { exact: true }).click();
  await settings.getByRole('combobox', { name: '参考产品', exact: true }).selectOption(product.id);
  await settings.getByRole('checkbox', { name: '带入产品参考图', exact: true }).check();
  await settings.getByRole('checkbox', { name: '使用创作记忆', exact: true }).check();
  await settings.locator('summary').filter({ hasText: '当前可用记忆' }).click();
  await expect(settings.getByText('画面留白', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  const preparing = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/creative-briefs/prepare',
  );
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const preparedResponse = await preparing;
  expect(preparedResponse.status()).toBe(200);
  const preparation = (await preparedResponse.json()).data as CreativePreparation;
  expect(preparation.contextSources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'product', id: product.id, version: 1 }),
      expect.objectContaining({ kind: 'brand', id: brand.id }),
      expect.objectContaining({ kind: 'memory', id: memory.id, version: 1 }),
    ]),
  );
  const readRequest = () => {
    const row = studio.services.db.sqlite
      .prepare('SELECT request_json FROM creative_briefs WHERE id=?')
      .get(preparation.id) as { request_json: string };
    return JSON.parse(row.request_json) as CreativeIntentRequest;
  };
  const originalRequest = readRequest();
  expect(originalRequest.sourceTexts.some((source) => source.text.includes('容量为30毫升'))).toBe(
    true,
  );
  expect(originalRequest.sourceTexts.some((source) => source.text.includes(memory.content))).toBe(
    false,
  );
  expect(originalRequest.memoryContext?.items[0]?.content).toBe(memory.content);
  expect(originalRequest.materials).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: account.reference.id, role: 'reference' }),
    ]),
  );
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByText('本次采用的资料', { exact: true }).click();
  await expect(confirmation).toContainText('容量为30毫升');
  await expect(confirmation).toContainText(memory.content);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, `${testInfo.project.name}-knowledge-confirmation.png`),
    fullPage: true,
  });

  // Another editor changes the records while the existing reviewed quote is open.
  const changedProduct = await page.request.patch(
    `${studio.origin}/api/v1/products/${product.id}`,
    { headers, data: productUpdate(product, ['容量更新为50毫升', '瓶身为青绿色']) },
  );
  expect(changedProduct.status()).toBe(200);
  const changedMemory = await page.request.patch(`${studio.origin}/api/v1/memories/${memory.id}`, {
    headers,
    data: memoryUpdate(memory, '通常偏好密集构图，仍以本次要求为准。'),
  });
  expect(changedMemory.status()).toBe(200);
  expect(readRequest()).toEqual(originalRequest);
  const accepted = await confirmDarkFlow(page);
  const frozenItems = studio.services.db.sqlite
    .prepare('SELECT input_json FROM job_items WHERE job_id=?')
    .all(accepted.id) as { input_json: string }[];
  expect(
    frozenItems.some((item) =>
      JSON.parse(item.input_json).referenceAssetIds.includes(account.reference.id),
    ),
  ).toBe(true);
  const completed = await waitForCreationResult(page, studio, accepted.id, account.workspace.id);
  expect(completed.input.creativeBriefId).toBe(preparation.id);
  expect(readRequest()).toEqual(originalRequest);
  const task = page.locator('.focused-task');
  await saveAndVerifyCreationOriginal(
    page,
    studio,
    task.getByRole('button', { name: '下载原件', exact: true }),
    completed.outputAssets[0]!,
    'knowledge-image.png',
  );

  const { creativeBriefId: _briefId, ...freshInput } = preparation.input;
  void _briefId;
  const fresh = await page.request.post(`${studio.origin}/api/v1/creative-briefs/prepare`, {
    headers,
    data: { requestId: randomUUID(), input: freshInput, answers: [] },
  });
  expect(fresh.status()).toBe(200);
  const next = (await fresh.json()).data as CreativePreparation;
  expect(next.contextSources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'product',
        version: 2,
        content: expect.stringContaining('容量更新为50毫升'),
      }),
      expect.objectContaining({
        kind: 'memory',
        version: 2,
        content: expect.stringContaining('密集构图'),
      }),
    ]),
  );
  const without = await page.request.post(`${studio.origin}/api/v1/creative-briefs/prepare`, {
    headers,
    data: { requestId: randomUUID(), input: { ...freshInput, useMemory: false }, answers: [] },
  });
  expect(without.status()).toBe(200);
  expect(
    ((await without.json()).data as CreativePreparation).contextSources?.some(
      (source) => source.kind === 'memory',
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test('manages private memory and rejects a stale product edit without losing the editor draft', async ({
  page,
  studio,
}) => {
  test.setTimeout(90_000);
  const { headers: workspaceHeaders } = await openDarkFlow(page, studio);
  const headers = { ...workspaceHeaders, origin: studio.origin };
  const createdMemory = await page.request.post(`${studio.origin}/api/v1/memories`, {
    headers,
    data: { topic: '职业背景', content: '包装设计师', kind: 'profile' },
  });
  expect(createdMemory.status()).toBe(201);
  const memory = (await createdMemory.json()).data as MemoryDto;
  await page.goto(`${studio.origin}/settings?tab=memory`);
  const card = page
    .locator('.knowledge-card')
    .filter({ has: page.getByRole('heading', { name: '职业背景', exact: true }) });
  await card.getByRole('button', { name: '停用', exact: true }).click();
  await expect(card).toContainText('已停用');
  const readMemory = async () =>
    (
      await (
        await page.request.get(`${studio.origin}/api/v1/memories/${memory.id}`, { headers })
      ).json()
    ).data as MemoryDto;
  expect(await readMemory()).toMatchObject({
    version: 2,
    status: 'paused',
    confirmedAt: memory.confirmedAt,
  });
  await card.getByRole('button', { name: '启用', exact: true }).click();
  await expect(card).toContainText('可用于新规划');
  await card.getByRole('button', { name: '编辑记忆', exact: true }).click();
  await page.getByRole('textbox', { name: '记忆内容' }).fill('独立品牌设计顾问');
  await page.getByRole('button', { name: '保存记忆', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toContainText('独立品牌设计顾问');
  expect(await readMemory()).toMatchObject({ content: '独立品牌设计顾问', version: 4 });
  await card.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(
    (await page.request.get(`${studio.origin}/api/v1/memories/${memory.id}`, { headers })).status(),
  ).toBe(404);

  const createdProduct = await page.request.post(`${studio.origin}/api/v1/products`, {
    headers,
    data: { name: '并发编辑产品', facts: ['容量30毫升'] },
  });
  const product = (await createdProduct.json()).data as ProductDto;
  await page.goto(`${studio.origin}/products`);
  const productCard = page
    .locator('.knowledge-card')
    .filter({ has: page.getByRole('heading', { name: '并发编辑产品', exact: true }) });
  await productCard.getByRole('button', { name: '编辑产品', exact: true }).click();
  const facts = page.getByRole('textbox', { name: '产品事实（每行一条）' });
  await facts.fill('当前编辑器草稿：容量40毫升');
  const secondEditor = await page.request.patch(`${studio.origin}/api/v1/products/${product.id}`, {
    headers,
    data: productUpdate(product, ['另一编辑者已确认：容量50毫升']),
  });
  expect(secondEditor.status()).toBe(200);
  const saving = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().endsWith(`/products/${product.id}`),
  );
  await page.getByRole('button', { name: '保存产品', exact: true }).click();
  expect((await saving).status()).toBe(409);
  await expect(facts).toHaveValue('当前编辑器草稿：容量40毫升');
  await expect(page.getByRole('dialog')).toBeVisible();
  const persisted = await page.request.get(`${studio.origin}/api/v1/products/${product.id}`, {
    headers,
  });
  expect((await persisted.json()).data.facts).toEqual(['另一编辑者已确认：容量50毫升']);
  await expectNoHorizontalOverflow(page);
});

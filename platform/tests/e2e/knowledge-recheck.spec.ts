import type { Actor } from '../../src/contracts/core';
import { test, expect } from './fixtures';
import { openDarkFlow } from './dark-creation-flow.helpers';
import { expectNoHorizontalOverflow } from './creation-redesign.helpers';

test.use({
  experienceProviders: true,
  experienceImageGateway: false,
  recoveryEnabled: false,
  smsEnabled: false,
});

test('retains single-creation memory and product-image choices after refreshing a grouped draft', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt } = await openDarkFlow(page, studio);
  const actor: Actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const product = studio.services.core.knowledge.createProduct(actor, account.workspace.id, {
    name: '保留单张选择',
    referenceAssetIds: [account.reference.id],
  });
  await page.reload();
  await composer.getByRole('combobox', { name: '参考产品', exact: true }).selectOption(product.id);
  await composer.getByRole('checkbox', { name: '带入产品参考图', exact: true }).check();
  await prompt.fill('刷新后仍保留用户明确勾选，仅单张创作采用。');
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  const open = async () => {
    await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
    if (!(await settings.getByRole('checkbox', { name: '使用创作记忆', exact: true }).isVisible()))
      await settings.getByText('更多偏好', { exact: true }).click();
  };
  await open();
  await settings.getByRole('checkbox', { name: '使用创作记忆', exact: true }).check();
  await settings
    .getByRole('combobox', { name: '创作类型', exact: true })
    .selectOption('main-secondary');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await open();
  await expect(
    settings.getByRole('checkbox', { name: '使用创作记忆', exact: true }),
  ).not.toBeChecked();
  await settings.getByRole('combobox', { name: '创作类型', exact: true }).selectOption('single');
  await expect(settings.getByRole('checkbox', { name: '使用创作记忆', exact: true })).toBeChecked();
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await expect(
    composer.getByRole('checkbox', { name: '带入产品参考图', exact: true }),
  ).toBeChecked();
});

for (const kind of ['memory', 'product'] as const) {
  test(`recovers a concurrent ${kind} edit without discarding local input or another editor's untouched fields`, async ({
    page,
    studio,
  }) => {
    const account = await studio.existingIdentitySession();
    const actor: Actor = {
      userId: account.user.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    const service = studio.services.core.knowledge;
    const memory =
      kind === 'memory'
        ? service.createMemory(actor, account.workspace.id, {
            topic: '原主题',
            content: '原内容',
            kind: 'profile',
          })
        : null;
    const product =
      kind === 'product'
        ? service.createProduct(actor, account.workspace.id, { name: '原产品', facts: ['旧规格'] })
        : null;
    await page.context().addCookies([
      {
        name: 'studio_session',
        value: account.sessionToken,
        url: studio.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto(`${studio.origin}/${kind === 'memory' ? 'settings?tab=memory' : 'products'}`);
    await page
      .getByRole('button', { name: kind === 'memory' ? '编辑记忆' : '编辑产品', exact: true })
      .click();
    const editor = page.getByRole('dialog');
    const localExpiry = '2099-05-10T12:01';
    const expectedExpiry = await page.evaluate(
      (value) => new Date(value).toISOString(),
      localExpiry,
    );
    const field = editor.getByRole('textbox', {
      name: kind === 'memory' ? /^记忆内容/ : '产品名称',
    });
    await field.fill('当前窗口的修改');
    await editor.getByLabel(kind === 'memory' ? /^到期时间/ : /^产品有效期/).fill(localExpiry);
    if (memory)
      service.updateMemory(actor, account.workspace.id, memory.id, {
        topic: '另一窗口更新主题',
        content: '另一窗口的修改',
        kind: memory.kind,
        mediaType: memory.mediaType,
        expiresAt: new Date(Date.parse(expectedExpiry) + 40_000).toISOString(),
        halfLifeDays: memory.halfLifeDays,
        status: memory.status,
        expectedVersion: memory.version,
      });
    if (product)
      service.updateProduct(actor, account.workspace.id, product.id, {
        name: '另一窗口的修改',
        description: product.description,
        facts: ['另一窗口更新规格'],
        cautions: product.cautions,
        brandId: product.brandId,
        referenceAssetIds: product.referenceAssetIds,
        visibility: product.visibility,
        validUntil: new Date(Date.parse(expectedExpiry) + 40_000).toISOString(),
        expectedVersion: product.version,
      });
    const save = editor.getByRole('button', {
      name: kind === 'memory' ? '保存记忆' : '保存产品',
      exact: true,
    });
    const conflicted = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        /\/api\/v1\/(memories|products)\//.test(response.url()),
    );
    await save.click();
    expect((await conflicted).status()).toBe(409);
    await expect(field).toHaveValue('当前窗口的修改');
    await expect(editor).toContainText('另一窗口的修改');
    await expect(editor).toContainText(':40');
    await expect(editor).toContainText(':00');
    await expectNoHorizontalOverflow(page);
    await editor.getByRole('button', { name: '合并最新记录并继续编辑', exact: true }).click();
    await expect(field).toHaveValue('当前窗口的修改');
    if (memory)
      await expect(editor.getByRole('textbox', { name: /^记忆主题/ })).toHaveValue(
        '另一窗口更新主题',
      );
    if (product)
      await expect(editor.getByRole('textbox', { name: /^产品事实/ })).toHaveValue(
        '另一窗口更新规格',
      );
    await save.click();
    await expect(editor).toHaveCount(0);
    if (memory)
      expect(service.getMemory(actor, account.workspace.id, memory.id)).toMatchObject({
        topic: '另一窗口更新主题',
        content: '当前窗口的修改',
        version: 3,
        expiresAt: expectedExpiry,
      });
    if (product)
      expect(service.getProduct(actor, account.workspace.id, product.id)).toMatchObject({
        name: '当前窗口的修改',
        facts: ['另一窗口更新规格'],
        version: 3,
        validUntil: expectedExpiry,
      });

    // The other recovery choice deliberately replaces local input, without a write
    // until the user reviews it and presses Save again.
    await expect(
      page.getByRole('heading', {
        name: memory ? '另一窗口更新主题' : '当前窗口的修改',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: memory ? '编辑记忆' : '编辑产品', exact: true }).click();
    await field.fill('将主动放弃的修改');
    if (memory) {
      const latest = service.getMemory(actor, account.workspace.id, memory.id);
      service.updateMemory(actor, account.workspace.id, memory.id, {
        topic: latest.topic,
        content: '需要载入的最新内容',
        kind: latest.kind,
        mediaType: latest.mediaType,
        expiresAt: latest.expiresAt,
        halfLifeDays: latest.halfLifeDays,
        status: latest.status,
        expectedVersion: latest.version,
      });
    }
    if (product) {
      const latest = service.getProduct(actor, account.workspace.id, product.id);
      service.updateProduct(actor, account.workspace.id, product.id, {
        name: '需要载入的最新内容',
        description: latest.description,
        facts: latest.facts,
        cautions: latest.cautions,
        brandId: latest.brandId,
        referenceAssetIds: latest.referenceAssetIds,
        visibility: latest.visibility,
        validUntil: latest.validUntil,
        expectedVersion: latest.version,
      });
    }
    await save.click();
    await editor.getByRole('button', { name: '载入最新记录，放弃当前修改', exact: true }).click();
    await expect(field).toHaveValue('需要载入的最新内容');
    const restored = memory
      ? service.getMemory(actor, account.workspace.id, memory.id)
      : service.getProduct(actor, account.workspace.id, product!.id);
    expect(restored.version).toBe(4);
    await save.click();
    await expect(editor).toHaveCount(0);
  });
}

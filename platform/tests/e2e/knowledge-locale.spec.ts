import { join } from 'node:path';
import type { Actor } from '../../src/contracts/core';
import { t } from '../../src/web/lib/i18n';
import { expectNoHorizontalOverflow } from './creation-redesign.helpers';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

for (const locale of ['en', 'ar'] as const) {
  test(`keeps ${locale} memory and product controls readable, personal content unchanged and the default dark`, async ({
    page,
    studio,
  }, testInfo) => {
    const account = await studio.existingIdentitySession();
    const actor: Actor = {
      userId: account.user.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    studio.services.core.auth.update(actor, {
      preferences: { locale, theme: 'system', onboardingCompleted: true },
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.context().addCookies([
      {
        name: 'studio_session',
        value: account.sessionToken,
        url: studio.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    for (const key of [
      '创作记忆',
      '添加记忆',
      '记忆主题',
      '记忆内容',
      '产品库',
      '创建产品',
      '保存产品',
      '启用',
      '停用',
    ])
      expect(t(key, locale)).not.toBe(key);
    await page.goto(`${studio.origin}/settings?tab=memory`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(
      page.getByRole('button', { name: t('创作记忆', locale), exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: t('添加记忆', locale), exact: true }).click();
    const memoryEditor = page.getByRole('dialog', { name: t('添加记忆', locale), exact: true });
    // These values deliberately match dictionary keys. User-authored text must
    // remain verbatim even when static controls use another interface language.
    await memoryEditor
      .getByRole('textbox', { name: new RegExp(`^${t('记忆主题', locale)}`) })
      .fill('个人偏好');
    await memoryEditor
      .getByRole('textbox', { name: new RegExp(`^${t('记忆内容', locale)}`) })
      .fill('保存设置');
    await memoryEditor
      .getByRole('combobox', { name: t('记忆类型', locale), exact: true })
      .selectOption('preference');
    await expect(
      memoryEditor.getByRole('option', { name: t('创作偏好', locale), exact: true }),
    ).toBeAttached();
    const memoryStatus = memoryEditor.getByRole('combobox', {
      name: t('记忆状态', locale),
      exact: true,
    });
    for (const value of ['启用', '停用'])
      await expect(
        memoryStatus.getByRole('option', { name: t(value, locale), exact: true }),
      ).toBeAttached();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: join(studio.folder, `${testInfo.project.name}-memory-editor-${locale}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await memoryEditor.getByRole('button', { name: t('保存记忆', locale), exact: true }).click();
    await expect(memoryEditor).toHaveCount(0);
    const memoryCard = page
      .locator('.knowledge-card')
      .filter({ has: page.getByRole('heading', { name: '个人偏好', exact: true }) });
    await expect(memoryCard.getByText('保存设置', { exact: true })).toBeVisible();
    await expect(
      memoryCard.getByRole('button', { name: t('编辑记忆', locale), exact: true }),
    ).toBeVisible();
    await expect(
      memoryCard.getByRole('button', { name: t('停用', locale), exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto(`${studio.origin}/products`);
    await expect(
      page.getByRole('heading', { name: t('产品库', locale), exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: t('创建产品', locale), exact: true }).click();
    const create = page.getByRole('dialog', { name: t('创建产品', locale), exact: true });
    await create.getByRole('textbox', { name: t('产品名称', locale), exact: true }).fill('产品库');
    await create
      .getByRole('textbox', { name: t('产品描述', locale), exact: true })
      .fill('长期背景');
    await create
      .getByRole('textbox', { name: t('产品事实（每行一条）', locale), exact: false })
      .fill('规格为30毫升');
    await expect(
      create.getByRole('combobox', { name: t('关联品牌', locale), exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: join(studio.folder, `${testInfo.project.name}-product-editor-${locale}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await create.getByRole('button', { name: t('保存产品', locale), exact: true }).click();
    await expect(create).toHaveCount(0);
    const productCard = page
      .locator('.knowledge-card')
      .filter({ has: page.getByRole('heading', { name: '产品库', exact: true }) });
    await expect(productCard.getByText('长期背景', { exact: true })).toBeVisible();
    await productCard.getByRole('button', { name: t('编辑产品', locale), exact: true }).click();
    const edit = page.getByRole('dialog', { name: t('产品资料', locale), exact: true });
    await expect(
      edit.getByRole('textbox', { name: t('产品名称', locale), exact: true }),
    ).toHaveValue('产品库');
    await expect(
      edit.getByRole('textbox', { name: t('产品描述', locale), exact: true }),
    ).toHaveValue('长期背景');
    await edit
      .getByRole('textbox', { name: t('产品描述', locale), exact: true })
      .fill('长期背景，保留原文');
    await edit.getByRole('button', { name: t('保存产品', locale), exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(productCard.getByText('长期背景，保留原文', { exact: true })).toBeVisible();
    const product = studio.services.core.knowledge.listProducts(actor, account.workspace.id)
      .items[0];
    expect(product).toMatchObject({
      name: '产品库',
      description: '长期背景，保留原文',
      facts: ['规格为30毫升'],
      version: 2,
    });
    expect(
      studio.services.core.knowledge.listMemories(actor, account.workspace.id).items[0],
    ).toMatchObject({ topic: '个人偏好', content: '保存设置', kind: 'preference' });
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(studio.folder, `${testInfo.project.name}-products-${locale}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
  });
}

import { join } from 'node:path';
import sharp from 'sharp';
import type { Actor, ProjectDto } from '../../src/contracts/core';
import { detailPagePlanSchema } from '../../src/contracts/detail-page';
import { detailPageDraftKey, emptyDetailPageDraft } from '../../src/web/lib/detail-page-draft';
import {
  defaultDetailPageEditor,
  detailPageBriefKey,
} from '../../src/web/lib/detail-page-workflow';
import { test, expect } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

test('reviews one screen at a time, explains invalid content and preserves the current step and brief decision', async ({
  page,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const actor: Actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const asset = await studio.services.core.assets.ingest(actor, account.workspace.id, {
    buffer: await sharp({ create: { width: 400, height: 500, channels: 3, background: '#eceef7' } })
      .png()
      .toBuffer(),
    name: '隔离参考图.png',
    mimeType: 'image/png',
  });
  const headers = { origin: studio.origin, 'x-workspace-id': account.workspace.id };
  const created = await page.request.post(`${studio.origin}/api/v1/projects`, {
    headers,
    data: { name: '详情页交互回归', kind: 'image' },
  });
  expect(created.status()).toBe(201);
  const project = (await created.json()).data as ProjectDto;
  const plan = detailPagePlanSchema.parse({
    productName: '陶瓷随行杯',
    productFacts: ['容量350毫升'],
    audience: '通勤人群',
    visualStyle: '自然光商品摄影',
    palette: ['米白'],
    consistencyNotes: '保持杯形',
    unknowns: ['核对杯盖材质'],
    screens: ['hero', 'detail'].map((id, index) => ({
      id,
      title: `第${index + 1}屏标题`,
      purpose: '介绍已知卖点',
      copy: ['日常随行'],
      prompt: '完整展示杯体',
      ratio: '3:4',
    })),
  });
  const draft = {
    ...emptyDetailPageDraft(),
    brief: '陶瓷随行杯，容量350毫升，面向通勤人群。',
    screenCount: 2,
    referenceAssetIds: [asset.id],
    projectId: project.id,
    plan,
  };
  const editor = { ...defaultDetailPageEditor(draft), planBriefKey: detailPageBriefKey(draft) };
  await page.goto(`${studio.origin}/detail-pages`);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: detailPageDraftKey(account.user.id, account.workspace.id, project.id),
    value: JSON.stringify({ ...draft, editor }),
  });
  await page.goto(`${studio.origin}/detail-pages/${project.id}`);
  const flow = page.getByRole('navigation', { name: '详情页创作流程', exact: true });
  const stepOne = flow.getByRole('button', { name: /准备商品/ });
  const stepTwo = flow.getByRole('button', { name: /确认方案/ });
  const stepThree = flow.getByRole('button', { name: /生成与导出/ });
  await expect(stepTwo).toHaveAttribute('aria-current', 'step');
  await expect(stepThree).toBeDisabled();
  const index = page.getByRole('navigation', { name: '选择要编辑的分屏', exact: true });
  await expect(index.getByRole('button')).toHaveCount(2);
  await expect(page.locator('.detail-screen-editor')).toHaveCount(1);
  await index.getByRole('button', { name: /第2屏标题/ }).click();
  const title = page.locator('.detail-screen-editor').getByRole('textbox', { name: /^分屏标题/ });
  await title.fill('');
  await expect(page.locator('.detail-screen-editor .field-error')).toContainText('请填写内容');
  await expect(page.locator('.detail-validation-summary')).toContainText('第 2 屏');
  await expect(page.getByRole('button', { name: '确认本屏', exact: true })).toBeDisabled();
  await title.fill('杯身细节');
  await page.getByRole('button', { name: '确认本屏', exact: true }).click();
  await index.getByRole('button', { name: /第1屏标题/ }).click();
  await page.getByRole('button', { name: '确认本屏，下一屏', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: '我已核对商品事实、文案和待确认信息，可用于本次生成。',
      exact: true,
    })
    .check();
  const next = page.getByRole('button', { name: '继续，确认生成', exact: true });
  await expect(next).toBeEnabled();
  await page.screenshot({ path: join(studio.folder, 'detail-review-screen.png'), fullPage: true });
  await next.click();
  await expect(stepThree).toHaveAttribute('aria-current', 'step');
  await expect(
    page.getByRole('heading', { name: '即将生成这一套详情页', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.detail-review-references img')).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator('.detail-review-references img')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(400);
  await page.reload();
  await expect(stepThree).toHaveAttribute('aria-current', 'step');
  await stepOne.click();
  await page.getByRole('textbox', { name: /商品信息与创作要求/ }).fill('新的简报：黑色保温杯。');
  await expect(page.getByText('商品信息已修改，现有方案尚未更新', { exact: true })).toBeVisible();
  await stepTwo.click();
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: '保留当前方案继续', exact: true }).click();
  await expect(next).toBeEnabled();
  await page.reload();
  await expect(stepTwo).toHaveAttribute('aria-current', 'step');
  await expect(next).toBeEnabled();
  await expect(page.getByText('商品信息已修改，现有方案尚未更新', { exact: true })).toBeHidden();
  await stepOne.click();
  await page
    .getByRole('textbox', { name: /商品信息与创作要求/ })
    .fill('第二次修改：不锈钢随行杯。');
  await expect(page.getByText('商品信息已修改，现有方案尚未更新', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(studio.folder, 'detail-brief-change.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '保留当前方案继续', exact: true }).click();
  await stepTwo.click();
  await expect(next).toBeEnabled();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, 'restoreDetailPageStorage', {
      configurable: true,
      value: () => {
        Storage.prototype.setItem = original;
      },
    });
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('yingzao:detail-page:'))
        throw new DOMException('Simulated isolated storage failure', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  const facts = page.getByRole('checkbox', {
    name: '我已核对商品事实、文案和待确认信息，可用于本次生成。',
    exact: true,
  });
  await facts.uncheck();
  await facts.check();
  await expect(
    page.getByText('当前修改暂未保存到本机。请恢复浏览器存储后再离开页面。'),
  ).toBeVisible();
  await expect(next).toBeDisabled();
  await expect(stepThree).toBeDisabled();
  await page.evaluate(() => {
    (window as unknown as { restoreDetailPageStorage: () => void }).restoreDetailPageStorage();
  });
  await page.getByRole('button', { name: '已核对，保存当前内容', exact: true }).click();
  await expect(next).toBeEnabled();
  await page.reload();
  await expect(next).toBeEnabled();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

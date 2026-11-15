import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IMAGE_KINDS } from '../../src/contracts/catalog';
import { originalInspirations } from '../../src/contracts/inspirations';
import type { CapabilitiesDto, QuoteDto } from '../../src/contracts/jobs';
import { test, expect } from './fixtures';
import {
  creationRecords,
  expectNoHorizontalOverflow,
  openCreationRedesign,
} from './creation-redesign.helpers';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

test('shares one recoverable image and video draft across both entry URLs without creating a project', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openCreationRedesign(page, studio);
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  await page.goto(`${studio.origin}/?asset=${account.reference.id}`);
  await page.getByRole('button', { name: '添加为参考', exact: true }).click();
  await expect(composer.locator('.asset-chip')).toHaveCount(1);
  const imagePrompt = '保留这张真实参考图，清晨窗边，不增加文字。';
  const videoPrompt = '概念短片，暖白背景，固定镜头，不要声音。';
  await prompt.fill(imagePrompt);
  const platform = composer.getByRole('combobox', { name: '发布平台', exact: true });
  await platform.selectOption('小红书');
  await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  await settings.getByRole('combobox', { name: '比例', exact: true }).selectOption('3:4');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page.goto(`${studio.origin}/workbench`);
  await expect(page.locator('.composer')).toHaveCount(1);
  await expect(prompt).toHaveValue(imagePrompt);
  await expect(platform).toHaveValue('小红书');
  await expect(composer.locator('.asset-chip')).toContainText(account.reference.name);
  await expect(composer.getByRole('button', { name: '更多创作设置', exact: true })).toContainText(
    '3:4',
  );
  await composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await expect(prompt).toHaveValue('');
  await expect(composer.locator('.asset-chip')).toHaveCount(0);
  await prompt.fill(videoPrompt);
  await page.goto(`${studio.origin}/`);
  await expect(prompt).toHaveValue(videoPrompt);
  await expect(page).toHaveURL(`${studio.origin}/?kind=video`);
  await expect(
    page.getByText('以下为静态画面灵感，可用于构思视频；不是视频成片。', { exact: true }),
  ).toBeVisible();
  await expect(composer.getByRole('button', { name: '视频创作', exact: true })).toHaveClass(
    /active/,
  );
  await page.goto(`${studio.origin}/workbench?kind=image`);
  await expect(prompt).toHaveValue(imagePrompt);
  await expect(composer.locator('.asset-chip')).toContainText(account.reference.name);
  await expect(platform).toHaveValue('小红书');
  const stored = await page.evaluate(
    (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
    `yingzao:creation:v1:${account.user.id}:${account.workspace.id}:`,
  );
  expect(stored).toEqual([`yingzao:creation:v1:${account.user.id}:${account.workspace.id}:new`]);
  await page.getByRole('button', { name: '最近创作', exact: true }).click();
  await expect(page.getByText('还没有创作记录', { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue(imagePrompt);
  await page.getByRole('button', { name: '灵感推荐', exact: true }).click();
  await expect(page.locator('.studio-idea-card')).toHaveCount(8);
  expect(writes).toEqual([]);
  expect(creationRecords(studio)).toEqual({
    briefs: 0,
    projects: 0,
    quotes: 0,
    jobs: 0,
    reserved: 0,
    settled: 0,
  });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: join(studio.folder, 'unified-draft-restored.png'),
    fullPage: true,
  });
});

test('previews without changing a draft, applies only explicit text choices and never undoes later manual edits', async ({
  page,
  studio,
}) => {
  const { composer, prompt, writes } = await openCreationRedesign(page, studio);
  const original = '我的原始需求，保留已有文字和明确否定条件。';
  const first = originalInspirations[0]!;
  const second = originalInspirations[1]!;
  await prompt.fill(original);
  const platform = composer.getByRole('combobox', { name: '发布平台', exact: true });
  await platform.selectOption('TikTok');
  const assetsBefore = studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get();
  const openIdea = async (idea: (typeof originalInspirations)[number]) => {
    await page.getByRole('button', { name: `预览灵感：${idea.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: idea.title, exact: true });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect(dialog).toContainText('仅填入想法，不添加示例图片，也不会开始生成。');
    return dialog;
  };
  let dialog = await openIdea(first);
  await expect(
    composer.getByRole('textbox', { name: '创作需求', exact: true, includeHidden: true }),
  ).toHaveValue(original);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `预览灵感：${first.title}`, exact: true }),
  ).toBeFocused();
  await expect(prompt).toHaveValue(original);
  dialog = await openIdea(first);
  await dialog.getByRole('button', { name: '替换当前需求', exact: true }).click();
  await expect(prompt).toHaveValue(first.prompt);
  await expect(prompt).toBeFocused();
  const undo = composer.getByRole('button', { name: '撤销填入', exact: true });
  await undo.click();
  await expect(prompt).toHaveValue(original);
  dialog = await openIdea(second);
  await dialog.getByRole('button', { name: '补充到当前需求', exact: true }).click();
  await expect(prompt).toHaveValue(`${original}\n\n${second.prompt}`);
  await undo.click();
  await expect(prompt).toHaveValue(original);
  dialog = await openIdea(second);
  await dialog.getByRole('button', { name: '补充到当前需求', exact: true }).click();
  const manual = `${original}\n\n${second.prompt}\n这句是我之后的新修改，不能被撤销覆盖。`;
  await prompt.fill(manual);
  await expect(undo).toHaveCount(0);
  await page.reload();
  await expect(prompt).toHaveValue(manual);
  await expect(undo).toHaveCount(0);
  await expect(platform).toHaveValue('TikTok');
  await expect(composer.locator('.asset-chip')).toHaveCount(0);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM assets').get()).toEqual(
    assetsBefore,
  );
  expect(writes).toEqual([]);
  expect(creationRecords(studio)).toEqual({
    briefs: 0,
    projects: 0,
    quotes: 0,
    jobs: 0,
    reserved: 0,
    settled: 0,
  });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: join(studio.folder, 'idea-safe-application.png'), fullPage: true });
});

for (const gateway of [true, false]) {
  test.describe(
    gateway ? 'single-image gateway directions' : 'compatible module directions',
    () => {
      test.use({ experienceImageGateway: gateway });
      test('quotes the supported direction with the current server unit price without submitting a job', async ({
        page,
        studio,
      }) => {
        const { composer, prompt, writes, headers } = await openCreationRedesign(page, studio);
        const response = await page.request.get(`${studio.origin}/api/v1/capabilities`, {
          headers,
        });
        expect(response.status()).toBe(200);
        const capabilities = (await response.json()).data as CapabilitiesDto;
        const rate = capabilities.operations.find(
          (item) => item.id === 'image.generate' && item.providerId === 'openai',
        )!;
        const estimate = composer.locator('.credit-estimate-value');
        await expect(estimate).toHaveText(`预计 ${rate.priceCredits} 积分`);
        const directions = composer.getByRole('group', { name: '创作方向', exact: true });
        const direction = (id: string) =>
          directions.getByRole('button', {
            name: IMAGE_KINDS.find((item) => item.id === id)!.name,
            exact: true,
          });
        for (const id of ['single', 'white-background']) {
          await direction(id).click();
          await expect(direction(id)).toHaveAttribute('aria-pressed', 'true');
          await expect(estimate).toHaveText(`预计 ${rate.priceCredits} 积分`);
        }
        const units = gateway ? 1 : 3;
        const kind = gateway ? 'marketing' : 'main-secondary';
        if (gateway) await expect(direction('main-secondary')).toHaveCount(0);
        await direction(kind).click();
        await expect(direction(kind)).toHaveAttribute('aria-pressed', 'true');
        await expect(estimate).toHaveText(`预计 ${rate.priceCredits * units} 积分`);
        if (gateway) await expect(composer.locator('details.composer-materials')).toHaveCount(0);
        else
          await expect(composer.locator('details.composer-materials summary')).toContainText('3');
        expect(writes).toEqual([]);
        expect(creationRecords(studio)).toEqual({
          briefs: 0,
          projects: 0,
          quotes: 0,
          jobs: 0,
          reserved: 0,
          settled: 0,
        });
        await prompt.fill(
          gateway
            ? '为虚构的蓝色杯子做一张概念营销海报，允许概念设计。'
            : '为虚构的蓝色杯子做概念商品主图与副图，允许概念设计。',
        );
        const quoted = page.waitForResponse(
          (item) =>
            item.request().method() === 'POST' && new URL(item.url()).pathname === '/api/v1/quotes',
        );
        await composer.getByRole('button', { name: '生成图片', exact: true }).click();
        const quoteResponse = await quoted;
        expect(quoteResponse.status()).toBe(200);
        const quote = (await quoteResponse.json()).data as QuoteDto;
        expect(quote.units).toBe(units);
        expect(quote.maxCredits).toBe(rate.priceCredits * units);
        const input = quoteResponse.request().postDataJSON();
        expect(input).toMatchObject({ options: { kind, count: 1 } });
        expect(input.options.model).toBe(
          gateway ? 'doubao-seedream-5.0-lite' : 'gpt-image-2.5-flare',
        );
        if (gateway) expect(input.options.designs).toBeUndefined();
        else expect(input.options.designs).toHaveLength(3);
        const dialog = page.getByRole('dialog', { name: '确认创作', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.media-quote-price')).toContainText(String(quote.maxCredits));
        expect(creationRecords(studio)).toMatchObject({ jobs: 0, reserved: 0, settled: 0 });
        await dialog.getByRole('button', { name: '关闭', exact: true }).click();
        await directions.getByRole('button', { name: '自由创作', exact: true }).click();
        await expect(estimate).toHaveText(`预计 ${rate.priceCredits} 积分`);
        await expect(composer.locator('details.composer-materials')).toHaveCount(0);
        expect(writes.filter((path) => path === '/api/v1/jobs')).toHaveLength(0);
        await page.screenshot({
          path: join(
            studio.folder,
            `direction-${gateway ? 'single' : 'modules'}-quote-credits.png`,
          ),
          fullPage: true,
        });
      });
    },
  );
}

test('keeps an unsupported historical marketing group intact and blocks new quotes until the user resolves it', async ({
  page,
  studio,
}) => {
  const { account, composer, prompt, writes } = await openCreationRedesign(page, studio);
  await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
  const original = '历史三模块草稿，保留每个模块的顺序与参考。';
  await prompt.fill(original);
  const key = `yingzao:creation:v1:${account.user.id}:${account.workspace.id}:new`;
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).input.prompt, key))
    .toBe(original);
  const designs = [1, 2, 3].map((n) => ({
    id: randomUUID(),
    name: `保留模块${n}`,
    kind: 'marketing',
    ratio: '1:1',
    prompt: `明确构图${n}`,
    assetIds: n === 1 ? [account.reference.id] : [],
  }));
  await page.evaluate(
    ({ key, designs }) => {
      const stored = JSON.parse(localStorage.getItem(key)!);
      stored.input.options.kind = 'marketing';
      stored.input.options.designs = designs;
      stored.drafts.image = stored.input;
      localStorage.setItem(key, JSON.stringify(stored));
    },
    { key, designs },
  );
  await page.reload();
  await expect(prompt).toHaveValue(original);
  await expect(composer).toContainText(
    '当前模型仅支持单张创作。分组草稿已保留，请切换支持分组的模型，或改用单张类型。',
  );
  await expect(composer.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  await composer.locator('details.composer-materials summary').click();
  const modules = composer.locator('.design-module');
  await expect(modules).toHaveCount(3);
  for (let n = 0; n < designs.length; n++) {
    await expect(
      modules.nth(n).getByRole('textbox', { name: '模块名称', exact: true }),
    ).toHaveValue(designs[n]!.name);
    await expect(
      modules.nth(n).getByRole('textbox', { name: '模块构图与文案', exact: true }),
    ).toHaveValue(designs[n]!.prompt);
  }
  await expect(modules.nth(0).locator('.asset-chip')).toContainText(account.reference.name);
  expect(
    await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).input.options.designs, key),
  ).toEqual(designs);
  expect(writes).toEqual([]);
  expect(creationRecords(studio)).toEqual({
    briefs: 0,
    projects: 0,
    quotes: 0,
    jobs: 0,
    reserved: 0,
    settled: 0,
  });
  await page.screenshot({
    path: join(studio.folder, 'unsupported-group-retained.png'),
    fullPage: true,
  });
});

for (const limit of [12000, 2100]) {
  test(`keeps the complete saved draft when appending an idea would exceed ${limit} characters`, async ({
    page,
    studio,
  }) => {
    const { account, composer, prompt, writes } = await openCreationRedesign(page, studio);
    if (limit === 2100) {
      await composer.getByRole('button', { name: '视频创作', exact: true }).click();
      await composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
      await settings
        .getByRole('combobox', { name: '生成模型', exact: true })
        .selectOption('video.generate|fal|kling-o3-4k-reference');
      await settings.getByRole('button', { name: '完成', exact: true }).click();
    }
    await expect(prompt).toHaveAttribute('maxlength', String(limit));
    await expect(composer.locator('.credit-estimate-value')).toHaveText(/预计 \d+ 积分/);
    const original = '原'.repeat(limit);
    const key = `yingzao:creation:v1:${account.user.id}:${account.workspace.id}:new`;
    await prompt.fill(original);
    const readDraft = () =>
      page.evaluate(
        (storageKey) => JSON.parse(localStorage.getItem(storageKey)!).input.prompt as string,
        key,
      );
    await expect.poll(readDraft).toBe(original);
    const idea = originalInspirations[0]!;
    await page.getByRole('button', { name: `预览灵感：${idea.title}`, exact: true }).click();
    await page
      .getByRole('dialog', { name: idea.title, exact: true })
      .getByRole('button', { name: '补充到当前需求', exact: true })
      .click();
    await expect(composer.getByRole('alert')).toContainText(
      '文字已超出当前模型上限，原需求已保留。请先精简需求，或选择替换。',
    );
    await expect(prompt).toHaveValue(original);
    await expect(prompt).toBeFocused();
    await expect.poll(readDraft).toBe(original);
    await expect(composer.getByText('浏览器无法保存草稿', { exact: false })).toHaveCount(0);
    await page.reload();
    await expect(prompt).toHaveValue(original);
    await page.getByRole('button', { name: `预览灵感：${idea.title}`, exact: true }).click();
    await page
      .getByRole('dialog', { name: idea.title, exact: true })
      .getByRole('button', { name: '补充到当前需求', exact: true })
      .click();
    await expect(composer.getByRole('alert')).toContainText('文字已超出当前模型上限');
    const edited = original.slice(0, -1);
    await prompt.fill(edited);
    await expect(composer.getByText('文字已超出当前模型上限', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: `预览灵感：${idea.title}`, exact: true }).click();
    await page
      .getByRole('dialog', { name: idea.title, exact: true })
      .getByRole('button', { name: '替换当前需求', exact: true })
      .click();
    await expect(prompt).toHaveValue(idea.prompt);
    await expect.poll(readDraft).toBe(idea.prompt);
    await composer.getByRole('button', { name: '撤销填入', exact: true }).click();
    await expect(prompt).toHaveValue(edited);
    await expect.poll(readDraft).toBe(edited);
    expect(writes).toEqual([]);
    expect(creationRecords(studio)).toEqual({
      briefs: 0,
      projects: 0,
      quotes: 0,
      jobs: 0,
      reserved: 0,
      settled: 0,
    });
    await page.screenshot({ path: join(studio.folder, `idea-limit-${limit}.png`), fullPage: true });
  });
}

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import type { CreativeAnswer, CreativePreparation } from '../../src/contracts/creative-intent';
import { CREATIVE_INTENT_CLIENT_TIMEOUT_MS } from '../../src/contracts/creative-intent-timing';
import type { JobInput } from '../../src/contracts/jobs';
import { creativeInputFingerprint } from '../../src/contracts/creative-fingerprint';
import { creativeBriefStorageKey } from '../../src/web/lib/creative-brief';
import { test, expect, type Studio } from './fixtures';

test.use({ experienceProviders: true, recoveryEnabled: false, smsEnabled: false });

interface PreparationRequest {
  requestId: string;
  input: JobInput;
  previousId?: string;
  answers: CreativeAnswer[];
}
function prepared(request: PreparationRequest, clarify = false): CreativePreparation {
  const id = randomUUID();
  const status = clarify ? 'needs_clarification' : 'ready';
  const placement = request.input.options.creativePlacement ?? 'general';
  const product = ['main-image', 'secondary-image', 'detail-image', 'product-video'].includes(
    placement,
  );
  return {
    id,
    status,
    input: { ...request.input, creativeBriefId: id },
    result: {
      type: 'intent-plan',
      version: 1,
      requestId: request.requestId,
      status,
      brief: {
        scope: product ? 'product' : 'general',
        subject: '月球上的猫',
        goal: '通用创作',
        mediaType: request.input.operation === 'video.generate' ? 'video' : 'image',
        platform: request.input.options.platform,
        placement,
        productMode: product ? 'concept' : 'not-applicable',
        facts: [],
        constraints: [],
      },
      summary: clarify
        ? '需要确定画面主体和要保留的文字。'
        : '绘制月球上看海的猫，保留你的原话和选择。',
      assumptions: ['未指定构图时，以主体居中作为起点。'],
      prompt: clarify ? '' : '执行提示只在服务端使用，不覆盖用户原话。',
      reviewChecklist: [],
      questions: clarify
        ? [
            {
              id: 'subject',
              field: 'subject',
              question: '画面主体是什么？',
              reason: '主体会决定构图。',
              options: ['一只猫', '一只狗'],
            },
            {
              id: 'text',
              field: 'delivery',
              question: '需要保留哪些文字？',
              reason: '按原文呈现，避免替你编写。',
              options: ['不要文字'],
            },
          ]
        : [],
    },
  };
}

async function open(
  page: Page,
  studio: Studio,
  options: { confirm?: boolean; platform?: string } = {},
) {
  const account = await studio.experienceSession();
  if (options.confirm === false || options.platform)
    studio.services.core.auth.update(
      {
        userId: account.user.id,
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      },
      {
        preferences: {
          confirmGeneration: options.confirm ?? true,
          ...(options.platform ? { defaultPlatform: options.platform } : {}),
        },
      },
    );
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const requests: PreparationRequest[] = [];
  const results = new Map<string, CreativePreparation>();
  const quoted: JobInput[] = [];
  let reads = 0,
    jobs = 0,
    projects = 0;
  let failureCode = 'CHECK_UNAVAILABLE';
  let respond = async (request: PreparationRequest): Promise<CreativePreparation | null> =>
    prepared(request);
  await page.route('**/api/v1/creative-briefs/prepare', async (route) => {
    const request = route.request().postDataJSON() as PreparationRequest;
    requests.push(request);
    const result = await respond(request);
    if (!result) {
      await route.fulfill({
        status: 503,
        json: { error: { code: failureCode, message: '模拟检查暂不可用' } },
      });
      return;
    }
    results.set(result.id, result);
    await route.fulfill({ json: { data: result } });
  });
  await page.route(/\/api\/v1\/creative-briefs\/[0-9a-f-]{36}$/, async (route) => {
    reads++;
    const id = route.request().url().split('/').at(-1)!;
    await route.fulfill({ json: { data: results.get(id) } });
  });
  await page.route('**/api/v1/quotes', async (route) => {
    const input = route.request().postDataJSON() as JobInput;
    quoted.push(input);
    await route.fulfill({
      json: {
        data: {
          id: randomUUID(),
          inputHash: 'local-ui-fixture',
          pricingVersion: 'local-ui-fixture',
          maxCredits: 1,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          providerId: input.providerId,
          operation: input.operation,
          units: input.options.count,
          creativeSummary: input.creativeBriefId
            ? {
                summary: results.get(input.creativeBriefId)?.result.summary ?? '',
                assumptions: results.get(input.creativeBriefId)?.result.assumptions ?? [],
              }
            : undefined,
        },
      },
    });
  });
  await page.route('**/api/v1/jobs', async (route) => {
    if (route.request().method() === 'POST') {
      jobs++;
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/projects')
      projects++;
  });
  await page.goto(studio.origin);
  const composer = page.locator('.composer[data-presentation="quick"]');
  await expect(composer).toBeVisible();
  const prompt = composer.getByRole('textbox', { name: '创作需求', exact: true });
  const generate = composer.locator('.submit-row > button');
  return {
    account,
    composer,
    prompt,
    generate,
    requests,
    quoted,
    results,
    setRespond: (handler: typeof respond) => {
      respond = handler;
    },
    setFailureCode: (code: string) => {
      failureCode = code;
    },
    counts: () => ({ reads, jobs, projects }),
  };
}

test('shows one clear clarification area and focuses missing answers without another planning call', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  harness.setRespond(async (request) => prepared(request, !request.previousId));
  await harness.prompt.fill('画一幅画，文字由我补充。');
  await harness.generate.click();
  const brief = page.getByRole('region', { name: '创作需求检查', exact: true });
  const subject = brief.locator('fieldset').nth(0);
  const text = brief.locator('fieldset').nth(1);
  await expect(brief.getByRole('heading', { name: '确认这两点', exact: true })).toBeFocused();
  await expect(brief.getByText('需要确定画面主体和要保留的文字。', { exact: true })).toHaveCount(0);
  await expect(brief.locator('textarea')).toHaveCount(0);
  await expect(subject.getByText('主体会决定构图。', { exact: true })).not.toBeVisible();
  await harness.generate.click();
  await expect(subject.getByRole('alert')).toHaveText('请先回答这一题。');
  await expect(subject.getByRole('button', { name: '一只猫', exact: true })).toBeFocused();
  expect(harness.requests).toHaveLength(1);
  expect(harness.quoted).toHaveLength(0);
  await harness.generate.click();
  await expect(subject.getByRole('button', { name: '一只猫', exact: true })).toBeFocused();
  expect(harness.requests).toHaveLength(1);
  await subject.getByRole('button', { name: '一只猫', exact: true }).click();
  await expect(subject.getByRole('alert')).toHaveCount(0);
  await expect(subject.locator('textarea')).toHaveCount(0);
  await harness.generate.click();
  await expect(text.getByRole('alert')).toHaveText('请先回答这一题。');
  await expect(text.getByRole('button', { name: '不要文字', exact: true })).toBeFocused();
  expect(harness.requests).toHaveLength(1);
  await text.getByRole('button', { name: '自己填写', exact: true }).click();
  const answer = text.getByRole('textbox', { name: '需要保留哪些文字？', exact: true });
  await expect(answer).toBeFocused();
  await answer.fill('Good morning 月球');
  await expect(text.getByRole('alert')).toHaveCount(0);
  expect(harness.requests).toHaveLength(1);
  expect(harness.counts()).toMatchObject({ projects: 0, jobs: 0 });
  await harness.generate.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  expect(harness.requests[1]?.answers).toEqual([
    { questionId: 'subject', answer: '一只猫' },
    { questionId: 'text', answer: 'Good morning 月球' },
  ]);
  expect(harness.counts().jobs).toBe(0);
});

test('switches between custom text and quick options without auto-submitting or losing restored custom answers', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  harness.setRespond(async (request) => prepared(request, true));
  await harness.prompt.fill('画一幅画。');
  await harness.generate.click();
  const subject = page
    .getByRole('region', { name: '创作需求检查', exact: true })
    .locator('fieldset')
    .nth(0);
  await subject.getByRole('button', { name: '一只猫', exact: true }).click();
  await subject.getByRole('button', { name: '自己填写', exact: true }).click();
  const answer = subject.getByRole('textbox', { name: '画面主体是什么？', exact: true });
  await expect(answer).toHaveValue('');
  await answer.fill('一只没有项圈的橘猫');
  await page.reload();
  await expect(answer).toHaveValue('一只没有项圈的橘猫');
  await subject.getByRole('button', { name: '一只狗', exact: true }).click();
  await expect(subject.locator('textarea')).toHaveCount(0);
  await expect(subject.getByRole('button', { name: '一只狗', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(harness.requests).toHaveLength(1);
  expect(harness.quoted).toHaveLength(0);
  expect(harness.counts().jobs).toBe(0);
});

test('opens the normal add-reference picker instead of targeting an existing image removal action', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  await harness.composer
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'existing-reference.png',
      mimeType: 'image/png',
      buffer: await sharp({
        create: { width: 400, height: 400, channels: 3, background: '#228833' },
      })
        .png()
        .toBuffer(),
    });
  await expect(harness.composer.getByText('existing-reference.png', { exact: true })).toBeVisible();
  harness.setRespond(async (request) => {
    const result = prepared(request, true);
    result.result.questions = [
      {
        id: 'reference',
        field: 'reference',
        question: '要补充另一张商品图吗？',
        reason: '这里仅模拟需要更多参考的回复。',
        options: ['补充参考图'],
      },
    ];
    return result;
  });
  await harness.prompt.fill('保留参考外观，补充另一张视角。');
  await harness.generate.click();
  const brief = page.getByRole('region', { name: '创作需求检查', exact: true });
  await brief.getByRole('button', { name: '添加参考图', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '参考图片、视频或文档', exact: true }),
  ).toBeVisible();
  await expect(harness.composer.locator('.asset-chip')).toHaveCount(1);
  expect(harness.requests).toHaveLength(1);
  expect(harness.quoted).toHaveLength(0);
  expect(harness.counts().jobs).toBe(0);
});

test('continues a complete general idea to the existing quote, and refresh only reads the saved understanding', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  const original = '  一只在月球看海的猫，水彩画。  ';
  const platform = harness.composer.getByRole('combobox', { name: '发布平台', exact: true });
  await expect(platform).toBeVisible();
  await expect(platform.locator('option')).toHaveCount(6);
  await expect(platform.locator('option')).toHaveText([
    '通用电商',
    'Amazon（亚马逊）',
    'TikTok（海外短视频平台）',
    '抖音',
    '小红书',
    '淘宝',
  ]);
  await platform.selectOption('Amazon');
  await harness.prompt.fill(original);
  await expect(harness.generate).toBeEnabled();
  await harness.generate.click();
  const quote = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(quote).toBeVisible();
  expect(harness.requests).toHaveLength(1);
  expect(harness.quoted[0]?.prompt).toBe(original);
  expect(harness.quoted[0]?.creativeBriefId).toBeTruthy();
  await quote.getByText('查看详细配置与计费', { exact: true }).click();
  await quote.getByText('本次采用的默认建议', { exact: true }).click();
  await expect(
    quote.getByText('未指定构图时，以主体居中作为起点。', { exact: true }),
  ).toBeVisible();
  await quote.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(harness.prompt).toHaveValue(original);
  // Restore from the ID saved in the creation draft even without a separate cache.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('yingzao:creative-brief:')) localStorage.removeItem(key);
  });
  await page.reload();
  await expect(page.getByRole('region', { name: '创作需求检查', exact: true })).toContainText(
    '绘制月球上看海的猫，保留你的原话和选择。',
  );
  expect(harness.counts().reads).toBeGreaterThan(0);
  expect(harness.requests).toHaveLength(1);
  await expect(harness.prompt).toHaveValue(original);
  await harness.generate.click();
  await expect(quote).toBeVisible();
  expect(harness.requests).toHaveLength(1);
  expect(harness.quoted).toHaveLength(2);
  expect(harness.counts().jobs).toBe(0);
  await page.screenshot({ path: join(studio.folder, 'creative-ready-quote.png'), fullPage: true });
  await quote.getByRole('button', { name: '继续编辑', exact: true }).click();
  await platform.selectOption('TikTok');
  await expect(page.getByRole('region', { name: '创作需求检查', exact: true })).toHaveCount(0);
  await harness.generate.click();
  await expect(quote).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  expect(harness.requests[1]?.previousId).toBeUndefined();
  expect(harness.quoted[2]?.options.platform).toBe('TikTok');
});

test('asks only two necessary questions, preserves separate answers across refresh, then quotes the original wording', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  harness.setRespond(async (request) => prepared(request, !request.previousId));
  const original = '帮我画一幅画，并放上我需要的文字。';
  await harness.prompt.fill(original);
  await harness.generate.click();
  const brief = page.getByRole('region', { name: '创作需求检查', exact: true });
  await expect(brief.locator('fieldset')).toHaveCount(2);
  await page.screenshot({
    path: join(studio.folder, 'creative-clarification.png'),
    fullPage: true,
  });
  expect(harness.counts()).toMatchObject({ projects: 0, jobs: 0 });
  expect(harness.quoted).toHaveLength(0);
  await brief.getByRole('button', { name: '一只猫', exact: true }).click();
  await brief
    .locator('fieldset')
    .nth(1)
    .getByRole('button', { name: '自己填写', exact: true })
    .click();
  await brief
    .getByRole('textbox', { name: '需要保留哪些文字？', exact: true })
    .fill('Good morning 月球');
  await harness.composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await expect(brief).toHaveCount(0);
  await harness.prompt.fill('独立的视频草稿。');
  await harness.composer.getByRole('button', { name: '图片创作', exact: true }).click();
  await expect(harness.prompt).toHaveValue(original);
  await expect(brief.getByRole('button', { name: '一只猫', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(brief.getByRole('button', { name: '一只猫', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(brief.getByRole('textbox', { name: '需要保留哪些文字？', exact: true })).toHaveValue(
    'Good morning 月球',
  );
  expect(harness.requests).toHaveLength(1);
  await expect(harness.prompt).toHaveValue(original);
  await harness.generate.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  expect(harness.requests[1]?.previousId).toBeTruthy();
  expect(harness.requests[1]?.answers).toEqual([
    { questionId: 'subject', answer: '一只猫' },
    { questionId: 'text', answer: 'Good morning 月球' },
  ]);
  expect(harness.quoted[0]?.prompt).toBe(original);
  expect(harness.counts().jobs).toBe(0);
});

test('sends only the current round of answers and requires a fresh answer for a repeated question ID', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  harness.setRespond(async (request) => {
    const round = harness.requests.length;
    const result = prepared(request, round < 4);
    if (round === 1)
      result.result.questions = [
        {
          id: 'subject',
          field: 'subject',
          question: '请说出画面主体？',
          reason: '需要明确主体。',
          options: [],
        },
      ];
    if (round === 2 || round === 3)
      result.result.questions = [
        {
          id: 'claim',
          field: 'claim',
          question: round === 2 ? '具体要保留的原文？' : '请补充更完整的原文？',
          reason: '确保内容准确。',
          options: [],
        },
      ];
    return result;
  });
  await harness.prompt.fill('帮我画一张作品，按需要补充。');
  await harness.generate.click();
  await page.getByRole('textbox', { name: '请说出画面主体？', exact: true }).fill('月球上的猫');
  await harness.generate.click();
  await page.getByRole('textbox', { name: '具体要保留的原文？', exact: true }).fill('你好');
  await harness.generate.click();
  const followup = page.getByRole('textbox', { name: '请补充更完整的原文？', exact: true });
  await expect(followup).toHaveValue('');
  expect(harness.requests[2]?.answers).toEqual([{ questionId: 'claim', answer: '你好' }]);
  await harness.generate.click();
  await expect(harness.generate).toBeEnabled();
  expect(harness.requests).toHaveLength(3);
  expect(harness.quoted).toHaveLength(0);
  await followup.fill('你好，来自月球的朋友');
  await harness.generate.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(harness.requests[3]?.answers).toEqual([
    { questionId: 'claim', answer: '你好，来自月球的朋友' },
  ]);
  expect(harness.counts().jobs).toBe(0);
});

test('drops late understanding after the prompt, platform and material change', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  harness.setRespond(async (request) => {
    if (harness.requests.length === 1) await barrier;
    return prepared(request);
  });
  await harness.prompt.fill('原来的月球水彩猫。');
  await harness.generate.click();
  await expect.poll(() => harness.requests.length).toBe(1);
  await harness.prompt.fill('新的森林水彩猫，保留参考颜色。');
  await harness.composer
    .getByRole('combobox', { name: '发布平台', exact: true })
    .selectOption('小红书');
  await harness.composer
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'forest-reference.png',
      mimeType: 'image/png',
      buffer: await sharp({
        create: { width: 400, height: 400, channels: 3, background: '#228833' },
      })
        .png()
        .toBuffer(),
    });
  await expect(harness.composer.getByText('forest-reference.png', { exact: true })).toBeVisible();
  release();
  await expect(harness.generate).toBeEnabled();
  expect(harness.quoted).toHaveLength(0);
  expect(harness.counts().projects).toBe(0);
  await expect(page.getByRole('region', { name: '创作需求检查', exact: true })).toHaveCount(0);
  await harness.generate.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  expect(harness.requests[1]?.previousId).toBeUndefined();
  expect(harness.quoted[0]).toMatchObject({
    prompt: '新的森林水彩猫，保留参考颜色。',
    options: { platform: '小红书' },
  });
  expect(harness.quoted[0]?.assetIds).toHaveLength(1);
  expect(harness.counts().jobs).toBe(0);
});

test('does not bypass a failed check with confirmation disabled and retries the same request after refresh', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio, { confirm: false });
  harness.setFailureCode('CREATIVE_BRIEF_UNCERTAIN');
  harness.setRespond(async () => null);
  await harness.prompt.fill('一只宇航员猫，动画风格。');
  await harness.generate.click();
  await expect(page.getByText('这次理解还没完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新检查', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '按最新资料重新整理', exact: true })).toHaveCount(
    0,
  );
  expect(harness.requests).toHaveLength(1);
  expect(harness.counts()).toMatchObject({ projects: 0, jobs: 0 });
  expect(harness.quoted).toHaveLength(0);
  await page.reload();
  await expect(harness.prompt).toHaveValue('一只宇航员猫，动画风格。');
  expect(harness.requests).toHaveLength(1);
  await harness.generate.click();
  await expect.poll(() => harness.requests.length).toBe(2);
  expect(harness.requests[1]?.requestId).toBe(harness.requests[0]?.requestId);
  await expect(page.getByRole('button', { name: '按最新资料重新整理', exact: true })).toHaveCount(
    0,
  );
  expect(harness.counts()).toMatchObject({ projects: 0, jobs: 0 });
  expect(harness.quoted).toHaveLength(0);
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
});

test('requires an explicit reset after a confirmed failure and keeps the current question answers for the new check', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  harness.setFailureCode('CREATIVE_BRIEF_FAILED');
  harness.setRespond(async (request) =>
    harness.requests.length === 1 ? prepared(request, true) : null,
  );
  await harness.prompt.fill('创作一幅猫的画，稍后补充要保留的文字。');
  await harness.generate.click();
  const questions = page.getByRole('region', { name: '创作需求检查', exact: true });
  await questions
    .locator('fieldset')
    .nth(0)
    .getByRole('button', { name: '自己填写', exact: true })
    .click();
  await page.getByRole('textbox', { name: '画面主体是什么？', exact: true }).fill('橘猫');
  await questions
    .locator('fieldset')
    .nth(1)
    .getByRole('button', { name: '自己填写', exact: true })
    .click();
  await page.getByRole('textbox', { name: '需要保留哪些文字？', exact: true }).fill('你好月球');
  await harness.generate.click();
  const reset = page.getByRole('button', { name: '重新检查', exact: true });
  await expect(reset).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  await reset.click();
  expect(harness.requests).toHaveLength(2);
  await expect(page.getByRole('textbox', { name: '需要保留哪些文字？', exact: true })).toHaveValue(
    '你好月球',
  );
  harness.setRespond(async (request) => prepared(request));
  await harness.generate.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(harness.requests[2]?.requestId).not.toBe(harness.requests[1]?.requestId);
  expect(harness.requests[2]?.previousId).toBe(harness.requests[1]?.previousId);
  expect(harness.requests[2]?.answers).toEqual(harness.requests[1]?.answers);
  expect(harness.counts().jobs).toBe(0);
});

test('does not reuse the same wording and options from another existing project', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  await harness.prompt.fill('月球上的猫，水彩画。');
  await harness.generate.click();
  const quote = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(quote).toBeVisible();
  const original = harness.quoted[0]!;
  // Also simulate an imported draft carrying an ID owned by another project.
  harness.results.get(original.creativeBriefId!)!.input.projectId = original.projectId;
  await quote.getByRole('button', { name: '继续编辑', exact: true }).click();
  const headers = { origin: studio.origin, 'x-workspace-id': harness.account.workspace.id };
  const response = await page.request.post(`${studio.origin}/api/v1/projects`, {
    headers,
    data: { name: '不同项目的同一句需求', kind: 'image', description: original.prompt },
  });
  expect(response.status()).toBe(201);
  const projectId = (await response.json()).data.id as string;
  expect(projectId).not.toBe(original.projectId);
  const saved = await page.request.post(`${studio.origin}/api/v1/projects/${projectId}/messages`, {
    headers,
    data: {
      role: 'user',
      content: original.prompt,
      metadata: {
        draft: {
          ...original,
          projectId,
          documentId: undefined,
          baseRevision: undefined,
          creativeBriefId: original.creativeBriefId,
        },
      },
    },
  });
  expect(saved.status()).toBe(200);
  await page.goto(`${studio.origin}/workbench/${projectId}`);
  const composer = page.locator('.composer');
  await expect(composer.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(
    original.prompt,
  );
  await expect.poll(() => harness.counts().reads).toBeGreaterThan(0);
  await expect(page.getByRole('region', { name: '创作需求检查', exact: true })).toHaveCount(0);
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  await expect(quote).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  expect(harness.requests[1]?.input.projectId).toBe(projectId);
  expect(harness.requests[1]?.previousId).toBeUndefined();
  expect(harness.counts().jobs).toBe(0);
});

test('stops before a paid check if its request record cannot be saved, while retaining a legacy platform', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio, { platform: 'Etsy' });
  const platform = harness.composer.getByRole('combobox', { name: '发布平台', exact: true });
  await expect(platform).toHaveValue('Etsy');
  await expect(platform.locator('option')).toHaveCount(7);
  await harness.prompt.fill('保留原话的水彩猫。');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('yingzao:creative-brief:'))
        throw new Error('Simulated unavailable storage');
      original.call(this, key, value);
    };
  });
  await harness.generate.click();
  await expect(page.getByText('这次理解还没完成', { exact: true })).toBeVisible();
  await expect(harness.prompt).toHaveValue('保留原话的水彩猫。');
  expect(harness.requests).toHaveLength(0);
  expect(harness.quoted).toHaveLength(0);
  expect(harness.counts()).toMatchObject({ projects: 0, jobs: 0 });
});

test('keeps explicit video types aligned with their placement and clears the old placement for free creation', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  await harness.composer.getByRole('button', { name: '视频创作', exact: true }).click();
  await harness.prompt.fill('制作一段清晰的展示视频。');
  const settings = page.getByRole('dialog', { name: '创作设置', exact: true });
  const generate = harness.composer.getByRole('button', { name: '生成视频', exact: true });
  const quote = page.getByRole('dialog', { name: '确认创作', exact: true });
  for (const [choice, placement] of [
    ['product', 'product-video'],
    ['social', 'social-video'],
    ['brand', 'ad-video'],
    ['free', 'general'],
  ]) {
    await harness.composer.getByRole('button', { name: '更多创作设置', exact: true }).click();
    await settings.getByRole('combobox', { name: '创作类型', exact: true }).selectOption(choice!);
    await settings.getByRole('button', { name: '完成', exact: true }).click();
    await generate.click();
    await expect(quote).toBeVisible();
    const input = harness.requests.at(-1)!.input;
    expect(input.options.kind).toBe(choice);
    expect(input.options.creativePlacement ?? 'general').toBe(placement);
    expect(input.prompt).toBe('制作一段清晰的展示视频。');
    await quote.getByRole('button', { name: '继续编辑', exact: true }).click();
  }
  expect(harness.requests).toHaveLength(4);
  expect(harness.requests.every((request) => request.previousId === undefined)).toBe(true);
  expect(harness.counts().jobs).toBe(0);
});

for (const delay of [121_487, 141_000]) {
  test(`accepts a ${delay / 1_000}-second preparation without replacing its request or timing out early`, async ({
    page,
    studio,
  }) => {
    await page.clock.install();
    const harness = await open(page, studio);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.setRespond(async (request) => {
      await barrier;
      return prepared(request);
    });
    await harness.prompt.fill('一只月球上的水彩猫。');
    await harness.generate.click();
    await expect.poll(() => harness.requests.length).toBe(1);
    try {
      await page.clock.fastForward(delay);
      await expect(page.getByRole('region', { name: '创作需求检查', exact: true })).toHaveAttribute(
        'aria-busy',
        'true',
      );
      await expect(page.getByText('这次理解还没完成', { exact: true })).toHaveCount(0);
      expect(harness.requests).toHaveLength(1);
    } finally {
      release();
    }
    await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
    expect(harness.requests).toHaveLength(1);
    expect(harness.counts().jobs).toBe(0);
  });
}

test('times out at the bounded client deadline without automatically replacing or resending its request', async ({
  page,
  studio,
}) => {
  await page.clock.install();
  const harness = await open(page, studio, { confirm: false });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  harness.setRespond(async (request) => {
    await barrier;
    return prepared(request);
  });
  const original = '等待较久的月球水彩猫，原话必须保留。';
  await harness.prompt.fill(original);
  await harness.generate.click();
  await expect.poll(() => harness.requests.length).toBe(1);
  try {
    await page.clock.fastForward(CREATIVE_INTENT_CLIENT_TIMEOUT_MS - 1_000);
    await expect(page.getByRole('region', { name: '创作需求检查', exact: true })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(page.getByText('这次理解还没完成', { exact: true })).toHaveCount(0);
    await page.clock.fastForward(1_000);
    await expect(page.getByText('这次理解还没完成', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '创作需求检查', exact: true })).toContainText(
      '等待服务器确认超时',
    );
    await expect(page.getByRole('region', { name: '创作需求检查', exact: true })).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await expect(page.getByRole('button', { name: '重新检查', exact: true })).toHaveCount(0);
    await expect(harness.prompt).toHaveValue(original);
    expect(harness.requests).toHaveLength(1);
    expect(harness.quoted).toHaveLength(0);
    expect(harness.counts()).toMatchObject({ projects: 0, jobs: 0 });
  } finally {
    release();
  }
  await page.clock.fastForward(30_000);
  await expect(page.getByText('这次理解还没完成', { exact: true })).toBeVisible();
  expect(harness.requests).toHaveLength(1);
  expect(harness.quoted).toHaveLength(0);
  await page.reload();
  await expect(harness.prompt).toHaveValue(original);
  expect(harness.requests).toHaveLength(1);
  harness.setFailureCode('CREATIVE_BRIEF_UNCERTAIN');
  harness.setRespond(async () => null);
  await harness.generate.click();
  await expect.poll(() => harness.requests.length).toBe(2);
  await expect(page.getByText('这次理解还没完成', { exact: true })).toBeVisible();
  expect(harness.requests[1]?.requestId).toBe(harness.requests[0]?.requestId);
  expect(harness.quoted).toHaveLength(0);
  expect(harness.counts()).toMatchObject({ projects: 0, jobs: 0 });
});

test('a cached ready plan uses a free configuration check and waits for explicit reset before replanning', async ({
  page,
  studio,
}) => {
  await page.clock.install();
  const harness = await open(page, studio);
  const original = '月球上看海的猫，水彩画，保留原话与参考。';
  await harness.prompt.fill(original);
  await harness.generate.click();
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  let rejectedReads = 0;
  let changed = true;
  await page.route(/\/api\/v1\/creative-briefs\/[0-9a-f-]{36}$/, async (route) => {
    if (!changed) return route.fallback();
    rejectedReads++;
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'CREATIVE_CONFIGURATION_CHANGED',
          message: '模型配置已改变，请重新整理需求。',
        },
      },
    });
  });
  // Expire only the UI fixture's one-minute quote; the cached ready plan remains in memory.
  await page.clock.fastForward(61_000);
  await harness.generate.click();
  const restart = page.getByRole('button', { name: '重新检查', exact: true });
  await expect(restart).toBeVisible();
  expect(rejectedReads).toBe(1);
  expect(harness.requests).toHaveLength(1);
  expect(harness.quoted).toHaveLength(1);
  await harness.generate.click();
  expect(harness.requests).toHaveLength(1);
  expect(rejectedReads).toBe(1);
  await restart.click();
  await expect(restart).toHaveCount(0);
  expect(harness.requests).toHaveLength(1);
  const key = creativeBriefStorageKey(
    harness.account.user.id,
    harness.account.workspace.id,
    creativeInputFingerprint(harness.requests[0]!.input),
    harness.quoted[0]!.projectId,
  );
  const record = await page.evaluate(
    (storageKey) => JSON.parse(localStorage.getItem(storageKey)!),
    key,
  );
  expect(record.previousId).toBeUndefined();
  expect(record.pending).toBeUndefined();
  expect(record.answers).toEqual([]);
  await page.reload();
  await expect(harness.prompt).toHaveValue(original);
  expect(harness.requests).toHaveLength(1);
  expect(rejectedReads).toBe(1);
  changed = false;
  await harness.generate.click();
  await expect(confirmation).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  expect(harness.requests[1]!.requestId).not.toBe(harness.requests[0]!.requestId);
  expect(harness.requests[1]!.previousId).toBeUndefined();
  expect(harness.requests[1]!.answers).toEqual([]);
  expect(harness.requests[1]!.input.assetIds).toEqual(harness.requests[0]!.input.assetIds);
  expect(harness.counts().jobs).toBe(0);
});

test('a connection change during quotation invalidates the newly bound plan without another paid call', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  let reject = true;
  await page.route('**/api/v1/quotes', async (route) => {
    if (!reject) return route.fallback();
    reject = false;
    await route.fulfill({
      status: 409,
      json: {
        error: { code: 'MODEL_CONNECTION_CHANGED', message: '模型连接已改变，请重新整理需求。' },
      },
    });
  });
  const original = '月球上看海的猫，保持原有画面需求。';
  await harness.prompt.fill(original);
  await harness.generate.click();
  const restart = page.getByRole('button', { name: '重新检查', exact: true });
  await expect(restart).toBeVisible();
  expect(harness.requests).toHaveLength(1);
  expect(harness.counts().projects).toBe(1);
  await expect(harness.prompt).toHaveValue(original);
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toHaveCount(0);
  await restart.click();
  expect(harness.requests).toHaveLength(1);
  await harness.generate.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  expect(harness.requests[1]!.previousId).toBeUndefined();
  expect(harness.requests[1]!.input.projectId).toBeTruthy();
  expect(harness.counts().projects).toBe(1);
  expect(harness.counts().jobs).toBe(0);
});

test('a definite budget rejection preserves the draft and permits a fresh user-requested preparation', async ({
  page,
  studio,
}) => {
  const harness = await open(page, studio);
  harness.setFailureCode('INSUFFICIENT_CREDITS');
  harness.setRespond(async () => null);
  const original = '生成一张好看的口红主图。';
  await harness.prompt.fill(original);
  await harness.generate.click();
  const brief = page.getByRole('region', { name: '创作需求检查', exact: true });
  await expect(brief).toContainText('内容已保留。点击下方按钮重试。');
  await expect(brief).not.toContainText('核对同一次请求');
  await expect(harness.prompt).toHaveValue(original);
  expect(harness.requests).toHaveLength(1);
  expect(harness.counts().projects).toBe(0);
  harness.setRespond(async (request) => prepared(request));
  await harness.generate.click();
  await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
  expect(harness.requests).toHaveLength(2);
  expect(harness.requests[1]!.requestId).not.toBe(harness.requests[0]!.requestId);
  expect(harness.requests[1]!.input.prompt).toBe(original);
  expect(harness.counts().jobs).toBe(0);
});

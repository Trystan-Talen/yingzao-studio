import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Page, Locator } from '@playwright/test';
import type { Actor, AssetDto } from '../../src/contracts/core';
import type { JobInput } from '../../src/contracts/jobs';
import type { CreativePreparation } from '../../src/contracts/creative-intent';
import {
  CREATIVE_INTENT_CLIENT_TIMEOUT_MS,
  CREATIVE_REPLICA_CLIENT_TIMEOUT_MS,
} from '../../src/contracts/creative-intent-timing';
import { test, expect, type Studio } from './fixtures';

test.use({ experienceProviders: false, recoveryEnabled: false, smsEnabled: false });

async function open(page: Page, studio: Studio, video = false) {
  const account = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  studio.services.core.auth.update(actor, {
    preferences: { onboardingCompleted: true, confirmGeneration: false },
  });
  for (const kind of ['text', 'image', 'video'] as const)
    studio.services.settings.connections.update(account.workspace.id, {
      kind,
      protocol:
        kind === 'text' ? 'openai-chat' : kind === 'image' ? 'seedream-images' : 'seedance-native',
      baseUrl:
        kind === 'video'
          ? 'https://reference-fixture.invalid/api/v3/contents/generations/tasks'
          : 'https://reference-fixture.invalid/v1',
      modelsUrl: '',
      model:
        kind === 'text'
          ? 'fixture-planner'
          : kind === 'image'
            ? 'doubao-seedream-5.0-lite'
            : 'doubao-seedance-2.0',
      ...(kind === 'text' ? { visionModel: 'fixture-vision' } : {}),
      enabled: true,
      secret: 'unused-isolated-reference-fixture',
    });
  const image = await sharp({
    create: { width: 2048, height: 2048, channels: 3, background: '#723410' },
  })
    .png()
    .toBuffer();
  const ingest = (buffer: Buffer, name: string, mimeType = 'image/png') =>
    studio.services.core.assets.ingest(actor, account.workspace.id, {
      buffer,
      name,
      mimeType,
      source: 'import',
      tags: [],
    });
  const subject = await ingest(image, '要保留的主体.png');
  const style = await ingest(await sharp(image).negate().png().toBuffer(), '仅借鉴风格.png');
  let reference = style;
  if (video) {
    const path = join(studio.folder, '参考节奏.mp4');
    await promisify(execFile)('ffmpeg', [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=640x360:d=10',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-y',
      path,
    ]);
    reference = await ingest(await readFile(path), '只借鉴镜头与节奏.mp4', 'video/mp4');
  }
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const requests: { requestId: string; input: JobInput }[] = [];
  const results = new Map<string, CreativePreparation>();
  const quoted: JobInput[] = [];
  let jobs = 0;
  let respond = async (request: { requestId: string; input: JobInput }) => prepared(request);
  await page.route('**/api/v1/creative-briefs/prepare', async (route) => {
    const request = route.request().postDataJSON();
    requests.push(request);
    const result = await respond(request);
    results.set(result.id, result);
    await route.fulfill({ json: { data: result } });
  });
  await page.route(/\/api\/v1\/creative-briefs\/[0-9a-f-]{36}$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    await route.fulfill({ json: { data: results.get(id) } });
  });
  await page.route('**/api/v1/quotes', async (route) => {
    const input = route.request().postDataJSON() as JobInput;
    quoted.push(input);
    await route.fulfill({
      json: {
        data: {
          id: randomUUID(),
          inputHash: 'isolated-reference-ui',
          pricingVersion: 'isolated-reference-ui',
          maxCredits: 8,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          providerId: input.providerId,
          operation: input.operation,
          units: 1,
        },
      },
    });
  });
  await page.route('**/api/v1/jobs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    jobs++;
    await route.fulfill({
      status: 400,
      json: { error: { code: 'ISOLATED_STOP', message: '隔离验收不提交生成任务' } },
    });
  });
  await page.goto(studio.origin);
  const composer = page.locator('.composer[data-presentation="quick"]');
  await expect(composer).toBeVisible();
  return {
    account,
    actor,
    composer,
    subject,
    style,
    reference,
    image,
    requests,
    results,
    quoted,
    jobs: () => jobs,
    setRespond: (next: typeof respond) => {
      respond = next;
    },
  };
}

function prepared(request: { requestId: string; input: JobInput }): CreativePreparation {
  const id = randomUUID(),
    video = request.input.operation === 'video.generate',
    now = new Date().toISOString();
  const duration = request.input.replica?.trimDuration ?? 10;
  const timestamps = video ? [0, duration / 4, duration / 2, (duration * 3) / 4, duration] : [0];
  return {
    id,
    status: 'ready',
    input: { ...request.input, creativeBriefId: id },
    result: {
      type: 'intent-plan',
      version: 1,
      requestId: request.requestId,
      status: 'ready',
      brief: {
        scope: 'product',
        subject: '用户主体',
        goal: '参考重新创作',
        mediaType: video ? 'video' : 'image',
        platform: request.input.options.platform,
        placement: request.input.options.creativePlacement ?? 'general',
        productMode: 'reference',
        facts: [],
        constraints: ['保留主体外观'],
      },
      summary: '借鉴参考画面，为用户主体重新创作。',
      assumptions: [],
      questions: [],
      prompt: '保留用户主体，借鉴参考光线与布局。',
      reviewChecklist: [],
      ...(video
        ? {
            generationPlan: {
              imagePrompt: '用户主体的新场景首帧',
              videoPrompt: '按选段分析的节奏缓慢移动',
            },
          }
        : {}),
    },
    referenceStudy: {
      study: {
        version: 1,
        referenceKind: video ? 'video' : 'image',
        visualStatus: 'readable',
        observations: ['参考采用侧光与简洁背景'],
        motion: video
          ? { description: '画面为静态采样示例', uncertainties: ['采样间运动无法逐帧确认'] }
          : null,
        timeline: video
          ? timestamps.map((timestampSeconds) => ({
              timestampSeconds,
              description: '采样画面可观察内容',
            }))
          : [],
        anchorFrameIndex: 0,
        transferGuidance: '只迁移侧光和构图，保留主体图片中的外观。',
        limitations: ['不保证成为爆款，也不直接复制参考商品'],
      },
      evidence: {
        version: 1,
        referenceKind: video ? 'video' : 'image',
        referenceSha256: 'a'.repeat(64),
        subjectSha256: 'b'.repeat(64),
        subjectImageSha256: 'c'.repeat(64),
        model: 'fixture-vision',
        sampledAt: now,
        analyzedAt: now,
        timestampBasis: 'relative-to-selected-clip',
        clipStartSeconds: request.input.replica?.trimStart ?? 0,
        clipDurationSeconds: video ? duration : 0,
        ...(video ? { sourceDurationSeconds: 10 } : {}),
        audioAnalyzed: false,
        frames: timestamps.map((timestampSeconds, index) => ({
          index,
          timestampSeconds,
          sourceTimestampSeconds: timestampSeconds + (request.input.replica?.trimStart ?? 0),
          sha256: 'd'.repeat(64),
          width: 640,
          height: 360,
        })),
      },
    },
  };
}

async function selectAsset(page: Page, composer: Locator, label: string, asset: AssetDto) {
  const picker = composer
    .locator('.asset-picker')
    .filter({ has: page.getByText(label, { exact: true }) });
  await picker.getByRole('button', { name: '添加素材', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .locator('.asset-select')
    .filter({ has: page.getByText(asset.name, { exact: true }) })
    .click();
  await dialog.getByRole('button', { name: '完成选择', exact: true }).click();
  await expect(picker).toContainText(asset.name);
}

for (const kind of ['image', 'video'] as const) {
  test(`${kind} reference recreation keeps material roles and requires the frozen study even when ordinary confirmation is disabled`, async ({
    page,
    studio,
  }) => {
    const f = await open(page, studio, kind === 'video');
    if (kind === 'video')
      await f.composer.getByRole('button', { name: '视频创作', exact: true }).click();
    await f.composer
      .getByRole('combobox', { name: '创作模式', exact: true })
      .selectOption('replica');
    await f.composer
      .getByRole('textbox', { name: '创作需求', exact: true })
      .fill('借鉴侧光与布局，完整保留我的主体');
    await selectAsset(
      page,
      f.composer,
      kind === 'image' ? '风格参考图片' : '节奏与镜头参考视频',
      f.reference,
    );
    await selectAsset(page, f.composer, '需要保留的主体图片', f.subject);
    if (kind === 'video') {
      await f.composer.getByLabel('参考选段起点（秒）', { exact: true }).fill('2');
      await f.composer.getByLabel(/^参考选段时长（秒）/).fill('3');
      await expect(f.composer.getByText('参考区间', { exact: false }).first()).toContainText(
        '2.0 – 5.0',
      );
    }
    await f.composer
      .getByRole('button', { name: kind === 'image' ? '生成图片' : '生成视频', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: '确认创作', exact: true });
    await expect(dialog.getByRole('region', { name: '参考复刻方案', exact: true })).toBeVisible();
    await expect(dialog).toContainText('只迁移侧光和构图，保留主体图片中的外观。');
    await expect(dialog).toContainText('不保证成为爆款，也不直接复制参考商品');
    await expect(dialog.getByRole('button', { name: '确认并提交', exact: true })).toBeEnabled();
    expect(f.requests).toHaveLength(1);
    expect(f.quoted).toHaveLength(1);
    expect(f.jobs()).toBe(0);
    expect(f.quoted[0]).toMatchObject({
      providerId: 'native',
      assetIds: [f.subject.id],
      referenceAssetIds: [f.reference.id],
      replica: {
        subjectAssetId: f.subject.id,
        referenceAssetId: f.reference.id,
        ...(kind === 'video' ? { trimStart: 2, trimDuration: 3 } : { trimStart: 0 }),
      },
    });
    expect(f.quoted[0]!.nativeReplica).toBeUndefined();
    expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
      n: 0,
    });
    expect(
      await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(f.composer.getByRole('combobox', { name: '创作模式', exact: true })).toHaveValue(
      'replica',
    );
    await expect(f.composer.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(
      '借鉴侧光与布局，完整保留我的主体',
    );
    expect(f.requests).toHaveLength(1);
  });
}

test('isolates all four drafts and returns a delayed uploaded reference to its original mode and role', async ({
  page,
  studio,
}) => {
  const f = await open(page, studio);
  const mode = f.composer.getByRole('combobox', { name: '创作模式', exact: true });
  const prompt = f.composer.getByRole('textbox', { name: '创作需求', exact: true });
  await prompt.fill('图片原创草稿');
  const characterId = randomUUID();
  const draftKey = `yingzao:creation:v1:${f.account.user.id}:${f.account.workspace.id}:new`;
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.input.prompt,
        draftKey,
      ),
    )
    .toBe('图片原创草稿');
  await page.evaluate(
    ({ key, characterId }) => {
      const record = JSON.parse(localStorage.getItem(key)!);
      for (const input of [
        record.input,
        record.drafts.image,
        record.modeDrafts?.['image:original']?.input,
      ]) {
        if (input) {
          input.characterId = characterId;
          input.characterRevision = 1;
        }
      }
      localStorage.setItem(key, JSON.stringify(record));
    },
    { key: draftKey, characterId },
  );
  await page.reload();
  await expect(prompt).toHaveValue('图片原创草稿');
  await mode.selectOption('replica');
  await prompt.fill('图片复刻草稿');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploadedId: string | undefined;
  await page.route('**/api/v1/assets/upload', async (route) => {
    const response = await route.fetch();
    uploadedId = (await response.json()).data.id;
    await held;
    await route.fulfill({ response });
  });
  const picker = f.composer
    .locator('.asset-picker')
    .filter({ has: page.getByText('风格参考图片', { exact: true }) });
  await picker
    .locator('input[type=file]')
    .setInputFiles({ name: '延迟风格参考.png', mimeType: 'image/png', buffer: f.image });
  try {
    await expect.poll(() => uploadedId).toBeTruthy();
    await mode.selectOption('original');
    await expect(prompt).toHaveValue('图片原创草稿');
    await f.composer.getByRole('button', { name: '视频创作', exact: true }).click();
    await prompt.fill('视频原创草稿');
    await mode.selectOption('replica');
    await prompt.fill('视频复刻草稿');
    release();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = Object.keys(localStorage)
            .filter((key) => key.startsWith('yingzao:creation:'))
            .map((key) => JSON.parse(localStorage.getItem(key)!));
          return raw.some(
            (value) => value.modeDrafts?.['image:replica']?.input.referenceAssetIds?.length === 1,
          );
        }),
      )
      .toBe(true);
    await expect(f.composer.getByRole('textbox', { name: '创作需求', exact: true })).toHaveValue(
      '视频复刻草稿',
    );
    await expect(f.composer.getByText('延迟风格参考.png', { exact: true })).toHaveCount(0);
    await f.composer.getByRole('button', { name: '图片创作', exact: true }).click();
    await expect(mode).toHaveValue('original');
    await expect(prompt).toHaveValue('图片原创草稿');
    await mode.selectOption('replica');
    await expect(prompt).toHaveValue('图片复刻草稿');
    await expect(picker).toContainText('延迟风格参考.png');
    await page.reload();
    await expect(mode).toHaveValue('replica');
    await expect(prompt).toHaveValue('图片复刻草稿');
    await mode.selectOption('original');
    await expect(prompt).toHaveValue('图片原创草稿');
    await f.composer.getByRole('button', { name: '视频创作', exact: true }).click();
    await expect(mode).toHaveValue('replica');
    await expect(prompt).toHaveValue('视频复刻草稿');
    await mode.selectOption('original');
    await expect(prompt).toHaveValue('视频原创草稿');
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const record = JSON.parse(localStorage.getItem(key)!);
          return {
            original: record.modeDrafts?.['image:original']?.input.characterId,
            replica: record.modeDrafts?.['image:replica']?.input.characterId ?? null,
            video: record.modeDrafts?.['video:original']?.input.characterId ?? null,
          };
        }, draftKey),
      )
      .toEqual({ original: characterId, replica: null, video: null });
    expect(f.requests).toHaveLength(0);
    expect(f.quoted).toHaveLength(0);
    expect(f.jobs()).toBe(0);
  } finally {
    release();
  }
});

test('keeps a late reference study with its original draft and blocks confirmation until the owned plan can be read', async ({
  page,
  studio,
}) => {
  const f = await open(page, studio);
  const mode = f.composer.getByRole('combobox', { name: '创作模式', exact: true });
  const prompt = f.composer.getByRole('textbox', { name: '创作需求', exact: true });
  await mode.selectOption('replica');
  await prompt.fill('同一主体，仅参考侧光');
  await selectAsset(page, f.composer, '风格参考图片', f.reference);
  await selectAsset(page, f.composer, '需要保留的主体图片', f.subject);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.setRespond(async (request) => {
    await held;
    return prepared(request);
  });
  try {
    await f.composer.getByRole('button', { name: '生成图片', exact: true }).click();
    await expect.poll(() => f.requests.length).toBe(1);
    await mode.selectOption('original');
    await prompt.fill('新的原创需求，不能沿用复刻方案');
    release();
    await expect.poll(() => f.results.size).toBe(1);
    await expect(prompt).toHaveValue('新的原创需求，不能沿用复刻方案');
    await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toHaveCount(0);
    expect(f.quoted).toHaveLength(0);
    expect(f.jobs()).toBe(0);
    await mode.selectOption('replica');
    await expect(prompt).toHaveValue('同一主体，仅参考侧光');
    await f.composer.getByText('需求已整理，查看详情', { exact: true }).click();
    await expect(
      f.composer.getByRole('region', { name: '参考复刻方案', exact: true }),
    ).toBeVisible();
    let reads = 0;
    let broken = true;
    await page.route(/\/api\/v1\/creative-briefs\/[0-9a-f-]{36}$/, async (route) => {
      reads++;
      // The hook's pre-quote refresh succeeds; the independently loaded confirmation must fail closed.
      if (reads === 1 || !broken) return route.fallback();
      await route.fulfill({
        status: 503,
        json: { error: { code: 'PLAN_READ_FAILED', message: '隔离读取失败' } },
      });
    });
    await f.composer.getByRole('button', { name: '生成图片', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认创作', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '确认并提交', exact: true })).toBeDisabled();
    await expect(dialog).toContainText('本次复刻方案未能读取或已失效');
    expect(f.requests).toHaveLength(1);
    expect(f.quoted).toHaveLength(1);
    expect(f.jobs()).toBe(0);
    broken = false;
    await dialog.getByRole('button', { name: '重试读取方案', exact: true }).click();
    await expect(dialog.getByRole('region', { name: '参考复刻方案', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '确认并提交', exact: true })).toBeEnabled();
    expect(f.requests).toHaveLength(1);
    expect(f.jobs()).toBe(0);
  } finally {
    release();
  }
});

test('shows the reference role controls in English and prevents selecting the subject itself as the style reference', async ({
  page,
  studio,
}) => {
  const f = await open(page, studio);
  await f.composer.getByRole('combobox', { name: '创作模式', exact: true }).selectOption('replica');
  await f.composer.getByRole('textbox', { name: '创作需求', exact: true }).fill('保持主体');
  await selectAsset(page, f.composer, '风格参考图片', f.subject);
  await selectAsset(page, f.composer, '需要保留的主体图片', f.subject);
  await expect(f.composer).toContainText('参考素材与主体图片必须是不同素材。');
  await expect(f.composer.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  studio.services.core.auth.update(f.actor, { preferences: { locale: 'en' } });
  await page.reload();
  await expect(
    f.composer.getByRole('combobox', { name: 'Creation mode', exact: true }),
  ).toHaveValue('replica');
  await expect(f.composer).toContainText('Style reference image');
  await expect(f.composer).toContainText('Subject image to preserve');
  await expect(
    f.composer.getByRole('group', { name: 'Reference aspects', exact: true }),
  ).toBeVisible();
  await expect(f.composer).not.toContainText('无法恢复本机草稿');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(f.requests).toHaveLength(0);
  expect(f.quoted).toHaveLength(0);
  expect(f.jobs()).toBe(0);
});

for (const mode of ['replica', 'referenced-original'] as const) {
  test(`${mode} waits for the longer reference analysis deadline and preserves the same request after an unknown timeout`, async ({
    page,
    studio,
  }) => {
    await page.clock.install();
    const f = await open(page, studio);
    if (mode === 'referenced-original') {
      studio.services.core.auth.update(f.actor, { preferences: { confirmGeneration: true } });
      await page.reload();
    } else {
      await f.composer
        .getByRole('combobox', { name: '创作模式', exact: true })
        .selectOption('replica');
    }
    await f.composer
      .getByRole('textbox', { name: '创作需求', exact: true })
      .fill('等待视觉分析，保持主体');
    if (mode === 'replica') {
      await selectAsset(page, f.composer, '风格参考图片', f.reference);
      await selectAsset(page, f.composer, '需要保留的主体图片', f.subject);
    } else {
      await selectAsset(page, f.composer, '参考图片、视频或文档', f.subject);
    }
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.setRespond(async (request) => {
      await held;
      return prepared(request);
    });
    const generate = f.composer.getByRole('button', { name: '生成图片', exact: true });
    try {
      await generate.click();
      await expect.poll(() => f.requests.length).toBe(1);
      const inspection = f.composer.getByRole('region', { name: '创作需求检查', exact: true });
      await page.clock.fastForward(CREATIVE_INTENT_CLIENT_TIMEOUT_MS + 1_000);
      await expect(inspection).toHaveAttribute('aria-busy', 'true');
      expect(f.requests).toHaveLength(1);
      await page.clock.fastForward(
        CREATIVE_REPLICA_CLIENT_TIMEOUT_MS - CREATIVE_INTENT_CLIENT_TIMEOUT_MS - 1_000,
      );
      await expect(inspection).toHaveAttribute('aria-busy', 'false');
      await expect(inspection).toContainText('等待服务器确认超时');
      await expect(f.composer.getByRole('button', { name: '重新检查', exact: true })).toHaveCount(
        0,
      );
      expect(f.quoted).toHaveLength(0);
      expect(f.jobs()).toBe(0);
      release();
      await page.clock.fastForward(30_000);
      expect(f.requests).toHaveLength(1);
      // The isolated server clock did not advance; restore browser wall time before reading new capability leases.
      await page.clock.setSystemTime(new Date());
      await page.reload();
      expect(f.requests).toHaveLength(1);
      await generate.click();
      await expect.poll(() => f.requests.length).toBe(2);
      expect(f.requests[1]!.requestId).toBe(f.requests[0]!.requestId);
      await expect(page.getByRole('dialog', { name: '确认创作', exact: true })).toBeVisible();
      expect(f.jobs()).toBe(0);
    } finally {
      release();
    }
  });
}

test('refreshes expired capabilities after a completed reference study without another paid preparation', async ({
  page,
  studio,
}) => {
  const f = await open(page, studio);
  await f.composer.getByRole('combobox', { name: '创作模式', exact: true }).selectOption('replica');
  await f.composer
    .getByRole('textbox', { name: '创作需求', exact: true })
    .fill('视觉分析完成后继续同一份方案');
  await selectAsset(page, f.composer, '风格参考图片', f.reference);
  await selectAsset(page, f.composer, '需要保留的主体图片', f.subject);
  const rejected: JobInput[] = [];
  let rejectOnce = true;
  await page.route('**/api/v1/quotes', async (route) => {
    if (!rejectOnce) return route.fallback();
    rejectOnce = false;
    rejected.push(route.request().postDataJSON());
    studio.services.settings.modelCapabilities.invalidate(f.account.workspace.id, 'native');
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'CAPABILITY_CHANGED',
          message: '模型参数已更新或过期，请重新读取并确认选项。',
        },
      },
    });
  });
  const generate = f.composer.getByRole('button', { name: '生成图片', exact: true });
  await generate.click();
  await expect(f.composer).toContainText(
    '模型信息已重新核查，草稿已保留。请再次点击生成并确认报价。',
  );
  expect(f.requests).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(f.quoted).toHaveLength(0);
  expect(f.jobs()).toBe(0);
  await generate.click();
  const dialog = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(dialog.getByRole('region', { name: '参考复刻方案', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认并提交', exact: true })).toBeEnabled();
  expect(f.requests).toHaveLength(1);
  expect(f.quoted).toHaveLength(1);
  expect(f.quoted[0]!.creativeBriefId).toBe(rejected[0]!.creativeBriefId);
  expect(f.quoted[0]!.capabilityRevision).not.toBe(rejected[0]!.capabilityRevision);
  expect(f.jobs()).toBe(0);
});

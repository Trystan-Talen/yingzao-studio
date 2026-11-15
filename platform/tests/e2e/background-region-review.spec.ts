import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { jobInputSchema, type JobDto, type QuoteDto } from '../../src/contracts/jobs';
import { nativeArtifactFingerprint } from '../../src/server/tasks/native-artifacts';
import { composeNativeBackground } from '../../src/server/providers/native-background';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

/** A completed synthetic candidate is the starting state, not a claim of model quality.
 * Every subsequent upload, confirmation, quote, execution and media read uses the real app. */
async function candidate(page: Page, studio: Studio) {
  const account = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const wid = account.workspace.id;
  studio.services.core.auth.update(actor, {
    preferences: { onboardingCompleted: true, confirmGeneration: true, theme: 'light' },
  });
  // Unresolvable, explicitly synthetic endpoints: success cannot depend on a paid model.
  for (const kind of ['text', 'image'] as const)
    studio.services.settings.connections.update(wid, {
      kind,
      protocol: kind === 'text' ? 'openai-chat' : 'seedream-images',
      baseUrl: 'https://background-review-fixture.invalid/v1',
      modelsUrl: '',
      model: kind === 'text' ? 'fixture-planner' : 'doubao-seedream-5.0-lite',
      secret: 'isolated-unused-fixture',
      enabled: true,
    });
  const size = 2048;
  const sourceBuffer = await sharp({
    create: { width: size, height: size, channels: 3, background: '#1e3c5a' },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 1024, height: 1024, channels: 3, background: '#c82818' },
        })
          .png()
          .toBuffer(),
        left: 512,
        top: 512,
      },
    ])
    .png()
    .toBuffer();
  const gray = Buffer.alloc(size * size, 255);
  for (let y = 512; y < 1536; y++) {
    gray.fill(128, y * size + 496, y * size + 512);
    gray.fill(0, y * size + 512, y * size + 1536);
  }
  const maskBuffer = await sharp(gray, { raw: { width: size, height: size, channels: 1 } })
    .png()
    .toBuffer();
  const color = '#e6e8eb';
  async function ingest(buffer: Buffer, name: string) {
    return studio.services.core.assets.ingest(actor, wid, {
      buffer,
      name,
      mimeType: 'image/png',
      source: 'import',
      tags: ['隔离背景区域验收'],
    });
  }
  const source = await ingest(sourceBuffer, '保留主体的原图.png');
  const mask = await ingest(maskBuffer, '候选灰度蒙版.png');
  const output = await ingest(
    await composeNativeBackground(sourceBuffer, maskBuffer, color),
    '待调整的背景候选.png',
  );
  const input = jobInputSchema.parse({
    providerId: 'native',
    operation: 'image.generate',
    prompt: '仅替换背景为#e6e8eb，保留原图主体。',
    assetIds: [source.id],
    options: { model: 'doubao-seedream-5.0-lite', ratio: '1:1', resolution: '2K' },
    nativeRevision: studio.services.settings.connections.revision(wid, 'image.generate'),
    imageEdit: {
      type: 'solid-background',
      sourceAssetId: source.id,
      color,
      regionDescription: '主体以外的背景',
      preserveDescription: '原图主体颜色、位置和形状',
      mask: { mode: 'generate' },
    },
  });
  const jobId = randomUUID(),
    itemId = randomUUID(),
    at = new Date().toISOString(),
    fingerprint = nativeArtifactFingerprint(input),
    sql = studio.services.db.sqlite;
  sql
    .prepare(
      `INSERT INTO jobs(id,workspace_id,user_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,settled_credits,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,'succeeded','complete',0,0,?,?)`,
    )
    .run(
      jobId,
      wid,
      actor.userId,
      input.operation,
      input.providerId,
      input.prompt,
      JSON.stringify(input),
      fingerprint,
      randomUUID(),
      'synthetic-completed-candidate',
      at,
      at,
    );
  sql
    .prepare(
      `INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,phase,credits,asset_id,next_attempt_at,created_at,updated_at)
       VALUES(?,?,?,?,0,?,'succeeded','complete',0,?,?,?,?)`,
    )
    .run(itemId, jobId, wid, actor.userId, JSON.stringify(input), output.id, at, at, at);
  sql
    .prepare('INSERT INTO native_generation_checkpoints VALUES(?,?,?,?,?,?)')
    .run(itemId, wid, 'background-mask', mask.id, fingerprint, at);
  sql.prepare('INSERT INTO native_generation_provenance VALUES(?,?,?,?,?,?)').run(
    itemId,
    wid,
    output.id,
    fingerprint,
    JSON.stringify({
      method: 'exact-background-v1',
      sourceAssetId: source.id,
      maskAssetIds: { normalized: mask.id },
      color,
    }),
    at,
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
  return { actor, wid, source, mask, output, sourceBuffer, jobId, itemId, color };
}

test('corrects a candidate mask through the real editor and preserves source pixels at zero credits without model access', async ({
  page,
  studio,
}) => {
  const fixture = await candidate(page, studio);
  const before = studio.services.credits.account(fixture.wid);
  const quoted: QuoteDto[] = [];
  const submitted: JobDto[] = [];
  let planningRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/creative-briefs/prepare') planningRequests++;
  });
  page.on('response', async (response) => {
    if (response.request().method() !== 'POST' || !response.ok()) return;
    const path = new URL(response.url()).pathname;
    if (path === '/api/v1/quotes') quoted.push((await response.json()).data as QuoteDto);
    if (path === '/api/v1/jobs') submitted.push((await response.json()).data as JobDto);
  });
  await page.goto(`${studio.origin}/tasks`);
  const originalCard = page.locator(`[data-job-id="${fixture.jobId}"]`);
  await originalCard.getByRole('link', { name: '查看作品', exact: true }).click();
  await page
    .locator(`[data-job-id="${fixture.jobId}"][data-compact="false"]`)
    .getByRole('button', { name: '调整背景区域', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '调整背景区域', exact: true });
  const canvas = dialog.locator('canvas');
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => {
        const ctx = element.getContext('2d')!;
        return [
          ctx.getImageData(128, 128, 1, 1).data[3],
          ctx.getImageData(1024, 1024, 1, 1).data[3],
          ctx.getImageData(500, 800, 1, 1).data[3],
        ];
      }),
    )
    .toEqual([255, 0, 128]);
  await dialog.getByRole('button', { name: '橡皮', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width / 16, bounds!.y + bounds!.height / 16);
  await expect(
    dialog.getByRole('button', { name: '确认区域并本机合成', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: '保存背景区域', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '确认区域并本机合成', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: '确认区域并本机合成', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认创作', exact: true });
  await expect(confirmation.getByLabel('预留积分上限')).toContainText('0');
  await confirmation.getByRole('button', { name: '确认并提交', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  const jobId = submitted[0]!.id;
  await expect
    .poll(
      () =>
        (
          studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(jobId) as {
            status: string;
          }
        ).status,
    )
    .toBe('succeeded');
  expect(planningRequests).toBe(0);
  expect(quoted).toHaveLength(1);
  expect(quoted[0]!.maxCredits).toBe(0);
  const item = studio.services.db.sqlite
    .prepare('SELECT asset_id,remote_id,credits,input_json FROM job_items WHERE job_id=?')
    .get(jobId) as {
    asset_id: string;
    remote_id: string | null;
    credits: number;
    input_json: string;
  };
  expect(item.remote_id).toBeNull();
  expect(item.credits).toBe(0);
  const frozen = jobInputSchema.parse(JSON.parse(item.input_json));
  expect(frozen.imageEdit).toMatchObject({
    sourceAssetId: fixture.source.id,
    color: fixture.color,
    mask: { mode: 'asset' },
  });
  const media = await studio.services.core.assets.readOriginal(
    fixture.actor,
    fixture.wid,
    item.asset_id,
  );
  const pixels = await sharp(media.buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([pixels.info.width, pixels.info.height]).toEqual([2048, 2048]);
  const pixel = (x: number, y: number) =>
    Array.from(pixels.data.subarray((y * 2048 + x) * 3, (y * 2048 + x) * 3 + 3));
  expect(pixel(128, 128)).toEqual([30, 60, 90]); // the manually protected patch
  expect(pixel(1800, 128)).toEqual([230, 232, 235]); // unchanged editable background
  expect(pixel(1024, 1024)).toEqual([200, 40, 24]); // protected subject
  expect(pixel(500, 800)).toEqual([130, 146, 163]); // preserved 128/255 soft edge
  const original = await studio.services.core.assets.readOriginal(
    fixture.actor,
    fixture.wid,
    fixture.source.id,
  );
  expect(createHash('sha256').update(original.buffer).digest('hex')).toBe(
    createHash('sha256').update(fixture.sourceBuffer).digest('hex'),
  );
  expect(studio.services.credits.account(fixture.wid)).toEqual(before);
  expect(
    studio.services.db.sqlite
      .prepare('SELECT COALESCE(SUM(ABS(amount)),0) amount FROM credit_ledger WHERE job_id=?')
      .get(jobId),
  ).toEqual({ amount: 0 });
  await page.reload();
  await expect(page.locator(`[data-job-id="${jobId}"]`).first()).toHaveAttribute(
    'data-status',
    'succeeded',
  );
  await expect(page.locator(`[data-job-id="${fixture.jobId}"]`)).toBeVisible();
  await page.screenshot({
    path: join(studio.folder, 'background-review-local-result.png'),
    fullPage: true,
  });
});

for (const operation of ['image-inpaint', 'image-erase'] as const) {
  test(`${operation} retains the existing alpha mask contract when restoring, painting, saving and reopening a tool draft`, async ({
    page,
    studio,
  }) => {
    const fixture = await candidate(page, studio);
    const alpha = Buffer.alloc(2048 * 2048 * 4);
    for (let y = 0; y < 2048; y++)
      for (let x = 0; x < 2048; x++)
        alpha[(y * 2048 + x) * 4 + 3] =
          x < 256 && y < 256 ? 0 : x >= 496 && x < 512 && y >= 512 && y < 1536 ? 128 : 255;
    const oldMask = await studio.services.core.assets.ingest(fixture.actor, fixture.wid, {
      buffer: await sharp(alpha, { raw: { width: 2048, height: 2048, channels: 4 } })
        .png()
        .toBuffer(),
      name: '已有透明区域蒙版.png',
      mimeType: 'image/png',
      source: 'import',
      tags: [],
    });
    const headers = { origin: studio.origin, 'x-workspace-id': fixture.wid };
    const created = await page.request.post(`${studio.origin}/api/v1/projects`, {
      headers,
      data: { name: '已有工具区域', kind: 'image' },
    });
    expect(created.status()).toBe(201);
    const project = (await created.json()).data as { id: string };
    const input = jobInputSchema.parse({
      operation,
      providerId: 'openai',
      projectId: project.id,
      assetIds: [fixture.source.id],
      maskAssetId: oldMask.id,
      prompt: '仅修改已经标记的区域',
      options: { model: 'gpt-image-2', ratio: '1:1', resolution: '2K' },
    });
    const written = await page.request.post(
      `${studio.origin}/api/v1/projects/${project.id}/messages`,
      { headers, data: { role: 'user', content: input.prompt, metadata: { draft: input } } },
    );
    expect(written.status()).toBe(200);
    const uploaded: string[] = [];
    let generationRequests = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        ['/api/v1/quotes', '/api/v1/jobs', '/api/v1/creative-briefs/prepare'].includes(
          new URL(request.url()).pathname,
        )
      )
        generationRequests++;
    });
    page.on('response', async (response) => {
      if (
        response.request().method() === 'POST' &&
        response.ok() &&
        new URL(response.url()).pathname === '/api/v1/assets/upload'
      )
        uploaded.push((await response.json()).data.id as string);
    });
    await page.goto(`${studio.origin}/tools/${operation}?projectId=${project.id}`);
    const editor = page.locator('.mask-editor'),
      canvas = editor.locator('canvas');
    await expect
      .poll(() =>
        canvas.evaluate((element: HTMLCanvasElement) => {
          const ctx = element.getContext('2d')!;
          return [
            ctx.getImageData(128, 128, 1, 1).data[3],
            ctx.getImageData(1024, 1024, 1, 1).data[3],
            ctx.getImageData(500, 800, 1, 1).data[3],
          ];
        }),
      )
      .toEqual([255, 0, 127]);
    const saveName = operation === 'image-erase' ? '保存消除区域' : '保存重绘区域';
    await expect(editor.getByRole('button', { name: saveName, exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: '清空', exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await editor.getByRole('button', { name: saveName, exact: true }).click();
    await expect.poll(() => uploaded.length).toBe(1);
    const saved = await studio.services.core.assets.readOriginal(
      fixture.actor,
      fixture.wid,
      uploaded[0]!,
    );
    const mask = await sharp(saved.buffer).raw().toBuffer({ resolveWithObject: true });
    expect([mask.info.width, mask.info.height, mask.info.channels]).toEqual([2048, 2048, 4]);
    expect(mask.data[(1024 * 2048 + 1024) * 4 + 3]).toBe(0);
    expect(mask.data[(128 * 2048 + 128) * 4 + 3]).toBe(255);
    await page.getByRole('button', { name: '保存为项目', exact: true }).click();
    await expect
      .poll(() => {
        const rows = studio.services.db.sqlite
          .prepare('SELECT metadata_json FROM messages WHERE project_id=? ORDER BY created_at DESC')
          .all(project.id) as { metadata_json: string | null }[];
        return rows.some(
          (row) =>
            row.metadata_json && JSON.parse(row.metadata_json).draft?.maskAssetId === uploaded[0],
        );
      })
      .toBe(true);
    await page.goto(`${studio.origin}/tools/${operation}?projectId=${project.id}`);
    await expect
      .poll(() =>
        canvas.evaluate((element: HTMLCanvasElement) => {
          const ctx = element.getContext('2d')!;
          return [
            ctx.getImageData(128, 128, 1, 1).data[3],
            ctx.getImageData(1024, 1024, 1, 1).data[3],
          ];
        }),
      )
      .toEqual([0, 255]);
    expect(generationRequests).toBe(0);
    expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
      n: 1,
    });
  });
}

test('presents background review and soft-edge editing in English without translating the user original or submitting a job', async ({
  page,
  studio,
}) => {
  const fixture = await candidate(page, studio);
  studio.services.core.auth.update(fixture.actor, { preferences: { locale: 'en' } });
  let billableRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      ['/api/v1/quotes', '/api/v1/jobs', '/api/v1/creative-briefs/prepare'].includes(
        new URL(request.url()).pathname,
      )
    )
      billableRequests++;
  });
  await page.goto(`${studio.origin}/tasks?job=${fixture.jobId}`);
  const card = page.locator(`[data-job-id="${fixture.jobId}"][data-compact="false"]`);
  await expect(card).toContainText('Background candidate · Review needed');
  await card.getByRole('button', { name: 'Adjust background area', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Adjust background area', exact: true });
  await expect(dialog).toContainText('without model calls');
  await expect(dialog).toContainText('The automatic mask is an unreviewed candidate.');
  await expect(
    dialog.getByRole('button', { name: 'Save background area', exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole('button', { name: 'Confirm area and composite locally', exact: true }),
  ).toBeDisabled();
  const softness = dialog.getByRole('slider', { name: /^Edge softness/ });
  await softness.focus();
  await softness.press('End');
  expect(Number(await softness.inputValue())).toBeGreaterThan(0);
  const canvas = dialog.getByLabel('Adjust the background area to replace on the original image', {
    exact: true,
  });
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const nonAccumulating = dialog.getByRole('checkbox', {
    name: 'Non-accumulating soft edges',
    exact: true,
  });
  await expect(nonAccumulating).toBeChecked();
  async function paint(from: number, to: number, steps: number) {
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * from, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * to, box!.y + box!.height / 2, { steps });
    await page.mouse.up();
  }
  function column() {
    return canvas.evaluate((element: HTMLCanvasElement) => {
      const pixels = element.getContext('2d')!.getImageData(1024, 0, 1, 2048).data;
      return Array.from({ length: 2048 }, (_, y) => pixels[y * 4 + 3]!);
    });
  }
  async function stroke(steps: number) {
    await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
    await paint(0.25, 0.75, steps);
    return column();
  }
  const sparse = await stroke(2);
  const dense = await stroke(40);
  const largestDifference = Math.max(
    ...sparse.map((value, index) => Math.abs(value - dense[index]!)),
  );
  expect(
    largestDifference,
    'Mouse event density must not harden a single soft brush stroke',
  ).toBeLessThanOrEqual(2);
  const halfRadius = Math.round((30 * 2048) / bounds!.width / 4);
  expect(dense[1024 + halfRadius]).toBeGreaterThan(60);
  expect(dense[1024 + halfRadius]).toBeLessThan(200);
  // Independent pointer-up/down segments and retracing must preserve the same ramp.
  await paint(0.25, 0.75, 40);
  const retraced = await column();
  expect(
    Math.max(...dense.map((value, index) => Math.abs(value - retraced[index]!))),
  ).toBeLessThanOrEqual(2);
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await paint(0.25, 0.5, 20);
  await paint(0.5, 0.75, 20);
  const joined = await column();
  expect(
    Math.max(...dense.map((value, index) => Math.abs(value - joined[index]!))),
  ).toBeLessThanOrEqual(2);
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await paint(0.25, 0.375, 10);
  await paint(0.625, 0.75, 10);
  expect((await column())[1024], 'Pointer-up must leave the unpainted gap empty').toBe(0);
  await stroke(2);
  await dialog.getByRole('button', { name: 'Eraser', exact: true }).click();
  await paint(0.5, 0.5, 1);
  expect((await column())[1024]).toBeLessThanOrEqual(4);
  await dialog.getByRole('button', { name: 'Brush', exact: true }).click();
  await paint(0.85, 0.85, 1);
  expect(
    (await column())[1024],
    'Changing tools must not restore erased pixels',
  ).toBeLessThanOrEqual(4);
  await nonAccumulating.uncheck();
  const firstLayer = await stroke(2);
  await paint(0.25, 0.75, 2);
  const accumulated = await column();
  expect(accumulated[1024 + halfRadius]).toBeGreaterThan(firstLayer[1024 + halfRadius]! + 20);
  await nonAccumulating.check();
  await dialog.getByRole('button', { name: 'Save background area', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Confirm area and composite locally', exact: true }),
  ).toBeEnabled();
  expect(await dialog.innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  const confirmation = dialog.getByRole('button', {
    name: 'Confirm area and composite locally',
    exact: true,
  });
  expect(
    await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await confirmation.scrollIntoViewIfNeeded();
  const dialogBox = await dialog.boundingBox();
  const confirmBox = await confirmation.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(confirmBox).not.toBeNull();
  expect(confirmBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);
  expect(confirmBox!.x + confirmBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width);
  expect(
    await confirmation.evaluate((button) => button.scrollWidth - button.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(billableRequests).toBe(0);
  expect(studio.services.core.assets.get(fixture.actor, fixture.wid, fixture.source.id).name).toBe(
    '保留主体的原图.png',
  );
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 1 });
});

async function openBackgroundEditor(page: Page, fixture: Awaited<ReturnType<typeof candidate>>) {
  const card = page.locator(`[data-job-id="${fixture.jobId}"][data-compact="false"]`);
  await card.getByRole('button', { name: '调整背景区域', exact: true }).click();
  return page.getByRole('dialog', { name: '调整背景区域', exact: true });
}

test('waits for the actual initial mask before permitting edits and preserves it after a delayed load', async ({
  page,
  studio,
}) => {
  const fixture = await candidate(page, studio);
  const maskPath = new URL(fixture.mask.originalUrl, studio.origin).pathname;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let requested = false;
  await page.route(
    (url) => url.pathname === maskPath,
    async (route) => {
      requested = true;
      await held;
      await route.continue();
    },
  );
  await page.goto(`${studio.origin}/tasks?job=${fixture.jobId}`);
  const dialog = await openBackgroundEditor(page, fixture);
  try {
    await expect.poll(() => requested).toBe(true);
    const canvas = dialog.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    expect(
      await canvas.evaluate(
        (element: HTMLCanvasElement) =>
          element.getContext('2d')!.getImageData(1024, 1024, 1, 1).data[3],
      ),
    ).toBe(0);
    await expect(dialog).toContainText('正在加载背景区域蒙版…');
    await expect(canvas).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByRole('button', { name: '清空', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '保存背景区域', exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: '确认区域并本机合成', exact: true }),
    ).toBeDisabled();
    release();
    await expect(dialog.getByRole('button', { name: '保存背景区域', exact: true })).toBeEnabled();
    await expect(canvas).toHaveAttribute('aria-disabled', 'false');
    expect(
      await canvas.evaluate((element: HTMLCanvasElement) => {
        const ctx = element.getContext('2d')!;
        return [
          ctx.getImageData(128, 128, 1, 1).data[3],
          ctx.getImageData(1024, 1024, 1, 1).data[3],
          ctx.getImageData(500, 800, 1, 1).data[3],
        ];
      }),
    ).toEqual([255, 0, 128]);
    await expect(
      dialog.getByRole('button', { name: '确认区域并本机合成', exact: true }),
    ).toBeDisabled();
    expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
      n: 1,
    });
  } finally {
    release();
  }
});

for (const failure of ['network-error', 'wrong-dimensions'] as const) {
  test(`rejects an initial mask with ${failure} without permitting a blank replacement and recovers on explicit reopening`, async ({
    page,
    studio,
  }) => {
    const fixture = await candidate(page, studio);
    const maskPath = new URL(fixture.mask.originalUrl, studio.origin).pathname;
    const wrongSize = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    let responses = 0;
    let mutationRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST') mutationRequests++;
    });
    await page.route(
      (url) => url.pathname === maskPath,
      async (route) => {
        if (++responses > 1) return route.continue();
        if (failure === 'network-error') return route.abort('failed');
        return route.fulfill({ status: 200, contentType: 'image/png', body: wrongSize });
      },
    );
    await page.goto(`${studio.origin}/tasks?job=${fixture.jobId}`);
    const dialog = await openBackgroundEditor(page, fixture);
    await expect(dialog).toContainText(
      failure === 'network-error' ? '背景区域蒙版加载失败' : '背景区域蒙版尺寸与原图不一致',
    );
    await expect(dialog.locator('canvas')).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByRole('button', { name: '清空', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '保存背景区域', exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: '确认区域并本机合成', exact: true }),
    ).toBeDisabled();
    expect(mutationRequests).toBe(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const reopened = await openBackgroundEditor(page, fixture);
    await expect(reopened.getByRole('button', { name: '保存背景区域', exact: true })).toBeEnabled();
    expect(
      await reopened
        .locator('canvas')
        .evaluate(
          (element: HTMLCanvasElement) =>
            element.getContext('2d')!.getImageData(500, 800, 1, 1).data[3],
        ),
    ).toBe(128);
    await expect(
      reopened.getByRole('button', { name: '确认区域并本机合成', exact: true }),
    ).toBeDisabled();
    expect(mutationRequests).toBe(0);
    expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
      n: 1,
    });
  });
}

for (const operation of ['image-inpaint', 'image-erase'] as const) {
  test(`${operation} freezes pixels during mask upload and never attaches a late mask to a replacement source`, async ({
    page,
    studio,
  }) => {
    const fixture = await candidate(page, studio);
    const headers = { origin: studio.origin, 'x-workspace-id': fixture.wid };
    const created = await page.request.post(`${studio.origin}/api/v1/projects`, {
      headers,
      data: { name: '上传蒙版换图竞态', kind: 'image' },
    });
    expect(created.status()).toBe(201);
    const project = (await created.json()).data as { id: string };
    const input = jobInputSchema.parse({
      operation,
      providerId: 'openai',
      projectId: project.id,
      assetIds: [fixture.source.id],
      prompt: '只修改保存的蒙版区域',
      options: { model: 'gpt-image-2', ratio: '1:1', resolution: '2K' },
    });
    expect(
      (
        await page.request.post(`${studio.origin}/api/v1/projects/${project.id}/messages`, {
          headers,
          data: { role: 'user', content: input.prompt, metadata: { draft: input } },
        })
      ).status(),
    ).toBe(200);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let uploadedAssetId: string | undefined;
    await page.route('**/api/v1/assets/upload', async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      uploadedAssetId = (await response.json()).data.id;
      await held;
      await route.fulfill({ response });
    });
    let generationRequests = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        ['/api/v1/quotes', '/api/v1/jobs', '/api/v1/creative-briefs/prepare'].includes(
          new URL(request.url()).pathname,
        )
      )
        generationRequests++;
    });
    await page.goto(`${studio.origin}/tools/${operation}?projectId=${project.id}`);
    const editor = page.locator('.mask-editor'),
      canvas = editor.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await editor
      .getByRole('button', {
        name: operation === 'image-erase' ? '保存消除区域' : '保存重绘区域',
        exact: true,
      })
      .click();
    try {
      await expect.poll(() => uploadedAssetId).toBeTruthy();
      await canvas.scrollIntoViewIfNeeded();
      const busyBox = await canvas.boundingBox();
      expect(busyBox).not.toBeNull();
      await page.mouse.click(busyBox!.x + busyBox!.width * 0.75, busyBox!.y + busyBox!.height / 2);
      expect
        .soft(
          await canvas.evaluate(
            (element: HTMLCanvasElement) =>
              element.getContext('2d')!.getImageData(1536, 1024, 1, 1).data[3],
          ),
          'Pixels drawn while the upload is pending must not be mistaken for saved content',
        )
        .toBe(0);
      await expect.soft(editor.getByRole('button', { name: '清空', exact: true })).toBeDisabled();
      const picker = page.locator('.asset-picker').first();
      await picker.getByRole('button', { name: `移除${fixture.source.name}`, exact: true }).click();
      await picker.getByRole('button', { name: '添加素材', exact: true }).click();
      const selection = page.getByRole('dialog');
      await selection.locator('.asset-select').filter({ hasText: fixture.output.name }).click();
      await selection.getByRole('button', { name: '完成选择', exact: true }).click();
      await expect(picker).toContainText(fixture.output.name);
      const received = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/assets/upload',
      );
      release();
      await received;
      await page.getByRole('button', { name: '保存为项目', exact: true }).click();
      await expect
        .poll(() => {
          const row = studio.services.db.sqlite
            .prepare(
              'SELECT metadata_json FROM messages WHERE project_id=? ORDER BY rowid DESC LIMIT 1',
            )
            .get(project.id) as { metadata_json: string };
          return JSON.parse(row.metadata_json).draft?.assetIds;
        })
        .toEqual([fixture.output.id]);
      const row = studio.services.db.sqlite
        .prepare(
          'SELECT metadata_json FROM messages WHERE project_id=? ORDER BY rowid DESC LIMIT 1',
        )
        .get(project.id) as { metadata_json: string };
      expect(
        JSON.parse(row.metadata_json).draft.maskAssetId,
        'A response for the old source must never enter the replacement source draft',
      ).toBeUndefined();
      expect(generationRequests).toBe(0);
      expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({
        n: 1,
      });
    } finally {
      release();
    }
  });
}

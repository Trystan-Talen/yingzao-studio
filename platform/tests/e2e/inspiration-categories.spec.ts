import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test('creates and reclassifies a real video inspiration, preserves filters on refresh and keeps legacy videos unclassified', async ({
  page,
  context,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  await context.addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const file = `${studio.folder}/category-video.mp4`;
  await promisify(execFile)('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=160x120:r=20:d=3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    file,
  ]);
  await page.goto(studio.origin);
  await page.getByRole('button', { name: '新增灵感', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新增灵感', exact: true });
  await form.getByRole('textbox', { name: '灵感标题', exact: true }).fill('口播分类本机样本');
  await form.getByRole('textbox', { name: '行业分类', exact: true }).fill('本机视频行业');
  await form.getByRole('textbox', { name: '主题标签', exact: true }).fill('本机制作');
  await form
    .getByRole('textbox', { name: '素材来源与使用权说明', exact: true })
    .fill('本机合成纯色视频，无第三方原件');
  await form.locator('input[type=file]').setInputFiles(file);
  await expect(form.locator('.asset-chip')).toContainText('category-video.mp4');
  await form
    .getByRole('combobox', { name: '视频内容分类', exact: true })
    .selectOption('talking-head');
  await form
    .getByRole('textbox', { name: '创作提示词', exact: true })
    .fill('保留原始需求，不自动调用模型');
  await form.getByRole('button', { name: '保存灵感', exact: true }).click();
  await expect(form).toHaveCount(0);
  const rows = studio.services.db.sqlite
    .prepare('SELECT id,asset_id,data_json FROM inspirations WHERE workspace_id=?')
    .all(account.workspace.id) as { id: string; asset_id: string; data_json: string }[];
  expect(rows).toHaveLength(1);
  const row = rows[0]!,
    data = JSON.parse(row.data_json);
  expect(data).toMatchObject({
    kind: 'video',
    videoCategory: 'talking-head',
    category: '本机视频行业',
  });
  const headers = { origin: studio.origin, 'x-workspace-id': account.workspace.id };
  const { videoCategory: _category, ...legacy } = data;
  const old = await page.request.post(`${studio.origin}/api/v1/inspirations`, {
    headers,
    data: { ...legacy, title: '未分类旧视频', assetId: row.asset_id },
  });
  expect(old.status()).toBe(201);
  await page.getByRole('combobox', { name: '灵感类型', exact: true }).selectOption('video');
  const filter = page.getByRole('combobox', { name: '视频内容分类', exact: true });
  await filter.selectOption('talking-head');
  await expect(page.locator('.inspiration-card')).toHaveCount(1);
  await expect(page).toHaveURL(/kind=video&videoCategory=talking-head$/);
  await page.reload();
  await expect(filter).toHaveValue('talking-head');
  await expect(page.locator('.inspiration-card')).toHaveCount(1);
  await page.getByRole('button', { name: '口播分类本机样本 · 以此创作', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '口播分类本机样本', exact: true });
  await expect
    .poll(() => detail.locator('video').evaluate((el) => (el as HTMLVideoElement).videoWidth))
    .toBe(160);
  await detail.getByRole('combobox', { name: '视频内容分类', exact: true }).selectOption('story');
  await expect(detail.getByRole('combobox', { name: '视频内容分类', exact: true })).toHaveValue(
    'story',
  );
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.inspiration-card')).toHaveCount(0);
  await filter.selectOption('story');
  await expect(page.locator('.inspiration-card')).toHaveCount(1);
  await page.getByRole('button', { name: '收藏 口播分类本机样本', exact: true }).click();
  await page.getByRole('button', { name: '仅显示已收藏', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索灵感', exact: true }).fill('口播分类');
  await expect(page.locator('.inspiration-card')).toHaveCount(1);
  await page.screenshot({ path: `${studio.folder}/video-category-filter.png`, fullPage: true });
  await page.reload();
  await filter.selectOption('');
  await expect(page.locator('.inspiration-card')).toHaveCount(2);
  const persisted = JSON.parse(
    (
      studio.services.db.sqlite
        .prepare('SELECT data_json FROM inspirations WHERE id=?')
        .get(row.id) as { data_json: string }
    ).data_json,
  );
  expect(persisted).toEqual({ ...data, videoCategory: 'story' });
  expect(studio.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
  for (const language of [
    { locale: 'en', label: 'Video content category' },
    { locale: 'ar', label: 'فئة محتوى الفيديو' },
  ]) {
    studio.services.core.auth.update(
      {
        userId: account.user.id,
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      },
      { preferences: { locale: language.locale } },
    );
    await page.reload();
    await expect(page.getByRole('combobox', { name: language.label, exact: true })).toBeVisible();
    for (const select of await page.locator('.inspiration-filters select').all())
      expect((await select.boundingBox())!.width).toBeGreaterThan(120);
    expect(await page.locator('.submit-block').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    expect(await page.locator('.inspiration-filters').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    await expect(
      page.locator('.inspiration-card').filter({ hasText: '口播分类本机样本' }),
    ).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: `${studio.folder}/video-category-${language.locale}.png`,
      fullPage: true,
    });
  }
});

test('a delayed category response cannot reopen a closed detail or replace another inspiration', async ({
  page,
  context,
  studio,
}) => {
  const account = await studio.existingIdentitySession();
  await context.addCookies([
    {
      name: 'studio_session',
      value: account.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const file = `${studio.folder}/race-video.mp4`;
  await promisify(execFile)('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x120:r=20:d=3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    file,
  ]);
  const asset = await studio.services.core.assets.ingest(
    { userId: account.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    account.workspace.id,
    { buffer: await readFile(file), name: 'local-video.mp4', mimeType: 'video/mp4' },
  );
  const ids: string[] = [];
  for (const title of ['样本甲', '样本乙']) {
    const response = await page.request.post(`${studio.origin}/api/v1/inspirations`, {
      headers: { origin: studio.origin, 'x-workspace-id': account.workspace.id },
      data: {
        title,
        category: '隔离',
        kind: 'video',
        tag: '',
        ratio: '4:3',
        prompt: `${title}的需求`,
        source: '本机合成',
        assetId: asset.id,
      },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).data.id);
  }
  await page.goto(`${studio.origin}/?kind=video`);
  let respond!: () => void;
  const gate = new Promise<void>((resolve) => {
    respond = resolve;
  });
  let written = false;
  await page.route(`**/api/v1/inspirations/${ids[0]}`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    written = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: '样本甲 · 以此创作', exact: true }).click();
    const first = page.getByRole('dialog', { name: '样本甲', exact: true });
    await first.getByRole('combobox', { name: '视频内容分类', exact: true }).selectOption('brand');
    await expect.poll(() => written).toBe(true);
    await first.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '样本乙 · 以此创作', exact: true }).click();
    const received = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/inspirations/${ids[0]}`) &&
        response.request().method() === 'PATCH',
    );
    respond();
    await received;
    await expect(
      page
        .getByRole('dialog', { name: '样本乙', exact: true })
        .getByRole('textbox', { name: '创作提示词', exact: true }),
    ).toHaveValue('样本乙的需求');
    await expect(page.getByRole('dialog', { name: '样本甲', exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `${studio.folder}/video-category-response-scope.png`,
      fullPage: true,
    });
  } finally {
    respond();
  }
});

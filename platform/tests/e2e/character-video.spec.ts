import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { test, expect, type Studio } from './fixtures';
import { t } from '../../src/web/lib/i18n';

test.use({ recoveryEnabled: false, smsEnabled: false });
async function account(page: Page, studio: Studio) {
  const owner = await studio.existingIdentitySession();
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return { owner, headers: { origin: studio.origin, 'x-workspace-id': owner.workspace.id } };
}
async function fixture(studio: Studio) {
  const path = join(studio.folder, '人物视频.mp4');
  await promisify(execFile)('ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x120:d=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-y',
    path,
  ]);
  const image = await sharp({
    create: { width: 160, height: 120, channels: 3, background: '#519064' },
  })
    .png()
    .toBuffer();
  return { path, image };
}
const mixedReason = '人物视频参考尚不能用于当前创作；资料和草稿已保留，请选择仅含图片的人物参考。';

test('uploads, plays and retains separate character image/video references, then explicitly handles unavailable references', async ({
  page,
  studio,
}) => {
  const { headers, owner } = await account(page, studio);
  let profileWrites = 0;
  page.on('request', (request) => {
    if (
      ['POST', 'PATCH'].includes(request.method()) &&
      /\/api\/v1\/characters(?:\/[0-9a-f-]+)?$/.test(new URL(request.url()).pathname)
    )
      profileWrites++;
  });
  const media = await fixture(studio);
  await page.goto(`${studio.origin}/characters`);
  await page.getByRole('button', { name: '创建人物', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: '创建人物', exact: true });
  await dialog.getByLabel('人物名称', { exact: true }).fill('人物管理保留中文');
  await dialog
    .getByLabel('角色说明', { exact: true })
    .fill('仅本机素材管理与授权声明，不代表身份认证');
  const imagePicker = dialog
    .locator('.asset-picker')
    .filter({ has: page.getByText('参考图片', { exact: true }) });
  const videoPicker = dialog
    .locator('.asset-picker')
    .filter({ has: page.getByText('人物参考视频', { exact: true }) });
  await expect(videoPicker).toHaveCount(1);
  await expect(videoPicker).toContainText('拖入视频文件，或从素材选择器添加');
  await imagePicker
    .locator('input[type=file]')
    .setInputFiles({ name: '人物图.png', mimeType: 'image/png', buffer: media.image });
  await expect(imagePicker.locator('.asset-chip')).toContainText('人物图.png');
  await videoPicker.locator('input[type=file]').setInputFiles(media.path);
  await expect(videoPicker.locator('.asset-chip')).toContainText('人物视频.mp4');
  const player = dialog.locator('video[controls]');
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(160);
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.videoHeight)).toBe(120);
  await player.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.1);
  await player.evaluate((v: HTMLVideoElement) => v.pause());
  await imagePicker.getByRole('button', { name: '移除人物图.png', exact: true }).click();
  await expect(imagePicker.locator('.asset-chip')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(profileWrites).toBe(0);
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM character_profiles').get(),
  ).toEqual({ n: 0 });
  await imagePicker
    .locator('input[type=file]')
    .setInputFiles({ name: '人物图.png', mimeType: 'image/png', buffer: media.image });
  await expect(imagePicker.locator('.asset-chip')).toContainText('人物图.png');
  await dialog.getByRole('button', { name: '保存人物', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const card = page
    .locator('.identity-card')
    .filter({ has: page.getByRole('heading', { name: '人物管理保留中文', exact: true }) });
  await card.getByRole('button', { name: '编辑人物', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '人物资料', exact: true });
  await expect(edit.locator('.asset-chip')).toHaveCount(2);
  await expect
    .poll(() => edit.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBe(160);
  await expect(edit).toContainText('未认证');
  const savedReferences = studio.services.core.references.getCharacter(
    { userId: owner.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    owner.workspace.id,
    (await (await page.request.get(`${studio.origin}/api/v1/characters`, { headers })).json()).data
      .items[0].id,
  ).referenceAssetIds;
  const writesBeforeRemove = profileWrites;
  await edit.getByRole('button', { name: '移除人物视频.mp4', exact: true }).click();
  await expect(edit.locator('.asset-chip')).toHaveCount(1);
  expect(profileWrites).toBe(writesBeforeRemove);
  expect(
    (
      studio.services.db.sqlite
        .prepare('SELECT reference_asset_ids_json FROM character_profiles LIMIT 1')
        .get() as { reference_asset_ids_json: string }
    ).reference_asset_ids_json,
  ).toBe(JSON.stringify(savedReferences));
  await edit
    .locator('.asset-picker')
    .filter({ has: page.getByText('人物参考视频', { exact: true }) })
    .locator('input[type=file]')
    .setInputFiles(media.path);
  await expect(edit.locator('.asset-chip')).toHaveCount(2);
  await page.screenshot({
    path: join(studio.folder, 'character-video-preview.png'),
    fullPage: true,
  });
  await edit.getByRole('checkbox').check();
  await edit.getByRole('button', { name: '保存授权声明', exact: true }).click();
  await expect(edit.getByText('已声明参考授权', { exact: true })).toBeVisible();
  await edit.getByRole('button', { name: '关闭', exact: true }).last().click();
  await card.getByRole('button', { name: '以此形象创作', exact: true }).click();
  await expect(page.getByText(mixedReason, { exact: true })).toBeVisible();
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM projects').get()).toEqual({
    n: 0,
  });
  expect(studio.services.db.sqlite.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 0 });
  const listed = await page.request.get(`${studio.origin}/api/v1/characters`, { headers });
  const character = (await listed.json()).data.items[0];
  const assets = await page.request.get(`${studio.origin}/api/v1/assets?pageSize=100`, { headers });
  const clip = (await assets.json()).data.items.find(
    (a: { id: string; kind: string }) =>
      a.kind === 'video' && character.referenceAssetIds.includes(a.id),
  );
  const original = await page.request.get(new URL(clip.originalUrl, studio.origin).href, {
    headers,
  });
  expect(original.status()).toBe(200);
  expect(
    createHash('sha256')
      .update(await original.body())
      .digest('hex'),
  ).toBe(
    createHash('sha256')
      .update(await readFile(media.path))
      .digest('hex'),
  );
  await page.screenshot({
    path: join(studio.folder, 'character-mixed-retained.png'),
    fullPage: true,
  });
  const actor = {
    userId: owner.user.id,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  for (const locale of ['en', 'ar'] as const) {
    studio.services.core.auth.update(actor, { preferences: { locale } });
    await page.reload();
    await expect(
      page.getByText(
        t(
          '人物库支持分别保存图片与视频。当前普通人物创作只接受图片参考；含视频的人物不会自动转换或丢弃视频。',
          locale,
        ),
        { exact: true },
      ),
    ).toBeVisible();
    await card.getByRole('button', { name: t('编辑人物', locale), exact: true }).click();
    const translated = page.getByRole('dialog', { name: t('人物资料', locale), exact: true });
    await expect(translated.getByLabel(t('人物名称', locale), { exact: true })).toHaveValue(
      '人物管理保留中文',
    );
    await expect
      .poll(() => translated.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth))
      .toBe(160);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: join(studio.folder, `character-video-${locale}.png`),
      fullPage: true,
    });
    await translated
      .getByRole('button', { name: t('关闭', locale), exact: true })
      .last()
      .click();
  }
  studio.services.core.auth.update(actor, { preferences: { locale: 'zh-CN' } });
  await page.reload();
  const removed = await page.request.delete(`${studio.origin}/api/v1/assets/${clip.id}`, {
    headers,
  });
  expect(removed.status()).toBe(200);
  await page.reload();
  await card.getByRole('button', { name: '编辑人物', exact: true }).click();
  await expect(edit).toContainText('原引用仍保留');
  await expect(edit.getByRole('button', { name: '保存人物', exact: true })).toBeDisabled();
  expect(
    JSON.parse(
      (
        studio.services.db.sqlite
          .prepare('SELECT reference_asset_ids_json FROM character_profiles WHERE id=?')
          .get(character.id) as { reference_asset_ids_json: string }
      ).reference_asset_ids_json,
    ),
  ).toContain(clip.id);
  await edit.getByRole('button', { name: /移除失效引用/ }).click();
  await edit.getByRole('button', { name: '保存人物', exact: true }).click();
  await expect(edit).toHaveCount(0);
  const stored = studio.services.core.references.getCharacter(
    { userId: owner.user.id, authType: 'session', apiKeyId: null, workspaceId: null, scopes: [] },
    owner.workspace.id,
    character.id,
  );
  expect(stored.referenceAssetIds).toHaveLength(1);
  expect(stored.authorization.status).toBe('stale');
  await card.getByRole('button', { name: '删除', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除人物资料？', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(card).toHaveCount(0);
  expect(
    studio.services.db.sqlite
      .prepare('SELECT deleted_at FROM assets WHERE id=?')
      .get(stored.referenceAssetIds[0]),
  ).toEqual({ deleted_at: null });
});

test('blocks saving until character references load, retries errors and discards late responses for a closed profile', async ({
  page,
  studio,
}) => {
  const { owner } = await account(page, studio);
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#729470' },
  })
    .png()
    .toBuffer();
  const actor = {
    userId: owner.user.id,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const asset = await studio.services.core.assets.ingest(actor, owner.workspace.id, {
    buffer: bytes,
    name: 'existing.png',
    mimeType: 'image/png',
  });
  const person = studio.services.core.references.createCharacter(actor, owner.workspace.id, {
    name: '已有素材人物',
    referenceAssetIds: [asset.id],
  });
  await page.goto(`${studio.origin}/characters`);
  let release!: () => void;
  let intercepted!: () => void;
  const seen = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/v1/assets/${asset.id}`,
    async (route) => {
      const response = await route.fetch();
      intercepted();
      await hold;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '编辑人物', exact: true }).click();
  await seen;
  const dialog = page.getByRole('dialog', { name: '人物资料', exact: true });
  await expect(dialog.getByRole('button', { name: '保存人物', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('人物名称', { exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '创建人物', exact: true }).first().click();
  const fresh = page.getByRole('dialog', { name: '创建人物', exact: true });
  await fresh.getByLabel('人物名称', { exact: true }).fill('新人物不被迟到读取污染');
  release();
  await expect(fresh.locator('.asset-chip')).toHaveCount(0);
  await fresh.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.route(
    `**/api/v1/assets/${asset.id}`,
    (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FIXTURE_READ_FAILED', message: '读取失败夹具' } }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: '编辑人物', exact: true }).click();
  await expect(dialog).toContainText('读取失败夹具');
  await expect(dialog.getByRole('button', { name: '保存人物', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog.locator('.asset-chip')).toContainText('existing.png');
  await expect(dialog.getByRole('button', { name: '保存人物', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '保存人物', exact: true }).click();
  expect(
    studio.services.core.references.getCharacter(actor, owner.workspace.id, person.id)
      .referenceAssetIds,
  ).toEqual([asset.id]);
  await page.screenshot({
    path: join(studio.folder, 'character-load-recovery.png'),
    fullPage: true,
  });
  const other = studio.services.core.references.createCharacter(actor, owner.workspace.id, {
    name: '另一个人物草稿',
  });
  await page.reload();
  let releaseSave!: () => void, sawSave!: () => void;
  const saveSeen = new Promise<void>((resolve) => {
    sawSave = resolve;
  });
  const saveHold = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(
    `**/api/v1/characters/${person.id}`,
    async (route) => {
      const response = await route.fetch();
      sawSave();
      await saveHold;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  const originalCard = page
    .locator('.identity-card')
    .filter({ has: page.getByRole('heading', { name: '已有素材人物', exact: true }) });
  await originalCard.getByRole('button', { name: '编辑人物', exact: true }).click();
  await expect(dialog.locator('.asset-chip')).toContainText('existing.png');
  await dialog.getByRole('button', { name: '保存人物', exact: true }).click();
  await saveSeen;
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page
    .locator('.identity-card')
    .filter({ has: page.getByRole('heading', { name: other.name, exact: true }) })
    .getByRole('button', { name: '编辑人物', exact: true })
    .click();
  await dialog.getByLabel('人物名称', { exact: true }).fill('B的当前输入不可被A保存响应关闭');
  releaseSave();
  await expect(dialog.getByRole('button', { name: '保存人物', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('人物名称', { exact: true })).toHaveValue(
    'B的当前输入不可被A保存响应关闭',
  );
  await page.screenshot({
    path: join(studio.folder, 'character-save-response-race.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  studio.services.db.sqlite
    .prepare("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?")
    .run(owner.workspace.id, owner.user.id);
  await page.reload();
  await expect(page.getByRole('button', { name: '创建人物', exact: true })).toHaveCount(0);
  await originalCard.getByRole('button', { name: '查看人物', exact: true }).click();
  await expect(dialog.getByLabel('人物名称', { exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '保存人物', exact: true })).toHaveCount(0);
  const forbidden = await page.request.patch(`${studio.origin}/api/v1/characters/${person.id}`, {
    headers: { origin: studio.origin, 'x-workspace-id': owner.workspace.id },
    data: { name: 'Viewer must not write' },
  });
  expect(forbidden.status()).toBe(403);
  expect(
    studio.services.core.references.getCharacter(actor, owner.workspace.id, person.id).name,
  ).toBe('已有素材人物');
});

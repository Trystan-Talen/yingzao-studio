import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Locator, Page } from '@playwright/test';
import type { SceneDocumentV1 } from '../../src/contracts/scene';
import { test, expect, type Studio } from './fixtures';

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

async function project(
  page: Page,
  studio: Studio,
  headers: Record<string, string>,
  name: string,
  kind = 'image',
) {
  const response = await page.request.post(`${studio.origin}/api/v1/projects`, {
    headers,
    data: { name, kind },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string; documentId: string };
}

function document(studio: Studio, projectId: string) {
  const row = studio.services.db.sqlite
    .prepare('SELECT id,revision,scene_json FROM documents WHERE project_id=?')
    .get(projectId) as { id: string; revision: number; scene_json: string };
  return {
    id: row.id,
    revision: row.revision,
    scene: JSON.parse(row.scene_json) as SceneDocumentV1,
  };
}

async function panel(editor: Locator, name: '属性' | '图层' | '画布') {
  const narrow = editor.getByRole('tab', { name, exact: true });
  if (await narrow.isVisible()) await narrow.click();
  else if (name !== '画布')
    await editor.locator('.ce-panel-tabs').getByRole('button', { name, exact: true }).click();
}

async function pixels(color: string) {
  return sharp({ create: { width: 96, height: 64, channels: 4, background: color } })
    .png()
    .toBuffer();
}

async function upload(
  page: Page,
  studio: Studio,
  headers: Record<string, string>,
  name: string,
  buffer: Buffer,
) {
  const response = await page.request.post(`${studio.origin}/api/v1/assets/upload`, {
    headers,
    multipart: { file: { name, mimeType: 'image/png', buffer } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string; originalUrl: string };
}

async function resize(
  page: Page,
  studio: Studio,
  headers: Record<string, string>,
  assetId: string,
  extra: Record<string, unknown> = {},
) {
  const input = {
    operation: 'local.resize',
    providerId: 'local',
    assetIds: [assetId],
    options: { width: 48, height: 32 },
    ...extra,
  };
  const quote = await page.request.post(`${studio.origin}/api/v1/quotes`, { headers, data: input });
  expect(quote.status()).toBe(200);
  const submitted = await page.request.post(`${studio.origin}/api/v1/jobs`, {
    headers,
    data: { input, quoteId: (await quote.json()).data.id, clientRequestId: randomUUID() },
  });
  expect(submitted.status()).toBe(202);
  const job = (await submitted.json()).data as { id: string };
  await expect
    .poll(
      () =>
        (
          studio.services.db.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(job.id) as {
            status: string;
          }
        ).status,
    )
    .toBe('succeeded');
  return job;
}

test('manages a named collection through rename, membership removal and deletion while preserving both originals', async ({
  page,
  studio,
}) => {
  const { headers } = await account(page, studio);
  const sourceA = await pixels('#265f3c'),
    sourceB = await pixels('#b33128');
  const a = await upload(page, studio, headers, '集合绿图.png', sourceA);
  const b = await upload(page, studio, headers, '集合红图.png', sourceB);
  await page.goto(`${studio.origin}/assets`);
  await page.getByRole('button', { name: '新建集合', exact: true }).click();
  const creating = page.getByRole('dialog', { name: '新建素材集合', exact: true });
  await creating.getByLabel('集合名称', { exact: true }).fill('产品首轮参考');
  await creating.getByRole('button', { name: '创建集合', exact: true }).click();
  await expect(creating).toHaveCount(0);
  await page.getByRole('checkbox', { name: '选择集合绿图.png', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择集合红图.png', exact: true }).check();
  await page.getByRole('button', { name: '加入集合', exact: true }).click();
  await page
    .getByRole('dialog', { name: '加入素材集合', exact: true })
    .getByRole('button', { name: '产品首轮参考', exact: true })
    .click();
  await page.getByLabel('素材集合', { exact: true }).selectOption({ label: '产品首轮参考' });
  const collectionId = await page.getByLabel('素材集合', { exact: true }).inputValue();
  await expect(page.locator('.asset-card')).toHaveCount(2);
  await page.getByRole('button', { name: '管理集合', exact: true }).click();
  const managing = page.getByRole('dialog', { name: '管理素材集合', exact: true });
  await managing.getByLabel('集合名称', { exact: true }).fill('产品确认参考');
  await managing.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(managing).toHaveCount(0);
  await expect(page.getByLabel('素材集合', { exact: true }).locator('option:checked')).toHaveText(
    '产品确认参考',
  );
  await page.getByRole('checkbox', { name: '选择集合红图.png', exact: true }).check();
  await page.getByRole('button', { name: '移出当前集合', exact: true }).click();
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await expect(page.locator('.asset-card')).toContainText('集合绿图.png');
  await page.reload();
  await page.getByLabel('素材集合', { exact: true }).selectOption({ label: '产品确认参考' });
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.screenshot({
    path: `${studio.folder}/collection-renamed-membership.png`,
    fullPage: true,
  });
  const search = page.getByRole('textbox', { name: '搜索素材', exact: true });
  if ((page.viewportSize()?.width ?? 1440) <= 480) {
    expect(
      (await search.boundingBox())!.width,
      'Mobile collection search remains wide enough to enter a usable query',
    ).toBeGreaterThanOrEqual(240);
  }
  await search.fill('集合绿图');
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await search.fill('集合红图');
  await expect(page.locator('.asset-card')).toHaveCount(0);
  await search.fill('');
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.getByRole('button', { name: '管理集合', exact: true }).click();
  await managing.getByRole('button', { name: '删除集合', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除素材集合', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(page.locator('.asset-card')).toHaveCount(2);
  expect(
    studio.services.db.sqlite
      .prepare('SELECT count(*) n FROM collections WHERE deleted_at IS NULL')
      .get(),
  ).toEqual({ n: 0 });
  expect(
    studio.services.db.sqlite
      .prepare('SELECT count(*) n FROM collections WHERE deleted_at IS NOT NULL')
      .get(),
  ).toEqual({ n: 1 });
  expect(
    studio.services.db.sqlite.prepare('SELECT count(*) n FROM asset_collections').get(),
  ).toEqual({ n: 1 });
  const deletedCollection = await page.request.get(
    `${studio.origin}/api/v1/assets?collectionId=${collectionId}`,
    { headers },
  );
  expect(deletedCollection.status()).toBe(404);
  for (const [asset, source] of [
    [a, sourceA],
    [b, sourceB],
  ] as const) {
    const response = await page.request.get(new URL(asset.originalUrl, studio.origin).toString(), {
      headers,
    });
    expect(response.status()).toBe(200);
    expect(
      createHash('sha256')
        .update(await response.body())
        .digest('hex'),
    ).toBe(createHash('sha256').update(source).digest('hex'));
  }
  await page.screenshot({
    path: `${studio.folder}/collection-deleted-originals-preserved.png`,
    fullPage: true,
  });
});

test('groups and locks two editable layers, blocks destructive controls and saves their ungrouped geometry after unlock', async ({
  page,
  studio,
}) => {
  const { headers } = await account(page, studio);
  const p = await project(page, studio, headers, '分组锁定与几何保存');
  await page.goto(`${studio.origin}/workbench/${p.id}`);
  await page.getByRole('button', { name: '先从空白画布编辑', exact: true }).click();
  const editor = page.getByLabel('作品画布编辑器', { exact: true });
  await editor.getByRole('button', { name: '添加矩形', exact: true }).click();
  await editor.getByRole('button', { name: '添加椭圆', exact: true }).click();
  await expect.poll(() => document(studio, p.id).scene.layers.length).toBe(2);
  const initial = document(studio, p.id).scene.layers;
  await panel(editor, '图层');
  await editor.locator('.ce-layer-name').getByText('矩形', { exact: true }).click();
  await editor
    .locator('.ce-layer-name')
    .getByText('椭圆', { exact: true })
    .click({ modifiers: ['Shift'] });
  await editor.getByRole('button', { name: '将选中图层分组', exact: true }).click();
  await expect.poll(() => document(studio, p.id).scene.layers[0]?.type).toBe('group');
  const grouped = document(studio, p.id).scene.layers[0]!;
  if (grouped.type !== 'group') throw new Error('Expected actual saved group');
  expect(grouped.children.map((layer) => layer.id)).toEqual(initial.map((layer) => layer.id));
  await panel(editor, '图层');
  await editor.getByRole('button', { name: `锁定 ${grouped.name}`, exact: true }).click();
  await expect.poll(() => document(studio, p.id).scene.layers[0]?.locked).toBe(true);
  for (const action of ['删除', '复制', '上移', '下移'])
    await expect(
      editor.getByRole('button', { name: `${action} ${grouped.name}`, exact: true }),
    ).toBeDisabled();
  await expect(editor.getByRole('button', { name: '取消分组', exact: true })).toBeDisabled();
  await editor.focus();
  await editor.press('ArrowRight');
  await editor.press('Delete');
  await expect(editor.locator('.ce-layer')).toHaveCount(1);
  expect(document(studio, p.id).scene.layers[0]).toMatchObject({
    id: grouped.id,
    x: grouped.x,
    locked: true,
  });
  await editor.getByRole('button', { name: `解锁 ${grouped.name}`, exact: true }).click();
  await editor.locator('.ce-layer-name').getByText(grouped.name, { exact: true }).click();
  await editor.focus();
  await editor.press('ArrowRight');
  await expect.poll(() => document(studio, p.id).scene.layers[0]?.x).toBe(grouped.x + 1);
  await editor.getByRole('button', { name: '取消分组', exact: true }).click();
  await expect.poll(() => document(studio, p.id).scene.layers.length).toBe(2);
  for (const old of initial)
    expect(document(studio, p.id).scene.layers.find((layer) => layer.id === old.id)).toMatchObject({
      type: old.type,
      x: old.x + 1,
      y: old.y,
      width: old.width,
      height: old.height,
      locked: false,
    });
  await editor.getByRole('button', { name: '撤销编辑', exact: true }).click();
  await expect.poll(() => document(studio, p.id).scene.layers[0]?.type).toBe('group');
  await editor.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => document(studio, p.id).scene.layers.length).toBe(2);
  const saved = document(studio, p.id).scene;
  await page.reload();
  await page.getByRole('button', { name: '画布编辑', exact: true }).click();
  await panel(editor, '图层');
  await expect(editor.locator('.ce-layer')).toHaveCount(2);
  expect(document(studio, p.id).scene).toEqual(saved);
  await page.screenshot({
    path: `${studio.folder}/group-lock-ungroup-restored.png`,
    fullPage: true,
  });
});

test('applies a real pending local result after a canvas revision conflict without losing the newer edit or applying twice', async ({
  page,
  studio,
}) => {
  const { headers } = await account(page, studio);
  const p = await project(page, studio, headers, '晚到结果与并发版本');
  const source = await upload(page, studio, headers, '待应用真实像素.png', await pixels('#2d589c'));
  await page.goto(`${studio.origin}/workbench/${p.id}`);
  await page.getByRole('button', { name: '先从空白画布编辑', exact: true }).click();
  const editor = page.getByLabel('作品画布编辑器', { exact: true });
  await editor.getByRole('button', { name: '添加矩形', exact: true }).click();
  await expect.poll(() => document(studio, p.id).scene.layers.length).toBe(1);
  const baseRevision = document(studio, p.id).revision;
  const job = await resize(page, studio, headers, source.id, {
    projectId: p.id,
    documentId: p.documentId,
    baseRevision,
  });
  await editor.getByRole('button', { name: '添加椭圆', exact: true }).click();
  await expect.poll(() => document(studio, p.id).scene.layers.length).toBe(2);
  const edited = document(studio, p.id);
  await expect(page.getByText('有一个新结果等待应用', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览并应用', exact: true }).click();
  const applying = page.getByRole('dialog', { name: '应用创作结果', exact: true });
  await expect(applying.getByRole('img', { name: '待应用结果', exact: true })).toBeVisible();
  await expect(applying.getByRole('combobox', { name: '应用方式', exact: true })).toHaveValue(
    'new-layer',
  );
  // A second client's actual API save advances the document while this preview remains open.
  const newerScene = { ...edited.scene, canvas: { ...edited.scene.canvas, background: '#f1e3cd' } };
  const competingSave = await page.request.patch(`${studio.origin}/api/v1/documents/${edited.id}`, {
    headers,
    data: { expectedRevision: edited.revision, scene: newerScene },
  });
  expect(competingSave.status()).toBe(200);
  const conflictResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/pending-applies/') &&
      response.url().endsWith('/apply') &&
      response.request().method() === 'POST',
  );
  await applying.getByRole('button', { name: '确认应用', exact: true }).click();
  expect((await conflictResponse).status()).toBe(409);
  expect(document(studio, p.id).scene).toEqual(newerScene);
  expect(
    studio.services.db.sqlite
      .prepare("SELECT count(*) n FROM pending_applies WHERE job_id=? AND status='pending'")
      .get(job.id),
  ).toEqual({ n: 1 });
  await page.screenshot({
    path: `${studio.folder}/pending-result-version-conflict.png`,
    fullPage: true,
  });
  await page.reload();
  await page.getByRole('button', { name: '预览并应用', exact: true }).click();
  await applying.getByRole('button', { name: '确认应用', exact: true }).click();
  await expect(applying).toHaveCount(0);
  await expect.poll(() => document(studio, p.id).scene.layers.length).toBe(3);
  const applied = document(studio, p.id);
  expect(applied.scene.canvas.background).toBe('#f1e3cd');
  expect(applied.scene.layers.slice(0, 2)).toEqual(edited.scene.layers);
  expect(applied.scene.layers[2]).toMatchObject({ type: 'image', width: 48, height: 32 });
  const pending = studio.services.db.sqlite
    .prepare('SELECT id,status FROM pending_applies WHERE job_id=?')
    .get(job.id) as { id: string; status: string };
  expect(pending.status).toBe('applied');
  const duplicate = await page.request.post(
    `${studio.origin}/api/v1/pending-applies/${pending.id}/apply`,
    { headers, data: { expectedRevision: applied.revision, mode: 'new-layer' } },
  );
  expect(duplicate.status()).toBe(404);
  expect((await duplicate.json()).error.code).toBe('RESULT_NOT_FOUND');
  expect(document(studio, p.id).scene.layers).toHaveLength(3);
  await page.reload();
  await expect(page.getByRole('button', { name: '预览并应用', exact: true })).toHaveCount(0);
  expect(document(studio, p.id).scene).toEqual(applied.scene);
  expect(
    studio.services.db.sqlite
      .prepare("SELECT count(*) n FROM credit_ledger WHERE job_id=? AND kind='settle'")
      .get(job.id),
  ).toEqual({ n: 1 });
  await page.getByRole('button', { name: '画布编辑', exact: true }).click();
  await panel(editor, '图层');
  await page.screenshot({
    path: `${studio.folder}/pending-result-applied-once.png`,
    fullPage: true,
  });
});

test('combines project name, kind and personal favorite filters and restores a filtered project from the recycle bin', async ({
  page,
  studio,
}) => {
  const { headers } = await account(page, studio);
  await project(page, studio, headers, '秋季产品图', 'image');
  await project(page, studio, headers, '秋季产品视频', 'video');
  await project(page, studio, headers, '春季产品图', 'image');
  await page.goto(`${studio.origin}/projects`);
  await expect(page.locator('.project-card')).toHaveCount(3);
  const wanted = page
    .locator('.project-card')
    .filter({ has: page.getByRole('heading', { name: '秋季产品图', exact: true }) });
  await wanted.getByRole('button', { name: '收藏项目', exact: true }).click();
  await expect(wanted.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.getByLabel('搜索项目', { exact: true }).fill('秋季');
  await page.getByLabel('项目类型', { exact: true }).selectOption('image');
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await expect(wanted).toBeVisible();
  await page.getByLabel('项目类型', { exact: true }).selectOption('video');
  await expect(page.locator('.project-card')).toHaveCount(0);
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await expect(page.locator('.project-card')).toContainText('秋季产品视频');
  await page.getByLabel('项目类型', { exact: true }).selectOption('image');
  await wanted.getByRole('button', { name: '删除项目', exact: true }).click();
  await page
    .getByRole('dialog', { name: '将项目移入回收站？', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(page.locator('.project-card')).toHaveCount(0);
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await wanted.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(0);
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await page.getByLabel('搜索项目', { exact: true }).fill('');
  await page.getByLabel('项目类型', { exact: true }).selectOption('');
  await expect(page.locator('.project-card')).toHaveCount(3);
  await expect(wanted.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.screenshot({
    path: `${studio.folder}/project-combined-filters-restored.png`,
    fullPage: true,
  });
});

test('uses inclusive UTC calendar dates for actual settled local jobs and exports exactly the visible statistics', async ({
  page,
  studio,
}) => {
  const { headers } = await account(page, studio);
  const source = await upload(
    page,
    studio,
    headers,
    '统计边界真实输入.png',
    await pixels('#413785'),
  );
  const dates = [
    '2026-10-14T23:59:59.999Z',
    '2026-10-15T00:00:00.000Z',
    '2026-10-15T23:59:59.999Z',
    '2026-10-16T00:00:00.000Z',
  ];
  for (const date of dates) {
    const job = await resize(page, studio, headers, source.id);
    // Time is controlled only in this isolated fixture; each row is a real local-worker settlement.
    const changed = studio.services.db.sqlite
      .prepare("UPDATE credit_ledger SET created_at=? WHERE job_id=? AND kind='settle'")
      .run(date, job.id);
    expect(changed.changes).toBe(1);
  }
  await page.goto(`${studio.origin}/usage`);
  await page.getByRole('button', { name: '成员统计', exact: true }).click();
  await page.getByLabel('开始日期', { exact: true }).fill('2026-10-15');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-15');
  const statistics = page.locator('table').first();
  const row = statistics
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'Existing identity fixture', exact: true }) });
  await expect(row.getByRole('cell')).toHaveText(['Existing identity fixture', '2', '0']);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出统计', exact: true }).click();
  const downloaded = await downloadEvent;
  const file = `${studio.folder}/usage-boundary.csv`;
  await downloaded.saveAs(file);
  expect((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')).toBe(
    '成员,成功结算任务,已用额度\r\n"Existing identity fixture",2,0',
  );
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-16');
  await expect(row.getByRole('cell')).toHaveText(['Existing identity fixture', '3', '0']);
  await page.getByLabel('开始日期', { exact: true }).fill('2026-10-17');
  await expect(page.getByText('结束日期不能早于开始日期。', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${studio.folder}/usage-utc-date-boundary.png`, fullPage: true });
});

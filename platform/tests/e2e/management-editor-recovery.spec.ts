import sharp from 'sharp';
import type { Page } from '@playwright/test';
import type { Actor } from '../../src/contracts/core';
import { test, expect, type Studio } from './fixtures';

test.use({ recoveryEnabled: false, smsEnabled: false });

async function account(page: Page, studio: Studio) {
  const owner = await studio.existingIdentitySession();
  const actor: Actor = {
    userId: owner.user.id,
    authType: 'session',
    workspaceId: null,
    apiKeyId: null,
    scopes: [],
  };
  await page.context().addCookies([
    {
      name: 'studio_session',
      value: owner.sessionToken,
      url: studio.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return { ...owner, actor };
}
async function holdWrite(page: Page, path: string) {
  let release!: () => void;
  let saved!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    saved = resolve;
  });
  await page.route(
    `**/api/v1${path}`,
    async (route) => {
      if (!['POST', 'PATCH', 'DELETE'].includes(route.request().method())) return route.continue();
      const response = await route.fetch();
      saved();
      await barrier;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  return { release, seen };
}

for (const entity of ['project', 'collection'] as const) {
  test(`a delayed ${entity} creation keeps later input attached to the created record`, async ({
    page,
    studio,
  }) => {
    await account(page, studio);
    const project = entity === 'project';
    const path = project ? '/projects' : '/collections';
    await page.goto(`${studio.origin}${project ? '/projects' : '/assets'}`);
    await page
      .getByRole('button', { name: project ? '新建项目' : '新建集合', exact: true })
      .first()
      .click();
    const creating = page.getByRole('dialog', {
      name: project ? '新建项目' : '新建素材集合',
      exact: true,
    });
    const label = project ? '项目名称' : '集合名称';
    await creating.getByRole('textbox', { name: label, exact: true }).fill('已提交创建A');
    const held = await holdWrite(page, path);
    try {
      await creating
        .getByRole('button', { name: project ? '保存项目' : '创建集合', exact: true })
        .click();
      await held.seen;
      await creating.getByRole('textbox', { name: label, exact: true }).fill('同记录后续名称B');
      held.release();
      const editor = page.getByRole('dialog', {
        name: project ? '编辑项目' : '管理素材集合',
        exact: true,
      });
      await expect(editor).toContainText('提交内容已保存，之后的修改仍未保存。');
      await expect(editor.getByRole('textbox', { name: label, exact: true })).toHaveValue(
        '同记录后续名称B',
      );
      const table = project ? 'projects' : 'collections';
      const first = studio.services.db.sqlite.prepare(`SELECT id,name FROM ${table}`).all() as {
        id: string;
        name: string;
      }[];
      expect(first).toHaveLength(1);
      expect(first[0]?.name).toBe('已提交创建A');
      await editor
        .getByRole('button', { name: project ? '保存项目' : '保存名称', exact: true })
        .click();
      await expect(editor).toHaveCount(0);
      expect(studio.services.db.sqlite.prepare(`SELECT id,name FROM ${table}`).all()).toEqual([
        { id: first[0]!.id, name: '同记录后续名称B' },
      ]);
    } finally {
      held.release();
    }
  });
}

test('a delayed project update preserves fields typed after submission', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const project = studio.services.core.projects.create(owner.actor, owner.workspace.id, {
    name: '项目修改保护',
  });
  await page.goto(`${studio.origin}/projects`);
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑项目', exact: true });
  await editor.getByRole('textbox', { name: '项目说明', exact: true }).fill('已提交说明A');
  const held = await holdWrite(page, `/projects/${project.id}`);
  try {
    await editor.getByRole('button', { name: '保存项目', exact: true }).click();
    await held.seen;
    await editor.getByRole('textbox', { name: '项目说明', exact: true }).fill('后续说明B不能丢失');
    held.release();
    await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('textbox', { name: '项目说明', exact: true })).toHaveValue(
      '后续说明B不能丢失',
    );
    expect(
      studio.services.core.projects.get(owner.actor, owner.workspace.id, project.id).description,
    ).toBe('已提交说明A');
    await editor.getByRole('button', { name: '保存项目', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(
      studio.services.core.projects.get(owner.actor, owner.workspace.id, project.id).description,
    ).toBe('后续说明B不能丢失');
  } finally {
    held.release();
  }
});

test('a delayed project creation does not navigate away from a newly opened project draft', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  await page.goto(`${studio.origin}/projects`);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: '新建项目', exact: true });
  await editor.getByRole('textbox', { name: '项目名称', exact: true }).fill('本次创建A');
  const held = await holdWrite(page, '/projects');
  try {
    await editor.getByRole('button', { name: '保存项目', exact: true }).click();
    await held.seen;
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await editor.getByRole('textbox', { name: '项目名称', exact: true }).fill('后续新项目B草稿');
    held.release();
    await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${studio.origin}/projects`);
    await expect(editor.getByRole('textbox', { name: '项目名称', exact: true })).toHaveValue(
      '后续新项目B草稿',
    );
    expect(studio.services.db.sqlite.prepare('SELECT name FROM projects').all()).toEqual([
      { name: '本次创建A' },
    ]);
    await editor.getByRole('button', { name: '保存项目', exact: true }).click();
    await expect(page).toHaveURL(/\/workbench\//);
    expect(
      studio.services.db.sqlite.prepare('SELECT name FROM projects ORDER BY name').all(),
    ).toEqual([{ name: '后续新项目B草稿' }, { name: '本次创建A' }]);
    expect(studio.services.core.projects.list(owner.actor, owner.workspace.id, {}).total).toBe(2);
  } finally {
    held.release();
  }
});

test('a delayed asset update does not close another asset or clear its draft', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const core = studio.services.core;
  const buffer = await sharp({
    create: { width: 24, height: 24, channels: 3, background: '#46705c' },
  })
    .png()
    .toBuffer();
  const a = await core.assets.ingest(owner.actor, owner.workspace.id, {
    buffer,
    name: '素材A.png',
    mimeType: 'image/png',
  });
  const b = await core.assets.ingest(owner.actor, owner.workspace.id, {
    buffer,
    name: '素材B.png',
    mimeType: 'image/png',
  });
  await page.goto(`${studio.origin}/assets`);
  await page.getByRole('button', { name: `查看${a.name}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: '素材详情', exact: true });
  await editor.getByRole('textbox', { name: '名称', exact: true }).fill('素材A已保存.png');
  const held = await holdWrite(page, `/assets/${a.id}`);
  try {
    await editor.getByRole('button', { name: '保存信息', exact: true }).click();
    await held.seen;
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: `查看${b.name}`, exact: true }).click();
    await editor.getByRole('textbox', { name: '名称', exact: true }).fill('素材B后续草稿.png');
    held.release();
    await expect(page.getByText('素材信息已保存', { exact: true })).toBeVisible();
    await expect(editor.getByRole('textbox', { name: '名称', exact: true })).toHaveValue(
      '素材B后续草稿.png',
    );
    expect(core.assets.get(owner.actor, owner.workspace.id, a.id).name).toBe('素材A已保存.png');
    expect(core.assets.get(owner.actor, owner.workspace.id, b.id).name).toBe('素材B.png');
    await editor.getByRole('button', { name: '保存信息', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(core.assets.get(owner.actor, owner.workspace.id, b.id).name).toBe('素材B后续草稿.png');
  } finally {
    held.release();
  }
});

test('a delayed asset update preserves later name and tag changes in the same editor', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const core = studio.services.core;
  const asset = await core.assets.ingest(owner.actor, owner.workspace.id, {
    buffer: await sharp({ create: { width: 24, height: 24, channels: 3, background: '#426856' } })
      .png()
      .toBuffer(),
    name: '素材原名.png',
    mimeType: 'image/png',
  });
  await page.goto(`${studio.origin}/assets`);
  await page.getByRole('button', { name: `查看${asset.name}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: '素材详情', exact: true });
  await editor.getByRole('textbox', { name: '名称', exact: true }).fill('素材提交A.png');
  const held = await holdWrite(page, `/assets/${asset.id}`);
  try {
    await editor.getByRole('button', { name: '保存信息', exact: true }).click();
    await held.seen;
    await editor.getByRole('textbox', { name: '名称', exact: true }).fill('素材后续B.png');
    await editor.getByRole('textbox', { name: /^标签/ }).fill('后续标签');
    held.release();
    await expect(editor).toContainText('提交内容已保存，之后的修改仍未保存。');
    expect(core.assets.get(owner.actor, owner.workspace.id, asset.id)).toMatchObject({
      name: '素材提交A.png',
      tags: [],
    });
    await editor.getByRole('button', { name: '保存信息', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(core.assets.get(owner.actor, owner.workspace.id, asset.id)).toMatchObject({
      name: '素材后续B.png',
      tags: ['后续标签'],
    });
  } finally {
    held.release();
  }
});

test('a delayed collection creation preserves a newly reopened collection draft', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  await page.goto(`${studio.origin}/assets`);
  await page.getByRole('button', { name: '新建集合', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新建素材集合', exact: true });
  await editor.getByRole('textbox', { name: '集合名称', exact: true }).fill('已提交集合A');
  const held = await holdWrite(page, '/collections');
  try {
    await editor.getByRole('button', { name: '创建集合', exact: true }).click();
    await held.seen;
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '新建集合', exact: true }).click();
    await editor.getByRole('textbox', { name: '集合名称', exact: true }).fill('后续集合B草稿');
    held.release();
    await expect(page.getByText('集合已创建', { exact: true })).toBeVisible();
    await expect(editor.getByRole('textbox', { name: '集合名称', exact: true })).toHaveValue(
      '后续集合B草稿',
    );
    expect(
      studio.services.core.references
        .collections(owner.actor, owner.workspace.id, {})
        .items.map((item) => item.name),
    ).toEqual(['已提交集合A']);
    await editor.getByRole('button', { name: '创建集合', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(
      studio.services.core.references
        .collections(owner.actor, owner.workspace.id, {})
        .items.map((item) => item.name)
        .sort(),
    ).toEqual(['后续集合B草稿', '已提交集合A']);
  } finally {
    held.release();
  }
});

test('a delayed collection deletion preserves the next selected collection and its name draft', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const core = studio.services.core;
  const a = core.references.createCollection(owner.actor, owner.workspace.id, {
    name: '待删除集合A',
  });
  const b = core.references.createCollection(owner.actor, owner.workspace.id, {
    name: '继续编辑集合B',
  });
  await page.goto(`${studio.origin}/assets`);
  const filter = page.getByRole('combobox', { name: '素材集合', exact: true });
  await filter.selectOption(a.id);
  await page.getByRole('button', { name: '管理集合', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '管理素材集合', exact: true });
  await editor.getByRole('button', { name: '删除集合', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除素材集合', exact: true });
  const held = await holdWrite(page, `/collections/${a.id}`);
  try {
    await confirm.getByRole('button', { name: '确认', exact: true }).click();
    await held.seen;
    await confirm.getByRole('button', { name: '关闭', exact: true }).click();
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await filter.selectOption(b.id);
    await page.getByRole('button', { name: '管理集合', exact: true }).click();
    await editor.getByRole('textbox', { name: '集合名称', exact: true }).fill('集合B新名称草稿');
    held.release();
    await expect(page.getByText('集合已删除', { exact: true })).toBeVisible();
    await expect(editor.getByRole('textbox', { name: '集合名称', exact: true })).toHaveValue(
      '集合B新名称草稿',
    );
    expect(core.references.collections(owner.actor, owner.workspace.id, {}).items).toMatchObject([
      { id: b.id, name: b.name },
    ]);
    await editor.getByRole('button', { name: '保存名称', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(filter).toHaveValue(b.id);
    expect(core.references.collections(owner.actor, owner.workspace.id, {}).items).toMatchObject([
      { id: b.id, name: '集合B新名称草稿' },
    ]);
  } finally {
    held.release();
  }
});

test('reaches collection 101 for membership and keeps its selection while paging, renaming and deleting', async ({
  page,
  studio,
}) => {
  const owner = await account(page, studio);
  const core = studio.services.core;
  for (let index = 1; index <= 101; index++)
    core.references.createCollection(owner.actor, owner.workspace.id, {
      name: `分页集合${String(index).padStart(3, '0')}`,
    });
  const oldest = core.references.collections(owner.actor, owner.workspace.id, {
    page: 2,
    pageSize: 100,
  }).items[0]!;
  const asset = await core.assets.ingest(owner.actor, owner.workspace.id, {
    buffer: await sharp({ create: { width: 24, height: 24, channels: 3, background: '#426856' } })
      .png()
      .toBuffer(),
    name: '跨页集合的原件.png',
    mimeType: 'image/png',
  });
  await page.goto(`${studio.origin}/assets`);
  const filter = page.getByRole('combobox', { name: '素材集合', exact: true });
  await expect(filter.locator('option')).toHaveCount(101);
  expect(core.references.collections(owner.actor, owner.workspace.id, {}).total).toBe(101);
  await page.getByRole('checkbox', { name: `选择${asset.name}`, exact: true }).check();
  await page.getByRole('button', { name: '加入集合', exact: true }).click();
  const adding = page.getByRole('dialog', { name: '加入素材集合', exact: true });
  await adding.getByRole('button', { name: '下一页', exact: true }).click();
  await adding.getByRole('button', { name: oldest.name, exact: true }).click();
  await expect(adding).toHaveCount(0);
  expect(
    studio.services.db.sqlite
      .prepare('SELECT asset_id FROM asset_collections WHERE collection_id=?')
      .all(oldest.id),
  ).toEqual([{ asset_id: asset.id }]);
  await filter.selectOption(oldest.id);
  await expect(page.locator('.asset-card')).toHaveCount(1);
  const paging = page.getByRole('region', { name: '素材集合', exact: true });
  await paging.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(paging).toContainText('1 / 2');
  await expect(filter).toHaveValue(oldest.id);
  await expect(filter.locator('option:checked')).toHaveText(oldest.name);
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.getByRole('button', { name: '管理集合', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '管理素材集合', exact: true });
  await editor.getByRole('textbox', { name: '集合名称', exact: true }).fill('跨页选中的最新集合名');
  await editor.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(filter.locator('option:checked')).toHaveText('跨页选中的最新集合名');
  expect(
    core.references
      .collections(owner.actor, owner.workspace.id, {})
      .items.find((item) => item.id === oldest.id)?.name,
  ).toBe('跨页选中的最新集合名');
  await paging.getByRole('button', { name: '下一页', exact: true }).click();
  const last = core.references.collections(owner.actor, owner.workspace.id, {
    page: 2,
    pageSize: 100,
  }).items[0]!;
  await filter.selectOption(last.id);
  await page.getByRole('button', { name: '管理集合', exact: true }).click();
  await editor.getByRole('button', { name: '删除集合', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除素材集合', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(paging).toHaveCount(0);
  await expect(filter.locator('option')).toHaveCount(101);
  expect(core.references.collections(owner.actor, owner.workspace.id, {}).total).toBe(100);
  expect(core.assets.get(owner.actor, owner.workspace.id, asset.id).name).toBe(asset.name);
});

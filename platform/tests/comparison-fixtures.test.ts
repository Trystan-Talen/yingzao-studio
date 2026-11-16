import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import { closeDatabase, createDatabaseContext } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import {
  COMPARISON_WORKSPACE_NAME,
  comparisonFixtures,
  importComparisonFixtures,
} from '../scripts/comparison-fixtures';

let directory: string;
let db: ReturnType<typeof createDatabaseContext>;
let core: ReturnType<typeof createCoreServices>;
let actor: Actor;
let workspaceId: string;

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('对比样例导入不得访问外网');
    }),
  );
  directory = await mkdtemp(join(tmpdir(), 'yingzao-comparison-fixtures-'));
  db = createDatabaseContext(join(directory, 'fixture.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  core = createCoreServices(db, {
    storageDir: join(directory, 'media'),
    sessionSecret: 'comparison-fixtures-only',
    publicOrigin: 'http://127.0.0.1:5174',
    isProduction: false,
    demoMode: true,
  });
  const account = await core.auth.register({
    email: 'comparison@example.test',
    password: 'ComparisonFixture2026!',
    displayName: '对比测试用户',
  });
  actor = {
    userId: account.user.id,
    authType: 'session',
    workspaceId: null,
    apiKeyId: null,
    scopes: [],
  };
  workspaceId = account.workspace.id;
  db.sqlite
    .prepare('UPDATE workspaces SET name=? WHERE id=?')
    .run(COMPARISON_WORKSPACE_NAME, workspaceId);
});

afterEach(async () => {
  closeDatabase(db);
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

it('imports two linked private brands/products and usable original references without model calls', async () => {
  const result = await importComparisonFixtures(core, actor, workspaceId);
  expect(result.created).toBe(true);
  expect(result.items).toHaveLength(2);
  expect(core.references.brands(actor, workspaceId, {}).total).toBe(2);
  expect(core.knowledge.listProducts(actor, workspaceId).total).toBe(2);
  expect(core.assets.list(actor, workspaceId, {}).total).toBe(2);
  for (const item of result.items) {
    expect(item.product.brandId).toBe(item.brand.id);
    expect(item.product.referenceAssetIds).toEqual([item.asset.id]);
    expect(item.product.visibility).toBe('private');
    expect(item.brand.visibility).toBe('private');
    expect(item.asset.tags).toContain('虚构对比测试');
    const content = await core.assets.readOriginal(actor, workspaceId, item.asset.id);
    expect(await sharp(content.buffer).metadata()).toMatchObject({
      width: 1200,
      height: 1200,
      format: 'png',
    });
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('retains user edits and identities on repeated imports instead of overwriting or duplicating', async () => {
  const original = await importComparisonFixtures(core, actor, workspaceId);
  const first = original.items[0]!;
  core.references.updateBrand(actor, workspaceId, first.brandId, { name: '已自定义品牌名' });
  core.knowledge.updateProduct(actor, workspaceId, first.productId, {
    expectedVersion: first.product.version,
    name: '已自定义商品名',
    facts: ['本次实验改为480毫升'],
  });
  const again = await importComparisonFixtures(core, actor, workspaceId);
  expect(again.created).toBe(false);
  expect(again.items.map((item) => item.assetId)).toEqual(
    original.items.map((item) => item.assetId),
  );
  expect(again.items[0]?.brand.name).toBe('已自定义品牌名');
  expect(again.items[0]?.product.facts).toEqual(['本次实验改为480毫升']);
  expect(core.assets.list(actor, workspaceId, {}).total).toBe(2);
});

it('rolls back all records and removes prepared media if the second brand exceeds the quota', async () => {
  db.sqlite
    .prepare("UPDATE entitlement_defaults SET limits_json=json_set(limits_json,'$.brands',1)")
    .run();
  await expect(importComparisonFixtures(core, actor, workspaceId)).rejects.toMatchObject({
    code: 'ENTITLEMENT_LIMIT',
  });
  for (const table of ['brands', 'products', 'assets', 'asset_variants', 'audit_events']) {
    const sql =
      table === 'audit_events'
        ? "SELECT count(*) AS n FROM audit_events WHERE action LIKE 'comparison.%' OR action IN ('brand.create','product.create','asset.create')"
        : `SELECT count(*) AS n FROM ${table}`;
    expect(db.sqlite.prepare(sql).get()).toEqual({ n: 0 });
  }
  const files = await readdir(join(directory, 'media'), { recursive: true, withFileTypes: true });
  expect(files.filter((file) => file.isFile())).toHaveLength(0);
});

it('refuses unrelated spaces, inaccessible users and auto-restoring deleted samples', async () => {
  db.sqlite.prepare('UPDATE workspaces SET name=? WHERE id=?').run('正式创作', workspaceId);
  await expect(importComparisonFixtures(core, actor, workspaceId)).rejects.toThrow('独立空间');
  expect(core.assets.list(actor, workspaceId, {}).total).toBe(0);
  db.sqlite
    .prepare('UPDATE workspaces SET name=? WHERE id=?')
    .run(COMPARISON_WORKSPACE_NAME, workspaceId);
  await expect(
    importComparisonFixtures(core, { ...actor, userId: 'inaccessible' }, workspaceId),
  ).rejects.toThrow();
  const result = await importComparisonFixtures(core, actor, workspaceId);
  core.knowledge.removeProduct(actor, workspaceId, result.items[0]!.productId);
  await expect(importComparisonFixtures(core, actor, workspaceId)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(core.knowledge.listProducts(actor, workspaceId).total).toBe(1);
  expect(core.assets.list(actor, workspaceId, {}).total).toBe(2);
  expect(comparisonFixtures).toHaveLength(2);
});

it('imports into the explicitly authorized current space without bypassing ownership or overwriting edits', async () => {
  db.sqlite.prepare('UPDATE workspaces SET name=? WHERE id=?').run('当前个人空间', workspaceId);
  const options = {
    currentWorkspaceAuthorization: { userId: actor.userId, workspaceId },
  };
  await expect(importComparisonFixtures(core, actor, workspaceId)).rejects.toThrow('独立空间');
  await expect(
    importComparisonFixtures(core, actor, workspaceId, {
      currentWorkspaceAuthorization: { userId: actor.userId, workspaceId: 'another-workspace' },
    }),
  ).rejects.toThrow('授权与实际用户或空间不一致');
  await expect(
    importComparisonFixtures(core, { ...actor, userId: 'inaccessible' }, workspaceId, {
      currentWorkspaceAuthorization: { userId: 'inaccessible', workspaceId },
    }),
  ).rejects.toThrow();
  expect(core.assets.list(actor, workspaceId, {}).total).toBe(0);

  const original = await importComparisonFixtures(core, actor, workspaceId, options);
  expect(original.created).toBe(true);
  expect(original.items).toHaveLength(2);
  const first = original.items[0]!;
  core.knowledge.updateProduct(actor, workspaceId, first.productId, {
    expectedVersion: first.product.version,
    facts: ['用户在当前空间修改的规格'],
  });
  const again = await importComparisonFixtures(core, actor, workspaceId, options);
  expect(again.created).toBe(false);
  expect(again.items.map((item) => item.productId)).toEqual(
    original.items.map((item) => item.productId),
  );
  expect(again.items[0]?.product.facts).toEqual(['用户在当前空间修改的规格']);
  expect(core.assets.list(actor, workspaceId, {}).total).toBe(2);
  expect(core.references.brands(actor, workspaceId, {}).total).toBe(2);
  expect(core.knowledge.listProducts(actor, workspaceId).total).toBe(2);
  // An old receipt does not implicitly grant authorization for future runs.
  await expect(importComparisonFixtures(core, actor, workspaceId)).rejects.toThrow('独立空间');
  const receipts = db.sqlite
    .prepare("SELECT details_json FROM audit_events WHERE action='comparison.fixtures.import.v1'")
    .all() as { details_json: string }[];
  expect(receipts).toHaveLength(1);
  expect(JSON.parse(receipts[0]!.details_json)).toMatchObject({
    destination: 'explicit-current-workspace',
    authorizationTarget: { userId: actor.userId, workspaceId },
  });
  expect(fetch).not.toHaveBeenCalled();
});

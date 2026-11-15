import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/server/app';
import type { Actor } from '../src/contracts/core';
import { MemoryInputSchema, ProductInputSchema } from '../src/contracts/knowledge';

let app: Awaited<ReturnType<typeof createApp>>;
let temp: string;
let owner: Actor;
let member: Actor;
let wid: string;
let cookie: string;
const start = '2026-01-01T00:00:00.000Z';
const memory = (fields: Record<string, unknown> = {}) => ({
  topic: '创作语气',
  content: '简洁克制',
  kind: 'preference',
  ...fields,
});
const product = (fields: Record<string, unknown> = {}) => ({
  name: '陶瓷白杯',
  facts: ['容量350毫升'],
  ...fields,
});
const headers = () => ({ cookie, origin: 'http://127.0.0.1:5174', 'x-workspace-id': wid });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External network forbidden');
    }),
  );
  temp = await mkdtemp(join(tmpdir(), 'yingzao-knowledge-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(temp, 'fixture.sqlite'),
      storageDir: join(temp, 'media'),
      sessionSecret: 'knowledge-fixture-session',
      encryptionKey: 'knowledge-fixture-encryption',
      isProduction: false,
      demoMode: true,
      environmentSecrets: {},
    },
    { serveWeb: false },
  );
  const account = await app.services.core.auth.register({
    email: 'knowledge@example.test',
    password: 'KnowledgeFixture2026!',
    displayName: '资料测试',
  });
  owner = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = account.workspace.id;
  cookie = `studio_session=${account.sessionToken}`;
  member = { ...owner, userId: randomUUID() };
  app.services.db.sqlite
    .prepare(
      'INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(member.userId, 'member@example.test', 'fixture-no-login', '同空间成员', start, start);
  app.services.db.sqlite
    .prepare(
      "INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,'member',?,?)",
    )
    .run(randomUUID(), wid, member.userId, start, start);
});
afterEach(async () => {
  await app.app.close();
  await rm(temp, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const knowledge = () => app.services.core.knowledge;

describe('private creative memory', () => {
  it('isolates owners and workspaces and permits a viewer to maintain only their own memory', () => {
    const created = knowledge().createMemory(owner, wid, memory());
    expect(knowledge().listMemories(member, wid).total).toBe(0);
    for (const action of [
      () => knowledge().getMemory(member, wid, created.id),
      () => knowledge().updateMemory(member, wid, created.id, { ...memory(), expectedVersion: 1 }),
      () => knowledge().removeMemory(member, wid, created.id),
      () => knowledge().getMemory(owner, randomUUID(), created.id),
    ])
      expect(action).toThrow();
    app.services.db.sqlite
      .prepare("UPDATE memberships SET role='viewer' WHERE user_id=?")
      .run(member.userId);
    expect(knowledge().createMemory(member, wid, memory()).userId).toBe(member.userId);
    expect(knowledge().listMemories(owner, wid).total).toBe(1);
  });
  it('uses exact half-life and expiry boundaries without refreshing confirmation on reads', () => {
    const p = knowledge().createMemory(owner, wid, memory());
    const stable = knowledge().createMemory(owner, wid, memory({ topic: '职业', kind: 'profile' }));
    expect(p.halfLifeDays).toBe(90);
    vi.setSystemTime(Date.parse(start) + 180 * 86400000);
    expect(knowledge().getMemory(owner, wid, p.id)).toMatchObject({
      effectiveWeight: 0.25,
      eligible: true,
      confirmedAt: start,
    });
    vi.setSystemTime(Date.parse(start) + 180 * 86400000 + 1);
    expect(knowledge().getMemory(owner, wid, p.id).eligible).toBe(false);
    expect(knowledge().getMemory(owner, wid, stable.id)).toMatchObject({
      effectiveWeight: 1,
      eligible: true,
      confirmedAt: start,
    });
    const expiry = new Date(Date.now() + 1000).toISOString();
    const temporary = knowledge().createMemory(
      owner,
      wid,
      memory({ topic: '活动', kind: 'temporary', expiresAt: expiry }),
    );
    vi.setSystemTime(expiry);
    expect(knowledge().getMemory(owner, wid, temporary.id)).toMatchObject({
      eligible: false,
      effectiveWeight: 0,
    });
    expect(knowledge().listMemories(owner, wid).total).toBe(3);
  });
  it('replaces an existing version on explicit confirmation and rejects stale concurrent writes', () => {
    const p = knowledge().createMemory(owner, wid, memory());
    vi.setSystemTime('2026-02-01T00:00:00.000Z');
    const changed = knowledge().updateMemory(owner, wid, p.id, {
      ...memory({ content: '活泼有趣' }),
      expectedVersion: 1,
    });
    expect(changed).toMatchObject({
      version: 2,
      content: '活泼有趣',
      confirmedAt: '2026-02-01T00:00:00.000Z',
      effectiveWeight: 1,
    });
    expect(() =>
      knowledge().updateMemory(owner, wid, p.id, { ...memory(), expectedVersion: 1 }),
    ).toThrow('记录已被修改');
    expect(knowledge().listMemories(owner, wid).items).toHaveLength(1);
    knowledge().removeMemory(owner, wid, p.id);
    expect(knowledge().resolveMemories(owner, wid, 'image').items).toEqual([]);
    expect(
      app.services.db.sqlite.prepare('SELECT 1 FROM creative_memories WHERE id=?').get(p.id),
    ).toBeUndefined();
  });
  it('allows pausing an expired temporary record without reconfirming it, and requires a future expiry when enabling it', () => {
    const fields = memory({ kind: 'temporary', expiresAt: '2026-01-02T00:00:00.000Z' });
    const saved = knowledge().createMemory(owner, wid, fields);
    vi.setSystemTime('2026-01-03T00:00:00.000Z');
    const paused = knowledge().updateMemory(owner, wid, saved.id, {
      ...fields,
      status: 'paused',
      expectedVersion: 1,
    });
    expect(paused).toMatchObject({
      status: 'paused',
      confirmedAt: start,
      eligible: false,
      version: 2,
    });
    expect(() =>
      knowledge().updateMemory(owner, wid, saved.id, {
        ...fields,
        status: 'active',
        expectedVersion: 2,
      }),
    ).toThrow('未来');
    expect(() =>
      knowledge().updateMemory(owner, wid, saved.id, {
        ...fields,
        content: '改变内容',
        status: 'paused',
        expectedVersion: 2,
      }),
    ).toThrow('未来');
    const renewed = knowledge().updateMemory(owner, wid, saved.id, {
      ...fields,
      expiresAt: '2026-01-04T00:00:00.000Z',
      status: 'active',
      expectedVersion: 2,
    });
    expect(renewed).toMatchObject({ eligible: true, confirmedAt: '2026-01-03T00:00:00.000Z' });
  });
  it('rejects duplicate topics and constrains memory types, future dates and record capacity', () => {
    knowledge().createMemory(owner, wid, memory({ topic: ' Tone ' }));
    expect(() => knowledge().createMemory(owner, wid, memory({ topic: 'tone' }))).toThrow(
      '已有同主题',
    );
    expect(() => knowledge().createMemory(owner, wid, memory({ kind: 'temporary' }))).toThrow();
    expect(() =>
      knowledge().createMemory(owner, wid, memory({ kind: 'temporary', expiresAt: start })),
    ).toThrow('未来');
    expect(MemoryInputSchema.safeParse(memory({ kind: 'profile', halfLifeDays: 30 })).success).toBe(
      false,
    );
    expect(MemoryInputSchema.safeParse(memory({ halfLifeDays: 0 })).success).toBe(false);
    for (let i = 1; i < 100; i++)
      knowledge().createMemory(owner, wid, memory({ topic: `主题${i}` }));
    expect(() => knowledge().createMemory(owner, wid, memory({ topic: '超限' }))).toThrow(
      '最多保存100',
    );
  });
  it('filters media, paused, expired and decayed records and makes specific media override general topics', () => {
    knowledge().createMemory(
      owner,
      wid,
      memory({ topic: '风格', mediaType: 'all', content: '通用' }),
    );
    const specific = knowledge().createMemory(
      owner,
      wid,
      memory({ topic: '风格', mediaType: 'image', content: '图片优先' }),
    );
    knowledge().createMemory(owner, wid, memory({ topic: '视频专用', mediaType: 'video' }));
    knowledge().createMemory(owner, wid, memory({ topic: '停用', status: 'paused' }));
    knowledge().createMemory(owner, wid, memory({ topic: '过期', expiresAt: start }));
    knowledge().createMemory(owner, wid, memory({ topic: '短偏好', halfLifeDays: 1 }));
    vi.setSystemTime(Date.parse(start) + 3 * 86400000);
    expect(knowledge().resolveMemories(owner, wid, 'image')).toMatchObject({
      items: [{ id: specific.id }],
      omitted: 1,
    });
    expect(
      knowledge()
        .resolveMemories(owner, wid, 'video')
        .items.map((m) => m.topic)
        .sort(),
    ).toEqual(['视频专用', '风格'].sort());
  });
  it('selects at most eight records and bounds total selected text without silently slicing content', () => {
    for (let i = 0; i < 10; i++)
      knowledge().createMemory(
        owner,
        wid,
        memory({ topic: `主题${i}`, content: '字'.repeat(1900) }),
      );
    const result = knowledge().resolveMemories(owner, wid, 'image');
    expect(result.items).toHaveLength(3);
    expect(result.omitted).toBe(7);
    expect(result.items.every((m) => m.content.length === 1900)).toBe(true);
    expect(
      result.items.reduce((n, m) => n + m.topic.length + m.content.length, 0),
    ).toBeLessThanOrEqual(6000);
    for (const item of knowledge().listMemories(owner, wid).items)
      knowledge().removeMemory(owner, wid, item.id);
    for (let i = 0; i < 10; i++)
      knowledge().createMemory(owner, wid, memory({ topic: `短主题${i}` }));
    expect(knowledge().resolveMemories(owner, wid, 'image')).toMatchObject({
      items: expect.any(Array),
      omitted: 2,
    });
    expect(knowledge().resolveMemories(owner, wid, 'image').items).toHaveLength(8);
  });
  it('prioritizes active temporary requirements and recent preferences ahead of profile under a limited context budget', () => {
    for (let i = 0; i < 9; i++)
      knowledge().createMemory(owner, wid, memory({ topic: `背景${i}`, kind: 'profile' }));
    const preference = knowledge().createMemory(owner, wid, memory());
    const temporary = knowledge().createMemory(
      owner,
      wid,
      memory({ topic: '当前活动', kind: 'temporary', expiresAt: '2026-02-01T00:00:00.000Z' }),
    );
    const chosen = knowledge().resolveMemories(owner, wid, 'image');
    expect(chosen.items.slice(0, 2).map((m) => m.id)).toEqual([temporary.id, preference.id]);
    expect(chosen.items).toHaveLength(8);
    expect(chosen.omitted).toBe(3);
  });
  it('rejects duplicate Unicode-case topics consistently with resolution', () => {
    const first = knowledge().createMemory(owner, wid, memory({ topic: 'Ästhetik' }));
    expect(() =>
      knowledge().createMemory(owner, wid, memory({ topic: 'ästhetik', content: '相反偏好' })),
    ).toThrow('已有同主题');
    const other = knowledge().createMemory(owner, wid, memory({ topic: '另一个主题' }));
    expect(() =>
      knowledge().updateMemory(owner, wid, other.id, { topic: 'ästhetik', expectedVersion: 1 }),
    ).toThrow('已有同主题');
    expect(
      knowledge()
        .resolveMemories(owner, wid, 'image')
        .items.filter((m) => m.topic.toLowerCase() === first.topic.toLowerCase()),
    ).toHaveLength(1);
  });
  it('resolves legacy Unicode-case duplicates once without deleting either stored record', () => {
    const first = knowledge().createMemory(
      owner,
      wid,
      memory({ topic: 'Ästhetik', content: '旧偏好' }),
    );
    vi.setSystemTime('2026-01-02T00:00:00.000Z');
    const second = knowledge().createMemory(
      owner,
      wid,
      memory({ topic: '原始第二主题', content: '新偏好' }),
    );
    app.services.db.sqlite
      .prepare('UPDATE creative_memories SET topic=? WHERE id=?')
      .run('ästhetik', second.id);
    const selected = knowledge().resolveMemories(owner, wid, 'image');
    expect(selected.items.map((m) => m.id)).toEqual([second.id]);
    expect(selected.omitted).toBe(1);
    expect(knowledge().listMemories(owner, wid).total).toBe(2);
    expect(knowledge().getMemory(owner, wid, first.id).content).toBe('旧偏好');
  });
});

describe('reusable products', () => {
  it('enforces private visibility, workspace ownership and read-only members', () => {
    const p = knowledge().createProduct(owner, wid, product());
    expect(knowledge().listProducts(member, wid).total).toBe(0);
    expect(() => knowledge().getProduct(member, wid, p.id)).toThrow();
    expect(() => knowledge().getProduct(owner, randomUUID(), p.id)).toThrow();
    const shared = knowledge().createProduct(owner, wid, product({ visibility: 'workspace' }));
    expect(knowledge().getProduct(member, wid, shared.id).id).toBe(shared.id);
    app.services.db.sqlite
      .prepare("UPDATE memberships SET role='viewer' WHERE user_id=?")
      .run(member.userId);
    expect(() =>
      knowledge().updateProduct(member, wid, shared.id, { ...product(), expectedVersion: 1 }),
    ).toThrow();
    expect(() => knowledge().removeProduct(member, wid, shared.id)).toThrow();
  });
  it('prevents a shared product from exposing a private, deleted or inaccessible brand', () => {
    const brand = app.services.core.references.createBrand(owner, wid, {
      name: '品牌',
      visibility: 'workspace',
    });
    const p = knowledge().createProduct(
      owner,
      wid,
      product({ brandId: brand.id, visibility: 'workspace' }),
    );
    expect(knowledge().getProduct(member, wid, p.id).id).toBe(p.id);
    app.services.core.references.updateBrand(owner, wid, brand.id, { visibility: 'private' });
    expect(knowledge().listProducts(member, wid).total).toBe(0);
    expect(() => knowledge().getProduct(member, wid, p.id)).toThrow();
    expect(() =>
      knowledge().createProduct(
        owner,
        wid,
        product({ brandId: brand.id, visibility: 'workspace' }),
      ),
    ).toThrow('私有');
    app.services.core.references.removeBrand(owner, wid, brand.id);
    expect(knowledge().listProducts(member, wid).total).toBe(0);
    expect(knowledge().getProduct(owner, wid, p.id).id).toBe(p.id);
    const rescued = knowledge().updateProduct(owner, wid, p.id, {
      ...product({ visibility: 'workspace', brandId: null }),
      expectedVersion: 1,
    });
    expect(rescued.brandId).toBeNull();
    expect(knowledge().getProduct(member, wid, p.id).id).toBe(p.id);
  });
  it('uses versions on update, delete and restore, and retains expired records for management', () => {
    const p = knowledge().createProduct(owner, wid, product({ validUntil: start }));
    const updated = knowledge().updateProduct(owner, wid, p.id, {
      ...product({ facts: ['容量500毫升'], validUntil: start }),
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ version: 2, facts: ['容量500毫升'] });
    expect(() =>
      knowledge().updateProduct(owner, wid, p.id, { ...product(), expectedVersion: 1 }),
    ).toThrow('记录已被修改');
    knowledge().removeProduct(owner, wid, p.id);
    expect(knowledge().listProducts(owner, wid).total).toBe(0);
    expect(knowledge().listProducts(owner, wid, { deleted: true }).items[0]?.version).toBe(3);
    const restored = knowledge().restoreProduct(owner, wid, p.id);
    expect(restored).toMatchObject({ version: 4, validUntil: start, deletedAt: null });
    expect(knowledge().restoreProduct(owner, wid, p.id).version).toBe(4);
  });
  it('validates media and brand links again on restore and rejects duplicate or excessive assets', async () => {
    const buffer = await sharp({
      create: { width: 24, height: 24, channels: 4, background: '#fff' },
    })
      .png()
      .toBuffer();
    const asset = await app.services.core.assets.ingest(owner, wid, {
      buffer,
      name: 'cup.png',
      mimeType: 'image/png',
      source: 'upload',
    });
    const p = knowledge().createProduct(owner, wid, product({ referenceAssetIds: [asset.id] }));
    knowledge().removeProduct(owner, wid, p.id);
    app.services.db.sqlite
      .prepare('UPDATE assets SET deleted_at=? WHERE id=?')
      .run(start, asset.id);
    expect(() => knowledge().restoreProduct(owner, wid, p.id)).toThrow();
    expect(() =>
      knowledge().createProduct(owner, wid, product({ referenceAssetIds: [asset.id] })),
    ).toThrow();
    expect(
      ProductInputSchema.safeParse(product({ referenceAssetIds: [asset.id, asset.id] })).success,
    ).toBe(false);
    expect(
      ProductInputSchema.safeParse(
        product({ referenceAssetIds: Array.from({ length: 5 }, () => randomUUID()) }),
      ).success,
    ).toBe(false);
    expect(ProductInputSchema.safeParse(product({ facts: ['x'.repeat(501)] })).success).toBe(false);
  });
});

describe('recycled product repair', () => {
  it('repairs invalid associations while retaining deleted state before explicit restore', async () => {
    const brand = app.services.core.references.createBrand(owner, wid, { name: '待清理品牌' });
    const buffer = await sharp({
      create: { width: 24, height: 24, channels: 4, background: '#fff' },
    })
      .png()
      .toBuffer();
    const asset = await app.services.core.assets.ingest(owner, wid, {
      buffer,
      name: 'old.png',
      mimeType: 'image/png',
    });
    const p = knowledge().createProduct(
      owner,
      wid,
      product({ brandId: brand.id, referenceAssetIds: [asset.id] }),
    );
    knowledge().removeProduct(owner, wid, p.id);
    app.services.core.references.removeBrand(owner, wid, brand.id);
    app.services.db.sqlite
      .prepare('UPDATE assets SET deleted_at=? WHERE id=?')
      .run(start, asset.id);
    expect(() => knowledge().restoreProduct(owner, wid, p.id)).toThrow();
    const repaired = knowledge().updateProduct(owner, wid, p.id, {
      ...product({ brandId: null, referenceAssetIds: [] }),
      expectedVersion: 2,
    });
    expect(repaired).toMatchObject({
      version: 3,
      deletedAt: start,
      brandId: null,
      referenceAssetIds: [],
    });
    expect(knowledge().listProducts(owner, wid).total).toBe(0);
    expect(() => knowledge().getProduct(owner, wid, p.id)).toThrow();
    expect(() =>
      knowledge().updateProduct(owner, wid, p.id, { ...product(), expectedVersion: 2 }),
    ).toThrow('记录已被修改');
    expect(knowledge().restoreProduct(owner, wid, p.id)).toMatchObject({
      version: 4,
      deletedAt: null,
    });
  });
});

describe('knowledge HTTP contracts', () => {
  it('returns an explicit permission error when another member tries to make a shared product private', async () => {
    const saved = knowledge().createProduct(owner, wid, product({ visibility: 'workspace' }));
    const updated = knowledge().updateProduct(member, wid, saved.id, {
      name: '成员更新名称',
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ visibility: 'workspace', version: 2 });
    try {
      knowledge().updateProduct(member, wid, saved.id, {
        visibility: 'private',
        expectedVersion: 2,
      });
      throw new Error('Expected a visibility permission rejection');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 403, code: 'PRODUCT_VISIBILITY_FORBIDDEN' });
    }
    expect(knowledge().getProduct(owner, wid, saved.id)).toMatchObject({
      name: '成员更新名称',
      visibility: 'workspace',
      version: 2,
    });
  });
  it('preserves omitted memory fields on PATCH and applies explicit nulls and kind changes safely', async () => {
    const saved = knowledge().createMemory(
      owner,
      wid,
      memory({
        mediaType: 'video',
        status: 'paused',
        halfLifeDays: 30,
        expiresAt: '2026-04-01T00:00:00.000Z',
      }),
    );
    const update = (payload: Record<string, unknown>) =>
      app.app.inject({
        method: 'PATCH',
        url: `/api/v1/memories/${saved.id}`,
        headers: headers(),
        payload,
      });
    const renamed = await update({
      topic: '新的偏好主题',
      content: '新的内容',
      kind: 'preference',
      expectedVersion: 1,
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().data).toMatchObject({
      mediaType: 'video',
      status: 'paused',
      halfLifeDays: 30,
      expiresAt: saved.expiresAt,
    });
    const stable = await update({ kind: 'profile', expiresAt: null, expectedVersion: 2 });
    expect(stable.statusCode, stable.body).toBe(200);
    expect(stable.json().data).toMatchObject({
      topic: '新的偏好主题',
      content: '新的内容',
      kind: 'profile',
      halfLifeDays: null,
      expiresAt: null,
      status: 'paused',
    });
    const missingExpiry = await update({ kind: 'temporary', expectedVersion: 3 });
    expect(missingExpiry.statusCode).toBe(400);
    const temporary = await update({
      kind: 'temporary',
      expiresAt: '2026-01-02T00:00:00.000Z',
      expectedVersion: 3,
    });
    expect(temporary.statusCode, temporary.body).toBe(200);
    expect(temporary.json().data).toMatchObject({ kind: 'temporary', version: 4 });
    const cleared = await update({ expiresAt: null, expectedVersion: 4 });
    expect(cleared.statusCode).toBe(400);
    knowledge().createMemory(owner, wid, memory({ topic: '新的偏好主题', mediaType: 'image' }));
    const conflict = await update({ mediaType: 'image', expectedVersion: 4 });
    expect(conflict.statusCode).toBe(409);
    vi.setSystemTime('2026-01-03T00:00:00.000Z');
    const expired = await update({ status: 'active', expectedVersion: 4 });
    expect(expired.statusCode).toBe(400);
    expect(knowledge().getMemory(owner, wid, saved.id)).toMatchObject({
      version: 4,
      status: 'paused',
      mediaType: 'video',
    });
  });
  it('preserves product associations and facts when PATCH changes only its name', async () => {
    const brand = app.services.core.references.createBrand(owner, wid, { name: '部分更新品牌' });
    const saved = knowledge().createProduct(
      owner,
      wid,
      product({
        description: '必须保留描述',
        cautions: ['不可宣称抗菌'],
        brandId: brand.id,
        visibility: 'workspace',
        validUntil: '2026-04-01T00:00:00.000Z',
      }),
    );
    const rename = await app.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${saved.id}`,
      headers: headers(),
      payload: { name: '仅修改名称', expectedVersion: 1 },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    expect(rename.json().data).toMatchObject({
      name: '仅修改名称',
      description: saved.description,
      facts: saved.facts,
      cautions: saved.cautions,
      brandId: saved.brandId,
      visibility: saved.visibility,
      validUntil: saved.validUntil,
    });
    const clear = await app.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${saved.id}`,
      headers: headers(),
      payload: { brandId: null, validUntil: null, expectedVersion: 2 },
    });
    expect(clear.statusCode, clear.body).toBe(200);
    expect(clear.json().data).toMatchObject({
      name: '仅修改名称',
      brandId: null,
      validUntil: null,
      facts: saved.facts,
    });
  });
  it('provides current authorized records for conflict review without exposing another user private memory', async () => {
    const saved = knowledge().createMemory(owner, wid, memory());
    const current = knowledge().updateMemory(owner, wid, saved.id, {
      content: '另一窗口保存的内容',
      expectedVersion: 1,
    });
    const conflict = await app.app.inject({
      method: 'PATCH',
      url: `/api/v1/memories/${saved.id}`,
      headers: headers(),
      payload: { content: '过期窗口内容', expectedVersion: 1 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.details.current).toEqual(current);
    try {
      knowledge().updateMemory(member, wid, saved.id, { content: '不能读取', expectedVersion: 1 });
      throw new Error('Expected private record rejection');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404 });
      expect(error).not.toHaveProperty('details.current');
    }
    const p = knowledge().createProduct(owner, wid, product());
    knowledge().removeProduct(owner, wid, p.id);
    const recycled = knowledge().listProducts(owner, wid, { deleted: true }).items[0];
    const productConflict = await app.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${p.id}`,
      headers: headers(),
      payload: { name: '过期产品编辑', expectedVersion: 1 },
    });
    expect(productConflict.statusCode).toBe(409);
    expect(productConflict.json().error.details.current).toEqual(recycled);
  });
  it('returns computed memory fields, rejects malformed bodies and exposes conflicts as 409', async () => {
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: headers(),
      payload: memory(),
    });
    expect(created.statusCode, created.body).toBe(201);
    const saved = created.json().data;
    expect(saved).toMatchObject({
      effectiveWeight: 1,
      eligible: true,
      halfLifeDays: 90,
      version: 1,
    });
    const duplicate = await app.app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: headers(),
      payload: memory(),
    });
    expect(duplicate.statusCode).toBe(409);
    for (const payload of [
      memory({ content: '' }),
      memory({ kind: 'temporary' }),
      memory({ injected: 'field' }),
      memory({ expiresAt: 'tomorrow' }),
    ]) {
      const invalid = await app.app.inject({
        method: 'POST',
        url: '/api/v1/memories',
        headers: headers(),
        payload,
      });
      expect(invalid.statusCode, invalid.body).toBe(400);
    }
    const patch = await app.app.inject({
      method: 'PATCH',
      url: `/api/v1/memories/${saved.id}`,
      headers: headers(),
      payload: { ...memory(), expectedVersion: 1 },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const stale = await app.app.inject({
      method: 'PATCH',
      url: `/api/v1/memories/${saved.id}`,
      headers: headers(),
      payload: { ...memory(), expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
    const listing = await app.app.inject({ url: '/api/v1/memories', headers: headers() });
    expect(listing.json().data.items[0]).toMatchObject({
      eligible: true,
      effectiveWeight: 1,
      version: 2,
    });
  });
  it('requires sessions, denies API keys for memory and preserves product response fields', async () => {
    const noSession = await app.app.inject({
      url: '/api/v1/memories',
      headers: { 'x-workspace-id': wid },
    });
    expect(noSession.statusCode).toBe(401);
    const key = app.services.core.business.createKey(owner, wid, {
      name: 'Fixture',
      scopes: ['projects:read'],
    });
    const keyActor: Actor = {
      ...owner,
      authType: 'apiKey',
      apiKeyId: key.key.id,
      workspaceId: wid,
      scopes: ['projects:read'],
    };
    knowledge().createMemory(owner, wid, memory());
    expect(() => knowledge().listMemories(keyActor, wid)).toThrow('个人创作记忆');
    expect(knowledge().resolveMemories(keyActor, wid, 'image')).toEqual({ items: [], omitted: 0 });
    for (const method of ['GET', 'POST'] as const) {
      const response = await app.app.inject({
        method,
        url: '/api/v1/memories',
        headers: { authorization: `Bearer ${key.secret}`, 'x-workspace-id': wid },
        ...(method === 'POST' ? { payload: memory() } : {}),
      });
      expect(response.statusCode, response.body).toBe(403);
    }
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: headers(),
      payload: product(),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().data).toMatchObject({
      version: 1,
      brandId: null,
      validUntil: null,
      facts: ['容量350毫升'],
    });
    const pid = created.json().data.id;
    const bad = await app.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${pid}`,
      headers: headers(),
      payload: product(),
    });
    expect(bad.statusCode).toBe(400);
    const removed = await app.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${pid}`,
      headers: headers(),
    });
    expect(removed.statusCode).toBe(200);
    const restored = await app.app.inject({
      method: 'POST',
      url: `/api/v1/products/${pid}/restore`,
      headers: headers(),
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().data).toMatchObject({ version: 3, deletedAt: null });
  });
});

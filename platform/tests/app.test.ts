import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { backup } from '../scripts/backup';
import { restore } from '../scripts/restore';
let temp: string,
  config: AppConfig,
  instance: Awaited<ReturnType<typeof createApp>>,
  cookie: string,
  wid: string,
  uid: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'yingzao-app-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(temp, 'test.sqlite'),
    storageDir: join(temp, 'media'),
    sessionSecret: 'test-secret',
    encryptionKey: 'encryption-test-secret',
    demoMode: true,
    isProduction: false,
    environmentSecrets: {},
  };
  instance = await createApp(config, { serveWeb: false });
  const response = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'app@example.local',
      password: 'TestAppPassword2026!',
      displayName: 'API测试',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  cookie = String(response.headers['set-cookie']).split(';')[0]!;
  const data = response.json().data;
  wid = data.workspace.id;
  uid = data.user.id;
});
afterEach(async () => {
  await instance.app.close();
  await rm(temp, { recursive: true, force: true });
});
const headers = () => ({ cookie, origin: config.publicOrigin, 'x-workspace-id': wid });
describe('assembled HTTP application', () => {
  it('removes partially prepared media if writing a later variant fails before any transaction', async () => {
    const storage = instance.services.core.assets.storage;
    const original = storage.write.bind(storage);
    let count = 0;
    const write = vi.spyOn(storage, 'write').mockImplementation(async (buffer, suffix) => {
      if (++count === 2) throw new Error('injected disk failure');
      return original(buffer, suffix);
    });
    try {
      const result = await instance.app.inject({
        method: 'POST',
        url: '/api/v1/inspirations/botanical-serum/reuse',
        headers: { cookie, origin: config.publicOrigin, 'x-workspace-id': wid },
        payload: { requestId: randomUUID(), prompt: '中途写盘失败验收' },
      });
      expect(result.statusCode).toBe(500);
      const files = await readdir(config.storageDir, { recursive: true, withFileTypes: true });
      expect(files.filter((entry) => entry.isFile())).toHaveLength(0);
      for (const table of ['projects', 'assets', 'inspiration_reuses'])
        expect(
          instance.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get(),
        ).toMatchObject({ n: 0 });
    } finally {
      write.mockRestore();
    }
  });
  it('atomically reuses built-in inspiration media and parameters with replay protection', async () => {
    const payload = { requestId: randomUUID(), prompt: '保留原产品，调整为清晨场景' };
    const request = () =>
      instance.app.inject({
        method: 'POST',
        url: '/api/v1/inspirations/botanical-serum/reuse',
        headers: headers(),
        payload,
      });
    const [first, second] = await Promise.all([request(), request()]);
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);
    expect(first.json().data.project.id).toBe(second.json().data.project.id);
    const result = first.json().data;
    expect(result.draft.options.ratio).toBe('2:3');
    expect(result.draft.prompt).toBe(payload.prompt);
    expect(result.draft.assetIds).toHaveLength(1);
    const media = await instance.app.inject({
      url: `/api/v1/assets/${result.draft.assetIds[0]}/content`,
      headers: headers(),
    });
    expect(media.statusCode).toBe(200);
    expect((await sharp(media.rawPayload).metadata()).width).toBeGreaterThan(0);
    const messages = await instance.app.inject({
      url: `/api/v1/projects/${result.project.id}/messages`,
      headers: headers(),
    });
    expect(messages.json().data.total).toBe(1);
    expect(messages.json().data.items[0].metadata.draft).toEqual(result.draft);
    expect(
      instance.services.db.sqlite
        .prepare('SELECT COUNT(*) n FROM projects WHERE workspace_id=?')
        .get(wid),
    ).toEqual({ n: 1 });
    expect(
      instance.services.db.sqlite
        .prepare('SELECT COUNT(*) n FROM assets WHERE workspace_id=?')
        .get(wid),
    ).toEqual({ n: 1 });
    const conflict = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/inspirations/botanical-serum/reuse',
      headers: headers(),
      payload: { ...payload, prompt: '另一个请求' },
    });
    expect(conflict.statusCode).toBe(409);
  });
  it('rolls back inspiration project/media/journal and removes prepared files after persistence failure', async () => {
    instance.services.db.sqlite.exec(
      "CREATE TRIGGER reject_reuse_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'injected persistence failure'); END",
    );
    const payload = { requestId: randomUUID(), prompt: '回滚验收' };
    const request = () =>
      instance.app.inject({
        method: 'POST',
        url: '/api/v1/inspirations/botanical-serum/reuse',
        headers: headers(),
        payload,
      });
    const failed = await request();
    expect(failed.statusCode).toBe(500);
    for (const table of [
      'projects',
      'documents',
      'assets',
      'asset_variants',
      'messages',
      'inspiration_reuses',
    ])
      expect(instance.services.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
        n: 0,
      });
    expect(
      (await readdir(config.storageDir, { recursive: true, withFileTypes: true })).filter((entry) =>
        entry.isFile(),
      ),
    ).toHaveLength(0);
    instance.services.db.sqlite.exec('DROP TRIGGER reject_reuse_message');
    expect((await request()).statusCode).toBe(201);
  });
  it('rejects inspiration reuse from read-only members before writing files', async () => {
    instance.services.db.sqlite
      .prepare("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?")
      .run(wid, uid);
    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/inspirations/botanical-serum/reuse',
      headers: headers(),
      payload: { requestId: randomUUID(), prompt: '无权限操作' },
    });
    expect(response.statusCode).toBe(403);
    expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM projects').get()).toEqual({
      n: 0,
    });
    expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM assets').get()).toEqual({
      n: 0,
    });
  });
  it('saves unresolved creation warnings with a project draft and rejects unbounded warning metadata', async () => {
    const project = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(),
      payload: { name: '参数待确认', kind: 'image' },
    });
    const url = `/api/v1/projects/${project.json().data.id}/messages`;
    const metadata = {
      draft: {
        operation: 'image.generate',
        providerId: 'openai',
        prompt: '方向二',
        options: { ratio: '3:4' },
      },
      creationWarnings: ['建议8K不支持，当前保留1K'],
    };
    const saved = await instance.app.inject({
      method: 'POST',
      url,
      headers: headers(),
      payload: { content: '方向二', metadata },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    await instance.app.close();
    instance = await createApp(config, { serveWeb: false });
    const read = await instance.app.inject({ url, headers: headers() });
    expect(read.json().data.items[0].metadata.creationWarnings).toEqual(metadata.creationWarnings);
    const rejected = await instance.app.inject({
      method: 'POST',
      url,
      headers: headers(),
      payload: {
        content: 'invalid',
        metadata: { ...metadata, creationWarnings: Array(31).fill('x') },
      },
    });
    expect(rejected.statusCode).toBe(400);
  });
  it('integrates disabled Google and SMTP with protected callback headers, including rate-limited responses', async () => {
    const state = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/status',
      headers: headers(),
    });
    expect(state.statusCode, state.body).toBe(200);
    expect(state.json().data).toMatchObject({
      available: false,
      linked: false,
      hasLocalPassword: true,
    });
    const mail = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/mail-deliveries',
      headers: headers(),
    });
    expect(mail.statusCode, mail.body).toBe(200);
    expect(mail.json().data).toEqual({ enabled: false, items: [] });
    const denied = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/start',
      headers: { origin: 'https://foreign.example' },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    for (let n = 0; n < 31; n++) {
      const callback = await instance.app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?state=fixture-sensitive&code=fixture-sensitive',
      });
      expect(callback.headers['referrer-policy']).toBe('no-referrer');
      expect(callback.headers['cache-control']).toBe('no-store');
      if (n < 30) {
        expect(callback.statusCode).toBe(303);
        expect(callback.headers.location).toBe(
          `${config.publicOrigin}/login?google=error&code=GOOGLE_NOT_CONFIGURED`,
        );
      } else expect(callback.statusCode).toBe(429);
      expect(callback.body).not.toContain('fixture-sensitive');
    }
  });
  it('persists managed inspiration media, combined filters, favorites and archive history without leaking spaces', async () => {
    const actor = {
      userId: uid,
      authType: 'session' as const,
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    const asset = await instance.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({ create: { width: 64, height: 80, channels: 3, background: '#426856' } })
        .png()
        .toBuffer(),
      name: '自有目录.png',
      mimeType: 'image/png',
    });
    const payload = {
      title: '测试目录作品',
      category: '自有行业',
      kind: 'image',
      tag: '春季',
      platform: 'Shopify',
      ratio: '4:5',
      prompt: '保留商品细节的春季主图',
      source: '本地测试合成图',
      assetId: asset.id,
    };
    const created = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/inspirations',
      headers: headers(),
      payload,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id;
    await instance.app.inject({
      method: 'PUT',
      url: `/api/v1/inspirations/${id}/favorite`,
      headers: headers(),
      payload: { favorite: true },
    });
    await instance.app.close();
    instance = await createApp(config, { serveWeb: false });
    const found = await instance.app.inject({
      url:
        '/api/v1/inspirations?category=' +
        encodeURIComponent('自有行业') +
        '&kind=image&platform=Shopify&favorite=true&pageSize=1',
      headers: headers(),
    });
    expect(found.json().data).toMatchObject({
      total: 1,
      pageSize: 1,
      items: [{ id, isFavorite: true, mediaUnavailable: false, assetId: asset.id }],
    });
    const otherSpace = instance.services.core.auth.createWorkspace(
      actor.userId,
      '隔离空间',
      'team',
    );
    const forbidden = await instance.app.inject({
      method: 'PUT',
      url: `/api/v1/inspirations/${id}/favorite`,
      headers: { ...headers(), 'x-workspace-id': otherSpace.id },
      payload: { favorite: true },
    });
    expect(forbidden.statusCode).toBe(404);
    const reuse = (targetWid: string) =>
      instance.app.inject({
        method: 'POST',
        url: `/api/v1/inspirations/${id}/reuse`,
        headers: { ...headers(), 'x-workspace-id': targetWid },
        payload: { requestId: randomUUID(), prompt: '复用本空间素材' },
      });
    expect((await reuse(otherSpace.id)).statusCode).toBe(404);
    const reused = await reuse(wid);
    expect(reused.statusCode, reused.body).toBe(201);
    expect(reused.json().data.draft.assetIds).toEqual([asset.id]);
    expect(reused.json().data.draft.options).toMatchObject({ ratio: '4:5', platform: 'Shopify' });

    const archive = await instance.app.inject({
      method: 'PATCH',
      url: `/api/v1/inspirations/${id}`,
      headers: headers(),
      payload: { archived: true },
    });
    expect(archive.statusCode, archive.body).toBe(200);
    expect((await reuse(wid)).statusCode).toBe(409);
    const hidden = await instance.app.inject({
      url: '/api/v1/inspirations?category=' + encodeURIComponent('自有行业'),
      headers: headers(),
    });
    expect(hidden.json().data.total).toBe(0);
    const favorites = await instance.app.inject({
      url: '/api/v1/inspirations?favorite=true',
      headers: headers(),
    });
    expect(favorites.json().data.items).toMatchObject([{ id, archived: true }]);
    expect(
      (
        await instance.app.inject({
          method: 'PATCH',
          url: '/api/v1/inspirations/botanical-serum',
          headers: headers(),
          payload: { archived: true },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('merges only explicitly changed preferences without restoring schema defaults', async () => {
    const h = headers();
    await instance.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: h,
      payload: {
        preferences: {
          onboardingCompleted: true,
          defaultPlatform: 'Shopify',
          defaultCreationLanguage: 'ja',
          confirmGeneration: false,
        },
      },
    });
    const updated = await instance.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: h,
      payload: { preferences: { locale: 'en', theme: 'dark' } },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().data.preferences).toMatchObject({
      onboardingCompleted: true,
      defaultPlatform: 'Shopify',
      defaultCreationLanguage: 'ja',
      confirmGeneration: false,
      locale: 'en',
      theme: 'dark',
    });
  });

  it('enforces authentication and same-origin writes, and generates valid OpenAPI', async () => {
    expect((await instance.app.inject('/api/v1/capabilities')).statusCode).toBe(401);
    const blocked = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { ...headers(), origin: 'https://evil.example' },
      payload: { name: 'CSRF', kind: 'image' },
    });
    expect(blocked.statusCode).toBe(403);
    const missing = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie, 'x-workspace-id': wid },
      payload: { name: 'CSRF', kind: 'image' },
    });
    expect(missing.statusCode).toBe(403);
    const schema = await instance.app.inject({ url: '/api/v1/openapi.json', headers: headers() });
    expect(schema.statusCode, schema.body).toBe(200);
    expect(Object.keys(schema.json().paths).length).toBeGreaterThan(70);
    expect(schema.json().paths['/api/v1/jobs'].post.requestBody).toBeTruthy();
  });
  it('persists favorites, project draft metadata, and secrets without leaking plaintext', async () => {
    const h = headers();
    const favorite = await instance.app.inject({
      method: 'PUT',
      url: '/api/v1/inspirations/botanical-serum/favorite',
      headers: h,
      payload: { favorite: true },
    });
    expect(favorite.statusCode, favorite.body).toBe(200);
    const list = await instance.app.inject({ url: '/api/v1/inspirations', headers: h });
    expect(
      list.json().data.items.find((r: { id: string }) => r.id === 'botanical-serum').isFavorite,
    ).toBe(true);
    const project = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: h,
      payload: { name: '会话草稿', kind: 'image' },
    });
    const id = project.json().data.id;
    const draft = {
      operation: 'image.generate',
      providerId: 'openai',
      prompt: '植物摄影',
      options: { count: 2, ratio: '2:3' },
    };
    const message = await instance.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/messages`,
      headers: h,
      payload: { role: 'user', content: '植物摄影', metadata: { draft } },
    });
    expect(message.statusCode, message.body).toBe(200);
    const messages = await instance.app.inject({
      url: `/api/v1/projects/${id}/messages`,
      headers: h,
    });
    expect(messages.json().data.items[0].metadata.draft.options.count).toBe(2);
    const secret = 'sk-test-sensitive-plaintext-never-returned';
    const saved = await instance.app.inject({
      method: 'PUT',
      url: '/api/v1/providers',
      headers: h,
      payload: { providerId: 'openai', secret, enabled: true },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain(secret);
    expect(
      instance.services.db.sqlite.prepare('SELECT encrypted_secret FROM provider_settings').get(),
    ).not.toEqual({ encrypted_secret: secret });
  });
  it('redeems a valid code exactly once with an immutable ledger entry', async () => {
    const code = 'YZ-integration-test-code';
    instance.services.db.sqlite
      .prepare('INSERT INTO redemption_codes(id,code_hash,credits,created_at) VALUES(?,?,?,?)')
      .run(
        randomUUID(),
        createHash('sha256').update(code).digest('hex'),
        100,
        new Date().toISOString(),
      );
    const input = {
      method: 'POST' as const,
      url: '/api/v1/credits/redeem',
      headers: headers(),
      payload: { code },
    };
    expect((await instance.app.inject(input)).json().data.balance).toBe(1100);
    expect((await instance.app.inject(input)).statusCode).toBe(409);
    const ledger = await instance.app.inject({
      url: '/api/v1/credits/ledger?kind=grant',
      headers: headers(),
    });
    expect(ledger.json().data.items).toHaveLength(2);
    expect(
      ledger
        .json()
        .data.items.every(
          (r: Record<string, unknown>) => r.balanceAfter !== undefined && r.createdAt !== undefined,
        ),
    ).toBe(true);
  });
  it('backs up and restores database, original assets, and encryption keys without overwriting', async () => {
    const actor = {
      userId: uid,
      authType: 'session' as const,
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    const asset = await instance.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({ create: { width: 32, height: 24, channels: 3, background: '#426856' } })
        .png()
        .toBuffer(),
      name: '备份.png',
      mimeType: 'image/png',
    });
    const destination = await backup(config, join(temp, 'backup'));
    const restored = await restore(destination, join(temp, 'restored'));
    expect(JSON.parse(await readFile(join(restored, 'keys.json'), 'utf8')).encryptionKey).toBe(
      config.encryptionKey,
    );
    expect(asset.width).toBe(32);
    await expect(restore(destination, restored)).rejects.toThrow('恢复目标已存在');
  });
});

it('refreshes authenticated and anonymous export policies from server-side workspace entitlements', async () => {
  config.exportWatermark = { mode: 'non-subscribers', text: 'Studio Proof', opacity: 0.3 };
  expect((await instance.app.inject({ url: '/api/v1/export-policy' })).statusCode).toBe(401);
  const demo = await instance.app.inject({ url: '/api/v1/export-policy', headers: headers() });
  expect(demo.statusCode, demo.body).toBe(200);
  expect(demo.json().data).toMatchObject({ reason: 'demo-exempt', watermark: null });
  instance.services.db.sqlite.prepare('UPDATE workspaces SET is_demo=0 WHERE id=?').run(wid);
  const real = await instance.app.inject({
    url: '/api/v1/export-policy?hasActiveSubscription=true',
    headers: headers(),
  });
  expect(real.json().data).toMatchObject({
    reason: 'required',
    watermark: { text: 'Studio Proof' },
  });
  const actor = {
    userId: uid,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const project = instance.services.core.projects.create(actor, wid, { name: 'Policy proof' });
  const share = instance.services.core.shares.create(actor, wid, {
    projectId: project.id,
    allowOriginalDownload: true,
  });
  const token = new URL(share.shareUrl).hash.slice('#token='.length);
  const read = () =>
    instance.app.inject({ method: 'POST', url: '/api/v1/public/shares/read', payload: { token } });
  const publicBefore = await read();
  expect(publicBefore.statusCode, publicBefore.body).toBe(200);
  expect(publicBefore.json().data.exportPolicy).toMatchObject({
    reason: 'required',
    watermark: { text: 'Studio Proof' },
  });
  config.exportWatermark = { mode: 'off', text: 'Studio Proof', opacity: 0.3 };
  expect((await read()).json().data.exportPolicy).toMatchObject({
    reason: 'disabled',
    watermark: null,
  });
  instance.services.core.shares.revoke(actor, wid, share.id);
  expect((await read()).statusCode).toBe(404);
});

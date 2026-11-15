/** Isolated databases and injected read-only model catalogs; no upstream generation calls. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import type { ModelConnectionInput } from '../src/contracts/model-connections';
import { createModelConnectionsService } from '../src/server/tasks/model-connections';

let directory: string, wid: string, cookie: string;
let instance: Awaited<ReturnType<typeof createApp>>;
let config: AppConfig;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yingzao-model-connections-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(directory, 'test.sqlite'),
    storageDir: join(directory, 'media'),
    sessionSecret: 'connection-test-session',
    encryptionKey: 'connection-test-encryption',
    isProduction: false,
    demoMode: true,
    environmentSecrets: {},
  };
  instance = await createApp(config, { serveWeb: false });
  const account = await instance.services.core.auth.register({
    email: 'model-connection@example.local',
    password: 'ConnectionFixture2026!',
    displayName: '配置测试',
  });
  wid = account.workspace.id;
  cookie = `studio_session=${account.sessionToken}`;
});
afterEach(async () => {
  await instance.app.close();
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function input(overrides: Partial<ModelConnectionInput> = {}): ModelConnectionInput {
  return {
    kind: 'text',
    protocol: 'openai-chat',
    baseUrl: 'https://fixture.example/v1',
    modelsUrl: '',
    model: 'test-model',
    enabled: true,
    secret: 'private-test-key-8375',
    ...overrides,
  };
}
function request(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  payload?: object,
  workspaceId = wid,
) {
  return instance.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { cookie, origin: config.publicOrigin, 'x-workspace-id': workspaceId },
    ...(payload ? { payload } : {}),
  });
}

describe('model resource configuration', () => {
  it('persists a separate vision model, preserves it for older clients, and clears it explicitly without replacing the text model', async () => {
    const saved = await request(
      'PUT',
      '/model-connections',
      input({ visionModel: 'custom-vision-alias' }),
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({
      model: 'test-model',
      visionModel: 'custom-vision-alias',
    });
    const service = instance.services.settings.connections;
    const revision = service.revision(wid, 'image.generate');
    expect(
      createModelConnectionsService(instance.services.db, config).runtime(wid, 'text')?.visionModel,
    ).toBe('custom-vision-alias');
    const oldClient = await request('PUT', '/model-connections', input({ secret: undefined }));
    expect(oldClient.json().data.visionModel).toBe('custom-vision-alias');
    const cleared = await request(
      'PUT',
      '/model-connections',
      input({ secret: undefined, visionModel: '' }),
    );
    expect(cleared.json().data).toMatchObject({ model: 'test-model', visionModel: '' });
    expect(service.runtime(wid, 'text')?.secret).toBe(input().secret);
    expect(service.revision(wid, 'image.generate')).not.toBe(revision);
  });
  it('has three disabled slots, preserves the established generation providers, and performs no discovery on reads', async () => {
    const response = await request('GET', '/model-connections');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json().data.items).toHaveLength(3);
    for (const value of response.json().data.items)
      expect(value).toMatchObject({
        enabled: false,
        configured: false,
        model: '',
        discoveryStatus: 'never',
      });
    const providers = await request('GET', '/providers');
    expect(providers.statusCode).toBe(200);
    expect(
      providers.json().data.items.some((p: { providerId: string }) => p.providerId === 'native'),
    ).toBe(false);
  });
  it('encrypts keys at rest and never returns plaintext keys in responses', async () => {
    const response = await request('PUT', '/model-connections', input());
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain('private-test-key');
    expect(response.json().data).toMatchObject({
      configured: true,
      keyHint: '…8375',
      model: 'test-model',
    });
    const row = instance.services.db.sqlite.prepare('SELECT * FROM model_connections').get() as {
      encrypted_secret: string;
    };
    expect(JSON.stringify(row)).not.toContain('private-test-key');
    const fresh = createModelConnectionsService(instance.services.db, config);
    expect(fresh.runtime(wid, 'text')?.secret).toBe(input().secret);
  });
  it('allows key-first discovery without a selected model, and requires a model before enabling', async () => {
    const saved = await request('PUT', '/model-connections', input({ model: '', enabled: false }));
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data.configured).toBe(true);
    expect(instance.services.settings.connections.runtime(wid, 'text')).toBeUndefined();
    expect(
      (await request('PUT', '/model-connections', input({ model: '', enabled: true }))).statusCode,
    ).toBe(400);
  });
  it('retains a blank replacement key, explicitly removes it, and does not fall back to environment credentials', async () => {
    const service = instance.services.settings.connections;
    service.update(wid, input());
    const oldRevision = service.revision(wid, 'image.generate');
    service.update(wid, input({ secret: undefined, model: 'another-model' }));
    expect(service.runtime(wid, 'text')?.secret).toBe(input().secret);
    expect(service.revision(wid, 'image.generate')).not.toBe(oldRevision);
    const removed = service.update(wid, input({ secret: undefined, removeSecret: true }));
    expect(removed).toMatchObject({ configured: false, keyHint: null });
    expect(service.runtime(wid, 'text')).toBeUndefined();
  });
  it.each([
    'http://fixture.example/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.1.2.3/v1',
    'https://service.local/v1',
    'https://key@fixture.example/v1',
    'https://fixture.example/v1?key=secret',
    'https://fixture.example:444/v1',
  ])('rejects unsafe service URL %s without saving a credential', async (baseUrl) => {
    const response = await request('PUT', '/model-connections', input({ baseUrl }));
    expect(response.statusCode).toBe(400);
    expect(instance.services.settings.connections.get(wid, 'text').configured).toBe(false);
  });
  it('requires explicit credentials after changing hosts and forbids cross-host catalog endpoints', () => {
    const service = instance.services.settings.connections;
    service.update(wid, input());
    expect(() =>
      service.update(wid, input({ baseUrl: 'https://other.example/v1', secret: undefined })),
    ).toThrow('重新填写密钥');
    expect(() =>
      service.update(wid, input({ modelsUrl: 'https://other.example/v1/models' })),
    ).toThrow('同源');
    expect(service.runtime(wid, 'text')?.baseUrl).toBe('https://fixture.example/v1');
  });
  it('normalizes the documented relay root for text and image while preserving explicit API paths', () => {
    const service = instance.services.settings.connections;
    expect(service.update(wid, input({ baseUrl: 'https://xingyunyinli.com/' })).baseUrl).toBe(
      'https://xingyunyinli.com/v1',
    );
    expect(
      service.update(wid, input({ baseUrl: 'https://xingyunyinli.com/proxy/v2' })).baseUrl,
    ).toBe('https://xingyunyinli.com/proxy/v2');
  });
  it('requires manager access and isolates workspace resources', async () => {
    expect(
      (await instance.app.inject({ method: 'GET', url: '/api/v1/model-connections' })).statusCode,
    ).toBe(401);
    expect((await request('PUT', '/model-connections', input(), randomUUID())).statusCode).toBe(
      403,
    );
    expect((await request('GET', '/model-connections', undefined, randomUUID())).statusCode).toBe(
      403,
    );
    expect(
      (await request('POST', '/model-connections/text/models', undefined, randomUUID())).statusCode,
    ).toBe(403);
  });
  it('validates the protocol and the complete video task route', async () => {
    expect(
      (await request('PUT', '/model-connections', input({ protocol: 'openai-images' }))).statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          'PUT',
          '/model-connections',
          input({ kind: 'video', protocol: 'seedance-native' }),
        )
      ).statusCode,
    ).toBe(400);
    const valid = await request(
      'PUT',
      '/model-connections',
      input({
        kind: 'video',
        protocol: 'seedance-native',
        baseUrl: 'https://fixture.example/doubao/api/v3/contents/generations/tasks',
      }),
    );
    expect(valid.statusCode, valid.body).toBe(200);
    expect(
      (await request('POST', '/model-connections/video/models')).json().data.discoveryStatus,
    ).toBe('unavailable');
  });
});

describe('read-only model discovery', () => {
  it('stores discovered IDs without inferring media kinds and leaves the selected model untouched', async () => {
    const discover = vi.fn<(url: URL, secret: string) => Promise<string[]>>(async () => [
      'text-model',
      'image-model',
      'video-model',
    ]);
    const service = createModelConnectionsService(instance.services.db, config, discover);
    service.update(wid, input({ enabled: false, model: '' }));
    const result = await service.refreshModels(wid, 'text');
    expect(discover).toHaveBeenCalledTimes(1);
    expect(String(discover.mock.calls[0]?.[0])).toBe('https://fixture.example/v1/models');
    expect(result).toMatchObject({
      model: '',
      enabled: false,
      models: ['text-model', 'image-model', 'video-model'],
      discoveryStatus: 'connected',
    });
    expect(result.discoveryMessage).toContain('不证明');
    expect(JSON.stringify(result)).not.toContain('private-test-key');
  });
  it('redacts upstream failures and keeps saved configuration usable for manual model IDs', async () => {
    const service = createModelConnectionsService(instance.services.db, config, async () => {
      throw new Error('private-test-key-8375 upstream secret');
    });
    service.update(wid, input());
    const result = await service.refreshModels(wid, 'text');
    expect(result.discoveryStatus).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('private-test-key');
    expect(service.runtime(wid, 'text')?.model).toBe('test-model');
  });
  it('does not overwrite a newer configuration when an older model-list request finishes', async () => {
    let finish!: (models: string[]) => void;
    const service = createModelConnectionsService(
      instance.services.db,
      config,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    service.update(wid, input());
    const pending = service.refreshModels(wid, 'text');
    service.update(wid, input({ model: 'new-model' }));
    finish(['stale-model']);
    await expect(pending).rejects.toThrow('已被修改');
    expect(service.get(wid, 'text')).toMatchObject({
      model: 'new-model',
      models: [],
      discoveryStatus: 'never',
    });
  });
});

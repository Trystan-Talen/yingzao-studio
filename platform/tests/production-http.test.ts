import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import sharp from 'sharp';

let folder: string;
let application: Awaited<ReturnType<typeof createApp>> | undefined;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-production-http-'));
});
afterEach(async () => {
  await application?.app.close();
  await rm(folder, { recursive: true, force: true });
});
async function app(production = true, origin = 'https://studio.example.test', webRoot?: string) {
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: origin,
    databasePath: join(folder, 'http.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'isolated-production-session',
    encryptionKey: 'isolated-production-encryption',
    isProduction: production,
    demoMode: false,
    environmentSecrets: {},
  };
  application = await createApp(config, { serveWeb: !!webRoot, webRoot });
  application.app.get('/test-page', (_request, reply) =>
    reply.type('text/html').send('<!doctype html><title>Fixture</title>'),
  );
  return application.app;
}
describe('production browser boundary', () => {
  it('restricts executable content and transport while preserving app media and inline layout', async () => {
    const server = await app();
    const response = await server.inject('/test-page');
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000');
    const policy = response.headers['content-security-policy'];
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("img-src 'self' data: blob: https:");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(response.headers['cache-control']).toBe('no-cache');
    const health = await server.inject('/api/v1/health');
    expect(health.headers['cache-control']).toBe('no-store');
  });
  it('does not persist HTTPS-only transport policy on a local HTTP verification', async () => {
    const server = await app(true, 'http://127.0.0.1:4310');
    expect(
      (await server.inject('/test-page')).headers['strict-transport-security'],
    ).toBeUndefined();
  });
  it('keeps the development server compatible with hot module updates', async () => {
    const server = await app(false);
    expect((await server.inject('/test-page')).headers['content-security-policy']).toBeUndefined();
  });
  it('serves public files and client routes while protecting API docs and original media', async () => {
    const webRoot = join(folder, 'web');
    await mkdir(join(webRoot, 'assets'), { recursive: true });
    await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>Isolated studio</title>');
    await writeFile(join(webRoot, 'assets', 'app.css'), 'body{color:#fff}');
    await writeFile(join(webRoot, '.env'), 'ISOLATED_HIDDEN_FILE=not-public');
    const server = await app(true, 'https://localhost', webRoot);
    expect((await server.inject('/assets/app.css')).body).toBe('body{color:#fff}');
    expect((await server.inject('/create/project')).body).toContain('Isolated studio');
    expect((await server.inject('/.env')).body).not.toContain('ISOLATED_HIDDEN_FILE');
    expect((await server.inject('/api/unknown')).statusCode).toBe(404);
    const docs = ['/api/docs/', '/api/docs/json', '/api/docs/yaml', '/api/v1/openapi.json'];
    for (const url of docs) expect((await server.inject(url)).statusCode, url).toBe(401);
    // The documentation UI's public CSS contains no application schema or private data.
    expect((await server.inject('/api/docs/static/swagger-ui.css')).statusCode).toBe(200);
    const registered = await application!.services.core.auth.register({
      email: 'static-owner@example.local',
      password: 'StaticFixture2026!',
      displayName: 'Static owner',
    });
    const headers = { cookie: `studio_session=${registered.sessionToken}` };
    for (const url of docs) expect((await server.inject({ url, headers })).statusCode).toBe(200);
    expect((await server.inject({ url: '/api/v1/openapi.json', headers })).json()).toHaveProperty(
      'openapi',
    );
    const bytes = await sharp({
      create: { width: 12, height: 12, channels: 3, background: '#bc8745' },
    })
      .png()
      .toBuffer();
    const asset = await application!.services.core.assets.ingest(
      {
        userId: registered.user.id,
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      },
      registered.workspace.id,
      { buffer: bytes, name: 'private.png', mimeType: 'image/png' },
    );
    const url = `/api/v1/assets/${asset.id}/content`;
    expect((await server.inject(url)).statusCode).toBe(401);
    const media = await server.inject({ url, headers });
    expect(media.statusCode).toBe(200);
    expect(media.rawPayload).toEqual(bytes);
    expect(media.headers['cache-control']).toContain('no-store');
  });
});

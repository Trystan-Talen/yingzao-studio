import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';

let folder: string;
let application: Awaited<ReturnType<typeof createApp>> | undefined;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-production-http-'));
});
afterEach(async () => {
  await application?.app.close();
  await rm(folder, { recursive: true, force: true });
});
async function app(production = true, origin = 'https://studio.example.test') {
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
  application = await createApp(config, { serveWeb: false });
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
});

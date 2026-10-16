import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { readSupportConfig } from '../src/server/support-config';

let folder: string;
let config: AppConfig;
let application: Awaited<ReturnType<typeof createApp>>;
let headers: Record<string, string>;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-support-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:4310',
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'isolated-support-session-secret',
    encryptionKey: 'isolated-support-encryption-key',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
  };
  application = await createApp(config, { serveWeb: false });
  const response = await application.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'support@example.test',
      password: 'SupportBrowserPassword2026!',
      displayName: 'Support fixture',
    },
  });
  expect(response.statusCode).toBe(201);
  headers = {
    cookie: String(response.headers['set-cookie']).split(';')[0]!,
    'x-workspace-id': response.json().data.workspace.id,
  };
});
afterEach(async () => {
  await application.app.close();
  await rm(folder, { recursive: true, force: true });
});
it('reports unconfigured deployment contacts without inventing support channels', async () => {
  const response = await application.app.inject({ url: '/api/v1/support/channels', headers });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toEqual({
    phone: null,
    hours: null,
    wechatQrUrl: null,
    feedbackUrl: null,
    guideUrl: null,
  });
  const anonymous = await application.app.inject({ url: '/api/v1/support/channels' });
  expect(anonymous.statusCode).toBe(401);
});
it('returns only explicitly configured public contact fields and rejects unsafe links', async () => {
  config.support = readSupportConfig({
    SUPPORT_PHONE: '+1 (202) 555-0100',
    SUPPORT_HOURS: 'Weekdays 09:00–18:00 UTC',
    SUPPORT_WECHAT_QR_URL: 'https://support.example.test/wechat.png',
    SUPPORT_FEEDBACK_URL: 'https://survey.example.test/feedback',
    SUPPORT_GUIDE_URL: 'https://docs.example.test/guide',
    SESSION_SECRET: 'must-not-be-returned',
  });
  const response = await application.app.inject({ url: '/api/v1/support/channels', headers });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toEqual(config.support);
  expect(response.body).not.toContain('must-not-be-returned');
  for (const link of [
    'javascript:alert(1)',
    'data:image/svg+xml,hi',
    'http://support.example.test/',
    'https://user:password@support.example.test/',
  ]) {
    expect(() => readSupportConfig({ SUPPORT_FEEDBACK_URL: link })).toThrow();
    expect(() => readSupportConfig({ SUPPORT_WECHAT_QR_URL: link })).toThrow();
  }
  expect(readSupportConfig({ SUPPORT_PHONE: ' ', SUPPORT_FEEDBACK_URL: '' }).phone).toBeNull();
  expect(() => readSupportConfig({ SUPPORT_PHONE: '+1;send-message' })).toThrow();
  expect(
    application.services.db.sqlite.prepare('SELECT count(*) n FROM support_tickets').get(),
  ).toEqual({ n: 0 });
});

import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';
let folder: string,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie: string,
  actor: Actor,
  wid: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'notification-http-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(folder, 'fixture.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'fixture',
      encryptionKey: 'fixture',
      isProduction: false,
      demoMode: false,
      environmentSecrets: {},
    } as AppConfig,
    { serveWeb: false },
  );
  const registered = await app.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      displayName: 'Notification HTTP fixture',
      email: 'notification-http@example.test',
      password: 'NotificationHttp2026!',
    },
  });
  expect(registered.statusCode).toBe(201);
  cookie = String(registered.headers['set-cookie']).split(';')[0]!;
  const data = registered.json().data;
  wid = data.workspace.id;
  actor = {
    userId: data.user.id,
    authType: 'session',
    workspaceId: null,
    apiKeyId: null,
    scopes: [],
  };
});
afterEach(async () => {
  await app.app.close();
  await rm(folder, { recursive: true, force: true });
});
const headers = () => ({ cookie, origin: 'http://127.0.0.1:5174', 'x-workspace-id': wid });
it('publishes category and actual unread contracts, rejects invalid categories and enforces session-only access', async () => {
  const id = randomUUID(),
    other = app.services.core.auth.createWorkspace(actor.userId, 'Other fixture', 'team', false);
  const insert = app.services.db.sqlite.prepare(
    'INSERT INTO notifications VALUES(?,?,?,?,?,?,NULL,?)',
  );
  insert.run(
    id,
    wid,
    actor.userId,
    '系统通知',
    '标题可含审核但不会猜测分类',
    'unknown-history',
    new Date().toISOString(),
  );
  insert.run(
    randomUUID(),
    other.id,
    actor.userId,
    '其他空间',
    '不得计入当前',
    null,
    new Date().toISOString(),
  );
  const list = await app.app.inject({
    url: '/api/v1/notifications?category=system&pageSize=24',
    headers: headers(),
  });
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().data).toMatchObject({
    total: 1,
    unread: { system: 1, review: 0, total: 1 },
    items: [{ id, category: 'system' }],
  });
  const count = () => app.app.inject({ url: '/api/v1/notifications/unread', headers: headers() });
  expect((await count()).json().data).toEqual({ system: 1, review: 0, total: 1 });
  const read = await app.app.inject({
    method: 'POST',
    url: `/api/v1/notifications/${id}/read`,
    headers: headers(),
    payload: {},
  });
  expect(read.statusCode, read.body).toBe(200);
  expect((await count()).json().data).toEqual({ system: 0, review: 0, total: 0 });
  expect(
    (await app.app.inject({ url: '/api/v1/notifications?category=fabricated', headers: headers() }))
      .statusCode,
  ).toBe(400);
  expect((await app.app.inject({ url: '/api/v1/notifications/unread' })).statusCode).toBe(401);
  const key = app.services.core.business.createKey(actor, wid, {
    name: 'Read fixture',
    scopes: ['projects:read'],
  });
  expect(
    (
      await app.app.inject({
        url: '/api/v1/notifications/unread',
        headers: { authorization: `Bearer ${key.secret}`, 'x-workspace-id': wid },
      })
    ).statusCode,
  ).toBe(403);
});

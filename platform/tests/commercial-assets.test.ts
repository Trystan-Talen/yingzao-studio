import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Actor } from '../src/contracts/core';
import { createCoreServices, type CoreServices } from '../src/server/core';
import {
  closeDatabase,
  createDatabaseContext,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';

let directory: string, db: DatabaseContext, core: CoreServices, actor: Actor, wid: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yingzao-asset-recovery-'));
  db = createDatabaseContext(join(directory, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  core = createCoreServices(db, {
    storageDir: join(directory, 'media'),
    sessionSecret: 'local-asset-fixture',
    publicOrigin: 'http://127.0.0.1:5173',
    isProduction: false,
    demoMode: false,
  });
  const registered = await core.auth.register({
    email: 'owner@example.local',
    password: 'LocalFixture2026!',
    displayName: 'Owner',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
});
afterEach(async () => {
  closeDatabase(db);
  await rm(directory, { recursive: true, force: true });
});

it('recovers a lost delete response without changing the deletion time or duplicating the audit', async () => {
  const asset = await core.assets.ingest(actor, wid, {
    buffer: Buffer.from('Fixture'),
    name: 'fixture.txt',
    mimeType: 'text/plain',
  });
  const deleted = core.assets.remove(actor, wid, asset.id);
  expect(core.assets.remove(actor, wid, asset.id)).toEqual(deleted);
  expect(
    db.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE resource_id=? AND action='asset.delete'",
      )
      .get(asset.id),
  ).toEqual({ count: 1 });
  expect(core.assets.list(actor, wid, {}).total).toBe(0);
  expect(core.assets.restore(actor, wid, asset.id).deletedAt).toBeNull();
  expect((await core.assets.readOriginal(actor, wid, asset.id)).buffer.toString()).toBe('Fixture');
});

it('still enforces workspace and write access for retries of deleted assets', async () => {
  const asset = await core.assets.ingest(actor, wid, {
    buffer: Buffer.from('Fixture'),
    name: 'fixture.txt',
    mimeType: 'text/plain',
  });
  core.assets.remove(actor, wid, asset.id);
  const other = core.auth.createWorkspace(actor.userId, 'Other', 'personal');
  expect(() => core.assets.remove(actor, other.id, asset.id)).toThrow('内容不存在');
  db.sqlite
    .prepare("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?")
    .run(wid, actor.userId);
  expect(() => core.assets.remove(actor, wid, asset.id)).toThrow('当前角色无权');
});

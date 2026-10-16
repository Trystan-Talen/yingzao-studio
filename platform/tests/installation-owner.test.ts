import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, copyFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDatabaseContext, type DatabaseContext } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createBillingAdmin } from '../src/server/billing/admin';
import { createCoreServices } from '../src/server/core';
import { isInstallationOwner } from '../src/server/core/installation-owner';

const first = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const member = '00000000-0000-4000-8000-000000000001';
const resources: { db: DatabaseContext; folder: string }[] = [];
afterEach(async () => {
  for (const { db, folder } of resources.splice(0)) {
    db.sqlite.close();
    await rm(folder, { recursive: true, force: true });
  }
});
async function database(legacy = false) {
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-installation-owner-'));
  const db = createDatabaseContext(join(folder, 'test.sqlite'));
  resources.push({ db, folder });
  let migrationsDir = resolve('migrations');
  if (legacy) {
    migrationsDir = join(folder, 'legacy');
    await mkdir(migrationsDir);
    for (const name of await readdir(resolve('migrations')))
      if (/^\d+.*\.sql$/.test(name) && Number(name.slice(0, 4)) < 27)
        await copyFile(resolve('migrations', name), join(migrationsDir, name));
  }
  migrateDatabase(db, { migrationsDir });
  return db;
}
function insert(db: DatabaseContext, uid: string, time = '2026-10-16T08:00:00.000Z') {
  db.sqlite
    .prepare(
      'INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(uid, `${uid}@example.test`, 'test-hash', '角色回归夹具', time, time);
}
function importPlan(db: DatabaseContext, uid: string) {
  return createBillingAdmin(db).importPlans({
    actorUserId: uid,
    reason: '安装管理员不可由时间戳或随机编号排序变化转移的回归测试',
    version: 1,
    confirmCommercialCatalog: true,
    plans: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: '测试额度包',
        kind: 'credits',
        priceMinor: 100,
        currency: 'USD',
        credits: 10,
        interval: null,
      },
    ],
  });
}

it('keeps the first installed user as operator when another user has the same timestamp and a lower UUID', async () => {
  const db = await database();
  insert(db, first);
  insert(db, member);
  expect(() => importPlan(db, member)).toThrow('管理员');
  expect(importPlan(db, first).imported).toBe(1);
});

it('does not transfer installation authority after clock or profile changes, nor allow deleting its owner', async () => {
  const db = await database();
  insert(db, first);
  insert(db, member, '2000-01-01T00:00:00.000Z');
  db.sqlite
    .prepare('UPDATE users SET created_at=? WHERE id=?')
    .run('2100-01-01T00:00:00.000Z', first);
  expect(() => importPlan(db, member)).toThrow('管理员');
  expect(importPlan(db, first).imported).toBe(1);
  expect(() => db.sqlite.prepare('DELETE FROM installation_owner').run()).toThrow();
  expect(() => db.sqlite.prepare('UPDATE installation_owner SET user_id=?').run(member)).toThrow();
  expect(() => db.sqlite.prepare('DELETE FROM users WHERE id=?').run(first)).toThrow();
});

it('upgrades an existing installation from the first stored user without rewriting users or historical audit', async () => {
  const db = await database(true);
  insert(db, first);
  insert(db, member, '2000-01-01T00:00:00.000Z');
  const before = db.sqlite.prepare('SELECT * FROM users ORDER BY rowid').all();
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  expect(db.sqlite.prepare('SELECT * FROM users ORDER BY rowid').all()).toEqual(before);
  expect(db.sqlite.prepare('SELECT user_id,source FROM installation_owner').get()).toEqual({
    user_id: first,
    source: 'legacy-first-row',
  });
  expect(() => importPlan(db, member)).toThrow('管理员');
  expect(importPlan(db, first).imported).toBe(1);
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
  expect(db.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
});

it('rolls back setup authority with a failed real registration and preserves it across invited registration', async () => {
  const db = await database();
  let rejectWorkspace = true;
  const core = createCoreServices(
    db,
    {
      storageDir: '/tmp/unused-installation-fixture',
      sessionSecret: 'installation-contract-fixture',
      publicOrigin: 'http://127.0.0.1:5174',
      demoMode: false,
    } as never,
    {
      onWorkspaceCreated: () => {
        if (rejectWorkspace) throw new Error('fixture setup rollback');
      },
    },
  );
  const profile = {
    email: 'owner@example.local',
    password: 'InstallationFixture2026!',
    displayName: 'Owner fixture',
  };
  await expect(core.auth.register(profile)).rejects.toThrow('fixture setup rollback');
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 0 });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM installation_owner').get()).toEqual({ n: 0 });
  expect(core.auth.status().setupRequired).toBe(true);
  rejectWorkspace = false;
  const owner = await core.auth.register(profile);
  expect(isInstallationOwner(db, owner.user.id)).toBe(true);
  const actor = {
    userId: owner.user.id,
    authType: 'session' as const,
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const team = core.auth.createWorkspace(actor.userId, 'Invited registration fixture', 'team');
  const invite = core.team.invite(actor, team.id, {
    email: 'member@example.local',
    role: 'member',
  });
  const member = await core.auth.register({
    ...profile,
    email: 'member@example.local',
    inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
  });
  expect(isInstallationOwner(db, member.user.id)).toBe(false);
  expect(isInstallationOwner(db, owner.user.id)).toBe(true);
});

it('enforces the same immutable authority for the actual mail status CLI', async () => {
  const db = await database();
  insert(db, first);
  insert(db, member);
  const folder = resources.at(-1)!.folder;
  const input = join(folder, 'operator.json');
  const run = () =>
    promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', resolve('scripts/mail-outbox-admin.ts'), 'status', input],
      {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          DOTENV_CONFIG_PATH: '/dev/null',
          DATABASE_PATH: join(folder, 'test.sqlite'),
          STORAGE_DIR: join(folder, 'media'),
          SMTP_ENABLED: 'false',
          SESSION_SECRET: 'test-only',
          ENCRYPTION_KEY: 'test-only',
        },
      },
    );
  await writeFile(input, JSON.stringify({ operatorId: member, workspaceId: member }));
  await expect(run()).rejects.toMatchObject({ code: 1 });
  await writeFile(input, JSON.stringify({ operatorId: first, workspaceId: member }));
  const result = await run();
  expect(JSON.parse(result.stdout)).toEqual({ enabled: false, items: [] });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../src/contracts/core';
import type { AppConfig } from '../src/server/config';
import { createApp } from '../src/server/app';
import {
  createPasswordRecoveryService,
  type PasswordRecoveryService,
} from '../src/server/auth/password/service';
import { hashPassword } from '../src/server/core/auth';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createMailOutbox, createMailWorker } from '../src/server/notifications';
import { hash } from '../src/server/core/shared';
import { localSmtp, mailText } from './helpers/local-smtp';

let folder: string;
let instance: Awaited<ReturnType<typeof createApp>> | undefined;
let config: AppConfig;
let service: PasswordRecoveryService;
let actor: Actor;
let sessionToken: string;
let time: number;
const origin = 'http://127.0.0.1:5174';
const oldPassword = 'OriginalPassword2026!';
const newPassword = 'ReplacedPassword2026!';
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-password-'));
  time = Date.now();
  instance = undefined;
});
afterEach(async () => {
  await instance?.app.close();
  await rm(folder, { recursive: true, force: true });
});
async function open(enabled = true, port = 9) {
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: origin,
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'isolated-session',
    encryptionKey: 'isolated-encryption',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
    passwordRecoveryEnabled: enabled,
    smtp: enabled
      ? {
          enabled: true,
          host: '127.0.0.1',
          port,
          tlsMode: 'local-test',
          from: 'studio@example.test',
          fromName: 'Test only',
        }
      : { enabled: false },
  };
  instance = await createApp(config, { serveWeb: false });
  const account = await instance.services.core.auth.register({
    email: 'owner@example.test',
    password: oldPassword,
    displayName: 'Owner',
  });
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  sessionToken = account.sessionToken;
  service = createPasswordRecoveryService(instance.services.db, config, {
    now: () => new Date(time),
    responseDelayMs: 0,
  });
}
const app = () => instance!.app;
const core = () => instance!.services.core;
const db = () => instance!.services.db;
const sql = () => db().sqlite;
const current = () => ({ actor, sessionToken });
const body = (token: string) => ({ token, newPassword, confirmPassword: newPassword });
const requestCount = () =>
  (sql().prepare('SELECT count(*) AS n FROM password_requests').get() as { n: number }).n;
function deliveredToken() {
  const claimed = service.mail.claim('fixture');
  expect(claimed).toBeDefined();
  const secret = claimed!.message.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
  expect(secret).toBeTruthy();
  service.mail.finish(claimed!, { status: 'accepted' });
  return secret!;
}
function googleOnly() {
  sql().prepare('UPDATE users SET local_password_enabled=0 WHERE id=?').run(actor.userId);
  sql()
    .prepare(
      "INSERT INTO external_identities VALUES(?,'google','https://accounts.google.com',?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      'isolated-subject',
      actor.userId,
      'owner@example.test',
      new Date(time).toISOString(),
      new Date(time).toISOString(),
    );
}

describe('password recovery without external accounts or messages', () => {
  it('is explicitly disabled and creates neither challenges nor mail by default', async () => {
    await open(false);
    const response = await app().inject('/api/v1/auth/password/status');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ enabled: false, disabledReason: 'disabled' });
    const submitted = await app().inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      headers: { origin },
      payload: { email: 'owner@example.test' },
    });
    expect(submitted.statusCode).toBe(503);
    expect(requestCount()).toBe(0);
    expect(sql().prepare('SELECT count(*) n FROM account_mail_outbox').get()).toEqual({ n: 0 });
    expect(() =>
      createPasswordRecoveryService(db(), { ...config, passwordRecoveryEnabled: true }),
    ).toThrow('SMTP');
  });
  it('uses one generic response for known, unknown, Google-only and throttled accounts', async () => {
    await open();
    const known = await service.requestReset({ email: 'OWNER@example.test' }, 'ip-1');
    const unknown = await service.requestReset({ email: 'missing@example.test' }, 'ip-1');
    const throttled = await service.requestReset({ email: 'owner@example.test' }, 'ip-1');
    googleOnly();
    time += 61_000;
    const external = await service.requestReset({ email: 'owner@example.test' }, 'ip-1');
    expect([known, unknown, throttled, external]).toEqual(Array(4).fill({ accepted: true }));
    expect(requestCount()).toBe(1);
    expect(
      JSON.stringify(sql().prepare('SELECT * FROM password_request_limits').all()),
    ).not.toContain('@example.test');
  });
  it('persists request limits across services and preserves older links until successful consumption', async () => {
    await open();
    await service.requestReset({ email: 'owner@example.test' }, 'ip-2');
    service = createPasswordRecoveryService(db(), config, {
      now: () => new Date(time),
      responseDelayMs: 0,
    });
    await service.requestReset({ email: 'owner@example.test' }, 'ip-2');
    for (let n = 0; n < 3; n++) {
      time += 61_000;
      await service.requestReset({ email: 'owner@example.test' }, 'ip-2');
    }
    expect(requestCount()).toBe(3);
    expect(
      sql().prepare('SELECT count(*) n FROM password_requests WHERE revoked_at IS NOT NULL').get(),
    ).toEqual({ n: 0 });
    for (let n = 0; n < 10; n++)
      await service.requestReset({ email: `missing${n}@example.test` }, 'new-ip');
    await expect(
      service.requestReset({ email: 'any@example.test' }, 'new-ip'),
    ).rejects.toMatchObject({ statusCode: 429 });
  });
  it('keeps the old password valid until completion, then revokes every session and rejects replay', async () => {
    await open();
    await service.requestReset({ email: 'owner@example.test' }, 'ip-3');
    const token = deliveredToken();
    expect(JSON.stringify(sql().prepare('SELECT * FROM password_requests').all())).not.toContain(
      token,
    );
    await core().auth.login({ email: 'owner@example.test', password: oldPassword });
    expect(await service.complete(body(token))).toEqual({ changed: true });
    expect(sql().prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get()).toEqual(
      { n: 0 },
    );
    await expect(
      core().auth.login({ email: 'owner@example.test', password: oldPassword }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(
      core().auth.login({ email: 'owner@example.test', password: newPassword }),
    ).resolves.toHaveProperty('sessionToken');
    await expect(service.complete(body(token))).rejects.toMatchObject({
      code: 'PASSWORD_LINK_INVALID',
    });
    expect(
      sql()
        .prepare("SELECT count(*) n FROM account_mail_outbox WHERE kind='password-changed'")
        .get(),
    ).toEqual({ n: 1 });
  });
  it('retains unique Google login protection and requires the exact setup session before adding a password', async () => {
    await open();
    googleOnly();
    await expect(
      instance!.services.google.unlink(current(), { password: oldPassword }),
    ).rejects.toMatchObject({ code: 'GOOGLE_LOCAL_PASSWORD_REQUIRED' });
    await expect(
      core().auth.login({ email: 'owner@example.test', password: oldPassword }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await service.requestSetup(current(), 'ip-4');
    const token = deliveredToken();
    const other = { actor, sessionToken: core().auth.session(actor.userId) };
    await expect(service.complete(body(token), other)).rejects.toMatchObject({
      code: 'PASSWORD_LINK_INVALID',
    });
    await expect(service.complete(body(token))).rejects.toMatchObject({
      code: 'PASSWORD_SESSION_REQUIRED',
    });
    expect(await service.complete(body(token), current())).toEqual({ changed: true });
    expect(service.status(actor)).toMatchObject({
      hasLocalPassword: true,
      canSetLocalPassword: false,
    });
    expect(sql().prepare('SELECT count(*) n FROM external_identities').get()).toEqual({ n: 1 });
    const login = await core().auth.login({ email: 'owner@example.test', password: newPassword });
    await instance!.services.google.unlink(
      { actor, sessionToken: login.sessionToken },
      { password: newPassword },
    );
    expect(sql().prepare('SELECT count(*) n FROM external_identities').get()).toEqual({ n: 0 });
  });
  it('invalidates expired links without consuming valid requests on form mistakes', async () => {
    await open();
    await service.requestReset({ email: 'owner@example.test' }, 'ip-5');
    const token = deliveredToken();
    await expect(
      service.complete({ ...body(token), confirmPassword: 'DifferentPassword2026!' }),
    ).rejects.toBeDefined();
    await expect(service.complete({ ...body(token), userId: actor.userId })).rejects.toBeDefined();
    expect(sql().prepare('SELECT consumed_at FROM password_requests').get()).toEqual({
      consumed_at: null,
    });
    time += 1800_001;
    await expect(service.complete(body(token))).rejects.toMatchObject({
      code: 'PASSWORD_LINK_INVALID',
    });
  });
  it('allows exactly one completion across separate SQLite connections', async () => {
    await open();
    await service.requestReset({ email: 'owner@example.test' }, 'ip-6');
    const token = deliveredToken();
    const second = createDatabaseContext(config.databasePath);
    try {
      const other = createPasswordRecoveryService(second, config, { now: () => new Date(time) });
      const outcomes = await Promise.allSettled([
        service.complete(body(token)),
        other.complete(body(token)),
      ]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        sql().prepare('SELECT password_revision FROM users WHERE id=?').get(actor.userId),
      ).toEqual({ password_revision: 1 });
    } finally {
      closeDatabase(second);
    }
  });
  it('does not consume a request when derivation or the completion transaction fails', async () => {
    await open();
    await service.requestReset({ email: 'owner@example.test' }, 'ip-7');
    const token = deliveredToken();
    const bad = createPasswordRecoveryService(db(), config, {
      derivePassword: async () => {
        throw new Error('isolated derivation failure');
      },
    });
    await expect(bad.complete(body(token))).rejects.toThrow('derivation');
    sql().exec(
      "CREATE TRIGGER fail_password_notice BEFORE INSERT ON account_mail_outbox WHEN NEW.kind='password-changed' BEGIN SELECT RAISE(ABORT,'isolated transaction failure'); END",
    );
    await expect(service.complete(body(token))).rejects.toThrow('transaction');
    expect(sql().prepare('SELECT consumed_at FROM password_requests').get()).toEqual({
      consumed_at: null,
    });
    expect(
      sql().prepare('SELECT password_revision FROM users WHERE id=?').get(actor.userId),
    ).toEqual({ password_revision: 0 });
    await core().auth.login({ email: 'owner@example.test', password: oldPassword });
  });
  it('prevents an old asynchronous password comparison from creating a session after recovery', async () => {
    await open();
    await service.requestReset({ email: 'owner@example.test' }, 'ip-8');
    const token = deliveredToken();
    const replacement = await hashPassword(newPassword);
    const fast = createPasswordRecoveryService(db(), config, {
      derivePassword: async () => replacement,
    });
    const login = expect(
      core().auth.login({ email: 'owner@example.test', password: oldPassword }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await fast.complete(body(token));
    await login;
    expect(sql().prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get()).toEqual(
      { n: 0 },
    );
  });
  it('cancels pending setup after logout and clears expired payloads without sending', async () => {
    await open();
    googleOnly();
    await service.requestSetup(current(), 'ip-9');
    core().auth.logout(sessionToken);
    expect(service.mail.claim('after-logout')).toBeUndefined();
    expect(
      sql().prepare('SELECT status,payload_ciphertext FROM account_mail_outbox').get(),
    ).toEqual({ status: 'cancelled', payload_ciphertext: null });
  });
  it('handles retry, ambiguous leases and disabled recovery without resending old messages', async () => {
    await open();
    await service.requestReset({ email: 'owner@example.test' }, 'ip-10');
    const item = service.mail.claim('first')!;
    service.mail.finish(item, {
      status: 'retry',
      errorCode: 'SMTP_TEMPORARY_REJECTION',
      smtpResponseCode: 451,
    });
    expect(service.mail.claim('too-soon')).toBeUndefined();
    time += 75_000;
    const next = service.mail.claim('second')!;
    expect(next.messageId).toBe(item.messageId);
    time += 120_001;
    service.mail.recover();
    expect(sql().prepare('SELECT status FROM account_mail_outbox').get()).toEqual({
      status: 'reconciliation_required',
    });
    expect(service.mail.claim('ambiguous')).toBeUndefined();
    const disabled = createPasswordRecoveryService(db(), {
      ...config,
      passwordRecoveryEnabled: false,
    });
    expect(disabled.mail.claim('disabled')).toBeUndefined();
    time += 1800_000;
    service.mail.cleanup();
    expect(sql().prepare('SELECT payload_ciphertext FROM account_mail_outbox').get()).toEqual({
      payload_ciphertext: null,
    });
  });
  it('enforces same-origin HTTP writes, no personal details for API credentials and cookie cleanup', async () => {
    await open();
    const rejected = await app().inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      headers: { origin: 'https://foreign.example' },
      payload: { email: 'owner@example.test' },
    });
    expect(rejected.statusCode).toBe(403);
    const wid = core().auth.listWorkspaces(actor)[0]!.id;
    const key = core().business.createKey(actor, wid, {
      name: 'isolated',
      scopes: ['assets:read'],
    });
    const apiStatus = await app().inject({
      url: '/api/v1/auth/password/status',
      headers: { authorization: `Bearer ${key.secret}` },
    });
    expect(apiStatus.json().data).toEqual({ enabled: true, disabledReason: null });
    const deniedSetup = await app().inject({
      method: 'POST',
      url: '/api/v1/auth/password/setup-request',
      headers: { origin, authorization: `Bearer ${key.secret}` },
      payload: {},
    });
    expect(deniedSetup.statusCode).toBe(401);
    await service.requestReset({ email: 'owner@example.test' }, 'ip-11');
    const token = deliveredToken();
    const completed = await app().inject({
      method: 'POST',
      url: '/api/v1/auth/password/complete',
      headers: { origin, cookie: `studio_session=${sessionToken}` },
      payload: body(token),
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.headers['set-cookie']).toContain('studio_session=;');
    expect(completed.body).not.toContain(token);
  });
  it('uses shared SMTP with one envelope and clears accepted payload from storage', async () => {
    const smtp = await localSmtp();
    try {
      await open(true, smtp.port);
      await service.requestReset({ email: 'owner@example.test' }, 'ip-12');
      expect(
        JSON.stringify(sql().prepare('SELECT * FROM account_mail_outbox').all()),
      ).not.toContain('owner@example.test');
      const worker = createMailWorker(service.mail);
      await Promise.all([worker.tick(), worker.tick()]);
      await worker.stop();
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.recipients).toEqual(['RCPT TO:<owner@example.test>']);
      const token = mailText(smtp.messages[0]!).match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
      expect(token).toBeTruthy();
      expect(sql().prepare('SELECT token_hash FROM password_requests').get()).toEqual({
        token_hash: hash(token!),
      });
      expect(
        sql().prepare('SELECT status,payload_ciphertext FROM account_mail_outbox').get(),
      ).toEqual({ status: 'accepted', payload_ciphertext: null });
    } finally {
      await smtp.close();
    }
  });
  it('erases expired queued secrets when recovery is disabled without sending them', async () => {
    await open();
    await service.requestReset({ email: 'owner@example.test' }, 'disabled-cleanup');
    expect(sql().prepare('SELECT status FROM account_mail_outbox').get()).toEqual({
      status: 'queued',
    });
    time += 1801_000;
    const disabled = createPasswordRecoveryService(
      db(),
      { ...config, passwordRecoveryEnabled: false },
      { now: () => new Date(time) },
    );
    const worker = createMailWorker(disabled.mail);
    await worker.tick();
    await worker.stop();
    expect(
      sql().prepare('SELECT status,payload_ciphertext,attempts FROM account_mail_outbox').get(),
    ).toEqual({ status: 'cancelled', payload_ciphertext: null, attempts: 0 });
  });
  it.each([
    { options: { recipientCode: 451 }, state: 'retry' },
    { options: { dropAfterData: true }, state: 'reconciliation_required' },
  ])(
    'persists actual account mail transport outcome $state without blind replay',
    async ({ options, state }) => {
      const smtp = await localSmtp(options);
      try {
        await open(true, smtp.port);
        await service.requestReset({ email: 'owner@example.test' }, 'transport-ip');
        const worker = createMailWorker(service.mail);
        await worker.tick();
        await worker.tick();
        await worker.stop();
        expect(sql().prepare('SELECT status,attempts FROM account_mail_outbox').get()).toEqual({
          status: state,
          attempts: 1,
        });
        expect(smtp.messages).toHaveLength(options.dropAfterData ? 1 : 0);
      } finally {
        await smtp.close();
      }
    },
  );
  it('upgrades an old database without changing workspace mail ciphertext or passwords', async () => {
    const oldDir = join(folder, 'old-migrations');
    await mkdir(oldDir);
    for (const name of await readdir(resolve('migrations')))
      if (name.endsWith('.sql') && name < '0020')
        await copyFile(resolve('migrations', name), join(oldDir, name));
    const oldDb = createDatabaseContext(join(folder, 'old.sqlite'));
    try {
      migrateDatabase(oldDb, { migrationsDir: oldDir });
      const oldCore = createCoreServices(oldDb, {
        storageDir: join(folder, 'old-media'),
        sessionSecret: 'old-test',
        publicOrigin: origin,
        isProduction: false,
        demoMode: false,
      });
      const registered = await oldCore.auth.register({
        email: 'old@example.test',
        password: oldPassword,
        displayName: 'Old',
      });
      const oldActor: Actor = {
        userId: registered.user.id,
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      };
      const team = oldCore.auth.createWorkspace(oldActor.userId, 'Old team', 'team');
      // Seed the old invitation record directly; the current team service requires 0029.
      const inviteId = randomUUID(),
        inviteToken = 'explicit-old-mail-migration-fixture',
        createdAt = new Date().toISOString();
      oldDb.sqlite
        .prepare(
          'INSERT INTO invitations(id,workspace_id,email,role,token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          inviteId,
          team.id,
          'guest@example.test',
          'member',
          hash(inviteToken),
          oldActor.userId,
          createdAt,
          new Date(Date.now() + 7 * 86400000).toISOString(),
        );
      expect(
        oldDb.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='password_requests'").get(),
      ).toBeUndefined();
      expect(
        oldDb.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='team_provisioning'").get(),
      ).toBeUndefined();
      const oldHash = oldDb.sqlite
        .prepare('SELECT password_hash FROM users WHERE id=?')
        .get(oldActor.userId);
      const smtp = {
        enabled: true as const,
        host: '127.0.0.1',
        port: 9,
        tlsMode: 'local-test' as const,
        from: 'studio@example.test',
        fromName: 'Test',
      };
      const box = createMailOutbox(oldDb, { smtp, encryptionKey: 'old-key', publicOrigin: origin });
      box.enqueueInvitation({
        workspaceId: team.id,
        invitationId: inviteId,
        inviteUrl: `${origin}/invite#token=${inviteToken}`,
      });
      const before = oldDb.sqlite.prepare('SELECT * FROM mail_outbox').get();
      migrateDatabase(oldDb, { migrationsDir: resolve('migrations') });
      migrateDatabase(oldDb, { migrationsDir: resolve('migrations') });
      expect(oldDb.sqlite.prepare('SELECT * FROM mail_outbox').get()).toEqual(before);
      expect(
        oldDb.sqlite.prepare('SELECT password_hash FROM users WHERE id=?').get(oldActor.userId),
      ).toEqual(oldHash);
      expect(oldDb.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(box.claim('after-upgrade')?.message.to).toBe('guest@example.test');
      await expect(
        oldCore.auth.login({ email: 'old@example.test', password: oldPassword }),
      ).resolves.toHaveProperty('sessionToken');
    } finally {
      closeDatabase(oldDb);
    }
  });
});

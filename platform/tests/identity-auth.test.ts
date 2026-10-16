import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app';
import {
  createIdentityAuthService,
  type IdentityAuthOptions,
} from '../src/server/auth/identity/service';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';
import type {
  IdentitySession,
  SmsGateway,
  WechatGateway,
  WechatIdentity,
} from '../src/server/auth/identity/types';
import { randomBytes } from 'node:crypto';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
let instance: Awaited<ReturnType<typeof createApp>> | undefined;
let folder: string | undefined;
afterEach(async () => {
  await instance?.app.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('reports explicitly disabled SMS and WeChat without fabricating authentication', async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-identities-'));
  instance = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:4310',
      databasePath: join(folder, 'test.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'test-only',
      encryptionKey: 'test-only',
      demoMode: false,
      isProduction: false,
      environmentSecrets: {},
    },
    { serveWeb: false },
  );
  const result = await instance.app.inject('/api/v1/auth/identity/status');
  expect(result.statusCode).toBe(200);
  expect(result.json().data.sms).toMatchObject({ enabled: false, ready: false });
  expect(result.json().data.wechat).toMatchObject({ enabled: false, ready: false });
});
let config: AppConfig;
let time: number;
let sent: { phone: string; code: string; requestId: string }[];
let outcome: Awaited<ReturnType<SmsGateway['send']>>;
let exchanges: string[];
const browserToken = randomBytes(32).toString('base64url');
const password = 'IdentityOwnerPassword2026!';
const identity: WechatIdentity = {
  appId: 'wxFixture',
  openid: 'openid_fixture',
  unionid: 'union_fixture',
};
async function open(options: IdentityAuthOptions = {}) {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-identities-'));
  time = Date.now();
  sent = [];
  exchanges = [];
  outcome = { status: 'accepted' };
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:4310',
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'test-only',
    encryptionKey: 'identity-secret-not-production',
    demoMode: false,
    isProduction: false,
    environmentSecrets: {},
    sms: {
      enabled: true,
      accessKeyId: 'FixtureId',
      accessKeySecret: 'FixtureSecret',
      signName: '隔离测试',
      templateCode: 'SMS_fixture',
    },
    wechat: { enabled: true, appId: identity.appId, appSecret: 'wechat-test-secret' },
  };
  instance = await createApp(config, {
    serveWeb: false,
    identity: {
      now: () => new Date(time),
      smsGateway: {
        async send(input) {
          sent.push(input);
          return outcome;
        },
      },
      wechatGateway: {
        authorize(state) {
          return `https://open.weixin.qq.com/connect/qrconnect?state=${state}`;
        },
        async exchange(code) {
          exchanges.push(code);
          return identity;
        },
      },
      ...options,
    },
  });
  return instance.services.identities;
}
const db = () => instance!.services.db;
const sql = () => db().sqlite;
const core = () => instance!.services.core;
const service = () => instance!.services.identities;
const actorFor = (userId: string): Actor => ({
  userId,
  authType: 'session',
  apiKeyId: null,
  workspaceId: null,
  scopes: [],
});
async function owner() {
  const value = await core().auth.register({
    email: 'owner@example.test',
    password,
    displayName: 'Owner',
  });
  return {
    ...value,
    current: { actor: actorFor(value.user.id), sessionToken: value.sessionToken },
  };
}
async function codeFor(challengeId: string) {
  const delivery = sql()
    .prepare('SELECT id FROM sms_deliveries WHERE challenge_id=?')
    .get(challengeId) as { id: string };
  for (let i = 0; i < 10 && !sent.some((message) => message.requestId === delivery.id); i++)
    await service().sms.tick();
  const message = sent.find((entry) => entry.requestId === delivery.id);
  expect(message).toBeDefined();
  return message!.code;
}
async function bindPhone(current: IdentitySession, phone = '13800138000') {
  const request = await service().requestSms(
    { purpose: 'bind', phone, password },
    browserToken,
    'bind-ip',
    current,
  );
  const code = await codeFor(request.challengeId);
  expect(
    service().verifySms(
      { challengeId: request.challengeId, code },
      browserToken,
      'verify-ip',
      current,
    ),
  ).toEqual({ linked: true });
  return phone;
}
function stateOf(result: { authorizationUrl: string }) {
  return new URL(result.authorizationUrl).searchParams.get('state')!;
}
async function guest(account: Awaited<ReturnType<typeof owner>>) {
  const team = core().auth.createWorkspace(
    account.current.actor.userId,
    'Identity conflict team',
    'team',
  );
  const invitation = core().team.invite(account.current.actor, team.id, {
    email: 'guest@example.test',
    role: 'member',
    expiresInDays: 7,
  });
  const result = await core().auth.register({
    email: 'guest@example.test',
    password,
    displayName: 'Guest',
    inviteToken: invitation.inviteUrl.split('#token=')[1],
  });
  return {
    ...result,
    current: { actor: actorFor(result.user.id), sessionToken: result.sessionToken },
  };
}
it('rejects an old login code after the phone is detached from A and explicitly bound to B', async () => {
  await open();
  const account = await owner();
  await bindPhone(account.current);
  const other = await guest(account);
  time += 61_000;
  const old = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    'old-browser',
    'old-ip',
  );
  const oldCode = await codeFor(old.challengeId);
  await service().unlink('sms', { password }, account.current);
  time += 61_000;
  await bindPhone(other.current);
  expect(() =>
    service().verifySms({ challengeId: old.challengeId, code: oldCode }, 'old-browser', 'old-ip'),
  ).toThrow('验证已失效');
  expect(sql().prepare('SELECT user_id FROM phone_identities').get()).toEqual({
    user_id: other.user.id,
  });
});

it('allows password-proven local detach when external providers are disabled and makes no gateway call', async () => {
  await open();
  const account = await owner();
  await bindPhone(account.current);
  const begin = await service().startWechat(browserToken, 'ip', account.current, { password });
  await service().completeWechat(
    { state: stateOf(begin), code: 'proof' },
    browserToken,
    account.current,
  );
  const count = sent.length,
    wxCount = exchanges.length;
  const disabled = createIdentityAuthService(db(), core(), {
    ...config,
    sms: { enabled: false },
    wechat: { enabled: false },
  });
  await expect(disabled.unlink('sms', { password }, account.current)).resolves.toEqual({
    unlinked: true,
  });
  await expect(disabled.unlink('wechat', { password }, account.current)).resolves.toEqual({
    unlinked: true,
  });
  expect(sql().prepare('SELECT count(*) n FROM phone_identities').get()).toEqual({ n: 0 });
  expect(sql().prepare('SELECT count(*) n FROM wechat_identities').get()).toEqual({ n: 0 });
  expect(sent).toHaveLength(count);
  expect(exchanges).toHaveLength(wxCount);
});
it('invalidates a previously verified pending registration when its phone becomes bound elsewhere', async () => {
  await open();
  const account = await owner();
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    'previous-browser',
    'previous-ip',
  );
  const pending = service().verifySms(
    { challengeId: request.challengeId, code: await codeFor(request.challengeId) },
    'previous-browser',
    'previous-ip',
  );
  if (!('registrationId' in pending)) throw new Error('Missing registration');
  time += 61_000;
  await bindPhone(account.current);
  await service().unlink('sms', { password }, account.current);
  await expect(
    service().register(
      {
        registrationId: pending.registrationId,
        email: 'pending@example.test',
        displayName: 'Pending',
        password,
        confirmPassword: password,
      },
      'previous-browser',
    ),
  ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_INVALID' });
  expect(sql().prepare('SELECT count(*) n FROM users').get()).toEqual({ n: 1 });
});

it('does not steal another account phone or consume its own valid challenge on conflict', async () => {
  await open();
  const account = await owner();
  await bindPhone(account.current);
  const other = await guest(account);
  time += 61_000;
  const request = await service().requestSms(
    { purpose: 'bind', phone: '13800138000', password },
    browserToken,
    'guest-ip',
    other.current,
  );
  const code = await codeFor(request.challengeId);
  expect(() =>
    service().verifySms(
      { challengeId: request.challengeId, code },
      browserToken,
      'guest-ip',
      other.current,
    ),
  ).toThrow('此身份已关联其他账户');
  expect(sql().prepare('SELECT user_id FROM phone_identities').get()).toEqual({
    user_id: account.user.id,
  });
  expect(
    sql().prepare('SELECT consumed_at FROM sms_challenges WHERE id=?').get(request.challengeId),
  ).toEqual({ consumed_at: null });
  expect(sql().prepare('SELECT count(*) n FROM users').get()).toEqual({ n: 2 });
});

it('does not merge or steal another account WeChat identity after valid provider proof', async () => {
  await open();
  const account = await owner();
  const first = await service().startWechat(browserToken, 'ip-a', account.current, { password });
  await service().completeWechat(
    { state: stateOf(first), code: 'owner-proof' },
    browserToken,
    account.current,
  );
  const other = await guest(account);
  const begin = await service().startWechat('guest-browser', 'ip-b', other.current, { password });
  await expect(
    service().completeWechat(
      { state: stateOf(begin), code: 'same-identity-proof' },
      'guest-browser',
      other.current,
    ),
  ).rejects.toMatchObject({ code: 'IDENTITY_ALREADY_LINKED' });
  expect(sql().prepare('SELECT user_id FROM wechat_identities').get()).toEqual({
    user_id: account.user.id,
  });
  expect(service().status(other.current.actor).wechatLinked).toBe(false);
});

it('completes first WeChat registration with an explicitly unverified self-entered email and a local password', async () => {
  await open();
  const begin = await service().startWechat(browserToken, 'ip');
  const pending = await service().completeWechat(
    { state: stateOf(begin), code: 'new-identity-proof' },
    browserToken,
  );
  if (!('registrationId' in pending)) throw new Error('Missing registration');
  const result = await service().register(
    {
      registrationId: pending.registrationId,
      email: 'self-entered@example.test',
      displayName: 'New WeChat user',
      password,
      confirmPassword: password,
    },
    browserToken,
  );
  expect(sql().prepare('SELECT user_id,openid FROM wechat_identities').get()).toEqual({
    user_id: result.user.id,
    openid: identity.openid,
  });
  expect(sql().prepare('SELECT email_verified,local_password_enabled FROM users').get()).toEqual({
    email_verified: 0,
    local_password_enabled: 1,
  });
  await expect(core().auth.login({ email: result.user.email, password })).resolves.toMatchObject({
    user: { id: result.user.id },
  });
});

it('clears expired unsent ciphertext while disabled and never blindly reclaims stale sending leases', async () => {
  await open();
  await service().requestSms({ purpose: 'login', phone: '13800138000' }, browserToken, 'ip');
  sql()
    .prepare("UPDATE sms_deliveries SET status='sending',lease_owner='lost-worker',lease_until=?")
    .run(new Date(time - 1).toISOString());
  await service().sms.tick();
  expect(sent).toHaveLength(0);
  expect(sql().prepare('SELECT status,payload_ciphertext FROM sms_deliveries').get()).toEqual({
    status: 'reconciliation_required',
    payload_ciphertext: null,
  });
  await service().requestSms({ purpose: 'login', phone: '13900139000' }, browserToken, 'ip');
  time += 301_000;
  const disabled = createIdentityAuthService(
    db(),
    core(),
    { ...config, sms: { enabled: false } },
    { now: () => new Date(time) },
  );
  await disabled.sms.tick();
  expect(
    sql()
      .prepare(
        "SELECT count(*) n FROM sms_deliveries WHERE payload_ciphertext IS NOT NULL OR status<>'cancelled'",
      )
      .get(),
  ).toEqual({ n: 0 });
  expect(sent).toHaveLength(0);
});

it('marks incomplete configuration unavailable and blocks SMS, WeChat and unsafe public origins', async () => {
  await open();
  const disabled = createIdentityAuthService(db(), core(), {
    ...config,
    sms: { enabled: true },
    wechat: { enabled: true },
  });
  expect(disabled.status().sms.ready).toBe(false);
  expect(disabled.status().wechat.ready).toBe(false);
  await expect(
    disabled.requestSms({ purpose: 'login', phone: '13800138000' }, browserToken, 'ip'),
  ).rejects.toMatchObject({ code: 'IDENTITY_NOT_CONFIGURED' });
  await expect(disabled.startWechat(browserToken, 'ip')).rejects.toMatchObject({
    code: 'IDENTITY_NOT_CONFIGURED',
  });
  expect(() =>
    createIdentityAuthService(db(), core(), { ...config, publicOrigin: 'http://external.example' }),
  ).toThrow('canonical HTTPS');
  expect(sent).toEqual([]);
});

it('binds a proven phone, revokes other sessions and signs in through a new browser challenge', async () => {
  await open();
  const account = await owner();
  const other = core().auth.session(account.user.id);
  await bindPhone(account.current);
  expect(service().status(account.current.actor)).toMatchObject({
    phone: { masked: '+86 138••••8000' },
    hasLocalPassword: true,
    emailVerified: false,
  });
  expect(
    (
      await instance!.app.inject({
        url: '/api/v1/auth/me',
        headers: { cookie: `studio_session=${other}` },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await instance!.app.inject({
        url: '/api/v1/auth/me',
        headers: { cookie: `studio_session=${account.sessionToken}` },
      })
    ).statusCode,
  ).toBe(200);
  time += 61_000;
  const challenge = await service().requestSms(
    { purpose: 'login', phone: '+8613800138000' },
    'another-browser',
    'new-ip',
  );
  const code = await codeFor(challenge.challengeId);
  const result = service().verifySms(
    { challengeId: challenge.challengeId, code },
    'another-browser',
    'new-ip',
  );
  expect(result).toMatchObject({ authenticated: true, user: { id: account.user.id } });
  expect('sessionToken' in result && result.sessionToken).toBeTruthy();
  expect(() =>
    service().verifySms({ challengeId: challenge.challengeId, code }, 'another-browser', 'new-ip'),
  ).toThrow('验证已失效');
  expect(JSON.stringify(sql().prepare('SELECT * FROM phone_identities').all())).not.toContain(
    '13800138000',
  );
});

it('never returns a code, keeps queue payload encrypted and gives the same send shape to unknown phones', async () => {
  await open();
  await owner();
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    browserToken,
    'ip-a',
  );
  const code = await codeFor(request.challengeId);
  expect(Object.keys(request).sort()).toEqual(['accepted', 'challengeId', 'expiresAt']);
  const row = sql().prepare('SELECT code_hash FROM sms_challenges').get() as { code_hash: string };
  expect(row.code_hash).not.toBe(code);
  expect(row.code_hash).toHaveLength(64);
  expect(sql().prepare('SELECT payload_ciphertext,status FROM sms_deliveries').get()).toEqual({
    payload_ciphertext: null,
    status: 'accepted',
  });
  const unknown = await service().requestSms(
    { purpose: 'login', phone: '13900139000' },
    browserToken,
    'ip-b',
  );
  expect(Object.keys(unknown).sort()).toEqual(Object.keys(request).sort());
  const stored = sql()
    .prepare('SELECT phone_ciphertext FROM sms_challenges WHERE id=?')
    .get(unknown.challengeId) as { phone_ciphertext: string };
  expect(stored.phone_ciphertext).not.toContain('13900139000');
});

it('persists per-phone cooldown and source limits after service recreation', async () => {
  await open();
  await service().requestSms({ purpose: 'login', phone: '13800138000' }, browserToken, 'ip-a');
  const restarted = createIdentityAuthService(db(), core(), config, { now: () => new Date(time) });
  await expect(
    restarted.requestSms({ purpose: 'login', phone: '13800138000' }, browserToken, 'ip-b'),
  ).rejects.toMatchObject({ code: 'IDENTITY_RATE_LIMIT' });
  for (let i = 0; i < 9; i++)
    await service().requestSms({ purpose: 'login', phone: `1390000000${i}` }, browserToken, 'ip-a');
  await expect(
    service().requestSms({ purpose: 'login', phone: '13900000009' }, browserToken, 'ip-a'),
  ).rejects.toMatchObject({ code: 'IDENTITY_RATE_LIMIT' });
  expect(sql().prepare('SELECT count(*) n FROM sms_challenges').get()).toEqual({ n: 10 });
});

it('persists five failed OTP attempts and never consumes a correct code afterward', async () => {
  await open();
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    browserToken,
    'ip',
  );
  const code = await codeFor(request.challengeId);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    expect(() =>
      service().verifySms({ challengeId: request.challengeId, code: wrong }, browserToken, 'ip'),
    ).toThrow('验证已失效');
  expect(sql().prepare('SELECT attempts,consumed_at FROM sms_challenges').get()).toEqual({
    attempts: 5,
    consumed_at: null,
  });
  expect(() =>
    service().verifySms({ challengeId: request.challengeId, code }, browserToken, 'ip'),
  ).toThrow('验证已失效');
});

it('rejects another browser and expired code without creating a session or consuming a fresh challenge', async () => {
  await open();
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    browserToken,
    'ip',
  );
  const code = await codeFor(request.challengeId);
  expect(() =>
    service().verifySms({ challengeId: request.challengeId, code }, 'wrong-browser', 'ip'),
  ).toThrow('验证已失效');
  expect(sql().prepare('SELECT consumed_at,attempts FROM sms_challenges').get()).toEqual({
    consumed_at: null,
    attempts: 0,
  });
  time += 301_000;
  expect(() =>
    service().verifySms({ challengeId: request.challengeId, code }, browserToken, 'ip'),
  ).toThrow('验证已失效');
  expect(sql().prepare('SELECT count(*) n FROM sessions').get()).toEqual({ n: 0 });
});

it('keeps the old phone until both old and new challenges succeed in the initiating session', async () => {
  await open();
  const account = await owner();
  await bindPhone(account.current);
  time += 61_000;
  const oldLogin = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    'old-login-browser',
    'old-login-ip',
  );
  const oldLoginCode = await codeFor(oldLogin.challengeId);
  time += 61_000;
  const old = await service().requestSms(
    { purpose: 'change-old', password },
    browserToken,
    'ip',
    account.current,
  );
  const oldCode = await codeFor(old.challengeId);
  expect(
    service().verifySms(
      { challengeId: old.challengeId, code: oldCode },
      browserToken,
      'ip',
      account.current,
    ),
  ).toEqual({ verified: true, challengeId: old.challengeId });
  await expect(
    service().requestSms(
      { purpose: 'change-new', phone: '13900139000', oldChallengeId: old.challengeId },
      'other-browser',
      'ip',
      account.current,
    ),
  ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_INVALID' });
  const next = await service().requestSms(
    { purpose: 'change-new', phone: '13900139000', oldChallengeId: old.challengeId },
    browserToken,
    'ip',
    account.current,
  );
  expect(service().status(account.current.actor).phone!.masked).toBe('+86 138••••8000');
  const nextCode = await codeFor(next.challengeId);
  expect(
    service().verifySms(
      { challengeId: next.challengeId, code: nextCode },
      browserToken,
      'ip',
      account.current,
    ),
  ).toEqual({ linked: true });
  expect(service().status(account.current.actor).phone!.masked).toBe('+86 139••••9000');
  expect(sql().prepare('SELECT count(*) n FROM phone_identities').get()).toEqual({ n: 1 });
  expect(sql().prepare('SELECT password_revision FROM users').get()).toEqual({
    password_revision: 2,
  });
  expect(() =>
    service().verifySms(
      { challengeId: oldLogin.challengeId, code: oldLoginCode },
      'old-login-browser',
      'old-login-ip',
    ),
  ).toThrow('验证已失效');
});

it('cancels queued changes if the authorizing session or password revision changes', async () => {
  await open();
  const account = await owner();
  await service().requestSms(
    { purpose: 'bind', phone: '13800138000', password },
    browserToken,
    'ip',
    account.current,
  );
  core().auth.logout(account.sessionToken);
  await service().sms.tick();
  expect(sent).toEqual([]);
  expect(sql().prepare('SELECT status FROM sms_deliveries').get()).toEqual({ status: 'cancelled' });
});

it('creates only a pending registration after unknown phone proof and honors existing invitation rules', async () => {
  await open();
  const account = await owner();
  const team = core().auth.createWorkspace(account.current.actor.userId, 'Inviting team', 'team');
  const invite = core().team.invite(account.current.actor, team.id, {
    email: 'guest@example.test',
    role: 'member',
    expiresInDays: 7,
  });
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    browserToken,
    'ip',
  );
  const pending = service().verifySms(
    { challengeId: request.challengeId, code: await codeFor(request.challengeId) },
    browserToken,
    'ip',
  );
  expect(pending).toHaveProperty('registrationId');
  expect(sql().prepare('SELECT count(*) n FROM users').get()).toEqual({ n: 1 });
  if (!('registrationId' in pending)) throw new Error('Missing registration');
  const body = {
    registrationId: pending.registrationId,
    email: 'guest@example.test',
    displayName: 'Guest',
    password,
    confirmPassword: password,
  };
  await expect(service().register(body, browserToken)).rejects.toMatchObject({
    code: 'REGISTRATION_CLOSED',
  });
  await expect(
    service().register(
      { ...body, email: 'wrong@example.test', inviteToken: invite.inviteUrl.split('#token=')[1] },
      browserToken,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
  const result = await service().register(
    { ...body, inviteToken: invite.inviteUrl.split('#token=')[1] },
    browserToken,
  );
  expect(result.user.email).toBe('guest@example.test');
  expect(sql().prepare('SELECT email_verified FROM users WHERE id=?').get(result.user.id)).toEqual({
    email_verified: 0,
  });
  expect(
    sql()
      .prepare('SELECT count(*) n FROM memberships WHERE workspace_id=? AND user_id=?')
      .get(team.id, result.user.id),
  ).toEqual({ n: 1 });
  await expect(
    service().register(
      { ...body, inviteToken: invite.inviteUrl.split('#token=')[1] },
      browserToken,
    ),
  ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_INVALID' });
});

it('allows explicitly verified external first registration only under the existing loopback bootstrap gate', async () => {
  await open();
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    browserToken,
    'ip',
  );
  const pending = service().verifySms(
    { challengeId: request.challengeId, code: await codeFor(request.challengeId) },
    browserToken,
    'ip',
  );
  if (!('registrationId' in pending)) throw new Error('Missing registration');
  const body = {
    registrationId: pending.registrationId,
    email: 'new@example.test',
    displayName: 'New',
    password,
    confirmPassword: password,
  };
  await expect(service().register(body, 'other-browser')).rejects.toMatchObject({
    code: 'IDENTITY_PROOF_INVALID',
  });
  const result = await service().register(body, browserToken);
  expect(result.user.email).toBe('new@example.test');
  expect(sql().prepare('SELECT count(*) n FROM phone_identities').get()).toEqual({ n: 1 });
});

it('never merges a verified phone into an existing email account', async () => {
  await open();
  const account = await owner();
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    browserToken,
    'ip',
  );
  const pending = service().verifySms(
    { challengeId: request.challengeId, code: await codeFor(request.challengeId) },
    browserToken,
    'ip',
  );
  if (!('registrationId' in pending)) throw new Error('Missing registration');
  await expect(
    service().register(
      {
        registrationId: pending.registrationId,
        email: account.user.email,
        displayName: 'Would merge',
        password,
        confirmPassword: password,
      },
      browserToken,
    ),
  ).rejects.toMatchObject({ code: 'IDENTITY_LINK_REQUIRED' });
  expect(sql().prepare('SELECT count(*) n FROM phone_identities').get()).toEqual({ n: 0 });
  expect(sql().prepare('SELECT count(*) n FROM users').get()).toEqual({ n: 1 });
});

it('uses one-time browser-bound WeChat state and consumes a callback before network exchange', async () => {
  await open();
  const begin = await service().startWechat(browserToken, 'ip');
  const query = { state: stateOf(begin), code: 'test-code-never-real' };
  await expect(service().completeWechat(query, 'wrong-browser')).rejects.toMatchObject({
    code: 'IDENTITY_PROOF_INVALID',
  });
  expect(exchanges).toEqual([]);
  const pending = await service().completeWechat(query, browserToken);
  expect(pending).toHaveProperty('registrationId');
  expect(exchanges).toEqual(['test-code-never-real']);
  await expect(service().completeWechat(query, browserToken)).rejects.toMatchObject({
    code: 'IDENTITY_PROOF_INVALID',
  });
  expect(exchanges).toHaveLength(1);
  expect(sql().prepare('SELECT count(*) n FROM sessions').get()).toEqual({ n: 0 });
});

it('links WeChat with a current password, then logs in only by the exact verified identity', async () => {
  await open();
  const account = await owner();
  const begin = await service().startWechat(browserToken, 'ip', account.current, { password });
  expect(
    await service().completeWechat(
      { state: stateOf(begin), code: 'fixture-code' },
      browserToken,
      account.current,
    ),
  ).toEqual({ linked: true });
  const login = await service().startWechat('new-browser', 'ip2');
  expect(
    await service().completeWechat({ state: stateOf(login), code: 'fixture-login' }, 'new-browser'),
  ).toMatchObject({ authenticated: true, user: { id: account.user.id } });
  expect(sql().prepare('SELECT count(*) n FROM wechat_identities').get()).toEqual({ n: 1 });
});

it('rechecks a linking session after asynchronous WeChat exchange', async () => {
  let resolve!: (value: WechatIdentity) => void;
  let started!: () => void;
  const began = new Promise<void>((done) => {
    started = done;
  });
  const gateway: WechatGateway = {
    authorize(state) {
      return `https://open.weixin.qq.com/connect/qrconnect?state=${state}`;
    },
    exchange() {
      started();
      return new Promise<WechatIdentity>((done) => {
        resolve = done;
      });
    },
  };
  await open({ wechatGateway: gateway });
  const account = await owner();
  const begin = await service().startWechat(browserToken, 'ip', account.current, { password });
  const completion = service().completeWechat(
    { state: stateOf(begin), code: 'fixture-code' },
    browserToken,
    account.current,
  );
  await began;
  core().auth.logout(account.sessionToken);
  resolve(identity);
  await expect(completion).rejects.toMatchObject({ code: 'IDENTITY_SESSION_REQUIRED' });
  expect(sql().prepare('SELECT count(*) n FROM wechat_identities').get()).toEqual({ n: 0 });
  expect(sql().prepare('SELECT status FROM wechat_auth_flows').get()).toEqual({ status: 'failed' });
});

it('rejects wrong app identity and expires state without retrying the provider', async () => {
  await open({
    wechatGateway: {
      authorize(state) {
        return `https://open.weixin.qq.com/connect/qrconnect?state=${state}`;
      },
      async exchange() {
        return { ...identity, appId: 'wrong-app' };
      },
    },
  });
  const begin = await service().startWechat(browserToken, 'ip');
  await expect(
    service().completeWechat({ state: stateOf(begin), code: 'code' }, browserToken),
  ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_INVALID' });
  expect(sql().prepare('SELECT status FROM wechat_auth_flows').get()).toEqual({ status: 'failed' });
  const next = await service().startWechat(browserToken, 'ip');
  time += 601_000;
  await expect(
    service().completeWechat({ state: stateOf(next), code: 'code' }, browserToken),
  ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_INVALID' });
});

it('does not unlock Google-only unlink or binding by knowing its placeholder password', async () => {
  await open();
  const account = await owner();
  sql().prepare('UPDATE users SET local_password_enabled=0 WHERE id=?').run(account.user.id);
  await expect(
    service().requestSms(
      { purpose: 'bind', phone: '13800138000', password },
      browserToken,
      'ip',
      account.current,
    ),
  ).rejects.toMatchObject({ code: 'LOCAL_PASSWORD_REQUIRED' });
  await expect(
    service().startWechat(browserToken, 'ip', account.current, { password }),
  ).rejects.toMatchObject({ code: 'LOCAL_PASSWORD_REQUIRED' });
  await expect(service().unlink('wechat', { password }, account.current)).rejects.toMatchObject({
    code: 'LOCAL_PASSWORD_REQUIRED',
  });
  expect(sent).toEqual([]);
});

it('rejects cross-origin writes and API keys cannot manage private identities', async () => {
  await open();
  const account = await owner();
  const key = core().business.createKey(account.current.actor, account.workspace.id, {
    name: 'test-key',
    scopes: ['assets:read'],
  });
  const status = await instance!.app.inject({
    url: '/api/v1/auth/identity/status',
    headers: { authorization: `Bearer ${key.secret}` },
  });
  expect(status.statusCode).toBe(200);
  expect(status.json().data.phone).toBeUndefined();
  expect(status.json().data.hasLocalPassword).toBeUndefined();
  const bad = await instance!.app.inject({
    method: 'POST',
    url: '/api/v1/auth/sms/send',
    headers: { origin: 'https://foreign.example' },
    payload: { purpose: 'login', phone: '13800138000' },
  });
  expect(bad.statusCode).toBe(403);
  const bind = await instance!.app.inject({
    method: 'POST',
    url: '/api/v1/auth/sms/send',
    headers: { origin: config.publicOrigin, authorization: `Bearer ${key.secret}` },
    payload: { purpose: 'bind', phone: '13800138000', password },
  });
  expect(bind.statusCode).toBe(401);
  expect(sent).toEqual([]);
});

it('does not automatically resend rejected or uncertain SMS even after restarting the queue', async () => {
  await open();
  outcome = { status: 'reconciliation_required', errorCode: 'UNKNOWN' };
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    browserToken,
    'ip',
  );
  await codeFor(request.challengeId);
  await service().sms.tick();
  await service().sms.tick();
  expect(sent).toHaveLength(1);
  const restarted = createIdentityAuthService(db(), core(), config, {
    now: () => new Date(time),
    smsGateway: {
      async send() {
        throw new Error('Must not replay');
      },
    },
  });
  await restarted.sms.tick();
  expect(sql().prepare('SELECT status,payload_ciphertext FROM sms_deliveries').get()).toEqual({
    status: 'reconciliation_required',
    payload_ciphertext: null,
  });
  time += 301_000;
  const disabled = createIdentityAuthService(
    db(),
    core(),
    { ...config, sms: { enabled: false } },
    { now: () => new Date(time) },
  );
  await disabled.sms.tick();
  expect(sql().prepare('SELECT status,payload_ciphertext FROM sms_deliveries').get()).toEqual({
    status: 'cancelled',
    payload_ciphertext: null,
  });
  expect(sql().prepare('SELECT code_hash,phone_ciphertext FROM sms_challenges').get()).toEqual({
    code_hash: '',
    phone_ciphertext: '',
  });
});

it('only consumes one SMS challenge through two independent database connections', async () => {
  await open();
  const request = await service().requestSms(
    { purpose: 'login', phone: '13800138000' },
    browserToken,
    'ip',
  );
  const code = await codeFor(request.challengeId);
  const second = createDatabaseContext(config.databasePath);
  try {
    const other = createIdentityAuthService(second, core(), config, { now: () => new Date(time) });
    const value = { challengeId: request.challengeId, code };
    const first = service().verifySms(value, browserToken, 'ip');
    expect(first).toHaveProperty('registrationId');
    expect(() => other.verifySms(value, browserToken, 'ip')).toThrow('验证已失效');
    expect(sql().prepare('SELECT count(*) n FROM identity_registrations').get()).toEqual({ n: 1 });
  } finally {
    closeDatabase(second);
  }
});

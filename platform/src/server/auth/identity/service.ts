import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../../../contracts/core';
import {
  IdentityPasswordSchema,
  IdentityRegistrationSchema,
  SmsSendSchema,
  SmsVerifySchema,
  type IdentityStatus,
} from '../../../contracts/identity-auth';
import type { AppConfig } from '../../config';
import type { DatabaseContext } from '../../db/connection';
import type { CoreServices } from '../../core';
import { hashPassword } from '../../core/auth';
import { hash, token } from '../../core/shared';
import { AppError } from '../../errors';
import { identityCrypto } from './crypto';
import { createSmsQueue } from './sms-queue';
import { createWechatGateway } from './wechat';
import {
  WECHAT_CALLBACK,
  type IdentitySession,
  type SmsGateway,
  type WechatGateway,
  type WechatIdentity,
} from './types';
const phoneIdentitySchema = z.object({ phone: z.string().regex(/^\+861[3-9]\d{9}$/) }).strict();
const wechatIdentitySchema = z
  .object({
    appId: z.string().min(1).max(128),
    openid: z.string().min(1).max(128),
    unionid: z.string().min(1).max(128).nullable(),
  })
  .strict();
interface User {
  id: string;
  password_revision: number;
  local_password_enabled: number;
  email_verified: number;
}
interface Challenge {
  id: string;
  purpose: 'login' | 'bind' | 'change-old' | 'change-new';
  phone_hash: string;
  phone_ciphertext: string;
  code_hash: string;
  browser_hash: string;
  user_id: string | null;
  session_hash: string | null;
  password_revision: number | null;
  old_challenge_id: string | null;
  attempts: number;
  expires_at: string;
  verified_at: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
}
interface Flow {
  id: string;
  browser_hash: string;
  intent: 'login' | 'link';
  user_id: string | null;
  session_hash: string | null;
  password_revision: number | null;
  expires_at: string;
  status: string;
}
const actorFor = (userId: string): Actor => ({
  userId,
  authType: 'session',
  apiKeyId: null,
  workspaceId: null,
  scopes: [],
});
export interface IdentityAuthOptions {
  now?: () => Date;
  smsGateway?: SmsGateway;
  wechatGateway?: WechatGateway;
}
export function createIdentityAuthService(
  db: DatabaseContext,
  core: CoreServices,
  config: AppConfig,
  options: IdentityAuthOptions = {},
) {
  const sql = db.sqlite,
    crypto = identityCrypto(config.encryptionKey),
    clock = options.now ?? (() => new Date()),
    at = () => clock().toISOString();
  const atomic = <T>(fn: () => T): T =>
    sql.inTransaction ? fn() : sql.transaction(fn).immediate();
  const sms = createSmsQueue(db, config.encryptionKey, config.sms, clock, options.smsGateway);
  let wechatGateway = options.wechatGateway;
  const wechatReady =
    !!config.wechat?.enabled &&
    /^[A-Za-z0-9_-]{1,128}$/.test(config.wechat.appId ?? '') &&
    !!config.wechat.appSecret &&
    config.wechat.appSecret.length <= 256 &&
    !/[\u0000-\u0020\u007f]/.test(config.wechat.appSecret);
  const origin = new URL(config.publicOrigin);
  if (
    (config.sms?.enabled || config.wechat?.enabled) &&
    (!config.encryptionKey ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      !['http:', 'https:'].includes(origin.protocol) ||
      (origin.protocol !== 'https:' &&
        !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))
  )
    throw new Error(
      'Identity authentication requires a canonical HTTPS public origin, except loopback.',
    );
  const user = (uid: string) =>
    sql
      .prepare(
        'SELECT id,password_revision,local_password_enabled,email_verified FROM users WHERE id=?',
      )
      .get(uid) as User | undefined;
  const invalid = () =>
    new AppError(400, 'IDENTITY_PROOF_INVALID', '验证已失效或未通过，请重新申请');
  const browserHash = (browser: string) => crypto.digest('browser', browser);
  function session(
    current?: IdentitySession | null,
    expected?: {
      user_id: string | null;
      session_hash: string | null;
      password_revision: number | null;
    },
  ) {
    if (!current || current.actor.authType !== 'session' || !current.sessionToken)
      throw new AppError(401, 'IDENTITY_SESSION_REQUIRED', '请在发起操作的原登录会话中继续');
    const row = user(current.actor.userId),
      digest = hash(current.sessionToken);
    if (
      !row ||
      !sql
        .prepare(
          'SELECT id FROM sessions WHERE token_hash=? AND user_id=? AND revoked_at IS NULL AND expires_at>?',
        )
        .get(digest, row.id, at()) ||
      (expected &&
        (expected.user_id !== row.id ||
          expected.session_hash !== digest ||
          expected.password_revision !== row.password_revision))
    )
      throw new AppError(401, 'IDENTITY_SESSION_REQUIRED', '请在发起操作的原登录会话中继续');
    return { row, digest };
  }
  async function confirm(current: IdentitySession | null | undefined, password: string) {
    const before = session(current);
    if (before.row.local_password_enabled !== 1)
      throw new AppError(
        409,
        'LOCAL_PASSWORD_REQUIRED',
        '请先通过账户邮箱安全设置本地密码，再管理其他登录方式',
      );
    await core.auth.confirmPassword(current!.actor, password);
    return session(current, {
      user_id: before.row.id,
      session_hash: before.digest,
      password_revision: before.row.password_revision,
    });
  }
  function ready(channel: 'sms' | 'wechat') {
    if (!(channel === 'sms' ? sms.enabled : wechatReady))
      throw new AppError(
        503,
        'IDENTITY_NOT_CONFIGURED',
        channel === 'sms' ? '短信登录尚未启用或配置不完整' : '微信登录尚未启用或配置不完整',
      );
  }
  function status(actor?: Actor | null): IdentityStatus {
    const uid = actor?.authType === 'session' ? actor.userId : null;
    const phone = uid
      ? (sql.prepare('SELECT masked,verified_at FROM phone_identities WHERE user_id=?').get(uid) as
          { masked: string; verified_at: string } | undefined)
      : undefined;
    const row = uid ? user(uid) : undefined;
    return {
      sms: {
        enabled: !!config.sms?.enabled,
        ready: sms.enabled,
        reason: sms.enabled ? null : config.sms?.enabled ? '短信配置不完整' : '短信登录未启用',
      },
      wechat: {
        enabled: !!config.wechat?.enabled,
        ready: wechatReady,
        reason: wechatReady ? null : config.wechat?.enabled ? '微信配置不完整' : '微信登录未启用',
      },
      ...(row
        ? {
            phone: phone ? { masked: phone.masked, verifiedAt: phone.verified_at } : null,
            wechatLinked: !!sql
              .prepare('SELECT 1 FROM wechat_identities WHERE user_id=?')
              .get(row.id),
            hasLocalPassword: row.local_password_enabled === 1,
            emailVerified: row.email_verified === 1,
          }
        : {}),
    };
  }
  function bucket(domain: string, value: string, limit: number, period: number) {
    const time = clock().getTime(),
      key = crypto.digest(`rate:${domain}`, value);
    const previous = sql
      .prepare('SELECT window_start,attempts FROM identity_rate_limits WHERE bucket_key=?')
      .get(key) as { window_start: number; attempts: number } | undefined;
    const active = previous && previous.window_start + period > time;
    if (active && previous.attempts >= limit)
      throw new AppError(429, 'IDENTITY_RATE_LIMIT', '请求过于频繁，请稍后再试');
    sql
      .prepare(
        'INSERT INTO identity_rate_limits VALUES(?,?,?,?,?) ON CONFLICT(bucket_key) DO UPDATE SET window_start=excluded.window_start,attempts=excluded.attempts,last_allowed_at=excluded.last_allowed_at,expires_at=excluded.expires_at',
      )
      .run(
        key,
        active ? previous.window_start : time,
        active ? previous.attempts + 1 : 1,
        time,
        active ? previous.window_start + period : time + period,
      );
  }
  function phoneRow(uid: string) {
    return sql.prepare('SELECT * FROM phone_identities WHERE user_id=?').get(uid) as
      { phone_hash: string; phone_ciphertext: string } | undefined;
  }
  function phoneValue(uid: string) {
    const row = phoneRow(uid);
    if (!row) throw new AppError(409, 'PHONE_NOT_LINKED', '尚未绑定手机号');
    return phoneIdentitySchema.parse(
      crypto.open(row.phone_ciphertext, `phone-identity\0${uid}\0${row.phone_hash}`),
    ).phone;
  }
  function oldProof(id: string, browser: string, current?: IdentitySession | null) {
    const row = sql
      .prepare("SELECT * FROM sms_challenges WHERE id=? AND purpose='change-old'")
      .get(id) as Challenge | undefined;
    if (
      !row ||
      row.revoked_at ||
      row.consumed_at ||
      !row.verified_at ||
      row.expires_at <= at() ||
      row.browser_hash !== browserHash(browser)
    )
      throw invalid();
    session(current, row);
    if (phoneRow(row.user_id!)?.phone_hash !== row.phone_hash) throw invalid();
    return row;
  }
  async function requestSms(
    raw: unknown,
    browser: string,
    ip: string,
    current?: IdentitySession | null,
  ) {
    const input = SmsSendSchema.parse(raw);
    ready('sms');
    let proof: ReturnType<typeof session> | undefined;
    if (input.purpose === 'bind' || input.purpose === 'change-old') {
      atomic(() => bucket('identity-password-ip', ip, 10, 900_000));
      proof = await confirm(current, input.password);
    }
    if (input.purpose === 'change-new') {
      oldProof(input.oldChallengeId, browser, current);
      proof = session(current);
    }
    return atomic(() => {
      sms.cleanup();
      if (proof)
        session(current, {
          user_id: proof.row.id,
          session_hash: proof.digest,
          password_revision: proof.row.password_revision,
        });
      if (input.purpose === 'bind' && phoneRow(proof!.row.id))
        throw new AppError(409, 'PHONE_ALREADY_LINKED', '已有手机号，请使用换绑流程');
      if (input.purpose === 'change-new') oldProof(input.oldChallengeId, browser, current);
      const phone =
        input.purpose === 'change-old'
          ? phoneValue(proof!.row.id)
          : `+86${input.phone.replace(/^(?:\+86|0086)/, '')}`;
      const phoneHash = crypto.digest('phone', phone);
      bucket('sms-ip', ip, 10, 900_000);
      bucket('sms-phone-minute', phoneHash, 1, 60_000);
      bucket('sms-phone-hour', phoneHash, 3, 3600_000);
      bucket('sms-global-day', 'all', 100, 86400_000);
      const id = randomUUID(),
        code = String(randomInt(0, 1_000_000)).padStart(6, '0'),
        expiry = new Date(clock().getTime() + 300_000).toISOString();
      sql
        .prepare(
          'INSERT INTO sms_challenges(id,purpose,phone_hash,phone_ciphertext,code_hash,browser_hash,user_id,session_hash,password_revision,old_challenge_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          input.purpose,
          phoneHash,
          crypto.seal({ phone }, `sms-phone\0${id}\0${phoneHash}`),
          crypto.digest('sms-code', `${id}\0${phoneHash}\0${code}`),
          browserHash(browser),
          proof?.row.id ?? null,
          proof?.digest ?? null,
          proof?.row.password_revision ?? null,
          input.purpose === 'change-new' ? input.oldChallengeId : null,
          at(),
          expiry,
        );
      sms.enqueue(id, phone, code, expiry);
      return { accepted: true as const, challengeId: id, expiresAt: expiry };
    });
  }
  function revokeOtherSessions(uid: string, keep: string) {
    sql
      .prepare('UPDATE users SET password_revision=password_revision+1,updated_at=? WHERE id=?')
      .run(at(), uid);
    sql
      .prepare(
        'UPDATE sessions SET revoked_at=? WHERE user_id=? AND token_hash<>? AND revoked_at IS NULL',
      )
      .run(at(), uid, keep);
    sql
      .prepare(
        'UPDATE sms_challenges SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL',
      )
      .run(at(), uid);
    sql
      .prepare(
        "UPDATE wechat_auth_flows SET status='expired' WHERE user_id=? AND status IN('pending','exchanging')",
      )
      .run(uid);
    sql
      .prepare(
        "UPDATE google_oidc_flows SET status='expired',encrypted_context='' WHERE user_id=? AND status IN('pending','exchanging')",
      )
      .run(uid);
    sql
      .prepare(
        'UPDATE password_requests SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL',
      )
      .run(at(), uid);
    sql
      .prepare(
        "UPDATE account_mail_outbox SET status='cancelled',payload_ciphertext=NULL,lease_owner=NULL,lease_until=NULL WHERE user_id=? AND kind='password-request' AND status<>'accepted'",
      )
      .run(uid);
  }
  function bindPhone(uid: string, phone: string, replacing: boolean) {
    const digest = crypto.digest('phone', phone),
      conflict = sql
        .prepare('SELECT user_id FROM phone_identities WHERE phone_hash=?')
        .get(digest) as { user_id: string } | undefined;
    if (conflict && conflict.user_id !== uid)
      throw new AppError(409, 'IDENTITY_ALREADY_LINKED', '此身份已关联其他账户，请使用原账户登录');
    if (!replacing && phoneRow(uid))
      throw new AppError(409, 'PHONE_ALREADY_LINKED', '已有手机号，请使用换绑流程');
    const previous = phoneRow(uid);
    if (previous) revokePhoneProofs(previous.phone_hash);
    revokePhoneProofs(digest);
    sql
      .prepare(
        'INSERT INTO phone_identities VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone_hash=excluded.phone_hash,phone_ciphertext=excluded.phone_ciphertext,masked=excluded.masked,verified_at=excluded.verified_at',
      )
      .run(
        uid,
        digest,
        crypto.seal({ phone }, `phone-identity\0${uid}\0${digest}`),
        `+86 ${phone.slice(3, 6)}••••${phone.slice(-4)}`,
        at(),
        at(),
      );
  }
  function revokePhoneProofs(phoneHash: string) {
    // A login challenge must never follow a number to a different account owner.
    sql
      .prepare(
        "UPDATE sms_challenges SET revoked_at=?,code_hash='',phone_ciphertext='' WHERE phone_hash=? AND purpose='login' AND consumed_at IS NULL AND revoked_at IS NULL",
      )
      .run(at(), phoneHash);
    sql
      .prepare(
        "UPDATE sms_deliveries SET status='cancelled',payload_ciphertext=NULL,lease_owner=NULL,lease_until=NULL,error_code='PHONE_IDENTITY_CHANGED',updated_at=? WHERE challenge_id IN(SELECT id FROM sms_challenges WHERE phone_hash=? AND purpose='login' AND revoked_at IS NOT NULL) AND status<>'accepted'",
      )
      .run(at(), phoneHash);
    const registrations = sql
      .prepare(
        "SELECT id,identity_hash,identity_ciphertext FROM identity_registrations WHERE provider='sms' AND consumed_at IS NULL AND identity_ciphertext IS NOT NULL AND expires_at>?",
      )
      .all(at()) as { id: string; identity_hash: string; identity_ciphertext: string }[];
    for (const row of registrations) {
      let phone: string;
      try {
        phone = phoneIdentitySchema.parse(
          crypto.open(
            row.identity_ciphertext,
            `identity-registration\0${row.id}\0sms\0${row.identity_hash}`,
          ),
        ).phone;
      } catch {
        continue;
      }
      if (crypto.digest('phone', phone) === phoneHash)
        sql
          .prepare(
            'UPDATE identity_registrations SET consumed_at=?,identity_ciphertext=NULL WHERE id=?',
          )
          .run(at(), row.id);
    }
  }
  function pending(
    provider: 'sms' | 'wechat',
    identity: { phone: string } | WechatIdentity,
    browser: string,
  ) {
    const id = randomUUID(),
      digest = crypto.digest(`registration:${provider}`, JSON.stringify(identity));
    sql
      .prepare('INSERT INTO identity_registrations VALUES(?,?,?,?,?,?,?,NULL)')
      .run(
        id,
        provider,
        crypto.seal(identity, `identity-registration\0${id}\0${provider}\0${digest}`),
        digest,
        browserHash(browser),
        at(),
        new Date(clock().getTime() + 600_000).toISOString(),
      );
    return { registrationId: id };
  }
  function signIn(uid: string) {
    const actor = actorFor(uid);
    return {
      authenticated: true as const,
      ...core.auth.me(actor),
      sessionToken: core.auth.session(uid),
    };
  }
  function verifySms(raw: unknown, browser: string, ip: string, current?: IdentitySession | null) {
    const input = SmsVerifySchema.parse(raw);
    ready('sms');
    const result = atomic(() => {
      bucket('sms-verify-ip', ip, 30, 900_000);
      const row = sql.prepare('SELECT * FROM sms_challenges WHERE id=?').get(input.challengeId) as
        Challenge | undefined;
      if (
        !row ||
        row.revoked_at ||
        row.consumed_at ||
        row.verified_at ||
        row.expires_at <= at() ||
        row.attempts >= 5 ||
        row.browser_hash !== browserHash(browser)
      )
        return { error: invalid() };
      if (row.user_id) session(current, row);
      const delivery = sql
        .prepare('SELECT status FROM sms_deliveries WHERE challenge_id=?')
        .get(row.id) as { status: string } | undefined;
      if (!delivery || !['accepted', 'reconciliation_required'].includes(delivery.status))
        return {
          error: new AppError(409, 'SMS_NOT_ACCEPTED', '短信尚未受理或已失败，请稍后重新申请'),
        };
      const expected = crypto.digest('sms-code', `${row.id}\0${row.phone_hash}\0${input.code}`);
      if (!crypto.equals(row.code_hash, expected)) {
        sql
          .prepare(
            'UPDATE sms_challenges SET attempts=attempts+1,revoked_at=CASE WHEN attempts>=4 THEN ? ELSE revoked_at END WHERE id=?',
          )
          .run(at(), row.id);
        return { error: invalid() };
      }
      const phone = phoneIdentitySchema.parse(
        crypto.open(row.phone_ciphertext, `sms-phone\0${row.id}\0${row.phone_hash}`),
      ).phone;
      if (row.purpose === 'change-old') {
        if (phoneRow(row.user_id!)?.phone_hash !== row.phone_hash) return { error: invalid() };
        sql.prepare('UPDATE sms_challenges SET verified_at=? WHERE id=?').run(at(), row.id);
        return { verified: true as const, challengeId: row.id };
      }
      if (row.purpose === 'change-new') oldProof(row.old_challenge_id!, browser, current);
      if (row.purpose === 'login') {
        sql
          .prepare('UPDATE sms_challenges SET consumed_at=?,verified_at=? WHERE id=?')
          .run(at(), at(), row.id);
        const identity = sql
          .prepare('SELECT user_id FROM phone_identities WHERE phone_hash=?')
          .get(row.phone_hash) as { user_id: string } | undefined;
        return identity ? signIn(identity.user_id) : pending('sms', { phone }, browser);
      }
      bindPhone(row.user_id!, phone, row.purpose === 'change-new');
      sql
        .prepare('UPDATE sms_challenges SET consumed_at=?,verified_at=? WHERE id=?')
        .run(at(), at(), row.id);
      if (row.old_challenge_id)
        sql
          .prepare('UPDATE sms_challenges SET consumed_at=? WHERE id=?')
          .run(at(), row.old_challenge_id);
      revokeOtherSessions(row.user_id!, row.session_hash!);
      return { linked: true as const };
    });
    if ('error' in result) throw result.error;
    return result;
  }
  function getGateway() {
    ready('wechat');
    return (wechatGateway ??= createWechatGateway({
      appId: config.wechat!.appId!,
      appSecret: config.wechat!.appSecret!,
      redirectUri: new URL(WECHAT_CALLBACK, origin.origin).href,
    }));
  }
  async function startWechat(
    browser: string,
    ip: string,
    current?: IdentitySession | null,
    raw?: unknown,
  ) {
    const gateway = getGateway();
    if (raw !== undefined) atomic(() => bucket('identity-password-ip', ip, 10, 900_000));
    const proof =
      raw === undefined
        ? undefined
        : await confirm(current, IdentityPasswordSchema.parse(raw).password);
    return atomic(() => {
      sms.cleanup();
      bucket('wechat-start-ip', ip, 20, 900_000);
      if (proof)
        session(current, {
          user_id: proof.row.id,
          session_hash: proof.digest,
          password_revision: proof.row.password_revision,
        });
      const id = randomUUID(),
        state = token(),
        expires = new Date(clock().getTime() + 600_000).toISOString();
      sql
        .prepare(
          "INSERT INTO wechat_auth_flows(id,state_hash,browser_hash,intent,user_id,session_hash,password_revision,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,'pending')",
        )
        .run(
          id,
          crypto.digest('wechat-state', state),
          browserHash(browser),
          proof ? 'link' : 'login',
          proof?.row.id ?? null,
          proof?.digest ?? null,
          proof?.row.password_revision ?? null,
          at(),
          expires,
        );
      return { authorizationUrl: gateway.authorize(state), expiresAt: expires };
    });
  }
  function bindWechat(uid: string, identity: WechatIdentity) {
    const conflict = sql
      .prepare(
        'SELECT user_id FROM wechat_identities WHERE app_id=? AND (openid=? OR (? IS NOT NULL AND unionid=?))',
      )
      .get(identity.appId, identity.openid, identity.unionid, identity.unionid) as
      { user_id: string } | undefined;
    const own = sql
      .prepare('SELECT openid,app_id FROM wechat_identities WHERE user_id=?')
      .get(uid) as { openid: string; app_id: string } | undefined;
    if (
      (conflict && conflict.user_id !== uid) ||
      (own && (own.openid !== identity.openid || own.app_id !== identity.appId))
    )
      throw new AppError(
        409,
        'IDENTITY_ALREADY_LINKED',
        '此身份或账户已有其他关联，请先登录原账户处理',
      );
    sql
      .prepare(
        'INSERT INTO wechat_identities VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_login_at=excluded.last_login_at',
      )
      .run(uid, identity.appId, identity.openid, identity.unionid, at(), at());
  }
  async function completeWechat(raw: unknown, browser: string, current?: IdentitySession | null) {
    const input = z
      .object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(4096) })
      .strict()
      .parse(raw);
    const gateway = getGateway();
    const flow = atomic(() => {
      const row = sql
        .prepare('SELECT * FROM wechat_auth_flows WHERE state_hash=?')
        .get(crypto.digest('wechat-state', input.state)) as Flow | undefined;
      if (
        !row ||
        row.status !== 'pending' ||
        row.expires_at <= at() ||
        row.browser_hash !== browserHash(browser)
      )
        throw invalid();
      if (row.intent === 'link') session(current, row);
      sql
        .prepare(
          "UPDATE wechat_auth_flows SET status='exchanging',consumed_at=? WHERE id=? AND status='pending'",
        )
        .run(at(), row.id);
      return row;
    });
    try {
      const identity = wechatIdentitySchema.parse(await gateway.exchange(input.code));
      if (identity.appId !== config.wechat!.appId) throw invalid();
      return atomic(() => {
        const active = sql
          .prepare(
            "SELECT id FROM wechat_auth_flows WHERE id=? AND status='exchanging' AND expires_at>?",
          )
          .get(flow.id, at());
        if (!active) throw invalid();
        let result;
        if (flow.intent === 'link') {
          session(current, flow);
          bindWechat(flow.user_id!, identity);
          revokeOtherSessions(flow.user_id!, flow.session_hash!);
          result = { linked: true as const };
        } else {
          const linked = sql
            .prepare('SELECT user_id,unionid FROM wechat_identities WHERE app_id=? AND openid=?')
            .get(identity.appId, identity.openid) as
            { user_id: string; unionid: string | null } | undefined;
          if (linked && linked.unionid && identity.unionid && linked.unionid !== identity.unionid)
            throw invalid();
          if (linked) {
            bindWechat(linked.user_id, identity);
            result = signIn(linked.user_id);
          } else {
            const duplicate =
              identity.unionid &&
              sql
                .prepare('SELECT 1 FROM wechat_identities WHERE app_id=? AND unionid=?')
                .get(identity.appId, identity.unionid);
            if (duplicate)
              throw new AppError(
                409,
                'IDENTITY_ALREADY_LINKED',
                '微信标识发生冲突，请登录原账户处理',
              );
            result = pending('wechat', identity, browser);
          }
        }
        sql.prepare("UPDATE wechat_auth_flows SET status='succeeded' WHERE id=?").run(flow.id);
        return result;
      });
    } catch (error) {
      sql
        .prepare(
          "UPDATE wechat_auth_flows SET status='failed',error_code=? WHERE id=? AND status='exchanging'",
        )
        .run(
          error instanceof AppError && /^[A-Z0-9_]{1,80}$/.test(error.code)
            ? error.code
            : 'WECHAT_VERIFICATION_FAILED',
          flow.id,
        );
      throw error;
    }
  }
  function registration(id: string, browser: string) {
    const row = sql.prepare('SELECT * FROM identity_registrations WHERE id=?').get(id) as
      | {
          id: string;
          provider: 'sms' | 'wechat';
          identity_ciphertext: string | null;
          identity_hash: string;
          browser_hash: string;
          expires_at: string;
          consumed_at: string | null;
        }
      | undefined;
    if (
      !row ||
      row.consumed_at ||
      !row.identity_ciphertext ||
      row.expires_at <= at() ||
      row.browser_hash !== browserHash(browser)
    )
      throw invalid();
    return row;
  }
  async function register(raw: unknown, browser: string) {
    const input = IdentityRegistrationSchema.parse(raw),
      before = registration(input.registrationId, browser);
    ready(before.provider);
    const passwordHash = await hashPassword(input.password);
    return atomic(() => {
      const row = registration(input.registrationId, browser);
      if (
        sql
          .prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE')
          .get(input.email.trim().toLowerCase())
      )
        throw new AppError(
          409,
          'IDENTITY_LINK_REQUIRED',
          '此邮箱已有账户，请先登录，再在设置中显式绑定',
        );
      const identity = crypto.open(
        row.identity_ciphertext!,
        `identity-registration\0${row.id}\0${row.provider}\0${row.identity_hash}`,
      );
      const result = core.auth.registerVerifiedProfile({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
        inviteToken: input.inviteToken,
        referralCode: input.referralCode,
      });
      if (row.provider === 'sms')
        bindPhone(result.user.id, phoneIdentitySchema.parse(identity).phone, false);
      else bindWechat(result.user.id, wechatIdentitySchema.parse(identity));
      sql.prepare('UPDATE users SET email_verified=0 WHERE id=?').run(result.user.id);
      sql
        .prepare(
          'UPDATE identity_registrations SET consumed_at=?,identity_ciphertext=NULL WHERE id=?',
        )
        .run(at(), row.id);
      return { authenticated: true as const, ...result };
    });
  }
  async function unlink(
    channel: 'sms' | 'wechat',
    raw: unknown,
    current: IdentitySession,
    ip = 'internal',
  ) {
    atomic(() => bucket('identity-password-ip', ip, 10, 900_000));
    const proof = await confirm(current, IdentityPasswordSchema.parse(raw).password);
    return atomic(() => {
      session(current, {
        user_id: proof.row.id,
        session_hash: proof.digest,
        password_revision: proof.row.password_revision,
      });
      // Reconfirmation proves the remaining local credential is usable, including Google-only guards.
      if (proof.row.local_password_enabled !== 1)
        throw new AppError(409, 'LAST_LOGIN_METHOD', '请先设置可用的本地密码');
      if (channel === 'sms') {
        const phone = phoneRow(proof.row.id);
        if (phone) revokePhoneProofs(phone.phone_hash);
      }
      sql
        .prepare(
          `DELETE FROM ${channel === 'sms' ? 'phone_identities' : 'wechat_identities'} WHERE user_id=?`,
        )
        .run(proof.row.id);
      revokeOtherSessions(proof.row.id, proof.digest);
      return { unlinked: true as const };
    });
  }
  return {
    publicOrigin: origin.origin,
    secureCookie: origin.protocol === 'https:',
    status,
    sms,
    requestSms,
    verifySms,
    startWechat,
    completeWechat,
    register,
    unlink,
    registrationInfo(id: string, browser: string) {
      const row = registration(z.string().uuid().parse(id), browser);
      return { registrationId: row.id, provider: row.provider, emailVerified: false as const };
    },
  };
}
export type IdentityAuthService = ReturnType<typeof createIdentityAuthService>;

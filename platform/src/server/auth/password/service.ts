import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Actor } from '../../../contracts/core';
import {
  PasswordCompleteInputSchema,
  PasswordForgotInputSchema,
  type PasswordRecoveryStatus,
} from '../../../contracts/password-auth';
import type { AppConfig } from '../../config';
import type { DatabaseContext } from '../../db/connection';
import { AppError } from '../../errors';
import { hashPassword } from '../../core/auth';
import { hash, token } from '../../core/shared';
import { createAccountMailOutbox, type PasswordRequest } from './outbox';

export interface PasswordSession {
  actor: Actor;
  sessionToken: string;
}
interface User {
  id: string;
  email: string;
  password_revision: number;
  local_password_enabled: number;
}
export function createPasswordRecoveryService(
  db: DatabaseContext,
  config: AppConfig,
  options: {
    now?: () => Date;
    derivePassword?: typeof hashPassword;
    responseDelayMs?: number;
  } = {},
) {
  const sql = db.sqlite;
  const clock = options.now ?? (() => new Date());
  const derive = options.derivePassword ?? hashPassword;
  const at = () => clock().toISOString();
  const mail = createAccountMailOutbox(
    db,
    { ...config, smtp: config.passwordRecoveryEnabled ? config.smtp : { enabled: false } },
    clock,
  );
  if (config.passwordRecoveryEnabled && !mail.smtp.enabled)
    throw new Error('Password recovery requires explicitly enabled SMTP.');
  if (config.passwordRecoveryEnabled) {
    const url = new URL(config.publicOrigin);
    if (
      !config.encryptionKey ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !['http:', 'https:'].includes(url.protocol) ||
      (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      throw new Error(
        'Password recovery requires a canonical HTTPS public origin, except loopback.',
      );
  }
  const enabled = !!config.passwordRecoveryEnabled && mail.smtp.enabled;
  const user = (uid: string) =>
    sql
      .prepare('SELECT id,email,password_revision,local_password_enabled FROM users WHERE id=?')
      .get(uid) as User | undefined;
  const invalid = () => new AppError(400, 'PASSWORD_LINK_INVALID', '链接已失效，请重新申请');
  function ready() {
    if (!enabled)
      throw new AppError(
        503,
        'PASSWORD_RECOVERY_DISABLED',
        '此实例尚未启用邮件密码恢复，请使用已有登录方式',
      );
  }
  function session(current?: PasswordSession | null) {
    if (
      !current ||
      current.actor.authType !== 'session' ||
      !current.sessionToken ||
      !sql
        .prepare(
          'SELECT id FROM sessions WHERE token_hash=? AND user_id=? AND revoked_at IS NULL AND expires_at>?',
        )
        .get(hash(current.sessionToken), current.actor.userId, at())
    )
      throw new AppError(
        401,
        'PASSWORD_SESSION_REQUIRED',
        '请在发起设置的同一浏览器登录会话中打开链接，或重新登录并申请',
      );
    return hash(current.sessionToken);
  }
  function linked(uid: string) {
    return !!sql
      .prepare("SELECT id FROM external_identities WHERE provider='google' AND user_id=?")
      .get(uid);
  }
  function status(actor?: Actor | null): PasswordRecoveryStatus {
    const row = actor?.authType === 'session' ? user(actor.userId) : undefined;
    const masked = row?.email.replace(/^(.).*(@.*)$/, '$1•••$2');
    return {
      enabled,
      disabledReason: enabled
        ? null
        : config.passwordRecoveryEnabled
          ? 'smtp-disabled'
          : 'disabled',
      ...(row
        ? {
            hasLocalPassword: row.local_password_enabled === 1,
            canSetLocalPassword: enabled && row.local_password_enabled === 0 && linked(row.id),
            deliveryEmail: masked,
          }
        : {}),
    };
  }
  function bucket(scope: string, value: string, max: number, period: number, cooldown = 0) {
    const time = clock().getTime();
    const key = createHmac('sha256', config.encryptionKey)
      .update(`password-rate-v1\0${scope}\0${value}`)
      .digest('hex');
    const old = sql
      .prepare(
        'SELECT window_start,attempts,last_allowed_at FROM password_request_limits WHERE bucket_key=?',
      )
      .get(key) as { window_start: number; attempts: number; last_allowed_at: number } | undefined;
    const active = old && old.window_start + period > time;
    if (active && (old.attempts >= max || old.last_allowed_at + cooldown > time)) return false;
    sql
      .prepare(
        'INSERT INTO password_request_limits VALUES(?,?,?,?,?) ON CONFLICT(bucket_key) DO UPDATE SET window_start=excluded.window_start,attempts=excluded.attempts,last_allowed_at=excluded.last_allowed_at,expires_at=excluded.expires_at',
      )
      .run(
        key,
        active ? old.window_start : time,
        active ? old.attempts + 1 : 1,
        time,
        time + period,
      );
    return true;
  }
  function limits(email: string, ip: string) {
    sql.prepare('DELETE FROM password_request_limits WHERE expires_at<=?').run(clock().getTime());
    if (!bucket('ip', ip, 10, 900_000))
      throw new AppError(429, 'PASSWORD_REQUEST_LIMIT', '请求过于频繁，请稍后重试');
    if (!bucket('email-minute', email, 1, 60_000, 60_000)) return false;
    return bucket('email-hour', email, 3, 3600_000);
  }
  function expire() {
    sql
      .prepare(
        'UPDATE password_requests SET revoked_at=? WHERE expires_at<=? AND consumed_at IS NULL AND revoked_at IS NULL',
      )
      .run(at(), at());
    mail.cleanup();
  }
  function insert(
    row: User,
    purpose: PasswordRequest['purpose'],
    rawToken: string,
    sessionHash: string | null,
  ) {
    const request: PasswordRequest = {
      id: randomUUID(),
      user_id: row.id,
      purpose,
      token_hash: hash(rawToken),
      email_snapshot: row.email,
      password_revision: row.password_revision,
      session_token_hash: sessionHash,
      created_at: at(),
      expires_at: new Date(clock().getTime() + 1800_000).toISOString(),
      consumed_at: null,
      revoked_at: null,
    };
    sql
      .prepare('INSERT INTO password_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        request.id,
        request.user_id,
        request.purpose,
        request.token_hash,
        request.email_snapshot,
        request.password_revision,
        request.session_token_hash,
        request.created_at,
        request.expires_at,
        null,
        null,
      );
    mail.enqueue(request, 'password-request', rawToken);
  }
  async function requestReset(raw: unknown, ip: string) {
    const input = PasswordForgotInputSchema.parse(raw);
    ready();
    const started = performance.now();
    try {
      const secret = token();
      const email = input.email.toLowerCase();
      sql
        .transaction(() => {
          expire();
          const allowed = limits(email, ip);
          const row = sql
            .prepare(
              'SELECT id,email,password_revision,local_password_enabled FROM users WHERE email=?',
            )
            .get(email) as User | undefined;
          if (allowed && row?.local_password_enabled === 1) insert(row, 'reset', secret, null);
        })
        .immediate();
      return { accepted: true as const };
    } finally {
      await delay(Math.max(0, (options.responseDelayMs ?? 250) - (performance.now() - started)));
    }
  }
  async function requestSetup(current: PasswordSession, ip: string) {
    ready();
    const secret = token();
    return sql
      .transaction(() => {
        const sessionHash = session(current);
        const row = user(current.actor.userId);
        if (!row || row.local_password_enabled !== 0 || !linked(row.id))
          throw new AppError(409, 'LOCAL_PASSWORD_SETUP_UNAVAILABLE', '此账户无需设置首个本地密码');
        expire();
        if (limits(row.email, ip)) insert(row, 'setup', secret, sessionHash);
        return { accepted: true as const };
      })
      .immediate();
  }
  function validate(request: PasswordRequest | undefined, current?: PasswordSession | null) {
    if (!request || request.consumed_at || request.revoked_at || request.expires_at <= at())
      throw invalid();
    const row = user(request.user_id);
    if (
      !row ||
      row.email !== request.email_snapshot ||
      row.password_revision !== request.password_revision ||
      row.local_password_enabled !== (request.purpose === 'reset' ? 1 : 0)
    )
      throw invalid();
    if (request.purpose === 'setup') {
      if (
        session(current) !== request.session_token_hash ||
        current?.actor.userId !== row.id ||
        !linked(row.id)
      )
        throw invalid();
    }
    return request;
  }
  async function complete(raw: unknown, current?: PasswordSession | null) {
    const input = PasswordCompleteInputSchema.parse(raw);
    ready();
    const find = () =>
      sql.prepare('SELECT * FROM password_requests WHERE token_hash=?').get(hash(input.token)) as
        PasswordRequest | undefined;
    validate(find(), current);
    const passwordHash = await derive(input.newPassword);
    return sql
      .transaction(() => {
        const request = validate(find(), current);
        if (
          sql
            .prepare(
              'UPDATE password_requests SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL',
            )
            .run(at(), request.id).changes !== 1
        )
          throw invalid();
        if (
          sql
            .prepare(
              'UPDATE users SET password_hash=?,local_password_enabled=1,password_revision=password_revision+1,updated_at=? WHERE id=? AND password_revision=?',
            )
            .run(passwordHash, at(), request.user_id, request.password_revision).changes !== 1
        )
          throw invalid();
        sql
          .prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL')
          .run(at(), request.user_id);
        sql
          .prepare(
            'UPDATE password_requests SET revoked_at=? WHERE user_id=? AND id<>? AND consumed_at IS NULL AND revoked_at IS NULL',
          )
          .run(at(), request.user_id, request.id);
        sql
          .prepare(
            "UPDATE google_oidc_flows SET status='expired',encrypted_context='' WHERE user_id=? AND status IN('pending','exchanging')",
          )
          .run(request.user_id);
        mail.cancelRequests(request.user_id);
        mail.enqueue({ ...request, consumed_at: at() }, 'password-changed');
        return { changed: true as const };
      })
      .immediate();
  }
  return { status, requestReset, requestSetup, complete, mail };
}
export type PasswordRecoveryService = ReturnType<typeof createPasswordRecoveryService>;

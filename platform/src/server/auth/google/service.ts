import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  GoogleStartInputSchema,
  GooglePasswordInputSchema,
  GoogleCallbackInputSchema,
  type GoogleStatusDto,
} from '../../../contracts/google-auth';
import type { Actor } from '../../../contracts/core';
import type { DatabaseContext } from '../../db/connection';
import type { CoreServices } from '../../core';
import { hashPassword } from '../../core/auth';
import { hash, now, token } from '../../core/shared';
import { AppError } from '../../errors';
import { createGoogleGateway } from './gateway';
import {
  GOOGLE_CALLBACK_PATH,
  type GoogleServiceConfig,
  type GoogleGateway,
  type GoogleSessionContext,
} from './types';
const contextSchema = GoogleStartInputSchema.extend({ nonce: z.string(), verifier: z.string() });
interface Flow {
  id: string;
  intent: 'login' | 'link';
  user_id: string | null;
  session_token_hash: string | null;
  encrypted_context: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  browser_hash: string;
}
interface IdentityRow {
  id: string;
  user_id: string;
  subject: string;
  email: string;
  created_at: string;
}
const actorFor = (userId: string): Actor => ({
  userId,
  authType: 'session',
  apiKeyId: null,
  workspaceId: null,
  scopes: [],
});
export function createGoogleAuthService(
  db: DatabaseContext,
  core: CoreServices,
  config: GoogleServiceConfig,
  options: { gateway?: GoogleGateway } = {},
) {
  const sql = db.sqlite,
    base = new URL(config.publicOrigin);
  if (
    config.google?.enabled &&
    (base.username ||
      base.password ||
      base.pathname !== '/' ||
      base.search ||
      base.hash ||
      !['http:', 'https:'].includes(base.protocol))
  )
    throw new Error('Google authentication requires a canonical PUBLIC_ORIGIN');
  if (
    config.google?.enabled &&
    base.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  )
    throw new Error('Google authentication requires HTTPS except loopback development');
  const redirectUri = new URL(GOOGLE_CALLBACK_PATH, base.origin).href;
  const key = createHash('sha256').update(`google-oidc\0${config.encryptionKey}`).digest();
  let gateway: GoogleGateway | undefined = options.gateway;
  const atomic = <T>(fn: () => T): T =>
    sql.inTransaction ? fn() : sql.transaction(fn).immediate();
  const configured = () => !!config.google?.clientId && !!config.google?.clientSecret;
  function ready() {
    if (!config.google?.enabled || !configured())
      throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google 登录尚未启用或配置不完整');
    gateway ??= createGoogleGateway({
      clientId: config.google.clientId!,
      clientSecret: config.google.clientSecret!,
      redirectUri,
    });
    return gateway;
  }
  function status(actor?: Actor | null): GoogleStatusDto {
    const identity =
      actor?.authType === 'session'
        ? (sql
            .prepare(
              "SELECT email,created_at FROM external_identities WHERE provider='google' AND user_id=?",
            )
            .get(actor.userId) as { email: string; created_at: string } | undefined)
        : undefined;
    return {
      enabled: !!config.google?.enabled,
      configured: configured(),
      available: !!config.google?.enabled && configured() && !core.auth.status().setupRequired,
      linked: !!identity,
      hasLocalPassword:
        actor?.authType === 'session' &&
        (
          sql.prepare('SELECT local_password_enabled FROM users WHERE id=?').get(actor.userId) as
            { local_password_enabled: number } | undefined
        )?.local_password_enabled === 1,
      identity: identity ? { email: identity.email, linkedAt: identity.created_at } : null,
    };
  }
  function session(context: GoogleSessionContext) {
    if (context.actor.authType !== 'session' || !context.sessionToken)
      throw new AppError(401, 'UNAUTHENTICATED', '需要有效的本地登录会话');
    const h = hash(context.sessionToken),
      row = sql
        .prepare(
          'SELECT id FROM sessions WHERE token_hash=? AND user_id=? AND revoked_at IS NULL AND expires_at>?',
        )
        .get(h, context.actor.userId, now());
    if (!row) throw new AppError(401, 'SESSION_EXPIRED', '登录会话已失效，请重新登录');
    return h;
  }
  function requireLocalPassword(actor: Actor) {
    if (
      (
        sql.prepare('SELECT local_password_enabled FROM users WHERE id=?').get(actor.userId) as
          { local_password_enabled: number } | undefined
      )?.local_password_enabled !== 1
    )
      throw new AppError(
        409,
        'GOOGLE_LOCAL_PASSWORD_REQUIRED',
        '此账户尚无本地密码，不能变更唯一 Google 登录方式',
      );
  }
  function seal(value: unknown, flowId: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(flowId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url')).join('.');
  }
  function open(value: string, flowId: string) {
    try {
      const [iv, tag, data] = value.split('.');
      if (!iv || !tag || !data) throw new Error('Invalid sealed context');
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      cipher.setAAD(Buffer.from(flowId));
      cipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return contextSchema.parse(
        JSON.parse(
          Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString(
            'utf8',
          ),
        ),
      );
    } catch {
      throw new AppError(400, 'GOOGLE_FLOW_INVALID', '登录流程无法恢复，请重新发起');
    }
  }
  function audit(uid: string, action: string, details: Record<string, unknown>) {
    sql
      .prepare('INSERT INTO external_identity_events VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), uid, 'google', action, JSON.stringify(details), now());
  }
  async function begin(
    intent: 'login' | 'link',
    input: z.infer<typeof GoogleStartInputSchema>,
    current?: GoogleSessionContext,
  ) {
    const provider = ready();
    if (core.auth.status().setupRequired)
      throw new AppError(403, 'LOCAL_SETUP_ONLY', '请先从本机完成首位管理员密码注册');
    const sessionHash = current ? session(current) : null,
      id = randomUUID(),
      state = token(),
      browserToken = token(),
      nonce = token(),
      verifier = token();
    const authorizationUrl = await provider.authorize({
      state,
      nonce,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const createdAt = now(),
      expiresAt = new Date(Date.now() + (intent === 'link' ? 300_000 : 600_000)).toISOString();
    atomic(() => {
      if (current) session(current);
      sql
        .prepare(
          "UPDATE google_oidc_flows SET status='expired',encrypted_context='' WHERE expires_at<=? AND status='pending'",
        )
        .run(createdAt);
      sql
        .prepare('DELETE FROM google_oidc_flows WHERE expires_at<?')
        .run(new Date(Date.now() - 86400_000).toISOString());
      sql
        .prepare(
          "INSERT INTO google_oidc_flows(id,state_hash,browser_hash,intent,user_id,session_token_hash,encrypted_context,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,'pending')",
        )
        .run(
          id,
          hash(state),
          hash(browserToken),
          intent,
          current?.actor.userId ?? null,
          sessionHash,
          seal({ ...input, nonce, verifier }, id),
          createdAt,
          expiresAt,
        );
    });
    return { authorizationUrl, browserToken, expiresAt };
  }
  async function start(raw: unknown) {
    return begin('login', GoogleStartInputSchema.parse(raw));
  }
  async function startLink(current: GoogleSessionContext, raw: unknown) {
    ready();
    const input = GooglePasswordInputSchema.parse(raw);
    session(current);
    requireLocalPassword(current.actor);
    await core.auth.confirmPassword(current.actor, input.password);
    return begin('link', {}, current);
  }
  async function complete(raw: unknown, browserToken: string | undefined, currentToken?: string) {
    const provider = ready(),
      input = GoogleCallbackInputSchema.parse(raw);
    const flow = atomic(() => {
      const value = sql
        .prepare('SELECT * FROM google_oidc_flows WHERE state_hash=?')
        .get(hash(input.state)) as Flow | undefined;
      if (
        !value ||
        value.consumed_at ||
        value.expires_at <= now() ||
        !browserToken ||
        value.browser_hash !== hash(browserToken)
      )
        throw new AppError(400, 'GOOGLE_STATE_INVALID', 'Google 登录流程已失效或不属于此浏览器');
      const context = open(value.encrypted_context, value.id);
      if (value.intent === 'link') {
        if (!currentToken || hash(currentToken) !== value.session_token_hash)
          throw new AppError(401, 'SESSION_EXPIRED', '关联必须使用原来的已确认会话');
        session({ actor: actorFor(value.user_id!), sessionToken: currentToken });
      }
      const consumed = sql
        .prepare(
          "UPDATE google_oidc_flows SET consumed_at=?,status='exchanging',encrypted_context='' WHERE id=? AND consumed_at IS NULL",
        )
        .run(now(), value.id);
      if (consumed.changes !== 1) throw new AppError(409, 'GOOGLE_FLOW_REPLAY', '此登录流程已使用');
      return { ...value, context };
    });
    try {
      if (input.error) throw new AppError(400, 'GOOGLE_CANCELLED', 'Google 授权未完成，请重新发起');
      const identity = await provider.exchange({
        code: input.code!,
        nonce: flow.context.nonce,
        verifier: flow.context.verifier,
        createdAt: flow.created_at,
      });
      const passwordHash = await hashPassword(randomBytes(48).toString('base64url'));
      return atomic(() => {
        if (flow.expires_at <= now())
          throw new AppError(400, 'GOOGLE_FLOW_EXPIRED', 'Google 登录流程已过期，请重新发起');
        const existing = sql
          .prepare(
            "SELECT * FROM external_identities WHERE issuer=? AND subject=? AND provider='google'",
          )
          .get(identity.issuer, identity.subject) as IdentityRow | undefined;
        let uid: string, sessionToken: string | undefined;
        if (flow.intent === 'link') {
          const current = { actor: actorFor(flow.user_id!), sessionToken: currentToken! };
          session(current);
          const bound = sql
            .prepare("SELECT * FROM external_identities WHERE user_id=? AND provider='google'")
            .get(flow.user_id) as IdentityRow | undefined;
          if (
            (existing && existing.user_id !== flow.user_id) ||
            (bound && bound.subject !== identity.subject)
          )
            throw new AppError(
              409,
              'GOOGLE_IDENTITY_CONFLICT',
              '此 Google 身份或本地账户已有其他关联',
            );
          const collision = sql
            .prepare('SELECT id FROM users WHERE email=? AND id<>?')
            .get(identity.email, flow.user_id);
          if (collision)
            throw new AppError(
              409,
              'GOOGLE_EMAIL_LINK_REQUIRED',
              '此邮箱属于另一本地账户，请先登录该账户处理关联',
            );
          uid = flow.user_id!;
        } else if (existing) {
          uid = existing.user_id;
          if (flow.context.inviteToken)
            core.team.accept(actorFor(uid), { token: flow.context.inviteToken });
          sessionToken = core.auth.session(uid);
        } else {
          if (sql.prepare('SELECT id FROM users WHERE email=?').get(identity.email))
            throw new AppError(
              409,
              'GOOGLE_EMAIL_LINK_REQUIRED',
              '此邮箱已有本地账户，请先使用本地密码登录并明确关联 Google',
            );
          if (core.auth.status().setupRequired)
            throw new AppError(403, 'LOCAL_SETUP_ONLY', '请先从本机创建管理员');
          const created = core.auth.registerVerifiedProfile({
            email: identity.email,
            displayName: identity.displayName,
            passwordHash,
            inviteToken: flow.context.inviteToken,
            referralCode: flow.context.referralCode,
          });
          uid = created.user.id;
          sql.prepare('UPDATE users SET local_password_enabled=0 WHERE id=?').run(uid);
          sessionToken = created.sessionToken;
        }
        if (existing)
          sql
            .prepare('UPDATE external_identities SET email=?,last_login_at=? WHERE id=?')
            .run(identity.email, now(), existing.id);
        else
          sql
            .prepare("INSERT INTO external_identities VALUES(?,'google',?,?,?,?,?,?)")
            .run(
              randomUUID(),
              identity.issuer,
              identity.subject,
              uid,
              identity.email,
              now(),
              now(),
            );
        sql.prepare("UPDATE google_oidc_flows SET status='succeeded' WHERE id=?").run(flow.id);
        audit(uid, flow.intent === 'link' ? 'identity.linked' : 'identity.login', {
          flowId: flow.id,
        });
        return { intent: flow.intent, sessionToken, userId: uid };
      });
    } catch (error) {
      sql
        .prepare("UPDATE google_oidc_flows SET status='failed',error_code=? WHERE id=?")
        .run(error instanceof AppError ? error.code : 'GOOGLE_AUTH_FAILED', flow.id);
      throw error;
    }
  }
  async function unlink(current: GoogleSessionContext, raw: unknown) {
    const input = GooglePasswordInputSchema.parse(raw);
    session(current);
    requireLocalPassword(current.actor);
    await core.auth.confirmPassword(current.actor, input.password);
    return atomic(() => {
      session(current);
      const removed = sql
        .prepare("DELETE FROM external_identities WHERE provider='google' AND user_id=?")
        .run(current.actor.userId);
      if (removed.changes) {
        core.auth.revokeOtherSessions(current.actor, current.sessionToken);
        audit(current.actor.userId, 'identity.unlinked', {});
      }
      return { unlinked: true };
    });
  }
  return {
    status,
    start,
    startLink,
    complete,
    unlink,
    redirectUri,
    publicOrigin: base.origin,
    secureCookie: config.isProduction || base.protocol === 'https:',
  };
}
export type GoogleAuthService = ReturnType<typeof createGoogleAuthService>;

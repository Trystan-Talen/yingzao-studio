import { EntitlementService } from './entitlements';
import { ReferralService } from './referrals';
import '@fastify/cookie';
import '@fastify/multipart';
import { scrypt as nodeScrypt, timingSafeEqual, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors';
import {
  PreferencesSchema,
  RegisterInputSchema,
  LoginInputSchema,
  UpdateMeInputSchema,
  type Actor,
  type UserDto,
  type WorkspaceDto,
} from '../../contracts/core';
import { CoreContext, type Row, now, id, token, hash, str, nullable, json } from './shared';
const scrypt = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    nodeScrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))),
  );
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt)).toString('hex')}`;
}
async function matches(password: string, value: string): Promise<boolean> {
  const [salt, expected] = value.split(':');
  if (!salt || !expected) return false;
  const actual = await scrypt(password, salt),
    stored = Buffer.from(expected, 'hex');
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}
export interface AuthResult {
  user: UserDto;
  workspaces: WorkspaceDto[];
  activeWorkspaceId: string | null;
}
export class AuthService {
  constructor(private c: CoreContext) {}
  user(row: Row): UserDto {
    return {
      id: str(row, 'id'),
      email: str(row, 'email'),
      displayName: str(row, 'display_name'),
      avatarAssetId: nullable(row, 'avatar_asset_id'),
      preferences: PreferencesSchema.parse(json(row.preferences_json, {})),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
    };
  }
  workspace(row: Row): WorkspaceDto {
    return {
      id: str(row, 'id'),
      name: str(row, 'name'),
      kind: str(row, 'kind') as WorkspaceDto['kind'],
      role: str(row, 'role') as WorkspaceDto['role'],
      isDemo: !!row.is_demo,
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
    };
  }
  status(): { setupRequired: boolean; registrationEnabled: boolean } {
    const setupRequired = !this.c.get('SELECT id FROM users LIMIT 1');
    const url = new URL(this.c.config.publicOrigin);
    return {
      setupRequired,
      registrationEnabled:
        setupRequired && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    };
  }
  listWorkspaces(actor: Actor): WorkspaceDto[] {
    return this.c
      .all(
        'SELECT w.*,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? AND w.archived_at IS NULL ORDER BY w.created_at,w.id',
        actor.userId,
      )
      .map((r) => this.workspace(r));
  }
  me(actor: Actor): AuthResult {
    const row = this.c.get('SELECT * FROM users WHERE id=?', actor.userId);
    if (!row) throw new AppError(401, 'UNAUTHENTICATED', '请重新登录');
    const workspaces = this.listWorkspaces(actor);
    const activeWorkspaceId = workspaces.some((w) => w.id === row.active_workspace_id)
      ? str(row, 'active_workspace_id')
      : (workspaces[0]?.id ?? null);
    return { user: this.user(row), workspaces, activeWorkspaceId };
  }
  createWorkspace(
    userId: string,
    name: string,
    kind: 'personal' | 'team',
    isDemo = false,
  ): WorkspaceDto {
    const wid = id(),
      date = now();
    this.c.run(
      'INSERT INTO workspaces(id,name,kind,is_demo,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      wid,
      name,
      kind,
      isDemo ? 1 : 0,
      userId,
      date,
      date,
    );
    this.c.run(
      'INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      id(),
      wid,
      userId,
      'owner',
      date,
      date,
    );
    this.c.hooks.onWorkspaceCreated?.(wid, userId);
    return this.workspace({
      ...this.c.get('SELECT * FROM workspaces WHERE id=?', wid)!,
      role: 'owner',
    });
  }
  async register(
    raw: unknown,
  ): Promise<{ user: UserDto; workspace: WorkspaceDto; sessionToken: string }> {
    const input = RegisterInputSchema.parse(raw),
      passwordHash = await hashPassword(input.password);
    return this.registerVerifiedProfile({ ...input, passwordHash });
  }
  // Trusted authentication adapters only. User input still passes the registration schema;
  // passwordHash is derived locally, never accepted from an HTTP request.
  registerVerifiedProfile(raw: {
    email: string;
    displayName: string;
    passwordHash: string;
    inviteToken?: string;
    referralCode?: string;
  }): { user: UserDto; workspace: WorkspaceDto; sessionToken: string } {
    const { passwordHash, ...profile } = raw;
    const input = RegisterInputSchema.parse({
      ...profile,
      password: 'AdapterInputValidation2026!',
    });
    const email = input.email.trim().toLowerCase();
    return this.c.transaction(() => {
      const invite = input.inviteToken
        ? this.c.get(
            'SELECT i.* FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=? AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND w.archived_at IS NULL',
            hash(input.inviteToken),
            now(),
          )
        : undefined;
      if (input.inviteToken && (!invite || str(invite, 'email').toLowerCase() !== email))
        throw new AppError(400, 'INVALID_INVITATION', '邀请已失效或邮箱不匹配');
      const referral = input.referralCode
        ? new ReferralService(this.c).lookupCode(input.referralCode)
        : null;
      if (!invite && !referral?.registrationEnabled && !this.status().registrationEnabled)
        throw new AppError(403, 'REGISTRATION_CLOSED', '公开注册已关闭，请使用有效团队邀请');
      if (this.c.get('SELECT id FROM users WHERE email=?', email))
        throw new AppError(409, 'EMAIL_EXISTS', '此邮箱已注册，请登录接受邀请');
      const uid = id(),
        date = now();
      this.c.run(
        'INSERT INTO users(id,email,password_hash,display_name,preferences_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        uid,
        email,
        passwordHash,
        input.displayName,
        JSON.stringify(PreferencesSchema.parse({})),
        date,
        date,
      );
      const workspace = this.createWorkspace(
        uid,
        `${input.displayName}的工作空间`,
        'personal',
        this.c.config.demoMode,
      );
      this.c.run('UPDATE users SET active_workspace_id=? WHERE id=?', workspace.id, uid);
      if (invite) {
        new EntitlementService(this.c).assertCreate(
          str(invite, 'workspace_id'),
          'seats',
          str(invite, 'id'),
        );
        this.c.run(
          'INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',
          id(),
          str(invite, 'workspace_id'),
          uid,
          str(invite, 'role'),
          date,
          date,
        );
        this.c.run('UPDATE invitations SET consumed_at=? WHERE id=?', date, str(invite, 'id'));
        if (invite.credit_limit !== null && invite.credit_limit !== undefined) {
          const limit = Number(invite.credit_limit);
          this.c.hooks.onMemberBudgetChanged?.(str(invite, 'workspace_id'), uid, limit);
          this.c.run(
            'UPDATE memberships SET credit_limit=? WHERE workspace_id=? AND user_id=?',
            limit,
            str(invite, 'workspace_id'),
            uid,
          );
        }
      }
      if (input.referralCode) new ReferralService(this.c).attribute(uid, input.referralCode);
      return {
        user: this.user(this.c.get('SELECT * FROM users WHERE id=?', uid)!),
        workspace,
        sessionToken: this.session(uid),
      };
    });
  }
  session(userId: string): string {
    const secret = token(),
      date = now();
    this.c.run(
      'INSERT INTO sessions VALUES (?,?,?,?,?,?,NULL)',
      id(),
      userId,
      hash(secret),
      new Date(Date.now() + 7 * 86400000).toISOString(),
      date,
      date,
    );
    return secret;
  }
  async login(raw: unknown): Promise<AuthResult & { sessionToken: string }> {
    const input = LoginInputSchema.parse(raw);
    const row = this.c.get('SELECT * FROM users WHERE email=?', input.email.trim().toLowerCase());
    const fallback = '00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = await matches(input.password, row ? str(row, 'password_hash') : fallback);
    if (!row || !valid || row.local_password_enabled === 0)
      throw new AppError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
    const actor: Actor = {
      userId: str(row, 'id'),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    return { ...this.me(actor), sessionToken: this.session(actor.userId) };
  }
  async confirmPassword(actor: Actor, password: string): Promise<void> {
    if (actor.authType !== 'session') throw new AppError(403, 'FORBIDDEN', '需要账户会话');
    const row = this.c.get('SELECT * FROM users WHERE id=?', actor.userId);
    const valid = await matches(
      typeof password === 'string' && password.length <= 200 ? password : '',
      row ? str(row, 'password_hash') : '00000000000000000000000000000000:' + '0'.repeat(128),
    );
    if (!row || !valid || row.local_password_enabled === 0)
      throw new AppError(401, 'INVALID_CREDENTIALS', '密码确认未通过，请重新输入');
  }
  async authenticate(request: FastifyRequest): Promise<Actor | null> {
    const authorization = request.headers.authorization;
    if (authorization) {
      if (!authorization.startsWith('Bearer ')) return null;
      const row = this.c.get(
        'SELECT * FROM api_keys WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)',
        hash(authorization.slice(7)),
        now(),
      );
      if (!row) return null;
      const actor: Actor = {
        userId: str(row, 'created_by'),
        authType: 'apiKey',
        apiKeyId: str(row, 'id'),
        workspaceId: str(row, 'workspace_id'),
        scopes: json<string[]>(row.scopes_json, []),
      };
      try {
        this.c.requireAccess(actor, actor.workspaceId!, 'read');
      } catch {
        return null;
      }
      this.c.run('UPDATE api_keys SET last_used_at=? WHERE id=?', now(), actor.apiKeyId);
      return actor;
    }
    const raw = request.cookies?.studio_session;
    if (!raw) return null;
    const row = this.c.get(
      'SELECT * FROM sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?',
      hash(raw),
      now(),
    );
    if (!row) return null;
    return {
      userId: str(row, 'user_id'),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
  }
  logout(secret: string | undefined): void {
    if (secret)
      this.c.run('UPDATE sessions SET revoked_at=? WHERE token_hash=?', now(), hash(secret));
  }
  revokeOtherSessions(actor: Actor, secret: string | undefined): void {
    this.c.run(
      'UPDATE sessions SET revoked_at=? WHERE user_id=? AND token_hash<>?',
      now(),
      actor.userId,
      hash(secret ?? ''),
    );
  }
  update(actor: Actor, raw: unknown): UserDto {
    if (actor.authType !== 'session') throw new AppError(403, 'FORBIDDEN', '需要账户会话');
    const input = UpdateMeInputSchema.parse(raw),
      current = this.me(actor).user;
    if (input.avatarAssetId) {
      const asset = this.c.get(
        'SELECT * FROM assets WHERE id=? AND deleted_at IS NULL',
        input.avatarAssetId,
      );
      if (!asset || asset.kind !== 'image')
        throw new AppError(400, 'INVALID_AVATAR', '头像必须是可访问的图片');
      this.c.requireAccess(actor, str(asset, 'workspace_id'), 'read');
    }
    this.c.run(
      'UPDATE users SET display_name=?,avatar_asset_id=?,preferences_json=?,updated_at=? WHERE id=?',
      input.displayName ?? current.displayName,
      input.avatarAssetId === undefined ? current.avatarAssetId : input.avatarAssetId,
      JSON.stringify({ ...current.preferences, ...input.preferences }),
      now(),
      actor.userId,
    );
    return this.me(actor).user;
  }
}

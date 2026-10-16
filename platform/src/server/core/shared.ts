import { randomUUID, createHash, randomBytes } from 'node:crypto';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import type { Actor, Page, Permission, WorkspaceAccess, Role } from '../../contracts/core';
import type { ExportWatermarkConfig } from '../../contracts/export-policy';
import type { SupportChannelsDto } from '../../contracts/support';
export interface CoreConfig {
  storageDir: string;
  sessionSecret: string;
  publicOrigin: string;
  isProduction: boolean;
  demoMode: boolean;
  exportWatermark?: ExportWatermarkConfig;
  support?: SupportChannelsDto;
}
export interface CoreHooks {
  onInvitationCreated?: (input: {
    workspaceId: string;
    invitationId: string;
    inviteUrl: string;
  }) => { status: string; id?: string };
  onSupportReplyCreated?: (input: {
    workspaceId: string;
    ticketId: string;
    messageId: string;
  }) => void;
  onWorkspaceCreated?: (workspaceId: string, ownerId: string) => void;
  onMemberRemoved?: (workspaceId: string, userId: string) => void;
  onMemberBudgetChanged?: (workspaceId: string, userId: string, creditLimit: number | null) => void;
  canArchiveWorkspace?: (workspaceId: string) => void;
}
export type Row = Record<string, string | number | null>;
export const now = (): string => new Date().toISOString();
export const id = (): string => randomUUID();
export const token = (): string => randomBytes(32).toString('base64url');
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const str = (r: Row, key: string): string => String(r[key] ?? '');
export const nullable = (r: Row, key: string): string | null =>
  r[key] === null || r[key] === undefined ? null : String(r[key]);
export const num = (r: Row, key: string): number => Number(r[key] ?? 0);
export function json<T>(value: string | number | null | undefined, fallback: T): T {
  return value ? (JSON.parse(String(value)) as T) : fallback;
}
export interface ListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  kind?: string;
  favorite?: boolean;
  deleted?: boolean;
  from?: string;
  to?: string;
  projectId?: string;
  tag?: string;
  collectionId?: string;
  visibility?: string;
}
export class CoreContext {
  constructor(
    public db: DatabaseContext,
    public config: CoreConfig,
    public hooks: CoreHooks,
  ) {}
  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.sqlite.prepare(sql).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.db.sqlite.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: unknown[]): void {
    this.db.sqlite.prepare(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    return this.db.sqlite.transaction(fn).immediate();
  }
  requireAccess(actor: Actor, workspaceId: string, permission: Permission): WorkspaceAccess {
    if (
      this.get(
        "SELECT 1 FROM team_provisioning WHERE workspace_id=? AND state='pending'",
        workspaceId,
      )
    )
      throw new AppError(403, 'TEAM_NOT_ACTIVE', '团队会员付款尚未核验，团队内容暂不可用');
    if (
      actor.authType === 'apiKey' &&
      (actor.workspaceId !== workspaceId || permission === 'manage' || permission === 'owner')
    )
      throw new AppError(403, 'FORBIDDEN', 'API密钥没有此空间或管理权限');
    if (
      actor.authType === 'apiKey' &&
      !this.get(
        'SELECT id FROM api_keys WHERE id=? AND created_by=? AND workspace_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)',
        actor.apiKeyId,
        actor.userId,
        workspaceId,
        now(),
      )
    )
      throw new AppError(401, 'API_KEY_REVOKED', 'API密钥已撤销或过期');
    const member = this.get(
      'SELECT m.* FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=? AND w.archived_at IS NULL',
      workspaceId,
      actor.userId,
    );
    if (!member) throw new AppError(403, 'FORBIDDEN', '无权访问此工作空间');
    const role = str(member, 'role') as Role;
    if (
      (permission === 'write' && role === 'viewer') ||
      (permission === 'manage' && !['owner', 'admin'].includes(role)) ||
      (permission === 'owner' && role !== 'owner')
    )
      throw new AppError(403, 'FORBIDDEN', '当前角色无权执行此操作');
    return { workspaceId, userId: actor.userId, membershipId: str(member, 'id'), role };
  }
  // This exception is restricted to order operations. It must never authorize content access.
  requireBillingAccess(actor: Actor, workspaceId: string): void {
    const pending = this.get(
      "SELECT p.user_id FROM team_provisioning p JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=? AND p.state='pending' AND w.archived_at IS NULL",
      workspaceId,
    );
    if (pending) {
      if (actor.authType !== 'session' || pending.user_id !== actor.userId)
        throw new AppError(403, 'FORBIDDEN', '仅预留创建者可处理此团队会员付款');
      return;
    }
    this.requireAccess(actor, workspaceId, 'manage');
  }
  requireScope(actor: Actor, scope: string): void {
    if (actor.authType === 'apiKey' && !actor.scopes.includes(scope))
      throw new AppError(403, 'SCOPE_REQUIRED', `API密钥缺少 ${scope} 权限`);
  }
  resource(
    table:
      | 'projects'
      | 'assets'
      | 'documents'
      | 'brands'
      | 'character_profiles'
      | 'collections'
      | 'orders'
      | 'invoice_titles'
      | 'invoice_requests'
      | 'support_tickets',
    workspaceId: string,
    resourceId: string,
    includeDeleted = false,
  ): Row {
    const softDelete = [
      'projects',
      'assets',
      'brands',
      'character_profiles',
      'collections',
      'invoice_titles',
    ].includes(table);
    const row = this.get(
      `SELECT * FROM ${table} WHERE id=? AND workspace_id=?${softDelete && !includeDeleted ? ' AND deleted_at IS NULL' : ''}`,
      resourceId,
      workspaceId,
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', '内容不存在或已删除');
    return row;
  }
  audit(
    actor: Actor,
    workspaceId: string,
    action: string,
    resourceType: string,
    resourceId: string | null,
    details: Record<string, unknown> = {},
  ): void {
    this.run(
      'INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)',
      id(),
      workspaceId,
      actor.userId,
      action,
      resourceType,
      resourceId,
      JSON.stringify(details),
      now(),
    );
  }
  page<T>(sql: string, params: unknown[], query: ListQuery, map: (row: Row) => T): Page<T> {
    const page = Math.max(1, query.page ?? 1),
      pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
    const total = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM (${sql})`, ...params)?.n ?? 0;
    return {
      items: this.all(`${sql} LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize).map(
        map,
      ),
      total,
      page,
      pageSize,
    };
  }
  favorite(
    actor: Actor,
    workspaceId: string,
    type: 'project' | 'asset',
    resourceId: string,
    value: boolean,
  ): { id: string; isFavorite: boolean } {
    this.requireAccess(actor, workspaceId, 'read');
    this.resource(type === 'project' ? 'projects' : 'assets', workspaceId, resourceId);
    if (value)
      this.run(
        'INSERT OR IGNORE INTO favorites VALUES (?,?,?,?,?)',
        actor.userId,
        workspaceId,
        type,
        resourceId,
        now(),
      );
    else
      this.run(
        'DELETE FROM favorites WHERE user_id=? AND resource_type=? AND resource_id=?',
        actor.userId,
        type,
        resourceId,
      );
    return { id: resourceId, isFavorite: value };
  }
  isFavorite(actor: Actor, type: string, resourceId: string): boolean {
    return !!this.get(
      'SELECT 1 FROM favorites WHERE user_id=? AND resource_type=? AND resource_id=?',
      actor.userId,
      type,
      resourceId,
    );
  }
}

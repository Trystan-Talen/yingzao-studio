import * as inputs from '../../contracts/core';
import {
  InvitationInputSchema,
  MemberPatchSchema,
  type Actor,
  type WorkspaceDto,
} from '../../contracts/core';
import { AppError } from '../errors';
import {
  CoreContext,
  type Row,
  type ListQuery,
  str,
  nullable,
  num,
  id,
  now,
  token,
  hash,
} from './shared';
import { AuthService } from './auth';
import { EntitlementService } from './entitlements';
import { claimTeamSlot, teamSlot } from './team-creation';
export class TeamService {
  constructor(
    private c: CoreContext,
    private auth: AuthService,
  ) {}
  create(actor: Actor, raw: unknown): WorkspaceDto {
    if (actor.authType !== 'session') throw new AppError(403, 'FORBIDDEN', '需要账户会话');
    const { name } = inputs.WorkspaceInputSchema.parse(raw);
    return this.c.transaction(() => {
      if (teamSlot(this.c, actor.userId))
        throw new AppError(
          409,
          'TEAM_SLOT_USED',
          '此账号已占用一个团队名额，请进入已有团队或核对原付款',
        );
      if (!this.c.config.demoMode)
        throw new AppError(
          403,
          'TEAM_MEMBERSHIP_REQUIRED',
          '创建团队需要先购买明确适用于团队的团队会员',
        );
      const workspace = this.auth.createWorkspace(
        actor.userId,
        name,
        'team',
        this.c.config.demoMode,
      );
      this.c.audit(actor, workspace.id, 'workspace.create', 'workspace', workspace.id);
      return workspace;
    });
  }
  update(actor: Actor, wid: string, raw: unknown): WorkspaceDto {
    this.c.requireAccess(actor, wid, 'manage');
    const input = inputs.WorkspacePatchSchema.parse(raw);
    this.c.run(
      'UPDATE workspaces SET name=?,description=COALESCE(?,description),updated_at=? WHERE id=?',
      input.name,
      input.description ?? null,
      now(),
      wid,
    );
    this.c.audit(actor, wid, 'workspace.update', 'workspace', wid);
    return this.auth.listWorkspaces(actor).find((w) => w.id === wid)!;
  }
  activate(actor: Actor, wid: string) {
    this.c.requireAccess(actor, wid, 'read');
    this.c.run(
      'UPDATE users SET active_workspace_id=?,updated_at=? WHERE id=?',
      wid,
      now(),
      actor.userId,
    );
    return { activeWorkspaceId: wid };
  }
  members(actor: Actor, wid: string, q: ListQuery) {
    const access = this.c.requireAccess(actor, wid, 'read');
    return this.c.page(
      'SELECT m.*,u.email,u.display_name,u.avatar_asset_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND (u.display_name LIKE ? OR m.nickname LIKE ?) ORDER BY m.created_at,m.id',
      [wid, `%${q.q ?? ''}%`, `%${q.q ?? ''}%`],
      q,
      (r) => this.member(r, ['owner', 'admin'].includes(access.role) || actor.userId === r.user_id),
    );
  }
  private member(r: Row, includeEmail = true) {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      user: {
        id: str(r, 'user_id'),
        displayName: str(r, 'display_name'),
        email: includeEmail ? str(r, 'email') : null,
        avatarAssetId: nullable(r, 'avatar_asset_id'),
      },
      role: str(r, 'role'),
      status: 'active',
      nickname: str(r, 'nickname'),
      creditLimit: r.credit_limit === null ? null : num(r, 'credit_limit'),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }
  updateMember(actor: Actor, wid: string, mid: string, raw: unknown) {
    const input = MemberPatchSchema.parse(raw);
    return this.c.transaction(() => {
      const access = this.c.requireAccess(actor, wid, 'manage');
      const row = this.c.get(
        'SELECT m.*,u.email,u.display_name,u.avatar_asset_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=? AND m.workspace_id=?',
        mid,
        wid,
      );
      if (!row) throw new AppError(404, 'NOT_FOUND', '成员不存在');
      if (row.role === 'owner')
        throw new AppError(403, 'OWNER_PROTECTED', '创建者只能通过专用转让流程变更');
      if (
        access.role === 'admin' &&
        row.user_id === actor.userId &&
        input.role &&
        input.role !== row.role
      )
        throw new AppError(403, 'FORBIDDEN', '管理员不能变更自身角色');
      if (input.creditLimit !== undefined)
        this.c.hooks.onMemberBudgetChanged?.(wid, str(row, 'user_id'), input.creditLimit);
      this.c.run(
        'UPDATE memberships SET role=?,credit_limit=?,nickname=?,updated_at=? WHERE id=?',
        input.role ?? row.role,
        input.creditLimit === undefined ? row.credit_limit : input.creditLimit,
        input.nickname ?? row.nickname,
        now(),
        mid,
      );
      this.c.audit(actor, wid, 'member.update', 'membership', mid, {
        role: input.role,
        creditLimit: input.creditLimit,
      });
      return this.member(
        this.c.get(
          'SELECT m.*,u.email,u.display_name,u.avatar_asset_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=?',
          mid,
        )!,
      );
    });
  }
  removeMember(actor: Actor, wid: string, mid: string) {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'manage');
      const row = this.c.get('SELECT * FROM memberships WHERE id=? AND workspace_id=?', mid, wid);
      if (!row) throw new AppError(404, 'NOT_FOUND', '成员不存在');
      if (row.role === 'owner') throw new AppError(403, 'OWNER_PROTECTED', '不能移除创建者');
      this.c.hooks.onMemberRemoved?.(wid, str(row, 'user_id'));
      this.c.run('DELETE FROM memberships WHERE id=?', mid);
      this.c.run(
        'UPDATE api_keys SET revoked_at=? WHERE workspace_id=? AND created_by=? AND revoked_at IS NULL',
        now(),
        wid,
        str(row, 'user_id'),
      );
      this.c.audit(actor, wid, 'member.remove', 'membership', mid);
      return { id: mid, removedAt: now() };
    });
  }
  invitations(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'manage');
    return this.c.page(
      'SELECT * FROM invitations WHERE workspace_id=? ORDER BY created_at DESC,id',
      [wid],
      q,
      (r) => this.invitation(r),
    );
  }
  private invitation(r: Row) {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      email: str(r, 'email'),
      role: str(r, 'role'),
      createdAt: str(r, 'created_at'),
      expiresAt: str(r, 'expires_at'),
      consumedAt: nullable(r, 'consumed_at'),
      revokedAt: nullable(r, 'revoked_at'),
    };
  }
  invite(actor: Actor, wid: string, raw: unknown) {
    const input = InvitationInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'manage');
      const space = this.c.get('SELECT * FROM workspaces WHERE id=?', wid);
      if (space?.kind !== 'team') throw new AppError(400, 'TEAM_REQUIRED', '个人空间不能邀请成员');
      const email = input.email.trim().toLowerCase();
      if (
        this.c.get(
          'SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?',
          wid,
          email,
        )
      )
        throw new AppError(409, 'ALREADY_MEMBER', '该用户已在团队中');
      this.c.run(
        'UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND email=? AND consumed_at IS NULL AND revoked_at IS NULL',
        now(),
        wid,
        email,
      );
      new EntitlementService(this.c).assertCreate(wid, 'seats');
      const iid = id(),
        secret = token(),
        date = now(),
        expiresAt = new Date(Date.now() + input.expiresInDays * 86400000).toISOString();
      this.c.run(
        'INSERT INTO invitations(id,workspace_id,email,role,token_hash,created_by,created_at,expires_at,credit_limit) VALUES (?,?,?,?,?,?,?,?,?)',
        iid,
        wid,
        email,
        input.role,
        hash(secret),
        actor.userId,
        date,
        expiresAt,
        input.creditLimit,
      );
      this.c.audit(actor, wid, 'invitation.create', 'invitation', iid);
      const inviteUrl = `${this.c.config.publicOrigin}/invite#token=${secret}`;
      const mailDelivery = this.c.hooks.onInvitationCreated?.({
        workspaceId: wid,
        invitationId: iid,
        inviteUrl,
      }) ?? { status: 'disabled' };
      return {
        ...this.invitation(this.c.get('SELECT * FROM invitations WHERE id=?', iid)!),
        inviteUrl,
        mailDelivery,
      };
    });
  }
  revokeInvitation(actor: Actor, wid: string, iid: string) {
    this.c.requireAccess(actor, wid, 'manage');
    if (!this.c.get('SELECT id FROM invitations WHERE id=? AND workspace_id=?', iid, wid))
      throw new AppError(404, 'NOT_FOUND', '邀请不存在');
    const date = now();
    this.c.run('UPDATE invitations SET revoked_at=? WHERE id=?', date, iid);
    return { id: iid, revokedAt: date };
  }
  accept(actor: Actor, raw: unknown) {
    if (actor.authType !== 'session') throw new AppError(403, 'FORBIDDEN', '需要账户会话');
    const { token: secret } = inputs.AcceptInvitationInputSchema.parse(raw);
    return this.c.transaction(() => {
      const row = this.c.get(
          'SELECT i.* FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=? AND i.revoked_at IS NULL AND i.expires_at>? AND w.archived_at IS NULL',
          hash(secret),
          now(),
        ),
        email = this.c.get('SELECT email FROM users WHERE id=?', actor.userId)?.email;
      if (!row || row.email !== email)
        throw new AppError(400, 'INVALID_INVITATION', '邀请已失效或邮箱不匹配');
      const wid = str(row, 'workspace_id');
      if (row.consumed_at) {
        if (
          !this.c.get(
            'SELECT id FROM memberships WHERE user_id=? AND workspace_id=?',
            actor.userId,
            wid,
          )
        )
          throw new AppError(409, 'INVITATION_USED', '邀请已被使用');
        return { workspace: this.auth.listWorkspaces(actor).find((w) => w.id === wid)! };
      }
      const date = now();
      if (
        !this.c.get(
          'SELECT id FROM memberships WHERE workspace_id=? AND user_id=?',
          wid,
          actor.userId,
        )
      )
        new EntitlementService(this.c).assertCreate(wid, 'seats', str(row, 'id'));
      this.c.run(
        'INSERT OR IGNORE INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        id(),
        wid,
        actor.userId,
        str(row, 'role'),
        date,
        date,
      );
      this.c.run('UPDATE invitations SET consumed_at=? WHERE id=?', date, str(row, 'id'));
      if (row.credit_limit !== null && row.credit_limit !== undefined) {
        const limit = num(row, 'credit_limit');
        this.c.hooks.onMemberBudgetChanged?.(wid, actor.userId, limit);
        this.c.run(
          'UPDATE memberships SET credit_limit=? WHERE workspace_id=? AND user_id=?',
          limit,
          wid,
          actor.userId,
        );
      }
      this.c.audit(actor, wid, 'invitation.accept', 'invitation', str(row, 'id'));
      return { workspace: this.auth.listWorkspaces(actor).find((w) => w.id === wid)! };
    });
  }
  leave(actor: Actor, wid: string, raw: unknown) {
    inputs.ConfirmInputSchema.parse(raw);
    return this.c.transaction(() => {
      const access = this.c.requireAccess(actor, wid, 'read');
      if (access.role === 'owner') throw new AppError(403, 'OWNER_PROTECTED', '请先转让团队所有权');
      this.c.hooks.onMemberRemoved?.(wid, actor.userId);
      this.c.run('DELETE FROM memberships WHERE id=?', access.membershipId);
      this.c.run(
        'UPDATE api_keys SET revoked_at=? WHERE workspace_id=? AND created_by=?',
        now(),
        wid,
        actor.userId,
      );
      this.c.audit(actor, wid, 'workspace.leave', 'workspace', wid);
      return { left: true };
    });
  }
  transfer(actor: Actor, wid: string, raw: unknown) {
    const { userId } = inputs.TransferWorkspaceInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'owner');
      if (userId === actor.userId) throw new AppError(400, 'INVALID_TARGET', '请选择另一名成员');
      const target = this.c.get(
        'SELECT * FROM memberships WHERE workspace_id=? AND user_id=?',
        wid,
        userId,
      );
      if (!target) throw new AppError(404, 'NOT_FOUND', '目标成员不存在');
      if (this.c.get('SELECT kind FROM workspaces WHERE id=?', wid)?.kind !== 'team')
        throw new AppError(400, 'TEAM_REQUIRED', '仅团队空间支持转让');
      claimTeamSlot(this.c, userId, wid, 'ownership');
      this.c.run(
        "UPDATE memberships SET role='admin',updated_at=? WHERE workspace_id=? AND user_id=?",
        now(),
        wid,
        actor.userId,
      );
      this.c.run(
        "UPDATE memberships SET role='owner',updated_at=? WHERE id=?",
        now(),
        str(target, 'id'),
      );
      this.c.audit(actor, wid, 'workspace.transfer', 'workspace', wid, { userId });
      return this.auth.listWorkspaces(actor).find((w) => w.id === wid)!;
    });
  }
  archive(actor: Actor, wid: string, raw: unknown) {
    inputs.ConfirmInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'owner');
      if (this.c.get('SELECT kind FROM workspaces WHERE id=?', wid)?.kind !== 'team')
        throw new AppError(400, 'TEAM_REQUIRED', '不能解散个人空间');
      this.c.hooks.canArchiveWorkspace?.(wid);
      if (this.c.get("SELECT id FROM orders WHERE workspace_id=? AND status='pending'", wid))
        throw new AppError(409, 'PENDING_ORDERS', '尚有待处理支付订单');
      const date = now();
      this.c.run('UPDATE workspaces SET archived_at=?,updated_at=? WHERE id=?', date, date, wid);
      this.c.run('UPDATE api_keys SET revoked_at=? WHERE workspace_id=?', date, wid);
      this.c.audit(actor, wid, 'workspace.archive', 'workspace', wid);
      return { id: wid, archivedAt: date };
    });
  }
  audit(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'manage');
    return this.c.page(
      'SELECT * FROM audit_events WHERE workspace_id=? ORDER BY created_at DESC,id',
      [wid],
      q,
      (r) => ({
        id: str(r, 'id'),
        actorId: str(r, 'actor_id'),
        action: str(r, 'action'),
        resourceType: str(r, 'resource_type'),
        resourceId: nullable(r, 'resource_id'),
        createdAt: str(r, 'created_at'),
      }),
    );
  }
  exportCsv(actor: Actor, wid: string): string {
    this.c.requireAccess(actor, wid, 'manage');
    const escape = (s: string) =>
      `"${(/^[=+@\-\t\r]/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"`;
    const rows = this.c.all(
      'SELECT u.email,u.display_name,m.role,m.nickname,m.credit_limit FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at,m.id',
      wid,
    );
    return (
      '\uFEFFemail,displayName,role,nickname,creditLimit\r\n' +
      rows
        .map((r) =>
          [
            str(r, 'email'),
            str(r, 'display_name'),
            str(r, 'role'),
            str(r, 'nickname'),
            nullable(r, 'credit_limit') ?? '',
          ]
            .map(escape)
            .join(','),
        )
        .join('\r\n')
    );
  }
}

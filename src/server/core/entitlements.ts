import {
  EntitlementLimitsSchema,
  PlanLimitsSchema,
  type CountedResource,
  type EntitlementLimits,
} from '../../contracts/entitlements';
import type { Actor } from '../../contracts/core';
import { resolveExportPolicy } from '../../contracts/export-policy';
import { AppError } from '../errors';
import { CoreContext, str, num, now, json } from './shared';
/** All mutations call these guards under the same SQLite write transaction as their insert. */
export class EntitlementService {
  constructor(private c: CoreContext) {}
  exportPolicy(wid: string) {
    const effective = this.effective(wid);
    return resolveExportPolicy({
      workspaceId: wid,
      isDemo: effective.isDemo,
      hasActiveSubscription: effective.source === 'subscription',
      config: this.c.config.exportWatermark,
    });
  }
  effective(wid: string) {
    const workspace = this.c.get(
      'SELECT is_demo FROM workspaces WHERE id=? AND archived_at IS NULL',
      wid,
    );
    if (!workspace) throw new AppError(404, 'NOT_FOUND', '工作空间不存在');
    const isDemo = !!num(workspace, 'is_demo');
    const baseline = this.c.get(
      'SELECT limits_json FROM entitlement_defaults WHERE id=?',
      isDemo ? 'demo' : 'standard',
    );
    const limits = EntitlementLimitsSchema.parse(json(baseline?.limits_json, {}));
    const subscriptions = this.c.all(
      "SELECT s.id,o.plan_snapshot_json FROM subscriptions s JOIN orders o ON o.id=s.source_order_id WHERE s.workspace_id=? AND s.status='active' AND s.current_period_start<=? AND s.current_period_end>? AND o.status='paid'",
      wid,
      now(),
      now(),
    );
    const combined: Partial<EntitlementLimits> = {};
    for (const row of subscriptions) {
      const snapshot = json<{ limits_json?: string }>(row.plan_snapshot_json, {});
      const saved = PlanLimitsSchema.parse(json(snapshot.limits_json, {}));
      for (const key of Object.keys(saved) as (keyof EntitlementLimits)[]) {
        const value = saved[key];
        if (value !== undefined)
          combined[key] = combined[key] === undefined ? value : Math.max(combined[key]!, value);
      }
    }
    return {
      limits: { ...limits, ...combined },
      source: subscriptions.length ? ('subscription' as const) : ('baseline' as const),
      subscriptionIds: subscriptions.map((s) => str(s, 'id')),
      isDemo,
    };
  }
  usage(wid: string): Record<CountedResource, number> {
    const count = (sql: string, ...extra: string[]) => num(this.c.get(sql, wid, ...extra)!, 'n');
    return {
      projects: count(
        'SELECT COUNT(*) n FROM projects WHERE workspace_id=? AND deleted_at IS NULL',
      ),
      brands: count('SELECT COUNT(*) n FROM brands WHERE workspace_id=? AND deleted_at IS NULL'),
      characters: count(
        'SELECT COUNT(*) n FROM character_profiles WHERE workspace_id=? AND deleted_at IS NULL',
      ),
      apiKeys: count(
        'SELECT COUNT(*) n FROM api_keys WHERE workspace_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)',
        now(),
      ),
      seats:
        num(this.c.get('SELECT COUNT(*) n FROM memberships WHERE workspace_id=?', wid)!, 'n') +
        count(
          'SELECT COUNT(*) n FROM invitations WHERE workspace_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?',
          now(),
        ),
    };
  }
  assertCreate(wid: string, resource: CountedResource, excludedInvitationId?: string) {
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('Entitlement creation guard requires transaction');
    let used = this.usage(wid)[resource];
    if (
      resource === 'seats' &&
      excludedInvitationId &&
      this.c.get(
        'SELECT id FROM invitations WHERE id=? AND workspace_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?',
        excludedInvitationId,
        wid,
        now(),
      )
    )
      used--;
    const limit = this.effective(wid).limits[resource];
    if (used >= limit)
      throw new AppError(409, 'ENTITLEMENT_LIMIT', `已达到当前空间的${resource}数量上限`, {
        resource,
        used,
        limit,
      });
  }
  get(actor: Actor, wid: string) {
    this.c.requireAccess(actor, wid, 'read');
    const effective = this.effective(wid),
      day = now().slice(0, 10),
      limit = effective.limits.textAssistDailyFreeUnits;
    const used = num(
      this.c.get(
        'SELECT COUNT(*) n FROM free_text_claims WHERE workspace_id=? AND period_day=?',
        wid,
        day,
      )!,
      'n',
    );
    return {
      ...effective,
      used: this.usage(wid),
      freeTextAssist: {
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetAt: new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString(),
      },
    };
  }
  claimFreeTextAssist(actor: Actor, wid: string, jobId: string, itemIds: string[]) {
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('Free claim must share job submission transaction');
    this.c.requireAccess(actor, wid, 'write');
    if (!itemIds.length || new Set(itemIds).size !== itemIds.length)
      throw new AppError(400, 'INVALID_FREE_CLAIM', '免费次数条目不能为空或重复');
    const job = this.c.get(
      "SELECT * FROM jobs WHERE id=? AND workspace_id=? AND user_id=? AND operation='text.assist'",
      jobId,
      wid,
      actor.userId,
    );
    if (!job) throw new AppError(404, 'NOT_FOUND', '免费次数只能用于本人当前空间的文本辅助任务');
    const fresh: string[] = [];
    for (const iid of itemIds) {
      const item = this.c.get(
        'SELECT * FROM job_items WHERE id=? AND job_id=? AND workspace_id=? AND user_id=?',
        iid,
        jobId,
        wid,
        actor.userId,
      );
      if (!item || num(item, 'credits') !== 0)
        throw new AppError(409, 'INVALID_FREE_CLAIM', '免费任务条目或额度不匹配');
      if (this.c.get('SELECT item_id FROM free_text_claims WHERE item_id=?', iid)) continue;
      if (str(item, 'status') !== 'queued')
        throw new AppError(409, 'INVALID_FREE_CLAIM', '只能在提交时领取免费次数');
      fresh.push(iid);
    }
    const time = now(),
      day = time.slice(0, 10),
      limit = this.effective(wid).limits.textAssistDailyFreeUnits;
    const used = num(
      this.c.get(
        'SELECT COUNT(*) n FROM free_text_claims WHERE workspace_id=? AND period_day=?',
        wid,
        day,
      )!,
      'n',
    );
    const remaining = Math.max(0, limit - used);
    if (fresh.length > remaining)
      throw new AppError(409, 'FREE_QUOTA_EXHAUSTED', '今日免费文本次数不足，请重新报价', {
        remaining,
      });
    for (const iid of fresh)
      this.c.run(
        'INSERT INTO free_text_claims VALUES(?,?,?,?,?,?)',
        iid,
        jobId,
        wid,
        actor.userId,
        time.slice(0, 10),
        time,
      );
  }
}

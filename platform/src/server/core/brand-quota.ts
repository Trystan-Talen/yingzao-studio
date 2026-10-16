import { z } from 'zod';
import {
  brandQuotaSchema,
  brandQuotaScopeSchema,
  type BrandQuota,
} from '../../contracts/brand-quota';
import { AppError } from '../errors';
import { prepaidTermsSchema } from '../../contracts/promotions';
import { CoreContext, now } from './shared';

const brandLimit = z.number().int().nonnegative().max(10000);
const savedQuotaSchema = z
  .object({
    brands: brandLimit.optional(),
    brandQuotaScope: brandQuotaScopeSchema.optional(),
  })
  .passthrough();
const snapshotSchema = z
  .object({
    limits_json: z.string().nullish(),
    kind: z.string().nullish(),
    catalog_mode: z.string().nullish(),
    approved_at: z.string().nullish(),
    prepaid_terms_json: z.string().nullish(),
  })
  .passthrough();
const baselineSchema = z.object({ brands: brandLimit }).passthrough();

/** Reads capacity only. Callers retain their ordinary workspace and write-permission guards. */
export function readBrandQuota(c: CoreContext, wid: string, userId: string): BrandQuota {
  return c.db.sqlite
    .transaction(() => {
      const workspace = c.get<{ kind: string; is_demo: number }>(
        'SELECT kind,is_demo FROM workspaces WHERE id=? AND archived_at IS NULL',
        wid,
      );
      if (!workspace) throw new AppError(404, 'NOT_FOUND', '工作空间不存在');
      const baseline = c.get<{ limits_json: string }>(
        'SELECT limits_json FROM entitlement_defaults WHERE id=?',
        workspace.is_demo ? 'demo' : 'standard',
      );
      let workspaceLimit: number | null = null,
        memberLimit: number | null = null,
        baselineLimit: number;
      try {
        baselineLimit = baselineSchema.parse(JSON.parse(baseline?.limits_json ?? '{}')).brands;
        const time = now();
        const contracts = c.all<{ plan_snapshot_json: string }>(
          `SELECT o.plan_snapshot_json FROM subscriptions s JOIN orders o ON o.id=s.source_order_id
         WHERE s.workspace_id=? AND o.workspace_id=s.workspace_id AND s.status='active'
           AND s.current_period_start<=? AND s.current_period_end>? AND o.status='paid'`,
          wid,
          time,
          time,
        );
        for (const contract of contracts) {
          const snapshot = snapshotSchema.parse(JSON.parse(contract.plan_snapshot_json));
          const quota = savedQuotaSchema.parse(JSON.parse(snapshot.limits_json ?? '{}'));
          if (quota.brandQuotaScope !== undefined && quota.brands === undefined)
            throw new Error('Explicit brand quota scope requires an explicit numeric limit');
          if (quota.brandQuotaScope === 'member') {
            const terms = prepaidTermsSchema.parse(
              JSON.parse(snapshot.prepaid_terms_json ?? 'null'),
            );
            if (
              workspace.kind !== 'team' ||
              snapshot.kind !== 'subscription' ||
              snapshot.catalog_mode !== 'official' ||
              !snapshot.approved_at?.trim() ||
              terms.audience !== 'team'
            )
              throw new Error('Member brand quota requires an approved fixed-term team contract');
          }
          if (quota.brands === undefined) continue;
          if (quota.brandQuotaScope === 'member')
            memberLimit = Math.max(memberLimit ?? 0, quota.brands);
          else workspaceLimit = Math.max(workspaceLimit ?? 0, quota.brands);
        }
      } catch {
        throw new AppError(409, 'BRAND_QUOTA_INVALID', '品牌配额合同无效，请核对套餐配置');
      }
      // A member-only purchase replaces the fallback rule; it does not add free workspace capacity.
      if (workspaceLimit === null && memberLimit === null) workspaceLimit = baselineLimit;
      const used = c.get<{ workspaceUsed: number; memberUsed: number }>(
        `SELECT COUNT(*) AS workspaceUsed,
        COALESCE(SUM(CASE WHEN created_by=? THEN 1 ELSE 0 END),0) AS memberUsed
       FROM brands WHERE workspace_id=? AND deleted_at IS NULL`,
        userId,
        wid,
      )!;
      const isMember =
        memberLimit !== null &&
        !!c.get('SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?', wid, userId);
      return brandQuotaSchema.parse({
        scope:
          workspaceLimit !== null && memberLimit !== null
            ? 'mixed'
            : memberLimit !== null
              ? 'member'
              : 'workspace',
        workspaceLimit,
        memberLimit,
        ...used,
        canCreate:
          (workspaceLimit !== null && used.workspaceUsed < workspaceLimit) ||
          (isMember && memberLimit !== null && used.memberUsed < memberLimit),
      });
    })
    .deferred();
}

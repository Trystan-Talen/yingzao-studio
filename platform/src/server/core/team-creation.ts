import { TeamReservationInputSchema, type TeamCreationStatus } from '../../contracts/team-creation';
import { prepaidTermsSchema } from '../../contracts/promotions';
import type { Actor } from '../../contracts/core';
import { AppError } from '../errors';
import { createPromotions } from '../billing/promotions';
import type { BusinessService } from './business';
import { CoreContext, id, now, str, num, json, type Row } from './shared';

export function teamSlot(c: CoreContext, userId: string) {
  return (
    c.get('SELECT workspace_id FROM team_account_slots WHERE user_id=?', userId) ??
    c.get(
      "SELECT w.id AS workspace_id FROM workspaces w WHERE w.kind='team' AND (w.created_by=? OR EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=w.id AND m.user_id=? AND m.role='owner')) ORDER BY w.created_at,w.id LIMIT 1",
      userId,
      userId,
    )
  );
}
export function claimTeamSlot(
  c: CoreContext,
  userId: string,
  wid: string,
  origin: 'created' | 'ownership',
) {
  const slot = teamSlot(c, userId);
  if (slot && slot.workspace_id !== wid)
    throw new AppError(409, 'TEAM_SLOT_USED', '此账号已占用一个团队名额，转让或解散不会恢复名额');
  c.run('INSERT OR IGNORE INTO team_account_slots VALUES(?,?,?,?)', userId, wid, origin, now());
}
export function teamPurchaseTerms(plan: Row) {
  const result = prepaidTermsSchema.safeParse(json(plan.prepaid_terms_json, null));
  if (
    plan.kind !== 'subscription' ||
    !result.success ||
    result.data.audience !== 'team' ||
    plan.catalog_mode !== 'official' ||
    !plan.approved_at
  )
    throw new AppError(
      409,
      'TEAM_PLAN_REQUIRED',
      '团队开通需要已批准且明确适用于团队的固定期会员套餐，个人会员或席位数不能替代',
    );
  return result.data;
}
export function assertPendingTeamOrder(
  c: CoreContext,
  actor: Actor,
  wid: string,
  plan: Row,
  channel: string,
) {
  const pending = c.get(
    "SELECT * FROM team_provisioning WHERE workspace_id=? AND state='pending'",
    wid,
  );
  if (!pending) return;
  if (actor.authType !== 'session' || pending.user_id !== actor.userId || channel !== 'web')
    throw new AppError(403, 'FORBIDDEN', '仅预留创建者可处理此团队会员付款');
  teamPurchaseTerms(plan);
}
export class TeamCreationService {
  constructor(
    private c: CoreContext,
    private business: BusinessService,
  ) {}
  status(actor: Actor): TeamCreationStatus {
    if (actor.authType !== 'session') throw new AppError(403, 'FORBIDDEN', '团队开通需要账户会话');
    const slot = teamSlot(this.c, actor.userId);
    const provision = slot
      ? this.c.get(
          "SELECT p.*,w.name FROM team_provisioning p JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=? AND p.user_id=? AND p.state='pending'",
          slot.workspace_id,
          actor.userId,
        )
      : undefined;
    const existing =
      slot && !provision
        ? this.c.get('SELECT id,name,archived_at FROM workspaces WHERE id=?', slot.workspace_id)
        : undefined;
    const accessible =
      !!existing &&
      !existing.archived_at &&
      !!this.c.get(
        'SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?',
        existing.id,
        actor.userId,
      );
    const details = existing
      ? {
          id: str(existing, 'id'),
          name: accessible ? str(existing, 'name') : '',
          archived: !!existing.archived_at,
          accessible,
        }
      : null;
    const plans: TeamCreationStatus['plans'] = [];
    // An absent workspace is intentionally not personal: personal-only promotions never apply.
    const offerWid = provision ? str(provision, 'workspace_id') : '';
    for (const plan of this.c.all(
      "SELECT * FROM plans WHERE active=1 AND kind='subscription' AND prepaid_terms_json IS NOT NULL ORDER BY price_minor,id",
    )) {
      const parsed = prepaidTermsSchema.safeParse(json(plan.prepaid_terms_json, null));
      if (!parsed.success || parsed.data.audience !== 'team') continue;
      const approved = plan.catalog_mode === 'official' && !!plan.approved_at;
      const available = approved && this.business.canCheckoutPlan(str(plan, 'id'));
      const promotion = createPromotions(this.c.db).offer(
        str(plan, 'promotion_json') || null,
        num(plan, 'price_minor'),
        actor.userId,
        offerWid,
        this.business.paymentEnvironment(),
      );
      plans.push({
        id: str(plan, 'id'),
        name: str(plan, 'name'),
        priceMinor: promotion?.priceMinor ?? num(plan, 'price_minor'),
        currency: str(plan, 'currency'),
        credits: num(plan, 'credits'),
        catalogVersion: num(plan, 'catalog_version'),
        limits: json(plan.limits_json, {}),
        terms: parsed.data,
        promotion,
        available,
        unavailableReason: !approved
          ? '团队套餐尚未正式批准'
          : !available
            ? '支付服务未配置，暂不可开通团队'
            : '',
      });
    }
    const mode = details
      ? 'existing'
      : provision
        ? 'pending'
        : this.c.config.demoMode
          ? 'demo'
          : 'purchase';
    return {
      mode,
      reason: details
        ? '此账号已占用一个团队名额，已有团队保持可用；转让或解散不会恢复名额。'
        : mode === 'demo'
          ? '本机演示可体验一个团队，不代表已购买团队会员。'
          : !plans.length
            ? '尚未配置明确适用于团队的固定期会员套餐，暂不可开通团队。'
            : '每个账号限开通一个团队；付款核验完成后才开放团队。',
      existing: details,
      pending: provision
        ? {
            workspaceId: str(provision, 'workspace_id'),
            name: str(provision, 'name'),
            order: provision.order_id
              ? this.business.getOrder(
                  actor,
                  str(provision, 'workspace_id'),
                  str(provision, 'order_id'),
                )
              : null,
          }
        : null,
      plans,
    };
  }
  reserve(actor: Actor, raw: unknown): TeamCreationStatus {
    const input = TeamReservationInputSchema.parse(raw);
    return this.c.transaction(() => {
      const status = this.status(actor);
      if (status.mode === 'existing' || status.mode === 'demo')
        throw new AppError(
          409,
          'TEAM_SLOT_USED',
          '此账号已占用团队名额或正在使用演示模式，请返回团队入口',
        );
      const plan = this.c.get('SELECT * FROM plans WHERE id=? AND active=1', input.planId);
      if (!plan) throw new AppError(404, 'NOT_FOUND', '套餐不存在');
      teamPurchaseTerms(plan);
      if (!this.business.canCheckoutPlan(input.planId))
        throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', '支付服务未配置，暂不可开通团队');
      if (status.pending?.order && ['draft', 'pending'].includes(status.pending.order.status)) {
        const old = this.c.get('SELECT plan_id FROM orders WHERE id=?', status.pending.order.id);
        if (old?.plan_id === input.planId) return status;
        throw new AppError(
          409,
          'TEAM_PAYMENT_PENDING',
          '已有团队付款草稿或待核对付款，请先处理原订单',
        );
      }
      const wid = status.pending?.workspaceId ?? id();
      if (!status.pending) {
        const date = now();
        this.c.run(
          "INSERT INTO workspaces(id,name,kind,is_demo,created_by,created_at,updated_at) VALUES(?,?,'team',0,?,?,?)",
          wid,
          input.name,
          actor.userId,
          date,
          date,
        );
        claimTeamSlot(this.c, actor.userId, wid, 'created');
        this.c.run(
          "INSERT INTO team_provisioning VALUES(?,?,'pending',NULL,?,NULL)",
          wid,
          actor.userId,
          date,
        );
        // Zero-credit account only; no membership and no paid entitlement is granted here.
        this.c.hooks.onWorkspaceCreated?.(wid, actor.userId);
      } else
        this.c.run('UPDATE workspaces SET name=?,updated_at=? WHERE id=?', input.name, now(), wid);
      const order = this.business.createOrder(actor, wid, {
        planId: input.planId,
        expectedAmountMinor: input.expectedAmountMinor,
        expectedCatalogVersion: input.expectedCatalogVersion,
        billingChannel: 'web',
      });
      this.c.run('UPDATE team_provisioning SET order_id=? WHERE workspace_id=?', order.id, wid);
      this.c.audit(actor, wid, 'team.purchase-reserved', 'order', order.id);
      return this.status(actor);
    });
  }
  activateVerifiedPurchase(oid: string) {
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('Team activation requires billing transaction');
    const row = this.c.get(
      "SELECT p.*,o.status,o.refunded_minor,o.amount_minor,o.plan_snapshot_json,o.payment_environment,o.created_by,o.billing_channel FROM team_provisioning p JOIN orders o ON o.workspace_id=p.workspace_id WHERE o.id=? AND p.state='pending'",
      oid,
    );
    if (!row) return;
    if (
      row.status !== 'paid' ||
      num(row, 'refunded_minor') >= num(row, 'amount_minor') ||
      row.payment_environment === 'unbound'
    )
      return;
    teamPurchaseTerms(json<Row>(row.plan_snapshot_json, {}));
    if (
      row.created_by !== row.user_id ||
      row.billing_channel !== 'web' ||
      !this.c.get('SELECT 1 FROM billing_fulfillments WHERE order_id=?', oid) ||
      !this.c.get(
        "SELECT 1 FROM subscriptions WHERE source_order_id=? AND provider_id='stripe-prepaid' AND current_period_start IS NOT NULL AND current_period_end IS NOT NULL",
        oid,
      )
    )
      return;
    claimTeamSlot(this.c, str(row, 'user_id'), str(row, 'workspace_id'), 'created');
    this.c.run(
      "INSERT INTO memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,'owner',?,?)",
      id(),
      row.workspace_id,
      row.user_id,
      now(),
      now(),
    );
    this.c.run(
      "UPDATE team_provisioning SET state='active',activated_at=? WHERE workspace_id=?",
      now(),
      row.workspace_id,
    );
    this.c.audit(
      {
        userId: str(row, 'user_id'),
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      },
      str(row, 'workspace_id'),
      'team.activated',
      'order',
      oid,
    );
  }
}

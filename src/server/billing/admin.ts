import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { createCreditService } from '../tasks/credits';
import { now } from '../tasks/types';
import { EntitlementLimitsSchema, PlanLimitsSchema } from '../../contracts/entitlements';
const operator = { actorUserId: z.string().uuid(), reason: z.string().trim().min(20).max(2000) };
const plan = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(['credits', 'subscription']),
    priceMinor: z.number().int().min(1).max(99_999_999),
    currency: z.string().regex(/^[A-Z]{3}$/),
    credits: z.number().int().min(0).max(1_000_000_000),
    interval: z.enum(['month', 'year']).nullable(),
    limits: PlanLimitsSchema.default({}),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((p) => (p.kind === 'subscription' ? p.interval !== null : p.interval === null), {
    message: '订阅必须指定月/年周期，算力包不能带续费周期',
  });
export const planImportSchema = z
  .object({
    ...operator,
    version: z.literal(1),
    confirmCommercialCatalog: z.literal(true),
    plans: z.array(plan).min(1).max(100),
  })
  .strict()
  .refine((v) => new Set(v.plans.map((p) => p.id)).size === v.plans.length, {
    message: '套餐ID不能重复',
  });
export const riskResolutionSchema = z
  .object({
    ...operator,
    workspaceId: z.string().uuid(),
    riskIds: z.array(z.string().uuid()).min(1).max(100),
    evidenceReference: z.string().trim().min(5).max(500),
    confirmedManuallyHandled: z.literal(true),
    creditsToRevoke: z.number().int().min(0).max(1_000_000_000).default(0),
  })
  .strict()
  .refine((v) => new Set(v.riskIds).size === v.riskIds.length, { message: '风险ID不能重复' });
export const referralProgramSchema = z
  .object({
    ...operator,
    registrationEnabled: z.boolean(),
    rewardsEnabled: z.boolean(),
    rewardCredits: z.number().int().min(0).max(1_000_000),
    minimumPaidMinor: z.number().int().min(1).max(99_999_999),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()
  .refine((v) => !v.rewardsEnabled || v.rewardCredits > 0, { message: '启用奖励时额度必须为正数' });
export const channelApprovalSchema = z
  .object({ ...operator, userId: z.string().uuid(), enabled: z.boolean() })
  .strict();
export const entitlementDefaultsSchema = z
  .object({ ...operator, mode: z.enum(['standard', 'demo']), limits: EntitlementLimitsSchema })
  .strict();
export const supportResolutionSchema = z
  .object({
    ...operator,
    ticketId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    decision: z.enum(['approved', 'rejected']),
    evidenceReference: z.string().trim().min(5).max(500),
    items: z
      .array(
        z
          .object({
            itemId: z.string().uuid(),
            credits: z.number().int().positive().max(1_000_000_000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .refine((v) => (v.decision === 'approved' ? v.items.length > 0 : v.items.length === 0), {
    message: '批准需指定退回条目，驳回不能附带退款',
  })
  .refine((v) => new Set(v.items.map((i) => i.itemId)).size === v.items.length, {
    message: '任务条目不能重复',
  });
export const creditGrantSchema = z
  .object({
    ...operator,
    workspaceId: z.string().uuid(),
    userId: z.string().uuid(),
    eventKey: z.string().trim().min(1).max(200),
    amount: z.number().int().positive().max(1_000_000_000),
    expiresAt: z.string().datetime().nullable().default(null),
    archiveMonths: z.number().int().min(0).max(12).default(0),
  })
  .strict()
  .refine((v) => !v.archiveMonths || !!v.expiresAt, { message: '封存月数必须关联到期时间' });
export const creditValiditySchema = z
  .object({
    ...operator,
    workspaceId: z.string().uuid(),
    lotId: z.string().min(1).max(100),
    eventKey: z.string().trim().min(1).max(200),
    expiresAt: z.string().datetime(),
  })
  .strict();
export function createBillingAdmin(
  db: DatabaseContext,
  hooks: {
    onNotificationCreated?: (input: { workspaceId: string; notificationId: string }) => void;
  } = {},
) {
  const sql = db.sqlite,
    credits = createCreditService(db),
    atomic = <T>(fn: () => T): T => sql.transaction(fn).immediate();
  function requireOperator(uid: string) {
    const owner = sql.prepare('SELECT id FROM users ORDER BY created_at,id LIMIT 1').get() as
      { id: string } | undefined;
    if (!owner || owner.id !== uid)
      throw new AppError(
        403,
        'INSTALLATION_ADMIN_REQUIRED',
        '离线商业管理须使用此安装的首位管理员账户ID',
      );
  }
  function audit(
    uid: string,
    action: string,
    reason: string,
    details: unknown,
    evidence: string | null = null,
  ) {
    sql
      .prepare('INSERT INTO operator_audit VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(), uid, action, reason, evidence, JSON.stringify(details), now());
  }
  function importPlans(raw: unknown) {
    const input = planImportSchema.parse(raw);
    return atomic(() => {
      requireOperator(input.actorUserId);
      for (const p of input.plans) {
        sql
          .prepare(
            `INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,active,catalog_mode,catalog_version,approved_at,approved_by) VALUES(?,?,?,?,?,?,?,?,?,'official',1,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,price_minor=excluded.price_minor,currency=excluded.currency,interval=excluded.interval,credits=excluded.credits,limits_json=excluded.limits_json,active=excluded.active,catalog_mode='official',catalog_version=plans.catalog_version+1,approved_at=excluded.approved_at,approved_by=excluded.approved_by`,
          )
          .run(
            p.id,
            p.name,
            p.kind,
            p.priceMinor,
            p.currency,
            p.interval,
            p.credits,
            JSON.stringify(p.limits),
            p.active ? 1 : 0,
            now(),
            input.actorUserId,
          );
      }
      audit(input.actorUserId, 'catalog.import-official', input.reason, { plans: input.plans });
      return { imported: input.plans.length, ids: input.plans.map((p) => p.id) };
    });
  }
  function resolveRisks(raw: unknown) {
    const input = riskResolutionSchema.parse(raw);
    return atomic(() => {
      requireOperator(input.actorUserId);
      const risks = input.riskIds.map(
        (id) =>
          sql
            .prepare('SELECT * FROM billing_risks WHERE id=? AND workspace_id=?')
            .get(id, input.workspaceId) as
            { id: string; status: string; referral_reward_id: string | null } | undefined,
      );
      if (risks.some((r) => !r))
        throw new AppError(404, 'RISK_NOT_FOUND', '风险记录不存在或不属于指定空间');
      if (risks.some((r) => r!.status !== 'review_required'))
        throw new AppError(409, 'RISK_ALREADY_RESOLVED', '选择中包含已处理风险，不能重复调账');
      const rewards = [
        ...new Set(risks.map((r) => r!.referral_reward_id).filter((v): v is string => !!v)),
      ];
      const debt = rewards.reduce(
        (sum, id) =>
          sum +
          (
            sql.prepare('SELECT debt_credits FROM referral_rewards WHERE id=?').get(id) as {
              debt_credits: number;
            }
          ).debt_credits,
        0,
      );
      if (input.creditsToRevoke < debt)
        throw new AppError(
          409,
          'REFERRAL_DEBT_UNRESOLVED',
          '额度冲正数小于仍未追回的推荐奖励，不能解除风险',
        );
      const account = credits.account(input.workspaceId);
      if (account.balance - account.reserved < input.creditsToRevoke)
        throw new AppError(
          409,
          'ADJUSTMENT_EXCEEDS_AVAILABLE',
          '可用额度不足以冲正；保留在途预留和风险状态，不能制造负余额',
        );
      const mode = sql
        .prepare('SELECT credit_mode FROM workspace_billing WHERE workspace_id=?')
        .get(input.workspaceId) as { credit_mode: string };
      const allocated = (
        sql
          .prepare(
            'SELECT COALESCE(SUM(MAX(COALESCE(credit_limit-spent,0),reserved)),0) total FROM member_budgets WHERE workspace_id=?',
          )
          .get(input.workspaceId) as { total: number }
      ).total;
      if (mode.credit_mode === 'allocated' && allocated > account.balance - input.creditsToRevoke)
        throw new AppError(
          409,
          'BUDGET_POOL_EXCEEDED',
          '请先回收未使用的成员额度，使分配总额不超过冲正后的余额，再解除风险',
        );
      const resolutionId = randomUUID();
      if (input.creditsToRevoke) {
        credits.debit({
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          eventKey: `risk-resolution:${resolutionId}`,
          amount: input.creditsToRevoke,
          description: '管理员完成支付风险核对后的额度冲正',
        });
      }
      for (const rewardId of rewards)
        sql
          .prepare('UPDATE referral_rewards SET debt_credits=0,updated_at=? WHERE id=?')
          .run(now(), rewardId);
      for (const riskId of input.riskIds)
        sql
          .prepare(
            "UPDATE billing_risks SET status='resolved',resolved_at=?,resolved_by=?,resolution_reason=?,evidence_reference=? WHERE id=?",
          )
          .run(now(), input.actorUserId, input.reason, input.evidenceReference, riskId);
      const unresolved = (
        sql
          .prepare(
            "SELECT COUNT(*) n FROM billing_risks WHERE workspace_id=? AND status='review_required'",
          )
          .get(input.workspaceId) as { n: number }
      ).n;
      sql
        .prepare('UPDATE workspace_billing SET payment_review_required=? WHERE workspace_id=?')
        .run(unresolved ? 1 : 0, input.workspaceId);
      audit(
        input.actorUserId,
        'billing.risks-manually-resolved',
        input.reason,
        {
          resolutionId,
          workspaceId: input.workspaceId,
          riskIds: input.riskIds,
          creditsRevoked: input.creditsToRevoke,
          holdReleased: unresolved === 0,
        },
        input.evidenceReference,
      );
      return {
        resolved: input.riskIds.length,
        holdReleased: unresolved === 0,
        unresolved,
        creditsRevoked: input.creditsToRevoke,
      };
    });
  }
  function configureReferrals(raw: unknown) {
    const input = referralProgramSchema.parse(raw);
    return atomic(() => {
      requireOperator(input.actorUserId);
      sql
        .prepare(
          "UPDATE referral_program SET registration_enabled=?,rewards_enabled=?,reward_credits=?,minimum_paid_minor=?,currency=?,version=version+1,updated_by=?,updated_at=? WHERE id='default'",
        )
        .run(
          input.registrationEnabled ? 1 : 0,
          input.rewardsEnabled ? 1 : 0,
          input.rewardCredits,
          input.minimumPaidMinor,
          input.currency,
          input.actorUserId,
          now(),
        );
      audit(input.actorUserId, 'referral.program-configured', input.reason, input);
      return {
        configured: true,
        registrationEnabled: input.registrationEnabled,
        rewardsEnabled: input.rewardsEnabled,
      };
    });
  }
  function approveChannel(raw: unknown) {
    const input = channelApprovalSchema.parse(raw);
    return atomic(() => {
      requireOperator(input.actorUserId);
      if (!sql.prepare('SELECT 1 FROM users WHERE id=?').get(input.userId))
        throw new AppError(404, 'USER_NOT_FOUND', '渠道账户不存在');
      sql
        .prepare(
          'INSERT INTO channel_partners VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,approved_by=excluded.approved_by,reason=excluded.reason,updated_at=excluded.updated_at',
        )
        .run(input.userId, input.enabled ? 1 : 0, input.actorUserId, input.reason, now(), now());
      audit(input.actorUserId, 'referral.channel-permission', input.reason, {
        userId: input.userId,
        enabled: input.enabled,
      });
      return { userId: input.userId, enabled: input.enabled };
    });
  }
  function configureEntitlements(raw: unknown) {
    const input = entitlementDefaultsSchema.parse(raw);
    return atomic(() => {
      requireOperator(input.actorUserId);
      sql
        .prepare(
          'UPDATE entitlement_defaults SET limits_json=?,updated_by=?,updated_at=? WHERE id=?',
        )
        .run(JSON.stringify(input.limits), input.actorUserId, now(), input.mode);
      audit(input.actorUserId, 'entitlements.defaults-configured', input.reason, {
        mode: input.mode,
        limits: input.limits,
      });
      return { mode: input.mode, limits: input.limits };
    });
  }
  function resolveAppeal(raw: unknown) {
    const input = supportResolutionSchema.parse(raw);
    input.items.sort((a, b) => a.itemId.localeCompare(b.itemId));
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return atomic(() => {
      requireOperator(input.actorUserId);
      const previous = sql
        .prepare('SELECT * FROM support_resolutions WHERE ticket_id=?')
        .get(input.ticketId) as
        { id: string; request_hash: string; refunded_credits: number } | undefined;
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new AppError(409, 'APPEAL_ALREADY_RESOLVED', '此申诉已审核，不能改写原裁定');
        return {
          id: previous.id,
          decision: input.decision,
          refundedCredits: previous.refunded_credits,
          alreadyProcessed: true,
        };
      }
      const ticket = sql
        .prepare(
          "SELECT * FROM support_tickets WHERE id=? AND workspace_id=? AND category='appeal'",
        )
        .get(input.ticketId, input.workspaceId) as
        { job_id: string | null; status: string; created_by: string } | undefined;
      if (!ticket || !ticket.job_id)
        throw new AppError(404, 'APPEAL_NOT_FOUND', '申诉不存在或未关联指定任务');
      if (ticket.status !== 'open') throw new AppError(409, 'TICKET_CLOSED', '此申诉已关闭');
      const resolutionId = randomUUID(),
        refunded = input.items.reduce((sum, i) => sum + i.credits, 0),
        date = now();
      sql
        .prepare('INSERT INTO support_resolutions VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          resolutionId,
          input.ticketId,
          input.workspaceId,
          input.decision,
          input.reason,
          input.evidenceReference,
          input.actorUserId,
          requestHash,
          refunded,
          date,
        );
      for (const item of input.items)
        credits.refundSettledItem({
          workspaceId: input.workspaceId,
          jobId: ticket.job_id,
          itemId: item.itemId,
          credits: item.credits,
          resolutionId,
          reason: `申诉审核退回应用额度：${input.reason}`,
        });
      sql
        .prepare("UPDATE support_tickets SET status='resolved',updated_at=? WHERE id=?")
        .run(date, input.ticketId);
      const notificationId = randomUUID();
      sql
        .prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,NULL,?)')
        .run(
          notificationId,
          input.workspaceId,
          ticket.created_by,
          '申诉审核完成',
          input.decision === 'approved'
            ? `已核定退回 ${refunded} 应用额度，遵循原来源有效期，可用、封存或已失效状态请以余额分桶为准；这不是现金退款。`
            : `申诉未获批准：${input.reason}`,
          `appeal:${input.ticketId}`,
          date,
        );
      hooks.onNotificationCreated?.({ workspaceId: input.workspaceId, notificationId });
      sql.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?)').run(
        randomUUID(),
        input.workspaceId,
        input.actorUserId,
        'appeal.resolved',
        'support-ticket',
        input.ticketId,
        JSON.stringify({
          resolutionId,
          decision: input.decision,
          refundedCredits: refunded,
          itemIds: input.items.map((i) => i.itemId),
        }),
        date,
      );
      audit(
        input.actorUserId,
        'support.appeal-resolved',
        input.reason,
        {
          resolutionId,
          ticketId: input.ticketId,
          workspaceId: input.workspaceId,
          decision: input.decision,
          refundedCredits: refunded,
          items: input.items,
        },
        input.evidenceReference,
      );
      return {
        id: resolutionId,
        decision: input.decision,
        refundedCredits: refunded,
        alreadyProcessed: false,
      };
    });
  }
  function grantCredits(raw: unknown) {
    const input = creditGrantSchema.parse(raw);
    requireOperator(input.actorUserId);
    return atomic(() => {
      if (
        !sql
          .prepare('SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?')
          .get(input.workspaceId, input.userId)
      )
        throw new AppError(404, 'MEMBER_NOT_FOUND', '授予对象必须属于目标空间');
      const eventKey = `operator-grant:${input.eventKey}`,
        previous = sql
          .prepare('SELECT 1 FROM credit_lot_operations WHERE event_key=?')
          .get(eventKey);
      if (!previous && input.expiresAt && input.expiresAt <= now())
        throw new AppError(400, 'INVALID_EXPIRY', '人工授予的到期时间必须在未来');
      const result = credits.grant({
        workspaceId: input.workspaceId,
        userId: input.userId,
        eventKey,
        amount: input.amount,
        source: 'manual',
        expiresAt: input.expiresAt,
        archiveMonths: input.archiveMonths,
        description: input.reason,
      });
      if (!previous)
        audit(input.actorUserId, 'credits.granted', input.reason, { ...input, ...result });
      return result;
    });
  }
  function changeCredits(raw: unknown, action: 'extend' | 'restore') {
    const input = creditValiditySchema.parse(raw);
    requireOperator(input.actorUserId);
    return atomic(() => {
      const eventKey = `operator-${action}:${input.eventKey}`,
        previous = sql
          .prepare('SELECT 1 FROM credit_lot_operations WHERE event_key=?')
          .get(eventKey);
      const result = credits.changeLot({
        workspaceId: input.workspaceId,
        userId: input.actorUserId,
        eventKey,
        lotId: input.lotId,
        expiresAt: input.expiresAt,
        reason: input.reason,
        action,
      });
      if (!previous)
        audit(input.actorUserId, `credits.${action}`, input.reason, { ...input, ...result });
      return result;
    });
  }
  return {
    importPlans,
    resolveRisks,
    configureReferrals,
    approveChannel,
    configureEntitlements,
    resolveAppeal,
    grantCredits,
    extendCredits: (raw: unknown) => changeCredits(raw, 'extend'),
    restoreCredits: (raw: unknown) => changeCredits(raw, 'restore'),
  };
}

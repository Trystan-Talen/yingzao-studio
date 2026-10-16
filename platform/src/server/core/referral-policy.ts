import { createBillingPeriods } from '../billing/periods';
import { z } from 'zod';
import {
  referralCredits,
  referralRefundTarget,
  referralPolicyMissing,
  referralPolicySchema,
  type ReferralRuleDto,
} from '../../contracts/referrals';
import { CoreContext, id, now, str, num, type Row } from './shared';
import { createCreditService } from '../tasks/credits';

export interface ReferralProgram {
  registration_enabled: number;
  rewards_enabled: number;
  reward_credits: number;
  minimum_paid_minor: number;
  currency: string;
  version: number;
  policy_json?: string | null;
}
export interface ReferralAttribution {
  id: string;
  referral_id: string;
  program_snapshot_json: string;
  referrer_id: string;
  user_id: string;
  created_at: string;
}
export function referralRule(program: ReferralProgram): ReferralRuleDto {
  let policy = null,
    missingConfiguration: string[] = [];
  if (program.policy_json) {
    try {
      const parsed = referralPolicySchema.safeParse(JSON.parse(program.policy_json));
      if (!parsed.success) missingConfiguration = ['保存的奖励策略无效，需管理员核对'];
      else {
        policy = parsed.data;
        missingConfiguration = referralPolicyMissing(policy);
      }
    } catch {
      missingConfiguration = ['保存的奖励策略无效，需管理员核对'];
    }
  }
  return {
    version: program.version,
    enabled: !!program.rewards_enabled,
    credits: program.reward_credits,
    minimumPaidMinor: program.minimum_paid_minor,
    currency: program.currency,
    policy,
    missingConfiguration,
  };
}
const snapshotSchema = z.object({
  kind: z.literal('subscription'),
  credits: z.number().int().nonnegative().max(1_000_000_000),
  catalog_mode: z.literal('official'),
});

/** New policy only; historical fixed-credit registrations keep their original service path. */
export class PersonalReferralPolicy {
  private credits;
  private periods;
  constructor(private c: CoreContext) {
    this.credits = createCreditService(c.db);
    this.periods = createBillingPeriods(c.db);
  }
  private check(
    orderId: string,
    attributionId: string,
    status: 'blocked' | 'ineligible' | 'qualified',
    reason: string,
  ) {
    this.c.run(
      `INSERT INTO referral_qualification_checks VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,checked_at=excluded.checked_at`,
      orderId,
      attributionId,
      status,
      reason,
      now(),
    );
  }
  private personalSpace(uid: string) {
    return this.c.get(
      `SELECT w.id FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? AND m.role='owner' AND w.kind='personal' AND w.is_demo=0 AND w.archived_at IS NULL ORDER BY w.created_at,w.id LIMIT 1`,
      uid,
    );
  }
  private activeAt(uid: string, paidAt: string) {
    return this.periods.activeAt(uid, paidAt);
  }
  qualify(order: Row, a: ReferralAttribution, program: ReferralProgram) {
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('Referral policy requires payment transaction');
    const oid = str(order, 'id'),
      rule = referralRule(program);
    const reject = (reason: string, blocked = false) =>
      this.check(oid, a.id, blocked ? 'blocked' : 'ineligible', reason);
    if (!rule.enabled) return reject('注册时推荐奖励未启用');
    if (rule.missingConfiguration.length || !rule.policy)
      return reject(rule.missingConfiguration.join('；') || '奖励策略未配置', true);
    const policy = rule.policy;
    if (order.billing_channel !== 'web' || order.kind !== 'subscription')
      return reject('仅个人会员订阅首购参与，算力包与接口充值不参与');
    const purchasedSpace = this.c.get(
      'SELECT kind,is_demo FROM workspaces WHERE id=?',
      order.workspace_id,
    );
    if (!purchasedSpace || purchasedSpace.kind !== 'personal' || purchasedSpace.is_demo)
      return reject('仅真实个人空间的会员订阅参与');
    const paidAt = str(order, 'paid_at'),
      paidTime = Date.parse(paidAt);
    const registration = this.c.get('SELECT created_at FROM users WHERE id=?', a.user_id);
    const registeredTime = Date.parse(str(registration!, 'created_at'));
    if (!Number.isFinite(paidTime) || !Number.isFinite(registeredTime))
      return reject('缺少已核验支付时间或注册时间', true);
    if (
      paidTime < registeredTime ||
      paidTime > registeredTime + policy.registrationWindowDays * 86400000
    )
      return reject('付款不在注册后30天内');
    // Count the person across all personal spaces, including a refunded first purchase.
    const first = this.c.get(
      `SELECT o.id FROM orders o JOIN workspaces w ON w.id=o.workspace_id WHERE o.created_by=? AND w.kind='personal' AND w.is_demo=0 AND o.kind='subscription' AND o.billing_channel='web' AND o.payment_environment='live' AND o.status IN ('paid','refunded') AND o.paid_at IS NOT NULL ORDER BY o.paid_at,o.created_at,o.id LIMIT 1`,
      a.user_id,
    );
    if (!first || first.id !== oid) return reject('该账号已有更早的真实个人订阅首购');
    const existing = this.c.get(
      'SELECT id,qualifying_order_id FROM referral_rewards WHERE attribution_id=?',
      a.id,
    );
    if (existing) {
      if (existing.qualifying_order_id !== oid) {
        // A late webhook can reveal an earlier purchase after another order was rewarded.
        // Keep the auditable original event; never issue a second reward or hide the conflict.
        for (const item of this.c.all(
          'SELECT DISTINCT workspace_id FROM referral_reward_items WHERE reward_id=?',
          existing.id,
        )) {
          const eventKey = `referral-first:${existing.id}:${oid}:${item.workspace_id}`;
          if (this.c.get('SELECT 1 FROM billing_risks WHERE provider_event_id=?', eventKey))
            continue;
          this.c.run(
            "INSERT INTO billing_risks(id,provider_event_id,kind,order_id,workspace_id,amount_minor,created_at,referral_reward_id,billing_channel) VALUES(?,?,'referral-first-purchase-conflict',?,?,0,?,?,'web')",
            id(),
            eventKey,
            oid,
            item.workspace_id,
            now(),
            existing.id,
          );
          this.c.run(
            "UPDATE credit_accounts SET payment_review_required=1 WHERE workspace_id=? AND billing_channel='web'",
            item.workspace_id,
          );
          this.c.run(
            'UPDATE workspace_billing SET payment_review_required=1 WHERE workspace_id=?',
            item.workspace_id,
          );
        }
        return reject('晚到支付记录显示更早首购，已有奖励需人工核对，不会重复发放', true);
      }
      return;
    }
    const requirement = policy.membershipRequirement;
    for (const [uid, label, required] of [
      [
        a.referrer_id,
        '邀请人',
        requirement === 'referrer-active-at-payment' || requirement === 'both-active-at-payment',
      ],
      [
        a.user_id,
        '被邀请人',
        requirement === 'invitee-active-at-payment' || requirement === 'both-active-at-payment',
      ],
    ] as const) {
      if (!required) continue;
      const status = this.activeAt(uid, paidAt);
      if (status === 'unknown')
        return reject(`${label}在付款时的会员历史证据不足，须人工核对`, true);
      if (status !== 'active') return reject(`已配置规则要求${label}在付款时具有有效个人会员`);
    }
    const referrerSpace = this.personalSpace(a.referrer_id),
      inviteeSpace = this.personalSpace(a.user_id);
    if (!referrerSpace || !inviteeSpace) return reject('双方可收取奖励的个人空间尚未就绪', true);
    let rawSnapshot: unknown;
    try {
      rawSnapshot = JSON.parse(str(order, 'plan_snapshot_json'));
    } catch {
      return reject('套餐算力快照无效', true);
    }
    const parsed = snapshotSchema.safeParse(rawSnapshot);
    if (!parsed.success) return reject('缺少已批准的个人订阅算力快照', true);
    const base = parsed.data.credits;
    const allocations = [
      {
        role: 'referrer',
        uid: a.referrer_id,
        wid: str(referrerSpace, 'id'),
        amount: referralCredits(base, policy.referrerBps, policy.rounding),
      },
      {
        role: 'invitee',
        uid: a.user_id,
        wid: str(inviteeSpace, 'id'),
        amount: referralCredits(base, policy.inviteeBps, policy.rounding),
      },
    ] as const;
    const rewardId = id(),
      time = now(),
      expiresAt = new Date(Date.parse(time) + policy.rewardValidityDays * 86400000).toISOString();
    this.c.run(
      'INSERT INTO referral_rewards(id,attribution_id,qualifying_order_id,reward_workspace_id,reward_user_id,credits,created_at,updated_at,policy_snapshot_json) VALUES(?,?,?,?,?,?,?,?,?)',
      rewardId,
      a.id,
      oid,
      allocations[0].wid,
      a.referrer_id,
      allocations[0].amount,
      time,
      time,
      JSON.stringify(policy),
    );
    for (const item of allocations) {
      const itemId = id();
      const grant = this.credits.grant({
        workspaceId: item.wid,
        userId: item.uid,
        eventKey: `referral:${a.id}:${item.role}`,
        amount: item.amount,
        source: 'referral',
        sourceId: itemId,
        expiresAt,
        archiveMonths: 0,
        description:
          item.role === 'referrer'
            ? '邀请个人会员首购：套餐算力15%奖励'
            : '受邀个人会员首购：套餐算力10%奖励',
      });
      this.c.run(
        'INSERT INTO referral_reward_items(id,reward_id,role,workspace_id,user_id,credits,credit_lot_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        itemId,
        rewardId,
        item.role,
        item.wid,
        item.uid,
        item.amount,
        grant.lotId,
        expiresAt,
        time,
        time,
      );
    }
    this.c.run(
      'INSERT INTO referral_events VALUES(?,?,?,?,?,?)',
      id(),
      a.referral_id,
      `qualify:${a.id}`,
      'qualified-purchase',
      allocations[0].amount,
      time,
    );
    this.check(oid, a.id, 'qualified', '个人订阅首购已按注册时规则完成双向奖励');
  }
  reverse(
    order: Row,
    reward: { id: string; attribution_id: string },
    refundedMinor: number,
    sourceEventId: string,
  ) {
    const items = this.c.all(
      'SELECT * FROM referral_reward_items WHERE reward_id=? ORDER BY role',
      reward.id,
    );
    for (const item of items) {
      const target = referralRefundTarget(
        num(item, 'credits'),
        refundedMinor,
        num(order, 'amount_minor'),
      );
      const delta = target - num(item, 'reversed_credits');
      if (delta <= 0) continue;
      const result = this.credits.revokeGrant({
        workspaceId: str(item, 'workspace_id'),
        userId: str(item, 'user_id'),
        lotId: str(item, 'credit_lot_id'),
        targetReversed: target,
        eventKey: `referral-reverse:${item.id}:${target}`,
        description: '首购退款，按比例撤销对应邀请奖励批次',
      });
      this.c.run(
        'UPDATE referral_reward_items SET reversed_credits=?,debt_credits=debt_credits+?,updated_at=? WHERE id=?',
        target,
        result.debt,
        now(),
        item.id,
      );
      if (item.role === 'referrer') {
        this.c.run(
          'UPDATE referral_rewards SET reversed_credits=?,debt_credits=debt_credits+?,updated_at=? WHERE id=?',
          target,
          result.debt,
          now(),
          reward.id,
        );
        const a = this.c.get(
          'SELECT referral_id FROM referral_attributions WHERE id=?',
          reward.attribution_id,
        )!;
        this.c.run(
          'INSERT INTO referral_events VALUES(?,?,?,?,?,?)',
          id(),
          a.referral_id,
          `reverse:${reward.id}:${target}`,
          'refund-reversal',
          -delta,
          now(),
        );
      }
      const mode = this.c.get(
        'SELECT credit_mode FROM workspace_billing WHERE workspace_id=?',
        item.workspace_id,
      );
      const allocated = this.c.get(
        "SELECT COALESCE(SUM(MAX(COALESCE(credit_limit-spent,0),reserved)),0) total FROM member_budgets WHERE workspace_id=? AND billing_channel='web'",
        item.workspace_id,
      )!;
      const overallocated =
        mode?.credit_mode === 'allocated' &&
        num(allocated, 'total') > this.credits.account(str(item, 'workspace_id')).balance;
      if (result.debt || overallocated) {
        this.c.run(
          "UPDATE credit_accounts SET payment_review_required=1 WHERE workspace_id=? AND billing_channel='web'",
          item.workspace_id,
        );
        this.c.run(
          'UPDATE workspace_billing SET payment_review_required=1 WHERE workspace_id=?',
          item.workspace_id,
        );
        this.c.run(
          "INSERT INTO billing_risks(id,provider_event_id,kind,order_id,workspace_id,amount_minor,created_at,referral_reward_id,billing_channel) VALUES(?,?,?,?,?,?,?,?, 'web')",
          id(),
          `referral:${sourceEventId}:${item.id}`,
          result.debt ? 'referral-reversal-debt' : 'referral-budget-reconciliation',
          order.id,
          item.workspace_id,
          result.debt,
          now(),
          reward.id,
        );
      }
    }
  }
}

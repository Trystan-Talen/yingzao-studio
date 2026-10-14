import { CoreContext, id, now, str, num, json, type ListQuery } from './shared';
import type { Actor } from '../../contracts/core';
import { AppError } from '../errors';
import { createCreditService } from '../tasks/credits';
interface Program {
  registration_enabled: number;
  rewards_enabled: number;
  reward_credits: number;
  minimum_paid_minor: number;
  currency: string;
  version: number;
}
interface Attribution {
  id: string;
  referral_id: string;
  program_snapshot_json: string;
  referrer_id: string;
}
interface Reward {
  id: string;
  attribution_id: string;
  qualifying_order_id: string;
  reward_workspace_id: string;
  reward_user_id: string;
  credits: number;
  reversed_credits: number;
  debt_credits: number;
}
export class ReferralService {
  private credits;
  constructor(private c: CoreContext) {
    this.credits = createCreditService(c.db);
  }
  program() {
    return this.c.get<Program>("SELECT * FROM referral_program WHERE id='default'")!;
  }
  lookupCode(code: string) {
    const row = this.c.get('SELECT * FROM referrals WHERE code=?', code);
    if (!row) throw new AppError(400, 'INVALID_REFERRAL', '推荐码不存在');
    return {
      id: str(row, 'id'),
      userId: str(row, 'user_id'),
      registrationEnabled: !!this.program().registration_enabled,
    };
  }
  attribute(userId: string, code: string) {
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('Referral attribution must be part of registration transaction');
    const referral = this.lookupCode(code);
    if (referral.userId === userId)
      throw new AppError(400, 'SELF_REFERRAL', '不能归因到自己的推荐码');
    if (this.c.get('SELECT 1 FROM referral_attributions WHERE user_id=?', userId))
      throw new AppError(409, 'REFERRAL_ALREADY_ATTRIBUTED', '注册推荐来源已经确定');
    this.c.run(
      'INSERT INTO referral_attributions VALUES(?,?,?,?,?)',
      id(),
      userId,
      referral.id,
      JSON.stringify(this.program()),
      now(),
    );
  }
  summary(actor: Actor, wid: string) {
    this.c.requireAccess(actor, wid, 'read');
    const ref = this.c.get('SELECT * FROM referrals WHERE user_id=?', actor.userId);
    const p = this.program();
    const total = ref
      ? this.c.get<{ registered: number; qualified: number; credits: number }>(
          `SELECT COUNT(*) registered,COALESCE(SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END),0) qualified,COALESCE(SUM(r.credits-r.reversed_credits),0) credits FROM referral_attributions a LEFT JOIN referral_rewards r ON r.attribution_id=a.id WHERE a.referral_id=?`,
          str(ref, 'id'),
        )!
      : { registered: 0, qualified: 0, credits: 0 };
    return {
      registeredCount: total.registered,
      qualifiedCount: total.qualified,
      rewardCredits: total.credits,
      registrationEnabled: !!p.registration_enabled,
      rewardsEnabled: !!p.rewards_enabled,
      providerConfigured: !!p.rewards_enabled,
      channelEnabled: !!this.c.get(
        'SELECT 1 FROM channel_partners WHERE user_id=? AND enabled=1',
        actor.userId,
      ),
      rewardRule: p.rewards_enabled
        ? {
            credits: p.reward_credits,
            minimumPaidMinor: p.minimum_paid_minor,
            currency: p.currency,
          }
        : null,
    };
  }
  records(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'read');
    return this.c.page(
      `SELECT a.id,a.created_at,COALESCE(r.credits,0) credits,COALESCE(r.reversed_credits,0) reversed_credits,r.id AS reward_id FROM referral_attributions a JOIN referrals f ON f.id=a.referral_id LEFT JOIN referral_rewards r ON r.attribution_id=a.id WHERE f.user_id=? ORDER BY a.created_at DESC,a.id`,
      [actor.userId],
      q,
      (r) => ({
        id: str(r, 'id'),
        registeredAt: str(r, 'created_at'),
        qualified: !!r.reward_id,
        rewardCredits: num(r, 'credits'),
        reversedCredits: num(r, 'reversed_credits'),
      }),
    );
  }
  channelSummary(actor: Actor, wid: string) {
    this.c.requireAccess(actor, wid, 'read');
    if (!this.c.get('SELECT 1 FROM channel_partners WHERE user_id=? AND enabled=1', actor.userId))
      throw new AppError(403, 'CHANNEL_ACCESS_REQUIRED', '此账户未获渠道统计授权');
    const currency = this.program().currency;
    const paid = this.c.get<{ n: number; amount: number }>(
      `SELECT COUNT(*) n,COALESCE(SUM(o.amount_minor-o.refunded_minor),0) amount FROM orders o JOIN referral_attributions a ON a.user_id=o.created_by JOIN referrals f ON f.id=a.referral_id WHERE f.user_id=? AND o.payment_environment='live' AND o.status IN ('paid','refunded') AND upper(o.currency)=?`,
      actor.userId,
      currency,
    )!;
    return {
      ...this.summary(actor, wid),
      paidOrderCount: paid.n,
      paidAmountMinor: paid.amount,
      currency,
      cashSettlementEnabled: false as const,
    };
  }
  channelCsv(actor: Actor, wid: string) {
    this.channelSummary(actor, wid);
    const all = this.c.all(
      `SELECT a.id,a.created_at,COALESCE(r.credits,0) credits,COALESCE(r.reversed_credits,0) reversed_credits FROM referral_attributions a JOIN referrals f ON f.id=a.referral_id LEFT JOIN referral_rewards r ON r.attribution_id=a.id WHERE f.user_id=? ORDER BY a.created_at`,
      actor.userId,
    );
    return [
      'attribution_id,registered_at,reward_credits,reversed_credits',
      ...all.map((r) => [r.id, r.created_at, r.credits, r.reversed_credits].join(',')),
    ].join('\n');
  }
  qualifyPurchase(orderId: string) {
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('Referral reward must share payment transaction');
    const order = this.c.get('SELECT * FROM orders WHERE id=?', orderId);
    if (!order || order.payment_environment !== 'live' || order.status !== 'paid') return;
    const attribution = this.c.get<Attribution>(
      'SELECT a.*,f.user_id referrer_id FROM referral_attributions a JOIN referrals f ON f.id=a.referral_id WHERE a.user_id=?',
      str(order, 'created_by'),
    );
    if (!attribution || attribution.referrer_id === order.created_by) return;
    const rule = json<Program>(attribution.program_snapshot_json, this.program());
    if (
      !rule.rewards_enabled ||
      rule.reward_credits <= 0 ||
      rule.currency.toUpperCase() !== str(order, 'currency').toUpperCase() ||
      num(order, 'amount_minor') - num(order, 'refunded_minor') < rule.minimum_paid_minor
    )
      return;
    if (this.c.get('SELECT 1 FROM referral_rewards WHERE attribution_id=?', attribution.id)) return;
    const space = this.c.get(
      `SELECT w.id FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? AND m.role='owner' AND w.kind='personal' AND w.is_demo=0 AND w.archived_at IS NULL ORDER BY w.created_at LIMIT 1`,
      attribution.referrer_id,
    );
    if (!space) return;
    const wid = str(space, 'id'),
      rewardId = id(),
      account = this.credits.account(wid);
    if (!Number.isSafeInteger(account.balance + rule.reward_credits))
      throw new AppError(409, 'CREDIT_LIMIT', '推荐额度超出存储范围');
    this.credits.grant({
      workspaceId: wid,
      userId: attribution.referrer_id,
      eventKey: `referral:${attribution.id}`,
      amount: rule.reward_credits,
      source: 'referral',
      sourceId: attribution.id,
      description: '推荐用户首次达标真实支付奖励（无现金结算）',
    });
    this.c.run(
      'INSERT INTO referral_rewards(id,attribution_id,qualifying_order_id,reward_workspace_id,reward_user_id,credits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      rewardId,
      attribution.id,
      orderId,
      wid,
      attribution.referrer_id,
      rule.reward_credits,
      now(),
      now(),
    );
    this.c.run(
      'INSERT INTO referral_events VALUES(?,?,?,?,?,?)',
      id(),
      attribution.referral_id,
      `qualify:${attribution.id}`,
      'qualified-purchase',
      rule.reward_credits,
      now(),
    );
  }
  reversePurchase(orderId: string, refundedMinor: number, sourceEventId: string) {
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('Referral reversal must share refund transaction');
    const reward = this.c.get<Reward>(
        'SELECT * FROM referral_rewards WHERE qualifying_order_id=?',
        orderId,
      ),
      order = this.c.get('SELECT * FROM orders WHERE id=?', orderId);
    if (!reward || !order) return;
    const target = Math.min(
        reward.credits,
        Math.ceil(
          (reward.credits * Math.min(refundedMinor, num(order, 'amount_minor'))) /
            num(order, 'amount_minor'),
        ),
      ),
      delta = target - reward.reversed_credits;
    if (delta <= 0) return;
    const account = this.credits.account(reward.reward_workspace_id),
      deduct = Math.min(delta, account.balance - account.reserved),
      debt = delta - deduct;
    this.credits.debit({
      workspaceId: reward.reward_workspace_id,
      userId: reward.reward_user_id,
      eventKey: `referral-reverse:${reward.id}:${target}`,
      amount: deduct,
      description: '推荐付款退款，按比例冲正推荐奖励',
    });
    this.c.run(
      'UPDATE referral_rewards SET reversed_credits=?,debt_credits=debt_credits+?,updated_at=? WHERE id=?',
      target,
      debt,
      now(),
      reward.id,
    );
    const attribution = this.c.get(
      'SELECT referral_id FROM referral_attributions WHERE id=?',
      reward.attribution_id,
    )!;
    this.c.run(
      'INSERT INTO referral_events VALUES(?,?,?,?,?,?)',
      id(),
      str(attribution, 'referral_id'),
      `reverse:${reward.id}:${target}`,
      'refund-reversal',
      -delta,
      now(),
    );
    const mode = this.c.get(
      'SELECT credit_mode FROM workspace_billing WHERE workspace_id=?',
      reward.reward_workspace_id,
    );
    const allocated = this.c.get(
      'SELECT COALESCE(SUM(MAX(COALESCE(credit_limit-spent,0),reserved)),0) total FROM member_budgets WHERE workspace_id=?',
      reward.reward_workspace_id,
    )!;
    const overallocated =
      mode &&
      str(mode, 'credit_mode') === 'allocated' &&
      num(allocated, 'total') > account.balance - deduct;
    if (debt || overallocated) {
      this.c.run(
        'UPDATE workspace_billing SET payment_review_required=1 WHERE workspace_id=?',
        reward.reward_workspace_id,
      );
      this.c.run(
        'INSERT INTO billing_risks(id,provider_event_id,kind,order_id,workspace_id,amount_minor,created_at,referral_reward_id) VALUES(?,?,?,?,?,?,?,?)',
        id(),
        `referral:${sourceEventId}:${reward.id}`,
        debt ? 'referral-reversal-debt' : 'referral-budget-reconciliation',
        orderId,
        reward.reward_workspace_id,
        debt,
        now(),
        reward.id,
      );
    }
  }
}

import type { BillingChannel } from '../../contracts/billing-channel';
import { randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { now } from './types';
import {
  createCreditLotService,
  type GrantCreditsInput,
  type DebitCreditsInput,
} from './credit-lots';
interface Account {
  balance: number;
  reserved: number;
}
interface Budget {
  credit_limit: number | null;
  spent: number;
  reserved: number;
}
interface LedgerEntry {
  billing_channel: BillingChannel;
  kind: string;
  workspace_id: string;
  user_id: string;
  job_id: string | null;
  item_id: string | null;
  amount: number;
}
export function createCreditService(db: DatabaseContext, billingChannel: BillingChannel = 'web') {
  const sql = db.sqlite;
  const atomic = <T>(fn: () => T): T =>
    sql.inTransaction ? fn() : sql.transaction(fn).immediate();
  function integer(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new AppError(400, 'INVALID_AMOUNT', '额度必须为非负安全整数');
  }
  function rawAccount(wid: string): Account {
    const a = sql
      .prepare(
        'SELECT balance,reserved FROM credit_accounts WHERE workspace_id=? AND billing_channel=?',
      )
      .get(wid, billingChannel) as Account | undefined;
    if (!a) throw new AppError(404, 'CREDIT_ACCOUNT_NOT_FOUND', '工作空间额度账户不存在');
    return a;
  }
  function record(
    wid: string,
    uid: string,
    key: string,
    kind: string,
    amount: number,
    description: string,
    jobId: string | null = null,
    itemId: string | null = null,
  ) {
    const a = rawAccount(wid);
    sql
      .prepare(
        'INSERT INTO credit_ledger(id,workspace_id,user_id,job_id,item_id,event_key,kind,amount,balance_after,reserved_after,description,created_at,billing_channel) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        wid,
        uid,
        jobId,
        itemId,
        key,
        kind,
        amount,
        a.balance,
        a.reserved,
        description,
        now(),
        billingChannel,
      );
  }
  const lots = createCreditLotService(db, record, billingChannel);
  function account(wid: string): Account {
    return atomic(() => {
      lots.sweep(wid);
      return rawAccount(wid);
    });
  }
  function grant(input: GrantCreditsInput) {
    return atomic(() => ({ ...lots.grant(input), ...account(input.workspaceId) }));
  }
  function debit(input: DebitCreditsInput) {
    return atomic(() => ({ ...lots.debit(input), ...account(input.workspaceId) }));
  }
  function initialize(wid: string, uid: string, credits = 0) {
    return atomic(() => {
      integer(credits);
      const existed = !!sql
        .prepare("SELECT 1 FROM credit_accounts WHERE workspace_id=? AND billing_channel='web'")
        .get(wid);
      for (const channel of ['web', 'api'])
        sql
          .prepare(
            'INSERT OR IGNORE INTO credit_accounts(workspace_id,billing_channel,balance,reserved,updated_at) VALUES(?,?,0,0,?)',
          )
          .run(wid, channel, now());
      sql.prepare('INSERT OR IGNORE INTO workspace_billing(workspace_id) VALUES(?)').run(wid);
      sql
        .prepare(
          'INSERT OR IGNORE INTO member_budgets(workspace_id,user_id,billing_channel,credit_limit) VALUES(?,?,?,NULL)',
        )
        .run(wid, uid, billingChannel);
      if (existed) return;
      grant({
        workspaceId: wid,
        userId: uid,
        eventKey: `initial:${wid}`,
        amount: credits,
        source: 'initial',
        description: credits ? '本机初始测试额度，无现金价值' : '建立额度账户',
      });
    });
  }
  function same(
    entry: LedgerEntry,
    wid: string,
    uid: string,
    amount: number,
    jobId: string,
    itemId: string,
  ): boolean {
    return (
      entry.billing_channel === billingChannel &&
      entry.workspace_id === wid &&
      entry.user_id === uid &&
      entry.amount === amount &&
      entry.job_id === jobId &&
      entry.item_id === itemId
    );
  }
  function reserve(wid: string, uid: string, amount: number, jobId: string, itemId: string) {
    return atomic(() => {
      integer(amount);
      const previous = sql
        .prepare('SELECT * FROM credit_ledger WHERE event_key=?')
        .get(`reserve:${itemId}`) as LedgerEntry | undefined;
      if (previous) {
        if (!same(previous, wid, uid, amount, jobId, itemId))
          throw new AppError(409, 'LEDGER_EVENT_CONFLICT', '预留事件与已保存记录不符');
        return;
      }
      const review = sql
        .prepare(
          'SELECT payment_review_required FROM credit_accounts WHERE workspace_id=? AND billing_channel=?',
        )
        .get(wid, billingChannel) as { payment_review_required: number } | undefined;
      if (review?.payment_review_required)
        throw new AppError(
          409,
          'PAYMENT_REVIEW_REQUIRED',
          '此空间有退款或争议待核对，暂停新任务预留，请联系支付管理员',
        );
      const a = account(wid);
      if (a.balance - a.reserved < amount)
        throw new AppError(409, 'INSUFFICIENT_CREDITS', '可用额度不足');
      sql
        .prepare(
          'INSERT OR IGNORE INTO member_budgets(workspace_id,user_id,billing_channel,credit_limit) VALUES(?,?,?,NULL)',
        )
        .run(wid, uid, billingChannel);
      const b = sql
        .prepare(
          'SELECT * FROM member_budgets WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .get(wid, uid, billingChannel) as Budget;
      const mode = (
        sql.prepare('SELECT credit_mode FROM workspace_billing WHERE workspace_id=?').get(wid) as
          { credit_mode: string } | undefined
      )?.credit_mode;
      if (billingChannel === 'web' && mode === 'allocated' && b.credit_limit === null)
        throw new AppError(409, 'BUDGET_NOT_ALLOCATED', '请管理员先分配成员额度');
      if (
        billingChannel === 'web' &&
        b.credit_limit !== null &&
        b.spent + b.reserved + amount > b.credit_limit
      )
        throw new AppError(409, 'MEMBER_BUDGET_EXCEEDED', '本次任务超出成员额度上限');
      lots.reserve(wid, uid, amount, jobId, itemId);
      sql
        .prepare(
          'UPDATE member_budgets SET reserved=reserved+? WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .run(amount, wid, uid, billingChannel);
      record(wid, uid, `reserve:${itemId}`, 'reserve', amount, '任务额度预留', jobId, itemId);
    });
  }
  function finish(
    wid: string,
    uid: string,
    amount: number,
    jobId: string,
    itemId: string,
    success: boolean,
    releaseDescription?: string,
  ) {
    return atomic(() => {
      integer(amount);
      const previous = sql
        .prepare('SELECT * FROM credit_ledger WHERE event_key=?')
        .get(`final:${itemId}`) as LedgerEntry | undefined;
      if (previous) {
        if (
          !same(previous, wid, uid, amount, jobId, itemId) ||
          previous.kind !== (success ? 'settle' : 'release')
        )
          throw new AppError(409, 'LEDGER_EVENT_CONFLICT', '结算事件与已保存记录不符');
        return;
      }
      const reservation = sql
        .prepare('SELECT * FROM credit_ledger WHERE event_key=?')
        .get(`reserve:${itemId}`) as LedgerEntry | undefined;
      if (!reservation || !same(reservation, wid, uid, amount, jobId, itemId))
        throw new AppError(500, 'LEDGER_INVARIANT', '缺少与本项匹配的预留记录');
      const a = account(wid),
        b = sql
          .prepare(
            'SELECT * FROM member_budgets WHERE workspace_id=? AND user_id=? AND billing_channel=?',
          )
          .get(wid, uid, billingChannel) as Budget | undefined;
      if (a.reserved < amount || !b || b.reserved < amount)
        throw new AppError(500, 'LEDGER_INVARIANT', '额度预留记录不一致');
      const expiredRelease = lots.finish(wid, uid, amount, jobId, itemId, success);
      sql
        .prepare(
          'UPDATE member_budgets SET spent=spent+?,reserved=reserved-? WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .run(success ? amount : 0, amount, wid, uid, billingChannel);
      record(
        wid,
        uid,
        `final:${itemId}`,
        success ? 'settle' : 'release',
        amount,
        success ? '任务已完成，结算额度' : (releaseDescription ?? '任务未完成，释放预留'),
        jobId,
        itemId,
      );
      if (expiredRelease)
        record(
          wid,
          uid,
          `expired-release:${itemId}`,
          'adjustment',
          -expiredRelease,
          '释放的预留按原来源封存或失效，不恢复为可用额度',
          jobId,
          itemId,
        );
    });
  }
  function allocatedTotal(wid: string, exceptUser: string | null = null): number {
    return (
      sql
        .prepare(
          'SELECT COALESCE(SUM(MAX(COALESCE(credit_limit-spent,0),reserved)),0) total FROM member_budgets WHERE workspace_id=? AND billing_channel=? AND (? IS NULL OR user_id<>?)',
        )
        .get(wid, billingChannel, exceptUser, exceptUser) as { total: number }
    ).total;
  }
  function budget(wid: string, uid: string, limit: number | null) {
    return atomic(() => {
      if (limit !== null) integer(limit);
      sql
        .prepare(
          'INSERT OR IGNORE INTO member_budgets(workspace_id,user_id,billing_channel,credit_limit) VALUES(?,?,?,NULL)',
        )
        .run(wid, uid, billingChannel);
      const b = sql
        .prepare(
          'SELECT * FROM member_budgets WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .get(wid, uid, billingChannel) as Budget;
      if (limit !== null && limit < b.spent + b.reserved)
        throw new AppError(409, 'BUDGET_BELOW_COMMITTED', '新额度不能低于已使用和已预留额度');
      const mode = (
        sql.prepare('SELECT credit_mode FROM workspace_billing WHERE workspace_id=?').get(wid) as
          { credit_mode: string } | undefined
      )?.credit_mode;
      if (
        billingChannel === 'web' &&
        mode === 'allocated' &&
        allocatedTotal(wid, uid) + Math.max(limit === null ? 0 : limit - b.spent, b.reserved) >
          account(wid).balance
      )
        throw new AppError(409, 'BUDGET_POOL_EXCEEDED', '成员分配总额超过团队未消耗额度');
      sql
        .prepare(
          'UPDATE member_budgets SET credit_limit=? WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .run(limit, wid, uid, billingChannel);
      record(
        wid,
        uid,
        `budget:${randomUUID()}`,
        'adjustment',
        0,
        '成员额度上限更新，团队总额未改变',
      );
    });
  }
  function setMode(wid: string, mode: 'shared' | 'allocated', actorId: string) {
    return atomic(() => {
      const current = sql
        .prepare('SELECT credit_mode FROM workspace_billing WHERE workspace_id=?')
        .get(wid) as { credit_mode: string } | undefined;
      if (!current) throw new AppError(404, 'CREDIT_ACCOUNT_NOT_FOUND', '额度账户不存在');
      if (current.credit_mode === mode) return;
      if (mode === 'allocated') {
        if (allocatedTotal(wid) > account(wid).balance)
          throw new AppError(
            409,
            'BUDGET_POOL_EXCEEDED',
            '已有成员上限超过团队可分配总额，请先调整额度',
          );
      } else {
        sql
          .prepare(
            'UPDATE member_budgets SET credit_limit=NULL WHERE workspace_id=? AND billing_channel=?',
          )
          .run(wid, billingChannel);
        sql.prepare('UPDATE memberships SET credit_limit=NULL WHERE workspace_id=?').run(wid);
      }
      sql.prepare('UPDATE workspace_billing SET credit_mode=? WHERE workspace_id=?').run(mode, wid);
      record(
        wid,
        actorId,
        `budget-mode:${randomUUID()}`,
        'adjustment',
        0,
        mode === 'shared'
          ? '切换共享额度，收回未预留分配，保留在途预留'
          : '切换分配额度，未分配成员需管理员设置上限',
      );
    });
  }
  function releaseMemberBudget(wid: string, uid: string) {
    return atomic(() => {
      const budget = sql
        .prepare(
          'SELECT * FROM member_budgets WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .get(wid, uid, billingChannel) as Budget | undefined;
      if (!budget) return;
      sql
        .prepare(
          'UPDATE member_budgets SET credit_limit=spent+reserved WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .run(wid, uid, billingChannel);
      record(
        wid,
        uid,
        `member-release:${randomUUID()}`,
        'adjustment',
        0,
        '移除成员，收回未预留分配，在途任务仍由原空间结算',
      );
    });
  }
  function refundSettledItem(input: {
    workspaceId: string;
    jobId: string;
    itemId: string;
    credits: number;
    resolutionId: string;
    reason: string;
  }): void {
    if (!sql.inTransaction) throw new Error('Appeal refund must share resolution transaction');
    integer(input.credits);
    if (input.credits === 0) throw new AppError(400, 'INVALID_AMOUNT', '申诉退回额度必须为正数');
    const item = sql
      .prepare('SELECT * FROM job_items WHERE id=? AND job_id=? AND workspace_id=?')
      .get(input.itemId, input.jobId, input.workspaceId) as
      | { user_id: string; status: string; credits: number; billing_channel: BillingChannel }
      | undefined;
    if (item && item.billing_channel !== billingChannel)
      return forChannel(item.billing_channel).refundSettledItem(input);
    const final = sql
      .prepare('SELECT * FROM credit_ledger WHERE event_key=?')
      .get(`final:${input.itemId}`) as LedgerEntry | undefined;
    if (
      !item ||
      item.status !== 'succeeded' ||
      !final ||
      final.kind !== 'settle' ||
      !same(final, input.workspaceId, item.user_id, item.credits, input.jobId, input.itemId)
    )
      throw new AppError(409, 'ITEM_NOT_SETTLED', '只能退回指定空间已完成并结算的任务条目');
    if (input.credits > final.amount)
      throw new AppError(409, 'REFUND_EXCEEDS_SETTLEMENT', '退回额度不能超过原结算额度');
    const previous = sql
      .prepare('SELECT * FROM support_refunds WHERE item_id=?')
      .get(input.itemId) as { resolution_id: string; credits: number } | undefined;
    if (previous) {
      if (previous.resolution_id === input.resolutionId && previous.credits === input.credits)
        return;
      throw new AppError(409, 'ITEM_ALREADY_REFUNDED', '此条目已有申诉退回记录，不能重复退回');
    }
    const a = account(input.workspaceId),
      b = sql
        .prepare(
          'SELECT * FROM member_budgets WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .get(input.workspaceId, item.user_id, billingChannel) as Budget | undefined;
    if (!b || b.spent < input.credits || !Number.isSafeInteger(a.balance + input.credits))
      throw new AppError(409, 'LEDGER_INVARIANT', '成员用量或账户余额不支持此次冲正');
    const currentMember = !!sql
      .prepare('SELECT id FROM memberships WHERE workspace_id=? AND user_id=?')
      .get(input.workspaceId, item.user_id);
    const refunded = lots.refund(
      input.workspaceId,
      item.user_id,
      input.jobId,
      input.itemId,
      input.credits,
    );
    sql
      .prepare(
        'UPDATE member_budgets SET spent=spent-?,credit_limit=? WHERE workspace_id=? AND user_id=? AND billing_channel=?',
      )
      .run(
        input.credits,
        !currentMember && b.credit_limit !== null
          ? Math.max(b.reserved, b.credit_limit - input.credits)
          : b.credit_limit,
        input.workspaceId,
        item.user_id,
        billingChannel,
      );
    sql
      .prepare('INSERT INTO support_refunds VALUES(?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        input.resolutionId,
        input.itemId,
        input.jobId,
        input.workspaceId,
        item.user_id,
        input.credits,
        now(),
      );
    record(
      input.workspaceId,
      item.user_id,
      `appeal-refund:${input.itemId}`,
      'adjustment',
      refunded.available,
      `${input.reason}；可用 ${refunded.available}，封存 ${refunded.archived}，已过期 ${refunded.expired}（保留原有效期）`,
      input.jobId,
      input.itemId,
    );
  }
  function forChannel(channel: BillingChannel): CreditService {
    return channel === billingChannel ? service : createCreditService(db, channel);
  }
  const service = {
    billingChannel,
    forChannel,
    account,
    record,
    initialize,
    reserve,
    finish,
    budget,
    setMode,
    releaseMemberBudget,
    refundSettledItem,
    grant,
    debit,
    revokeGrant: lots.revokeGrant,
    revokePrepaid: lots.revokePrepaid,
    reconcilePrepaidValidity: lots.reconcilePrepaidValidity,
    buckets: lots.buckets,
    changeLot: lots.change,
    renewSource: lots.renew,
  };
  return service;
}
export type CreditService = ReturnType<typeof createCreditService>;

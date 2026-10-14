import { randomUUID } from 'node:crypto';
import type { CreditBucketDto } from '../../contracts/credits';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { now } from './types';
export type CreditSource =
  'initial' | 'subscription' | 'pack' | 'referral' | 'redemption' | 'manual' | 'legacy-refund';
export interface GrantCreditsInput {
  workspaceId: string;
  userId: string;
  eventKey: string;
  amount: number;
  source: CreditSource;
  sourceId?: string;
  expiresAt?: string | null;
  archiveMonths?: number;
  description: string;
}
export interface DebitCreditsInput {
  workspaceId: string;
  userId: string;
  eventKey: string;
  amount: number;
  description: string;
}
export interface ChangeLotInput {
  workspaceId: string;
  userId: string;
  eventKey: string;
  lotId: string;
  expiresAt: string;
  reason: string;
  action: 'extend' | 'restore';
}
interface Lot {
  id: string;
  workspace_id: string;
  user_id: string;
  source: CreditBucketDto['source'];
  source_id: string | null;
  event_key: string;
  granted: number;
  remaining: number;
  reserved: number;
  status: 'active' | 'archived' | 'expired';
  expires_at: string | null;
  archive_months: number;
  archive_until: string | null;
  created_at: string;
  updated_at: string;
}
interface Allocation {
  item_id: string;
  lot_id: string;
  workspace_id: string;
  job_id: string;
  user_id: string;
  amount: number;
  status: 'reserved' | 'settled' | 'released';
  refunded: number;
}
type RecordLedger = (
  wid: string,
  uid: string,
  key: string,
  kind: string,
  amount: number,
  description: string,
  jobId?: string | null,
  itemId?: string | null,
) => void;
export function addUtcMonths(value: string, months: number): string {
  const date = new Date(value),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, end));
  return date.toISOString();
}
function expiryIso(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new AppError(400, 'INVALID_EXPIRY', '额度有效期必须是合法时间');
  return new Date(time).toISOString();
}
/** Every lot mutation and the corresponding aggregate/ledger update share one write transaction. */
export function createCreditLotService(db: DatabaseContext, record: RecordLedger) {
  const sql = db.sqlite,
    atomic = <T>(fn: () => T): T => (sql.inTransaction ? fn() : sql.transaction(fn).immediate());
  function integer(n: number) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new AppError(400, 'INVALID_AMOUNT', '额度必须为非负安全整数');
  }
  function sync(wid: string) {
    const value = sql
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN status='active' THEN remaining ELSE reserved END),0) balance,COALESCE(SUM(reserved),0) reserved FROM credit_lots WHERE workspace_id=?",
      )
      .get(wid) as { balance: number; reserved: number };
    if (!Number.isSafeInteger(value.balance) || !Number.isSafeInteger(value.reserved))
      throw new AppError(409, 'CREDIT_LIMIT', '额度超出安全存储范围');
    sql
      .prepare('UPDATE credit_accounts SET balance=?,reserved=?,updated_at=? WHERE workspace_id=?')
      .run(value.balance, value.reserved, now(), wid);
  }
  function event(
    lot: Lot,
    key: string,
    kind: string,
    amount: number,
    details: unknown,
    uid = lot.user_id,
  ) {
    sql
      .prepare('INSERT INTO credit_lot_events VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        lot.id,
        lot.workspace_id,
        uid,
        key,
        kind,
        amount,
        JSON.stringify(details),
        now(),
      );
  }
  function operation<T>(
    wid: string,
    uid: string,
    key: string,
    kind: string,
    input: unknown,
    fn: () => T,
  ): T {
    if (!key || key.length > 300) throw new AppError(400, 'INVALID_EVENT_KEY', '额度事件标识无效');
    const encoded = JSON.stringify(input, (_key, value: unknown) =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      ),
      previous = sql.prepare('SELECT * FROM credit_lot_operations WHERE event_key=?').get(key) as
        | {
            workspace_id: string;
            user_id: string;
            kind: string;
            input_json: string;
            result_json: string;
          }
        | undefined;
    if (previous) {
      if (
        previous.workspace_id !== wid ||
        previous.user_id !== uid ||
        previous.kind !== kind ||
        previous.input_json !== encoded
      )
        throw new AppError(409, 'LEDGER_EVENT_CONFLICT', '额度操作与原事件不一致');
      return JSON.parse(previous.result_json) as T;
    }
    const result = fn();
    sql
      .prepare('INSERT INTO credit_lot_operations VALUES(?,?,?,?,?,?,?)')
      .run(key, wid, uid, kind, encoded, JSON.stringify(result), now());
    return result;
  }
  function rows(wid: string) {
    return sql
      .prepare(
        'SELECT * FROM credit_lots WHERE workspace_id=? ORDER BY expires_at IS NULL,expires_at,created_at,rowid',
      )
      .all(wid) as Lot[];
  }
  function sweep(wid: string) {
    return atomic(() => {
      const time = now();
      for (const lot of rows(wid)) {
        if (lot.status === 'active' && lot.expires_at && lot.expires_at <= time) {
          const archived = !!lot.archive_until && lot.archive_until > time,
            unused = lot.remaining - lot.reserved,
            next = archived ? 'archived' : 'expired';
          sql
            .prepare('UPDATE credit_lots SET status=?,remaining=?,updated_at=? WHERE id=?')
            .run(next, archived ? lot.remaining : lot.reserved, time, lot.id);
          sync(wid);
          const key = `lot-expire:${lot.id}:${lot.expires_at}`;
          event(lot, key, next, -unused, {
            expiresAt: lot.expires_at,
            archiveUntil: lot.archive_until,
            preservedReserved: lot.reserved,
          });
          record(
            wid,
            lot.user_id,
            key,
            'adjustment',
            -unused,
            archived ? '来源额度已到期封存，保留在途预留' : '来源额度已到期失效，保留在途预留',
          );
        } else if (lot.status === 'archived' && lot.archive_until && lot.archive_until <= time) {
          const unused = lot.remaining - lot.reserved;
          sql
            .prepare(
              "UPDATE credit_lots SET status='expired',remaining=reserved,updated_at=? WHERE id=?",
            )
            .run(time, lot.id);
          const key = `lot-purge:${lot.id}:${lot.archive_until}`;
          event(lot, key, 'purged', -unused, {
            archiveUntil: lot.archive_until,
            preservedReserved: lot.reserved,
          });
          record(
            wid,
            lot.user_id,
            key,
            'adjustment',
            0,
            '封存期限已过，清除未恢复额度（此前已从可用余额移除）',
          );
        }
      }
    });
  }
  function grant(raw: GrantCreditsInput) {
    integer(raw.amount);
    const expiresAt = raw.expiresAt ? expiryIso(raw.expiresAt) : null,
      months = raw.archiveMonths ?? 0;
    if (!Number.isSafeInteger(months) || months < 0 || months > 12 || (!expiresAt && months))
      throw new AppError(400, 'INVALID_EXPIRY', '封存时限须关联到期时间且为0至12个月');
    const input = { ...raw, sourceId: raw.sourceId ?? null, expiresAt, archiveMonths: months };
    return atomic(() => {
      sweep(raw.workspaceId);
      return operation(raw.workspaceId, raw.userId, raw.eventKey, 'grant', input, () => {
        const account = sql
          .prepare('SELECT balance FROM credit_accounts WHERE workspace_id=?')
          .get(raw.workspaceId) as { balance: number } | undefined;
        if (!account) throw new AppError(404, 'CREDIT_ACCOUNT_NOT_FOUND', '额度账户不存在');
        if (!Number.isSafeInteger(account.balance + raw.amount))
          throw new AppError(409, 'CREDIT_LIMIT', '额度超出安全存储范围');
        let lotId: string | null = null;
        if (raw.amount) {
          lotId = randomUUID();
          const time = now();
          sql
            .prepare(
              "INSERT INTO credit_lots(id,workspace_id,user_id,source,source_id,event_key,granted,remaining,reserved,status,expires_at,archive_months,archive_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,'active',?,?,?,?,?)",
            )
            .run(
              lotId,
              raw.workspaceId,
              raw.userId,
              raw.source,
              input.sourceId,
              raw.eventKey,
              raw.amount,
              raw.amount,
              expiresAt,
              months,
              expiresAt && months ? addUtcMonths(expiresAt, months) : null,
              time,
              time,
            );
          sync(raw.workspaceId);
          event(
            sql.prepare('SELECT * FROM credit_lots WHERE id=?').get(lotId) as Lot,
            raw.eventKey,
            'grant',
            raw.amount,
            { source: raw.source, sourceId: input.sourceId, expiresAt },
          );
        }
        record(raw.workspaceId, raw.userId, raw.eventKey, 'grant', raw.amount, raw.description);
        sweep(raw.workspaceId);
        return { lotId };
      });
    });
  }
  function take(wid: string, amount: number, fn: (lot: Lot, part: number) => void) {
    let remaining = amount;
    for (const lot of rows(wid).filter((l) => l.status === 'active')) {
      const part = Math.min(remaining, lot.remaining - lot.reserved);
      if (!part) continue;
      fn(lot, part);
      remaining -= part;
      if (!remaining) break;
    }
    if (remaining) throw new AppError(409, 'INSUFFICIENT_CREDITS', '有效来源额度不足');
  }
  function debit(input: DebitCreditsInput) {
    integer(input.amount);
    return atomic(() => {
      sweep(input.workspaceId);
      return operation(input.workspaceId, input.userId, input.eventKey, 'debit', input, () => {
        take(input.workspaceId, input.amount, (lot, part) => {
          sql
            .prepare('UPDATE credit_lots SET remaining=remaining-?,updated_at=? WHERE id=?')
            .run(part, now(), lot.id);
          event(
            lot,
            `${input.eventKey}:${lot.id}`,
            'debit',
            -part,
            { description: input.description },
            input.userId,
          );
        });
        sync(input.workspaceId);
        record(
          input.workspaceId,
          input.userId,
          input.eventKey,
          'adjustment',
          -input.amount,
          input.description,
        );
        return { debited: input.amount };
      });
    });
  }
  function reserve(wid: string, uid: string, amount: number, jobId: string, itemId: string) {
    if (!sql.inTransaction) throw new Error('Lot reserve requires transaction');
    sweep(wid);
    take(wid, amount, (lot, part) => {
      sql
        .prepare('UPDATE credit_lots SET reserved=reserved+?,updated_at=? WHERE id=?')
        .run(part, now(), lot.id);
      sql
        .prepare("INSERT INTO credit_lot_allocations VALUES(?,?,?,?,?,?,'reserved',0,?,?)")
        .run(itemId, lot.id, wid, jobId, uid, part, now(), now());
      event(lot, `lot-reserve:${itemId}:${lot.id}`, 'reserve', part, { jobId, itemId }, uid);
    });
    sync(wid);
  }
  function finish(
    wid: string,
    uid: string,
    amount: number,
    jobId: string,
    itemId: string,
    success: boolean,
  ) {
    if (!sql.inTransaction) throw new Error('Lot settlement requires transaction');
    sweep(wid);
    const allocations = sql
      .prepare(
        'SELECT * FROM credit_lot_allocations WHERE item_id=? AND workspace_id=? AND job_id=? AND user_id=?',
      )
      .all(itemId, wid, jobId, uid) as Allocation[];
    if (
      allocations.reduce((n, a) => n + a.amount, 0) !== amount ||
      allocations.some((a) => a.status !== 'reserved')
    )
      throw new AppError(500, 'LOT_INVARIANT', '预留来源与任务结算不一致');
    let expiredRelease = 0;
    for (const allocation of allocations) {
      const lot = sql.prepare('SELECT * FROM credit_lots WHERE id=?').get(allocation.lot_id) as Lot;
      if (lot.reserved < allocation.amount)
        throw new AppError(500, 'LOT_INVARIANT', '来源预留不足');
      if (!success && lot.status !== 'active') expiredRelease += allocation.amount;
      sql
        .prepare(
          'UPDATE credit_lots SET remaining=remaining-?,reserved=reserved-?,updated_at=? WHERE id=?',
        )
        .run(
          success || lot.status === 'expired' ? allocation.amount : 0,
          allocation.amount,
          now(),
          lot.id,
        );
      sql
        .prepare(
          'UPDATE credit_lot_allocations SET status=?,updated_at=? WHERE item_id=? AND lot_id=?',
        )
        .run(success ? 'settled' : 'released', now(), itemId, lot.id);
      event(
        lot,
        `lot-final:${itemId}:${lot.id}`,
        success ? 'settle' : 'release',
        allocation.amount,
        { jobId, itemId, sourceStatus: lot.status },
        uid,
      );
    }
    sync(wid);
    return expiredRelease;
  }
  function refund(wid: string, uid: string, jobId: string, itemId: string, amount: number) {
    if (!sql.inTransaction) throw new Error('Lot refund requires transaction');
    sweep(wid);
    const allocations = sql
      .prepare(
        'SELECT a.* FROM credit_lot_allocations a JOIN credit_lots l ON l.id=a.lot_id WHERE a.item_id=? AND a.workspace_id=? AND a.job_id=? AND a.user_id=? ORDER BY l.expires_at IS NULL,l.expires_at,l.created_at,l.rowid',
      )
      .all(itemId, wid, jobId, uid) as Allocation[];
    if (!allocations.length) {
      // Historical settlements predate lot attribution. Never invent their old expiry.
      const lotId = randomUUID(),
        time = now();
      sql
        .prepare(
          "INSERT INTO credit_lots(id,workspace_id,user_id,source,source_id,event_key,granted,remaining,status,created_at,updated_at) VALUES(?,?,?,'legacy-refund',?,?,?,?,'active',?,?)",
        )
        .run(lotId, wid, uid, itemId, `legacy-refund:${itemId}`, amount, amount, time, time);
      event(
        sql.prepare('SELECT * FROM credit_lots WHERE id=?').get(lotId) as Lot,
        `lot-refund:${itemId}:legacy`,
        'refund',
        amount,
        { jobId, itemId, legacyExpiryUnknown: true },
        uid,
      );
      sync(wid);
      return { available: amount, archived: 0, expired: 0 };
    }
    if (
      allocations.some((a) => a.status !== 'settled') ||
      allocations.reduce((n, a) => n + a.amount - a.refunded, 0) < amount
    )
      throw new AppError(409, 'LOT_REFUND_EXCEEDED', '退回额度超过原来源的已结算额度');
    let left = amount,
      available = 0,
      archived = 0,
      expired = 0;
    for (const allocation of allocations) {
      const part = Math.min(left, allocation.amount - allocation.refunded);
      if (!part) continue;
      const lot = sql.prepare('SELECT * FROM credit_lots WHERE id=?').get(allocation.lot_id) as Lot;
      if (lot.status === 'active') available += part;
      else if (lot.status === 'archived') archived += part;
      else expired += part;
      if (lot.status !== 'expired')
        sql
          .prepare('UPDATE credit_lots SET remaining=remaining+?,updated_at=? WHERE id=?')
          .run(part, now(), lot.id);
      sql
        .prepare(
          'UPDATE credit_lot_allocations SET refunded=refunded+?,updated_at=? WHERE item_id=? AND lot_id=?',
        )
        .run(part, now(), itemId, lot.id);
      event(
        lot,
        `lot-refund:${itemId}:${lot.id}`,
        'refund',
        part,
        { sourceStatus: lot.status, jobId, itemId },
        uid,
      );
      left -= part;
      if (!left) break;
    }
    sync(wid);
    return { available, archived, expired };
  }
  function change(input: ChangeLotInput) {
    const expiresAt = expiryIso(input.expiresAt);
    return atomic(() => {
      sweep(input.workspaceId);
      return operation(
        input.workspaceId,
        input.userId,
        input.eventKey,
        input.action,
        { ...input, expiresAt },
        () => {
          const lot = sql
            .prepare('SELECT * FROM credit_lots WHERE id=? AND workspace_id=?')
            .get(input.lotId, input.workspaceId) as Lot | undefined;
          if (!lot) throw new AppError(404, 'LOT_NOT_FOUND', '额度来源不存在');
          if (expiresAt <= now()) throw new AppError(400, 'INVALID_EXPIRY', '新的有效期必须在未来');
          if (input.action === 'restore' ? lot.status !== 'archived' : lot.status !== 'active')
            throw new AppError(409, 'LOT_STATE', '只能恢复仍在封存期的来源，或延长尚未到期的来源');
          if (input.action === 'extend' && (!lot.expires_at || expiresAt <= lot.expires_at))
            throw new AppError(
              409,
              'EXPIRY_NOT_EXTENDED',
              '延期必须晚于原到期时间，永久来源无需延期',
            );
          sql
            .prepare(
              "UPDATE credit_lots SET status='active',expires_at=?,archive_until=?,updated_at=? WHERE id=?",
            )
            .run(
              expiresAt,
              lot.archive_months ? addUtcMonths(expiresAt, lot.archive_months) : null,
              now(),
              lot.id,
            );
          const restored = input.action === 'restore' ? lot.remaining - lot.reserved : 0;
          sync(input.workspaceId);
          event(
            lot,
            input.eventKey,
            input.action,
            restored,
            { beforeExpiresAt: lot.expires_at, expiresAt, reason: input.reason },
            input.userId,
          );
          record(
            input.workspaceId,
            input.userId,
            input.eventKey,
            'adjustment',
            restored,
            input.reason,
          );
          return { lotId: lot.id, restored };
        },
      );
    });
  }
  function renew(
    wid: string,
    uid: string,
    source: 'subscription' | 'pack',
    expiresAt: string,
    eventKey: string,
  ) {
    if (!sql.inTransaction) throw new Error('Source renewal must share payment transaction');
    sweep(wid);
    if (expiresAt <= now()) return;
    for (const lot of rows(wid).filter(
      (l) =>
        l.source === source &&
        (l.status === 'active' || (source === 'subscription' && l.status === 'archived')),
    )) {
      if (lot.status === 'active' && (!lot.expires_at || lot.expires_at >= expiresAt)) continue;
      change({
        workspaceId: wid,
        userId: uid,
        lotId: lot.id,
        eventKey: `renew:${eventKey}:${lot.id}`,
        action: lot.status === 'archived' ? 'restore' : 'extend',
        expiresAt,
        reason: '已验证的新付款延长同类来源有效期并恢复尚在封存期的会员额度',
      });
    }
  }
  function buckets(wid: string): CreditBucketDto[] {
    return atomic(() => {
      sweep(wid);
      return rows(wid).map((l) => ({
        id: l.id,
        workspaceId: l.workspace_id,
        source: l.source,
        sourceId: l.source_id,
        granted: l.granted,
        remaining: l.remaining,
        reserved: l.reserved,
        available: l.status === 'active' ? l.remaining - l.reserved : 0,
        archived: l.status === 'archived' ? l.remaining - l.reserved : 0,
        status: l.status,
        expiresAt: l.expires_at,
        archiveUntil: l.archive_until,
        createdAt: l.created_at,
        updatedAt: l.updated_at,
      }));
    });
  }
  return { sweep, grant, debit, reserve, finish, refund, change, renew, buckets };
}

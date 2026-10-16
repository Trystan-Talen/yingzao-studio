import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import {
  promotionMissing,
  promotionSchema,
  promotionSnapshotSchema,
  type Promotion,
  type PromotionOffer,
  type PromotionSnapshot,
} from '../../contracts/promotions';

export function createPromotions(db: DatabaseContext) {
  const sql = db.sqlite;
  function eligibility(
    p: Promotion,
    userId: string,
    workspaceId: string,
    environment: 'test' | 'live',
    excludeOrder?: string,
  ) {
    const workspace = sql.prepare('SELECT kind FROM workspaces WHERE id=?').get(workspaceId) as
      { kind: string } | undefined;
    if (p.eligibility === 'first-personal-membership' && workspace?.kind !== 'personal')
      return '首购活动仅适用于个人空间会员';
    if (p.eligibility === 'all') return '';
    const history = sql
      .prepare(
        `SELECT 1 FROM orders o JOIN workspaces w ON w.id=o.workspace_id WHERE o.created_by=? AND o.billing_channel='web' AND o.payment_environment=? AND o.status IN('paid','refunded') AND o.id<>? ${p.refundedPurchasesCount ? '' : 'AND o.refunded_minor<o.amount_minor'} ${p.eligibility === 'first-personal-membership' ? "AND o.kind='subscription' AND w.kind='personal'" : ''} LIMIT 1`,
      )
      .get(userId, environment, excludeOrder ?? '');
    return history ? '此账号已有符合范围的付款记录，不再符合首购优惠' : '';
  }
  function offer(
    raw: string | null | undefined,
    basePrice: number,
    userId: string,
    workspaceId: string,
    environment: 'test' | 'live',
    at = new Date().toISOString(),
  ): PromotionOffer | null {
    if (!raw) return null;
    const p = promotionSchema.parse(JSON.parse(raw));
    const missing = promotionMissing(p);
    let status: PromotionOffer['status'] = 'available',
      reason = '';
    if (!p.enabled) {
      status = 'disabled';
      reason = '活动未启用';
    } else if (missing.length) {
      status = 'unconfigured';
      reason = missing.join('；');
    } else if (at < p.startsAt) {
      status = 'upcoming';
      reason = '活动尚未开始';
    } else if (at >= p.endsAt) {
      status = 'ended';
      reason = '活动已结束';
    } else if (Date.parse(p.endsAt) - Date.parse(at) < 31 * 60 * 1000) {
      status = 'ineligible';
      reason = '活动剩余不足31分钟，已停止新建优惠支付会话';
    } else if ((reason = eligibility(p, userId, workspaceId, environment))) status = 'ineligible';
    return {
      definition: p,
      status,
      reason,
      originalPriceMinor: basePrice,
      priceMinor: status === 'available' ? p.priceMinor : basePrice,
    };
  }
  function assertCheckout(input: {
    orderId: string;
    userId: string;
    workspaceId: string;
    environment: 'test' | 'live';
    snapshot?: PromotionSnapshot | null;
    at?: string;
  }) {
    if (!sql.inTransaction) throw new Error('Promotion checkout requires transaction');
    const at = input.at ?? new Date().toISOString();
    const otherClaim = sql
      .prepare(
        "SELECT order_id FROM promotion_claims WHERE user_id=? AND environment=? AND status='reserved' AND order_id<>?",
      )
      .get(input.userId, input.environment, input.orderId);
    if (otherClaim)
      throw new AppError(
        409,
        'PROMOTION_PENDING',
        '此账号有首购优惠支付结果待确认，请先处理原订单',
      );
    if (!input.snapshot) return undefined;
    const p = promotionSnapshotSchema.parse(input.snapshot).definition;
    const reason =
      promotionMissing(p).join('；') ||
      (!p.enabled
        ? '活动未启用'
        : at < p.startsAt
          ? '活动尚未开始'
          : at >= p.endsAt
            ? '活动已结束'
            : eligibility(p, input.userId, input.workspaceId, input.environment, input.orderId));
    if (reason) throw new AppError(409, 'PROMOTION_UNAVAILABLE', reason);
    const expires = Math.min(Date.parse(p.endsAt), Date.parse(at) + 24 * 60 * 60 * 1000);
    // Stripe requires at least 30 minutes; reserve a small transport margin.
    if (expires - Date.parse(at) < 31 * 60 * 1000)
      throw new AppError(
        409,
        'PROMOTION_CLOSING',
        '活动剩余时间不足以建立有效支付会话，请选择普通套餐',
      );
    if (p.eligibility !== 'all') {
      const pending = sql
        .prepare(
          "SELECT 1 FROM orders o JOIN stripe_checkouts s ON s.order_id=o.id WHERE o.created_by=? AND o.payment_environment=? AND o.status='pending' AND o.id<>? LIMIT 1",
        )
        .get(input.userId, input.environment, input.orderId);
      if (pending)
        throw new AppError(
          409,
          'PROMOTION_PENDING',
          '此账号有其他支付结果待确认，暂不能占用首购资格',
        );
      sql
        .prepare(
          "INSERT INTO promotion_claims VALUES(?,?,?,?,?,'reserved',?,?) ON CONFLICT(order_id) DO UPDATE SET status='reserved',updated_at=excluded.updated_at",
        )
        .run(input.orderId, input.userId, input.environment, p.id, p.version, at, at);
    }
    return Math.floor(expires / 1000);
  }
  function complete(orderId: string, paid: boolean) {
    if (!sql.inTransaction) throw new Error('Promotion completion requires transaction');
    sql
      .prepare(
        "UPDATE promotion_claims SET status=?,updated_at=? WHERE order_id=? AND status='reserved'",
      )
      .run(paid ? 'consumed' : 'released', new Date().toISOString(), orderId);
  }
  return { offer, eligibility, assertCheckout, complete };
}

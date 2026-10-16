import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { now } from '../tasks/types';
export type PaymentEnvironment = 'test' | 'live';
export function boundPaymentEnvironment(db: DatabaseContext): PaymentEnvironment | undefined {
  return (
    db.sqlite
      .prepare("SELECT environment FROM billing_environment_binding WHERE id='installation'")
      .get() as { environment: PaymentEnvironment } | undefined
  )?.environment;
}
/** Balances have no environment dimension: a configured database cannot serve both money environments. */
export function bindPaymentEnvironment(db: DatabaseContext, environment: PaymentEnvironment) {
  const sql = db.sqlite;
  const apply = () => {
    const bound = boundPaymentEnvironment(db);
    const other = sql
      .prepare(
        `SELECT 1 FROM orders o WHERE o.payment_environment<>? AND (
      o.status IN('paid','refunded') OR EXISTS(SELECT 1 FROM stripe_checkouts c WHERE c.order_id=o.id)
      OR EXISTS(SELECT 1 FROM billing_fulfillments f WHERE f.order_id=o.id)
      OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.source_order_id=o.id)
      OR EXISTS(SELECT 1 FROM prepaid_membership_purchases p WHERE p.order_id=o.id)
    ) LIMIT 1`,
      )
      .get(environment);
    if ((bound && bound !== environment) || other)
      throw new AppError(
        409,
        'PAYMENT_DATABASE_ENVIRONMENT',
        '此数据库已绑定其他支付环境，或含异环境/环境未核验的支付权益事实；测试与正式支付必须使用独立数据库，禁止切换密钥后沿用原余额',
      );
    sql
      .prepare(
        "INSERT OR IGNORE INTO billing_environment_binding(id,environment,created_at) VALUES('installation',?,?)",
      )
      .run(environment, now());
  };
  return sql.inTransaction ? apply() : sql.transaction(apply).immediate();
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseContext } from '../../db/connection';
import { identityCrypto } from './crypto';
import type { SmsConfig, SmsGateway } from './types';
import { createAliyunSmsGateway, isAliyunSmsConfigured } from './aliyun';
const payloadSchema = z
  .object({
    phone: z.string().regex(/^\+861[3-9]\d{9}$/),
    code: z.string().regex(/^\d{6}$/),
    challengeId: z.string().uuid(),
  })
  .strict();
interface Delivery {
  id: string;
  challenge_id: string;
  payload_ciphertext: string;
  expires_at: string;
}
export function createSmsQueue(
  db: DatabaseContext,
  secret: string,
  config: SmsConfig | undefined,
  clock: () => Date,
  gateway?: SmsGateway,
) {
  const sql = db.sqlite,
    crypto = identityCrypto(secret),
    at = () => clock().toISOString();
  const enabled = !!config?.enabled && isAliyunSmsConfigured(config);
  const owner = randomUUID();
  let running: Promise<void> | null = null,
    stopped = false;
  function cleanup() {
    sql
      .prepare(
        "UPDATE sms_deliveries SET status='cancelled',payload_ciphertext=NULL,lease_owner=NULL,lease_until=NULL,error_code='SOURCE_EXPIRED',updated_at=? WHERE expires_at<=? AND status IN('queued','sending','reconciliation_required')",
      )
      .run(at(), at());
    sql
      .prepare(
        "UPDATE sms_challenges SET revoked_at=?,code_hash='',phone_ciphertext='' WHERE expires_at<=? AND revoked_at IS NULL",
      )
      .run(at(), at());
    sql
      .prepare(
        'UPDATE identity_registrations SET identity_ciphertext=NULL WHERE expires_at<=? OR consumed_at IS NOT NULL',
      )
      .run(at());
    sql
      .prepare(
        "UPDATE wechat_auth_flows SET status='expired' WHERE expires_at<=? AND status IN('pending','exchanging')",
      )
      .run(at());
    sql.prepare('DELETE FROM identity_rate_limits WHERE expires_at<=?').run(clock().getTime());
  }
  function enqueue(challengeId: string, phone: string, code: string, expires: string) {
    if (!enabled) throw new Error('SMS delivery is disabled');
    const id = randomUUID();
    const payload = crypto.seal(
      payloadSchema.parse({ phone, code, challengeId }),
      `sms-delivery\0${id}\0${challengeId}`,
    );
    sql
      .prepare(
        "INSERT INTO sms_deliveries(id,challenge_id,payload_ciphertext,status,created_at,updated_at,expires_at) VALUES(?,?,?,'queued',?,?,?)",
      )
      .run(id, challengeId, payload, at(), at(), expires);
  }
  function claim() {
    cleanup();
    if (!enabled) return;
    return sql
      .transaction(() => {
        sql
          .prepare(
            "UPDATE sms_deliveries SET status='reconciliation_required',payload_ciphertext=NULL,lease_owner=NULL,lease_until=NULL,error_code='WORKER_ACCEPTANCE_UNKNOWN',updated_at=? WHERE status='sending' AND lease_until<=?",
          )
          .run(at(), at());
        const rows = sql
          .prepare(
            "SELECT * FROM sms_deliveries WHERE status='queued' ORDER BY created_at,id LIMIT 100",
          )
          .all() as Delivery[];
        for (const row of rows) {
          const source = sql
            .prepare(
              'SELECT * FROM sms_challenges WHERE id=? AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at>?',
            )
            .get(row.challenge_id, at()) as
            | {
                user_id: string | null;
                session_hash: string | null;
                password_revision: number | null;
              }
            | undefined;
          if (
            !source ||
            (source.user_id &&
              !sql
                .prepare(
                  'SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.password_revision=?',
                )
                .get(source.session_hash, source.user_id, at(), source.password_revision))
          ) {
            sql
              .prepare(
                "UPDATE sms_deliveries SET status='cancelled',payload_ciphertext=NULL,error_code='SOURCE_NO_LONGER_VALID',updated_at=? WHERE id=?",
              )
              .run(at(), row.id);
            continue;
          }
          let payload: z.infer<typeof payloadSchema>;
          try {
            payload = payloadSchema.parse(
              crypto.open(row.payload_ciphertext, `sms-delivery\0${row.id}\0${row.challenge_id}`),
            );
            if (payload.challengeId !== row.challenge_id) throw new Error('Invalid source');
          } catch {
            sql
              .prepare(
                "UPDATE sms_deliveries SET status='failed',payload_ciphertext=NULL,error_code='PAYLOAD_UNREADABLE',updated_at=? WHERE id=?",
              )
              .run(at(), row.id);
            continue;
          }
          sql
            .prepare(
              "UPDATE sms_deliveries SET status='sending',lease_owner=?,lease_until=?,updated_at=? WHERE id=? AND status='queued'",
            )
            .run(owner, new Date(clock().getTime() + 30_000).toISOString(), at(), row.id);
          return { row, payload };
        }
      })
      .immediate();
  }
  async function deliver() {
    if (stopped) return;
    const item = claim();
    if (!item) return;
    gateway ??= createAliyunSmsGateway(config!);
    let outcome: Awaited<ReturnType<SmsGateway['send']>>;
    try {
      outcome = await gateway.send({
        phone: item.payload.phone,
        code: item.payload.code,
        requestId: item.row.id,
      });
    } catch {
      outcome = { status: 'reconciliation_required', errorCode: 'SMS_ACCEPTANCE_UNKNOWN' };
    }
    const code =
      outcome.errorCode && /^[A-Z0-9_]{1,80}$/.test(outcome.errorCode) ? outcome.errorCode : null;
    const requestId =
      outcome.requestId && /^[A-Za-z0-9_-]{1,100}$/.test(outcome.requestId)
        ? outcome.requestId
        : null;
    sql
      .prepare(
        "UPDATE sms_deliveries SET status=?,payload_ciphertext=NULL,lease_owner=NULL,lease_until=NULL,error_code=?,provider_request_id=?,updated_at=? WHERE id=? AND status='sending' AND lease_owner=?",
      )
      .run(outcome.status, code, requestId, at(), item.row.id, owner);
  }
  return {
    enabled,
    enqueue,
    cleanup,
    tick() {
      if (running) return running;
      running = deliver().finally(() => {
        running = null;
      });
      return running;
    },
    async stop() {
      stopped = true;
      await running;
    },
  };
}

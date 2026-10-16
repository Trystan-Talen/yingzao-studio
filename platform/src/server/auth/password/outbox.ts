import { randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../../db/connection';
import { sealMessage, openMessage, type MailMessage } from '../../notifications/message';
import {
  mailRetryDelay,
  type ClaimedMail,
  type MailOutcome,
  type MailOutboxConfig,
} from '../../notifications/outbox';
import { validateSmtpConfig } from '../../notifications/config';

export interface PasswordRequest {
  id: string;
  user_id: string;
  purpose: 'setup' | 'reset';
  token_hash: string;
  email_snapshot: string;
  password_revision: number;
  session_token_hash: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}
interface MailRow {
  id: string;
  user_id: string;
  request_id: string;
  event_key: string;
  kind: 'password-request' | 'password-changed';
  payload_ciphertext: string | null;
  attempts: number;
  created_at: string;
  expires_at: string;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function createAccountMailOutbox(
  db: DatabaseContext,
  config: MailOutboxConfig,
  clock: () => Date,
) {
  const sql = db.sqlite;
  const smtp = validateSmtpConfig(config.smtp, config.isProduction);
  const origin = new URL(config.publicOrigin).origin;
  const at = () => clock().toISOString();
  const aad = (row: Pick<MailRow, 'id' | 'user_id' | 'event_key'>) =>
    `account-password-mail-v1\0${row.id}\0${row.user_id}\0${row.event_key}`;
  function enqueue(request: PasswordRequest, kind: MailRow['kind'], secret?: string) {
    if (!smtp.enabled) throw new Error('Account mail is disabled.');
    const eventKey = `${kind}:${request.id}`;
    const uid = randomUUID();
    const url =
      kind === 'password-request' ? `${origin}/password/reset#token=${secret}` : `${origin}/login`;
    const heading =
      kind === 'password-changed'
        ? '账户密码已更新'
        : request.purpose === 'setup'
          ? '设置本地密码'
          : '重置账户密码';
    const lead =
      kind === 'password-changed'
        ? '您的本地密码已更新，所有网页会话已退出。如非您操作，请使用既有登录方式检查账户与接口密钥。'
        : `请打开以下链接并输入两次新密码。链接有效期至 ${request.expires_at}，只能使用一次。${request.purpose === 'setup' ? '请在发起操作的同一浏览器会话中打开。' : ''}`;
    const message: MailMessage = {
      from: smtp.from,
      fromName: smtp.fromName,
      to: request.email_snapshot,
      userId: request.user_id,
      subject: `映造 · ${heading}`,
      text: `${lead}\n\n${url}\n\n如非您申请，请忽略本邮件。请勿转发此链接。`,
      html: `<!doctype html><html lang="zh-CN"><body><h1>${escape(heading)}</h1><p>${escape(lead)}</p><p><a href="${escape(url)}">${escape(heading)}</a></p><p>如非您申请，请忽略本邮件。请勿转发此链接。</p></body></html>`,
    };
    const encrypted = sealMessage(
      message,
      config.encryptionKey,
      aad({ id: uid, user_id: request.user_id, event_key: eventKey }),
    );
    sql
      .prepare(
        "INSERT OR IGNORE INTO account_mail_outbox(id,user_id,request_id,event_key,kind,payload_ciphertext,status,next_attempt_at,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?,?,?)",
      )
      .run(
        uid,
        request.user_id,
        request.id,
        eventKey,
        kind,
        encrypted,
        at(),
        kind === 'password-request'
          ? request.expires_at
          : new Date(clock().getTime() + 86400_000).toISOString(),
        at(),
        at(),
      );
  }
  function cleanup() {
    sql
      .prepare(
        "UPDATE account_mail_outbox SET status='cancelled',payload_ciphertext=NULL,lease_owner=NULL,lease_until=NULL,last_error_code='SOURCE_EXPIRED',updated_at=? WHERE expires_at<=? AND status NOT IN('accepted','cancelled')",
      )
      .run(at(), at());
  }
  function sourceValid(row: MailRow, message: MailMessage) {
    const source = sql
      .prepare(
        'SELECT r.*,u.email,u.password_revision AS current_revision FROM password_requests r JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.user_id=?',
      )
      .get(row.request_id, row.user_id) as
      (PasswordRequest & { email: string; current_revision: number }) | undefined;
    if (
      !source ||
      message.userId !== source.user_id ||
      message.to !== source.email_snapshot ||
      source.email !== source.email_snapshot
    )
      return false;
    if (row.kind === 'password-changed') return !!source.consumed_at;
    if (
      source.consumed_at ||
      source.revoked_at ||
      source.expires_at <= at() ||
      source.current_revision !== source.password_revision
    )
      return false;
    return (
      source.purpose === 'reset' ||
      !!sql
        .prepare(
          'SELECT id FROM sessions WHERE token_hash=? AND user_id=? AND revoked_at IS NULL AND expires_at>?',
        )
        .get(source.session_token_hash, source.user_id, at())
    );
  }
  function recover() {
    if (!smtp.enabled) return 0;
    cleanup();
    return sql
      .prepare(
        "UPDATE account_mail_outbox SET status='reconciliation_required',lease_owner=NULL,lease_until=NULL,last_error_code='WORKER_LEASE_EXPIRED',updated_at=? WHERE status='sending' AND lease_until<=?",
      )
      .run(at(), at()).changes;
  }
  function claim(owner: string): ClaimedMail | undefined {
    if (!smtp.enabled) return;
    return sql
      .transaction(() => {
        recover();
        const rows = sql
          .prepare(
            "SELECT * FROM account_mail_outbox WHERE status IN('queued','retry') AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,id LIMIT 100",
          )
          .all(at()) as MailRow[];
        for (const row of rows) {
          let message: MailMessage;
          try {
            message = openMessage(row.payload_ciphertext ?? '', config.encryptionKey, aad(row));
          } catch {
            sql
              .prepare(
                "UPDATE account_mail_outbox SET status='failed',payload_ciphertext=NULL,last_error_code='PAYLOAD_UNREADABLE',updated_at=? WHERE id=?",
              )
              .run(at(), row.id);
            continue;
          }
          if (!sourceValid(row, message)) {
            sql
              .prepare(
                "UPDATE account_mail_outbox SET status='cancelled',payload_ciphertext=NULL,last_error_code='SOURCE_NO_LONGER_VALID',updated_at=? WHERE id=?",
              )
              .run(at(), row.id);
            continue;
          }
          sql
            .prepare(
              "UPDATE account_mail_outbox SET status='sending',attempts=attempts+1,lease_owner=?,lease_until=?,updated_at=?,last_error_code=NULL WHERE id=?",
            )
            .run(owner, new Date(clock().getTime() + 120_000).toISOString(), at(), row.id);
          return {
            id: row.id,
            owner,
            message,
            attempts: row.attempts + 1,
            createdAt: row.created_at,
            messageId: `<${row.id}@${message.from.split('@')[1]}>`,
          };
        }
      })
      .immediate();
  }
  return {
    smtp,
    enqueue,
    cleanup,
    recover,
    claim,
    cancelRequests(userId: string) {
      sql
        .prepare(
          "UPDATE account_mail_outbox SET status='cancelled',payload_ciphertext=NULL,lease_owner=NULL,lease_until=NULL,last_error_code='SOURCE_NO_LONGER_VALID',updated_at=? WHERE user_id=? AND kind='password-request' AND status<>'accepted'",
        )
        .run(at(), userId);
    },
    heartbeat(item: Pick<ClaimedMail, 'id' | 'owner'>) {
      return (
        sql
          .prepare(
            "UPDATE account_mail_outbox SET lease_until=? WHERE id=? AND status='sending' AND lease_owner=?",
          )
          .run(new Date(clock().getTime() + 120_000).toISOString(), item.id, item.owner).changes ===
        1
      );
    },
    finish(item: ClaimedMail, outcome: MailOutcome) {
      const status = outcome.status === 'retry' && item.attempts >= 5 ? 'failed' : outcome.status;
      const code =
        outcome.status === 'retry' && status === 'failed'
          ? 'RETRY_EXHAUSTED'
          : (outcome.errorCode ?? null);
      if (code && !/^[A-Z0-9_]{1,80}$/.test(code))
        throw new Error('Unsafe account mail error code.');
      return (
        sql
          .prepare(
            "UPDATE account_mail_outbox SET status=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,last_error_code=?,smtp_response_code=?,updated_at=?,accepted_at=?,payload_ciphertext=CASE WHEN ?='accepted' THEN NULL ELSE payload_ciphertext END WHERE id=? AND status='sending' AND lease_owner=?",
          )
          .run(
            status,
            new Date(clock().getTime() + mailRetryDelay(item.id, item.attempts)).toISOString(),
            code,
            outcome.smtpResponseCode ?? null,
            at(),
            status === 'accepted' ? at() : null,
            status,
            item.id,
            item.owner,
          ).changes === 1
      );
    },
  };
}

import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../db/connection';
import { mailTemplate, openMessage, sealMessage, type MailMessage } from './message';
import { validateSmtpConfig, type SmtpConfig } from './config';
export type MailState =
  'queued' | 'sending' | 'retry' | 'accepted' | 'failed' | 'reconciliation_required' | 'cancelled';
interface OutboxRow {
  id: string;
  workspace_id: string;
  event_key: string;
  event_type: 'invitation' | 'notification' | 'support-reply';
  source_id: string;
  payload_ciphertext: string | null;
  status: MailState;
  attempts: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_until: string | null;
  last_error_code: string | null;
  smtp_response_code: number | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
}
export interface MailStatus {
  id: string;
  workspaceId: string;
  status: MailState;
  attempts: number;
  nextAttemptAt: string | null;
  errorCode: string | null;
  smtpResponseCode: number | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
}
export type EnqueueMailResult =
  | { status: 'disabled' }
  | { status: 'not-applicable' }
  | { status: 'queued' | 'existing'; id: string };
export interface MailOutboxConfig {
  smtp?: SmtpConfig;
  encryptionKey: string;
  publicOrigin: string;
  isProduction?: boolean;
}
export interface ClaimedMail {
  id: string;
  owner: string;
  message: MailMessage;
  attempts: number;
  createdAt: string;
  messageId: string;
}
export interface MailOutcome {
  status: 'accepted' | 'retry' | 'failed' | 'reconciliation_required';
  errorCode?: string;
  smtpResponseCode?: number;
}
const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 5;
export function mailRetryDelay(id: string, attempt: number): number {
  const base = Math.min(3600_000, 60_000 * 2 ** Math.min(10, Math.max(0, attempt - 1)));
  const jitter = createHash('sha256').update(`${id}:${attempt}`).digest().readUInt16BE(0) / 65535;
  return Math.round(base * (1 + jitter * 0.2));
}
export function createMailOutbox(
  db: DatabaseContext,
  config: MailOutboxConfig,
  options: { now?: () => Date } = {},
) {
  const sql = db.sqlite;
  const smtp = validateSmtpConfig(config.smtp, config.isProduction);
  const clock = options.now ?? (() => new Date());
  const base = new URL(config.publicOrigin);
  if (
    smtp.enabled &&
    (!['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.pathname !== '/' ||
      base.search ||
      base.hash)
  )
    throw new Error('Mail notifications require a canonical HTTP(S) PUBLIC_ORIGIN.');
  if (
    smtp.enabled &&
    config.isProduction &&
    base.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  )
    throw new Error('Production mail notification links require HTTPS.');
  const origin = base.origin;
  if (smtp.enabled && !config.encryptionKey)
    throw new Error('Mail outbox requires an encryption key.');
  const timestamp = () => clock().toISOString();
  const aad = (r: Pick<OutboxRow, 'id' | 'workspace_id' | 'event_key'>) =>
    `${r.id}\0${r.workspace_id}\0${r.event_key}`;
  const row = (id: string) =>
    sql.prepare('SELECT * FROM mail_outbox WHERE id=?').get(id) as OutboxRow | undefined;
  const status = (r: OutboxRow): MailStatus => ({
    id: r.id,
    workspaceId: r.workspace_id,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: ['queued', 'retry'].includes(r.status) ? r.next_attempt_at : null,
    errorCode: r.last_error_code,
    smtpResponseCode: r.smtp_response_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    acceptedAt: r.accepted_at,
  });
  function insert(
    workspaceId: string,
    eventType: OutboxRow['event_type'],
    sourceId: string,
    message: MailMessage,
  ): EnqueueMailResult {
    const eventKey = `${eventType}:${sourceId}`;
    const old = sql.prepare('SELECT id FROM mail_outbox WHERE event_key=?').get(eventKey) as
      { id: string } | undefined;
    if (old) return { status: 'existing', id: old.id };
    const id = randomUUID(),
      at = timestamp();
    const encrypted = sealMessage(
      message,
      config.encryptionKey,
      aad({ id, workspace_id: workspaceId, event_key: eventKey }),
    );
    sql
      .prepare(
        "INSERT INTO mail_outbox(id,workspace_id,event_key,event_type,source_id,payload_ciphertext,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?,?)",
      )
      .run(id, workspaceId, eventKey, eventType, sourceId, encrypted, at, at, at);
    return { status: 'queued', id };
  }
  function enqueueInvitation(input: {
    workspaceId: string;
    invitationId: string;
    inviteUrl: string;
  }): EnqueueMailResult {
    if (!smtp.enabled) return { status: 'disabled' };
    return sql
      .transaction(() => {
        const source = sql
          .prepare(
            'SELECT i.*,w.name AS workspace_name FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.id=? AND i.workspace_id=? AND w.archived_at IS NULL AND i.revoked_at IS NULL AND i.consumed_at IS NULL AND i.expires_at>?',
          )
          .get(input.invitationId, input.workspaceId, timestamp()) as
          | { email: string; token_hash: string; expires_at: string; workspace_name: string }
          | undefined;
        if (!source) return { status: 'not-applicable' } as const;
        const url = new URL(input.inviteUrl);
        const secret = new URLSearchParams(url.hash.slice(1)).get('token');
        if (
          url.origin !== origin ||
          url.pathname !== '/invite' ||
          url.search ||
          url.username ||
          url.password ||
          !secret ||
          createHash('sha256').update(secret).digest('hex') !== source.token_hash
        )
          throw new Error('Invitation email requires the matching application invitation link.');
        return insert(
          input.workspaceId,
          'invitation',
          input.invitationId,
          mailTemplate({
            to: source.email,
            from: smtp.from,
            fromName: smtp.fromName,
            userId: null,
            kind: 'invitation',
            workspaceName: source.workspace_name,
            url: input.inviteUrl,
            expiresAt: source.expires_at,
          }),
        );
      })
      .immediate();
  }
  function enqueueNotification(input: {
    workspaceId: string;
    notificationId: string;
  }): EnqueueMailResult {
    if (!smtp.enabled) return { status: 'disabled' };
    return sql
      .transaction(() => {
        const source = sql
          .prepare(
            'SELECT n.user_id,u.email,w.name FROM notifications n JOIN users u ON u.id=n.user_id JOIN workspaces w ON w.id=n.workspace_id JOIN memberships m ON m.workspace_id=n.workspace_id AND m.user_id=n.user_id WHERE n.id=? AND n.workspace_id=? AND w.archived_at IS NULL',
          )
          .get(input.notificationId, input.workspaceId) as
          { user_id: string; email: string; name: string } | undefined;
        if (!source) return { status: 'not-applicable' } as const;
        return insert(
          input.workspaceId,
          'notification',
          input.notificationId,
          mailTemplate({
            to: source.email,
            from: smtp.from,
            fromName: smtp.fromName,
            userId: source.user_id,
            kind: 'notification',
            workspaceName: source.name,
            url: `${origin}/`,
          }),
        );
      })
      .immediate();
  }
  function enqueueSupportReply(input: {
    workspaceId: string;
    ticketId: string;
    messageId: string;
  }): EnqueueMailResult {
    if (!smtp.enabled) return { status: 'disabled' };
    return sql
      .transaction(() => {
        const source = sql
          .prepare(
            'SELECT t.created_by,u.email,w.name FROM ticket_messages r JOIN support_tickets t ON t.id=r.ticket_id JOIN users u ON u.id=t.created_by JOIN workspaces w ON w.id=t.workspace_id JOIN memberships m ON m.workspace_id=t.workspace_id AND m.user_id=t.created_by WHERE r.id=? AND t.id=? AND t.workspace_id=? AND r.user_id<>t.created_by AND w.archived_at IS NULL',
          )
          .get(input.messageId, input.ticketId, input.workspaceId) as
          { created_by: string; email: string; name: string } | undefined;
        if (!source) return { status: 'not-applicable' } as const;
        return insert(
          input.workspaceId,
          'support-reply',
          input.messageId,
          mailTemplate({
            to: source.email,
            from: smtp.from,
            fromName: smtp.fromName,
            userId: source.created_by,
            kind: 'support-reply',
            workspaceName: source.name,
            url: `${origin}/support`,
          }),
        );
      })
      .immediate();
  }
  function sourceValid(r: OutboxRow, message: MailMessage): boolean {
    if (r.event_type === 'invitation')
      return Boolean(
        sql
          .prepare(
            'SELECT i.id FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.id=? AND i.workspace_id=? AND i.email=? AND i.revoked_at IS NULL AND i.consumed_at IS NULL AND i.expires_at>? AND w.archived_at IS NULL',
          )
          .get(r.source_id, r.workspace_id, message.to, timestamp()),
      );
    const member = sql
      .prepare(
        'SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id WHERE u.id=? AND u.email=? AND m.workspace_id=? AND w.archived_at IS NULL',
      )
      .get(message.userId, message.to, r.workspace_id);
    if (!member) return false;
    if (r.event_type === 'notification')
      return Boolean(
        sql
          .prepare('SELECT id FROM notifications WHERE id=? AND workspace_id=? AND user_id=?')
          .get(r.source_id, r.workspace_id, message.userId),
      );
    return Boolean(
      sql
        .prepare(
          'SELECT r.id FROM ticket_messages r JOIN support_tickets t ON t.id=r.ticket_id WHERE r.id=? AND t.workspace_id=? AND t.created_by=? AND r.user_id<>t.created_by',
        )
        .get(r.source_id, r.workspace_id, message.userId),
    );
  }
  function recover(): number {
    if (!smtp.enabled) return 0;
    const at = timestamp();
    return sql
      .prepare(
        "UPDATE mail_outbox SET status='reconciliation_required',lease_owner=NULL,lease_until=NULL,last_error_code='WORKER_LEASE_EXPIRED',updated_at=? WHERE status='sending' AND lease_until<=?",
      )
      .run(at, at).changes;
  }
  function claim(owner: string): ClaimedMail | undefined {
    if (!smtp.enabled) return;
    return sql
      .transaction(() => {
        recover();
        const at = timestamp();
        const candidates = sql
          .prepare(
            "SELECT * FROM mail_outbox WHERE status IN('queued','retry') AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,id LIMIT 100",
          )
          .all(at) as OutboxRow[];
        for (const candidate of candidates) {
          let message: MailMessage;
          try {
            message = openMessage(
              candidate.payload_ciphertext ?? '',
              config.encryptionKey,
              aad(candidate),
            );
          } catch {
            sql
              .prepare(
                "UPDATE mail_outbox SET status='failed',last_error_code='PAYLOAD_UNREADABLE',updated_at=? WHERE id=?",
              )
              .run(at, candidate.id);
            continue;
          }
          if (!sourceValid(candidate, message)) {
            sql
              .prepare(
                "UPDATE mail_outbox SET status='cancelled',payload_ciphertext=NULL,last_error_code='SOURCE_NO_LONGER_VALID',updated_at=? WHERE id=?",
              )
              .run(at, candidate.id);
            continue;
          }
          sql
            .prepare(
              "UPDATE mail_outbox SET status='sending',attempts=attempts+1,lease_owner=?,lease_until=?,updated_at=?,last_error_code=NULL,smtp_response_code=NULL WHERE id=?",
            )
            .run(owner, new Date(clock().getTime() + LEASE_MS).toISOString(), at, candidate.id);
          return {
            id: candidate.id,
            owner,
            message,
            attempts: candidate.attempts + 1,
            createdAt: candidate.created_at,
            messageId: `<${candidate.id}@${message.from.split('@')[1]}>`,
          };
        }
      })
      .immediate();
  }
  function heartbeat(claimed: Pick<ClaimedMail, 'id' | 'owner'>): boolean {
    return (
      sql
        .prepare(
          "UPDATE mail_outbox SET lease_until=? WHERE id=? AND status='sending' AND lease_owner=?",
        )
        .run(new Date(clock().getTime() + LEASE_MS).toISOString(), claimed.id, claimed.owner)
        .changes === 1
    );
  }
  function finish(claimed: ClaimedMail, outcome: MailOutcome): boolean {
    const at = timestamp();
    const finalStatus =
      outcome.status === 'retry' && claimed.attempts >= MAX_ATTEMPTS ? 'failed' : outcome.status;
    const code =
      finalStatus === 'failed' && outcome.status === 'retry'
        ? 'RETRY_EXHAUSTED'
        : (outcome.errorCode ?? null);
    if (code && !/^[A-Z0-9_]{1,80}$/.test(code))
      throw new Error('Mail error codes must be safe fixed identifiers.');
    const next = new Date(
      clock().getTime() + mailRetryDelay(claimed.id, claimed.attempts),
    ).toISOString();
    return (
      sql
        .prepare(
          "UPDATE mail_outbox SET status=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,last_error_code=?,smtp_response_code=?,updated_at=?,accepted_at=?,payload_ciphertext=CASE WHEN ?='accepted' THEN NULL ELSE payload_ciphertext END WHERE id=? AND status='sending' AND lease_owner=?",
        )
        .run(
          finalStatus,
          next,
          code,
          outcome.smtpResponseCode ?? null,
          at,
          finalStatus === 'accepted' ? at : null,
          finalStatus,
          claimed.id,
          claimed.owner,
        ).changes === 1
    );
  }
  function reconcile(input: {
    id: string;
    operatorId: string;
    action: 'retry-confirmed-not-accepted' | 'confirm-accepted' | 'cancel';
    evidenceReference: string;
  }): MailStatus {
    if (!/^[a-zA-Z0-9_./:# -]{3,200}$/.test(input.evidenceReference))
      throw new Error(
        'Use a short non-sensitive evidence reference, not mail content or credentials.',
      );
    return sql
      .transaction(() => {
        const item = row(input.id);
        if (
          !item ||
          !['failed', 'reconciliation_required', 'queued', 'retry'].includes(item.status)
        )
          throw new Error('Mail state does not allow operator reconciliation.');
        const operator = sql
          .prepare('SELECT id FROM users ORDER BY created_at,id LIMIT 1')
          .get() as { id: string } | undefined;
        if (!operator || operator.id !== input.operatorId)
          throw new Error('Mail reconciliation requires the installation administrator account.');
        if (input.action === 'confirm-accepted' && item.status !== 'reconciliation_required')
          throw new Error('Only ambiguous submission can be confirmed accepted.');
        if (
          input.action === 'retry-confirmed-not-accepted' &&
          !['failed', 'reconciliation_required'].includes(item.status)
        )
          throw new Error('Only failed or ambiguous mail may be requeued.');
        if (
          input.action === 'retry-confirmed-not-accepted' &&
          (!smtp.enabled || !item.payload_ciphertext)
        )
          throw new Error('SMTP must be configured and the original encrypted message available.');
        const at = timestamp(),
          state =
            input.action === 'retry-confirmed-not-accepted'
              ? 'queued'
              : input.action === 'confirm-accepted'
                ? 'accepted'
                : 'cancelled';
        sql
          .prepare(
            "UPDATE mail_outbox SET status=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,last_error_code=NULL,updated_at=?,accepted_at=?,payload_ciphertext=CASE WHEN ? IN('accepted','cancelled') THEN NULL ELSE payload_ciphertext END WHERE id=?",
          )
          .run(state, at, at, state === 'accepted' ? at : null, state, item.id);
        sql
          .prepare('INSERT INTO mail_outbox_actions VALUES(?,?,?,?,?,?)')
          .run(randomUUID(), item.id, input.operatorId, input.action, input.evidenceReference, at);
        return status(row(item.id)!);
      })
      .immediate();
  }
  return {
    smtp,
    enqueueInvitation,
    enqueueNotification,
    enqueueSupportReply,
    claim,
    recover,
    heartbeat,
    finish,
    reconcile,
    getStatus: (id: string) => {
      const item = row(id);
      return item ? status(item) : null;
    },
    listStatus: (workspaceId: string, limit = 50) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error('Invalid mail status limit.');
      return (
        sql
          .prepare(
            'SELECT * FROM mail_outbox WHERE workspace_id=? ORDER BY created_at DESC,id LIMIT ?',
          )
          .all(workspaceId, limit) as OutboxRow[]
      ).map(status);
    },
  };
}
export type MailOutbox = ReturnType<typeof createMailOutbox>;

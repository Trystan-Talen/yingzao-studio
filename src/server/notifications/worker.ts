import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import type { MailOutbox, MailOutcome } from './outbox';

/** Deliberately never retain message, response, command or original error text. */
export function classifySmtpError(error: unknown): MailOutcome {
  const e = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const response =
    typeof e.responseCode === 'number' && Number.isInteger(e.responseCode)
      ? e.responseCode
      : undefined;
  if (response && response >= 400 && response < 500)
    return { status: 'retry', errorCode: 'SMTP_TEMPORARY_REJECTION', smtpResponseCode: response };
  if (response && response >= 500 && response < 600)
    return { status: 'failed', errorCode: 'SMTP_PERMANENT_REJECTION', smtpResponseCode: response };
  if (
    [
      'EAUTH',
      'ENOAUTH',
      'EOAUTH2',
      'ETLS',
      'EREQUIRETLS',
      'ECONFIG',
      'EENVELOPE',
      'EMAXRECIPIENTS',
      'EFILEACCESS',
      'EURLACCESS',
    ].includes(String(e.code))
  )
    return { status: 'failed', errorCode: 'SMTP_CONFIGURATION_OR_SECURITY_FAILURE' };
  // Nodemailer can label a disconnect after DATA as command=CONN. Do not use command alone to infer safe retry.
  if (
    e.code === 'EDNS' ||
    e.code === 'ECONNREFUSED' ||
    e.originalCode === 'ECONNREFUSED' ||
    (e.code === 'ETIMEDOUT' &&
      ['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT'].includes(String(e.timeoutType)))
  )
    return { status: 'retry', errorCode: 'SMTP_CONNECTION_NOT_ESTABLISHED' };
  return { status: 'reconciliation_required', errorCode: 'SMTP_ACCEPTANCE_UNKNOWN' };
}
export function createMailWorker(outbox: MailOutbox) {
  let stopped = false;
  let running: Promise<void> | null = null;
  const owner = randomUUID();
  async function runOne(): Promise<void> {
    const smtp = outbox.smtp;
    if (stopped || !smtp.enabled) return;
    const item = outbox.claim(owner);
    if (!item) return;
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.tlsMode === 'implicit',
      requireTLS: smtp.tlsMode === 'starttls',
      ignoreTLS: smtp.tlsMode === 'local-test',
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      dnsTimeout: 10000,
      logger: false,
      debug: false,
      transactionLog: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const heartbeat = setInterval(() => {
      outbox.heartbeat(item);
    }, 20000);
    heartbeat.unref();
    let outcome: MailOutcome;
    try {
      const info = await transport.sendMail({
        from: { name: item.message.fromName, address: item.message.from },
        to: { address: item.message.to, name: '' },
        envelope: { from: item.message.from, to: [item.message.to] },
        subject: item.message.subject,
        text: item.message.text,
        html: item.message.html,
        messageId: item.messageId,
        date: new Date(item.createdAt),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      outcome =
        info.accepted.length === 1 && info.rejected.length === 0
          ? { status: 'accepted' }
          : { status: 'reconciliation_required', errorCode: 'SMTP_ACCEPTANCE_UNKNOWN' };
    } catch (error) {
      outcome = classifySmtpError(error);
    } finally {
      clearInterval(heartbeat);
      transport.close();
    }
    outbox.finish(item, outcome);
  }
  return {
    tick(): Promise<void> {
      if (stopped) return Promise.resolve();
      if (running) return running;
      running = runOne().finally(() => {
        running = null;
      });
      return running;
    },
    async stop(): Promise<void> {
      stopped = true;
      await running;
    },
  };
}

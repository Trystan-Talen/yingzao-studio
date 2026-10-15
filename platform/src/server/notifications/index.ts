export { readSmtpConfig, validateSmtpConfig, type SmtpConfig } from './config';
export {
  createMailOutbox,
  type MailOutbox,
  type MailStatus,
  type EnqueueMailResult,
  type MailOutboxConfig,
} from './outbox';
export { createMailWorker } from './worker';
export { registerMailRoutes } from './routes';

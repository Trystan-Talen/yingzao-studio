import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema } from '../../contracts/core';
import type { CoreServices } from '../core';
import { AppError } from '../errors';
import type { MailOutbox } from './outbox';
const statusSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  status: z.enum([
    'queued',
    'sending',
    'retry',
    'accepted',
    'failed',
    'reconciliation_required',
    'cancelled',
  ]),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
  smtpResponseCode: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
});
export async function registerMailRoutes(
  app: FastifyInstance,
  outbox: MailOutbox,
  core: CoreServices,
): Promise<void> {
  app.get(
    '/api/v1/mail-deliveries',
    {
      schema: {
        tags: ['Notifications'],
        response: {
          200: z.object({
            data: z.object({ enabled: z.boolean(), items: z.array(statusSchema).max(50) }),
          }),
        },
      },
    },
    async (req) => {
      const actor = await core.authenticate(req);
      if (!actor) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
      if (actor.authType !== 'session')
        throw new AppError(403, 'FORBIDDEN', '邮件投递记录仅限管理员账户会话访问');
      const header = req.headers['x-workspace-id'];
      if (typeof header !== 'string')
        throw new AppError(400, 'WORKSPACE_REQUIRED', '请选择工作空间');
      const wid = IdSchema.parse(header);
      core.requireAccess(actor, wid, 'manage');
      return { data: { enabled: outbox.smtp.enabled, items: outbox.listStatus(wid, 50) } };
    },
  );
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CoreServices } from '../../core';
import { AppError } from '../../errors';
import {
  PasswordCompleteInputSchema,
  PasswordForgotInputSchema,
  PasswordRecoveryStatusSchema,
  PasswordRequestResultSchema,
  PasswordCompleteResultSchema,
  PasswordSetupInputSchema,
} from '../../../contracts/password-auth';
import type { PasswordRecoveryService, PasswordSession } from './service';

export async function registerPasswordRoutes(
  app: FastifyInstance,
  service: PasswordRecoveryService,
  core: CoreServices,
) {
  const context = async (req: FastifyRequest): Promise<PasswordSession | null> => {
    const actor = await core.authenticate(req);
    return actor?.authType === 'session' && req.cookies.studio_session
      ? { actor, sessionToken: req.cookies.studio_session }
      : null;
  };
  const sameOrigin = (req: FastifyRequest) => {
    if (
      req.headers.origin !== new URL(core.context.config.publicOrigin).origin ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new AppError(403, 'ORIGIN_REJECTED', '密码操作必须从本站发起');
  };
  app.get(
    '/api/v1/auth/password/status',
    { schema: { response: { 200: z.object({ data: PasswordRecoveryStatusSchema }) } } },
    async (req) => ({ data: service.status((await context(req))?.actor) }),
  );
  app.post(
    '/api/v1/auth/password/forgot',
    {
      schema: {
        body: PasswordForgotInputSchema,
        response: { 202: z.object({ data: PasswordRequestResultSchema }) },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      sameOrigin(req);
      const data = await service.requestReset(req.body, req.ip);
      return reply.code(202).send({ data });
    },
  );
  app.post(
    '/api/v1/auth/password/setup-request',
    {
      schema: {
        body: PasswordSetupInputSchema,
        response: { 202: z.object({ data: PasswordRequestResultSchema }) },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      sameOrigin(req);
      const current = await context(req);
      if (!current) throw new AppError(401, 'UNAUTHENTICATED', '请先登录账户');
      return reply.code(202).send({ data: await service.requestSetup(current, req.ip) });
    },
  );
  app.post(
    '/api/v1/auth/password/complete',
    {
      schema: {
        body: PasswordCompleteInputSchema,
        response: { 200: z.object({ data: PasswordCompleteResultSchema }) },
      },
      config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      sameOrigin(req);
      const data = await service.complete(req.body, await context(req));
      reply.clearCookie('studio_session', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: core.context.config.isProduction,
      });
      return { data };
    },
  );
}

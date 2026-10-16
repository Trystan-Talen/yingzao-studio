import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { CoreServices } from '../../core';
import { AppError } from '../../errors';
import { token } from '../../core/shared';
import {
  IdentityPasswordSchema,
  IdentityRegistrationSchema,
  SmsSendSchema,
  SmsVerifySchema,
} from '../../../contracts/identity-auth';
import type { IdentityAuthService } from './service';
import { IDENTITY_COOKIE, WECHAT_CALLBACK } from './types';
export async function registerIdentityRoutes(
  app: FastifyInstance,
  service: IdentityAuthService,
  core: CoreServices,
) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: service.secureCookie,
    path: '/api/v1/auth',
    maxAge: 600,
  };
  const current = async (req: FastifyRequest) => {
    const actor = await core.authenticate(req);
    return actor?.authType === 'session' && req.cookies.studio_session
      ? { actor, sessionToken: req.cookies.studio_session }
      : null;
  };
  const sameOrigin = (req: FastifyRequest) => {
    if (
      req.headers.origin !== service.publicOrigin ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new AppError(403, 'ORIGIN_REJECTED', '账户操作必须从本站发起');
  };
  function browser(req: FastifyRequest, reply?: FastifyReply) {
    let value = req.cookies[IDENTITY_COOKIE];
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
      if (!reply) throw new AppError(400, 'IDENTITY_PROOF_INVALID', '验证会话已失效，请重新申请');
      value = token();
    }
    if (reply) reply.setCookie(IDENTITY_COOKIE, value, cookieOptions);
    return value;
  }
  function finish(
    req: FastifyRequest,
    reply: FastifyReply,
    result: { sessionToken?: string } & Record<string, unknown>,
  ) {
    if (result.sessionToken) {
      core.auth.logout(req.cookies.studio_session);
      reply.setCookie('studio_session', result.sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: service.secureCookie,
        path: '/',
        maxAge: 7 * 86400,
      });
      reply.clearCookie(IDENTITY_COOKIE, cookieOptions);
      return { data: { authenticated: true } };
    }
    return { data: result };
  }
  const rate = { rateLimit: { max: 10, timeWindow: '15 minutes' } };
  app.get('/api/v1/auth/identity/status', async (req) => ({
    data: service.status(await core.authenticate(req)),
  }));
  app.post(
    '/api/v1/auth/sms/send',
    { schema: { body: SmsSendSchema }, config: rate },
    async (req, reply) => {
      sameOrigin(req);
      const context = await current(req);
      const value = browser(req, reply);
      return reply
        .code(202)
        .send({ data: await service.requestSms(req.body, value, req.ip, context) });
    },
  );
  app.post(
    '/api/v1/auth/sms/verify',
    {
      schema: { body: SmsVerifySchema },
      config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      sameOrigin(req);
      return finish(
        req,
        reply,
        service.verifySms(req.body, browser(req), req.ip, await current(req)),
      );
    },
  );
  app.post(
    '/api/v1/auth/sms/unlink',
    { schema: { body: IdentityPasswordSchema }, config: rate },
    async (req) => {
      sameOrigin(req);
      const context = await current(req);
      if (!context) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
      return { data: await service.unlink('sms', req.body, context, req.ip) };
    },
  );
  app.post(
    '/api/v1/auth/wechat/start',
    { schema: { body: z.object({}).strict() }, config: rate },
    async (req, reply) => {
      sameOrigin(req);
      return { data: await service.startWechat(browser(req, reply), req.ip) };
    },
  );
  app.post(
    '/api/v1/auth/wechat/link-start',
    { schema: { body: IdentityPasswordSchema }, config: rate },
    async (req, reply) => {
      sameOrigin(req);
      return {
        data: await service.startWechat(browser(req, reply), req.ip, await current(req), req.body),
      };
    },
  );
  app.post(
    '/api/v1/auth/wechat/unlink',
    { schema: { body: IdentityPasswordSchema }, config: rate },
    async (req) => {
      sameOrigin(req);
      const context = await current(req);
      if (!context) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
      return { data: await service.unlink('wechat', req.body, context, req.ip) };
    },
  );
  app.get(
    WECHAT_CALLBACK,
    { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      try {
        const result = await service.completeWechat(req.query, browser(req), await current(req));
        finish(req, reply, result);
        const target =
          'registrationId' in result
            ? `/auth/complete-registration?id=${encodeURIComponent(result.registrationId!)}`
            : 'linked' in result
              ? '/settings?wechat=linked'
              : '/';
        return reply.code(303).redirect(new URL(target, service.publicOrigin).href);
      } catch (error) {
        const code =
          error instanceof AppError && /^[A-Z0-9_]{1,80}$/.test(error.code)
            ? error.code
            : 'WECHAT_AUTH_FAILED';
        return reply
          .code(303)
          .redirect(new URL(`/login?identity=error&code=${code}`, service.publicOrigin).href);
      }
    },
  );
  app.get(
    '/api/v1/auth/identity/registration',
    { schema: { querystring: z.object({ id: z.string().uuid() }).strict() } },
    async (req) => ({
      data: service.registrationInfo((req.query as { id: string }).id, browser(req)),
    }),
  );
  app.post(
    '/api/v1/auth/identity/register',
    { schema: { body: IdentityRegistrationSchema }, config: rate },
    async (req, reply) => {
      sameOrigin(req);
      return finish(req, reply, await service.register(req.body, browser(req)));
    },
  );
}

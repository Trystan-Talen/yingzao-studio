import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { CoreServices } from '../../core';
import { AppError } from '../../errors';
import {
  GoogleStartInputSchema,
  GooglePasswordInputSchema,
  GoogleStatusSchema,
  GoogleBeginSchema,
} from '../../../contracts/google-auth';
import { GOOGLE_FLOW_COOKIE } from './types';
import type { GoogleAuthService } from './service';
export async function registerGoogleRoutes(
  app: FastifyInstance,
  service: GoogleAuthService,
  core: CoreServices,
) {
  const sameOrigin = (req: FastifyRequest) => {
    if (
      req.headers.origin !== service.publicOrigin ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new AppError(403, 'ORIGIN_REJECTED', 'Google 登录操作必须从本站发起');
  };
  const current = async (req: FastifyRequest) => {
    const actor = await core.authenticate(req);
    if (!actor || actor.authType !== 'session' || !req.cookies.studio_session)
      throw new AppError(401, 'UNAUTHENTICATED', '请先使用本地账户登录');
    return { actor, sessionToken: req.cookies.studio_session };
  };
  const sendBegin = (
    reply: FastifyReply,
    result: Awaited<ReturnType<GoogleAuthService['start']>>,
  ) => {
    const { browserToken, ...data } = result;
    reply.setCookie(GOOGLE_FLOW_COOKIE, browserToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: service.secureCookie,
      path: '/api/v1/auth/google',
      maxAge: 600,
    });
    reply.header('Cache-Control', 'no-store');
    return { data };
  };
  app.get(
    '/api/v1/auth/google/status',
    { schema: { response: { 200: z.object({ data: GoogleStatusSchema }) } } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { data: service.status(await core.authenticate(req)) };
    },
  );
  app.post(
    '/api/v1/auth/google/start',
    {
      schema: {
        body: GoogleStartInputSchema,
        response: { 200: z.object({ data: GoogleBeginSchema }) },
      },
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      sameOrigin(req);
      return sendBegin(reply, await service.start(req.body));
    },
  );
  app.post(
    '/api/v1/auth/google/link-start',
    {
      schema: {
        body: GooglePasswordInputSchema,
        response: { 200: z.object({ data: GoogleBeginSchema }) },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      sameOrigin(req);
      return sendBegin(reply, await service.startLink(await current(req), req.body));
    },
  );
  app.post(
    '/api/v1/auth/google/unlink',
    {
      schema: {
        body: GooglePasswordInputSchema,
        response: { 200: z.object({ data: z.object({ unlinked: z.literal(true) }) }) },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req) => {
      sameOrigin(req);
      return { data: await service.unlink(await current(req), req.body) };
    },
  );
  app.get(
    '/api/v1/auth/google/callback',
    { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      reply.clearCookie(GOOGLE_FLOW_COOKIE, {
        path: '/api/v1/auth/google',
        httpOnly: true,
        sameSite: 'lax',
        secure: service.secureCookie,
      });
      try {
        const result = await service.complete(
          req.query,
          req.cookies[GOOGLE_FLOW_COOKIE],
          req.cookies.studio_session,
        );
        if (result.sessionToken) {
          core.auth.logout(req.cookies.studio_session);
          reply.setCookie('studio_session', result.sessionToken, {
            httpOnly: true,
            sameSite: 'lax',
            secure: service.secureCookie,
            path: '/',
            maxAge: 7 * 86400,
          });
        }
        return reply
          .code(303)
          .redirect(
            new URL(
              result.intent === 'link' ? '/settings?google=linked' : '/',
              service.publicOrigin,
            ).href,
          );
      } catch (error) {
        const code =
          error instanceof AppError && /^[A-Z0-9_]{1,80}$/.test(error.code)
            ? error.code
            : 'GOOGLE_AUTH_FAILED';
        return reply
          .code(303)
          .redirect(new URL(`/login?google=error&code=${code}`, service.publicOrigin).href);
      }
    },
  );
}

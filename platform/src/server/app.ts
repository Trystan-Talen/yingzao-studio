import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import staticFiles from '@fastify/static';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { AppConfig } from './config';
import { createDatabaseContext, closeDatabase, type DatabaseContext } from './db/connection';
import { migrateDatabase } from './db/migrate';
import { createCoreServices, registerCoreRoutes } from './core';
import { createCreditService } from './tasks/credits';
import { createTaskServices } from './tasks/service';
import { registerTaskRoutes } from './tasks/routes';
import { AppError } from './errors';
import { createBillingService } from './billing';
import { createMailOutbox, registerMailRoutes } from './notifications';
import { createGoogleAuthService, registerGoogleRoutes } from './auth/google';
import { createPasswordRecoveryService } from './auth/password/service';
import { registerPasswordRoutes } from './auth/password/routes';
import { createIdentityAuthService, type IdentityAuthOptions } from './auth/identity/service';
import { registerIdentityRoutes } from './auth/identity/routes';
export function createServices(
  config: AppConfig,
  existingDb?: DatabaseContext,
  identityOptions?: IdentityAuthOptions,
) {
  const db = existingDb ?? createDatabaseContext(config.databasePath);
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  const credits = createCreditService(db);
  const mail = createMailOutbox(db, config);
  const core = createCoreServices(db, config, {
    onInvitationCreated: mail.enqueueInvitation,
    onSupportReplyCreated: mail.enqueueSupportReply,
    onWorkspaceCreated: (wid, uid) => credits.initialize(wid, uid, config.demoMode ? 1000 : 0),
    onMemberRemoved: (wid, uid) => tasks.removeMember(wid, uid),
    onMemberBudgetChanged: (wid, uid, limit) => credits.budget(wid, uid, limit),
    canArchiveWorkspace: (wid) => {
      const count = (
        db.sqlite
          .prepare(
            "SELECT COUNT(*) AS n FROM job_items WHERE workspace_id=? AND status IN('queued','running','reconciliation_required')",
          )
          .get(wid) as { n: number }
      ).n;
      if (count || credits.account(wid).reserved)
        throw new AppError(409, 'WORKSPACE_BUSY', '空间仍有在途任务或待核对额度，请处理后再归档');
    },
  });
  const tasks = createTaskServices(db, core, config);
  const billing = createBillingService(db, core, config, credits);
  const google = createGoogleAuthService(db, core, config);
  const passwordRecovery = createPasswordRecoveryService(db, config);
  const identities = createIdentityAuthService(db, core, config, identityOptions);
  core.business.setBilling(billing);
  return { ...tasks, billing, mail, google, passwordRecovery, identities };
}
export async function createApp(
  config: AppConfig,
  options: {
    db?: DatabaseContext;
    logging?: boolean;
    serveWeb?: boolean;
    identity?: IdentityAuthOptions;
  } = {},
) {
  const services = createServices(config, options.db, options.identity);
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger: options.logging
      ? {
          level: 'info',
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers.set-cookie',
            'req.body.secret',
            'req.body.password',
            'req.body.token',
            'req.body.newPassword',
            'req.body.confirmPassword',
            'req.body.phone',
            'req.body.code',
            'req.body.registrationId',
            'req.body.access_token',
            'req.body.refresh_token',
            'req.body.appSecret',
            'req.body.inviteToken',
            'req.body.referralCode',
            'req.query.code',
            'req.query.state',
            'req.url',
          ],
        }
      : false,
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 120000,
    trustProxy: false,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 20 } });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/api/v1/assets/') && req.method === 'GET',
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: '映造 Studio API',
        version: '1.0.0',
        description:
          '带工作空间隔离的创作、资产、项目与任务接口。额度为本机预算单位，不代表供应商实际费用。',
      },
      servers: [{ url: config.publicOrigin }],
      components: {
        securitySchemes: {
          apiKey: { type: 'http', scheme: 'bearer' },
          session: { type: 'apiKey', in: 'cookie', name: 'studio_session' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    const allowed = new Set([new URL(config.publicOrigin).origin]);
    if (!config.isProduction) {
      const alias = new URL(config.publicOrigin);
      if (alias.hostname === '127.0.0.1') alias.hostname = 'localhost';
      else if (alias.hostname === 'localhost') alias.hostname = '127.0.0.1';
      allowed.add(alias.origin);
    }
    if ((origin && !allowed.has(origin)) || req.headers['sec-fetch-site'] === 'cross-site')
      throw new AppError(403, 'ORIGIN_REJECTED', '此请求来源不受信任');
    if (req.cookies.studio_session && !origin && !req.headers.authorization)
      throw new AppError(403, 'ORIGIN_REQUIRED', '会话写入请求必须提供同源 Origin');
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY');
    if (
      req.url.split('?')[0] === '/api/v1/auth/google/callback' ||
      req.url.split('?')[0]?.startsWith('/password/') ||
      req.url.split('?')[0] === '/auth/complete-registration'
    )
      reply.header('Referrer-Policy', 'no-referrer');
    else if (!reply.hasHeader('Referrer-Policy')) reply.header('Referrer-Policy', 'same-origin');
    if (req.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    if (
      req.url.split('?')[0]?.startsWith('/password/') ||
      req.url.split('?')[0] === '/auth/complete-registration'
    )
      reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: req.id,
      });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '输入信息不符合要求',
          details: error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        requestId: req.id,
      });
    if (error && typeof error === 'object' && 'validation' in error)
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '输入信息不符合要求',
          details: error.validation,
        },
        requestId: req.id,
      });
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (status >= 400 && status < 500)
      return reply.code(status).send({
        error: {
          code: 'REQUEST_REJECTED',
          message: status === 429 ? '请求过于频繁，请稍后重试' : '请求无法处理，请检查输入',
        },
        requestId: req.id,
      });
    req.log.error({ err: error, requestId: req.id }, 'Request failed');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务器暂时无法完成请求，请稍后再试' },
      requestId: req.id,
    });
  });
  app.get('/api/v1/health', async () => ({
    data: {
      status: services.db.sqlite.prepare('SELECT 1').get() ? 'ok' : 'error',
      database: 'sqlite',
      demoMode: config.demoMode,
      ffmpeg: services.settings.ffmpeg,
    },
  }));
  await registerCoreRoutes(app, services.core);
  await registerGoogleRoutes(app, services.google, services.core);
  await registerPasswordRoutes(app, services.passwordRecovery, services.core);
  await registerIdentityRoutes(app, services.identities, services.core);
  await registerTaskRoutes(app, services);
  await registerMailRoutes(app, services.mail, services.core);
  await app.register(async (scoped) => {
    scoped.removeContentTypeParser('application/json');
    scoped.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
    scoped.post(
      '/api/v1/billing/stripe/webhook',
      {
        bodyLimit: 1024 * 1024,
        schema: { hide: true },
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      },
      async (req) => {
        const signature = req.headers['stripe-signature'];
        if (typeof signature !== 'string' || !Buffer.isBuffer(req.body))
          throw new AppError(400, 'WEBHOOK_INVALID', 'Webhook签名或原始请求体缺失');
        return services.billing.handleWebhook(req.body, signature);
      },
    );
  });
  app.get('/api/v1/openapi.json', async (req) => {
    const actor = await services.core.authenticate(req);
    if (!actor) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
    return app.swagger();
  });
  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
    uiHooks: {
      onRequest: async (req) => {
        if (!(await services.core.authenticate(req)))
          throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
      },
    },
  });
  const webRoot = resolve('dist/web');
  if (options.serveWeb !== false && existsSync(webRoot)) {
    await app.register(staticFiles, { root: webRoot });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
        : reply.type('text/html').sendFile('index.html'),
    );
  }
  app.addHook('onClose', async () => {
    if (!options.db) closeDatabase(services.db);
  });
  return { app, services };
}

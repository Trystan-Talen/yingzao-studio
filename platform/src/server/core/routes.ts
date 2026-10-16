import '@fastify/cookie';
import '@fastify/multipart';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors';
import { IdSchema, PaginationSchema, type Actor } from '../../contracts/core';
import type { CoreServices } from './index';
import type { ListQuery } from './shared';
import { coreRouteSchema } from './route-schemas';
import { billingChannelSchema } from '../../contracts/billing-channel';
import { notificationQuerySchema } from '../../contracts/notifications';
import { supportChannelsSchema } from '../../contracts/support';
const listSchema = PaginationSchema.extend({
  q: z.string().max(200).optional(),
  kind: z.string().max(30).optional(),
  favorite: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  deleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  projectId: IdSchema.optional(),
  collectionId: IdSchema.optional(),
  tag: z.string().max(40).optional(),
  visibility: z.enum(['private', 'workspace']).optional(),
});
export async function registerCoreRoutes(app: FastifyInstance, core: CoreServices): Promise<void> {
  const actor = async (req: FastifyRequest): Promise<Actor> => {
    const a = await core.authenticate(req);
    if (!a) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
    return a;
  };
  const workspace = (req: FastifyRequest): string => {
    const value = req.headers['x-workspace-id'];
    if (typeof value !== 'string') throw new AppError(400, 'WORKSPACE_REQUIRED', '请选择工作空间');
    return IdSchema.parse(value);
  };
  const params = (req: FastifyRequest): Record<string, string> =>
    z.record(z.string(), z.string()).parse(req.params);
  const pid = (req: FastifyRequest): string => IdSchema.parse(params(req).id);
  const query = (req: FastifyRequest): ListQuery => listSchema.parse(req.query);
  const cookie = (reply: FastifyReply, secret: string) =>
    reply.setCookie('studio_session', secret, {
      httpOnly: true,
      sameSite: 'lax',
      secure: core.context.config.isProduction,
      path: '/',
      maxAge: 7 * 86400,
    });
  const session = async (req: FastifyRequest) => {
    const a = await actor(req);
    if (a.authType !== 'session') throw new AppError(403, 'FORBIDDEN', '需要账户会话');
    return a;
  };
  type Handler = (
    a: Actor,
    wid: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) => unknown | Promise<unknown>;
  const route = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    scope: string | null,
    handler: Handler,
    created = false,
  ) =>
    app.route({
      method,
      url: `/api/v1${url}`,
      schema: coreRouteSchema(method, url),
      handler: async (req, reply) => {
        const a = scope ? await actor(req) : await session(req),
          wid = workspace(req);
        if (scope) core.requireScope(a, scope);
        const result = await handler(a, wid, req, reply);
        if (reply.sent) return;
        reply.code(created ? 201 : 200);
        return { data: result };
      },
    });
  app.get('/api/v1/auth/status', { schema: coreRouteSchema('GET', '/auth/status') }, async () => ({
    data: core.auth.status(),
  }));
  app.post(
    '/api/v1/auth/register',
    {
      schema: coreRouteSchema('POST', '/auth/register'),
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      if (
        core.auth.status().setupRequired &&
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)
      )
        throw new AppError(403, 'LOCAL_SETUP_ONLY', '首次账户必须从本机创建');
      const { sessionToken, ...result } = await core.auth.register(req.body);
      cookie(reply, sessionToken);
      reply.code(201);
      return { data: result };
    },
  );
  app.post(
    '/api/v1/auth/login',
    {
      schema: coreRouteSchema('POST', '/auth/login'),
      config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const { sessionToken, ...result } = await core.auth.login(req.body);
      cookie(reply, sessionToken);
      return { data: result };
    },
  );
  app.get('/api/v1/auth/me', { schema: coreRouteSchema('GET', '/auth/me') }, async (req) => ({
    data: core.auth.me(await session(req)),
  }));
  app.get(
    '/api/v1/support/channels',
    {
      schema: { response: { 200: z.object({ data: supportChannelsSchema }) } },
    },
    async (req) => {
      await session(req);
      return { data: supportChannelsSchema.parse(core.context.config.support ?? {}) };
    },
  );
  app.patch('/api/v1/auth/me', { schema: coreRouteSchema('PATCH', '/auth/me') }, async (req) => ({
    data: core.auth.update(await session(req), req.body),
  }));
  app.post(
    '/api/v1/auth/logout',
    { schema: coreRouteSchema('POST', '/auth/logout') },
    async (req, reply) => {
      await session(req);
      core.auth.logout(req.cookies.studio_session);
      reply.clearCookie('studio_session', { path: '/' });
      return { data: { signedOut: true } };
    },
  );
  app.post(
    '/api/v1/auth/logout-others',
    { schema: coreRouteSchema('POST', '/auth/logout-others') },
    async (req) => {
      core.auth.revokeOtherSessions(await session(req), req.cookies.studio_session);
      return { data: { signedOut: true } };
    },
  );
  app.get('/api/v1/workspaces', { schema: coreRouteSchema('GET', '/workspaces') }, async (req) => {
    const items = core.auth.listWorkspaces(await session(req));
    return { data: { items, total: items.length, page: 1, pageSize: items.length } };
  });
  app.get(
    '/api/v1/team-creation',
    { schema: coreRouteSchema('GET', '/team-creation') },
    async (req) => ({ data: core.teamCreation.status(await session(req)) }),
  );
  app.post(
    '/api/v1/team-creation',
    { schema: coreRouteSchema('POST', '/team-creation') },
    async (req, reply) => {
      const result = core.teamCreation.reserve(await session(req), req.body);
      reply.code(201);
      return { data: result };
    },
  );
  app.post(
    '/api/v1/workspaces',
    { schema: coreRouteSchema('POST', '/workspaces') },
    async (req, reply) => {
      const result = core.team.create(await session(req), req.body);
      reply.code(201);
      return { data: result };
    },
  );
  route('PATCH', '/workspaces/:id', null, (a, w, r) => {
    if (pid(r) !== w) throw new AppError(400, 'WORKSPACE_MISMATCH', '空间不匹配');
    return core.team.update(a, w, r.body);
  });
  app.post(
    '/api/v1/workspaces/:id/activate',
    { schema: coreRouteSchema('POST', '/workspaces/:id/activate') },
    async (req) => ({
      data: core.team.activate(await session(req), pid(req)),
    }),
  );
  route('POST', '/workspaces/:id/leave', null, (a, w, r) => {
    if (pid(r) !== w) throw new AppError(400, 'WORKSPACE_MISMATCH', '空间不匹配');
    return core.team.leave(a, w, r.body);
  });
  route('POST', '/workspaces/:id/transfer', null, (a, w, r) => {
    if (pid(r) !== w) throw new AppError(400, 'WORKSPACE_MISMATCH', '空间不匹配');
    return core.team.transfer(a, w, r.body);
  });
  route('POST', '/workspaces/:id/archive', null, (a, w, r) => {
    if (pid(r) !== w) throw new AppError(400, 'WORKSPACE_MISMATCH', '空间不匹配');
    return core.team.archive(a, w, r.body);
  });
  route('GET', '/projects', 'projects:read', (a, w, r) => core.projects.list(a, w, query(r)));
  route(
    'POST',
    '/projects',
    'projects:write',
    (a, w, r) => core.projects.create(a, w, r.body),
    true,
  );
  route('GET', '/projects/:id', 'projects:read', (a, w, r) => core.projects.get(a, w, pid(r)));
  route('PATCH', '/projects/:id', 'projects:write', (a, w, r) =>
    core.projects.update(a, w, pid(r), r.body),
  );
  route('DELETE', '/projects/:id', 'projects:write', (a, w, r) =>
    core.projects.remove(a, w, pid(r)),
  );
  route('POST', '/projects/:id/restore', 'projects:write', (a, w, r) =>
    core.projects.restore(a, w, pid(r)),
  );
  route('PUT', '/projects/:id/favorite', null, (a, w, r) =>
    core.context.favorite(
      a,
      w,
      'project',
      pid(r),
      z.object({ favorite: z.boolean() }).strict().parse(r.body).favorite,
    ),
  );
  route('GET', '/projects/:id/document', 'projects:read', (a, w, r) =>
    core.documents.forProject(a, w, pid(r)),
  );
  route('GET', '/documents/:id', 'projects:read', (a, w, r) => core.documents.get(a, w, pid(r)));
  route('PATCH', '/documents/:id', 'projects:write', (a, w, r) =>
    core.documents.save(a, w, pid(r), r.body),
  );
  route('GET', '/documents/:id/versions', 'projects:read', (a, w, r) =>
    core.documents.versions(a, w, pid(r), query(r)),
  );
  route('GET', '/documents/:id/versions/:revision', 'projects:read', (a, w, r) =>
    core.documents.version(
      a,
      w,
      pid(r),
      z.coerce.number().int().positive().parse(params(r).revision),
    ),
  );
  route('POST', '/documents/:id/restore', 'projects:write', (a, w, r) =>
    core.documents.restore(a, w, pid(r), r.body),
  );
  route('GET', '/assets', 'assets:read', (a, w, r) => core.assets.list(a, w, query(r)));
  route(
    'POST',
    '/assets/upload',
    'assets:write',
    async (a, w, r) => {
      core.requireAccess(a, w, 'write');
      let buffer: Buffer | undefined,
        name = '',
        mimeType = '';
      const fields: Record<string, string> = {};
      for await (const part of r.parts({
        limits: { files: 1, fileSize: 100 * 1024 * 1024, fields: 3 },
      })) {
        if (part.type === 'file') {
          buffer = await part.toBuffer();
          name = part.filename;
          mimeType = part.mimetype;
          if (part.file.truncated) throw new AppError(413, 'FILE_TOO_LARGE', '文件超出大小限制');
        } else fields[part.fieldname] = String(part.value);
      }
      if (!buffer) throw new AppError(400, 'FILE_REQUIRED', '请选择文件');
      const input = z
        .object({
          projectId: IdSchema.optional(),
          name: z.string().max(200).optional(),
          tags: z.string().optional(),
        })
        .strict()
        .parse(fields);
      let tags: unknown = [];
      if (input.tags) {
        try {
          tags = JSON.parse(input.tags);
        } catch {
          throw new AppError(400, 'INVALID_TAGS', '标签须为JSON数组');
        }
      }
      return core.assets.ingest(
        a,
        w,
        {
          buffer,
          name: input.name ?? name,
          mimeType,
          projectId: input.projectId,
          tags: z.array(z.string()).parse(tags),
        },
        r.headers['x-upload-id'] === undefined
          ? undefined
          : IdSchema.parse(r.headers['x-upload-id']),
      );
    },
    true,
  );
  route('GET', '/assets/:id', 'assets:read', (a, w, r) => core.assets.get(a, w, pid(r)));
  route('PATCH', '/assets/:id', 'assets:write', (a, w, r) =>
    core.assets.update(a, w, pid(r), r.body),
  );
  route('DELETE', '/assets/:id', 'assets:write', (a, w, r) => core.assets.remove(a, w, pid(r)));
  route('POST', '/assets/:id/restore', 'assets:write', (a, w, r) =>
    core.assets.restore(a, w, pid(r)),
  );
  route('PUT', '/assets/:id/favorite', null, (a, w, r) =>
    core.context.favorite(
      a,
      w,
      'asset',
      pid(r),
      z.object({ favorite: z.boolean() }).strict().parse(r.body).favorite,
    ),
  );
  route('GET', '/assets/:id/text', 'assets:read', (a, w, r) => core.assets.text(a, w, pid(r)));
  app.get(
    '/api/v1/assets/:id/content',
    { schema: coreRouteSchema('GET', '/assets/:id/content') },
    async (req, reply) => {
      const a = await actor(req);
      core.requireScope(a, 'assets:read');
      const aid = pid(req),
        wid = core.assets.resolveWorkspace(aid);
      if (req.headers['x-workspace-id'] && req.headers['x-workspace-id'] !== wid)
        throw new AppError(403, 'FORBIDDEN', '空间不匹配');
      const q = z
        .object({
          variant: z.enum(['original', 'preview', 'thumbnail']).default('original'),
          download: z.literal('1').optional(),
        })
        .parse(req.query);
      const file = core.assets.variant(a, wid, aid, q.variant);
      reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type(file.mimeType)
        .header('Accept-Ranges', 'bytes')
        .header(
          'Content-Disposition',
          `${q.download || (!file.mimeType.startsWith('image/') && !file.mimeType.startsWith('video/') && !file.mimeType.startsWith('audio/')) ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        );
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2]))
          throw new AppError(416, 'INVALID_RANGE', 'Range无效');
        const start = match[1] ? Number(match[1]) : Math.max(0, file.byteSize - Number(match[2])),
          end = match[1] ? (match[2] ? Number(match[2]) : file.byteSize - 1) : file.byteSize - 1;
        if (start > end || end >= file.byteSize) {
          reply.header('Content-Range', `bytes */${file.byteSize}`);
          throw new AppError(416, 'INVALID_RANGE', 'Range超出文件范围');
        }
        reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${file.byteSize}`)
          .header('Content-Length', end - start + 1);
        return reply.send(
          createReadStream(core.assets.storage.path(file.storageKey), { start, end }),
        );
      }
      reply.header('Content-Length', file.byteSize);
      return reply.send(createReadStream(core.assets.storage.path(file.storageKey)));
    },
  );
  route('GET', '/collections', null, (a, w, r) => core.references.collections(a, w, query(r)));
  route(
    'POST',
    '/collections',
    null,
    (a, w, r) => core.references.createCollection(a, w, r.body),
    true,
  );
  route('PATCH', '/collections/:id', null, (a, w, r) =>
    core.references.updateCollection(a, w, pid(r), r.body),
  );
  route('DELETE', '/collections/:id', null, (a, w, r) =>
    core.references.removeCollection(a, w, pid(r)),
  );
  route('PUT', '/collections/:id/assets', null, (a, w, r) =>
    core.references.setCollectionAssets(a, w, pid(r), r.body),
  );
  route('GET', '/brands', null, (a, w, r) => core.references.brands(a, w, query(r)));
  route('POST', '/brands', null, (a, w, r) => core.references.createBrand(a, w, r.body), true);
  route('GET', '/brands/:id', null, (a, w, r) => core.references.getBrand(a, w, pid(r)));
  route('PATCH', '/brands/:id', null, (a, w, r) =>
    core.references.updateBrand(a, w, pid(r), r.body),
  );
  route('DELETE', '/brands/:id', null, (a, w, r) => core.references.removeBrand(a, w, pid(r)));
  route('POST', '/brands/:id/restore', null, (a, w, r) =>
    core.references.restoreBrand(a, w, pid(r)),
  );
  route('GET', '/characters', null, (a, w, r) => core.references.characters(a, w, query(r)));
  route(
    'POST',
    '/characters',
    null,
    (a, w, r) => core.references.createCharacter(a, w, r.body),
    true,
  );
  route('GET', '/characters/:id', null, (a, w, r) => core.references.getCharacter(a, w, pid(r)));
  route('PATCH', '/characters/:id', null, (a, w, r) =>
    core.references.updateCharacter(a, w, pid(r), r.body),
  );
  route('DELETE', '/characters/:id', null, (a, w, r) =>
    core.references.removeCharacter(a, w, pid(r)),
  );
  route('GET', '/members', null, (a, w, r) => core.team.members(a, w, query(r)));
  route('PATCH', '/members/:id', null, (a, w, r) => core.team.updateMember(a, w, pid(r), r.body));
  route('DELETE', '/members/:id', null, (a, w, r) => core.team.removeMember(a, w, pid(r)));
  route('GET', '/members/export', null, async (a, w, r, reply) => {
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }).parse(r.query);
    const file = await core.memberImport.export(a, w, format);
    return reply
      .type(file.mimeType)
      .header('Content-Disposition', `attachment; filename="${file.name}"`)
      .send(file.buffer);
  });
  route('GET', '/members/import/template', null, async (a, w, r, reply) => {
    core.requireAccess(a, w, 'manage');
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }).parse(r.query);
    const file = await core.memberImport.template(format);
    return reply
      .type(file.mimeType)
      .header('Content-Disposition', `attachment; filename="${file.name}"`)
      .send(file.buffer);
  });
  route('POST', '/members/import/preview', null, async (a, w, r) => {
    core.requireAccess(a, w, 'manage');
    const file = await r.file({ limits: { files: 1, fileSize: 2 * 1024 * 1024 } });
    if (!file) throw new AppError(400, 'FILE_REQUIRED', '请选择CSV或XLSX文件');
    return core.memberImport.preview(a, w, await file.toBuffer(), file.filename);
  });
  route('POST', '/members/import', null, (a, w, r) => core.memberImport.apply(a, w, r.body));
  route('GET', '/invitations', null, (a, w, r) => core.team.invitations(a, w, query(r)));
  route('POST', '/invitations', null, (a, w, r) => core.team.invite(a, w, r.body), true);
  route('DELETE', '/invitations/:id', null, (a, w, r) => core.team.revokeInvitation(a, w, pid(r)));
  app.post(
    '/api/v1/invitations/accept',
    { schema: coreRouteSchema('POST', '/invitations/accept') },
    async (req) => ({
      data: core.team.accept(await session(req), req.body),
    }),
  );
  route('GET', '/audit-events', null, (a, w, r) => core.team.audit(a, w, query(r)));
  route('GET', '/api-keys', null, (a, w, r) => core.business.keys(a, w, query(r)));
  route(
    'POST',
    '/api-keys',
    null,
    (a, w, r, reply) => {
      reply.header('Cache-Control', 'no-store');
      return core.business.createKey(a, w, r.body);
    },
    true,
  );
  route('DELETE', '/api-keys/:id', null, (a, w, r) => core.business.revokeKey(a, w, pid(r)));
  app.get('/api/v1/plans', { schema: coreRouteSchema('GET', '/plans') }, async (req) => ({
    data: core.business.plans(query(req)),
  }));
  route('GET', '/plans/eligible', null, (a, w, r) => core.business.plans(query(r), a, w));
  route('GET', '/subscriptions', null, (a, w, r) => core.business.subscriptions(a, w, query(r)));
  route('POST', '/subscriptions/:id/cancel', null, (a, w, r) =>
    core.business.cancelSubscription(a, w, pid(r)),
  );
  route('GET', '/orders', null, (a, w, r) =>
    core.business.orders(
      a,
      w,
      query(r),
      z.object({ billingChannel: billingChannelSchema.default('web') }).parse(r.query)
        .billingChannel,
    ),
  );
  route('GET', '/orders/:id', null, (a, w, r) => core.business.getOrder(a, w, pid(r)));
  route('GET', '/orders/:id/billing-document', null, (a, w, r) =>
    core.business.billingDocument(a, w, pid(r)),
  );
  route('POST', '/orders', null, (a, w, r) => core.business.createOrder(a, w, r.body), true);
  route('POST', '/orders/:id/checkout', null, (a, w, r) => core.business.checkout(a, w, pid(r)));
  route('POST', '/orders/:id/cancel', null, (a, w, r) => core.business.cancelOrder(a, w, pid(r)));
  route('GET', '/invoice-titles', null, (a, w, r) => core.business.titles(a, w, query(r)));
  route(
    'POST',
    '/invoice-titles',
    null,
    (a, w, r) => core.business.createTitle(a, w, r.body),
    true,
  );
  route('PATCH', '/invoice-titles/:id', null, (a, w, r) =>
    core.business.updateTitle(a, w, pid(r), r.body),
  );
  route('DELETE', '/invoice-titles/:id', null, (a, w, r) =>
    core.business.removeTitle(a, w, pid(r)),
  );
  route('GET', '/invoices', null, (a, w, r) => core.business.invoices(a, w, query(r)));
  route('POST', '/invoices', null, (a, w, r) => core.business.createInvoice(a, w, r.body), true);
  route('POST', '/invoices/:id/submit', null, (a, w, r) =>
    core.business.submitInvoice(a, w, pid(r)),
  );
  route('GET', '/support/tickets', null, (a, w, r) => core.business.tickets(a, w, query(r)));
  route(
    'POST',
    '/support/tickets',
    null,
    (a, w, r) => core.business.createTicket(a, w, r.body),
    true,
  );
  route('GET', '/support/tickets/:id', null, (a, w, r) => core.business.ticket(a, w, pid(r)));
  route('POST', '/support/tickets/:id/replies', null, (a, w, r) =>
    core.business.reply(a, w, pid(r), r.body),
  );
  route('POST', '/support/tickets/:id/withdraw', null, (a, w, r) =>
    core.business.withdraw(a, w, pid(r)),
  );
  route('GET', '/invoices/:id', null, (a, w, r) => core.business.invoice(a, w, pid(r)));
  route('POST', '/invoices/:id/withdraw', null, (a, w, r) =>
    core.business.withdrawInvoice(a, w, pid(r), r.body),
  );
  route('GET', '/referrals', null, (a, w) => core.business.referrals(a, w));
  route('GET', '/referrals/records', null, (a, w, r) => core.referrals.records(a, w, query(r)));
  route('GET', '/referrals/channel/summary', null, (a, w) => core.referrals.channelSummary(a, w));
  route('GET', '/referrals/channel/export', null, (a, w, _r, reply) =>
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="channel-statistics.csv"')
      .send(core.referrals.channelCsv(a, w)),
  );
  route('GET', '/characters/:id/authorization', null, (a, w, r) =>
    core.identity.getAuthorization(a, w, pid(r)),
  );
  route('POST', '/characters/:id/authorization', null, (a, w, r) =>
    core.identity.authorize(a, w, pid(r), r.body),
  );
  route('DELETE', '/characters/:id/authorization', null, (a, w, r) =>
    core.identity.withdraw(a, w, pid(r), r.body),
  );
  route('GET', '/characters/:id/verification', null, (a, w, r) =>
    core.identity.verification(a, w, pid(r)),
  );
  route('POST', '/characters/:id/verification/start', null, (a, w, r) =>
    core.identity.startVerification(a, w, pid(r)),
  );
  route('POST', '/characters/:id/verification/:sessionId/poll', null, (a, w, r) =>
    core.identity.poll(a, w, pid(r), IdSchema.parse(params(r).sessionId)),
  );

  route('GET', '/notifications', null, (a, w, r) =>
    core.business.notifications(a, w, notificationQuerySchema.parse(r.query)),
  );
  route('GET', '/notifications/unread', null, (a, w) => core.business.notificationUnread(a, w));
  route('GET', '/entitlements', null, (a, w) => core.entitlements.get(a, w));
  route('POST', '/notifications/:id/read', null, (a, w, r) =>
    core.business.readNotification(a, w, pid(r)),
  );
  route('GET', '/projects/:id/shares', null, (a, w, r) => core.shares.list(a, w, pid(r), query(r)));
  route(
    'POST',
    '/shares',
    null,
    (a, w, r, reply) => {
      reply.header('Cache-Control', 'no-store');
      return core.shares.create(a, w, r.body);
    },
    true,
  );
  route('DELETE', '/shares/:id', null, (a, w, r) => core.shares.revoke(a, w, pid(r)));
  app.post(
    '/api/v1/public/shares/read',
    { schema: coreRouteSchema('POST', '/public/shares/read') },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { data: core.shares.read(req.body) };
    },
  );
  app.post(
    '/api/v1/public/shares/asset',
    { schema: coreRouteSchema('POST', '/public/shares/asset') },
    async (req, reply) => {
      const file = core.shares.media(req.body);
      reply
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type(file.mimeType);
      return reply.send(createReadStream(core.assets.storage.path(file.storageKey)));
    },
  );
}

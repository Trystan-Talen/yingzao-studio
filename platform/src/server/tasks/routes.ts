import { channelForActor, type BillingChannel } from '../../contracts/billing-channel';
import { registerInspirationRoutes } from './inspirations';
import JSZip from 'jszip';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ServerResponse } from 'node:http';
import type { Actor, Permission } from '../../contracts/core';
import { jobInputSchema, jobSubmitSchema, providerSettingsInputSchema } from '../../contracts/jobs';
import { designPlanResultSchema, type DesignPlanResult } from '../../contracts/design-plan';
import { AppError } from '../errors';
import type { TaskServices } from './service';
import { checkScope } from './validation';
import { now, type ItemRow } from './types';
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
const idParams = z.object({ id: z.string().uuid() });
export async function registerTaskRoutes(app: FastifyInstance, s: TaskServices) {
  const streams = new Set<ServerResponse>();
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.end();
    streams.clear();
  });
  const { core, db } = s,
    sql = db.sqlite;
  async function access(
    req: FastifyRequest,
    permission: Permission = 'read',
    scope?: string,
  ): Promise<{ actor: Actor; wid: string }> {
    const actor = await core.authenticate(req);
    if (!actor) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
    const wid = z
      .string()
      .uuid()
      .parse(
        req.headers['x-workspace-id'] ??
          (req.query as Record<string, unknown>)?.workspaceId ??
          actor.workspaceId,
      );
    core.requireAccess(actor, wid, permission);
    if (scope) checkScope(actor, scope);
    return { actor, wid };
  }
  const response = (data: unknown) => ({ data });
  const page = (items: unknown[]) => ({
    items,
    total: items.length,
    page: 1,
    pageSize: Math.max(1, items.length),
  });
  app.get('/api/v1/capabilities', async (req) => {
    const { wid } = await access(req, 'read', 'jobs:read');
    return response(s.settings.capabilities(wid));
  });
  app.get('/api/v1/providers', async (req) => {
    const { wid } = await access(req, 'manage');
    return response(page(s.settings.list(wid)));
  });
  app.put('/api/v1/providers', { schema: { body: providerSettingsInputSchema } }, async (req) => {
    const { actor, wid } = await access(req, 'manage');
    const input = providerSettingsInputSchema.parse(req.body);
    const data = s.transaction(() => {
      const result = s.settings.update(wid, input);
      core.context.audit(actor, wid, 'provider.configure', 'provider', input.providerId, {
        enabled: input.enabled,
      });
      return result;
    });
    return response(data);
  });
  app.post('/api/v1/quotes', { schema: { body: jobInputSchema } }, async (req) => {
    const { actor, wid } = await access(req, 'write', 'jobs:write');
    return response(s.quote(actor, wid, req.body));
  });
  app.post('/api/v1/jobs', { schema: { body: jobSubmitSchema } }, async (req, reply) => {
    const { actor, wid } = await access(req, 'write', 'jobs:write');
    const b = jobSubmitSchema.parse(req.body);
    return reply
      .code(202)
      .send(response(s.submit(actor, wid, b.input, b.quoteId, b.clientRequestId)));
  });
  app.get(
    '/api/v1/jobs',
    {
      schema: {
        querystring: pageQuery.extend({
          status: z.string().max(40).optional(),
          projectId: z.string().uuid().optional(),
          operation: z.string().max(80).optional(),
          from: z.iso.datetime().optional(),
          to: z.iso.datetime().optional(),
          createdBy: z.string().uuid().optional(),
          downloaded: z.enum(['true', 'false']).optional(),
          archived: z.enum(['true', 'false']).optional(),
          q: z.string().max(200).optional(),
        }),
      },
    },
    async (req) => {
      const { actor, wid } = await access(req, 'read', 'jobs:read');
      return response(s.list(actor, wid, req.query as z.infer<typeof pageQuery>));
    },
  );
  app.get(
    '/api/v1/jobs/by-request/:requestId',
    { schema: { params: z.object({ requestId: z.string().uuid() }) } },
    async (req) => {
      const { actor, wid } = await access(req, 'read', 'jobs:read');
      const { requestId } = req.params as { requestId: string };
      return response(s.getByRequest(actor, wid, requestId));
    },
  );
  app.get('/api/v1/jobs/:id', { schema: { params: idParams } }, async (req) => {
    const { actor, wid } = await access(req, 'read', 'jobs:read');
    return response(s.get(actor, wid, idParams.parse(req.params).id));
  });
  app.patch(
    '/api/v1/jobs/:id/history',
    { schema: { params: idParams, body: z.object({ archived: z.boolean() }).strict() } },
    async (req) => {
      const { actor, wid } = await access(req, 'write', 'jobs:write'),
        id = idParams.parse(req.params).id,
        job = s.get(actor, wid, id),
        { archived } = req.body as { archived: boolean };
      if (archived && ['queued', 'running', 'reconciliation_required'].includes(job.status))
        throw new AppError(409, 'JOB_ACTIVE', '进行中或待核对任务不能归档');
      s.transaction(() => {
        if (archived)
          sql
            .prepare('INSERT OR IGNORE INTO job_history_archives VALUES(?,?,?)')
            .run(actor.userId, id, now());
        else
          sql
            .prepare('DELETE FROM job_history_archives WHERE user_id=? AND job_id=?')
            .run(actor.userId, id);
        core.context.audit(actor, wid, 'job.history.archive', 'job', id, { archived });
      });
      return response({ id, archived });
    },
  );
  app.post('/api/v1/jobs/:id/downloaded', { schema: { params: idParams } }, async (req) => {
    const { actor, wid } = await access(req, 'read', 'jobs:read'),
      id = idParams.parse(req.params).id;
    s.get(actor, wid, id);
    sql
      .prepare(
        'INSERT INTO job_downloads VALUES(?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET downloaded_at=excluded.downloaded_at',
      )
      .run(actor.userId, id, now());
    return response({ id, downloadedAt: now() });
  });
  app.post(
    '/api/v1/assets/download-zip',
    {
      schema: { body: z.object({ assetIds: z.array(z.string().uuid()).min(1).max(50) }).strict() },
    },
    async (req, reply) => {
      const { actor, wid } = await access(req, 'read', 'assets:read'),
        { assetIds } = req.body as { assetIds: string[] };
      const assets = [...new Set(assetIds)].map((id) => core.assets.get(actor, wid, id));
      if (assets.reduce((n, a) => n + a.byteSize, 0) > 200 * 1024 * 1024)
        throw new AppError(413, 'ARCHIVE_LIMIT', '单次ZIP原件合计最多200MB，请分批下载');
      const archive = new JSZip();
      for (const [index, asset] of assets.entries()) {
        const file = await core.assets.readOriginal(actor, wid, asset.id);
        archive.file(`${index + 1}-${asset.name.replace(/[\\/\u0000-\u001f]/g, '_')}`, file.buffer);
      }
      archive.file(
        'manifest.json',
        JSON.stringify(
          {
            formatVersion: 1,
            createdAt: now(),
            assets: assets.map(({ id, name, mimeType, width, height, sourceJobId, source }) => ({
              id,
              name,
              mimeType,
              width,
              height,
              sourceJobId,
              source,
            })),
          },
          null,
          2,
        ),
      );
      core.requireAccess(actor, wid, 'read');
      return reply
        .type('application/zip')
        .header('Content-Disposition', 'attachment; filename="yingzao-assets.zip"')
        .send(await archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
    },
  );
  app.post(
    '/api/v1/jobs/download-zip',
    { schema: { body: z.object({ jobIds: z.array(z.string().uuid()).min(1).max(30) }).strict() } },
    async (req, reply) => {
      const { actor, wid } = await access(req, 'read', 'jobs:read');
      checkScope(actor, 'assets:read');
      const { jobIds } = req.body as { jobIds: string[] },
        jobs = [...new Set(jobIds)].map((id) => s.get(actor, wid, id));
      if (
        jobs.reduce((sum, j) => sum + j.outputAssets.reduce((n, a) => n + a.byteSize, 0), 0) >
        200 * 1024 * 1024
      )
        throw new AppError(413, 'ARCHIVE_LIMIT', '单次ZIP原件合计最多200MB，请分批下载');
      const archive = new JSZip();
      let outputs = 0;
      for (const job of jobs) {
        for (const [index, a] of job.outputAssets.entries()) {
          const f = await core.assets.readOriginal(actor, wid, a.id);
          archive.file(
            `${job.id}/${index + 1}-${a.name.replace(/[\\/\u0000-\u001f]/g, '_')}`,
            f.buffer,
          );
          outputs++;
        }
        for (const item of job.items)
          if (item.resultText) {
            archive.file(`${job.id}/${item.index + 1}-result.txt`, item.resultText);
            outputs++;
          }
      }
      if (!outputs) throw new AppError(409, 'NO_RESULTS', '选中的任务没有可下载产物');
      archive.file(
        'manifest.json',
        JSON.stringify(
          {
            formatVersion: 1,
            createdAt: now(),
            jobs: jobs.map((j) => ({
              id: j.id,
              operation: j.operation,
              providerId: j.providerId,
              status: j.status,
              input: j.input,
              createdAt: j.createdAt,
              items: j.items,
            })),
          },
          null,
          2,
        ),
      );
      core.requireAccess(actor, wid, 'read');
      return reply
        .type('application/zip')
        .header('Content-Disposition', 'attachment; filename="yingzao-results.zip"')
        .send(await archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
    },
  );
  app.post('/api/v1/jobs/:id/cancel', { schema: { params: idParams } }, async (req) => {
    const { actor, wid } = await access(req, 'write', 'jobs:write');
    return response(s.cancel(actor, wid, idParams.parse(req.params).id));
  });
  app.post('/api/v1/jobs/:id/retry-quote', { schema: { params: idParams } }, async (req) => {
    const { actor, wid } = await access(req, 'write', 'jobs:write');
    return response(s.retryQuote(actor, wid, idParams.parse(req.params).id));
  });
  app.post(
    '/api/v1/jobs/:id/reconcile',
    {
      schema: {
        params: idParams,
        body: z.object({
          itemId: z.string().uuid(),
          outcome: z.enum(['failed', 'succeeded']),
          assetId: z.string().uuid().optional(),
          assetIds: z.array(z.string().uuid()).min(1).max(10).optional(),
          resultText: z.string().max(50000).optional(),
          resultData: designPlanResultSchema.optional(),
          evidence: z.string().min(10).max(2000),
        }),
      },
    },
    async (req) => {
      const { actor, wid } = await access(req, 'manage');
      const jobId = idParams.parse(req.params).id;
      s.get(actor, wid, jobId);
      const b = req.body as {
        itemId: string;
        outcome: 'failed' | 'succeeded';
        assetId?: string;
        assetIds?: string[];
        resultText?: string;
        resultData?: DesignPlanResult;
        evidence: string;
      };
      return response(
        s.transaction(() => {
          const item = sql
            .prepare(
              "SELECT * FROM job_items WHERE id=? AND job_id=? AND workspace_id=? AND status='reconciliation_required'",
            )
            .get(b.itemId, jobId, wid) as ItemRow | undefined;
          if (!item) throw new AppError(409, 'RECONCILIATION_STATE', '该子任务不在待核对状态');
          const input = jobInputSchema.parse(JSON.parse(item.input_json));
          const layered = input.operation === 'image.layers';
          const isText = ['text.assist', 'image.ocr'].includes(input.operation);
          const ids = [...new Set(b.assetIds ?? (b.assetId ? [b.assetId] : []))];
          const text = b.resultText?.trim() || null;
          if (
            b.resultData &&
            (input.operation !== 'text.assist' || input.options.assistantMode !== 'design-plan')
          )
            throw new AppError(400, 'RESULT_KIND', '只有设计方案任务可以附带方案结构');
          if (b.outcome === 'failed' && (ids.length || text || b.resultData))
            throw new AppError(400, 'UNEXPECTED_RESULT', '失败核对不能附加成功产物');
          const assets = ids.map((id) => core.assets.get(actor, wid, id));
          if (b.outcome === 'succeeded') {
            if (
              isText
                ? !text || assets.length
                : !assets.length || text || (!layered && assets.length !== 1)
            )
              throw new AppError(
                400,
                'RESULT_REQUIRED',
                '请提供与任务类型一致的真实结果：文字任务需要文本，媒体任务需要对应原始文件',
              );
            const expectedKind =
              input.operation.startsWith('video.') ||
              ['video-replica', 'local.video-trim', 'media.import'].includes(input.operation)
                ? 'video'
                : 'image';
            if (assets.some((a) => a.kind !== expectedKind))
              throw new AppError(400, 'RESULT_KIND', '产物类型与任务不一致');
            if (
              layered &&
              assets.some((a) => a.width !== assets[0]!.width || a.height !== assets[0]!.height)
            )
              throw new AppError(400, 'LAYER_SIZE', '所有图层画幅必须一致');
          }
          sql
            .prepare(
              "UPDATE job_items SET status=?,phase='done',asset_id=?,result_text=?,result_data_json=?,output_kind=?,lease_owner=NULL,lease_until=NULL,error_message=NULL,updated_at=? WHERE id=?",
            )
            .run(
              b.outcome,
              ids[0] || null,
              text,
              b.resultData ? JSON.stringify(b.resultData) : null,
              layered ? 'layers' : 'single',
              now(),
              item.id,
            );
          for (const [index, id] of ids.entries())
            sql.prepare('INSERT INTO job_item_assets VALUES(?,?,?)').run(item.id, id, index);
          if (b.outcome === 'succeeded' && ids[0] && input.documentId && input.baseRevision) {
            sql
              .prepare(
                'INSERT OR IGNORE INTO pending_applies(id,workspace_id,document_id,job_id,item_id,asset_id,base_revision,target_layer_id,status,created_at,updated_at,asset_ids_json,output_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
              )
              .run(
                randomUUID(),
                wid,
                input.documentId,
                jobId,
                item.id,
                ids[0],
                input.baseRevision,
                input.targetLayerId || null,
                'pending',
                now(),
                now(),
                JSON.stringify(ids),
                layered ? 'layers' : 'single',
              );
          }
          if (b.outcome === 'succeeded' && input.projectId) {
            sql.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run(
              randomUUID(),
              wid,
              input.projectId,
              actor.userId,
              'assistant',
              text || '管理员已核对服务商真实产物，可预览或应用到画布。',
              jobId,
              JSON.stringify({
                assetIds: ids,
                assetId: ids[0] || null,
                outputKind: layered ? 'layers' : 'single',
                reconciled: true,
                ...(b.resultData ? { resultData: b.resultData } : {}),
              }),
              now(),
            );
          }
          s.credits
            .forChannel(item.billing_channel)
            .finish(wid, item.user_id, item.credits, jobId, item.id, b.outcome === 'succeeded');
          core.context.audit(actor, wid, 'job.reconcile', 'job', jobId, {
            itemId: item.id,
            outcome: b.outcome,
            evidence: b.evidence,
            assetIds: ids,
          });
          s.refresh(jobId);
          return s.get(actor, wid, jobId);
        }),
      );
    },
  );
  app.get('/api/v1/job-events', async (req, reply) => {
    const { actor, wid } = await access(req, 'read', 'jobs:read');
    let cursor = z.coerce
      .number()
      .int()
      .min(0)
      .parse(req.headers['last-event-id'] ?? (req.query as Record<string, unknown>).after ?? 0);
    reply.hijack();
    streams.add(reply.raw);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let flushing = false;
    const flush = async () => {
      if (flushing || reply.raw.destroyed || reply.raw.writableEnded) return;
      flushing = true;
      try {
        const current = await core.authenticate(req);
        if (
          !current ||
          current.userId !== actor.userId ||
          current.authType !== actor.authType ||
          current.apiKeyId !== actor.apiKeyId
        )
          throw new AppError(401, 'UNAUTHENTICATED', '登录或密钥已撤销');
        core.requireAccess(current, wid, 'read');
        checkScope(current, 'jobs:read');
        const rows = sql
          .prepare(
            'SELECT id,job_id,type,payload,created_at FROM job_events WHERE workspace_id=? AND id>? ORDER BY id LIMIT 100',
          )
          .all(wid, cursor) as {
          id: number;
          job_id: string;
          type: string;
          payload: string;
          created_at: string;
        }[];
        for (const row of rows) {
          reply.raw.write(
            `id: ${row.id}\nevent: job\ndata: ${JSON.stringify({ jobId: row.job_id, type: row.type, payload: JSON.parse(row.payload), createdAt: row.created_at })}\n\n`,
          );
          cursor = row.id;
        }
        reply.raw.write(': keepalive\n\n');
      } catch {
        reply.raw.end();
      } finally {
        flushing = false;
      }
    };
    void flush();
    const timer = setInterval(flush, 2500);
    timer.unref();
    reply.raw.on('close', () => {
      clearInterval(timer);
      streams.delete(reply.raw);
    });
  });
  async function creditAccess(req: FastifyRequest, apiAdmin = false) {
    const result = await access(
      req,
      apiAdmin ? 'manage' : 'read',
      apiAdmin ? undefined : 'credits:read',
    );
    if (apiAdmin && result.actor.authType !== 'session')
      throw new AppError(403, 'SESSION_REQUIRED', '接口账户管理需要管理员网页登录');
    return {
      ...result,
      channel: (apiAdmin ? 'api' : channelForActor(result.actor)) as BillingChannel,
    };
  }
  const ledgerQuery = pageQuery.extend({
    kind: z.enum(['grant', 'reserve', 'settle', 'release', 'adjustment']).optional(),
  });
  for (const apiAdmin of [false, true]) {
    const base = apiAdmin ? '/api/v1/credits/api' : '/api/v1/credits';
    app.get(base, async (req) => {
      const { actor, wid, channel } = await creditAccess(req, apiAdmin);
      return response(s.balance(actor, wid, channel));
    });
    app.get(`${base}/ledger`, { schema: { querystring: ledgerQuery } }, async (req) => {
      const { wid, channel } = await creditAccess(req, apiAdmin);
      const q = ledgerQuery.parse(req.query);
      const where = `workspace_id=? AND billing_channel=?${q.kind ? ' AND kind=?' : ''}`;
      const args = q.kind ? [wid, channel, q.kind] : [wid, channel];
      const total = (
        sql.prepare(`SELECT COUNT(*) AS n FROM credit_ledger WHERE ${where}`).get(...args) as {
          n: number;
        }
      ).n;
      const items = sql
        .prepare(
          `SELECT id,user_id AS userId,job_id AS jobId,item_id AS itemId,billing_channel AS billingChannel,kind,amount,balance_after AS balanceAfter,reserved_after AS reservedAfter,description,created_at AS createdAt FROM credit_ledger WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
        )
        .all(...args, q.pageSize, (q.page - 1) * q.pageSize);
      return response({ ...q, items, total });
    });
    app.get(`${base}/buckets`, async (req) => {
      const { wid, channel } = await creditAccess(req, apiAdmin);
      return response(s.credits.forChannel(channel).buckets(wid));
    });
  }
  app.get('/api/v1/credits/settings', async (req) => {
    const { actor, wid } = await access(req, 'read', 'credits:read');
    if (actor.authType !== 'session')
      throw new AppError(403, 'SESSION_REQUIRED', '网页预算设置需要网页登录');
    const stored = sql
      .prepare(
        'SELECT credit_mode AS mode,concurrency_limit AS concurrencyLimit FROM workspace_billing WHERE workspace_id=?',
      )
      .get(wid) as { mode: string; concurrencyLimit: number };
    return response({
      ...stored,
      concurrencyLimit: Math.min(
        stored.concurrencyLimit,
        core.entitlements.effective(wid).limits.concurrency,
      ),
    });
  });
  app.get('/api/v1/export-policy', async (req, reply) => {
    const { wid } = await access(req, 'read', 'projects:read');
    reply.header('Cache-Control', 'no-store');
    return response(core.entitlements.exportPolicy(wid));
  });
  app.put(
    '/api/v1/credits/settings',
    { schema: { body: z.object({ mode: z.enum(['shared', 'allocated']) }).strict() } },
    async (req) => {
      const { actor, wid } = await access(req, 'manage');
      if (actor.authType !== 'session')
        throw new AppError(403, 'SESSION_REQUIRED', '网页预算设置需要网页登录');
      const { mode } = req.body as { mode: string };
      s.transaction(() => {
        s.credits.setMode(wid, mode as 'shared' | 'allocated', actor.userId);
        core.context.audit(actor, wid, 'budget.mode', 'workspace', wid, { mode });
      });
      return response({ mode });
    },
  );
  app.get('/api/v1/credits/members', async (req) => {
    const { actor, wid } = await access(req, 'read', 'credits:read');
    if (actor.authType !== 'session')
      throw new AppError(403, 'SESSION_REQUIRED', '网页成员预算需要网页登录');
    const role = core.requireAccess(actor, wid, 'read').role;
    const items = sql
      .prepare(
        `SELECT m.user_id AS userId,u.display_name AS displayName,b.credit_limit AS creditLimit,COALESCE(b.spent,0) AS spent,COALESCE(b.reserved,0) AS reserved FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN member_budgets b ON b.user_id=m.user_id AND b.workspace_id=m.workspace_id AND b.billing_channel='web' WHERE m.workspace_id=? ${['owner', 'admin'].includes(role) ? '' : 'AND m.user_id=?'}`,
      )
      .all(...(['owner', 'admin'].includes(role) ? [wid] : [wid, actor.userId]));
    return response(page(items));
  });
  app.post(
    '/api/v1/credits/redeem',
    { schema: { body: z.object({ code: z.string().trim().min(8).max(200) }).strict() } },
    async (req) => {
      const { actor, wid } = await access(req, 'write');
      if (actor.authType !== 'session')
        throw new AppError(403, 'SESSION_REQUIRED', '兑换需要账号登录');
      const code = (req.body as { code: string }).code;
      return response(
        s.transaction(() => {
          const row = sql
            .prepare('SELECT * FROM redemption_codes WHERE code_hash=?')
            .get(createHash('sha256').update(code).digest('hex')) as
            | { id: string; credits: number; redeemed_at: string | null; expires_at: string | null }
            | undefined;
          if (!row || row.redeemed_at || (row.expires_at && row.expires_at < now()))
            throw new AppError(409, 'INVALID_REDEMPTION', '兑换码无效、已使用或已过期');
          sql
            .prepare(
              'UPDATE redemption_codes SET redeemed_by=?,workspace_id=?,redeemed_at=? WHERE id=?',
            )
            .run(actor.userId, wid, now(), row.id);
          s.credits.grant({
            workspaceId: wid,
            userId: actor.userId,
            eventKey: `redeem:${row.id}`,
            amount: row.credits,
            source: 'redemption',
            sourceId: row.id,
            description: '兑换码入账',
          });
          return s.balance(actor, wid);
        }),
      );
    },
  );
  app.get(
    '/api/v1/usage',
    {
      schema: {
        querystring: z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }),
      },
    },
    async (req) => {
      const { actor, wid } = await access(req, 'read', 'credits:read');
      const { from, to } = req.query as { from?: string; to?: string };
      const role = core.requireAccess(actor, wid, 'read').role;
      const clauses = ['l.workspace_id=?', 'l.billing_channel=?', "l.kind='settle'"];
      const args: string[] = [wid, channelForActor(actor)];
      if (!['owner', 'admin'].includes(role)) {
        clauses.push('l.user_id=?');
        args.push(actor.userId);
      }
      if (from) {
        clauses.push('l.created_at>=?');
        args.push(from);
      }
      if (to) {
        clauses.push('l.created_at<?');
        args.push(new Date(Date.parse(to) + 86400000).toISOString());
      }
      return response(
        page(
          sql
            .prepare(
              `SELECT l.user_id AS userId,u.display_name AS displayName,SUM(l.amount) AS spent,COUNT(DISTINCT l.job_id) AS jobs FROM credit_ledger l JOIN users u ON u.id=l.user_id WHERE ${clauses.join(' AND ')} GROUP BY l.user_id ORDER BY spent DESC`,
            )
            .all(...args),
        ),
      );
    },
  );
  app.get(
    '/api/v1/projects/:id/messages',
    { schema: { params: idParams, querystring: pageQuery } },
    async (req) => {
      const { actor, wid } = await access(req, 'read', 'projects:read');
      const id = idParams.parse(req.params).id;
      core.projects.get(actor, wid, id);
      const q = req.query as z.infer<typeof pageQuery>;
      const total = (
        sql
          .prepare('SELECT COUNT(*) AS n FROM messages WHERE workspace_id=? AND project_id=?')
          .get(wid, id) as { n: number }
      ).n;
      const rows = sql
        .prepare(
          'SELECT id,role,content,job_id AS jobId,metadata_json,created_at AS createdAt FROM messages WHERE workspace_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',
        )
        .all(wid, id, q.pageSize, (q.page - 1) * q.pageSize) as { metadata_json: string }[];
      return response({
        ...q,
        total,
        items: rows
          .reverse()
          .map(({ metadata_json, ...r }) => ({ ...r, metadata: JSON.parse(metadata_json) })),
      });
    },
  );
  app.post(
    '/api/v1/projects/:id/messages',
    {
      schema: {
        params: idParams,
        body: z
          .object({
            role: z.literal('user').default('user'),
            content: z.string().max(12000),
            metadata: z
              .object({
                draft: jobInputSchema.optional(),
                inspirationId: z.string().max(100).optional(),
                creationWarnings: z.array(z.string().max(1000)).max(30).optional(),
              })
              .strict()
              .default({}),
          })
          .strict(),
      },
    },
    async (req) => {
      const { actor, wid } = await access(req, 'write', 'projects:write');
      const id = idParams.parse(req.params).id;
      core.projects.get(actor, wid, id);
      const b = req.body as { role: string; content: string; metadata: unknown };
      const result = { id: randomUUID(), ...b, jobId: null, createdAt: now() };
      sql
        .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)')
        .run(
          result.id,
          wid,
          id,
          actor.userId,
          b.role,
          b.content,
          null,
          JSON.stringify(b.metadata),
          result.createdAt,
        );
      return response(result);
    },
  );
  await registerInspirationRoutes(app, s);
  app.get(
    '/api/v1/pending-applies',
    { schema: { querystring: z.object({ documentId: z.string().uuid().optional() }) } },
    async (req) => {
      const { actor, wid } = await access(req, 'read', 'projects:read');
      return response(
        page(s.pending(actor, wid, (req.query as { documentId?: string }).documentId)),
      );
    },
  );
  app.post(
    '/api/v1/pending-applies/:id/apply',
    {
      schema: {
        params: idParams,
        body: z.object({
          expectedRevision: z.number().int().positive(),
          mode: z.enum(['new-layer', 'replace']),
          layerId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { actor, wid } = await access(req, 'write', 'projects:write');
      const b = req.body as {
        expectedRevision: number;
        mode: 'new-layer' | 'replace';
        layerId?: string;
      };
      return response(
        s.apply(actor, wid, idParams.parse(req.params).id, b.expectedRevision, b.mode, b.layerId),
      );
    },
  );
  app.post('/api/v1/pending-applies/:id/dismiss', { schema: { params: idParams } }, async (req) => {
    const { wid } = await access(req, 'write', 'projects:write');
    const id = idParams.parse(req.params).id;
    const r = sql
      .prepare(
        "UPDATE pending_applies SET status='dismissed',updated_at=? WHERE id=? AND workspace_id=? AND status='pending'",
      )
      .run(now(), id, wid);
    if (!r.changes) throw new AppError(404, 'RESULT_NOT_FOUND', '待应用结果不存在');
    return response({ id, status: 'dismissed' });
  });
  app.get('/api/v1/provider-media/:id', async (req, reply) => {
    const id = idParams.parse(req.params).id;
    const q = z
      .object({
        workspace: z.string().uuid(),
        owner: z.string().uuid(),
        job: z.string().uuid(),
        expires: z.string(),
        signature: z.string(),
        variant: z.enum(['original', 'mask-white']).default('original'),
      })
      .parse(req.query);
    if (!s.verifyMedia(q.workspace, q.owner, q.job, id, q.expires, q.signature, q.variant))
      throw new AppError(403, 'MEDIA_SIGNATURE', '素材链接无效或过期');
    const data = await s.readProviderMedia(q.workspace, q.owner, q.job, id, q.variant);
    return reply.header('Cache-Control', 'private, no-store').type(data.mimeType).send(data.buffer);
  });
}

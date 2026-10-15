import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  inspirationInputSchema,
  originalInspirations,
  type InspirationDto,
  type InspirationInput,
} from '../../contracts/inspirations';
import type { Actor, Permission } from '../../contracts/core';
import type { TaskServices } from './service';
import { AppError } from '../errors';
interface CatalogRow {
  id: string;
  workspace_id: string | null;
  asset_id: string | null;
  data_json: string;
  created_at: string;
  archived_at: string | null;
}
export async function registerInspirationRoutes(app: FastifyInstance, s: TaskServices) {
  const sql = s.db.sqlite,
    core = s.core;
  s.transaction(() => {
    for (const item of originalInspirations)
      sql
        .prepare(
          'INSERT OR IGNORE INTO inspirations(id,data_json,created_at,updated_at) VALUES(?,?,?,?)',
        )
        .run(item.id, JSON.stringify(item), '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z');
  });
  async function access(req: FastifyRequest, permission: Permission = 'read') {
    const actor = await core.authenticate(req);
    if (!actor) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
    const wid = z
      .string()
      .uuid()
      .parse(req.headers['x-workspace-id'] ?? actor.workspaceId);
    core.requireAccess(actor, wid, permission);
    core.requireScope(actor, 'projects:read');
    return { actor, wid };
  }
  function get(wid: string, id: string) {
    const row = sql
      .prepare('SELECT * FROM inspirations WHERE id=? AND (workspace_id IS NULL OR workspace_id=?)')
      .get(id, wid) as CatalogRow | undefined;
    if (!row) throw new AppError(404, 'NOT_FOUND', '灵感不存在或无权查看');
    return row;
  }
  function dto(actor: Actor, wid: string, row: CatalogRow): InspirationDto {
    const data = JSON.parse(row.data_json) as InspirationInput;
    let mediaUrl: string | null = row.workspace_id ? null : `/gallery/${row.id}.webp`,
      thumbnailUrl = mediaUrl;
    if (row.asset_id) {
      try {
        const a = core.assets.get(actor, wid, row.asset_id);
        mediaUrl = a.originalUrl;
        thumbnailUrl =
          a.thumbnailUrl ?? a.previewUrl ?? (a.kind === 'image' ? a.originalUrl : null);
      } catch (error) {
        if (!(error instanceof AppError && error.statusCode === 404)) throw error;
      }
    }
    return {
      ...data,
      id: row.id,
      workspaceId: row.workspace_id,
      assetId: row.asset_id,
      mediaUrl,
      thumbnailUrl,
      isFavorite: !!sql
        .prepare('SELECT 1 FROM inspiration_favorites WHERE user_id=? AND inspiration_id=?')
        .get(actor.userId, row.id),
      archived: !!row.archived_at,
      mediaUnavailable: !mediaUrl,
      createdAt: row.created_at,
    };
  }
  app.get(
    '/api/v1/inspirations',
    {
      schema: {
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(24),
          q: z.string().max(120).optional(),
          category: z.string().max(60).optional(),
          kind: z.enum(['image', 'video']).optional(),
          platform: z.string().max(80).optional(),
          favorite: z.enum(['true', 'false']).optional(),
          archived: z.enum(['true', 'false']).optional(),
        }),
      },
    },
    async (req) => {
      const { actor, wid } = await access(req),
        q = req.query as {
          page: number;
          pageSize: number;
          q?: string;
          category?: string;
          kind?: string;
          platform?: string;
          favorite?: string;
          archived?: string;
        };
      const conditions = ['(i.workspace_id IS NULL OR i.workspace_id=?)'],
        params: unknown[] = [wid];
      if (q.archived === 'true') {
        core.requireAccess(actor, wid, 'manage');
      } else if (q.favorite !== 'true') conditions.push('i.archived_at IS NULL');
      for (const key of ['category', 'kind', 'platform'] as const)
        if (q[key]) {
          conditions.push(`json_extract(i.data_json,'$.${key}')=?`);
          params.push(q[key]);
        }
      if (q.q) {
        conditions.push(
          "(json_extract(i.data_json,'$.title') LIKE ? OR json_extract(i.data_json,'$.tag') LIKE ? OR json_extract(i.data_json,'$.prompt') LIKE ?)",
        );
        params.push(...Array(3).fill(`%${q.q}%`));
      }
      if (q.favorite === 'true') {
        conditions.push(
          'EXISTS(SELECT 1 FROM inspiration_favorites f WHERE f.inspiration_id=i.id AND f.user_id=?)',
        );
        params.push(actor.userId);
      }
      const where = conditions.join(' AND '),
        total = (
          sql.prepare(`SELECT COUNT(*) n FROM inspirations i WHERE ${where}`).get(...params) as {
            n: number;
          }
        ).n;
      const items = (
        sql
          .prepare(
            `SELECT i.* FROM inspirations i WHERE ${where} ORDER BY i.created_at DESC,i.id LIMIT ? OFFSET ?`,
          )
          .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as CatalogRow[]
      ).map((r) => dto(actor, wid, r));
      return { data: { items, total, page: q.page, pageSize: q.pageSize } };
    },
  );
  app.get('/api/v1/inspirations/facets', async (req) => {
    const { wid } = await access(req);
    const rows = sql
      .prepare(
        'SELECT data_json FROM inspirations WHERE (workspace_id IS NULL OR workspace_id=?) AND archived_at IS NULL',
      )
      .all(wid) as { data_json: string }[];
    const data = rows.map((r) => JSON.parse(r.data_json) as InspirationInput);
    return {
      data: {
        categories: [...new Set(data.map((i) => i.category))].sort(),
        platforms: [...new Set(data.map((i) => i.platform))].sort(),
      },
    };
  });
  app.post(
    '/api/v1/inspirations',
    { schema: { body: inspirationInputSchema } },
    async (req, reply) => {
      const { actor, wid } = await access(req, 'manage'),
        input = inspirationInputSchema.parse(req.body);
      const a = core.assets.get(actor, wid, input.assetId);
      if (a.kind !== input.kind)
        throw new AppError(400, 'MEDIA_KIND', '示例素材类型与灵感类型不一致');
      const id = randomUUID(),
        date = new Date().toISOString();
      s.transaction(() => {
        sql
          .prepare(
            'INSERT INTO inspirations(id,workspace_id,asset_id,data_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(id, wid, input.assetId, JSON.stringify(input), actor.userId, date, date);
        core.context.audit(actor, wid, 'inspiration.create', 'inspiration', id, {
          assetId: input.assetId,
        });
      });
      return reply.code(201).send({ data: dto(actor, wid, get(wid, id)) });
    },
  );
  const idParams = z.object({ id: z.string().min(1).max(80) });
  app.patch(
    '/api/v1/inspirations/:id',
    { schema: { params: idParams, body: z.object({ archived: z.boolean() }).strict() } },
    async (req) => {
      const { actor, wid } = await access(req, 'manage'),
        { id } = idParams.parse(req.params),
        row = get(wid, id);
      if (row.workspace_id !== wid)
        throw new AppError(403, 'SHARED_CATALOG', '内置原创灵感不可在空间中下架');
      const { archived } = req.body as { archived: boolean },
        date = new Date().toISOString();
      s.transaction(() => {
        sql
          .prepare('UPDATE inspirations SET archived_at=?,updated_at=? WHERE id=?')
          .run(archived ? date : null, date, id);
        core.context.audit(actor, wid, 'inspiration.archive', 'inspiration', id, { archived });
      });
      return { data: dto(actor, wid, get(wid, id)) };
    },
  );
  app.put(
    '/api/v1/inspirations/:id/favorite',
    { schema: { params: idParams, body: z.object({ favorite: z.boolean() }).strict() } },
    async (req) => {
      const { actor, wid } = await access(req),
        { id } = idParams.parse(req.params),
        { favorite } = req.body as { favorite: boolean };
      const row = get(wid, id);
      if (favorite && row.archived_at)
        throw new AppError(409, 'INSPIRATION_ARCHIVED', '这份灵感已下架');
      if (favorite)
        sql
          .prepare('INSERT OR IGNORE INTO inspiration_favorites VALUES(?,?,?)')
          .run(actor.userId, id, new Date().toISOString());
      else
        sql
          .prepare('DELETE FROM inspiration_favorites WHERE user_id=? AND inspiration_id=?')
          .run(actor.userId, id);
      return { data: { id, isFavorite: favorite } };
    },
  );
}

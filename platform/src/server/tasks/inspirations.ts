import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  inspirationInputSchema,
  originalInspirations,
  type InspirationDto,
  type InspirationInput,
  reuseInspirationSchema,
  type InspirationReuseDto,
  videoInspirationCategorySchema,
} from '../../contracts/inspirations';
import type { Actor, Permission } from '../../contracts/core';
import type { TaskServices } from './service';
import { AppError } from '../errors';
import { jobInputSchema } from '../../contracts/jobs';
import type { PreparedAsset } from '../core/storage';
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
      videoCategory: data.kind === 'video' ? (data.videoCategory ?? null) : null,
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
          videoCategory: videoInspirationCategorySchema.optional(),
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
          videoCategory?: string;
          platform?: string;
          favorite?: string;
          archived?: string;
        };
      const conditions = ['(i.workspace_id IS NULL OR i.workspace_id=?)'],
        params: unknown[] = [wid];
      if (q.archived === 'true') {
        core.requireAccess(actor, wid, 'manage');
      } else if (q.favorite !== 'true') conditions.push('i.archived_at IS NULL');
      for (const key of ['category', 'kind', 'platform', 'videoCategory'] as const)
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
  app.post(
    '/api/v1/inspirations/:id/reuse',
    { schema: { params: idParams, body: reuseInspirationSchema } },
    async (req, reply) => {
      const { actor, wid } = await access(req, 'write');
      core.requireScope(actor, 'projects:write');
      core.requireScope(actor, 'assets:write');
      const { id } = idParams.parse(req.params),
        input = reuseInspirationSchema.parse(req.body);
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            id,
            prompt: input.prompt,
            language: input.language,
            ...(input.intent === 'replicate' ? { intent: input.intent } : {}),
          }),
        )
        .digest('hex');
      const previous = (): InspirationReuseDto | undefined => {
        const existing = sql
          .prepare(
            'SELECT input_hash,project_id,draft_json FROM inspiration_reuses WHERE workspace_id=? AND user_id=? AND request_id=?',
          )
          .get(wid, actor.userId, input.requestId) as
          { input_hash: string; project_id: string; draft_json: string } | undefined;
        if (!existing) return;
        if (existing.input_hash !== fingerprint)
          throw new AppError(409, 'REUSE_ID_CONFLICT', '同一复用编号不能对应不同需求。');
        return {
          project: core.projects.get(actor, wid, existing.project_id),
          draft: jobInputSchema.parse(JSON.parse(existing.draft_json)),
        };
      };
      const replay = previous();
      if (replay) return reply.code(201).send({ data: replay });
      const row = get(wid, id);
      if (row.archived_at)
        throw new AppError(409, 'INSPIRATION_ARCHIVED', '这份灵感已下架，不能继续复用。');
      const data = JSON.parse(row.data_json) as InspirationInput;
      if (input.intent === 'replicate' && data.kind !== 'video')
        throw new AppError(400, 'VIDEO_REQUIRED', '进入人物动作复刻需要视频灵感。');
      const motionVideo =
        input.intent === 'replicate' && row.asset_id
          ? core.assets.get(actor, wid, row.asset_id)
          : undefined;
      if (
        input.intent === 'replicate' &&
        (!motionVideo ||
          motionVideo.kind !== 'video' ||
          !motionVideo.durationMs ||
          motionVideo.durationMs < 3000)
      )
        throw new AppError(
          400,
          'VIDEO_DURATION_REQUIRED',
          '人物动作参考需要可读取时长且至少3秒的视频，请先检查或重新上传原素材。',
        );
      let prepared: PreparedAsset | undefined,
        committed = false;
      try {
        if (row.asset_id) core.assets.get(actor, wid, row.asset_id);
        else {
          if (row.workspace_id || !originalInspirations.some((entry) => entry.id === id))
            throw new AppError(404, 'INSPIRATION_MEDIA_MISSING', '原素材不可用，无法完整复用。');
          let buffer: Buffer;
          try {
            buffer = await readFile(resolve('dist/web/gallery', `${id}.webp`));
          } catch {
            try {
              buffer = await readFile(resolve('public/gallery', `${id}.webp`));
            } catch {
              throw new AppError(
                404,
                'INSPIRATION_MEDIA_MISSING',
                '原创示例文件缺失，请检查部署资源。',
              );
            }
          }
          prepared = await core.assets.prepare({
            buffer,
            name: `灵感参考 · ${data.title}.webp`,
            mimeType: 'image/webp',
            source: 'import',
            tags: ['原创灵感示例'],
          });
        }
        const result = s.transaction(() => {
          const replay = previous();
          if (replay) return replay;
          const current = get(wid, id);
          if (
            current.archived_at ||
            current.asset_id !== row.asset_id ||
            current.data_json !== row.data_json
          )
            throw new AppError(409, 'INSPIRATION_CHANGED', '灵感内容已更新，请重新打开后复用。');
          if (current.asset_id) core.assets.get(actor, wid, current.asset_id);
          const project = core.projects.create(actor, wid, {
            name: data.title,
            kind: data.kind,
            description: input.prompt,
          });
          const assetId =
            current.asset_id ??
            core.assets.commitPrepared(actor, wid, { ...prepared!, projectId: project.id }).id;
          const replicate = input.intent === 'replicate';
          const trimEnd = replicate ? Math.min(motionVideo!.durationMs! / 1000, 30) : undefined;
          const creationWarnings = replicate
            ? [
                '已继承参考视频；请补充主体图片、检查动作片段，再确认人物与视频使用授权及外部费用。当前仅支持人物动作参考，不支持服装、人脸或商品精准替换。',
                ...(motionVideo!.durationMs! > 30000
                  ? ['参考视频超过30秒，当前预选前30秒；请在提交前检查并调整动作片段。']
                  : []),
              ]
            : undefined;
          const draft = jobInputSchema.parse({
            operation: replicate
              ? 'video.motion-replica'
              : data.kind === 'video'
                ? 'video.generate'
                : 'image.generate',
            providerId: data.kind === 'video' ? 'fal' : 'openai',
            projectId: project.id,
            prompt: input.prompt,
            assetIds: replicate ? [] : [assetId],
            ...(replicate ? { referenceAssetIds: [assetId], creationWarnings } : {}),
            options: replicate
              ? {
                  model: 'kling-2.6-motion-standard',
                  mode: 'exact',
                  replacementType: 'model',
                  ratio: 'auto',
                  resolution: 'auto',
                  duration: Math.ceil(trimEnd!),
                  trimStart: 0,
                  trimEnd,
                  keepMusicRhythm: true,
                  needText: false,
                  motionOrientation: 'video',
                  referenceAuthorized: false,
                  externalCostAccepted: false,
                  platform: data.platform,
                  language: input.language,
                }
              : {
                  ...(data.kind === 'video'
                    ? {
                        model: 'kling-o3-4k-reference',
                        resolution: '4K',
                        referenceMode: 'all',
                        duration: 5,
                      }
                    : {}),
                  ...data.options,
                  ratio: data.ratio,
                  platform: data.platform,
                  language: data.options?.language ?? input.language,
                  kind: data.options?.kind ?? (data.kind === 'video' ? 'product' : 'single'),
                },
          });
          const date = new Date().toISOString();
          sql.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run(
            randomUUID(),
            wid,
            project.id,
            actor.userId,
            'user',
            input.prompt,
            null,
            JSON.stringify({
              inspirationId: id,
              inspirationIntent: input.intent,
              inspirationVideoCategory: data.videoCategory ?? null,
              draft,
              ...(creationWarnings ? { creationWarnings } : {}),
            }),
            date,
          );
          sql
            .prepare('INSERT INTO inspiration_reuses VALUES(?,?,?,?,?,?,?,?)')
            .run(
              wid,
              actor.userId,
              input.requestId,
              fingerprint,
              id,
              project.id,
              JSON.stringify(draft),
              date,
            );
          return { project, draft };
        });
        committed = !!prepared && result.draft.assetIds.includes(prepared.id);
        return reply.code(201).send({ data: result });
      } finally {
        if (prepared && !committed)
          await Promise.all(
            prepared.variants.map((variant) =>
              rm(core.assets.storage.path(variant.storageKey), { force: true }),
            ),
          );
      }
    },
  );
  app.patch(
    '/api/v1/inspirations/:id',
    {
      schema: {
        params: idParams,
        body: z
          .object({
            archived: z.boolean().optional(),
            videoCategory: videoInspirationCategorySchema.nullable().optional(),
          })
          .strict()
          .refine(
            (value) => value.archived !== undefined || value.videoCategory !== undefined,
            '请选择需要更新的字段',
          ),
      },
    },
    async (req) => {
      const { actor, wid } = await access(req, 'manage'),
        { id } = idParams.parse(req.params),
        row = get(wid, id);
      if (row.workspace_id !== wid)
        throw new AppError(403, 'SHARED_CATALOG', '内置原创灵感不可在空间中下架');
      const { archived, videoCategory } = req.body as {
          archived?: boolean;
          videoCategory?: z.infer<typeof videoInspirationCategorySchema> | null;
        },
        date = new Date().toISOString();
      const data = JSON.parse(row.data_json) as InspirationInput;
      if (videoCategory !== undefined && data.kind !== 'video')
        throw new AppError(400, 'VIDEO_REQUIRED', '只有视频灵感可以设置视频内容分类');
      s.transaction(() => {
        const current = get(wid, id);
        if (current.data_json !== row.data_json || current.archived_at !== row.archived_at)
          throw new AppError(409, 'INSPIRATION_CHANGED', '灵感内容已更新，请重新打开后修改。');
        sql
          .prepare('UPDATE inspirations SET archived_at=?,data_json=?,updated_at=? WHERE id=?')
          .run(
            archived === undefined ? row.archived_at : archived ? date : null,
            videoCategory === undefined
              ? row.data_json
              : JSON.stringify({ ...data, videoCategory }),
            date,
            id,
          );
        core.context.audit(
          actor,
          wid,
          videoCategory === undefined ? 'inspiration.archive' : 'inspiration.category',
          'inspiration',
          id,
          { archived, videoCategory },
        );
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

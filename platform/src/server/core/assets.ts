import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import {
  AssetPatchSchema,
  TagsSchema,
  type Actor,
  type AssetDto,
  type AssetTextDto,
} from '../../contracts/core';
import { AppError } from '../errors';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { CoreContext, type Row, type ListQuery, str, nullable, json, num, id, now } from './shared';
import { PrivateStorage, type IngestAssetInput, type PreparedAsset } from './storage';
export interface JobAssetContext {
  workspaceId: string;
  createdBy: string;
  projectId: string | null;
  jobId: string;
}
export class AssetService {
  readonly storage: PrivateStorage;
  constructor(private c: CoreContext) {
    this.storage = new PrivateStorage(c.config.storageDir);
  }
  dto(actor: Actor, r: Row): AssetDto {
    const aid = str(r, 'id'),
      variants = this.c.all('SELECT variant FROM asset_variants WHERE asset_id=?', aid);
    const url = (v: string) => `/api/v1/assets/${aid}/content?variant=${v}`;
    return {
      id: aid,
      workspaceId: str(r, 'workspace_id'),
      projectId: nullable(r, 'project_id'),
      name: str(r, 'name'),
      kind: str(r, 'kind') as AssetDto['kind'],
      extractionStatus: str(r, 'extraction_status') as AssetDto['extractionStatus'],
      mimeType: str(r, 'mime_type'),
      byteSize: num(r, 'byte_size'),
      width: r.width === null ? null : num(r, 'width'),
      height: r.height === null ? null : num(r, 'height'),
      durationMs: r.duration_ms === null ? null : num(r, 'duration_ms'),
      source: str(r, 'source') as AssetDto['source'],
      sourceJobId: nullable(r, 'source_job_id'),
      tags: json<string[]>(r.tags_json, []),
      isFavorite: this.c.isFavorite(actor, 'asset', aid),
      originalUrl: url('original'),
      previewUrl: variants.some((v) => v.variant === 'preview') ? url('preview') : null,
      thumbnailUrl: variants.some((v) => v.variant === 'thumbnail') ? url('thumbnail') : null,
      createdBy: str(r, 'created_by'),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
      deletedAt: nullable(r, 'deleted_at'),
    };
  }
  get(actor: Actor, wid: string, aid: string): AssetDto {
    this.c.requireAccess(actor, wid, 'read');
    return this.dto(actor, this.c.resource('assets', wid, aid));
  }
  list(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'read');
    const conditions = [
        'a.workspace_id=?',
        q.deleted ? 'a.deleted_at IS NOT NULL' : 'a.deleted_at IS NULL',
      ],
      params: unknown[] = [wid];
    for (const [key, column] of [
      ['kind', 'kind'],
      ['projectId', 'project_id'],
    ] as const)
      if (q[key]) {
        conditions.push(`a.${column}=?`);
        params.push(q[key]);
      }
    if (q.q) {
      conditions.push('a.name LIKE ?');
      params.push(`%${q.q}%`);
    }
    if (q.tag) {
      conditions.push('EXISTS(SELECT 1 FROM json_each(a.tags_json) WHERE value=?)');
      params.push(q.tag);
    }
    if (q.favorite) {
      conditions.push(
        "EXISTS(SELECT 1 FROM favorites f WHERE f.resource_id=a.id AND f.resource_type='asset' AND f.user_id=?)",
      );
      params.push(actor.userId);
    }
    if (q.collectionId) {
      this.c.resource('collections', wid, q.collectionId);
      conditions.push(
        'EXISTS(SELECT 1 FROM asset_collections ac WHERE ac.asset_id=a.id AND ac.collection_id=?)',
      );
      params.push(q.collectionId);
    }
    if (q.from) {
      conditions.push('a.created_at>=?');
      params.push(q.from);
    }
    if (q.to) {
      conditions.push('a.created_at<=?');
      params.push(q.to);
    }
    return this.c.page(
      `SELECT a.* FROM assets a WHERE ${conditions.join(' AND ')} ORDER BY a.created_at DESC,a.id`,
      params,
      q,
      (r) => this.dto(actor, r),
    );
  }
  prepare(input: IngestAssetInput): Promise<PreparedAsset> {
    return this.storage.prepare({ ...input, tags: TagsSchema.parse(input.tags ?? []) });
  }
  async discardPrepared(prepared: PreparedAsset): Promise<void> {
    await Promise.all(
      prepared.variants.map((v) => rm(this.storage.path(v.storageKey), { force: true })),
    );
  }
  private insertPrepared(actor: Actor, wid: string, prepared: PreparedAsset): AssetDto {
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('commitPrepared requires an existing transaction');
    const date = now();
    this.c.run(
      'INSERT INTO assets(id,workspace_id,project_id,name,kind,mime_type,byte_size,width,height,duration_ms,source,source_job_id,tags_json,sha256,extraction_status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      prepared.id,
      wid,
      prepared.projectId,
      prepared.name,
      prepared.kind,
      prepared.mimeType,
      prepared.byteSize,
      prepared.width,
      prepared.height,
      prepared.durationMs,
      prepared.source,
      prepared.sourceJobId,
      JSON.stringify(prepared.tags),
      prepared.sha256,
      prepared.kind === 'document' ? 'pending' : 'not-applicable',
      actor.userId,
      date,
      date,
    );
    for (const v of prepared.variants)
      this.c.run(
        'INSERT INTO asset_variants VALUES (?,?,?,?,?,?,?,?)',
        id(),
        prepared.id,
        v.variant,
        v.storageKey,
        v.mimeType,
        v.byteSize,
        v.width,
        v.height,
      );
    this.c.audit(actor, wid, 'asset.create', 'asset', prepared.id, {
      kind: prepared.kind,
      source: prepared.source,
    });
    return this.dto(actor, this.c.resource('assets', wid, prepared.id));
  }
  commitPrepared(actor: Actor, wid: string, prepared: PreparedAsset): AssetDto {
    this.c.requireAccess(actor, wid, 'write');
    if (prepared.projectId) this.c.resource('projects', wid, prepared.projectId);
    return this.insertPrepared(actor, wid, prepared);
  }
  private validateJob(context: JobAssetContext): Actor {
    const job = this.c.get(
      'SELECT * FROM jobs WHERE id=? AND workspace_id=? AND user_id=?',
      context.jobId,
      context.workspaceId,
      context.createdBy,
    );
    if (
      !job ||
      nullable(job, 'project_id') !== context.projectId ||
      job.status === 'queued' ||
      job.status === 'cancelled'
    )
      throw new AppError(409, 'INVALID_JOB_CONTEXT', '任务上下文无效');
    if (context.projectId)
      this.c.resource('projects', context.workspaceId, context.projectId, true);
    return {
      userId: context.createdBy,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
  }
  commitPreparedForJob(context: JobAssetContext, prepared: PreparedAsset): AssetDto {
    const actor = this.validateJob(context);
    if (prepared.sourceJobId !== context.jobId)
      throw new AppError(409, 'INVALID_JOB_CONTEXT', '素材与任务不匹配');
    return this.insertPrepared(actor, context.workspaceId, {
      ...prepared,
      projectId: context.projectId,
    });
  }
  async readOriginalForJob(
    context: JobAssetContext,
    assetId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    this.validateJob(context);
    const asset = this.c.resource('assets', context.workspaceId, assetId, true);
    const variant = this.c.get(
      "SELECT * FROM asset_variants WHERE asset_id=? AND variant='original'",
      assetId,
    );
    if (!variant) throw new AppError(404, 'NOT_FOUND', '原件不存在');
    return {
      buffer: await this.storage.read(str(variant, 'storage_key')),
      mimeType: str(variant, 'mime_type'),
      name: str(asset, 'name'),
    };
  }
  async ingest(
    actor: Actor,
    wid: string,
    input: IngestAssetInput,
    requestId?: string,
  ): Promise<AssetDto> {
    this.c.requireAccess(actor, wid, 'write');
    if (input.projectId) this.c.resource('projects', wid, input.projectId);
    const fingerprint = createHash('sha256')
      .update(input.buffer)
      .update(
        JSON.stringify({
          name: input.name,
          mimeType: input.mimeType,
          projectId: input.projectId ?? null,
          tags: input.tags ?? [],
        }),
      )
      .digest('hex');
    const previous = () => {
      if (!requestId) return undefined;
      const row = this.c.get(
        'SELECT content_hash,asset_id FROM upload_requests WHERE workspace_id=? AND user_id=? AND request_id=?',
        wid,
        actor.userId,
        requestId,
      );
      if (!row) return undefined;
      if (row.content_hash !== fingerprint)
        throw new AppError(409, 'UPLOAD_ID_CONFLICT', '同一上传标识不能用于不同文件或元信息');
      return this.get(actor, wid, str(row, 'asset_id'));
    };
    const existing = previous();
    if (existing) return existing;
    const prepared = await this.prepare(input);
    let inserted = false;
    try {
      const result = this.c.transaction(() => {
        this.c.requireAccess(actor, wid, 'write');
        const existing = previous();
        if (existing) return existing;
        const result = this.commitPrepared(actor, wid, prepared);
        if (requestId)
          this.c.run(
            'INSERT INTO upload_requests VALUES(?,?,?,?,?,?)',
            wid,
            actor.userId,
            requestId,
            fingerprint,
            result.id,
            now(),
          );
        return result;
      });
      inserted = result.id === prepared.id;
      return result;
    } finally {
      if (!inserted)
        await Promise.all(
          prepared.variants.map((v) => rm(this.storage.path(v.storageKey), { force: true })),
        );
    }
  }
  async readOriginal(
    actor: Actor,
    wid: string,
    aid: string,
  ): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    const asset = this.get(actor, wid, aid);
    const variant = this.variant(actor, wid, aid, 'original');
    return {
      buffer: await this.storage.read(variant.storageKey),
      mimeType: variant.mimeType,
      name: asset.name,
    };
  }
  variant(
    actor: Actor,
    wid: string,
    aid: string,
    variant: 'original' | 'preview' | 'thumbnail',
  ): { storageKey: string; mimeType: string; byteSize: number; name: string } {
    const asset = this.get(actor, wid, aid);
    const row = this.c.get(
      'SELECT * FROM asset_variants WHERE asset_id=? AND variant=?',
      aid,
      variant,
    );
    if (!row) throw new AppError(404, 'VARIANT_NOT_FOUND', '此素材没有所选预览');
    return {
      storageKey: str(row, 'storage_key'),
      mimeType: str(row, 'mime_type'),
      byteSize: num(row, 'byte_size'),
      name: asset.name,
    };
  }
  resolveWorkspace(aid: string): string {
    const row = this.c.get(
      'SELECT workspace_id FROM assets WHERE id=? AND deleted_at IS NULL',
      aid,
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', '素材不存在');
    return str(row, 'workspace_id');
  }
  update(actor: Actor, wid: string, aid: string, raw: unknown): AssetDto {
    this.c.requireAccess(actor, wid, 'write');
    const input = AssetPatchSchema.parse(raw),
      current = this.get(actor, wid, aid);
    if (input.projectId) this.c.resource('projects', wid, input.projectId);
    this.c.run(
      'UPDATE assets SET name=?,tags_json=?,project_id=?,updated_at=? WHERE id=?',
      input.name ?? current.name,
      JSON.stringify(input.tags ?? current.tags),
      input.projectId === undefined ? current.projectId : input.projectId,
      now(),
      aid,
    );
    return this.get(actor, wid, aid);
  }
  remove(actor: Actor, wid: string, aid: string) {
    this.c.requireAccess(actor, wid, 'write');
    this.get(actor, wid, aid);
    const date = now();
    this.c.run('UPDATE assets SET deleted_at=?,updated_at=? WHERE id=?', date, date, aid);
    this.c.audit(actor, wid, 'asset.delete', 'asset', aid);
    return { id: aid, deletedAt: date };
  }
  restore(actor: Actor, wid: string, aid: string): AssetDto {
    this.c.requireAccess(actor, wid, 'write');
    this.c.resource('assets', wid, aid, true);
    this.c.run('UPDATE assets SET deleted_at=NULL,updated_at=? WHERE id=?', now(), aid);
    return this.get(actor, wid, aid);
  }
  text(actor: Actor, wid: string, aid: string): AssetTextDto {
    this.c.requireAccess(actor, wid, 'read');
    const row = this.c.resource('assets', wid, aid);
    if (row.kind !== 'document') throw new AppError(400, 'NOT_A_DOCUMENT', '此素材不是文档');
    return {
      assetId: aid,
      extractionStatus: str(row, 'extraction_status') as AssetTextDto['extractionStatus'],
      extractedText: nullable(row, 'extracted_text'),
      extractionError: json<AssetTextDto['extractionError']>(row.extraction_error_json, null),
      truncated: !!row.extraction_truncated,
    };
  }
  async processPendingExtractions(limit = 2): Promise<number> {
    const rows = this.c.all(
      "SELECT a.*,v.storage_key FROM assets a JOIN asset_variants v ON v.asset_id=a.id AND v.variant='original' WHERE a.extraction_status='pending' AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT ?",
      Math.max(1, Math.min(10, limit)),
    );
    for (const row of rows) {
      try {
        const buffer = await this.storage.read(str(row, 'storage_key'));
        let text: string;
        let pageTruncated = false;
        if (row.mime_type === 'application/pdf') {
          const parser = new PDFParse({ data: buffer });
          try {
            const info = await parser.getInfo();
            pageTruncated = info.total > 100;
            text = (await parser.getText({ first: 100, pageJoiner: '' })).text;
          } finally {
            await parser.destroy();
          }
        } else if (
          row.mime_type ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
          await this.storage.validateDocx(buffer);
          text = (await mammoth.extractRawText({ buffer })).value;
        } else {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        }
        if (!text.trim())
          throw new AppError(
            422,
            'NO_EXTRACTABLE_TEXT',
            '未发现可提取文字，扫描文档需要另接OCR服务',
          );
        this.c.run(
          "UPDATE assets SET extraction_status='ready',extracted_text=?,extraction_truncated=?,extraction_error_json=NULL,updated_at=? WHERE id=? AND extraction_status='pending'",
          text.slice(0, 100000),
          text.length > 100000 || pageTruncated ? 1 : 0,
          now(),
          str(row, 'id'),
        );
      } catch (error) {
        this.c.run(
          "UPDATE assets SET extraction_status='failed',extraction_error_json=?,updated_at=? WHERE id=? AND extraction_status='pending'",
          JSON.stringify({
            code: error instanceof AppError ? error.code : 'TEXT_EXTRACTION_FAILED',
            message:
              error instanceof AppError
                ? error.message
                : '文档无法解析，请检查文件是否损坏、加密或格式不受支持',
          }),
          now(),
          str(row, 'id'),
        );
      }
    }
    return rows.length;
  }
}

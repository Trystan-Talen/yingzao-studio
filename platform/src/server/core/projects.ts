import { EntitlementService } from './entitlements';
import * as inputs from '../../contracts/core';
import type { Actor, ProjectDto } from '../../contracts/core';
import { ProjectPatchSchema } from '../../contracts/core';
import {
  sceneDocumentSchema,
  blankScene,
  getSceneAssetIds,
  type SceneDocumentV1,
  type SceneLayer,
} from '../../contracts/scene';
import { AppError } from '../errors';
import { CoreContext, type Row, type ListQuery, str, nullable, json, num, id, now } from './shared';
export interface DocumentDto {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  revision: number;
  schemaVersion: 1;
  scene: SceneDocumentV1;
  createdAt: string;
  updatedAt: string;
}
export interface SaveDocumentInput {
  documentId: string;
  expectedRevision: number;
  scene: SceneDocumentV1;
  name?: string;
  reason: 'create' | 'save' | 'restore' | 'job-apply';
  sourceJobId?: string;
  restoredFromRevision?: number;
}
export class DocumentService {
  constructor(private c: CoreContext) {}
  dto(r: Row): DocumentDto {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      projectId: str(r, 'project_id'),
      name: str(r, 'name'),
      revision: num(r, 'revision'),
      schemaVersion: 1,
      scene: sceneDocumentSchema.parse(json(r.scene_json, {})),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
    };
  }
  get(actor: Actor, wid: string, documentId: string): DocumentDto {
    this.c.requireAccess(actor, wid, 'read');
    const row = this.c.resource('documents', wid, documentId);
    this.c.resource('projects', wid, str(row, 'project_id'));
    return this.dto(row);
  }
  forProject(actor: Actor, wid: string, projectId: string): DocumentDto {
    this.c.requireAccess(actor, wid, 'read');
    const project = this.c.resource('projects', wid, projectId);
    return this.get(actor, wid, str(project, 'document_id'));
  }
  validateScene(wid: string, input: unknown): SceneDocumentV1 {
    const scene = sceneDocumentSchema.parse(input);
    for (const assetId of getSceneAssetIds(scene)) this.c.resource('assets', wid, assetId);
    const validateLayers = (layers: SceneLayer[]): void => {
      for (const layer of layers) {
        if (layer.type === 'group') {
          validateLayers(layer.children);
          continue;
        }
        if (layer.type !== 'image' && layer.type !== 'video') continue;
        const asset = this.c.resource('assets', wid, layer.assetId);
        if (asset.kind !== layer.type)
          throw new AppError(400, 'ASSET_KIND_MISMATCH', '图层类型与引用素材不符');
        if (layer.type === 'video') {
          if (
            layer.posterAssetId &&
            this.c.resource('assets', wid, layer.posterAssetId).kind !== 'image'
          )
            throw new AppError(400, 'ASSET_KIND_MISMATCH', '视频封面必须是图片');
          if (layer.trimEndMs > num(asset, 'duration_ms') + 1)
            throw new AppError(400, 'INVALID_TRIM', '裁剪超出媒体时长');
        } else if (
          layer.crop &&
          (layer.crop.x + layer.crop.width > num(asset, 'width') ||
            layer.crop.y + layer.crop.height > num(asset, 'height'))
        )
          throw new AppError(400, 'INVALID_CROP', '裁切区域超出原图尺寸');
      }
    };
    validateLayers(scene.layers);
    return scene;
  }
  saveInTransaction(actor: Actor, wid: string, input: SaveDocumentInput): DocumentDto {
    this.c.requireAccess(actor, wid, 'write');
    if (!this.c.db.sqlite.inTransaction)
      throw new Error('saveInTransaction requires an existing transaction');
    const current = this.get(actor, wid, input.documentId);
    if (current.revision !== input.expectedRevision)
      throw new AppError(409, 'REVISION_CONFLICT', '文档已更新，请保留当前草稿并重新加载。', {
        documentId: current.id,
        currentRevision: current.revision,
      });
    const scene = this.validateScene(wid, input.scene),
      revision = current.revision + 1,
      date = now();
    this.c.run(
      'UPDATE documents SET revision=?,scene_json=?,name=?,updated_at=? WHERE id=?',
      revision,
      JSON.stringify(scene),
      input.name ?? current.name,
      date,
      current.id,
    );
    this.c.run(
      'INSERT INTO document_versions VALUES (?,?,?,?,?,?,?,?,?)',
      id(),
      current.id,
      revision,
      JSON.stringify(scene),
      input.reason,
      actor.userId,
      input.sourceJobId ?? null,
      input.restoredFromRevision ?? null,
      date,
    );
    this.c.run(
      'DELETE FROM document_versions WHERE document_id=? AND revision NOT IN (SELECT revision FROM document_versions WHERE document_id=? ORDER BY revision DESC LIMIT 30)',
      current.id,
      current.id,
    );
    this.c.run('UPDATE projects SET updated_at=? WHERE id=?', date, current.projectId);
    return this.get(actor, wid, current.id);
  }
  save(actor: Actor, wid: string, documentId: string, raw: unknown): DocumentDto {
    const input = inputs.UpdateDocumentInputSchema.parse(raw);
    return this.c.transaction(() =>
      this.saveInTransaction(actor, wid, { ...input, documentId, reason: 'save' }),
    );
  }
  versions(actor: Actor, wid: string, documentId: string, query: ListQuery) {
    this.get(actor, wid, documentId);
    return this.c.page(
      'SELECT * FROM document_versions WHERE document_id=? ORDER BY revision DESC',
      [documentId],
      query,
      (r) => ({
        id: str(r, 'id'),
        documentId,
        revision: num(r, 'revision'),
        reason: str(r, 'reason'),
        createdBy: str(r, 'created_by'),
        createdAt: str(r, 'created_at'),
        sourceJobId: nullable(r, 'source_job_id'),
        restoredFromRevision:
          r.restored_from_revision === null ? null : num(r, 'restored_from_revision'),
      }),
    );
  }
  version(actor: Actor, wid: string, documentId: string, revision: number) {
    this.get(actor, wid, documentId);
    const r = this.c.get(
      'SELECT * FROM document_versions WHERE document_id=? AND revision=?',
      documentId,
      revision,
    );
    if (!r) throw new AppError(404, 'NOT_FOUND', '历史版本不存在或已超出保留期');
    return {
      version: {
        id: str(r, 'id'),
        documentId,
        revision: num(r, 'revision'),
        reason: str(r, 'reason'),
        createdBy: str(r, 'created_by'),
        createdAt: str(r, 'created_at'),
        sourceJobId: nullable(r, 'source_job_id'),
        restoredFromRevision:
          r.restored_from_revision === null ? null : num(r, 'restored_from_revision'),
      },
      scene: sceneDocumentSchema.parse(json(r.scene_json, {})),
    };
  }
  restore(actor: Actor, wid: string, documentId: string, raw: unknown): DocumentDto {
    const input = inputs.RestoreDocumentInputSchema.parse(raw);
    return this.c.transaction(() => {
      const old = this.version(actor, wid, documentId, input.targetRevision);
      return this.saveInTransaction(actor, wid, {
        documentId,
        expectedRevision: input.expectedRevision,
        scene: old.scene,
        reason: 'restore',
        restoredFromRevision: input.targetRevision,
      });
    });
  }
}
export class ProjectService {
  constructor(
    private c: CoreContext,
    private documents: DocumentService,
  ) {}
  dto(actor: Actor, r: Row): ProjectDto {
    return {
      id: str(r, 'id'),
      workspaceId: str(r, 'workspace_id'),
      name: str(r, 'name'),
      description: str(r, 'description'),
      kind: str(r, 'kind') as ProjectDto['kind'],
      coverAssetId: nullable(r, 'cover_asset_id'),
      documentId: str(r, 'document_id'),
      tags: json<string[]>(r.tags_json, []),
      isFavorite: this.c.isFavorite(actor, 'project', str(r, 'id')),
      createdBy: str(r, 'created_by'),
      createdAt: str(r, 'created_at'),
      updatedAt: str(r, 'updated_at'),
      deletedAt: nullable(r, 'deleted_at'),
    };
  }
  get(actor: Actor, wid: string, pid: string): ProjectDto {
    this.c.requireAccess(actor, wid, 'read');
    return this.dto(actor, this.c.resource('projects', wid, pid));
  }
  list(actor: Actor, wid: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'read');
    const conditions = [
        'p.workspace_id=?',
        q.deleted ? 'p.deleted_at IS NOT NULL' : 'p.deleted_at IS NULL',
      ],
      params: unknown[] = [wid];
    if (q.q) {
      conditions.push("p.name LIKE ? ESCAPE '\\'");
      params.push(`%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
    }
    if (q.kind) {
      conditions.push('p.kind=?');
      params.push(q.kind);
    }
    if (q.favorite) {
      conditions.push(
        "EXISTS(SELECT 1 FROM favorites f WHERE f.resource_id=p.id AND f.resource_type='project' AND f.user_id=?)",
      );
      params.push(actor.userId);
    }
    if (q.from) {
      conditions.push('p.created_at>=?');
      params.push(q.from);
    }
    if (q.to) {
      conditions.push('p.created_at<=?');
      params.push(q.to);
    }
    return this.c.page(
      `SELECT p.* FROM projects p WHERE ${conditions.join(' AND ')} ORDER BY p.updated_at DESC,p.id`,
      params,
      q,
      (r) => this.dto(actor, r),
    );
  }
  create(actor: Actor, wid: string, raw: unknown): ProjectDto {
    const input = inputs.CreateProjectInputSchema.parse(raw);
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      new EntitlementService(this.c).assertCreate(wid, 'projects');
      const pid = id(),
        did = id(),
        date = now(),
        scene = this.documents.validateScene(wid, input.scene ?? blankScene());
      this.c.run(
        'INSERT INTO projects(id,workspace_id,name,description,kind,document_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        pid,
        wid,
        input.name,
        input.description,
        input.kind,
        did,
        actor.userId,
        date,
        date,
      );
      this.c.run(
        'INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)',
        did,
        wid,
        pid,
        input.name,
        1,
        1,
        JSON.stringify(scene),
        date,
        date,
      );
      this.c.run(
        'INSERT INTO document_versions VALUES (?,?,?,?,?,?,?,?,?)',
        id(),
        did,
        1,
        JSON.stringify(scene),
        'create',
        actor.userId,
        null,
        null,
        date,
      );
      this.c.audit(actor, wid, 'project.create', 'project', pid);
      return this.get(actor, wid, pid);
    });
  }
  update(actor: Actor, wid: string, pid: string, raw: unknown): ProjectDto {
    const input = ProjectPatchSchema.parse(raw);
    this.c.requireAccess(actor, wid, 'write');
    const current = this.get(actor, wid, pid);
    if (input.coverAssetId) this.c.resource('assets', wid, input.coverAssetId);
    this.c.run(
      'UPDATE projects SET name=?,description=?,tags_json=?,cover_asset_id=?,updated_at=? WHERE id=?',
      input.name ?? current.name,
      input.description ?? current.description,
      JSON.stringify(input.tags ?? current.tags),
      input.coverAssetId === undefined ? current.coverAssetId : input.coverAssetId,
      now(),
      pid,
    );
    return this.get(actor, wid, pid);
  }
  remove(actor: Actor, wid: string, pid: string) {
    this.c.requireAccess(actor, wid, 'write');
    this.c.resource('projects', wid, pid);
    const date = now();
    this.c.run('UPDATE projects SET deleted_at=?,updated_at=? WHERE id=?', date, date, pid);
    this.c.audit(actor, wid, 'project.delete', 'project', pid);
    return { id: pid, deletedAt: date };
  }
  restore(actor: Actor, wid: string, pid: string): ProjectDto {
    return this.c.transaction(() => {
      this.c.requireAccess(actor, wid, 'write');
      const project = this.c.resource('projects', wid, pid, true);
      if (project.deleted_at) new EntitlementService(this.c).assertCreate(wid, 'projects');
      this.c.run('UPDATE projects SET deleted_at=NULL,updated_at=? WHERE id=?', now(), pid);
      return this.get(actor, wid, pid);
    });
  }
}

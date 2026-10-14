import * as inputs from '../../contracts/core';
import { getSceneAssetIds } from '../../contracts/scene';
import { type Actor } from '../../contracts/core';
import { AppError } from '../errors';
import { CoreContext, type ListQuery, str, num, nullable, id, now, token, hash } from './shared';
import { DocumentService } from './projects';
import { AssetService } from './assets';
import { EntitlementService } from './entitlements';
export class ShareService {
  constructor(
    private c: CoreContext,
    private documents: DocumentService,
    private assets: AssetService,
  ) {}
  list(actor: Actor, wid: string, projectId: string, q: ListQuery) {
    this.c.requireAccess(actor, wid, 'write');
    this.c.resource('projects', wid, projectId);
    return this.c.page(
      'SELECT * FROM shares WHERE workspace_id=? AND project_id=? ORDER BY created_at DESC,id',
      [wid, projectId],
      q,
      (r) => ({
        id: str(r, 'id'),
        projectId,
        createdAt: str(r, 'created_at'),
        expiresAt: str(r, 'expires_at'),
        revokedAt: nullable(r, 'revoked_at'),
        allowOriginalDownload: num(r, 'allow_original_download') === 1,
      }),
    );
  }
  create(actor: Actor, wid: string, raw: unknown) {
    this.c.requireAccess(actor, wid, 'write');
    const input = inputs.ShareInputSchema.parse(raw);
    this.c.resource('projects', wid, input.projectId);
    const sid = id(),
      secret = token(),
      date = now(),
      expiresAt = new Date(Date.now() + input.expiresInDays * 86400000).toISOString();
    this.c.run(
      'INSERT INTO shares(id,workspace_id,project_id,token_hash,created_by,created_at,expires_at,revoked_at,allow_original_download) VALUES (?,?,?,?,?,?,?,NULL,?)',
      sid,
      wid,
      input.projectId,
      hash(secret),
      actor.userId,
      date,
      expiresAt,
      input.allowOriginalDownload ? 1 : 0,
    );
    this.c.audit(actor, wid, 'share.create', 'share', sid, {
      allowOriginalDownload: input.allowOriginalDownload,
      expiresAt,
    });
    return {
      id: sid,
      projectId: input.projectId,
      shareUrl: `${this.c.config.publicOrigin}/share#token=${secret}`,
      expiresAt,
      createdAt: date,
      allowOriginalDownload: input.allowOriginalDownload,
    };
  }
  revoke(actor: Actor, wid: string, sid: string) {
    this.c.requireAccess(actor, wid, 'write');
    if (!this.c.get('SELECT id FROM shares WHERE id=? AND workspace_id=?', sid, wid))
      throw new AppError(404, 'NOT_FOUND', '分享不存在');
    const date = now();
    this.c.run('UPDATE shares SET revoked_at=? WHERE id=?', date, sid);
    return { id: sid, revokedAt: date };
  }
  private resolve(secret: string) {
    const share = this.c.get(
      'SELECT s.* FROM shares s JOIN workspaces w ON w.id=s.workspace_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND w.archived_at IS NULL',
      hash(secret),
      now(),
    );
    if (!share) throw new AppError(404, 'SHARE_UNAVAILABLE', '分享已过期或被撤销');
    const wid = str(share, 'workspace_id'),
      project = this.c.resource('projects', wid, str(share, 'project_id'));
    const owner = this.c.get(
      "SELECT user_id FROM memberships WHERE workspace_id=? AND role='owner'",
      wid,
    );
    if (!owner) throw new AppError(404, 'SHARE_UNAVAILABLE', '分享不可用');
    const actor: Actor = {
      userId: str(owner, 'user_id'),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    return {
      wid,
      project,
      actor,
      allowOriginalDownload: num(share, 'allow_original_download') === 1,
      document: this.documents.get(actor, wid, str(project, 'document_id')),
    };
  }
  read(raw: unknown) {
    const { token: secret } = inputs.AcceptInvitationInputSchema.parse(raw);
    const { project, document, wid, actor, allowOriginalDownload } = this.resolve(secret);
    const assetIds = getSceneAssetIds(document.scene);
    return {
      project: { name: str(project, 'name'), description: str(project, 'description') },
      document: { name: document.name, scene: document.scene, revision: document.revision },
      assetIds,
      allowOriginalDownload,
      exportPolicy: new EntitlementService(this.c).exportPolicy(wid),
      assets: assetIds.map((assetId) => {
        const asset = this.assets.get(actor, wid, assetId);
        const variants = this.c.all(
          'SELECT variant,mime_type FROM asset_variants WHERE asset_id=?',
          assetId,
        );
        const preview =
          variants.find((v) => str(v, 'variant') === 'preview') ??
          variants.find((v) => str(v, 'variant') === 'thumbnail');
        return {
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          width: asset.width,
          height: asset.height,
          previewVariant: preview ? (str(preview, 'variant') as 'preview' | 'thumbnail') : null,
          previewMimeType: preview ? str(preview, 'mime_type') : null,
          originalAvailable: allowOriginalDownload,
        };
      }),
    };
  }
  media(raw: unknown) {
    const input = inputs.ShareMediaInputSchema.parse(raw);
    const { wid, actor, document, allowOriginalDownload } = this.resolve(input.token);
    if (!getSceneAssetIds(document.scene).includes(input.assetId))
      throw new AppError(404, 'NOT_FOUND', '此素材未包含在分享中');
    if (input.variant === 'original' && !allowOriginalDownload)
      throw new AppError(403, 'ORIGINAL_DOWNLOAD_DISABLED', '此分享未授权原件下载，请使用可用预览');
    return this.assets.variant(actor, wid, input.assetId, input.variant);
  }
}

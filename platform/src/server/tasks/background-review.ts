import type { Actor } from '../../contracts/core';
import {
  backgroundRefinePrepareSchema,
  type BackgroundReview,
  type BackgroundReviewDetail,
} from '../../contracts/background-review';
import { jobInputSchema } from '../../contracts/jobs';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import type { TaskServices } from './service';
import type { ItemRow } from './types';
import { findNativeArtifactCheckpoint, nativeArtifactFingerprint } from './native-artifacts';
import { freezeBackgroundRefinement } from './creative-briefs';
import { normalizeConfirmedNativeBackgroundMask } from '../providers/native-background';
import { freezeMattingBaseline } from './background-matting-baseline';

/** Only immutable successful task snapshots and saved provenance expose this action. */
export function backgroundReviewForItem(
  db: DatabaseContext,
  actor: Actor,
  wid: string,
  item: ItemRow,
): BackgroundReview | undefined {
  if (item.workspace_id !== wid || item.user_id !== actor.userId || item.status !== 'succeeded')
    return;
  try {
    const input = jobInputSchema.parse(JSON.parse(item.input_json));
    const edit = input.imageEdit;
    if (input.providerId !== 'native' || input.operation !== 'image.generate' || !edit) return;
    const row = db.sqlite
      .prepare(
        'SELECT processing_json,input_fingerprint,asset_id FROM native_generation_provenance WHERE item_id=? AND workspace_id=?',
      )
      .get(item.id, wid) as
      { processing_json: string; input_fingerprint: string; asset_id: string } | undefined;
    if (!row) return;
    if (
      row.input_fingerprint !== nativeArtifactFingerprint(input) ||
      row.asset_id !== item.asset_id
    )
      return;
    const processing = JSON.parse(row.processing_json);
    const checkpoint = findNativeArtifactCheckpoint(db, item, input, 'background-mask');
    if (
      processing.method !== 'exact-background-v1' ||
      processing.sourceAssetId !== edit.sourceAssetId ||
      processing.color?.toLowerCase() !== edit.color.toLowerCase() ||
      !checkpoint ||
      processing.maskAssetIds?.normalized !== checkpoint.asset_id
    )
      return;
    return {
      itemId: item.id,
      sourceAssetId: edit.sourceAssetId,
      maskAssetId: checkpoint.asset_id,
      color: edit.color,
      state: edit.mask.mode === 'generate' ? 'candidate' : 'confirmed',
    };
  } catch {
    return;
  }
}

export function createBackgroundReviewServices(s: TaskServices) {
  function owned(actor: Actor, wid: string, jobId: string, itemId: string) {
    s.core.requireAccess(actor, wid, 'read');
    const item = s.db.sqlite
      .prepare(
        'SELECT i.* FROM job_items i JOIN jobs j ON j.id=i.job_id WHERE i.id=? AND i.job_id=? AND i.workspace_id=? AND j.user_id=?',
      )
      .get(itemId, jobId, wid, actor.userId) as ItemRow | undefined;
    const review = item && backgroundReviewForItem(s.db, actor, wid, item);
    if (!item || !review)
      throw new AppError(404, 'BACKGROUND_REVIEW_NOT_FOUND', '未找到可调整的背景候选。');
    return { item, review };
  }
  function get(actor: Actor, wid: string, jobId: string, itemId: string): BackgroundReviewDetail {
    const { review } = owned(actor, wid, jobId, itemId);
    return {
      ...review,
      jobId,
      source: s.core.assets.get(actor, wid, review.sourceAssetId),
      mask: s.core.assets.get(actor, wid, review.maskAssetId),
    };
  }
  return {
    get,
    async prepare(actor: Actor, wid: string, jobId: string, itemId: string, raw: unknown) {
      s.core.requireAccess(actor, wid, 'write');
      const body = backgroundRefinePrepareSchema.parse(raw);
      const { item, review } = owned(actor, wid, jobId, itemId);
      const source = s.core.assets.get(actor, wid, review.sourceAssetId);
      const mask = s.core.assets.get(actor, wid, body.maskAssetId);
      if (
        mask.createdBy !== actor.userId ||
        mask.kind !== 'image' ||
        mask.mimeType !== 'image/png' ||
        mask.width !== source.width ||
        mask.height !== source.height
      )
        throw new AppError(
          400,
          'BACKGROUND_REVIEW_MASK_INVALID',
          '请保存属于本人的同尺寸背景区域蒙版。',
        );
      const original = await s.core.assets.readOriginal(actor, wid, body.maskAssetId);
      try {
        await normalizeConfirmedNativeBackgroundMask(
          original.buffer,
          source.width!,
          source.height!,
        );
      } catch {
        throw new AppError(
          400,
          'BACKGROUND_REVIEW_MASK_INVALID',
          '蒙版须为原图尺寸的有效透明区域图片，并同时包含保留区和编辑区。',
        );
      }
      const baseline = await freezeMattingBaseline(s, actor, wid, item);
      return freezeBackgroundRefinement(s, actor, wid, item, body.requestId, mask, baseline);
    },
  };
}

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Actor } from '../../contracts/core';
import { jobInputSchema } from '../../contracts/jobs';
import type { NativeImageEdit } from '../../contracts/native-image-edit';
import { AppError } from '../errors';
import type { TaskServices } from './service';
import type { ItemRow } from './types';
import { findNativeArtifactCheckpoint, nativeArtifactFingerprint } from './native-artifacts';

/** The client supplies only a new mask. The immutable root comes from owned checkpoints. */
export async function freezeMattingBaseline(
  s: TaskServices,
  actor: Actor,
  wid: string,
  item: ItemRow,
): Promise<NativeImageEdit['mattingBaseline']> {
  const input = jobInputSchema.parse(JSON.parse(item.input_json));
  const edit = input.imageEdit;
  if (
    !edit ||
    (!edit.mattingBaseline &&
      (edit.mask.mode !== 'generate' || edit.mask.calibration !== 'local-matting-v2'))
  )
    return;
  const invalid = () =>
    new AppError(
      409,
      'BACKGROUND_REVIEW_BASELINE_INVALID',
      '自动抠图原件或来源校验失败，请恢复原件后再调整；不会重新调用模型。',
    );
  try {
    let baseline = edit.mattingBaseline;
    if (!baseline) {
      const mask = findNativeArtifactCheckpoint(s.db, item, input, 'background-mask');
      const result = findNativeArtifactCheckpoint(
        s.db,
        item,
        input,
        'background-matting-composite',
      );
      const source = s.db.sqlite
        .prepare('SELECT sha256 FROM assets WHERE id=? AND workspace_id=?')
        .get(edit.sourceAssetId, wid) as { sha256: string } | undefined;
      if (!mask || !result || !source) throw invalid();
      baseline = {
        version: 1,
        sourceSha256: source.sha256,
        resultAssetId: result.asset_id,
        resultSha256: result.sha256,
        maskAssetId: mask.asset_id,
        maskSha256: mask.sha256,
        color: edit.color,
      };
    }
    // Repeated refinements must still resolve to the same automatic root, never the
    // most recent manually blended result. A retry may inherit its parent's pair.
    const roots = s.db.sqlite
      .prepare(
        `SELECT i.* FROM native_generation_checkpoints r
         JOIN native_generation_checkpoints m ON m.item_id=r.item_id AND m.workspace_id=r.workspace_id
         JOIN job_items i ON i.id=r.item_id AND i.workspace_id=r.workspace_id
         WHERE r.workspace_id=? AND i.user_id=? AND r.role='background-matting-composite'
         AND r.asset_id=? AND m.role='background-mask' AND m.asset_id=?
         AND r.input_fingerprint=m.input_fingerprint`,
      )
      .all(wid, actor.userId, baseline.resultAssetId, baseline.maskAssetId) as ItemRow[];
    const root = roots.find((candidate) => {
      const frozen = jobInputSchema.parse(JSON.parse(candidate.input_json));
      const frozenEdit = frozen.imageEdit;
      if (
        frozen.providerId !== 'native' ||
        frozen.operation !== 'image.generate' ||
        frozenEdit?.mask.mode !== 'generate' ||
        frozenEdit.mask.calibration !== 'local-matting-v2' ||
        frozenEdit.sourceAssetId !== edit.sourceAssetId ||
        frozenEdit.color !== baseline.color ||
        frozenEdit.mattingBaseline
      )
        return false;
      const checkpoint = findNativeArtifactCheckpoint(
        s.db,
        candidate,
        frozen,
        'background-matting-composite',
      );
      return checkpoint?.input_fingerprint === nativeArtifactFingerprint(frozen);
    });
    if (!root || baseline.color !== edit.color) throw invalid();
    const source = s.core.assets.get(actor, wid, edit.sourceAssetId);
    for (const [id, digest] of [
      [edit.sourceAssetId, baseline.sourceSha256],
      [baseline.resultAssetId, baseline.resultSha256],
      [baseline.maskAssetId, baseline.maskSha256],
    ]) {
      const asset = s.core.assets.get(actor, wid, id!);
      if (
        asset.kind !== 'image' ||
        asset.width !== source.width ||
        asset.height !== source.height ||
        (id !== edit.sourceAssetId && asset.createdBy !== actor.userId)
      )
        throw invalid();
      const original = await s.core.assets.readOriginal(actor, wid, id!);
      const metadata = await sharp(original.buffer).metadata();
      if (
        createHash('sha256').update(original.buffer).digest('hex') !== digest ||
        metadata.width !== source.width ||
        metadata.height !== source.height
      )
        throw invalid();
    }
    return baseline;
  } catch {
    throw invalid();
  }
}

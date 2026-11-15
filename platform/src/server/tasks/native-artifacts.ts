import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { jobInputSchema, type JobInput } from '../../contracts/jobs';
import type { DatabaseContext } from '../db/connection';
import type { TaskServices } from './service';
import { inputHash } from './validation';
import {
  now,
  ProviderError,
  type ExecutionContext,
  type ItemRow,
  type NativeArtifact,
  type NativeArtifactRole,
  type NativeProcessing,
} from './types';
import { downloadPublicMedia } from '../providers/http';

interface CheckpointRow {
  item_id: string;
  workspace_id: string;
  role: NativeArtifactRole;
  asset_id: string;
  input_fingerprint: string;
  sha256: string;
}

export function nativeArtifactFingerprint(input: JobInput): string {
  return inputHash({ ...input, capabilityRevision: undefined });
}

function checkpointError(message: string): ProviderError {
  return new ProviderError(message, true, 'NATIVE_CHECKPOINT_INVALID');
}

/** Only the current item and its actual parent chain may provide an intermediate. */
export function findNativeArtifactCheckpoint(
  db: DatabaseContext,
  item: ItemRow,
  input: JobInput,
  role: NativeArtifactRole,
): CheckpointRow | undefined {
  if (
    ![
      'background-mask-raw',
      'background-mask-baseline',
      'background-mask',
      'background-matting-composite',
      'video-model-raw',
    ].includes(role)
  )
    throw checkpointError('中间产物角色无效，不能重新生成。');
  const fingerprint = nativeArtifactFingerprint(input);
  const seen = new Set<string>();
  let id: string | null = item.id;
  while (id) {
    if (seen.has(id)) throw checkpointError('任务恢复来源存在循环，需核对。');
    seen.add(id);
    const parent = db.sqlite.prepare('SELECT * FROM job_items WHERE id=?').get(id) as
      ItemRow | undefined;
    if (!parent || parent.workspace_id !== item.workspace_id)
      throw checkpointError('任务恢复来源不属于当前工作空间，需核对。');
    const row = db.sqlite
      .prepare(
        'SELECT c.*,a.sha256 FROM native_generation_checkpoints c JOIN assets a ON a.id=c.asset_id AND a.workspace_id=c.workspace_id WHERE c.item_id=? AND c.workspace_id=? AND c.role=?',
      )
      .get(id, item.workspace_id, role) as CheckpointRow | undefined;
    let parentFingerprint: string;
    try {
      parentFingerprint = nativeArtifactFingerprint(
        jobInputSchema.parse(JSON.parse(parent.input_json)),
      );
    } catch {
      throw checkpointError('任务恢复输入损坏，不能重新生成。');
    }
    if (row && row.input_fingerprint !== parentFingerprint)
      throw checkpointError('已保存中间产物与任务输入不一致，需核对。');
    if (row && row.input_fingerprint === fingerprint) return row;
    if (id === item.id && parentFingerprint !== fingerprint)
      throw checkpointError('当前执行输入与已保存任务不一致，需核对。');
    id = parent.retry_source_item_id;
  }
  return undefined;
}

export function hasNativeProcessingCheckpoint(
  db: DatabaseContext,
  item: ItemRow,
  input: JobInput,
): boolean {
  if (input.providerId !== 'native') return false;
  if (input.operation === 'video.generate' && input.nativePlan?.motionRenderer === 'exact-pan-v1')
    return true;
  if (
    input.operation === 'video.generate' &&
    input.nativePlan?.videoPostprocess === 'model-video-tail-hold-v1'
  )
    return !!findNativeArtifactCheckpoint(db, item, input, 'video-model-raw');
  if (input.operation !== 'image.generate' || !input.imageEdit) return false;
  if (input.imageEdit.mask.mode === 'asset') return true;
  return !!findNativeArtifactCheckpoint(db, item, input, 'background-mask-raw');
}

export function createNativeArtifacts(options: {
  services: TaskServices;
  item: ItemRow;
  input: JobInput;
  owns: () => boolean;
}): NonNullable<ExecutionContext['nativeArtifacts']> {
  const { services, item, input, owns } = options;
  const context = {
    workspaceId: item.workspace_id,
    createdBy: item.user_id,
    projectId: input.projectId || null,
    jobId: item.job_id,
  };
  function assertRole(role: NativeArtifactRole, saving = false) {
    if (
      role === 'background-mask-baseline' &&
      (input.imageEdit?.mask.mode !== 'generate' ||
        !['source-guided-v1', 'local-matting-v2'].includes(input.imageEdit.mask.calibration || ''))
    )
      throw checkpointError('只有新版自动校准任务可以保存校准前蒙版。');
    if (
      role === 'background-matting-composite' &&
      (input.imageEdit?.mask.mode !== 'generate' ||
        input.imageEdit.mask.calibration !== 'local-matting-v2')
    )
      throw checkpointError('当前任务没有冻结本机精细抠图版本。');
    if (role === 'video-model-raw') {
      if (
        input.providerId !== 'native' ||
        input.operation !== 'video.generate' ||
        input.nativePlan?.videoPostprocess !== 'model-video-tail-hold-v1'
      )
        throw checkpointError('当前任务不支持保存模型视频原片。');
      return;
    }
    if (
      input.providerId !== 'native' ||
      input.operation !== 'image.generate' ||
      !input.imageEdit ||
      ![
        'background-mask-raw',
        'background-mask-baseline',
        'background-mask',
        'background-matting-composite',
      ].includes(role) ||
      (saving && role === 'background-mask-raw' && input.imageEdit.mask.mode !== 'generate')
    )
      throw checkpointError('当前任务不支持此中间产物角色。');
  }
  async function load(role: NativeArtifactRole): Promise<NativeArtifact | undefined> {
    assertRole(role);
    if (role === 'background-mask-raw' && input.imageEdit!.mask.mode === 'asset') return undefined;
    const row = findNativeArtifactCheckpoint(services.db, item, input, role);
    if (!row) return undefined;
    try {
      const asset = await services.core.assets.readOriginalForJob(context, row.asset_id);
      if (createHash('sha256').update(asset.buffer).digest('hex') !== row.sha256)
        throw checkpointError('中间产物原件校验失败，不能重新生成。');
      return { assetId: row.asset_id, ...asset };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw checkpointError('已记录的中间产物无法读取，不能重新生成；请恢复原件后重试。');
    }
  }
  return {
    load,
    async saveMattingPair(maskBuffer, compositeBuffer) {
      assertRole('background-matting-composite');
      const existingMask = await load('background-mask');
      const existingComposite = await load('background-matting-composite');
      if (existingMask || existingComposite) {
        if (
          !existingMask ||
          !existingComposite ||
          !existingMask.buffer.equals(maskBuffer) ||
          !existingComposite.buffer.equals(compositeBuffer)
        )
          throw checkpointError('本机抠图检查点不完整或已有不同结果，不能覆盖或重新生成。');
        return { mask: existingMask, composite: existingComposite };
      }
      const prepared: Awaited<ReturnType<typeof services.core.assets.prepare>>[] = [];
      let committed = false;
      try {
        for (const [buffer, name] of [
          [maskBuffer, '背景编辑蒙版.png'],
          [compositeBuffer, '背景本机抠图原始合成.png'],
        ] as const) {
          if ((await fileTypeFromBuffer(buffer))?.mime !== 'image/png')
            throw checkpointError('本机抠图产物必须为有效PNG图片。');
          prepared.push(
            await services.core.assets.prepare({
              buffer,
              name,
              mimeType: 'image/png',
              projectId: input.projectId,
              source: 'local-processing',
              sourceJobId: item.job_id,
            }),
          );
        }
        if (
          prepared.some((value) => value.kind !== 'image') ||
          prepared[0]!.width !== prepared[1]!.width ||
          prepared[0]!.height !== prepared[1]!.height
        )
          throw checkpointError('本机抠图蒙版与合成图尺寸不一致。');
        const saved = services.transaction(() => {
          if (!owns())
            throw new ProviderError(
              '执行权已转移，本机抠图结果未提交。',
              false,
              'LOCAL_MATTING_LEASE_LOST',
            );
          const live = services.db.sqlite
            .prepare('SELECT cancel_requested FROM job_items WHERE id=? AND workspace_id=?')
            .get(item.id, item.workspace_id) as { cancel_requested: number } | undefined;
          if (!live)
            throw new ProviderError(
              '任务执行权已转移，本机抠图结果未提交。',
              false,
              'LOCAL_MATTING_LEASE_LOST',
            );
          if (live.cancel_requested)
            throw new ProviderError(
              '本机抠图已取消，结果未提交；付费原件仍保留。',
              false,
              'LOCAL_MATTING_CANCELLED',
            );
          const assets = prepared.map((value) =>
            services.core.assets.commitPreparedForJob(context, value),
          );
          for (const [index, role] of ['background-mask', 'background-matting-composite'].entries())
            services.db.sqlite
              .prepare(
                'INSERT INTO native_generation_checkpoints(item_id,workspace_id,role,asset_id,input_fingerprint,created_at) VALUES(?,?,?,?,?,?)',
              )
              .run(
                item.id,
                item.workspace_id,
                role,
                assets[index]!.id,
                nativeArtifactFingerprint(input),
                now(),
              );
          services.db.sqlite
            .prepare("UPDATE job_items SET phase='processing',updated_at=? WHERE id=?")
            .run(now(), item.id);
          return assets;
        });
        committed = true;
        return {
          mask: {
            assetId: saved[0]!.id,
            buffer: maskBuffer,
            mimeType: 'image/png',
            name: saved[0]!.name,
          },
          composite: {
            assetId: saved[1]!.id,
            buffer: compositeBuffer,
            mimeType: 'image/png',
            name: saved[1]!.name,
          },
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          '本机抠图结果未安全保存；已有付费原件保留，仅需恢复本机处理。',
          false,
          'LOCAL_MATTING_SAVE_FAILED',
        );
      } finally {
        if (!committed)
          for (const value of prepared) await services.core.assets.discardPrepared(value);
      }
    },
    async save(role, output) {
      try {
        if (
          role === 'background-matting-composite' ||
          (role === 'background-mask' &&
            input.imageEdit?.mask.mode === 'generate' &&
            input.imageEdit.mask.calibration === 'local-matting-v2')
        )
          throw checkpointError('本机精细抠图蒙版与合成图必须成对提交。');
        assertRole(role, true);
        const buffer = output.buffer
          ? output.buffer
          : output.url
            ? await downloadPublicMedia(output.url, undefined, 0, {
                dnsMode: services.config.mediaDnsMode,
                ...(services.config.mediaDownloadTimeoutMs
                  ? { timeoutMs: services.config.mediaDownloadTimeoutMs }
                  : {}),
              })
            : undefined;
        if (!buffer) throw checkpointError('模型中间产物为空，需核对服务商结果。');
        const existing = await load(role);
        if (existing) {
          if (!existing.buffer.equals(buffer))
            throw checkpointError('同一任务已有不同的中间产物，不能覆盖。');
          return existing;
        }
        const detected = await fileTypeFromBuffer(buffer);
        const video = role === 'video-model-raw';
        if (!detected?.mime.startsWith(video ? 'video/' : 'image/'))
          throw checkpointError('模型中间产物类型无效，需核对服务商结果。');
        const raw = role === 'background-mask-raw' || video;
        const prepared = await services.core.assets.prepare({
          buffer,
          name: `${video ? '视频模型完整原片' : raw ? '背景模型原始蒙版' : role === 'background-mask-baseline' ? '背景校准前蒙版' : '背景标准化蒙版'}.${detected.ext}`,
          mimeType: detected.mime,
          projectId: input.projectId,
          source: raw ? 'generation' : 'local-processing',
          sourceJobId: item.job_id,
        });
        let committed = false;
        try {
          const asset = services.transaction(() => {
            if (!owns()) throw checkpointError('任务执行权已转移，中间产物已停止保存。');
            if (prepared.kind !== (video ? 'video' : 'image'))
              throw checkpointError('中间产物类型无效。');
            const saved = services.core.assets.commitPreparedForJob(context, prepared);
            services.db.sqlite
              .prepare(
                'INSERT INTO native_generation_checkpoints(item_id,workspace_id,role,asset_id,input_fingerprint,created_at) VALUES(?,?,?,?,?,?)',
              )
              .run(
                item.id,
                item.workspace_id,
                role,
                saved.id,
                nativeArtifactFingerprint(input),
                now(),
              );
            services.db.sqlite
              .prepare("UPDATE job_items SET phase='processing',updated_at=? WHERE id=?")
              .run(now(), item.id);
            return saved;
          });
          committed = true;
          return { assetId: asset.id, buffer, mimeType: detected.mime, name: asset.name };
        } finally {
          if (!committed) await services.core.assets.discardPrepared(prepared);
        }
      } catch (error) {
        if (error instanceof ProviderError && error.ambiguous) throw error;
        // A model response already exists. Download/validation/storage failures are not
        // evidence that the upstream generation was never submitted or billed.
        throw new ProviderError(
          '中间产物尚未安全保存，需核对已有结果，不能重复生成。',
          true,
          'NATIVE_CHECKPOINT_SAVE_FAILED',
        );
      }
    },
  };
}

/** A provider response cannot opt into local provenance without the matching frozen operation. */
export function validateNativeProcessing(
  db: DatabaseContext,
  item: ItemRow,
  input: JobInput,
  processing: NativeProcessing | undefined,
): void {
  const expectedPan =
    input.providerId === 'native' && input.nativePlan?.motionRenderer === 'exact-pan-v1';
  const expectedBackground = input.providerId === 'native' && !!input.imageEdit;
  const expectedTailHold =
    input.providerId === 'native' &&
    input.nativePlan?.videoPostprocess === 'model-video-tail-hold-v1';
  if (!processing) {
    if (expectedPan || expectedBackground || expectedTailHold)
      throw checkpointError('本机处理结果缺少来源记录，需核对。');
    return;
  }
  if (
    processing.params &&
    Object.values(processing.params).some(
      (value) =>
        (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) ||
        (typeof value === 'number' && !Number.isFinite(value)),
    )
  )
    throw checkpointError('本机处理参数记录无效。');
  if (processing.method === 'exact-pan-v1') {
    if (
      !expectedPan ||
      input.operation !== 'video.generate' ||
      input.nativePlan?.firstFrame?.mode !== 'reference' ||
      processing.sourceAssetId !== input.nativePlan.firstFrame.assetId
    )
      throw checkpointError('本机平移结果与已确认任务来源不一致。');
    return;
  }
  if (processing.method === 'model-video-tail-hold-v1') {
    const raw =
      expectedTailHold && input.operation === 'video.generate'
        ? findNativeArtifactCheckpoint(db, item, input, 'video-model-raw')
        : undefined;
    if (!raw || raw.asset_id !== processing.sourceAssetId)
      throw checkpointError('尾段停稳结果缺少匹配的原始模型视频。');
    return;
  }
  if (
    processing.method !== 'exact-background-v1' ||
    !expectedBackground ||
    input.operation !== 'image.generate' ||
    processing.sourceAssetId !== input.imageEdit!.sourceAssetId ||
    processing.color.toUpperCase() !== input.imageEdit!.color.toUpperCase()
  )
    throw checkpointError('本机背景合成结果与已确认任务不一致。');
  const normalized = findNativeArtifactCheckpoint(db, item, input, 'background-mask');
  if (!normalized || normalized.asset_id !== processing.maskAssetIds.normalized)
    throw checkpointError('本机背景合成缺少匹配的标准化蒙版。');
  if (input.imageEdit!.mask.mode === 'generate') {
    const raw = findNativeArtifactCheckpoint(db, item, input, 'background-mask-raw');
    if (!raw || raw.asset_id !== processing.maskAssetIds.raw)
      throw checkpointError('本机背景合成缺少匹配的模型原始蒙版。');
    if (
      ['source-guided-v1', 'local-matting-v2'].includes(input.imageEdit!.mask.calibration || '')
    ) {
      const baseline = findNativeArtifactCheckpoint(db, item, input, 'background-mask-baseline');
      if (!baseline || baseline.asset_id !== processing.maskAssetIds.baseline)
        throw checkpointError('自动校准结果缺少匹配的校准前蒙版。');
    } else if (processing.maskAssetIds.baseline)
      throw checkpointError('旧蒙版不能声称采用了自动校准。');
    if (input.imageEdit!.mask.calibration === 'local-matting-v2') {
      const composite = findNativeArtifactCheckpoint(
        db,
        item,
        input,
        'background-matting-composite',
      );
      if (!composite || composite.asset_id !== processing.params?.mattingCompositeAssetId)
        throw checkpointError('本机精细抠图缺少匹配的原始合成图。');
    }
  } else if (processing.maskAssetIds.raw) {
    throw checkpointError('指定蒙版任务不能声称生成了模型蒙版。');
  }
}

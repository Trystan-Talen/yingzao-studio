import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor, AssetDto } from '../../contracts/core';
import type { NativeImageEdit } from '../../contracts/native-image-edit';
import { jobInputSchema, type JobInput } from '../../contracts/jobs';
import { creativeInputFingerprint } from '../../contracts/creative-fingerprint';
import {
  creativeAnswerSchema,
  creativeIntentRequestSchema,
  creativeIntentResultSchema,
  validateCreativeIntent,
  resolveCreativePlacement,
  type CreativeIntentRequest,
  type CreativePreparation,
} from '../../contracts/creative-intent';
import {
  compileCreativeGuidance,
  resolveCreativeStrategy,
} from '../../contracts/creative-strategy';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { analyzeDifyIntent } from '../providers/dify';
import { analyzeNativeIntent, type NativePlannerObserver } from '../providers/native-planner';
import { ProviderError, type ItemRow } from './types';
import type { TaskServices } from './service';
import { simulateCreativeIntent } from './creative-intent-simulation';
import { isFalReferenceModel } from '../providers/fal-reference';
import { compileCapturePrompt } from './creative-capture';
import {
  compileNativeVideoPlan,
  nativeReferenceFrameIssue,
  canPlanExactPan,
} from './native-capture';
import { modelConnectionsRevision } from './model-connections';
import { estimateCreationCredits } from '../../contracts/credit-estimate';
import { channelForActor } from '../../contracts/billing-channel';
import { supportsNativeMotionEndpoints } from '../../contracts/native-plan';
import { isKnownSeedreamModel } from '../../contracts/model-connections';
import {
  validateNativeImageEdit,
  explicitNativeBackgroundColor,
} from '../providers/native-background';
import { nativeImageSpecification } from '../providers/native-image-spec';
import { expectedNativeVideoSize } from '../providers/native-video-spec';
import { prepareNativeReferenceMedia } from '../providers/native-reference-media';
import { analyzeNativeReferenceStudy } from '../providers/native-reference-study';
import { replicaImagePrompt } from '../providers/native-replica';
import { analyzeNativeBackgroundStudy } from '../providers/native-background-study';
import { canonicalLocalMattingSource, probeLocalMatting } from '../providers/local-matting';
import {
  assertCreativeKnowledgeFresh,
  resolveCreativeKnowledge,
  validateCreativeKnowledgeInput,
} from './creative-knowledge';

export const creativePrepareSchema = z
  .object({
    requestId: z.string().uuid(),
    input: jobInputSchema,
    previousId: z.string().uuid().optional(),
    answers: z.array(creativeAnswerSchema).max(2).default([]),
  })
  .strict();
interface BriefRow {
  id: string;
  workspace_id: string;
  user_id: string;
  request_id: string;
  previous_id: string | null;
  input_fingerprint: string;
  input_json: string;
  request_json: string;
  result_json: string | null;
  compiled_prompt: string | null;
  state: string;
  error_message: string | null;
  planner_revision: string | null;
}
/** Time-derived ranking is not a new request. Keep content and lifetime changes significant. */
function planningRequestKey(request: CreativeIntentRequest): string {
  return JSON.stringify({
    ...request,
    requestId: undefined,
    replica: undefined,
    memoryContext: request.memoryContext
      ? {
          ...request.memoryContext,
          items: request.memoryContext.items
            .map((item) => ({ ...item, weight: undefined }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        }
      : undefined,
    contextSources: request.contextSources
      ?.slice()
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
  });
}
function owned(db: DatabaseContext, actor: Actor, wid: string, id: string): BriefRow {
  const row = db.sqlite
    .prepare('SELECT * FROM creative_briefs WHERE id=? AND workspace_id=? AND user_id=?')
    .get(id, wid, actor.userId) as BriefRow | undefined;
  if (!row) throw new AppError(404, 'CREATIVE_BRIEF_NOT_FOUND', '未找到这次创作需求，请重新整理');
  if (actor.authType !== 'session' && jobInputSchema.parse(JSON.parse(row.input_json)).useMemory)
    throw new AppError(
      403,
      'MEMORY_SESSION_REQUIRED',
      '包含个人记忆的创作方案仅供本人登录会话读取与使用。',
    );
  return row;
}
export function approvedCreativePrompt(
  db: DatabaseContext,
  actor: Actor,
  wid: string,
  input: JobInput,
): string | undefined {
  if (!input.creativeBriefId) return undefined;
  const row = owned(db, actor, wid, input.creativeBriefId);
  const original = jobInputSchema.parse(JSON.parse(row.input_json));
  if (
    input.providerId === 'native' &&
    !(original.operation === 'image.generate' && original.imageEdit?.mask.mode === 'asset') &&
    original.nativeRevision !== modelConnectionsRevision(db, wid, input.operation)
  )
    throw new AppError(
      409,
      'CREATIVE_CONFIGURATION_CHANGED',
      '模型配置已改变，请重新整理创作方案。',
    );
  if (original.projectId && original.projectId !== input.projectId)
    throw new AppError(409, 'CREATIVE_PROJECT_CHANGED', '创作项目已变更，请重新整理需求');
  if (row.input_fingerprint !== creativeInputFingerprint(input))
    throw new AppError(409, 'CREATIVE_BRIEF_CHANGED', '需求或素材已修改，请重新整理后生成');
  if (row.state !== 'ready' || !row.compiled_prompt)
    throw new AppError(409, 'CREATIVE_BRIEF_NOT_READY', '请先补充影响生成结果的必要信息');
  return row.compiled_prompt;
}
/** Image processing is selected only by the server's already-confirmed snapshot. */
export function frozenNativeImageEdit(
  db: DatabaseContext,
  actor: Actor,
  wid: string,
  input: JobInput,
): JobInput['imageEdit'] {
  if (input.providerId !== 'native' || input.operation !== 'image.generate') return undefined;
  const fail = () => {
    throw new AppError(
      409,
      'NATIVE_IMAGE_EDIT_INVALID',
      '局部背景编辑缺少已确认且匹配的方案，请重新整理。',
    );
  };
  if (!input.creativeBriefId) {
    if (input.maskAssetId) fail();
    return undefined;
  }
  approvedCreativePrompt(db, actor, wid, input);
  const row = owned(db, actor, wid, input.creativeBriefId);
  const saved = jobInputSchema.parse(JSON.parse(row.input_json)).imageEdit;
  if (
    input.maskAssetId &&
    (saved?.mask.mode !== 'asset' || saved.mask.assetId !== input.maskAssetId)
  )
    fail();
  return saved;
}
export function frozenCreativeContext(
  db: DatabaseContext,
  actor: Actor,
  wid: string,
  input: JobInput,
): CreativeIntentRequest | undefined {
  if (!input.creativeBriefId) return undefined;
  return creativeIntentRequestSchema.parse(
    JSON.parse(owned(db, actor, wid, input.creativeBriefId).request_json),
  );
}
export function frozenNativeReplica(
  db: DatabaseContext,
  actor: Actor,
  wid: string,
  input: JobInput,
): JobInput['nativeReplica'] {
  if (!input.replica) return undefined;
  approvedCreativePrompt(db, actor, wid, input);
  if (!input.creativeBriefId)
    throw new AppError(409, 'REPLICA_PLAN_REQUIRED', '请先分析参考作品并确认复刻方案。');
  const saved = jobInputSchema.parse(
    JSON.parse(owned(db, actor, wid, input.creativeBriefId).input_json),
  );
  if (!saved.nativeReplica)
    throw new AppError(409, 'REPLICA_PLAN_REQUIRED', '已确认方案缺少参考分析，请重新整理。');
  return saved.nativeReplica;
}
export function frozenNativePlan(
  db: DatabaseContext,
  actor: Actor,
  wid: string,
  input: JobInput,
): JobInput['nativePlan'] {
  if (input.providerId !== 'native') return undefined;
  if (!input.creativeBriefId)
    throw new AppError(409, 'CREATIVE_BRIEF_REQUIRED', '请先整理并确认创作方案，再提交生成。');
  const row = owned(db, actor, wid, input.creativeBriefId);
  if (input.operation !== 'video.generate') return undefined;
  if (row.state !== 'ready')
    throw new AppError(409, 'CREATIVE_BRIEF_NOT_READY', '请先补充并确认视频创作方案。');
  const savedInput = jobInputSchema.parse(JSON.parse(row.input_json));
  if (savedInput.nativePlan) return savedInput.nativePlan;
  const result = creativeIntentResultSchema.parse(JSON.parse(row.result_json || 'null'));
  if (!result.generationPlan)
    throw new AppError(
      409,
      'NATIVE_VIDEO_PLAN_REQUIRED',
      '视频方案缺少首帧与运镜说明，请重新整理。',
    );
  const request = creativeIntentRequestSchema.parse(JSON.parse(row.request_json));
  let plan: JobInput['nativePlan'];
  // Older briefs did not persist their stage prompts. Prefer an already quoted server
  // snapshot, rather than reinterpret an approved job with today's compiler.
  const previous = db.sqlite.prepare(
    "SELECT items_json FROM quotes WHERE workspace_id=? AND user_id=? AND json_extract(input_json,'$.creativeBriefId')=? ORDER BY created_at,id",
  );
  for (const quote of previous.iterate(wid, actor.userId, row.id) as Iterable<{
    items_json: string | null;
  }>) {
    if (!quote.items_json) continue;
    const parts: unknown = JSON.parse(quote.items_json);
    if (!Array.isArray(parts) || parts.length !== 1) continue;
    const part = jobInputSchema.safeParse(parts[0]);
    if (
      part.success &&
      part.data.providerId === 'native' &&
      part.data.operation === 'video.generate' &&
      part.data.nativePlan
    ) {
      plan = part.data.nativePlan;
      break;
    }
  }
  try {
    plan ??= compileNativeVideoPlan(result, request);
  } catch {
    throw new AppError(
      409,
      'NATIVE_VIDEO_PLAN_INVALID',
      '首帧引用与本次素材或画幅不匹配，请重新整理；不会自动重绘商品。',
    );
  }
  if (!plan || plan.imagePrompt.length > 11000 || plan.videoPrompt.length > 11000)
    throw new AppError(409, 'NATIVE_VIDEO_PLAN_INVALID', '视频方案不完整或过长，请重新整理。');
  // Pin the legacy compatibility result once. A concurrent quote may have won this
  // compare-and-swap; in that case use its already-pinned snapshot instead.
  const update = db.sqlite
    .prepare('UPDATE creative_briefs SET input_json=? WHERE id=? AND input_json=?')
    .run(JSON.stringify({ ...savedInput, nativePlan: plan }), row.id, row.input_json);
  return update.changes === 1
    ? plan
    : jobInputSchema.parse(JSON.parse(owned(db, actor, wid, row.id).input_json)).nativePlan;
}
function isLegacyInvalidPlan(row: BriefRow): boolean {
  return (
    row.state === 'uncertain' &&
    row.error_message ===
      '文本模型返回的策划不完整、事实依据不符或输出被截断；已停止生成，请核对本次调用。'
  );
}
function dto(row: BriefRow): CreativePreparation {
  if (row.state === 'analyzing')
    throw new AppError(409, 'CREATIVE_BRIEF_ANALYZING', '需求仍在整理，请稍后查看；不会重复提交');
  // Older native parser versions incorrectly marked a fully received invalid response uncertain.
  // This exact diagnostic is safe to classify on read; transport uncertainty stays unchanged.
  const legacyInvalidPlan = isLegacyInvalidPlan(row);
  if (row.state === 'uncertain' && !legacyInvalidPlan)
    throw new AppError(
      409,
      'CREATIVE_BRIEF_UNCERTAIN',
      row.error_message || '需求整理结果待核对，不会自动重复调用',
    );
  if (row.state === 'failed' || legacyInvalidPlan || !row.result_json)
    throw new AppError(
      409,
      'CREATIVE_BRIEF_FAILED',
      legacyInvalidPlan
        ? '文本模型已返回响应，但策划未通过校验；尚未提交图片或视频生成，请重新整理需求。'
        : row.error_message || '本次需求整理未完成，可重新检查',
    );
  const result = creativeIntentResultSchema.parse(JSON.parse(row.result_json));
  const input = jobInputSchema.parse(JSON.parse(row.input_json));
  const request = creativeIntentRequestSchema.parse(JSON.parse(row.request_json));
  // Internal compiler snapshots are server-owned; client requests cannot replace them.
  delete input.nativePlan;
  delete input.imageEdit;
  const referenceStudy = input.nativeReplica
    ? { study: input.nativeReplica.study, evidence: input.nativeReplica.evidence }
    : undefined;
  delete input.nativeReplica;
  return {
    id: row.id,
    status: result.status,
    result,
    ...(referenceStudy ? { referenceStudy } : {}),
    ...(request.contextSources ? { contextSources: request.contextSources } : {}),
    ...(request.memoryContext ? { omittedMemoryCount: request.memoryContext.omitted } : {}),
    input: { ...input, creativeBriefId: row.id },
  };
}
/** This entry receives an owned, provenance-checked item, never a client plan.
 * A confirmed mask only freezes another local composition; no text planner runs. */
export function freezeBackgroundRefinement(
  s: TaskServices,
  actor: Actor,
  wid: string,
  item: ItemRow,
  requestId: string,
  mask: AssetDto,
  mattingBaseline?: NativeImageEdit['mattingBaseline'],
): CreativePreparation {
  const original = jobInputSchema.parse(JSON.parse(item.input_json));
  if (
    !original.imageEdit ||
    original.providerId !== 'native' ||
    original.operation !== 'image.generate'
  )
    throw new AppError(409, 'BACKGROUND_REVIEW_INVALID', '此任务不支持背景区域修正。');
  const edit = {
    ...original.imageEdit,
    mattingBaseline,
    mask: { mode: 'asset' as const, assetId: mask.id },
  };
  const source = s.core.assets.get(actor, wid, edit.sourceAssetId);
  const prompt = `仅将确认蒙版中的背景区域替换为${edit.color}，保持原图其余区域不变；使用已保存原图与本人确认的区域蒙版本机合成，不调用模型。`;
  const input = jobInputSchema.parse({
    ...original,
    creativeBriefId: undefined,
    nativePlan: undefined,
    nativeRevision: modelConnectionsRevision(s.db, wid, 'image.generate'),
    prompt,
    assetIds: [source.id],
    referenceAssetIds: [],
    maskAssetId: mask.id,
    imageEdit: edit,
    options: { ...original.options, count: 1, designs: undefined },
  });
  const fingerprint = creativeInputFingerprint(input);
  const lineage = `job:${item.job_id};item:${item.id}`;
  const placement = resolveCreativePlacement({
    mediaType: 'image',
    kind: input.options.kind,
    placement: input.options.creativePlacement,
  });
  const strategy = resolveCreativeStrategy({
    platform: input.options.platform,
    placement,
    market: input.options.creativeMarket,
    mediaType: 'image',
  });
  const request = creativeIntentRequestSchema.parse({
    version: 1,
    requestId,
    rawPrompt: prompt,
    sourceTexts: [
      { id: 'request', text: prompt },
      { id: 'background-review', text: lineage },
    ],
    answers: [],
    materials: [source, mask].map((asset, index) => ({
      id: asset.id,
      name: asset.name,
      kind: 'image',
      role: index ? 'mask' : 'input',
      width: asset.width,
      height: asset.height,
      byteSize: asset.byteSize,
    })),
    context: {
      mediaType: 'image',
      platform: input.options.platform,
      placement,
      market: input.options.creativeMarket,
      language: input.options.language,
      count: 1,
      ratio: input.options.ratio,
      resolution: input.options.resolution,
      supportsReference: true,
      supportsBackgroundMask: false,
      imageEditSize: { width: source.width, height: source.height },
      supportsAudio: false,
      supportsText: false,
    },
    strategy: { id: strategy.id, guidance: compileCreativeGuidance(strategy) },
  });
  const result = creativeIntentResultSchema.parse({
    type: 'intent-plan',
    version: 1,
    requestId,
    status: 'ready',
    brief: {
      scope: 'product',
      subject: '原图中已确认的主体与保留区域',
      goal: '按确认蒙版修正背景区域',
      mediaType: 'image',
      platform: input.options.platform,
      placement,
      market: input.options.creativeMarket,
      productMode: 'reference',
      facts: [{ sourceId: 'request', quote: prompt }],
      constraints: [
        '沿用原图尺寸、位置与颜色',
        '仅按本人确认的蒙版替换背景',
        '不调用模型，保留原候选与蒙版',
      ],
    },
    summary: `按已确认区域蒙版将背景合成为${edit.color}，保护区沿用原图像素；本次仅在本机处理，0积分，不调用文本或图片模型。原候选和原始蒙版仍保留。`,
    assumptions: [],
    questions: [],
    prompt,
    imageEdit: edit,
    reviewChecklist: ['核对背景范围与软边', '核对主体、台面及接触阴影完整保留'],
  });
  const issue = validateNativeImageEdit(result, request);
  if (issue) throw new AppError(409, issue.code, '背景修正的原图、颜色或区域不匹配。');
  return s.transaction(() => {
    const previous = s.db.sqlite
      .prepare('SELECT * FROM creative_briefs WHERE workspace_id=? AND user_id=? AND request_id=?')
      .get(wid, actor.userId, requestId) as BriefRow | undefined;
    if (previous) {
      const oldRequest = creativeIntentRequestSchema.parse(JSON.parse(previous.request_json));
      if (
        previous.input_fingerprint !== fingerprint ||
        !oldRequest.sourceTexts.some(
          (source) => source.id === 'background-review' && source.text === lineage,
        )
      )
        throw new AppError(
          409,
          'CREATIVE_REQUEST_CHANGED',
          '同一修正确认编号不能更换蒙版或来源任务。',
        );
      return dto(previous);
    }
    const id = randomUUID(),
      at = new Date().toISOString();
    s.db.sqlite
      .prepare(
        `INSERT INTO creative_briefs(id,workspace_id,user_id,request_id,previous_id,input_fingerprint,input_json,request_json,state,result_json,compiled_prompt,strategy_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        wid,
        actor.userId,
        requestId,
        null,
        fingerprint,
        JSON.stringify(input),
        JSON.stringify(request),
        'ready',
        JSON.stringify(result),
        prompt,
        JSON.stringify(strategy),
        at,
        at,
      );
    s.core.context.audit(actor, wid, 'background-region.confirm', 'job-item', item.id, {
      creativeBriefId: id,
      maskAssetId: mask.id,
      sourceAssetId: source.id,
      color: edit.color,
    });
    return dto(owned(s.db, actor, wid, id));
  });
}

export function createCreativeBriefServices(
  s: TaskServices,
  options: {
    nativePlannerObserver?: NativePlannerObserver;
    nativeReferenceObserver?: NativePlannerObserver;
    nativeBackgroundObserver?: NativePlannerObserver;
  } = {},
) {
  const sql = s.db.sqlite;
  function checkNativePlanningBudget(
    actor: Actor,
    wid: string,
    input: JobInput,
    request: CreativeIntentRequest,
  ) {
    if (input.providerId !== 'native') return;
    const capability = s.settings.validateCapability(wid, input);
    const estimate = estimateCreationCredits(input, capability);
    if (estimate.status !== 'ready')
      throw new AppError(
        409,
        'NATIVE_ESTIMATE_UNAVAILABLE',
        '暂时无法确定生成额度，请重新确认模型与参数。',
      );
    // The planner has not chosen a path yet. A verified original allows the lower-cost
    // video-only path; do not require its optional image charge before planning can choose it.
    // This is an eligibility floor, never a payable quote or a client-selected discount.
    const hasOriginalCandidate =
      input.operation === 'video.generate' &&
      request.materials.some((material) => {
        if (material.kind !== 'image' || !['input', 'reference'].includes(material.role))
          return false;
        const asset = s.core.assets.get(actor, wid, material.id);
        return asset.kind === 'image' && !nativeReferenceFrameIssue(asset, input.options.ratio);
      });
    const hasLocalMaskCandidate = (() => {
      if (
        input.operation !== 'image.generate' ||
        !input.maskAssetId ||
        !explicitNativeBackgroundColor(input.prompt)
      )
        return false;
      const originals = request.materials.filter(
        (item) => item.kind === 'image' && ['input', 'reference'].includes(item.role),
      );
      if (originals.length !== 1) return false;
      const source = s.core.assets.get(actor, wid, originals[0]!.id);
      const mask = s.core.assets.get(actor, wid, input.maskAssetId);
      const connection = s.settings.connections.runtime(wid, 'image')!;
      const size = nativeImageSpecification(input, connection.protocol);
      return (
        source.width === size.width &&
        source.height === size.height &&
        mask.kind === 'image' &&
        mask.mimeType === 'image/png' &&
        mask.width === source.width &&
        mask.height === source.height
      );
    })();
    const requiredCredits =
      hasLocalMaskCandidate || (hasOriginalCandidate && canPlanExactPan(request))
        ? 0
        : hasOriginalCandidate
          ? estimate.credits - estimate.outputs * (capability.fixedCredits ?? 0)
          : estimate.credits;
    const channel = channelForActor(actor);
    const account = s.credits.forChannel(channel).account(wid);
    const review = sql
      .prepare(
        'SELECT payment_review_required FROM credit_accounts WHERE workspace_id=? AND billing_channel=?',
      )
      .get(wid, channel) as { payment_review_required: number } | undefined;
    if (review?.payment_review_required)
      throw new AppError(
        409,
        'PAYMENT_REVIEW_REQUIRED',
        '此空间有退款或争议待核对，已暂停新的需求规划。',
      );
    if (account.balance - account.reserved < requiredCredits)
      throw new AppError(
        409,
        'INSUFFICIENT_CREDITS',
        hasOriginalCandidate
          ? `可用额度不足，本次媒体生成至少需要${requiredCredits}平台积分；若方案需要新首帧，最终报价会增加。请先补足额度，尚未调用文本模型。`
          : `可用额度不足，本次媒体生成预计需要${requiredCredits}平台积分；请先补足额度，尚未调用文本模型。`,
      );
    if (channel === 'web') {
      const budget = sql
        .prepare(
          'SELECT credit_limit,spent,reserved FROM member_budgets WHERE workspace_id=? AND user_id=? AND billing_channel=?',
        )
        .get(wid, actor.userId, channel) as
        { credit_limit: number | null; spent: number; reserved: number } | undefined;
      const mode = sql
        .prepare('SELECT credit_mode FROM workspace_billing WHERE workspace_id=?')
        .get(wid) as { credit_mode: string } | undefined;
      if (requiredCredits > 0 && mode?.credit_mode === 'allocated' && budget?.credit_limit == null)
        throw new AppError(
          409,
          'BUDGET_NOT_ALLOCATED',
          '请管理员先分配成员额度，尚未调用文本模型。',
        );
      if (
        budget?.credit_limit != null &&
        budget.spent + budget.reserved + requiredCredits > budget.credit_limit
      )
        throw new AppError(
          409,
          'MEMBER_BUDGET_EXCEEDED',
          '本次生成超出成员额度上限，尚未调用文本模型。',
        );
    }
    // This is a preflight, not a reservation. Submission still atomically checks concurrent spending.
  }
  function supportsReference(
    wid: string,
    input: JobInput,
    materials: CreativeIntentRequest['materials'],
  ): boolean {
    const capability = s.settings
      .capabilities(wid)
      .operations.find(
        (item) => item.providerId === input.providerId && item.id === input.operation,
      );
    const model = input.options.model
      ? capability?.models.find((item) => item.id === input.options.model)
      : capability?.models[0];
    if (!capability?.available || capability.inputMode === 'text-only' || !model) return false;
    const visual = materials.filter((item) => ['input', 'reference'].includes(item.role));
    if (input.providerId === 'native')
      return input.replica
        ? Boolean(capability.replicaAvailable)
        : visual.length <= 4 && visual.every((item) => item.kind === 'image');
    if (input.providerId === 'openai' && input.operation === 'image.generate') {
      // Documents become planner sources, while only actual images reach the image adapter.
      if (visual.some((item) => !['image', 'document'].includes(item.kind))) return false;
      if (s.config.imageGateway && (input.brandId || input.characterId)) return false;
      const limit = s.config.imageGateway?.model === 'doubao-seedream-5.0-lite' ? 4 : 16;
      return visual.filter((item) => item.kind === 'image').length <= limit;
    }
    if (input.providerId !== 'fal' || input.operation !== 'video.generate') return false;
    const referenceIds = new Set([
      ...input.referenceAssetIds,
      ...visual.filter((item) => item.role === 'reference').map((item) => item.id),
    ]);
    const isImage = (id: string) => visual.some((item) => item.id === id && item.kind === 'image');
    if (model.id === 'wan-2.6')
      return (
        input.options.referenceMode !== 'first-last' &&
        input.assetIds.length <= 1 &&
        referenceIds.size === 0 &&
        input.assetIds.every(isImage)
      );
    if (!isFalReferenceModel(model.id)) return false;
    const firstLast = input.options.referenceMode === 'first-last';
    if (model.id === 'kling-o1-first-last' && !firstLast) return false;
    if (model.id === 'kling-o1-reference' && firstLast) return false;
    if (firstLast) {
      // No image yet remains a supported capability, so the planner can ask for the frames.
      if (input.assetIds.length && (input.assetIds.length !== 2 || !input.assetIds.every(isImage)))
        return false;
      if (model.id === 'kling-o1-first-last' && referenceIds.size) return false;
    }
    const references = firstLast ? [...referenceIds] : [...input.assetIds, ...referenceIds];
    if (references.length > 7) return false;
    const selected = references.map((id) => visual.find((item) => item.id === id));
    return (
      selected.every(
        (item) =>
          item?.kind === 'image' ||
          (model.id === 'kling-o3-4k-reference' && item?.kind === 'video'),
      ) && selected.filter((item) => item?.kind === 'video').length <= 1
    );
  }
  async function prepare(actor: Actor, wid: string, raw: unknown): Promise<CreativePreparation> {
    s.core.requireAccess(actor, wid, 'write');
    const body = creativePrepareSchema.parse(raw);
    const input = body.input;
    validateCreativeKnowledgeInput(actor, input);
    delete input.creativeBriefId;
    delete input.nativePlan;
    delete input.imageEdit;
    delete input.nativeRevision;
    delete input.nativeReplica;
    if (!['image.generate', 'video.generate'].includes(input.operation))
      throw new AppError(400, 'CREATIVE_OPERATION_UNSUPPORTED', '需求整理用于图片与视频创作');
    if (!input.prompt.trim()) throw new AppError(400, 'PROMPT_REQUIRED', '请描述你想制作的内容');
    const duplicate = sql
      .prepare('SELECT * FROM creative_briefs WHERE workspace_id=? AND user_id=? AND request_id=?')
      .get(wid, actor.userId, body.requestId) as BriefRow | undefined;
    const prior = body.previousId ? owned(s.db, actor, wid, body.previousId) : undefined;
    if (input.providerId === 'native') {
      const previous = duplicate ?? prior;
      const frozen = previous
        ? creativeIntentRequestSchema.parse(JSON.parse(previous.request_json))
        : undefined;
      const validationInput = frozen
        ? {
            ...input,
            brandId: undefined,
            referenceAssetIds: [
              ...new Set([
                ...input.referenceAssetIds,
                ...frozen.materials
                  .filter((material) => material.role === 'reference' && material.kind === 'image')
                  .map((material) => material.id),
              ]),
            ],
          }
        : input;
      s.validate(actor, wid, validationInput);
      input.nativeRevision = s.settings.connections.revision(wid, input.operation);
    }
    if (input.projectId) s.core.projects.get(actor, wid, input.projectId);
    const fingerprint = creativeInputFingerprint(input);
    if (duplicate) {
      const original = jobInputSchema.parse(JSON.parse(duplicate.input_json));
      if (input.providerId === 'native' && original.nativeRevision !== input.nativeRevision)
        throw new AppError(
          409,
          'CREATIVE_CONFIGURATION_CHANGED',
          '模型配置已改变，请重新整理创作方案。',
        );
      if (original.projectId && original.projectId !== input.projectId)
        throw new AppError(409, 'CREATIVE_PROJECT_CHANGED', '创作项目已变更，请重新整理需求');
      const oldRequest = creativeIntentRequestSchema.parse(JSON.parse(duplicate.request_json));
      const precedingCount = duplicate.previous_id
        ? creativeIntentRequestSchema.parse(
            JSON.parse(owned(s.db, actor, wid, duplicate.previous_id).request_json),
          ).answers.length
        : 0;
      const tail = oldRequest.answers.slice(precedingCount);
      if (
        duplicate.input_fingerprint !== fingerprint ||
        duplicate.previous_id !== (body.previousId ?? null) ||
        JSON.stringify(tail) !== JSON.stringify(body.answers)
      )
        throw new AppError(
          409,
          'CREATIVE_REQUEST_CHANGED',
          '本次请求编号已用于其他需求，请重新整理',
        );
      return dto(duplicate);
    }
    if (prior && prior.input_fingerprint !== fingerprint)
      throw new AppError(409, 'CREATIVE_BRIEF_CHANGED', '原始需求已变更，请重新整理');
    if (prior) {
      const original = jobInputSchema.parse(JSON.parse(prior.input_json));
      if (input.providerId === 'native' && original.nativeRevision !== input.nativeRevision)
        throw new AppError(
          409,
          'CREATIVE_CONFIGURATION_CHANGED',
          '模型配置已改变，请重新整理创作方案。',
        );
      if (original.projectId && original.projectId !== input.projectId)
        throw new AppError(409, 'CREATIVE_PROJECT_CHANGED', '创作项目已变更，请重新整理需求');
    }
    const priorDto = prior ? dto(prior) : undefined;
    if (priorDto?.status === 'ready' && !body.answers.length) return priorDto;
    if (body.answers.length && !priorDto)
      throw new AppError(400, 'CREATIVE_ANSWER_ORPHAN', '补充回答缺少对应的问题');
    if (
      new Set(body.answers.map((a) => a.questionId)).size !== body.answers.length ||
      body.answers.some((a) => !priorDto?.result.questions.some((q) => q.id === a.questionId))
    )
      throw new AppError(400, 'CREATIVE_ANSWER_INVALID', '补充回答与当前问题不一致');
    const oldRequest = prior
      ? creativeIntentRequestSchema.parse(JSON.parse(prior.request_json))
      : undefined;
    const answers = [...(oldRequest?.answers ?? []), ...body.answers];
    if (answers.length > 12)
      throw new AppError(400, 'CREATIVE_CONTEXT_LIMIT', '补充内容过多，请将已确认需求整理到输入框');
    if (
      input.providerId === 'native' &&
      input.operation === 'image.generate' &&
      !input.replica &&
      explicitNativeBackgroundColor(answers.at(-1)?.answer ?? input.prompt)
    ) {
      await probeLocalMatting(s.config.localMatting);
      const sourceId = [...input.assetIds, ...input.referenceAssetIds][0];
      if (sourceId) {
        const asset = s.core.assets.get(actor, wid, sourceId);
        const original = await s.core.assets.readOriginal(actor, wid, sourceId);
        if (asset.width && asset.height)
          await canonicalLocalMattingSource(original.buffer, asset.width, asset.height);
      }
    }
    // Follow-up answers refine an immutable evidence set. Updated library records or
    // memory are picked up by a new preparation, never halfway through clarification.
    const knowledge = oldRequest ? undefined : resolveCreativeKnowledge(s.core, actor, wid, input);
    const materials: CreativeIntentRequest['materials'] = oldRequest
      ? structuredClone(oldRequest.materials)
      : [];
    const sources: CreativeIntentRequest['sourceTexts'] = oldRequest
      ? oldRequest.sourceTexts.filter((source) => !source.id.startsWith('answer:'))
      : [];
    const memoryContext = oldRequest?.memoryContext ?? knowledge?.memoryContext;
    const contextSources = oldRequest?.contextSources ?? knowledge?.contextSources;
    if (oldRequest) {
      // Recheck access to the exact frozen attachments without refreshing their text.
      for (const material of materials) s.core.assets.get(actor, wid, material.id);
    } else if (knowledge) {
      sources.push({ id: 'request', text: input.prompt });
      if (input.referenceText) sources.push({ id: 'reference-text', text: input.referenceText });
      if (input.options.sellingPoints)
        sources.push({ id: 'option:selling-points', text: input.options.sellingPoints });
      if (input.options.price) sources.push({ id: 'option:price', text: input.options.price });
      if (input.options.colors?.length)
        sources.push({ id: 'option:colors', text: JSON.stringify(input.options.colors) });
      if (input.options.textReplacements?.length)
        sources.push({
          id: 'option:text-replacements',
          text: JSON.stringify(input.options.textReplacements),
        });
      // A project may contain unrelated products and references. Its message feed is
      // not evidence for this request. Explicit follow-ups already retain their
      // owned brief, answers and summary; additional source text must be attached.
      const ids = new Map<string, CreativeIntentRequest['materials'][number]['role']>();
      input.assetIds.forEach((id) => ids.set(id, 'input'));
      input.referenceAssetIds.forEach((id) => ids.set(id, 'reference'));
      if (input.backgroundAssetId) ids.set(input.backgroundAssetId, 'background');
      if (input.backgroundAudioAssetId) ids.set(input.backgroundAudioAssetId, 'audio');
      if (input.maskAssetId) ids.set(input.maskAssetId, 'mask');
      sources.push(...knowledge.sourceTexts);
      knowledge.referenceAssetIds.forEach((id) => {
        if (!ids.has(id)) ids.set(id, 'reference');
      });
      if (input.characterId) {
        const character = s.core.identity.assertCanReference(actor, wid, input.characterId);
        character.referenceAssetIds.forEach((id) => ids.set(id, 'reference'));
      }
      for (const [id, role] of ids) {
        const asset = s.core.assets.get(actor, wid, id);
        materials.push({
          id,
          name: asset.name.slice(0, 300),
          kind: asset.kind,
          role,
          ...(asset.kind === 'image' && asset.width && asset.height
            ? { width: asset.width, height: asset.height, byteSize: asset.byteSize }
            : {}),
        });
        if (asset.kind === 'document') {
          const document = s.core.assets.text(actor, wid, id);
          if (document.extractionStatus !== 'ready' || !document.extractedText)
            throw new AppError(409, 'DOCUMENT_NOT_READY', '商品资料还未解析完成，请稍后重试');
          sources.push({ id: `document:${id}`, text: document.extractedText });
        }
      }
    }
    if (
      input.providerId === 'native' &&
      !input.replica &&
      (materials.length > 4 || materials.some((material) => material.kind !== 'image'))
    )
      throw new AppError(
        400,
        'NATIVE_REFERENCE_UNSUPPORTED',
        '原生创作最多接受四张图片参考，请移除不支持的素材。',
      );
    answers.forEach((answer, index) =>
      sources.push({ id: `answer:${index}`, text: answer.answer }),
    );
    if (input.includeProductImages && knowledge?.referenceAssetIds.length) {
      // Library images must pass the selected provider's actual limits before a text call.
      s.validate(actor, wid, {
        ...input,
        referenceAssetIds: [
          ...new Set([
            ...input.referenceAssetIds,
            ...materials
              .filter((material) => material.role === 'reference' && material.kind === 'image')
              .map((material) => material.id),
          ]),
        ],
      });
    }
    if (sources.reduce((sum, source) => sum + source.text.length, 0) > 30000 || sources.length > 16)
      throw new AppError(
        400,
        'CREATIVE_CONTEXT_LIMIT',
        '资料超过本次整理范围，请精简内容；原文不会被静默截断',
      );
    const mediaType = input.operation === 'video.generate' ? 'video' : 'image';
    const placement = resolveCreativePlacement({
      mediaType,
      kind: input.options.kind,
      placement: input.options.creativePlacement,
    });
    const strategy = resolveCreativeStrategy({
      platform: input.options.platform,
      placement,
      market: input.options.creativeMarket,
      mediaType,
    });
    const request = creativeIntentRequestSchema.parse({
      version: 1,
      requestId: body.requestId,
      rawPrompt: input.prompt,
      sourceTexts: sources,
      previousSummary: priorDto?.result.summary,
      answers,
      materials,
      context: {
        mediaType,
        platform: input.options.platform,
        placement,
        market: input.options.creativeMarket,
        language: input.options.language,
        count: input.options.count,
        ratio: input.options.ratio,
        resolution: input.options.resolution,
        duration: mediaType === 'video' ? input.options.duration : undefined,
        supportsReference: supportsReference(wid, input, materials),
        ...(input.providerId === 'native' && mediaType === 'video'
          ? {
              supportsMotionEndpoints:
                !input.replica &&
                supportsNativeMotionEndpoints(
                  s.settings.connections.runtime(wid, 'video')?.model ?? '',
                ),
              ...(() => {
                const size = expectedNativeVideoSize(input);
                return size ? { videoOutputSize: { width: size[0], height: size[1] } } : {};
              })(),
            }
          : {}),
        ...(input.providerId === 'native' && mediaType === 'image'
          ? (() => {
              const image = s.settings.connections.runtime(wid, 'image')!;
              const size = nativeImageSpecification(input, image.protocol);
              return {
                supportsBackgroundMask:
                  !input.replica &&
                  image.protocol === 'seedream-images' &&
                  isKnownSeedreamModel(image.model),
                imageEditSize: { width: size.width, height: size.height },
              };
            })()
          : {}),
        supportsAudio: input.options.generateAudio === true,
        supportsText: input.providerId !== 'seedance' && input.options.needText,
      },
      strategy: { id: strategy.id, guidance: compileCreativeGuidance(strategy) },
      ...(memoryContext ? { memoryContext } : {}),
      ...(contextSources?.length ? { contextSources } : {}),
    });
    if (JSON.stringify(request).length > 120000)
      throw new AppError(400, 'CREATIVE_CONTEXT_LIMIT', '本次整理内容过长，请精简资料');
    assertCreativeKnowledgeFresh(request);
    checkNativePlanningBudget(actor, wid, input, request);
    const nativeText = s.settings.connections.runtime(wid, 'text');
    if (input.replica && (!nativeText?.visionModel || s.config.demoMode))
      throw new AppError(
        409,
        'REPLICA_VISION_REQUIRED',
        '请在文本模型连接中配置视觉分析模型，再分析参考作品。',
      );
    const secret = s.settings.secret(wid, 'dify');
    if (!s.config.demoMode && !nativeText && (input.providerId === 'native' || !secret))
      throw new AppError(
        409,
        'CREATIVE_PLANNER_UNAVAILABLE',
        '需求整理服务未连接，请先在设置中连接策划服务',
      );
    // Match the planner actually used below, not just the media adapter selected by the client.
    // A keyed digest also covers environment-provided Dify credentials without retaining them.
    const plannerRevision = createHmac('sha256', s.config.encryptionKey)
      .update(
        JSON.stringify(
          s.config.demoMode
            ? ['demo', 'intent-v1']
            : nativeText
              ? ['native-text', nativeText.revision]
              : ['dify', s.config.dify?.baseUrl ?? 'https://api.dify.ai/v1', secret],
        ),
      )
      .digest('hex');
    const id = randomUUID(),
      at = new Date().toISOString();
    let cachedReplica: CreativeIntentRequest['replica'];
    let cachedBackgroundPlan: z.infer<typeof creativeIntentResultSchema> | undefined;
    const attempts = sql
      .prepare(
        "SELECT * FROM creative_briefs WHERE workspace_id=? AND user_id=? AND input_fingerprint=? AND state IN ('analyzing','uncertain','failed') ORDER BY created_at DESC,id DESC",
      )
      .all(wid, actor.userId, fingerprint) as BriefRow[];
    for (const attempt of attempts) {
      const previousInput = jobInputSchema.parse(JSON.parse(attempt.input_json));
      // Pre-upgrade nonnative attempts did not guard fresh request IDs and have no
      // provable planner identity. Preserve that historical behavior. Native records
      // already carry their connection revision and retain their existing protection.
      if (!attempt.planner_revision && input.providerId !== 'native') continue;
      if (
        (attempt.planner_revision && attempt.planner_revision !== plannerRevision) ||
        previousInput.nativeRevision !== input.nativeRevision ||
        previousInput.projectId !== input.projectId
      )
        continue;
      const previousRequest = creativeIntentRequestSchema.parse(JSON.parse(attempt.request_json));
      const sameStage =
        attempt.previous_id === (body.previousId ?? null) &&
        planningRequestKey(previousRequest) === planningRequestKey(request);
      if (
        sameStage &&
        (attempt.state === 'analyzing' ||
          (attempt.state === 'uncertain' && !isLegacyInvalidPlan(attempt)))
      )
        throw new AppError(
          409,
          'CREATIVE_BRIEF_UNCERTAIN',
          '相同需求仍在分析或结果待核对，已停止重复提交。',
        );
      if (input.replica && !oldRequest?.replica && !cachedReplica && previousInput.nativeReplica) {
        if (JSON.stringify(previousRequest.replica) === JSON.stringify(previousInput.nativeReplica))
          cachedReplica = previousRequest.replica;
      }
      if (
        input.providerId === 'native' &&
        sameStage &&
        !input.replica &&
        !cachedBackgroundPlan &&
        attempt.result_json
      ) {
        const savedPlan = creativeIntentResultSchema.parse(JSON.parse(attempt.result_json));
        if (
          savedPlan.status === 'ready' &&
          savedPlan.imageEdit?.mask.mode === 'generate' &&
          !savedPlan.imageEdit.visualGuidance
        )
          cachedBackgroundPlan = savedPlan;
      }
    }
    sql
      .prepare(
        `INSERT INTO creative_briefs
      (id,workspace_id,user_id,request_id,previous_id,input_fingerprint,input_json,request_json,state,created_at,updated_at,planner_revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        wid,
        actor.userId,
        body.requestId,
        body.previousId ?? null,
        fingerprint,
        JSON.stringify(input),
        JSON.stringify(request),
        'analyzing',
        at,
        at,
        plannerRevision,
      );
    try {
      if (input.replica && nativeText) {
        // A clarification reuses the same owned, immutable analysis; user prose cannot replace it.
        if (oldRequest?.replica || cachedReplica) {
          request.replica = oldRequest?.replica ?? cachedReplica;
          const [reference, subject] = await Promise.all([
            s.core.assets.readOriginal(actor, wid, input.replica.referenceAssetId),
            s.core.assets.readOriginal(actor, wid, input.replica.subjectAssetId),
          ]);
          const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
          if (
            hash(reference.buffer) !== request.replica!.evidence.referenceSha256 ||
            hash(subject.buffer) !== request.replica!.evidence.subjectSha256
          )
            throw new AppError(
              409,
              'REPLICA_SOURCE_CHANGED',
              '原始素材与已保存分析不一致，已停止复用和模型调用。',
            );
        } else {
          const [reference, subject] = await Promise.all([
            s.core.assets.readOriginal(actor, wid, input.replica.referenceAssetId),
            s.core.assets.readOriginal(actor, wid, input.replica.subjectAssetId),
          ]);
          const media = await prepareNativeReferenceMedia({
            referenceKind: mediaType,
            reference,
            subject,
            ...(mediaType === 'video'
              ? {
                  trimStartSeconds: input.replica.trimStart,
                  trimDurationSeconds: input.replica.trimDuration,
                }
              : {}),
          });
          const analyzed = await analyzeNativeReferenceStudy(
            { prompt: input.prompt, media },
            { ...nativeText, model: nativeText.visionModel! },
            { onResponse: options.nativeReferenceObserver },
          );
          request.replica = {
            version: 1,
            ...(mediaType === 'image' ? { renderStrategy: 'subject-edit-v1' as const } : {}),
            intent: input.replica,
            ...analyzed,
          };
        }
        input.nativeReplica = request.replica;
        // Pin the successfully received visual analysis before the next paid text call.
        sql
          .prepare('UPDATE creative_briefs SET request_json=?,input_json=?,updated_at=? WHERE id=?')
          .run(JSON.stringify(request), JSON.stringify(input), new Date().toISOString(), id);
      }
      if (
        input.providerId === 'native' &&
        input.nativeRevision !== s.settings.connections.revision(wid, input.operation)
      )
        throw new AppError(
          409,
          'CREATIVE_CONFIGURATION_CHANGED',
          '模型配置在参考分析期间改变，尚未继续调用文本模型，请重新整理。',
        );
      const result = creativeIntentResultSchema.parse(
        (cachedBackgroundPlan
          ? { ...cachedBackgroundPlan, requestId: request.requestId }
          : undefined) ??
          (s.config.demoMode
            ? simulateCreativeIntent(request)
            : nativeText
              ? await analyzeNativeIntent(request, nativeText, {
                  onResponse: options.nativePlannerObserver,
                })
              : await analyzeDifyIntent(request, secret!, {
                  baseUrl: s.config.dify?.baseUrl,
                  user: `yingzao_${createHash('sha256').update(`${wid}:${actor.userId}`).digest('hex').slice(0, 48)}`,
                })),
      );
      // A planner response cannot name internal immutable baseline assets.
      if (result.imageEdit) delete result.imageEdit.mattingBaseline;
      validateCreativeIntent(result, request);
      const imageEditIssue = validateNativeImageEdit(result, request);
      if (imageEditIssue)
        throw new AppError(
          400,
          imageEditIssue.code,
          '局部背景方案与已确认原图、颜色或尺寸不匹配，请重新整理。',
        );
      if (
        input.providerId === 'native' &&
        input.nativeRevision !== s.settings.connections.revision(wid, input.operation)
      )
        throw new AppError(
          409,
          'CREATIVE_CONFIGURATION_CHANGED',
          '模型配置在整理期间改变，请重新整理创作方案。',
        );
      const selected = resolveCreativeStrategy({
        platform: result.brief.platform,
        placement: result.brief.placement,
        market: result.brief.market,
        mediaType,
      });
      if (
        input.providerId === 'native' &&
        result.status === 'ready' &&
        result.imageEdit?.mask.mode === 'generate'
      ) {
        // Freeze algorithm selection on new preparations only. Existing tasks keep their version.
        await probeLocalMatting(s.config.localMatting);
        result.imageEdit.mask.calibration = 'local-matting-v2';
        if (nativeText?.visionModel) {
          // Retain the validated text stage before the next paid call. Failed/uncertain
          // rows cannot be quoted; an explicit safe retry can reuse only this stage.
          sql
            .prepare('UPDATE creative_briefs SET result_json=?,updated_at=? WHERE id=?')
            .run(JSON.stringify(result), new Date().toISOString(), id);
          const source = await s.core.assets.readOriginal(
            actor,
            wid,
            result.imageEdit.sourceAssetId,
          );
          const study = await analyzeNativeBackgroundStudy(
            {
              source: { buffer: source.buffer, mimeType: source.mimeType },
              color: result.imageEdit.color,
              regionDescription: result.imageEdit.regionDescription,
              preserveDescription: result.imageEdit.preserveDescription,
            },
            { ...nativeText, model: nativeText.visionModel },
            { onResponse: options.nativeBackgroundObserver },
          );
          try {
            sql
              .prepare('UPDATE creative_briefs SET background_study_json=?,updated_at=? WHERE id=?')
              .run(
                JSON.stringify({
                  version: 1,
                  sourceAssetId: result.imageEdit.sourceAssetId,
                  color: result.imageEdit.color,
                  nativeRevision: input.nativeRevision,
                  study,
                }),
                new Date().toISOString(),
                id,
              );
          } catch {
            // A received paid observation must never become an ordinary retryable failure
            // merely because its evidence could not be saved. No automatic second call.
            throw new ProviderError(
              '背景视觉分析已返回，但观察证据未能保存；请核对本次调用，不会自动重新提交。',
              true,
              'NATIVE_BACKGROUND_EVIDENCE_FAILED',
            );
          }
          result.imageEdit.visualGuidance = {
            boundaryNotes: study.boundaryNotes,
            uncertainties: study.uncertainties,
            evidence: study.evidence,
            ...(study.sceneBoundary ? { sceneBoundary: study.sceneBoundary } : {}),
          };
          if (input.nativeRevision !== s.settings.connections.revision(wid, input.operation))
            throw new AppError(
              409,
              'CREATIVE_CONFIGURATION_CHANGED',
              '模型配置在视觉分析期间改变，请重新整理创作方案。',
            );
          if (study.scopeAmbiguity && study.scopeAmbiguity !== 'none') {
            const surface = study.scopeAmbiguity === 'background-surface-boundary';
            const color = result.imageEdit.color;
            result.status = 'needs_clarification';
            result.summary = surface
              ? '原图的背景与要求保留的地面没有可辨认分界。请先明确编辑范围，避免自动添加错误的水平线；尚未生成蒙版或扣除生图积分。'
              : '视觉分析无法将要求改色的区域与原图可靠对应。请先明确实际编辑区域；尚未生成蒙版或扣除生图积分。';
            result.prompt = '';
            delete result.imageEdit;
            delete result.generationPlan;
            result.questions = [
              {
                id: 'background_boundary',
                field: 'reference',
                question: surface
                  ? '背景与地面分界不清：是否一起换色，还是保留地面并换用分界清楚的原图？'
                  : '原图中具体哪部分需要换色？请说明可辨认的区域，或更换参考图。',
                reason: '自动分割不能从不明确的范围中猜出新的编辑授权。',
                options: surface
                  ? [
                      `仅把背景和地面一并改为${color}，保留主体与接触阴影。`,
                      '保留地面，换用背景与地面分界清楚的原图。',
                    ]
                  : [],
              },
            ];
            creativeIntentResultSchema.parse(result);
          }
        }
      }
      let prompt = compileCapturePrompt(result, request, selected, input.options.needText);
      if (request.replica && result.status === 'ready') {
        if (
          result.imageEdit ||
          result.generationPlan?.cameraControl ||
          result.generationPlan?.firstFrame?.mode === 'reference'
        )
          throw new AppError(
            400,
            'REPLICA_PLAN_CONFLICT',
            '复刻方案应生成自己的主体场景，不能改为局部背景替换或直接沿用参考作品。',
          );
        if (mediaType === 'image')
          prompt = replicaImagePrompt(prompt ?? result.prompt, request.replica);
      }
      if (prompt && prompt.length > 11000)
        throw new AppError(400, 'CREATIVE_PROMPT_LIMIT', '整理后的画面说明过长，请精简需求');
      if (
        input.providerId === 'native' &&
        input.operation === 'video.generate' &&
        result.status === 'ready'
      ) {
        const nativePlan = compileNativeVideoPlan(result, request);
        if (
          !nativePlan ||
          nativePlan.imagePrompt.length > 11000 ||
          nativePlan.videoPrompt.length > 11000
        )
          throw new AppError(
            409,
            'NATIVE_VIDEO_PLAN_INVALID',
            '视频方案不完整或过长，请重新整理。',
          );
        input.nativePlan = nativePlan;
        if (request.replica) {
          input.nativePlan.imagePrompt = replicaImagePrompt(
            nativePlan.imagePrompt,
            request.replica,
          );
          input.nativePlan.videoPrompt = `${result.generationPlan!.videoPrompt}\n\n首帧已经由自己的主体与参考画面重新生成。保持首帧主体身份、结构与材质，按已确认的动作和镜头方案连续运动。参考视频只经过有限抽帧分析，未直接作为视频模型输入；不添加参考作品的品牌、人物或文字，不混入未经确认的运动。`;
          input.nativePlan.firstFrame = { mode: 'generate' };
        }
      }
      if (
        input.providerId === 'native' &&
        input.operation === 'image.generate' &&
        result.status === 'ready' &&
        result.imageEdit
      )
        input.imageEdit = result.imageEdit;
      sql
        .prepare(
          'UPDATE creative_briefs SET state=?,result_json=?,compiled_prompt=?,strategy_json=?,input_json=?,updated_at=? WHERE id=?',
        )
        .run(
          result.status,
          JSON.stringify(result),
          prompt,
          JSON.stringify(selected),
          JSON.stringify(input),
          new Date().toISOString(),
          id,
        );
      return dto(owned(s.db, actor, wid, id));
    } catch (error) {
      const message =
        error instanceof ProviderError
          ? error.message
          : error instanceof AppError
            ? error.message
            : '需求整理结果未通过校验，请重试或简化描述；尚未提交图片或视频生成。';
      sql
        .prepare('UPDATE creative_briefs SET state=?,error_message=?,updated_at=? WHERE id=?')
        .run(
          error instanceof ProviderError && error.ambiguous ? 'uncertain' : 'failed',
          message,
          new Date().toISOString(),
          id,
        );
      throw new AppError(
        502,
        error instanceof ProviderError && error.ambiguous
          ? 'CREATIVE_BRIEF_UNCERTAIN'
          : 'CREATIVE_BRIEF_FAILED',
        message,
      );
    }
  }
  return {
    prepare,
    get(actor: Actor, wid: string, id: string) {
      s.core.requireAccess(actor, wid, 'read');
      const row = owned(s.db, actor, wid, id);
      const input = jobInputSchema.parse(JSON.parse(row.input_json));
      if (
        input.providerId === 'native' &&
        input.nativeRevision !== modelConnectionsRevision(s.db, wid, input.operation)
      )
        throw new AppError(
          409,
          'CREATIVE_CONFIGURATION_CHANGED',
          '模型配置已改变，请重新整理创作方案。',
        );
      return dto(row);
    },
  };
}

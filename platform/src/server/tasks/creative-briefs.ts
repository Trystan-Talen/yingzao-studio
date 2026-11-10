import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../../contracts/core';
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
import { ProviderError } from './types';
import type { TaskServices } from './service';
import { simulateCreativeIntent } from './creative-intent-simulation';
import { isFalReferenceModel } from '../providers/fal-reference';
import { compileCapturePrompt } from './creative-capture';

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
}
function owned(db: DatabaseContext, actor: Actor, wid: string, id: string): BriefRow {
  const row = db.sqlite
    .prepare('SELECT * FROM creative_briefs WHERE id=? AND workspace_id=? AND user_id=?')
    .get(id, wid, actor.userId) as BriefRow | undefined;
  if (!row) throw new AppError(404, 'CREATIVE_BRIEF_NOT_FOUND', '未找到这次创作需求，请重新整理');
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
  if (original.projectId && original.projectId !== input.projectId)
    throw new AppError(409, 'CREATIVE_PROJECT_CHANGED', '创作项目已变更，请重新整理需求');
  if (row.input_fingerprint !== creativeInputFingerprint(input))
    throw new AppError(409, 'CREATIVE_BRIEF_CHANGED', '需求或素材已修改，请重新整理后生成');
  if (row.state !== 'ready' || !row.compiled_prompt)
    throw new AppError(409, 'CREATIVE_BRIEF_NOT_READY', '请先补充影响生成结果的必要信息');
  return row.compiled_prompt;
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
function dto(row: BriefRow): CreativePreparation {
  if (row.state === 'analyzing')
    throw new AppError(409, 'CREATIVE_BRIEF_ANALYZING', '需求仍在整理，请稍后查看；不会重复提交');
  if (row.state === 'uncertain')
    throw new AppError(
      409,
      'CREATIVE_BRIEF_UNCERTAIN',
      row.error_message || '需求整理结果待核对，不会自动重复调用',
    );
  if (row.state === 'failed' || !row.result_json)
    throw new AppError(
      409,
      'CREATIVE_BRIEF_FAILED',
      row.error_message || '本次需求整理未完成，可重新检查',
    );
  const result = creativeIntentResultSchema.parse(JSON.parse(row.result_json));
  return {
    id: row.id,
    status: result.status,
    result,
    input: { ...jobInputSchema.parse(JSON.parse(row.input_json)), creativeBriefId: row.id },
  };
}
export function createCreativeBriefServices(s: TaskServices) {
  const sql = s.db.sqlite;
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
    delete input.creativeBriefId;
    if (!['image.generate', 'video.generate'].includes(input.operation))
      throw new AppError(400, 'CREATIVE_OPERATION_UNSUPPORTED', '需求整理用于图片与视频创作');
    if (!input.prompt.trim()) throw new AppError(400, 'PROMPT_REQUIRED', '请描述你想制作的内容');
    if (input.projectId) s.core.projects.get(actor, wid, input.projectId);
    const fingerprint = creativeInputFingerprint(input);
    const duplicate = sql
      .prepare('SELECT * FROM creative_briefs WHERE workspace_id=? AND user_id=? AND request_id=?')
      .get(wid, actor.userId, body.requestId) as BriefRow | undefined;
    if (duplicate) {
      const original = jobInputSchema.parse(JSON.parse(duplicate.input_json));
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
    const prior = body.previousId ? owned(s.db, actor, wid, body.previousId) : undefined;
    if (prior && prior.input_fingerprint !== fingerprint)
      throw new AppError(409, 'CREATIVE_BRIEF_CHANGED', '原始需求已变更，请重新整理');
    if (prior) {
      const original = jobInputSchema.parse(JSON.parse(prior.input_json));
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
    const materials: CreativeIntentRequest['materials'] = [];
    const sources: CreativeIntentRequest['sourceTexts'] = [{ id: 'request', text: input.prompt }];
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
    if (input.projectId) {
      const messages = sql
        .prepare(
          "SELECT content FROM messages WHERE project_id=? AND workspace_id=? AND role='user' ORDER BY created_at DESC,rowid DESC LIMIT 6",
        )
        .all(input.projectId, wid) as { content: string }[];
      const recent: string[] = [];
      for (const message of messages) {
        if (recent.join('\n').length + message.content.length > 5000) break;
        if (message.content !== input.prompt) recent.unshift(message.content);
      }
      if (recent.length) sources.push({ id: 'recent-user-context', text: recent.join('\n') });
    }
    const ids = new Map<string, CreativeIntentRequest['materials'][number]['role']>();
    input.assetIds.forEach((id) => ids.set(id, 'input'));
    input.referenceAssetIds.forEach((id) => ids.set(id, 'reference'));
    if (input.backgroundAssetId) ids.set(input.backgroundAssetId, 'background');
    if (input.backgroundAudioAssetId) ids.set(input.backgroundAudioAssetId, 'audio');
    if (input.brandId) {
      const brand = s.core.brands.get(actor, wid, input.brandId);
      brand.referenceAssetIds.forEach((id) => ids.set(id, 'reference'));
      sources.push({
        id: 'brand',
        text: `${brand.name}\n${brand.description}\n品牌配色：${brand.colors.join('、')}\n品牌字体：${brand.fonts.join('、')}`,
      });
    }
    if (input.characterId) {
      const character = s.core.identity.assertCanReference(actor, wid, input.characterId);
      character.referenceAssetIds.forEach((id) => ids.set(id, 'reference'));
    }
    for (const [id, role] of ids) {
      const asset = s.core.assets.get(actor, wid, id);
      materials.push({ id, name: asset.name.slice(0, 300), kind: asset.kind, role });
      if (asset.kind === 'document') {
        const document = s.core.assets.text(actor, wid, id);
        if (document.extractionStatus !== 'ready' || !document.extractedText)
          throw new AppError(409, 'DOCUMENT_NOT_READY', '商品资料还未解析完成，请稍后重试');
        sources.push({ id: `document:${id}`, text: document.extractedText });
      }
    }
    answers.forEach((answer, index) =>
      sources.push({ id: `answer:${index}`, text: answer.answer }),
    );
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
        supportsAudio: input.options.generateAudio === true,
        supportsText: input.providerId !== 'seedance' && input.options.needText,
      },
      strategy: { id: strategy.id, guidance: compileCreativeGuidance(strategy) },
    });
    if (JSON.stringify(request).length > 120000)
      throw new AppError(400, 'CREATIVE_CONTEXT_LIMIT', '本次整理内容过长，请精简资料');
    const secret = s.settings.secret(wid, 'dify');
    if (!s.config.demoMode && !secret)
      throw new AppError(
        409,
        'CREATIVE_PLANNER_UNAVAILABLE',
        '需求整理服务未连接，请先在设置中连接策划服务',
      );
    const id = randomUUID(),
      at = new Date().toISOString();
    sql
      .prepare(
        `INSERT INTO creative_briefs
      (id,workspace_id,user_id,request_id,previous_id,input_fingerprint,input_json,request_json,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
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
      );
    try {
      const result = creativeIntentResultSchema.parse(
        s.config.demoMode
          ? simulateCreativeIntent(request)
          : await analyzeDifyIntent(request, secret!, {
              baseUrl: s.config.dify?.baseUrl,
              user: `yingzao_${createHash('sha256').update(`${wid}:${actor.userId}`).digest('hex').slice(0, 48)}`,
            }),
      );
      validateCreativeIntent(result, request);
      const selected = resolveCreativeStrategy({
        platform: result.brief.platform,
        placement: result.brief.placement,
        market: result.brief.market,
        mediaType,
      });
      const prompt = compileCapturePrompt(result, request, selected, input.options.needText);
      if (prompt && prompt.length > 11000)
        throw new AppError(400, 'CREATIVE_PROMPT_LIMIT', '整理后的画面说明过长，请精简需求');
      sql
        .prepare(
          'UPDATE creative_briefs SET state=?,result_json=?,compiled_prompt=?,strategy_json=?,updated_at=? WHERE id=?',
        )
        .run(
          result.status,
          JSON.stringify(result),
          prompt,
          JSON.stringify(selected),
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
      return dto(owned(s.db, actor, wid, id));
    },
  };
}

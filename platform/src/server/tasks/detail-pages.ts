import { createHash } from 'node:crypto';
import type { Actor, AssetDto } from '../../contracts/core';
import { jobInputSchema, type JobInput, type JobItemDto } from '../../contracts/jobs';
import {
  detailPageBriefSchema,
  detailPageConfirmationSchema,
  detailPagePlanResultSchema,
  type DetailPageConfirmation,
} from '../../contracts/detail-page';
import { AppError } from '../errors';
import type { TaskServices } from './service';
import type { ItemRow } from './types';
import { canonical, checkScope } from './validation';

const model = 'doubao-seedream-5.0-lite';
function designId(screenId: string): string {
  const hash = createHash('sha256').update(`detail-page:${screenId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** One quoted item per screen, all with the same original product references. */
export function buildDetailPageInput(confirmation: DetailPageConfirmation): JobInput {
  const { plan, referenceAssetIds, projectId, planningJobId } = confirmation;
  return jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    capabilityRevision: confirmation.capabilityRevision,
    projectId,
    referenceAssetIds,
    prompt: [
      `为同一商品制作连续的商品详情页，商品名称：${plan.productName}。`,
      `已确认商品事实：\n${plan.productFacts.map((fact) => `- ${fact}`).join('\n')}`,
      `目标人群：${plan.audience}`,
      `整套统一风格：${plan.visualStyle}；固定配色：${plan.palette.join(' / ')}。`,
      `一致性要求：${plan.consistencyNotes}`,
      '每屏都以同一组原始商品参考图为商品外观依据，保留轮廓、颜色、材质、标识和结构；不替换商品，不杜撰参数、认证、销量、功效或承诺。',
      '这一请求只生成指定的一屏，保持整套版式风格与配色一致，不拼成多屏缩略图。文案仅使用本屏已确认文字。',
    ].join('\n\n'),
    options: {
      model,
      kind: 'detail',
      count: 1,
      resolution: confirmation.resolution ?? '2K',
      ratio: plan.screens[0]!.ratio,
      format: 'png',
      needText: plan.screens.some((screen) => screen.copy.length > 0),
      detailPagePlan: plan,
      detailPagePlanningJobId: planningJobId,
      designs: plan.screens.map((screen, index) => ({
        id: designId(screen.id),
        name: screen.title,
        kind: 'detail',
        ratio: screen.ratio,
        assetIds: [],
        prompt: [
          `第 ${index + 1} / ${plan.screens.length} 屏；目的：${screen.purpose}`,
          `已确认文案：${screen.copy.length ? screen.copy.join('；') : '不添加文字'}`,
          `画面说明：${screen.prompt}`,
        ].join('\n'),
      })),
    },
  });
}

/** A plan snapshot must never be decoupled from the prompts/references being charged. */
export function validateDetailPageInput(input: JobInput, references: AssetDto[] = []): void {
  const plan = input.options.detailPagePlan;
  if (!plan) {
    if (input.options.detailPageScreenId || input.options.detailPagePlanningJobId)
      throw new AppError(400, 'DETAIL_PAGE_PLAN_REQUIRED', '详情页屏幕信息缺少已确认方案');
    return;
  }
  const confirmation = detailPageConfirmationSchema.parse({
    plan,
    resolution: input.options.resolution,
    referenceAssetIds: input.referenceAssetIds,
    projectId: input.projectId,
    planningJobId: input.options.detailPagePlanningJobId,
  });
  for (const asset of references) {
    const width = asset.width || 0;
    const height = asset.height || 0;
    if (
      asset.kind !== 'image' ||
      asset.byteSize > 10 * 1024 * 1024 ||
      width <= 14 ||
      height <= 14 ||
      width * height > 36_000_000 ||
      Math.max(width / height, height / width) > 16
    )
      throw new AppError(
        400,
        'DETAIL_PAGE_REFERENCE_LIMIT',
        '商品参考图须不超过10MiB、3600万像素，每边大于14像素，长短边比不超过16',
      );
  }
  const expected = buildDetailPageInput(confirmation);
  const screenId = input.options.detailPageScreenId;
  let prompt = expected.prompt;
  let ratio = expected.options.ratio;
  if (screenId) {
    const index = plan.screens.findIndex((screen) => screen.id === screenId);
    const design = expected.options.designs?.[index];
    if (!design) throw new AppError(400, 'DETAIL_PAGE_SCREEN_INVALID', '详情页屏幕编号不属于方案');
    prompt += `\n本张物料：${design.name}。${design.prompt}`;
    ratio = design.ratio;
  }
  const { designs: _designs, ...singleScreenOptions } = expected.options;
  const expectedOptions = screenId
    ? { ...singleScreenOptions, ratio, detailPageScreenId: screenId }
    : expected.options;
  if (
    input.operation !== expected.operation ||
    input.providerId !== expected.providerId ||
    input.prompt !== prompt ||
    input.options.count !== 1 ||
    input.options.model !== model ||
    input.options.kind !== 'detail' ||
    input.options.ratio !== ratio ||
    input.options.resolution !== expected.options.resolution ||
    input.options.needText !== expected.options.needText ||
    input.options.width !== undefined ||
    input.options.height !== undefined ||
    input.options.format !== 'png' ||
    input.assetIds.length ||
    input.maskAssetId ||
    input.backgroundAssetId ||
    input.backgroundAudioAssetId ||
    input.brandId ||
    input.characterId ||
    input.referenceText ||
    input.conversationContext ||
    canonical(input.options) !== canonical(expectedOptions) ||
    (screenId
      ? input.options.designs !== undefined
      : JSON.stringify(input.options.designs) !== JSON.stringify(expected.options.designs))
  )
    throw new AppError(
      400,
      'DETAIL_PAGE_INPUT_CHANGED',
      '详情页方案与逐屏输入不一致，请重新确认方案并报价',
    );
}

export interface DetailPageScreenStatus {
  screenId: string;
  index: number;
  item: JobItemDto | null;
  jobId: string;
  outputAssets: AssetDto[];
}

export function createDetailPageServices(tasks: TaskServices) {
  function planQuote(actor: Actor, wid: string, raw: unknown) {
    const brief = detailPageBriefSchema.parse(raw);
    const input = jobInputSchema.parse({
      operation: 'text.assist',
      providerId: 'dify',
      capabilityRevision: brief.capabilityRevision,
      prompt: brief.brief,
      projectId: brief.projectId,
      options: {
        ...(brief.capabilityRevision ? { model: 'kimi-k3' } : {}),
        assistantMode: 'detail-page',
        detailPageScreenCount: brief.screenCount,
        ratio: brief.ratio,
        count: 1,
      },
    });
    return { input, quote: tasks.quote(actor, wid, input) };
  }
  function quote(actor: Actor, wid: string, raw: unknown) {
    const confirmation = detailPageConfirmationSchema.parse(raw);
    tasks.core.requireAccess(actor, wid, 'write');
    checkScope(actor, 'jobs:write');
    if (tasks.config.imageGateway?.model !== model)
      throw new AppError(
        503,
        'DETAIL_PAGE_PROVIDER_UNAVAILABLE',
        '整套详情页需要已配置的豆包生图服务',
      );
    for (const id of confirmation.referenceAssetIds) {
      const asset = tasks.core.assets.get(actor, wid, id);
      if (asset.kind !== 'image')
        throw new AppError(400, 'DETAIL_PAGE_IMAGE_REQUIRED', '商品参考素材必须是图片');
    }
    if (confirmation.planningJobId) {
      const planning = tasks.get(actor, wid, confirmation.planningJobId);
      if (
        planning.projectId !== (confirmation.projectId ?? null) ||
        planning.status !== 'succeeded' ||
        !planning.items.some(
          (item) => detailPagePlanResultSchema.safeParse(item.resultData).success,
        )
      )
        throw new AppError(409, 'DETAIL_PAGE_PLAN_NOT_READY', '策划任务尚未完成或不属于当前项目');
    }
    const input = buildDetailPageInput(confirmation);
    return { input, quote: tasks.quote(actor, wid, input) };
  }
  function get(actor: Actor, wid: string, jobId: string) {
    let job = tasks.get(actor, wid, jobId);
    // A retry contains only failed screens; show/export its original complete set.
    const retryRoot = job.items.find((item) => item.retryRootItemId)?.retryRootItemId;
    if (retryRoot) {
      const original = tasks.db.sqlite
        .prepare('SELECT job_id FROM job_items WHERE id=? AND workspace_id=?')
        .get(retryRoot, wid) as { job_id: string } | undefined;
      if (original) job = tasks.get(actor, wid, original.job_id);
    }
    const plan = job.input.options.detailPagePlan;
    if (!plan) throw new AppError(404, 'DETAIL_PAGE_NOT_FOUND', '此任务不是整套详情页');
    const originals = tasks.db.sqlite
      .prepare('SELECT * FROM job_items WHERE job_id=? ORDER BY item_index')
      .all(job.id) as ItemRow[];
    const screens: DetailPageScreenStatus[] = plan.screens.map((screen, index) => {
      const source = originals.find((item) => {
        const input = jobInputSchema.parse(JSON.parse(item.input_json));
        return input.options.detailPageScreenId === screen.id;
      });
      if (!source)
        return { screenId: screen.id, index, item: null, jobId: job.id, outputAssets: [] };
      const candidates = tasks.db.sqlite
        .prepare(
          'SELECT * FROM job_items WHERE workspace_id=? AND (id=? OR retry_root_item_id=?) ORDER BY created_at DESC,rowid DESC',
        )
        .all(
          wid,
          source.retry_root_item_id || source.id,
          source.retry_root_item_id || source.id,
        ) as ItemRow[];
      const chosen =
        candidates.find((item) => item.status === 'succeeded') || candidates[0] || source;
      const currentJob = chosen.job_id === job.id ? job : tasks.get(actor, wid, chosen.job_id);
      const item = currentJob.items.find((item) => item.id === chosen.id)!;
      return {
        screenId: screen.id,
        index,
        item,
        jobId: currentJob.id,
        outputAssets: currentJob.outputAssets.filter((asset) => item.assetIds.includes(asset.id)),
      };
    });
    return {
      job,
      plan,
      screens,
      complete: screens.every(
        (screen) => screen.item?.status === 'succeeded' && screen.outputAssets.length === 1,
      ),
    };
  }
  return { planQuote, quote, get };
}

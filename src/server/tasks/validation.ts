import { createHash } from 'node:crypto';
import type { Actor } from '../../contracts/core';
import { jobInputSchema, type JobInput } from '../../contracts/jobs';
import { TOOLS } from '../../contracts/catalog';
import type { CoreServices } from '../core';
import { AppError } from '../errors';
import type { SettingsService } from './settings';
import { isFalExtraOperation, validateFalExtraOptions } from '../providers/fal-extra';
import { ProviderError } from './types';
import { isFalReferenceModel, validateFalReferenceInput } from '../providers/fal-reference';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const inputHash = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function checkScope(actor: Actor, scope: string) {
  if (actor.authType === 'apiKey' && !actor.scopes.includes(scope))
    throw new AppError(403, 'API_SCOPE_REQUIRED', `此 API 密钥缺少 ${scope} 权限`);
}
export function validateInput(
  core: CoreServices,
  settings: SettingsService,
  actor: Actor,
  wid: string,
  raw: unknown,
): JobInput {
  core.requireAccess(actor, wid, 'write');
  checkScope(actor, 'jobs:write');
  const i = jobInputSchema.parse(raw);
  const o = i.options;
  settings.validateCapability(wid, i);
  if (i.projectId) core.projects.get(actor, wid, i.projectId);
  if (i.documentId) {
    const doc = core.documents.get(actor, wid, i.documentId);
    if (i.projectId && doc.projectId !== i.projectId)
      throw new AppError(400, 'DOCUMENT_MISMATCH', '画布不属于当前项目');
    if (i.baseRevision === undefined)
      throw new AppError(400, 'REVISION_REQUIRED', '画布操作需要当前版本号');
  }
  const assets = [
    ...i.assetIds,
    ...i.referenceAssetIds,
    ...(i.options.designs?.flatMap((design) => design.assetIds) || []),
    ...(i.maskAssetId ? [i.maskAssetId] : []),
  ].map((id) => core.assets.get(actor, wid, id));
  if (i.brandId) {
    const brand = core.brands.get(actor, wid, i.brandId);
    for (const id of brand.referenceAssetIds) core.assets.get(actor, wid, id);
  }
  const tool = TOOLS.find((t) => t.id === i.operation);
  if (i.options.designs?.length && i.operation !== 'image.generate')
    throw new AppError(400, 'DESIGNS_UNSUPPORTED', '分模块设计只适用于图片创作');
  if (i.options.designs?.length)
    for (const part of splitItems(i)) settings.validateCapability(wid, part);
  if (tool && (i.assetIds.length < tool.minInputs || i.assetIds.length > tool.maxInputs))
    throw new AppError(
      400,
      'INPUT_COUNT',
      `${tool.name}需要 ${tool.minInputs}–${tool.maxInputs} 份输入素材`,
    );
  if (i.operation.startsWith('local.') && !i.assetIds.length)
    throw new AppError(400, 'INPUT_REQUIRED', '请先选择输入素材');
  if (['image.ocr', 'image.text-edit', 'image.layers'].includes(i.operation) && !i.assetIds.length)
    throw new AppError(400, 'INPUT_REQUIRED', '请先选择输入图片');
  if (i.operation === 'local.stitch' && i.assetIds.length < 2)
    throw new AppError(400, 'INPUT_COUNT', '长图拼接至少需要两张图片');
  if (['image.generate', 'video.generate', 'text.assist'].includes(i.operation) && !i.prompt.trim())
    throw new AppError(400, 'PROMPT_REQUIRED', '请填写创作需求');
  if (i.providerId === 'openai' && i.assetIds.length + i.referenceAssetIds.length > 16)
    throw new AppError(400, 'INPUT_COUNT', '当前图片服务最多接受16张参考图');
  if (i.providerId === 'fal' && i.operation === 'video.generate' && isFalReferenceModel(o.model)) {
    try {
      validateFalReferenceInput(i, assets);
    } catch (error) {
      if (error instanceof ProviderError)
        throw new AppError(400, 'MODEL_INPUT_INVALID', error.message);
      throw error;
    }
  }
  if (i.providerId === 'fal' && i.operation === 'video.generate' && !isFalReferenceModel(o.model)) {
    if (![5, 10, 15].includes(o.duration))
      throw new AppError(400, 'DURATION_UNSUPPORTED', 'Wan 2.6 支持5、10或15秒');
    if (!['720p', '1080p'].includes(o.resolution.toLowerCase()))
      throw new AppError(400, 'RESOLUTION_UNSUPPORTED', 'Wan 2.6 支持720p或1080p');
    if (i.assetIds.length > 1 || i.referenceAssetIds.length || o.referenceMode === 'first-last')
      throw new AppError(
        400,
        'REFERENCE_UNSUPPORTED',
        '当前 Wan 2.6 适配器支持文本或单张首帧参考；首尾帧需连接对应模型',
      );
    if (i.prompt.length > 1500)
      throw new AppError(400, 'PROMPT_TOO_LONG', '当前视频模型最多1500字符');
  }
  if (i.providerId === 'fal' && isFalExtraOperation(i.operation)) {
    try {
      validateFalExtraOptions(i);
    } catch (error) {
      if (error instanceof ProviderError)
        throw new AppError(400, 'MODEL_INPUT_INVALID', error.message);
      throw error;
    }
    const source = assets[0]!;
    if (i.operation !== 'image.layers' && source.kind !== 'video')
      throw new AppError(400, 'VIDEO_REQUIRED', '请选择视频原始素材');
    if (i.operation === 'image.layers' && source.kind !== 'image')
      throw new AppError(400, 'IMAGE_REQUIRED', '拆层需要图片素材');
    if (i.referenceAssetIds.some((id) => core.assets.get(actor, wid, id).kind !== 'image'))
      throw new AppError(400, 'IMAGE_REQUIRED', '此模型的参考素材必须是图片');
    if (['video-replica', 'video.edit'].includes(i.operation)) {
      if (
        !['video/mp4', 'video/quicktime'].includes(source.mimeType) ||
        (source.durationMs || 0) < 3000 ||
        (source.durationMs || 0) > 10050 ||
        (source.width || 0) < 720 ||
        (source.height || 0) < 720 ||
        (source.width || 0) > 2160 ||
        (source.height || 0) > 2160
      )
        throw new AppError(400, 'VIDEO_LIMIT', 'Kling编辑需要3–10秒MP4/MOV，宽高均为720–2160像素');
      for (const id of i.referenceAssetIds) {
        const ref = core.assets.get(actor, wid, id);
        const ratio = (ref.width || 0) / (ref.height || 1);
        if ((ref.width || 0) < 300 || (ref.height || 0) < 300 || ratio < 0.4 || ratio > 2.5)
          throw new AppError(400, 'REFERENCE_LIMIT', '参考图宽高至少300像素，比例0.4–2.5');
      }
    }
    if (i.operation === 'video.translate' && (source.durationMs || 0) > 480000)
      throw new AppError(400, 'VIDEO_LIMIT', '视频口播翻译每次最多8分钟');
    if (
      i.operation === 'video.erase-subtitles' &&
      (!(source.durationMs && source.durationMs > 0) || source.durationMs >= 5000)
    )
      throw new AppError(
        400,
        'VIDEO_LIMIT',
        'Bria通用擦除仅支持小于5秒的短片，请先裁剪；不会自动截断源视频',
      );
  }
  if (i.providerId === 'fal' && i.operation === 'image-upscale' && o.scale !== 4)
    throw new AppError(400, 'SCALE_UNSUPPORTED', 'AuraSR 当前支持4倍放大');
  if (i.operation === 'image-inpaint' && !i.maskAssetId)
    throw new AppError(400, 'MASK_REQUIRED', '请先绘制重绘遮罩');
  if (i.operation === 'image-translate' && !o.languages?.length)
    throw new AppError(400, 'LANGUAGE_REQUIRED', '请选择目标语言');
  if (i.operation === 'product-recolor' && !o.colors?.length)
    throw new AppError(400, 'COLOR_REQUIRED', '请添加目标颜色');
  if (i.operation === 'product-tagging' && !o.price?.trim())
    throw new AppError(400, 'PRICE_REQUIRED', '请填写商品价格');
  if (i.operation === 'local.resize' && !o.width && !o.height)
    throw new AppError(400, 'SIZE_REQUIRED', '请输入目标宽度或高度');
  if (i.operation === 'local.video-trim') {
    const video = assets[0];
    if (video?.kind !== 'video') throw new AppError(400, 'VIDEO_REQUIRED', '请选择视频素材');
    const end = o.trimEnd || o.duration;
    if (end <= o.trimStart || end * 1000 > (video.durationMs || 0) + 100)
      throw new AppError(400, 'TRIM_RANGE', '裁剪时间必须在视频时长范围内');
  }
  if (
    !i.operation.startsWith('video.') &&
    i.operation !== 'video-replica' &&
    i.operation !== 'local.video-trim' &&
    i.operation !== 'text.assist' &&
    assets.some(
      (a) =>
        a.kind !== 'image' &&
        !(i.providerId === 'openai' && i.operation === 'image.generate' && a.kind === 'document'),
    )
  )
    throw new AppError(400, 'IMAGE_REQUIRED', '这个工具只支持图片素材');
  if (i.operation === 'text.assist' && assets.some((a) => !['image', 'document'].includes(a.kind)))
    throw new AppError(400, 'REFERENCE_TYPE', 'AI帮写支持图片与已提取文字的文档');
  if (['image.generate', 'text.assist'].includes(i.operation))
    for (const asset of assets.filter((a) => a.kind === 'document')) {
      if (i.providerId !== 'openai')
        throw new AppError(400, 'DOCUMENT_UNSUPPORTED', '当前仅OpenAI创作与帮写支持文档事实引用');
      if (asset.extractionStatus !== 'ready')
        throw new AppError(
          409,
          'DOCUMENT_NOT_READY',
          '参考文档尚未完成文字提取，请在素材详情检查状态',
        );
    }
  if (i.providerId === 'flyelep' && assets.length) {
    /* Reachability is checked by the service before quoting. */
  }
  if (!splitItems(i).length || splitItems(i).length > 20)
    throw new AppError(400, 'TOO_MANY_OUTPUTS', '单次需要1–20个结果，请检查数量或组合');
  return i;
}
export function splitItems(input: JobInput): JobInput[] {
  if (input.operation === 'image.generate' && input.options.designs?.length) {
    const { designs, ...options } = input.options;
    return designs.flatMap((design) =>
      Array.from({ length: input.options.count }, () => ({
        ...input,
        prompt: `${input.prompt}\n本张物料：${design.name}。${design.prompt}`,
        assetIds: design.assetIds.length ? design.assetIds : input.assetIds,
        options: { ...options, kind: design.kind, ratio: design.ratio, count: 1 },
      })),
    );
  }
  const single = [
    'image.generate',
    'video.generate',
    'image-replica',
    'video-replica',
    'image-fusion',
    'local.stitch',
    'text.assist',
    'image-inpaint',
  ];
  let items: JobInput[];
  if (single.includes(input.operation))
    items = Array.from(
      {
        length:
          input.operation.endsWith('.generate') || input.operation === 'image-replica'
            ? input.options.count
            : 1,
      },
      () => ({ ...input, options: { ...input.options, count: 1 } }),
    );
  else
    items = input.assetIds.map((id) => ({
      ...input,
      assetIds: [id],
      options: { ...input.options, count: 1 },
    }));
  if (input.operation === 'image-translate')
    items = items.flatMap((i) =>
      (i.options.languages || []).map((language) => ({
        ...i,
        options: { ...i.options, language, languages: [language] },
      })),
    );
  if (input.operation === 'product-recolor')
    items = items.flatMap((i) =>
      (i.options.colors || []).map((color) => ({
        ...i,
        options: { ...i.options, colors: [color] },
      })),
    );
  return items;
}

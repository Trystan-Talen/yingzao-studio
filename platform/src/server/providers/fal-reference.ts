import { buildVideoAudioRequest, validateVideoAudioInput } from './video-audio';
/** Protocol evidence: research/fal-reference-schemas/manifest.json. No live-quality claims. */
import sharp from 'sharp';
import type { JobInput, ModelCapability } from '../../contracts/jobs';
import type { ExecutionContext } from '../tasks/types';
import { ProviderError } from '../tasks/types';
import { inspectFalVideo, validateFalExtraVideo, type FalVideoMetadata } from './fal-extra';

export const FAL_REFERENCE_ENDPOINTS = {
  'kling-o1-first-last': 'fal-ai/kling-video/o1/image-to-video',
  'kling-o1-reference': 'fal-ai/kling-video/o1/reference-to-video',
  'kling-o3-4k-reference': 'fal-ai/kling-video/o3/4k/reference-to-video',
} as const;
export type FalReferenceModel = keyof typeof FAL_REFERENCE_ENDPOINTS;
export const FAL_REFERENCE_MODELS: ModelCapability[] = [
  {
    id: 'kling-o1-first-last',
    name: 'Kling O1 · 首尾帧',
    textOverlay: {
      mode: 'prompt-guidance',
      note: '画面文字与语言仅作为提示词指引，不保证精确字幕或文字生成。',
    },
    ratios: ['auto'],
    resolutions: ['auto'],
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: 'kling-o1-reference',
    name: 'Kling O1 · 多图参考',
    textOverlay: {
      mode: 'prompt-guidance',
      note: '画面文字与语言仅作为提示词指引，不保证精确字幕或文字生成。',
    },
    ratios: ['16:9', '9:16', '1:1'],
    resolutions: ['auto'],
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: 'kling-o3-4k-reference',
    name: 'Kling O3 · 4K 多模态参考',
    textOverlay: {
      mode: 'prompt-guidance',
      note: '画面文字与语言仅作为提示词指引，不保证精确字幕或文字生成。',
    },
    audio: {
      mode: 'generated',
      note: '按模型生成音轨，不是声音克隆或保证精确字幕；真实音画效果未验证。',
    },
    ratios: ['16:9', '9:16', '1:1'],
    resolutions: ['4K'],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
];
export function isFalReferenceModel(model: string | undefined): model is FalReferenceModel {
  return Boolean(model && Object.hasOwn(FAL_REFERENCE_ENDPOINTS, model));
}
export interface FalReferenceAsset {
  id: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  durationMs?: number | null;
}
interface ReferencePlan {
  model: FalReferenceModel;
  endpoint: string;
  frameIds: string[];
  referenceIds: string[];
}
function plan(input: JobInput): ReferencePlan {
  validateVideoAudioInput(input);
  const model = input.options.model;
  if (
    input.providerId !== 'fal' ||
    input.operation !== 'video.generate' ||
    !isFalReferenceModel(model)
  )
    throw new ProviderError('请选择已支持的 Kling 参考视频生成模型。');
  const capability = FAL_REFERENCE_MODELS.find((item) => item.id === model)!;
  if (!capability.durations.includes(input.options.duration))
    throw new ProviderError(
      model === 'kling-o3-4k-reference' ? '此模型支持3–15秒。' : '此模型支持3–10秒。',
    );
  if (!capability.ratios.includes(input.options.ratio))
    throw new ProviderError('所选参考模型不支持此画幅比例。');
  if (
    !capability.resolutions.some(
      (value) => value.toLowerCase() === input.options.resolution.toLowerCase(),
    )
  )
    throw new ProviderError('此模型的清晰度由所选端点决定，请选择支持的清晰度。');
  if (!input.prompt.trim() || input.prompt.length > 2100)
    throw new ProviderError('参考视频创作需求须为1–2100字符。');
  if (input.maskAssetId || input.referenceText)
    throw new ProviderError('当前参考视频模型不接受遮罩或文档正文。');
  const firstLast = input.options.referenceMode === 'first-last';
  if (model === 'kling-o1-first-last' && !firstLast)
    throw new ProviderError('此模型需要首尾帧参考方式。');
  if (model === 'kling-o1-reference' && firstLast)
    throw new ProviderError('多图参考模型不约束尾帧，请选择首尾帧模型。');
  if (firstLast && input.assetIds.length !== 2)
    throw new ProviderError('首尾帧模式需要恰好两张原始图片，顺序为首帧、尾帧。');
  if (model === 'kling-o1-first-last' && input.referenceAssetIds.length)
    throw new ProviderError('O1首尾帧模型不接受额外品牌或参考图片。');
  const frameIds = firstLast ? input.assetIds : [];
  const referenceIds = firstLast
    ? input.referenceAssetIds
    : [...input.assetIds, ...input.referenceAssetIds];
  if (referenceIds.length > 7 || (!firstLast && !referenceIds.length))
    throw new ProviderError('多参考模式需要1–7份图片或视频参考；首尾帧之外最多7份参考。');
  return { model, endpoint: FAL_REFERENCE_ENDPOINTS[model], frameIds, referenceIds };
}
function referencePrompt(
  input: JobInput,
  selected: ReferencePlan,
  imageCount: number,
  videoCount: number,
) {
  const instructions: string[] = [];
  if (selected.frameIds.length)
    instructions.push(
      selected.model === 'kling-o1-first-last'
        ? 'Animate a transition from @Image1 (first frame) to @Image2 (last frame).'
        : 'Animate from the supplied start frame to the supplied end frame.',
    );
  if (imageCount)
    instructions.push(
      `Visual references in order: ${Array.from({ length: imageCount }, (_, n) => `@Image${n + 1}`).join(', ')}.`,
    );
  if (videoCount) instructions.push('Use @Element1 as the referenced character or object.');
  instructions.push(
    input.options.needText
      ? `On-screen text direction: use ${input.options.language} for requested visible text or captions. This is prompt guidance, not a precise subtitle track.`
      : 'Do not add on-screen text, captions or subtitles. Preserve text already present in the reference.',
  );
  const prompt = [input.prompt.trim(), ...instructions].join('\n');
  if (prompt.length > 2500) throw new ProviderError('包含参考说明后的提示词超过模型长度限制。');
  return prompt;
}

function validateImage(asset: FalReferenceAsset) {
  const width = asset.width || 0,
    height = asset.height || 0;
  if (
    asset.kind !== 'image' ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) ||
    ![width, height, asset.byteSize].every(Number.isFinite) ||
    asset.byteSize <= 0 ||
    width < 300 ||
    height < 300 ||
    width / height < 0.4 ||
    width / height > 2.5 ||
    !asset.byteSize ||
    asset.byteSize > 50 * 1024 * 1024
  )
    throw new ProviderError('Kling参考图需PNG/JPEG/WebP，宽高至少300像素，比例0.4–2.5，最多50MB。');
}
/** Metadata is checked synchronously before quoting; execute additionally probes original bytes. */
export function validateFalReferenceInput(
  input: JobInput,
  assets?: readonly FalReferenceAsset[],
): ReferencePlan {
  const selected = plan(input);
  if (!assets) return selected;
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const get = (id: string) => {
    const asset = byId.get(id);
    if (!asset) throw new ProviderError('参考素材不存在或未获授权。');
    return asset;
  };
  selected.frameIds.forEach((id) => validateImage(get(id)));
  let videos = 0;
  for (const id of selected.referenceIds) {
    const asset = get(id);
    if (asset.kind === 'video') {
      videos++;
      if (selected.model !== 'kling-o3-4k-reference' || videos > 1)
        throw new ProviderError('仅Kling O3支持视频元素参考，每次最多一个视频。');
      if (
        !['video/mp4', 'video/quicktime'].includes(asset.mimeType) ||
        ![asset.byteSize, asset.durationMs, asset.width, asset.height].every(
          (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
        ) ||
        asset.byteSize > 200 * 1024 * 1024 ||
        (asset.durationMs || 0) < 3000 ||
        (asset.durationMs || 0) > 10050 ||
        (asset.width || 0) < 720 ||
        (asset.height || 0) < 720 ||
        (asset.width || 0) > 2160 ||
        (asset.height || 0) > 2160
      )
        throw new ProviderError('Kling视频参考需3–10秒MP4/MOV，宽高720–2160像素，最多200MB。');
    } else validateImage(asset);
  }
  referencePrompt(input, selected, selected.referenceIds.length - videos, videos);
  return selected;
}

export async function buildFalReferenceRequest(
  context: ExecutionContext,
  probe: (buffer: Buffer) => Promise<FalVideoMetadata> = inspectFalVideo,
): Promise<{ endpoint: string; body: Record<string, unknown> }> {
  const selected = plan(context.input);
  const buffers = new Map<string, Awaited<ReturnType<ExecutionContext['readAsset']>>>();
  const metadata: FalReferenceAsset[] = [];
  for (const id of new Set([...selected.frameIds, ...selected.referenceIds])) {
    const file = await context.readAsset(id);
    if (!file.buffer.length || file.buffer.length > 200 * 1024 * 1024)
      throw new ProviderError('参考素材为空或超过传输大小限制。');
    buffers.set(id, file);
    if (file.mimeType.startsWith('video/')) {
      if (selected.model !== 'kling-o3-4k-reference')
        throw new ProviderError('此参考模型只接受图片。');
      const actual = await probe(file.buffer);
      validateFalExtraVideo('video.edit', actual);
      metadata.push({
        id,
        kind: 'video',
        mimeType: file.mimeType,
        width: actual.width,
        height: actual.height,
        durationMs: actual.duration * 1000,
        byteSize: file.buffer.length,
      });
    } else {
      let dimensions: { width?: number; height?: number };
      try {
        dimensions = await sharp(file.buffer, { limitInputPixels: 64_000_000 }).metadata();
      } catch {
        throw new ProviderError('无法读取参考图片，请检查原件。');
      }
      metadata.push({
        id,
        kind: 'image',
        mimeType: file.mimeType,
        width: dimensions.width || null,
        height: dimensions.height || null,
        byteSize: file.buffer.length,
      });
    }
  }
  validateFalReferenceInput(context.input, metadata);
  const media = (id: string) => {
    const file = buffers.get(id)!;
    return `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
  };
  const byId = new Map(metadata.map((asset) => [asset.id, asset]));
  const imageIds = selected.referenceIds.filter((id) => byId.get(id)!.kind === 'image');
  const videoIds = selected.referenceIds.filter((id) => byId.get(id)!.kind === 'video');
  const prompt = referencePrompt(context.input, selected, imageIds.length, videoIds.length);
  const body: Record<string, unknown> = {
    prompt,
    duration: String(context.input.options.duration),
    enable_safety_checker: true,
  };
  if (selected.frameIds[0]) body.start_image_url = media(selected.frameIds[0]);
  if (selected.frameIds[1]) body.end_image_url = media(selected.frameIds[1]);
  if (imageIds.length) body.image_urls = imageIds.map(media);
  if (selected.model !== 'kling-o1-first-last') body.aspect_ratio = context.input.options.ratio;
  if (selected.model === 'kling-o3-4k-reference') {
    Object.assign(body, await buildVideoAudioRequest(context));
    if (videoIds.length) body.elements = videoIds.map((id) => ({ video_url: media(id) }));
  }
  return { endpoint: selected.endpoint, body };
}

/** Official schemas and SHA-256 provenance: research/fal-extra-schemas/manifest.json. */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { z } from 'zod';
import type { JobInput } from '../../contracts/jobs';
import { providerJson } from './http';
import {
  ProviderError,
  type ExecutionContext,
  type ProviderAdapter,
  type ProviderOutput,
} from '../tasks/types';

export const FAL_EXTRA_ENDPOINTS = {
  'video-replica': 'fal-ai/kling-video/o1/video-to-video/edit',
  'video.edit': 'fal-ai/kling-video/o1/video-to-video/edit',
  'image.layers': 'fal-ai/qwen-image-layered',
  'video.extend': 'fal-ai/ltx-2.3-22b/extend-video',
  'video.upscale': 'fal-ai/video-upscaler',
  'video.translate': 'fal-ai/heygen/v2/translate/precision',
  'video.erase-subtitles': 'bria/video/erase/prompt',
} as const;
export type FalExtraOperation = keyof typeof FAL_EXTRA_ENDPOINTS;
export const FAL_LAYER_COUNT = 4;
export const FAL_TRANSLATION_LANGUAGES: Readonly<Record<string, string>> = {
  'zh-CN': 'Chinese (Mandarin, Simplified)',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  th: 'Thai (Thailand)',
  vi: 'Vietnamese (Vietnam)',
  id: 'Indonesian',
  ms: 'Malay',
  tr: 'Turkish',
  pl: 'Polish',
  nl: 'Dutch',
};
export function isFalExtraOperation(operation: string): operation is FalExtraOperation {
  return Object.hasOwn(FAL_EXTRA_ENDPOINTS, operation);
}
export const isFalExtraEndpoint = (endpoint?: string) =>
  Boolean(endpoint && Object.values(FAL_EXTRA_ENDPOINTS).some((value) => value === endpoint));

/** Run before reserving credits too; execute repeats it before any billable submission. */
export function validateFalExtraOptions(input: JobInput) {
  if (!isFalExtraOperation(input.operation))
    throw new ProviderError('当前操作没有已核对的 fal 扩展协议。');
  if (input.assetIds.length !== 1) throw new ProviderError('此模型每次接受一份原始素材。');
  if (input.maskAssetId) throw new ProviderError('此模型不接受区域遮罩。');
  const editing = input.operation === 'video-replica' || input.operation === 'video.edit';
  const maxReferences = editing ? 4 : input.operation === 'video.extend' ? 1 : 0;
  if (input.referenceAssetIds.length > maxReferences)
    throw new ProviderError(`此模型最多接受 ${maxReferences} 张参考图片。`);
  if (editing && input.prompt.length > 2100)
    throw new ProviderError('视频编辑需求最多 2100 字符，以保留参考素材说明的空间。');
  if (input.operation === 'video.edit' && !input.prompt.trim())
    throw new ProviderError('请填写视频编辑需求。');
  if (input.operation === 'video.extend' && input.options.duration > 20)
    throw new ProviderError('当前延长模型支持新增 2–20 秒内容。');
  if (input.operation === 'video.erase-subtitles' && input.prompt.length > 1000)
    throw new ProviderError('短片文字区域擦除说明最多1000字符。');
  if (input.operation === 'video.translate' && !FAL_TRANSLATION_LANGUAGES[input.options.language])
    throw new ProviderError('当前视频翻译模型不支持这个目标语言。');
}

export interface FalVideoMetadata {
  width: number;
  height: number;
  duration: number;
  fps: number;
}
const execFileAsync = promisify(execFile);
/** Probe trusted uploaded bytes, disabling network protocols even if the container is malformed. */
export async function inspectFalVideo(buffer: Buffer): Promise<FalVideoMetadata> {
  const dir = await mkdtemp(join(tmpdir(), 'yingzao-fal-probe-'));
  try {
    const path = join(dir, 'input');
    await writeFile(path, buffer, { mode: 0o600 });
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-show_entries',
        'format=duration:stream=codec_type,width,height,avg_frame_rate',
        '-of',
        'json',
        path,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    const result = z
      .object({
        format: z.object({ duration: z.string() }),
        streams: z.array(
          z.object({
            codec_type: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
            avg_frame_rate: z.string().optional(),
          }),
        ),
      })
      .parse(JSON.parse(stdout));
    const stream = result.streams.find((s) => s.codec_type === 'video');
    const [numerator, denominator] = (stream?.avg_frame_rate || '0/1').split('/').map(Number);
    const metadata = {
      width: stream?.width || 0,
      height: stream?.height || 0,
      duration: Number(result.format.duration),
      fps: (numerator || 0) / (denominator || 1),
    };
    if (Object.values(metadata).some((value) => !Number.isFinite(value) || value <= 0))
      throw new Error('Invalid video metadata');
    return metadata;
  } catch {
    throw new ProviderError('无法验证视频时长、尺寸或帧率，请检查文件及 FFmpeg 安装。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function validateFalExtraVideo(operation: FalExtraOperation, metadata: FalVideoMetadata) {
  if (Object.values(metadata).some((value) => !Number.isFinite(value) || value <= 0))
    throw new ProviderError('视频媒体元数据无效。');
  if (operation === 'video-replica' || operation === 'video.edit') {
    if (
      metadata.duration < 3 ||
      metadata.duration > 10.05 ||
      metadata.width < 720 ||
      metadata.height < 720 ||
      metadata.width > 2160 ||
      metadata.height > 2160 ||
      metadata.fps < 24 ||
      metadata.fps > 60
    )
      throw new ProviderError('Kling 编辑需 3–10 秒视频，宽高均为 720–2160 像素，帧率 24–60。');
  }
  if (operation === 'video.erase-subtitles' && metadata.duration >= 5)
    throw new ProviderError(
      'Bria通用文字区域擦除仅支持短于5秒的视频；请先裁剪，不会自动截断原片。',
    );
  if (operation === 'video.translate' && metadata.duration > 480)
    throw new ProviderError('视频翻译每次最多接受 8 分钟。');
}

export async function buildFalExtraRequest(
  context: ExecutionContext,
  probe: (buffer: Buffer) => Promise<FalVideoMetadata> = inspectFalVideo,
): Promise<{ endpoint: string; body: Record<string, unknown> }> {
  const input = context.input;
  validateFalExtraOptions(input);
  const operation = input.operation as FalExtraOperation;
  const endpoint = FAL_EXTRA_ENDPOINTS[operation];
  const editing = operation === 'video-replica' || operation === 'video.edit';
  const original = await context.readAsset(input.assetIds[0]!);
  const isImage = operation === 'image.layers';
  if (
    isImage
      ? !/^image\/(png|jpeg|webp)$/.test(original.mimeType)
      : !/^video\/(mp4|quicktime|webm)$/.test(original.mimeType)
  )
    throw new ProviderError(
      isImage ? '图片分层需要 PNG、JPEG 或 WebP 图片。' : '请选择有效的视频素材。',
    );
  if (editing && !['video/mp4', 'video/quicktime'].includes(original.mimeType))
    throw new ProviderError('Kling 视频编辑只接受 MP4 或 MOV。');
  if (!original.buffer.length || original.buffer.length > 200 * 1024 * 1024)
    throw new ProviderError('原始素材为空或超过 200 MB。');
  if (!isImage) validateFalExtraVideo(operation, await probe(original.buffer));
  const source = `data:${original.mimeType};base64,${original.buffer.toString('base64')}`;
  const references: string[] = [];
  for (const id of input.referenceAssetIds) {
    const image = await context.readAsset(id);
    if (
      !/^image\/(png|jpeg|webp)$/.test(image.mimeType) ||
      !image.buffer.length ||
      image.buffer.length > 50 * 1024 * 1024
    )
      throw new ProviderError('参考图需为 PNG、JPEG 或 WebP，且不超过 50 MB。');
    if (editing) {
      const metadata = await sharp(image.buffer, { limitInputPixels: 64_000_000 }).metadata();
      const width = metadata.width || 0,
        height = metadata.height || 0;
      if (width < 300 || height < 300 || width / height < 0.4 || width / height > 2.5)
        throw new ProviderError('Kling 参考图宽高至少 300 像素，宽高比为 0.4–2.5。');
    }
    references.push(`data:${image.mimeType};base64,${image.buffer.toString('base64')}`);
  }
  let body: Record<string, unknown>;
  if (editing) {
    const target = { model: 'person', clothing: 'clothing', face: 'face', product: 'product' }[
      input.options.replacementType
    ];
    const instructions =
      operation === 'video-replica'
        ? `Preserve the reference video's motion and camera structure. ${references.length ? `Replace the ${target} using @Image1.` : ''} ${input.options.needText ? '' : 'Do not add new captions or text.'}`
        : '';
    const referenceNote = references.length
      ? `Reference images in order: ${references.map((_, index) => `@Image${index + 1}`).join(', ')}.`
      : '';
    const prompt = [instructions, input.prompt.trim(), referenceNote].filter(Boolean).join('\n');
    if (prompt.length > 2500) throw new ProviderError('包含参考说明后的提示词超过模型长度限制。');
    body = {
      prompt,
      video_url: source,
      keep_audio: input.options.keepMusicRhythm,
      enable_safety_checker: true,
      ...(references.length ? { image_urls: references } : {}),
    };
  } else if (operation === 'image.layers') {
    body = {
      image_url: source,
      num_layers: FAL_LAYER_COUNT,
      output_format: 'png',
      enable_safety_checker: true,
      sync_mode: false,
      ...(input.prompt.trim() ? { prompt: input.prompt.trim() } : {}),
    };
  } else if (operation === 'video.extend') {
    body = {
      video_url: source,
      prompt:
        input.prompt.trim() ||
        'Continue the scene naturally, maintaining its visual style and motion.',
      num_frames: input.options.duration * 24 + 1,
      fps: 24,
      match_input_fps: false,
      extend_direction: 'forward',
      video_size: 'auto',
      video_output_type: 'X264 (.mp4)',
      generate_audio: true,
      enable_safety_checker: true,
      sync_mode: false,
      ...(references[0] ? { end_image_url: references[0] } : {}),
    };
  } else if (operation === 'video.erase-subtitles') {
    body = {
      video_url: source,
      prompt: ['Remove overlaid subtitles and caption text from the video.', input.prompt.trim()]
        .filter(Boolean)
        .join('\n'),
      auto_trim: false,
      preserve_audio: true,
      output_container_and_codec: 'mp4_h264',
    };
  } else if (operation === 'video.upscale') {
    body = { video_url: source, scale: input.options.scale };
  } else {
    body = {
      video_url: source,
      output_language: FAL_TRANSLATION_LANGUAGES[input.options.language],
      translate_audio_only: false,
      enable_dynamic_duration: true,
      enable_caption: false,
    };
  }
  return { endpoint, body };
}

const queueResponse = z.object({
  request_id: z.string().min(1),
  status_url: z.string().url(),
  response_url: z.string().url(),
  cancel_url: z.string().url().optional(),
});
const media = z.object({ url: z.string().url(), content_type: z.string().nullish() });
function queueUrl(value: string, ambiguous = false) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'queue.fal.run' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hash
  )
    throw new ProviderError('服务返回了不受信任的队列地址。', ambiguous);
  return url.href;
}
function output(
  mediaValue: z.infer<typeof media>,
  kind: 'image' | 'video',
  index = 0,
): ProviderOutput {
  const url = new URL(mediaValue.url);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new ProviderError('模型未返回有效 HTTPS 产物地址。');
  const mimeType = mediaValue.content_type || (kind === 'image' ? 'image/png' : 'video/mp4');
  if (!(kind === 'image' ? /^image\/(png|webp)$/ : /^video\/(mp4|quicktime|webm)$/).test(mimeType))
    throw new ProviderError('模型产物的媒体类型与操作不匹配。');
  const extension =
    mimeType === 'image/webp'
      ? 'webp'
      : mimeType === 'image/png'
        ? 'png'
        : mimeType === 'video/webm'
          ? 'webm'
          : mimeType === 'video/quicktime'
            ? 'mov'
            : 'mp4';
  return {
    url: url.href,
    mimeType,
    name: kind === 'image' ? `语义分层-${index + 1}.${extension}` : `映造处理视频.${extension}`,
  };
}
/** Dispatch execute by operation, and resumed poll/cancel by persisted remote.endpoint. */
export const falExtraProvider: ProviderAdapter = {
  id: 'fal',
  async execute(context, secret) {
    if (!secret) throw new ProviderError('请先连接 fal 服务。');
    const { endpoint, body } = await buildFalExtraRequest(context);
    const result = queueResponse.safeParse(
      await providerJson(`https://queue.fal.run/${endpoint}`, {
        headers: { Authorization: `Key ${secret}`, 'X-Fal-No-Retry': '1' },
        body,
        submission: true,
        timeoutMs: 120000,
      }),
    );
    if (!result.success) throw new ProviderError('队列未返回有效任务 ID，需核对本次提交。', true);
    return {
      state: 'submitted',
      remote: {
        id: result.data.request_id,
        endpoint,
        statusUrl: queueUrl(result.data.status_url, true),
        responseUrl: queueUrl(result.data.response_url, true),
        cancelUrl: result.data.cancel_url ? queueUrl(result.data.cancel_url, true) : undefined,
      },
    };
  },
  async poll(remote, secret) {
    if (!isFalExtraEndpoint(remote.endpoint) || !remote.statusUrl || !remote.responseUrl)
      throw new ProviderError('扩展任务端点或查询地址缺失。');
    const headers = { Authorization: `Key ${secret}` };
    const status = z
      .object({
        status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']),
        error: z.string().nullish(),
      })
      .parse(
        await providerJson(queueUrl(remote.statusUrl), {
          method: 'GET',
          headers,
          timeoutMs: 30000,
        }),
      );
    if (status.error) return { state: 'failed', message: '服务商未能完成该任务。' };
    if (status.status !== 'COMPLETED')
      return {
        state: 'running',
        stage: status.status === 'IN_QUEUE' ? '服务商排队中' : '视频与图片模型正在处理',
      };
    const result = await providerJson(queueUrl(remote.responseUrl), {
      method: 'GET',
      headers,
      timeoutMs: 30000,
    });
    if (remote.endpoint === FAL_EXTRA_ENDPOINTS['image.layers']) {
      const parsed = z
        .object({ images: z.array(media).min(1).max(10), has_nsfw_concepts: z.array(z.boolean()) })
        .parse(result);
      if (parsed.has_nsfw_concepts.length !== parsed.images.length)
        throw new ProviderError('模型返回的安全检查结果与图层数量不一致。');
      if (parsed.has_nsfw_concepts.some(Boolean))
        return { state: 'failed', message: '服务商安全检查未通过，请调整输入素材。' };
      return {
        state: 'complete',
        outputKind: 'layers',
        outputs: parsed.images.map((file, index) => output(file, 'image', index)),
      };
    }
    return {
      state: 'complete',
      outputs: [output(z.object({ video: media }).parse(result).video, 'video')],
    };
  },
  async cancel(remote, secret) {
    if (!isFalExtraEndpoint(remote.endpoint) || !remote.cancelUrl)
      throw new ProviderError('服务未提供这个任务的取消地址。');
    await providerJson(queueUrl(remote.cancelUrl), {
      method: 'PUT',
      headers: { Authorization: `Key ${secret}` },
      timeoutMs: 30000,
    });
  },
};

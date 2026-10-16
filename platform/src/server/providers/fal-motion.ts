/** Verified official protocol (2026-10-16):
 * https://fal.ai/models/fal-ai/kling-video/v2.6/standard/motion-control/api
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/v2.6/standard/motion-control
 * Local contracts and media checks do not certify paid inference quality.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp, { type Metadata } from 'sharp';
import type { JobInput, ModelCapability } from '../../contracts/jobs';
import { ProviderError, type ExecutionContext } from '../tasks/types';
import { inspectFalVideo, type FalVideoMetadata } from './fal-extra';

export const FAL_MOTION_ENDPOINTS = {
  'kling-2.6-motion-standard': 'fal-ai/kling-video/v2.6/standard/motion-control',
  'kling-2.6-motion-pro': 'fal-ai/kling-video/v2.6/pro/motion-control',
} as const;
type FalMotionModel = keyof typeof FAL_MOTION_ENDPOINTS;
export const FAL_MOTION_MODELS: ModelCapability[] = [
  {
    id: 'kling-2.6-motion-standard',
    name: 'Kling 2.6 · 标准人物动作复刻',
    ratios: ['auto'],
    resolutions: ['auto'],
    durations: [],
    textOverlay: {
      mode: 'unsupported',
      note: '按参考片段驱动人物动作；没有字幕、独立画幅或清晰度控制，不保证逐像素复刻。',
    },
  },
  {
    id: 'kling-2.6-motion-pro',
    name: 'Kling 2.6 · 专业人物动作复刻',
    ratios: ['auto'],
    resolutions: ['auto'],
    durations: [],
    textOverlay: {
      mode: 'unsupported',
      note: '按参考片段驱动人物动作；没有字幕、独立画幅或清晰度控制，不保证逐像素复刻。',
    },
  },
];
export function isFalMotionModel(model: string | undefined): model is FalMotionModel {
  return Boolean(model && Object.hasOwn(FAL_MOTION_ENDPOINTS, model));
}
export interface FalMotionAsset {
  id: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  durationMs?: number | null;
}
const IMAGE_LIMIT = 10 * 1024 * 1024,
  VIDEO_LIMIT = 100 * 1024 * 1024;
/** The source duration must come from trusted media metadata, never the client duration option. */
export function selectedMotionDuration(input: JobInput, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new ProviderError('参考视频缺少有效时长，无法确定动作片段。');
  const total = durationMs / 1000,
    start = input.options.trimStart,
    end = input.options.trimEnd ?? total;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > total + 0.000001
  )
    throw new ProviderError('动作片段的开始、结束时间必须位于参考视频内。');
  const duration = Math.round((end - start) * 1_000_000) / 1_000_000;
  const max = input.options.motionOrientation === 'image' ? 10.05 : 30.05;
  if (duration < 3 || duration > max)
    throw new ProviderError(
      input.options.motionOrientation === 'image'
        ? '跟随图片朝向的动作片段须为3–10秒。'
        : '跟随视频朝向的动作片段须为3–30秒。',
    );
  return duration;
}
function dimensions(asset: FalMotionAsset) {
  if (
    ![asset.width, asset.height, asset.byteSize].every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
    ) ||
    asset.width! < 340 ||
    asset.height! < 340 ||
    asset.width! > 3850 ||
    asset.height! > 3850
  )
    throw new ProviderError('人物图片和动作视频的宽高均须为340–3850像素，且原件不能为空。');
}
export function validateFalMotionInput(input: JobInput, assets?: readonly FalMotionAsset[]) {
  const o = input.options;
  if (
    input.operation !== 'video.motion-replica' ||
    input.providerId !== 'fal' ||
    !isFalMotionModel(o.model)
  )
    throw new ProviderError('请选择已支持的人物动作复刻模型。');
  if (!o.referenceAuthorized) throw new ProviderError('请先确认已获人物图片和参考视频的使用授权。');
  if (o.mode !== 'exact' || o.replacementType !== 'model')
    throw new ProviderError('此模型专用于人物动作复刻，不支持服装、人脸或商品专用替换。');
  if (input.assetIds.length !== 1 || input.referenceAssetIds.length !== 1)
    throw new ProviderError('人物动作复刻需要一张主体图片和一段独立参考视频。');
  if (
    input.maskAssetId ||
    input.backgroundAssetId ||
    input.brandId ||
    input.characterId ||
    input.characterRevision ||
    input.referenceText ||
    o.designs?.length
  )
    throw new ProviderError('人物动作复刻请使用独立人物图与动作视频槽位，不接受额外素材或文档。');
  if (o.ratio !== 'auto' || o.resolution !== 'auto')
    throw new ProviderError('人物动作复刻没有独立画幅或清晰度参数，请选择自动。');
  if (o.needText)
    throw new ProviderError('此动作模型没有字幕控制，请关闭画面文字，字幕可在生成后单独处理。');
  if (o.count !== 1 || o.referenceMode !== 'all')
    throw new ProviderError('人物动作复刻每次生成一段视频，不支持首尾帧模式。');
  if (!['video', 'image'].includes(o.motionOrientation))
    throw new ProviderError('请选择跟随视频或图片的人物朝向。');
  if (input.prompt.length > 300) throw new ProviderError('人物动作复刻的补充说明最多300字符。');
  if (!assets) return;
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const image = byId.get(input.assetIds[0]!),
    video = byId.get(input.referenceAssetIds[0]!);
  if (!image || !video)
    throw new ProviderError('人物图片或参考视频不存在、尚未上传完成或未获授权。');
  dimensions(image);
  dimensions(video);
  if (
    image.kind !== 'image' ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) ||
    image.byteSize > IMAGE_LIMIT ||
    image.width! / image.height! < 0.4 ||
    image.width! / image.height! > 2.5
  )
    throw new ProviderError('人物图须为PNG/JPEG/WebP、最多10MiB，宽高比0.4–2.5。');
  if (
    video.kind !== 'video' ||
    !['video/mp4', 'video/quicktime', 'video/webm'].includes(video.mimeType) ||
    video.byteSize > VIDEO_LIMIT
  )
    throw new ProviderError('动作参考须为MP4/MOV/WebM视频，最多100MiB。');
  const duration = selectedMotionDuration(input, video.durationMs ?? 0);
  if (o.duration !== Math.ceil(duration))
    throw new ProviderError('动作任务时长必须等于已选参考片段秒数向上取整，请重新核对选段和报价。');
}
export interface MotionTrimOptions {
  start: number;
  end: number;
  keepAudio: boolean;
}
const exec = promisify(execFile);
async function trimMotionVideo(buffer: Buffer, options: MotionTrimOptions): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'yingzao-motion-trim-'));
  try {
    const input = join(dir, 'source'),
      output = join(dir, 'clip.mp4');
    await writeFile(input, buffer, { mode: 0o600 });
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        input,
        '-ss',
        String(options.start),
        '-t',
        String(options.end - options.start),
        '-map',
        '0:v:0',
        ...(options.keepAudio ? ['-map', '0:a?', '-c:a', 'aac'] : ['-an']),
        '-vf',
        'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '18',
        '-preset',
        'fast',
        '-map_metadata',
        '-1',
        '-movflags',
        '+faststart',
        '-y',
        output,
      ],
      { timeout: 180000, maxBuffer: 1024 * 1024 },
    );
    const size = (await stat(output)).size;
    if (!size || size > VIDEO_LIMIT)
      throw new ProviderError('裁后的动作片段为空或超过100MiB，请缩短片段。');
    return await readFile(output);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('动作视频裁剪失败，请核对参考文件、选段及FFmpeg安装。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function buildFalMotionRequest(
  context: ExecutionContext,
  probe: (buffer: Buffer) => Promise<FalVideoMetadata> = inspectFalVideo,
  trim: (buffer: Buffer, options: MotionTrimOptions) => Promise<Buffer> = trimMotionVideo,
): Promise<{ endpoint: string; body: Record<string, unknown> }> {
  const input = context.input;
  validateFalMotionInput(input);
  const [image, video] = await Promise.all([
    context.readAsset(input.assetIds[0]!),
    context.readAsset(input.referenceAssetIds[0]!),
  ]);
  if (
    !image.buffer.length ||
    image.buffer.length > IMAGE_LIMIT ||
    !video.buffer.length ||
    video.buffer.length > VIDEO_LIMIT
  )
    throw new ProviderError('人物图片最多10MiB，参考视频最多100MiB，且原件不能为空。');
  let imageMeta: Metadata;
  try {
    imageMeta = await sharp(image.buffer, { limitInputPixels: 15_000_000 }).metadata();
  } catch {
    throw new ProviderError('无法解码人物图片原件，请重新选择有效图片。');
  }
  const supportedMimes: Record<string, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  const mime = supportedMimes[imageMeta.format ?? ''];
  if (!mime || mime !== image.mimeType)
    throw new ProviderError('人物图片原件格式与文件类型不一致。');
  const original = await probe(video.buffer);
  validateFalMotionInput(input, [
    {
      id: input.assetIds[0]!,
      kind: 'image',
      mimeType: image.mimeType,
      width: imageMeta.width ?? 0,
      height: imageMeta.height ?? 0,
      byteSize: image.buffer.length,
    },
    {
      id: input.referenceAssetIds[0]!,
      kind: 'video',
      mimeType: video.mimeType,
      width: original.width,
      height: original.height,
      durationMs: original.duration * 1000,
      byteSize: video.buffer.length,
    },
  ]);
  const selected = selectedMotionDuration(input, original.duration * 1000);
  const clip = await trim(video.buffer, {
    start: input.options.trimStart,
    end: input.options.trimEnd ?? original.duration,
    keepAudio: input.options.keepMusicRhythm,
  });
  if (!clip.length || clip.length > VIDEO_LIMIT)
    throw new ProviderError('裁后的动作片段为空或超过100MiB。');
  const actual = await probe(clip);
  dimensions({
    id: '',
    kind: 'video',
    mimeType: 'video/mp4',
    width: actual.width,
    height: actual.height,
    byteSize: clip.length,
  });
  const max = input.options.motionOrientation === 'image' ? 10.05 : 30.05;
  if (
    !Number.isFinite(actual.duration) ||
    actual.duration < 3 ||
    actual.duration > max ||
    Math.abs(actual.duration - selected) > 0.15
  )
    throw new ProviderError('裁后视频时长与所选动作片段不符，未提交服务商。');
  return {
    endpoint: FAL_MOTION_ENDPOINTS[input.options.model as FalMotionModel],
    body: {
      image_url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
      video_url: `data:video/mp4;base64,${clip.toString('base64')}`,
      character_orientation: input.options.motionOrientation,
      keep_original_sound: input.options.keepMusicRhythm,
      enable_safety_checker: true,
      ...(input.prompt.trim() ? { prompt: input.prompt.trim() } : {}),
    },
  };
}

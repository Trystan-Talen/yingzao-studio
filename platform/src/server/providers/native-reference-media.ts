import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { ProviderError } from '../tasks/types';

const exec = promisify(execFile);
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 36_000_000;
const MAX_VIDEO_PIXELS = 16_777_216;
const MAX_SOURCE_DURATION = 600;
const MAX_SOURCE_FRAMES = 72_000;
const MAX_ANALYSIS_SIDE = 1600;
// Uploaded playlists/manifests must not load any other local file or URL.
const VIDEO_FORMATS = 'mov,matroska,webm';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export interface NativeReferenceFile {
  buffer: Buffer;
  mimeType: string;
}
export interface NativeReferenceImage extends NativeReferenceFile {
  width: number;
  height: number;
  sha256: string;
}
export interface NativeReferenceFrame extends NativeReferenceImage {
  index: number;
  /** Relative to the selected clip, not a fabricated equally spaced timestamp. */
  timestampSeconds: number;
  /** Presentation time relative to the source's first decoded video frame. */
  sourceTimestampSeconds: number;
}
export interface NativeReferenceMedia {
  referenceKind: 'image' | 'video';
  referenceSha256: string;
  subjectSha256: string;
  subject: NativeReferenceImage;
  frames: NativeReferenceFrame[];
  sampledAt: string;
  clipStartSeconds: number;
  clipDurationSeconds: number;
  sourceDurationSeconds?: number;
}
export interface NativeReferenceClipInput {
  reference: NativeReferenceFile;
  trimStartSeconds?: number;
  trimDurationSeconds?: number;
}
export interface PrepareNativeReferenceMediaInput extends NativeReferenceClipInput {
  referenceKind: 'image' | 'video';
  subject: NativeReferenceFile;
  sampleCount?: number;
}
function mediaError(message: string): ProviderError {
  return new ProviderError(message, false, 'NATIVE_REFERENCE_MEDIA_INVALID');
}
async function analysisImage(file: NativeReferenceFile): Promise<NativeReferenceImage> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) ||
    !file.buffer.length ||
    file.buffer.length > MAX_IMAGE_BYTES
  )
    throw mediaError('视觉参考图片须为PNG/JPEG/WebP且不超过20MiB。');
  try {
    const pipeline = sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS });
    const meta = await pipeline.metadata();
    if (
      (meta.pages ?? 1) !== 1 ||
      !meta.width ||
      !meta.height ||
      meta.width < 14 ||
      meta.height < 14
    )
      throw mediaError('视觉参考需要可解码的单帧图片。');
    const result = await pipeline
      .rotate()
      .resize(MAX_ANALYSIS_SIDE, MAX_ANALYSIS_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length >= 10 * 1024 * 1024)
      throw mediaError('视觉参考图片编码后超过单图限制。');
    return {
      buffer: result.data,
      mimeType: 'image/jpeg',
      width: result.info.width,
      height: result.info.height,
      sha256: hash(result.data),
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw mediaError('视觉参考图片无法完整解码，请重新上传原件。');
  }
}
interface VideoProbe {
  width: number;
  height: number;
  durationSeconds: number;
  timestamps: number[];
}
async function probeVideo(path: string, withFrames: boolean): Promise<VideoProbe> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        VIDEO_FORMATS,
        '-select_streams',
        'v:0',
        ...(withFrames ? ['-show_frames'] : []),
        '-show_entries',
        `stream=width,height,duration:format=duration${withFrames ? ':frame=best_effort_timestamp_time' : ''}`,
        '-of',
        'json',
        path,
      ],
      { timeout: withFrames ? 45000 : 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    const body = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number; duration?: string }[];
      format?: { duration?: string };
      frames?: { best_effort_timestamp_time?: string }[];
    };
    const stream = body.streams?.[0];
    const width = stream?.width ?? 0,
      height = stream?.height ?? 0;
    const durationSeconds = Number(stream?.duration ?? body.format?.duration);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 16 ||
      height < 16 ||
      width * height > MAX_VIDEO_PIXELS ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds < 2 ||
      durationSeconds > MAX_SOURCE_DURATION
    )
      throw mediaError('参考视频须有有效画面，时长2秒至10分钟，画面不超过1600万像素。');
    const rawTimes = (body.frames ?? []).map((frame) => Number(frame.best_effort_timestamp_time));
    if (
      withFrames &&
      (rawTimes.length < 5 ||
        rawTimes.length > MAX_SOURCE_FRAMES ||
        rawTimes.some(
          (value, index) => !Number.isFinite(value) || (index > 0 && value <= rawTimes[index - 1]!),
        ))
    )
      throw mediaError('参考视频帧时间不完整、乱序或帧数超限，不能可靠抽样。');
    const first = rawTimes[0] ?? 0;
    const timestamps = rawTimes.map((value) => Math.round((value - first) * 1_000_000) / 1_000_000);
    if (timestamps.length && timestamps.at(-1)! > durationSeconds + 0.1)
      throw mediaError('参考视频的帧时间与实测时长不一致。');
    return { width, height, durationSeconds, timestamps };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw mediaError('参考视频探测失败，请检查文件和本机媒体处理工具。');
  }
}
function selectedClip(input: NativeReferenceClipInput, duration: number) {
  const start = input.trimStartSeconds ?? 0;
  const length = input.trimDurationSeconds ?? Math.min(15, duration - start);
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    !Number.isFinite(length) ||
    length < 2 ||
    length > 15 ||
    start + length > duration + 0.000001
  )
    throw mediaError('参考选段须在视频内，时长2–15秒；剩余不足2秒时请调整开始时间。');
  return { start, length };
}
async function videoFile<T>(
  reference: NativeReferenceFile,
  action: (path: string, dir: string) => Promise<T>,
) {
  if (
    !['video/mp4', 'video/quicktime', 'video/webm'].includes(reference.mimeType) ||
    !reference.buffer.length ||
    reference.buffer.length > MAX_VIDEO_BYTES
  )
    throw mediaError('参考视频须为MP4/MOV/WebM且不超过100MiB。');
  const dir = await mkdtemp(join(tmpdir(), 'yingzao-reference-media-'));
  try {
    const path = join(dir, 'source');
    await writeFile(path, reference.buffer, { mode: 0o600 });
    return await action(path, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
/** No video API or MP4 re-encode: decode only bounded, selected real frames. */
export async function prepareNativeReferenceMedia(
  input: PrepareNativeReferenceMediaInput,
): Promise<NativeReferenceMedia> {
  const subject = await analysisImage(input.subject);
  const common = {
    referenceSha256: hash(input.reference.buffer),
    subjectSha256: hash(input.subject.buffer),
    subject,
  };
  if (input.referenceKind === 'image') {
    if (
      input.trimStartSeconds !== undefined ||
      input.trimDurationSeconds !== undefined ||
      input.sampleCount !== undefined
    )
      throw mediaError('图片参考不接受视频选段或抽帧参数。');
    const image = await analysisImage(input.reference);
    return {
      ...common,
      referenceKind: 'image',
      frames: [{ ...image, index: 0, timestampSeconds: 0, sourceTimestampSeconds: 0 }],
      sampledAt: new Date().toISOString(),
      clipStartSeconds: 0,
      clipDurationSeconds: 0,
    };
  }
  if (input.referenceKind !== 'video') throw mediaError('参考类型无效。');
  const count = input.sampleCount ?? 6;
  if (!Number.isInteger(count) || count < 5 || count > 8)
    throw mediaError('视频视觉分析仅支持5–8个采样帧。');
  return videoFile(input.reference, async (path, dir) => {
    // Reject oversized/invalid clips before requesting a decoded frame inventory.
    const metadata = await probeVideo(path, false);
    const clip = selectedClip(input, metadata.durationSeconds);
    const probe = await probeVideo(path, true);
    const available = probe.timestamps
      .map((time, frame) => ({ time, frame }))
      .filter(({ time }) => time >= clip.start && time < clip.start + clip.length);
    if (available.length < count)
      throw mediaError('选段内没有足够的不同视频帧，不能进行可靠参考分析。');
    const selected: typeof available = [];
    for (let index = 0; index < count; index++) {
      const target =
        available[0]!.time + ((available.at(-1)!.time - available[0]!.time) * index) / (count - 1);
      const lower = index
        ? available.findIndex((entry) => entry.frame === selected.at(-1)!.frame) + 1
        : 0;
      const upper = available.length - (count - index);
      let best = lower;
      for (let candidate = lower + 1; candidate <= upper; candidate++)
        if (
          Math.abs(available[candidate]!.time - target) < Math.abs(available[best]!.time - target)
        )
          best = candidate;
      selected.push(available[best]!);
    }
    try {
      await exec(
        'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          VIDEO_FORMATS,
          '-i',
          path,
          '-map',
          '0:v:0',
          '-an',
          '-vf',
          `select='${selected.map(({ frame }) => `eq(n,${frame})`).join('+')}',scale=w='min(${MAX_ANALYSIS_SIDE},iw)':h='min(${MAX_ANALYSIS_SIDE},ih)':force_original_aspect_ratio=decrease`,
          '-vsync',
          '0',
          '-frames:v',
          String(count),
          '-q:v',
          '2',
          '-y',
          join(dir, 'frame-%02d.jpg'),
        ],
        { timeout: 60000, maxBuffer: 1024 * 1024 },
      );
    } catch {
      throw mediaError('参考视频抽帧失败，未提交视觉分析。');
    }
    const frames: NativeReferenceFrame[] = [];
    for (let index = 0; index < count; index++) {
      const file = join(dir, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
      const size = (await stat(file)).size;
      if (!size || size >= 10 * 1024 * 1024) throw mediaError('视频采样帧为空或超过大小限制。');
      const image = await analysisImage({ buffer: await readFile(file), mimeType: 'image/jpeg' });
      frames.push({
        ...image,
        index,
        timestampSeconds: Math.round((selected[index]!.time - clip.start) * 1_000_000) / 1_000_000,
        sourceTimestampSeconds: selected[index]!.time,
      });
    }
    return {
      ...common,
      referenceKind: 'video',
      frames,
      sampledAt: new Date().toISOString(),
      clipStartSeconds: clip.start,
      clipDurationSeconds: clip.length,
      sourceDurationSeconds: probe.durationSeconds,
    };
  });
}

/** Separate explicit worker operation: analysis never pays the cost of encoding this clip. */
export async function extractNativeReferenceClip(input: NativeReferenceClipInput) {
  return videoFile(input.reference, async (path, dir) => {
    const source = await probeVideo(path, false);
    const clip = selectedClip(input, source.durationSeconds);
    const output = join(dir, 'reference.mp4');
    try {
      await exec(
        'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          VIDEO_FORMATS,
          '-i',
          path,
          '-ss',
          String(clip.start),
          '-t',
          String(clip.length),
          '-map',
          '0:v:0',
          '-an',
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
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );
      if ((await stat(output)).size > MAX_VIDEO_BYTES) throw mediaError('选段编码超过100MiB。');
      const measured = await probeVideo(output, false);
      if (Math.abs(measured.durationSeconds - clip.length) > 0.15)
        throw mediaError('本机视频选段实际时长与指定时长不符。');
      return {
        buffer: await readFile(output),
        mimeType: 'video/mp4' as const,
        width: measured.width,
        height: measured.height,
        durationSeconds: measured.durationSeconds,
        referenceSha256: hash(input.reference.buffer),
        clipStartSeconds: clip.start,
        clipDurationSeconds: clip.length,
        audioIncluded: false as const,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw mediaError('参考视频选段编码失败，未提交视频模型。');
    }
  });
}

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { JobInput } from '../../contracts/jobs';
import { ProviderError, type NativeArtifact, type ProviderOutput } from '../tasks/types';
import { expectedNativeVideoSize } from './native-video-spec';

const exec = promisify(execFile);
const FPS = 24;
const HOLD_SECONDS = 0.5;

/** Re-time the model's complete temporal span; never synthesize motion from its first image.
 * No spatial filter is applied. The immutable raw asset remains the provenance source.
 */
export async function renderNativeVideoTailHold(
  input: JobInput,
  original: NativeArtifact,
): Promise<ProviderOutput> {
  if (
    input.providerId !== 'native' ||
    input.operation !== 'video.generate' ||
    input.nativePlan?.videoPostprocess !== 'model-video-tail-hold-v1' ||
    input.nativePlan.cameraControl?.type !== 'zoom' ||
    input.nativePlan.firstFrame?.mode !== 'reference' ||
    ![5, 10].includes(input.options.duration)
  )
    throw new ProviderError(
      '本任务没有已确认的静物变焦尾段停稳方案。',
      true,
      'NATIVE_TAIL_HOLD_INVALID',
    );
  const expected = expectedNativeVideoSize(input);
  if (!expected)
    throw new ProviderError('尾段停稳缺少已确认的视频规格。', true, 'NATIVE_TAIL_HOLD_INVALID');
  const directory = await mkdtemp(join(tmpdir(), 'yingzao-model-tail-hold-'));
  try {
    const sourcePath = join(directory, 'model-original.bin');
    const outputPath = join(directory, 'result.mp4');
    await writeFile(sourcePath, original.buffer);
    const { stdout } = await exec(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,width,height:frame=media_type,best_effort_timestamp_time',
        '-of',
        'json',
        sourcePath,
      ],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
    );
    const probe = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number }[];
      frames?: { media_type?: string; best_effort_timestamp_time?: string }[];
    };
    const videos = probe.streams?.filter((stream) => stream.codec_type === 'video') ?? [];
    const video = videos[0];
    const times = (probe.frames ?? [])
      .filter((frame) => frame.media_type === 'video')
      .map((frame) => Number(frame.best_effort_timestamp_time));
    const duration = Number(probe.format?.duration);
    if (
      videos.length !== 1 ||
      !video ||
      probe.streams?.some((stream) => stream.codec_type === 'audio') ||
      !Number.isFinite(duration) ||
      Math.abs(duration - input.options.duration) > 0.5 ||
      !video.width ||
      !video.height ||
      Math.abs(video.width - expected[0]) > 2 ||
      Math.abs(video.height - expected[1]) > 2 ||
      times.length < 2 ||
      times.some(
        (time, index) => !Number.isFinite(time) || (index > 0 && time <= times[index - 1]!),
      )
    )
      throw new ProviderError(
        '模型原片规格、音轨或时间戳不符合静物尾段处理要求，原片已保留。',
        true,
        'NATIVE_TAIL_HOLD_INVALID',
      );
    const sourceSpan = times.at(-1)! - times[0]!;
    const totalFrames = input.options.duration * FPS;
    const holdFrames = HOLD_SECONDS * FPS;
    const movingFrames = totalFrames - holdFrames;
    // Map the actual final model frame to the final moving frame, then append a hold.
    const movingSpan = (movingFrames - 1) / FPS;
    const filter = `setpts=(PTS-STARTPTS)*${movingSpan / sourceSpan},fps=${FPS}:eof_action=pass,trim=end_frame=${movingFrames},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${holdFrames}`;
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        sourcePath,
        '-map',
        '0:v:0',
        '-vf',
        filter,
        '-frames:v',
        String(totalFrames),
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '12',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '2',
        '-movflags',
        '+faststart',
        '-y',
        outputPath,
      ],
      { timeout: 180000, maxBuffer: 1024 * 1024 },
    );
    return {
      buffer: await readFile(outputPath),
      mimeType: 'video/mp4',
      name: '模型视频（尾段停稳）.mp4',
      text: `视频中间画面由视频模型生成，完整原片已保留。本机将原片完整时间范围按原顺序重采样至前${input.options.duration - HOLD_SECONDS}秒，末帧保持${HOLD_SECONDS}秒；未用静态首帧重建整段视频，主体几何仍需检查。`,
      processing: {
        method: 'model-video-tail-hold-v1',
        sourceAssetId: original.assetId,
        params: {
          sourceDuration: duration,
          sourceFrames: times.length,
          sourceLastTimestamp: times.at(-1)!,
          duration: input.options.duration,
          fps: FPS,
          movingFrames,
          holdFrames,
          holdSeconds: HOLD_SECONDS,
          spatialProcessing: 'none',
        },
      },
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      '本机尾段停稳暂时失败；模型原片已保存，可恢复处理，不会重新生成。',
      true,
      'NATIVE_TAIL_HOLD_PROCESSING',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

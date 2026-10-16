/** Official Wan background audio and O3 generated audio are separate capabilities.
 * https://fal.ai/models/wan/v2.6/text-to-video/api
 * https://fal.ai/models/fal-ai/kling-video/o3/4k/reference-to-video/api
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import type { JobInput } from '../../contracts/jobs';
import { ProviderError, type ExecutionContext } from '../tasks/types';
export type VideoAudioInput = JobInput & {
  backgroundAudioAssetId?: string;
  options: JobInput['options'] & { generateAudio?: boolean };
};
export interface VideoAudioAsset {
  id: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  durationMs?: number | null;
}
export const WAN_AUDIO_LIMIT = 15_000_000;
const isO3 = (input: VideoAudioInput) =>
  input.operation === 'video.generate' &&
  input.providerId === 'fal' &&
  input.options.model === 'kling-o3-4k-reference';
export function validateVideoAudioInput(input: VideoAudioInput, audio?: VideoAudioAsset) {
  if (input.options.generateAudio !== undefined && !isO3(input))
    throw new ProviderError('仅Kling O3参考模型支持独立生成音轨开关。');
  if (!input.backgroundAudioAssetId) return;
  if (
    input.operation !== 'video.generate' ||
    input.providerId !== 'fal' ||
    (input.options.model && input.options.model !== 'wan-2.6')
  )
    throw new ProviderError('独立背景音乐仅支持Wan2.6文字或单图视频；其他模型不会静默忽略。');
  if (!audio) return;
  if (
    audio.id !== input.backgroundAudioAssetId ||
    audio.kind !== 'audio' ||
    !['audio/mpeg', 'audio/wav'].includes(audio.mimeType) ||
    !Number.isSafeInteger(audio.byteSize) ||
    audio.byteSize <= 0 ||
    audio.byteSize > WAN_AUDIO_LIMIT ||
    !Number.isFinite(audio.durationMs) ||
    audio.durationMs! < 3000 ||
    audio.durationMs! > 30000
  )
    throw new ProviderError('Wan背景音乐须为MP3/WAV、3–30秒、不超过15MB。');
}
const exec = promisify(execFile);
export async function inspectBackgroundAudio(
  buffer: Buffer,
): Promise<{ mimeType: string; durationMs: number }> {
  if (!buffer.length || buffer.length > WAN_AUDIO_LIMIT)
    throw new ProviderError('背景音乐为空或超过15MB。');
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-audio-probe-'));
  try {
    const file = join(folder, 'audio');
    await writeFile(file, buffer, { mode: 0o600 });
    const { stdout } = await exec(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-show_entries',
        'format=duration,format_name:stream=codec_type:stream_disposition=attached_pic',
        '-of',
        'json',
        file,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    const value = z
      .object({
        format: z.object({ duration: z.string(), format_name: z.string() }),
        streams: z.array(
          z.object({
            codec_type: z.string(),
            disposition: z.object({ attached_pic: z.number() }).optional(),
          }),
        ),
      })
      .parse(JSON.parse(stdout));
    if (
      !value.streams.some((stream) => stream.codec_type === 'audio') ||
      value.streams.some(
        (stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic,
      )
    )
      throw new Error('Not audio-only');
    const mimeType = ({ mp3: 'audio/mpeg', wav: 'audio/wav' } as Record<string, string>)[
      value.format.format_name
    ];
    const durationMs = Math.round(Number(value.format.duration) * 1000);
    if (!mimeType || !Number.isFinite(durationMs) || durationMs < 3000 || durationMs > 30000)
      throw new Error('Unsupported format or duration');
    return { mimeType, durationMs };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('无法验证背景音乐原件，请使用3–30秒MP3/WAV并检查FFmpeg安装。');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
export async function buildVideoAudioRequest(
  context: Omit<ExecutionContext, 'input'> & { input: VideoAudioInput },
  probe: (
    buffer: Buffer,
  ) => Promise<{ mimeType: string; durationMs: number }> = inspectBackgroundAudio,
): Promise<Record<string, unknown>> {
  const input = context.input;
  validateVideoAudioInput(input);
  if (isO3(input)) return { generate_audio: input.options.generateAudio ?? false };
  if (!input.backgroundAudioAssetId) return {};
  const file = await context.readAsset(input.backgroundAudioAssetId);
  if (!file.buffer.length || file.buffer.length > WAN_AUDIO_LIMIT)
    throw new ProviderError('背景音乐为空或超过15MB。');
  const actual = await probe(file.buffer);
  validateVideoAudioInput(input, {
    id: input.backgroundAudioAssetId,
    kind: 'audio',
    mimeType: actual.mimeType,
    byteSize: file.buffer.length,
    durationMs: actual.durationMs,
  });
  if (actual.mimeType !== file.mimeType)
    throw new ProviderError('背景音乐原件类型与上传记录不符。');
  return { audio_url: `data:${actual.mimeType};base64,${file.buffer.toString('base64')}` };
}

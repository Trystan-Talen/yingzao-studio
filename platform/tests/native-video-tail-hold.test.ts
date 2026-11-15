/** Real local codecs; synthetic frames only, no provider or production data. */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobInputSchema } from '../src/contracts/jobs';
import { renderNativeVideoTailHold } from '../src/server/providers/native-video-tail-hold';
import type { NativeArtifact } from '../src/server/tasks/types';

const exec = promisify(execFile);
let directory: string;
let original: NativeArtifact;
function input() {
  const assetId = randomUUID();
  return jobInputSchema.parse({
    providerId: 'native',
    operation: 'video.generate',
    prompt: '静物中心等比放大103%，最后0.5秒停稳',
    assetIds: [assetId],
    nativePlan: {
      imagePrompt: '原图',
      videoPrompt: '中心变焦',
      firstFrame: { mode: 'reference', assetId },
      cameraControl: { type: 'zoom', scalePercent: 103 },
      videoPostprocess: 'model-video-tail-hold-v1',
    },
    options: { model: 'doubao-seedance-2.0', ratio: '1:1', resolution: '720p', duration: 5 },
  });
}
async function levels(path: string): Promise<number[]> {
  const { stdout } = await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      'scale=16:16,format=gray',
      '-f',
      'rawvideo',
      '-vsync',
      '0',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 },
  );
  return Array.from(
    { length: stdout.length / 256 },
    (_, i) => [...stdout.subarray(i * 256, (i + 1) * 256)].reduce((a, b) => a + b, 0) / 256,
  );
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yingzao-tail-codec-test-'));
  const path = join(directory, 'raw.mp4');
  // Every source frame has a distinct temporal signal. A first-image animation cannot pass.
  await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=black:s=960x960:r=24',
      '-vf',
      'geq=lum=16+N:cb=128:cr=128',
      '-frames:v',
      '121',
      '-c:v',
      'libx264',
      '-crf',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '2',
      '-y',
      path,
    ],
    { timeout: 60000 },
  );
  original = {
    assetId: randomUUID(),
    buffer: await readFile(path),
    mimeType: 'video/mp4',
    name: 'raw.mp4',
  };
}, 60000);
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('model video tail hold', () => {
  it('preserves the complete temporal range and final model frame, then freezes the final half-second', async () => {
    const frozen = Buffer.from(original.buffer);
    const result = await renderNativeVideoTailHold(input(), original);
    expect(original.buffer.equals(frozen)).toBe(true);
    expect(result.processing).toMatchObject({
      method: 'model-video-tail-hold-v1',
      sourceAssetId: original.assetId,
      params: { sourceFrames: 121, movingFrames: 108, holdFrames: 12, spatialProcessing: 'none' },
    });
    expect(result.text).toContain('完整原片已保留');
    const path = join(directory, 'processed.mp4');
    await writeFile(path, result.buffer!);
    const [source, processed] = await Promise.all([
      levels(join(directory, 'raw.mp4')),
      levels(path),
    ]);
    expect(source).toHaveLength(121);
    expect(processed).toHaveLength(120);
    expect(Math.abs(processed[0]! - source[0]!)).toBeLessThanOrEqual(2);
    expect(Math.abs(processed[107]! - source.at(-1)!)).toBeLessThanOrEqual(2);
    expect(Math.abs(processed.at(-1)! - source.at(-1)!)).toBeLessThanOrEqual(2);
    expect(Math.max(...processed.slice(108)) - Math.min(...processed.slice(108))).toBe(0);
    expect(processed[54]! - processed[0]!).toBeGreaterThan(50);
    expect(processed[107]! - processed[54]!).toBeGreaterThan(50);
    for (let index = 1; index < 108; index++)
      expect(processed[index]! - processed[index - 1]!).toBeGreaterThanOrEqual(-1);
    // Match the full duration's time mapping, not only its first and final frames.
    for (let index = 0; index < 108; index++) {
      const sourceIndex = Math.round((index * 120) / 107);
      expect(Math.abs(processed[index]! - source[sourceIndex]!)).toBeLessThanOrEqual(3);
    }
    const { stdout } = await exec('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=width,height,codec_type',
      '-of',
      'json',
      path,
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      format: { duration: '5.000000' },
      streams: [{ width: 960, height: 960, codec_type: 'video' }],
    });
  }, 60000);

  it('does not modify a previously frozen plan without a processing flag', async () => {
    const value = input();
    delete value.nativePlan!.videoPostprocess;
    await expect(renderNativeVideoTailHold(value, original)).rejects.toMatchObject({
      code: 'NATIVE_TAIL_HOLD_INVALID',
    });
  });

  it.each(['duration', 'size'] as const)(
    'rejects an incompatible raw %s instead of hiding it',
    async (kind) => {
      const value = input();
      if (kind === 'duration') value.options.duration = 10;
      else value.options.ratio = '16:9';
      await expect(renderNativeVideoTailHold(value, original)).rejects.toMatchObject({
        code: 'NATIVE_TAIL_HOLD_INVALID',
      });
    },
  );

  it('rejects an audio-bearing raw clip rather than silently changing its timing', async () => {
    const path = join(directory, 'audio.mp4');
    await exec('ffmpeg', [
      '-v',
      'error',
      '-i',
      join(directory, 'raw.mp4'),
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=mono',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      path,
    ]);
    await expect(
      renderNativeVideoTailHold(input(), { ...original, buffer: await readFile(path) }),
    ).rejects.toMatchObject({ code: 'NATIVE_TAIL_HOLD_INVALID' });
  });
});

/** Official motion-control contract and real local media fixtures; no paid inference or network. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import type { ExecutionContext } from '../src/server/tasks/types';
import { inspectFalVideo } from '../src/server/providers/fal-extra';
import {
  buildFalMotionRequest,
  FAL_MOTION_MODELS,
  isFalMotionModel,
  selectedMotionDuration,
  validateFalMotionInput,
  type FalMotionAsset,
} from '../src/server/providers/fal-motion';
import { falProvider } from '../src/server/providers/fal';
import { providerJson } from '../src/server/providers/http';
vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const exec = promisify(execFile),
  http = vi.mocked(providerJson);
const imageId = randomUUID(),
  videoId = randomUUID();
let folder: string, source: Buffer, image: Buffer;
const models = ['kling-2.6-motion-standard', 'kling-2.6-motion-pro'] as const;
function input(options: Record<string, unknown> = {}, changes: Partial<JobInput> = {}): JobInput {
  return jobInputSchema.parse({
    operation: 'video.motion-replica',
    providerId: 'fal',
    prompt: 'A person performing on a softly lit stage.',
    assetIds: [imageId],
    referenceAssetIds: [videoId],
    ...changes,
    options: {
      model: models[0],
      mode: 'exact',
      replacementType: 'model',
      ratio: 'auto',
      resolution: 'auto',
      duration: 4,
      trimStart: 2,
      trimEnd: 6,
      needText: false,
      motionOrientation: 'video',
      referenceAuthorized: true,
      ...options,
    },
  });
}
function assets(): FalMotionAsset[] {
  return [
    {
      id: imageId,
      kind: 'image',
      mimeType: 'image/png',
      width: 384,
      height: 512,
      byteSize: image.length,
    },
    {
      id: videoId,
      kind: 'video',
      mimeType: 'video/mp4',
      width: 360,
      height: 360,
      byteSize: source.length,
      durationMs: 8000,
    },
  ];
}
function context(value = input(), files = { image, source }): ExecutionContext {
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: value,
    readAsset: vi.fn(async (id) =>
      id === imageId
        ? { buffer: files.image, mimeType: 'image/png', name: 'person.png' }
        : { buffer: files.source, mimeType: 'video/mp4', name: 'movement.mp4' },
    ),
  };
}
function dataBytes(value: unknown) {
  return Buffer.from(String(value).split(',')[1]!, 'base64');
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-motion-fixture-'));
  image = await sharp({ create: { width: 384, height: 512, channels: 3, background: '#4768ad' } })
    .png()
    .toBuffer();
  const path = join(folder, 'source.mp4');
  await exec(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=360x360:r=24:d=2',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=360x360:r=24:d=4',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=360x360:r=24:d=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=8',
      '-filter_complex',
      '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
      '-map',
      '[v]',
      '-map',
      '3:a',
      '-t',
      '8',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-y',
      path,
    ],
    { timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  source = await readFile(path);
});
afterAll(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
});
beforeEach(() => vi.clearAllMocks());
describe('dedicated character motion transfer', () => {
  it('defensively refuses audio bytes in the common Wan first-image adapter before submission', async () => {
    const c = context(
      jobInputSchema.parse({
        operation: 'video.generate',
        providerId: 'fal',
        prompt: 'A product scene.',
        assetIds: [imageId],
        options: {
          model: 'wan-2.6',
          ratio: '1:1',
          resolution: '720p',
          duration: 5,
          needText: false,
        },
      }),
    );
    c.readAsset = async () => ({
      buffer: Buffer.from('audio fixture'),
      mimeType: 'audio/mpeg',
      name: 'audio.mp3',
    });
    await expect(falProvider.execute(c, 'fixture')).rejects.toThrow('图片');
    expect(http).not.toHaveBeenCalled();
  });
  it('publishes only the two real motion-control models and derives selected duration from source metadata', () => {
    expect(FAL_MOTION_MODELS.map((model) => model.id)).toEqual(models);
    expect(isFalMotionModel(models[0])).toBe(true);
    expect(isFalMotionModel('kling-o1-edit')).toBe(false);
    expect(selectedMotionDuration(input(), 8000)).toBe(4);
    expect(
      selectedMotionDuration(input({ trimStart: 0, trimEnd: undefined, duration: 8 }), 8000),
    ).toBe(8);
    expect(() => validateFalMotionInput(input(), assets())).not.toThrow();
  });
  it.each([
    { referenceAuthorized: false },
    { mode: 'creative' },
    { replacementType: 'face' },
    { ratio: '16:9' },
    { resolution: '720p' },
    { needText: true },
    { duration: 8 },
    { trimStart: 6, trimEnd: 2 },
    { trimEnd: 9 },
    { trimStart: 1, trimEnd: 3, duration: 2 },
  ])('rejects unsupported or misleading input before any submission: %j', (options) => {
    expect(() => validateFalMotionInput(input(options), assets())).toThrow();
    expect(http).not.toHaveBeenCalled();
  });
  it('allows a long original only when its selected clip satisfies the orientation-specific bound', () => {
    const long = assets();
    long[1]!.durationMs = 60000;
    expect(() =>
      validateFalMotionInput(input({ trimStart: 20, trimEnd: 50, duration: 30 }), long),
    ).not.toThrow();
    expect(() =>
      validateFalMotionInput(
        input({ trimStart: 20, trimEnd: 50, duration: 30, motionOrientation: 'image' }),
        long,
      ),
    ).toThrow();
    expect(() =>
      selectedMotionDuration(input({ trimStart: 0, trimEnd: undefined, duration: 60 }), 60000),
    ).toThrow();
  });
  it('checks exact image/video slots, missing assets, authorization-only extras and media bounds', () => {
    for (const changes of [
      { assetIds: [] },
      { referenceAssetIds: [] },
      { referenceAssetIds: [videoId, randomUUID()] },
      { maskAssetId: randomUUID() },
      { backgroundAssetId: randomUUID() },
      { brandId: randomUUID() },
      { characterId: randomUUID() },
    ])
      expect(() => validateFalMotionInput(input({}, changes), assets())).toThrow();
    expect(() => validateFalMotionInput(input(), assets().slice(0, 1))).toThrow();
    for (const change of [
      { width: 339 },
      { height: 3851 },
      { byteSize: 10 * 1024 * 1024 + 1 },
      { width: 340, height: 1000 },
      { kind: 'video' },
    ]) {
      const values = assets();
      Object.assign(values[0]!, change);
      expect(() => validateFalMotionInput(input(), values)).toThrow();
    }
    for (const change of [
      { width: 339 },
      { height: 3851 },
      { byteSize: 100 * 1024 * 1024 + 1 },
      { durationMs: null },
    ]) {
      const values = assets();
      Object.assign(values[1]!, change);
      expect(() => validateFalMotionInput(input(), values)).toThrow();
    }
  });
  it('routes every real field without sending fictional duration, aspect ratio, resolution or text controls', async () => {
    for (const model of models) {
      const original = Buffer.from('synthetic-original'),
        cropped = Buffer.from('synthetic-four-second-clip');
      const probe = vi.fn(async (bytes: Buffer) => ({
        width: 360,
        height: 360,
        fps: 24,
        duration: bytes.equals(cropped) ? 4 : 8,
      }));
      const trim = vi.fn(async () => cropped);
      const value = input({ model, keepMusicRhythm: false });
      const result = await buildFalMotionRequest(
        context(value, { image, source: original }),
        probe,
        trim,
      );
      expect(result.endpoint).toBe(
        `fal-ai/kling-video/v2.6/${model.endsWith('pro') ? 'pro' : 'standard'}/motion-control`,
      );
      expect(Object.keys(result.body).sort()).toEqual([
        'character_orientation',
        'enable_safety_checker',
        'image_url',
        'keep_original_sound',
        'prompt',
        'video_url',
      ]);
      expect(result.body).toMatchObject({
        prompt: value.prompt,
        character_orientation: 'video',
        keep_original_sound: false,
        enable_safety_checker: true,
      });
      expect(dataBytes(result.body.video_url)).toEqual(cropped);
      expect(trim).toHaveBeenCalledWith(original, { start: 2, end: 6, keepAudio: false });
      expect(probe).toHaveBeenCalledTimes(2);
    }
  });
  it('rechecks actual bytes and rejects corrupt images or a wrong-length crop before network calls', async () => {
    const probe = vi.fn(async () => ({ width: 360, height: 360, fps: 24, duration: 8 }));
    await expect(
      buildFalMotionRequest(
        context(input(), { image: Buffer.from('not an image'), source }),
        probe,
        async () => Buffer.from('crop'),
      ),
    ).rejects.toThrow();
    await expect(
      buildFalMotionRequest(context(), probe, async () => Buffer.from('crop')),
    ).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'physically extracts the blue 2–6s segment with keepAudio=%s',
    async (keepAudio) => {
      const result = await buildFalMotionRequest(context(input({ keepMusicRhythm: keepAudio })));
      const bytes = dataBytes(result.body.video_url);
      const metadata = await inspectFalVideo(bytes);
      expect(metadata.duration).toBeCloseTo(4, 1);
      const path = join(folder, `crop-${keepAudio}.mp4`);
      await writeFile(path, bytes);
      const audio = await exec(
        'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-select_streams',
          'a',
          '-show_entries',
          'stream=codec_type',
          '-of',
          'json',
          path,
        ],
        { timeout: 5000 },
      );
      expect(JSON.parse(audio.stdout).streams.length).toBe(keepAudio ? 1 : 0);
      const frame = await exec(
        'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          path,
          '-frames:v',
          '1',
          '-f',
          'image2pipe',
          '-vcodec',
          'png',
          'pipe:1',
        ],
        { timeout: 5000, encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 },
      );
      const stats = await sharp(frame.stdout).stats();
      expect(stats.channels[2]!.mean).toBeGreaterThan(200);
      expect(stats.channels[0]!.mean).toBeLessThan(40);
      expect(result.body.keep_original_sound).toBe(keepAudio);
    },
  );
  it('dispatches through the common fal queue and keeps common polling and cancellation', async () => {
    http.mockResolvedValueOnce({
      request_id: 'motion-fixture',
      status_url: 'https://queue.fal.run/fal-ai/kling-video/requests/motion-fixture/status',
      response_url: 'https://queue.fal.run/fal-ai/kling-video/requests/motion-fixture',
      cancel_url: 'https://queue.fal.run/fal-ai/kling-video/requests/motion-fixture/cancel',
    });
    const result = await falProvider.execute(context(), 'fixture-not-a-real-key');
    expect(result.state).toBe('submitted');
    expect(http.mock.calls[0]![0]).toBe(
      'https://queue.fal.run/fal-ai/kling-video/v2.6/standard/motion-control',
    );
    if (result.state !== 'submitted') throw new Error('Expected queued motion task');
    http.mockResolvedValueOnce({ status: 'COMPLETED' }).mockResolvedValueOnce({
      video: { url: 'https://fixture.example.local/output.mp4', content_type: 'video/mp4' },
    });
    expect((await falProvider.poll!(result.remote, 'fixture')).state).toBe('complete');
    http.mockResolvedValueOnce({});
    await falProvider.cancel!(result.remote, 'fixture');
    expect(http.mock.calls.at(-1)![1]).toMatchObject({ method: 'PUT' });
  });
});

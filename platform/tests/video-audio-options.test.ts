import sharp from 'sharp';
import { buildFalReferenceRequest } from '../src/server/providers/fal-reference';
import { it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { falProvider } from '../src/server/providers/fal';
import { randomUUID } from 'node:crypto';
import { jobInputSchema } from '../src/contracts/jobs';
import {
  validateVideoAudioInput,
  buildVideoAudioRequest,
  type VideoAudioInput,
} from '../src/server/providers/video-audio';
const aid = randomUUID();
function input(model = 'wan-2.6'): VideoAudioInput {
  return {
    ...jobInputSchema.parse({
      operation: 'video.generate',
      providerId: 'fal',
      prompt: 'Product film',
      options: {
        model,
        resolution: model === 'wan-2.6' ? '720p' : '4K',
        duration: 5,
        ratio: '1:1',
      },
    }),
    backgroundAudioAssetId: aid,
  };
}
const audio = { id: aid, kind: 'audio', mimeType: 'audio/mpeg', byteSize: 1000, durationMs: 5000 };
it('keeps music in a separate supported slot and rejects unsuitable types, sizes and durations', () => {
  expect(() => validateVideoAudioInput(input(), audio)).not.toThrow();
  for (const bad of [
    { ...audio, kind: 'video' },
    { ...audio, mimeType: 'audio/ogg' },
    { ...audio, byteSize: 15_000_001 },
    { ...audio, durationMs: 2999 },
    { ...audio, durationMs: 30001 },
  ])
    expect(() => validateVideoAudioInput(input(), bad)).toThrow();
  expect(() => validateVideoAudioInput(input('kling-o3-4k-reference'), audio)).toThrow();
  expect(() =>
    validateVideoAudioInput({ ...input(), operation: 'image.generate' }, audio),
  ).toThrow();
});
it('maps the O3 sound switch while refusing to pretend other standard models support it', async () => {
  const o3 = input('kling-o3-4k-reference');
  delete o3.backgroundAudioAssetId;
  o3.options.generateAudio = true;
  expect(await buildVideoAudioRequest({ input: o3 } as never)).toEqual({ generate_audio: true });
  o3.options.generateAudio = false;
  expect(await buildVideoAudioRequest({ input: o3 } as never)).toEqual({ generate_audio: false });
  const wan = input();
  wan.options.generateAudio = false;
  expect(() => validateVideoAudioInput(wan, audio)).toThrow();
});
it('rechecks actual background-audio bytes before building the official field', async () => {
  const buffer = Buffer.from('deterministic-local-audio');
  const context = {
    input: input(),
    readAsset: async (id: string) => {
      expect(id).toBe(aid);
      return { buffer, mimeType: 'audio/mpeg', name: 'fixture.mp3' };
    },
  };
  const request = await buildVideoAudioRequest(context as never, async () => ({
    mimeType: 'audio/mpeg',
    durationMs: 5000,
  }));
  expect(request.audio_url).toBe(`data:audio/mpeg;base64,${buffer.toString('base64')}`);
  await expect(
    buildVideoAudioRequest(context as never, async () => ({
      mimeType: 'video/mp4',
      durationMs: 5000,
    })),
  ).rejects.toThrow();
  await expect(
    buildVideoAudioRequest(context as never, async () => ({
      mimeType: 'audio/mpeg',
      durationMs: 1000,
    })),
  ).rejects.toThrow();
});

it('probes real WAV bytes and includes them in a stubbed Wan queue submission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yingzao-music-fixture-'));
  const fetch = vi.spyOn(globalThis, 'fetch');
  try {
    const file = join(dir, 'music.wav');
    await promisify(execFile)(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=330:duration=5',
        '-c:a',
        'pcm_s16le',
        '-y',
        file,
      ],
      { timeout: 15000 },
    );
    const buffer = await readFile(file),
      value = input();
    let calls = 0;
    fetch.mockImplementation(async (_url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body));
      expect(body.audio_url).toBe(`data:audio/wav;base64,${buffer.toString('base64')}`);
      expect(body.generate_audio).toBeUndefined();
      return new Response(
        JSON.stringify({
          request_id: 'audio-fixture',
          status_url: 'https://queue.fal.run/status/audio',
          response_url: 'https://queue.fal.run/result/audio',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await falProvider.execute(
      {
        input: value,
        readAsset: async (id: string) => {
          expect(id).toBe(aid);
          return { buffer, mimeType: 'audio/wav', name: 'fixture.wav' };
        },
      } as never,
      'fixture-not-a-key',
    );
    expect(result.state).toBe('submitted');
    expect(calls).toBe(1);
  } finally {
    fetch.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

it('keeps O3 text-language guidance separate from its actual sound switch', async () => {
  const value = input('kling-o3-4k-reference');
  delete value.backgroundAudioAssetId;
  value.assetIds = [randomUUID()];
  const buffer = await sharp({
    create: { width: 300, height: 300, channels: 3, background: '#446655' },
  })
    .png()
    .toBuffer();
  const build = () =>
    buildFalReferenceRequest({
      input: value,
      readAsset: async () => ({ buffer, mimeType: 'image/png', name: 'reference.png' }),
    } as never);
  value.options.language = 'th';
  value.options.needText = true;
  value.options.generateAudio = true;
  const enabled = await build();
  expect(enabled.body.generate_audio).toBe(true);
  expect(String(enabled.body.prompt)).toContain('use th');
  value.options.needText = false;
  value.options.generateAudio = false;
  const disabled = await build();
  expect(disabled.body.generate_audio).toBe(false);
  expect(String(disabled.body.prompt)).toContain('Do not add on-screen text');
  expect(disabled.body.prompt).not.toBe(enabled.body.prompt);
});

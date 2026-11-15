import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { jobInputSchema } from '../src/contracts/jobs';
import { renderExactPan } from '../src/server/providers/native-exact-pan';
import { createNativeProvider } from '../src/server/providers/native';
import type { ExecutionContext } from '../src/server/tasks/types';

const exec = promisify(execFile);
async function fixture(direction: 'left' | 'right') {
  const id = randomUUID();
  const source = await sharp({
    create: { width: 600, height: 600, channels: 3, background: '#d0e0e0' },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 120, height: 200, channels: 3, background: '#f00000' },
        })
          .png()
          .toBuffer(),
        left: 240,
        top: 200,
      },
    ])
    .png()
    .toBuffer();
  const context: ExecutionContext = {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse({
      providerId: 'native',
      operation: 'video.generate',
      prompt: '静态图精确平移，允许少量背景裁切。',
      assetIds: [id],
      nativePlan: {
        imagePrompt: '使用原图',
        videoPrompt: '本机精确取景',
        firstFrame: { mode: 'reference', assetId: id },
        cameraControl: { type: 'translate', direction, displacementPercent: 2 },
        motionRenderer: 'exact-pan-v1',
      },
      options: {
        model: 'doubao-seedance-2.0',
        ratio: '1:1',
        resolution: '720p',
        duration: 5,
        needText: false,
      },
    }),
    readAsset: vi.fn(async () => ({
      buffer: source,
      mimeType: 'image/png',
      name: 'reference.png',
    })),
    beforeAdditionalSubmission: vi.fn(() => {
      throw new Error('No model submission is permitted');
    }),
  };
  return context;
}

it.each(['count', 'audio', 'text', 'custom-size', 'model-command', 'background'] as const)(
  'rejects unsupported %s on the local provider route without reading credentials or assets',
  async (invalid) => {
    const context = await fixture('right');
    if (invalid === 'count') context.input.options.count = 2;
    if (invalid === 'audio') context.input.options.generateAudio = true;
    if (invalid === 'text') context.input.options.needText = true;
    if (invalid === 'custom-size') context.input.options.width = 720;
    if (invalid === 'model-command') context.input.prompt += ' --duration 10';
    if (invalid === 'background') context.input.backgroundAssetId = randomUUID();
    await expect(createNativeProvider({}).execute(context)).rejects.toThrow('本机处理范围');
    expect(context.readAsset).not.toHaveBeenCalled();
    expect(context.beforeAdditionalSubmission).not.toHaveBeenCalled();
  },
);

it.each(['left', 'right'] as const)(
  'renders a smooth %s camera pan with constant subject geometry and a stationary tail',
  async (direction) => {
    const context = await fixture(direction);
    const result = await renderExactPan(context, [240, 240]);
    if (result.state !== 'complete') throw new Error('Expected local completion');
    const output = result.outputs[0]!;
    expect(output.processing).toMatchObject({
      method: 'exact-pan-v1',
      sourceAssetId: context.input.assetIds[0],
      params: { edgeFill: 'none', fps: 24 },
    });
    expect(output.text).toContain('未调用视频模型');
    expect(context.beforeAdditionalSubmission).not.toHaveBeenCalled();
    const directory = await mkdtemp(join(tmpdir(), 'yingzao-pan-test-'));
    try {
      const path = join(directory, 'video.mp4'),
        pixels = join(directory, 'pixels.rgb');
      await writeFile(path, output.buffer!);
      const probe = JSON.parse(
        (await exec('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path])).stdout,
      );
      expect(probe.streams).toHaveLength(1);
      expect(probe.streams[0]).toMatchObject({
        width: 240,
        height: 240,
        nb_frames: '120',
        codec_type: 'video',
      });
      await exec('ffmpeg', [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        path,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        pixels,
      ]);
      const decoded = await readFile(pixels);
      const frames: { x: number; y: number; width: number; height: number }[] = [];
      for (let n = 0; n < 120; n++) {
        let totalX = 0,
          totalY = 0,
          weight = 0,
          count = 0,
          left = 240,
          right = 0,
          top = 240,
          bottom = 0;
        for (let y = 0; y < 240; y++)
          for (let x = 0; x < 240; x++) {
            const index = ((n * 240 + y) * 240 + x) * 3;
            const redWeight = Math.max(
              0,
              decoded[index]! - Math.max(decoded[index + 1]!, decoded[index + 2]!),
            );
            totalX += x * redWeight;
            totalY += y * redWeight;
            weight += redWeight;
            if (decoded[index]! > 180 && decoded[index + 1]! < 80 && decoded[index + 2]! < 80) {
              count++;
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
        expect(count).toBeGreaterThan(3000);
        frames.push({
          x: totalX / weight,
          y: totalY / weight,
          width: right - left + 1,
          height: bottom - top + 1,
        });
      }
      const span = (values: number[]) => Math.max(...values) - Math.min(...values);
      const delta = frames.at(-1)!.x - frames[0]!.x;
      expect(Math.abs(delta - (direction === 'left' ? 4.8 : -4.8))).toBeLessThan(0.35);
      expect(span(frames.map((f) => f.width))).toBeLessThanOrEqual(1);
      expect(span(frames.map((f) => f.height))).toBeLessThanOrEqual(1);
      expect(span(frames.map((f) => f.y))).toBeLessThan(0.2);
      expect(span(frames.slice(-12).map((f) => f.x))).toBeLessThan(0.2);
      // A requested deceleration must travel farther in each earlier equal-time
      // segment. Net displacement and a still tail alone miss an ease-in phase.
      const directionSign = direction === 'left' ? 1 : -1;
      const segments = [0, 36, 72].map((n) => (frames[n + 36]!.x - frames[n]!.x) * directionSign);
      expect(segments[0]! - segments[1]!).toBeGreaterThan(0.5);
      expect(segments[1]! - segments[2]!).toBeGreaterThan(0.5);
      for (let n = 1; n < frames.length; n++)
        expect((frames[n]!.x - frames[n - 1]!.x) * (direction === 'left' ? 1 : -1)).toBeGreaterThan(
          -0.1,
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);

it('rejects a forged source or missing renderer before reading the image', async () => {
  const context = await fixture('right');
  context.input.assetIds = [];
  await expect(renderExactPan(context, [240, 240])).rejects.toThrow('缺少');
  expect(context.readAsset).not.toHaveBeenCalled();
});

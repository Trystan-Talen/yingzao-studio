import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { nativeMotionEndFrame } from '../src/server/providers/native-motion-frame';
import { nativeVideoSubmission } from '../src/server/providers/native-video-route';
import { supportsNativeMotionEndpoints } from '../src/contracts/native-plan';

describe('deterministic tiny-pan endpoint', () => {
  it.each(['left', 'right'] as const)(
    'copies the full interior pixel-for-pixel for a %s camera movement',
    async (direction) => {
      const width = 600,
        height = 400,
        channels = 3;
      const data = Buffer.alloc(width * height * channels);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * channels;
          data[i] = x % 256;
          data[i + 1] = y % 256;
          data[i + 2] = (x + y) % 256;
        }
      const source = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
      const result = await nativeMotionEndFrame(source, {
        type: 'translate',
        direction,
        displacementPercent: 2,
      });
      const actual = await sharp(result).raw().toBuffer({ resolveWithObject: true });
      expect(actual.info).toMatchObject({ width, height, channels });
      const shift = 12;
      for (let y = 0; y < height; y++) {
        const from = (y * width + (direction === 'right' ? shift : 0)) * channels;
        const to = (y * width + (direction === 'left' ? shift : 0)) * channels;
        expect(
          actual.data
            .subarray(to, to + (width - shift) * channels)
            .equals(data.subarray(from, from + (width - shift) * channels)),
        ).toBe(true);
      }
    },
  );
  it.each([0, 4, NaN, Infinity])(
    'rejects unsupported displacement %s',
    async (displacementPercent) => {
      const source = await sharp({
        create: { width: 512, height: 512, channels: 3, background: '#ddd' },
      })
        .png()
        .toBuffer();
      await expect(
        nativeMotionEndFrame(source, {
          type: 'translate',
          direction: 'right',
          displacementPercent,
        }),
      ).rejects.toThrow();
    },
  );
  it.each([
    ['https://xingyunyinli.com/doubao/api/v3/contents/generations/tasks', true],
    ['https://fixture.example/api/v3/contents/generations/tasks', false],
  ])('preserves first/last roles through %s', (endpoint, proxy) => {
    const result = nativeVideoSubmission(endpoint as string, {
      model: 'doubao-seedance-2.0',
      prompt: 'same static scene, tiny linear motion',
      frameUrl: 'data:image/png;base64,first',
      lastFrameUrl: 'data:image/png;base64,last',
      resolution: '720p',
      ratio: '1:1',
      duration: 5,
    });
    const body = result.body as { metadata?: { content: unknown[] }; content?: unknown[] };
    const frames = proxy ? body.metadata!.content : body.content!.slice(1);
    expect(frames).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,first' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,last' }, role: 'last_frame' },
    ]);
  });
  it('does not treat arbitrary relay aliases or later model generations as a verified feature', () => {
    expect(supportsNativeMotionEndpoints('doubao-seedance-2.0')).toBe(true);
    expect(supportsNativeMotionEndpoints('doubao-seedance-2.0-fast')).toBe(true);
    for (const model of [
      'seedance-alias',
      'doubao-seedance-1.0',
      'doubao-seedance-2.5',
      'doubao-seedance-2.0-unverified',
    ])
      expect(supportsNativeMotionEndpoints(model)).toBe(false);
  });
});

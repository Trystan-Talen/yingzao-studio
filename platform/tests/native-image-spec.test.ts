import { describe, expect, it } from 'vitest';
import { jobInputSchema } from '../src/contracts/jobs';
import {
  nativeImageSpecification,
  validateNativeImageArtifact,
} from '../src/server/providers/native-image-spec';

function input(ratio = '1:1', resolution = '2K') {
  return jobInputSchema.parse({
    providerId: 'native',
    operation: 'image.generate',
    prompt: '测试商品图',
    options: { model: 'fixture-image', ratio, resolution, needText: false },
  });
}
describe('native image requested and measured specifications', () => {
  it.each([
    ['seedream-images', '1:1', '2K', '2048x2048', 2048, 2048],
    ['seedream-images', '16:9', '2K', '2848x1600', 2848, 1600],
    ['seedream-images', '9:16', '2K', '1600x2848', 1600, 2848],
    ['seedream-images', '16:9', '3K', '4096x2304', 4096, 2304],
    ['seedream-images', '1:1', '3K', '3072x3072', 3072, 3072],
    ['openai-images', '1:1', '1K', '1024x1024', 1024, 1024],
    ['openai-images', '16:9', '1K', '1536x864', 1536, 864],
    ['openai-images', '9:16', '1K', '864x1536', 864, 1536],
    ['openai-images', '1:1', '2K', '2048x2048', 2048, 2048],
    ['openai-images', '16:9', '2K', '2048x1152', 2048, 1152],
  ])(
    'uses the actual %s request size for %s %s',
    (protocol, ratio, resolution, size, width, height) => {
      expect(
        nativeImageSpecification(input(String(ratio), String(resolution)), String(protocol)),
      ).toEqual({
        size,
        width,
        height,
      });
    },
  );
  it.each([
    ['seedream-images', '2848x1600', 2848, 1600],
    ['openai-images', '1536x864', 1536, 864],
  ])(
    'uses the %s first-frame request specification independently of video resolution',
    (protocol, size, width, height) => {
      expect(nativeImageSpecification(input('16:9', '720p'), String(protocol), true)).toEqual({
        size,
        width,
        height,
      });
    },
  );
  it.each([
    ['seedream-images', 'auto', '2K'],
    ['seedream-images', '1:1', '1K'],
    ['seedream-images', '1:1', '4K'],
    ['openai-images', 'auto', '2K'],
    ['openai-images', '1:1', '3K'],
    ['unknown-images', '1:1', '2K'],
  ])(
    'rejects unsupported %s %s %s rather than choosing a fallback',
    (protocol, ratio, resolution) => {
      expect(() => nativeImageSpecification(input(ratio, resolution), protocol)).toThrow(
        '没有有效像素规格',
      );
    },
  );
  it.each([
    [2048, 2048],
    [2046, 2050],
    [2050, 2046],
  ])('accepts measured dimensions %s×%s within two pixels', (width, height) => {
    expect(() =>
      validateNativeImageArtifact({ width: 2048, height: 2048 }, { width, height }),
    ).not.toThrow();
  });
  it.each([
    [512, 512],
    [2045, 2048],
    [2048, 2051],
    [null, 2048],
    [2048, null],
    [NaN, 2048],
    [Infinity, 2048],
    [0, 2048],
    [-1, 2048],
    [2048.5, 2048],
  ])('holds invalid or mismatched measured dimensions %s×%s', (width, height) => {
    expect(() =>
      validateNativeImageArtifact({ width: 2048, height: 2048 }, { width, height }),
    ).toThrow(expect.objectContaining({ ambiguous: true, code: 'NATIVE_IMAGE_SPEC_MISMATCH' }));
  });
  it.each([
    undefined,
    { width: 0, height: 2048 },
    { width: 2048, height: -1 },
    { width: Infinity, height: 2048 },
    { width: 2048, height: 2048.5 },
  ])('holds cached results with missing or invalid trusted request metadata: %s', (expected) => {
    expect(() => validateNativeImageArtifact(expected, { width: 2048, height: 2048 })).toThrow(
      expect.objectContaining({ ambiguous: true, code: 'NATIVE_IMAGE_SPEC_MISMATCH' }),
    );
  });
});

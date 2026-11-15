import { describe, expect, it } from 'vitest';
import { jobInputSchema } from '../src/contracts/jobs';
import { nativeVideoModel, validateNativeVideoArtifact } from '../src/server/providers/native';

function input(ratio = '1:1', resolution = '720p') {
  return jobInputSchema.parse({
    providerId: 'native',
    operation: 'video.generate',
    prompt: '保持首帧完整构图。',
    options: { model: 'doubao-seedance-2.0', ratio, resolution, duration: 5, needText: false },
  });
}

// Independently transcribed from the official Seedance 2.0 720p output table, not derived
// from the implementation's mapping or an assumed fixed short edge.
// https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh
const documented = [
  ['16:9', 1280, 720],
  ['9:16', 720, 1280],
  ['1:1', 960, 960],
  ['4:3', 1112, 834],
  ['3:4', 834, 1112],
  ['21:9', 1470, 630],
] as const;

describe('native video measured dimensions', () => {
  it.each([
    'doubao-seedance-2.0',
    'doubao-seedance-2.0-fast',
    'doubao-seedance-2.0-mini',
    'doubao-seedance-2-0-260128',
    'DOUBAO-SEEDANCE-2.0-FAST',
  ])('recognizes the verified Seedance 2.0 family alias %s', (model) => {
    const value = input();
    value.options.model = model;
    expect(() =>
      validateNativeVideoArtifact(value, { width: 960, height: 960, durationMs: 5042 }),
    ).not.toThrow();
  });
  it('does not silently assign Seedance 2.0 output sizes to an unknown gateway alias', () => {
    const value = input();
    value.options.model = 'custom-relay-model';
    expect(() =>
      validateNativeVideoArtifact(value, { width: 960, height: 960, durationMs: 5042 }),
    ).toThrow();
    expect(() =>
      validateNativeVideoArtifact(value, { width: 720, height: 720, durationMs: 5042 }),
    ).not.toThrow();
  });
  it.each(documented)('accepts documented 720p %s as %s by %s', (ratio, width, height) => {
    expect(() =>
      validateNativeVideoArtifact(input(ratio), { width, height, durationMs: 5042 }),
    ).not.toThrow();
  });
  it('has a verified size for every offered ratio', () => {
    expect(nativeVideoModel('doubao-seedance-2.0').ratios).toEqual(
      documented.map(([ratio]) => ratio),
    );
  });
  it.each([
    ['1:1', 720, 720],
    ['4:3', 960, 720],
    ['3:4', 720, 960],
    ['21:9', 1680, 720],
  ] as const)(
    'rejects the old fixed-short-edge assumption for %s (%s by %s)',
    (ratio, width, height) => {
      expect(() =>
        validateNativeVideoArtifact(input(ratio), { width, height, durationMs: 5042 }),
      ).toThrow('实际规格与已确认参数不符');
    },
  );
  it('does not accept a different pixel area just because the aspect ratio is correct', () => {
    expect(() =>
      validateNativeVideoArtifact(input(), { width: 1024, height: 1024, durationMs: 5042 }),
    ).toThrow('应为960×960');
  });
  it.each([
    { width: 958, height: 962, durationMs: 4500 },
    { width: 962, height: 958, durationMs: 5500 },
  ])('keeps the existing bounded encoder tolerance: %o', (artifact) => {
    expect(() => validateNativeVideoArtifact(input(), artifact)).not.toThrow();
  });
  it.each([
    { width: 957, height: 960, durationMs: 5000 },
    { width: 960, height: 963, durationMs: 5000 },
    { width: 960, height: 960, durationMs: 4499 },
    { width: 960, height: 960, durationMs: 5501 },
    { width: Number.NaN, height: 960, durationMs: 5000 },
    { width: 960, height: Number.POSITIVE_INFINITY, durationMs: 5000 },
    { width: 960, height: 960, durationMs: Number.NaN },
    { width: null, height: 960, durationMs: 5000 },
  ])('rejects out-of-bound or unavailable measured metadata: %o', (artifact) => {
    expect(() => validateNativeVideoArtifact(input(), artifact)).toThrow(
      '实际规格与已确认参数不符',
    );
  });
  it.each([
    ['2:1', '720p'],
    ['1:1', '1080p'],
    ['constructor', '720p'],
  ])('rejects an unverified requested configuration %s / %s', (ratio, resolution) => {
    expect(() =>
      validateNativeVideoArtifact(input(ratio, resolution), {
        width: 960,
        height: 960,
        durationMs: 5000,
      }),
    ).toThrow('缺少已核实的像素规格');
  });
});

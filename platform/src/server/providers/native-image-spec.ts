import type { JobInput } from '../../contracts/jobs';
import { ProviderError } from '../tasks/types';
import { seedreamSize } from './documented-models';
import { imageSize } from './openai';

export interface NativeImageSpecification {
  size: string;
  width: number;
  height: number;
}
export const NATIVE_OPENAI_IMAGE_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '21:9',
];

/** One source for the actual wire size and the server-owned acceptance expectation. */
export function nativeImageSpecification(
  input: JobInput,
  protocol: string,
  forVideo = false,
): NativeImageSpecification {
  const seedream = protocol === 'seedream-images';
  const resolution = forVideo ? (seedream ? '2K' : '1K') : input.options.resolution;
  const supported = seedream
    ? ['2K', '3K'].includes(resolution)
    : protocol === 'openai-images' &&
      ['1K', '2K'].includes(resolution) &&
      NATIVE_OPENAI_IMAGE_RATIOS.includes(input.options.ratio);
  const size = supported
    ? seedream
      ? seedreamSize(input.options.ratio, resolution)
      : imageSize(input.options.ratio, resolution)
    : undefined;
  if (!size || !/^\d+x\d+$/.test(size))
    throw new ProviderError('图片请求的画幅或清晰度没有有效像素规格，请重新选择。');
  const [width, height] = size.split('x').map(Number);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width! <= 0 || height! <= 0)
    throw new ProviderError('图片请求像素规格无效，请重新选择。');
  return { size, width: width!, height: height! };
}

/** Requested settings are not output evidence. Only measured dimensions satisfy this check. */
export function validateNativeImageArtifact(
  expected: { width: number; height: number } | undefined,
  actual: { width: number | null; height: number | null },
): void {
  if (
    !expected ||
    !Number.isSafeInteger(expected.width) ||
    !Number.isSafeInteger(expected.height) ||
    expected.width <= 0 ||
    expected.height <= 0
  )
    throw new ProviderError(
      '图片结果缺少可信的原始请求像素规格；已保留原件，需核对已有结果，不会重新生成。',
      true,
      'NATIVE_IMAGE_SPEC_MISMATCH',
    );
  if (
    !Number.isSafeInteger(actual.width) ||
    !Number.isSafeInteger(actual.height) ||
    !actual.width ||
    !actual.height ||
    actual.width <= 0 ||
    actual.height <= 0 ||
    Math.abs(actual.width - expected.width) > 2 ||
    Math.abs(actual.height - expected.height) > 2
  )
    throw new ProviderError(
      `图片实际规格与原始请求不符：应为${expected.width}×${expected.height}像素，实际为${actual.width ?? '未知'}×${actual.height ?? '未知'}像素。原始结果已保留，未标记生成成功，请核对服务商结果。`,
      true,
      'NATIVE_IMAGE_SPEC_MISMATCH',
    );
}

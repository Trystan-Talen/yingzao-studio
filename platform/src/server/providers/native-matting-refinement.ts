import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { NativeImageEdit } from '../../contracts/native-image-edit';
import { ProviderError } from '../tasks/types';

const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
/** S/a0/R0 are immutable. Every later edit is evaluated against that same root. */
export async function composeMattingRefinement(input: {
  source: Buffer;
  baselineMask: Buffer;
  baselineResult: Buffer;
  mask: Buffer;
  baseline: NonNullable<NativeImageEdit['mattingBaseline']>;
  color: string;
}): Promise<Buffer> {
  const fail = () =>
    new ProviderError(
      '自动抠图基线原件或尺寸不匹配，已停止；不会重算基线或调用模型。',
      true,
      'NATIVE_CHECKPOINT_INVALID',
    );
  if (
    sha(input.source) !== input.baseline.sourceSha256 ||
    sha(input.baselineMask) !== input.baseline.maskSha256 ||
    sha(input.baselineResult) !== input.baseline.resultSha256 ||
    input.color.toLowerCase() !== input.baseline.color.toLowerCase()
  )
    throw fail();
  const original = await sharp(input.source, { limitInputPixels: 36_000_000 })
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = await sharp(input.baselineResult, { limitInputPixels: 36_000_000 })
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const oldMask = await sharp(input.baselineMask, { limitInputPixels: 36_000_000 })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = await sharp(input.mask, { limitInputPixels: 36_000_000 })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    [result, oldMask, mask].some(
      (value) =>
        value.info.width !== original.info.width || value.info.height !== original.info.height,
    )
  )
    throw fail();
  if (mask.data.equals(oldMask.data)) return input.baselineResult;
  const color = [1, 3, 5].map((offset) => parseInt(input.color.slice(offset, offset + 2), 16));
  if (!/^#[a-f0-9]{6}$/i.test(input.color)) throw fail();
  const output = Buffer.from(result.data);
  for (let pixel = 0; pixel < mask.data.length; pixel++) {
    const a = mask.data[pixel]!,
      a0 = oldMask.data[pixel]!;
    if (a === a0) continue;
    for (let channel = 0; channel < 4; channel++) {
      const i = pixel * 4 + channel,
        source = original.data[i]!,
        before = result.data[i]!,
        target = channel === 3 ? 255 : color[channel]!;
      output[i] =
        a === 0
          ? source
          : a === 255
            ? target
            : a < a0
              ? Math.round(source + ((before - source) * a) / a0)
              : Math.round(before + ((target - before) * (a - a0)) / (255 - a0));
    }
  }
  return sharp(output, { raw: original.info }).png().toBuffer();
}

import sharp from 'sharp';
import { ProviderError } from '../tasks/types';
import { LOCAL_MATTING_MAX_PIXELS } from './local-matting-version';

const invalid = () =>
  new ProviderError(
    '候选不是可验证的双峰黑白区域蒙版，原件已保留；不会重新付费生成。',
    true,
    'BACKGROUND_MASK_INVALID',
  );

/** Only local-matting-v2: admit two narrow, far-separated neutral plateaus.
 * This checks encoding, not whether the proposed editing region is correct.
 * The returned binary image is a diagnostic baseline; the solver reads raw bytes. */
export async function normalizeLocalMattingSemanticMask(
  buffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const decoder = sharp(buffer, { limitInputPixels: LOCAL_MATTING_MAX_PIXELS });
  const metadata = await decoder.metadata();
  if (
    metadata.width !== width ||
    metadata.height !== height ||
    (metadata.orientation && metadata.orientation !== 1)
  )
    throw new ProviderError(
      '模型蒙版尺寸或方向与原图不符，原件已保留；不会拉伸或重新生成。',
      true,
      'BACKGROUND_MASK_SIZE',
    );
  if ((metadata.pages || 1) !== 1) throw invalid();
  const image = await decoder.toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const count = width * height,
    histogram = new Uint32Array(256),
    baseline = Buffer.alloc(count);
  let colored = 0,
    transparent = false;
  for (let pixel = 0; pixel < count; pixel++) {
    const r = image[pixel * 4]!,
      g = image[pixel * 4 + 1]!,
      b = image[pixel * 4 + 2]!;
    if (image[pixel * 4 + 3] !== 255) transparent = true;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12) colored++;
    const value = Math.round((r + g + b) / 3);
    histogram[value] = histogram[value]! + 1;
    baseline[pixel] = value >= 128 ? 255 : 0;
  }
  const mass = (start: number, end: number) =>
    histogram.slice(start, end + 1).reduce((sum, value) => sum + value, 0);
  const dark = mass(0, 32),
    light = mass(223, 255),
    transition = count - dark - light;
  const concentrated = (start: number, end: number, total: number) => {
    let peak = start;
    for (let value = start + 1; value <= end; value++)
      if (histogram[value]! > histogram[peak]!) peak = value;
    return mass(Math.max(start, peak - 8), Math.min(end, peak + 8)) / total >= 0.9;
  };
  if (
    transparent ||
    colored / count > 0.005 ||
    transition / count > 0.08 ||
    dark / count < 0.005 ||
    light / count < 0.005 ||
    !concentrated(0, 32, dark) ||
    !concentrated(223, 255, light)
  )
    throw invalid();
  return sharp(baseline, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

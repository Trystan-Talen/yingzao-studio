import sharp from 'sharp';
import { sourceBoundaryProfiles } from './native-background-contours';

export interface BackgroundCalibrationStats {
  algorithm: 'source-guided-v1';
  radius: number;
  workingWidth: number;
  workingHeight: number;
  boundaryPixels: number;
  changedPixels: number;
  removedInteriorGrayPixels: number;
  ambiguousBoundaryPixels: number;
  preservedThinPixels: number;
  bottomEditableFraction: number;
  unsupportedSurfaceBoundaryPixels: number;
  skippedContours: number;
  measuredContourFraction: number;
  warnings: string[];
}

/** Truncated-window means avoid inventing samples beyond the image border. */
function boxMean(input: Float32Array, width: number, height: number, radius: number) {
  const horizontal = new Float32Array(input.length);
  const output = new Float32Array(input.length);
  const sums = new Float64Array(Math.max(width, height) + 1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    sums[0] = 0;
    for (let x = 0; x < width; x++) sums[x + 1] = sums[x]! + input[row + x]!;
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius),
        right = Math.min(width, x + radius + 1);
      horizontal[row + x] = (sums[right]! - sums[left]!) / (right - left);
    }
  }
  for (let x = 0; x < width; x++) {
    sums[0] = 0;
    for (let y = 0; y < height; y++) sums[y + 1] = sums[y]! + horizontal[y * width + x]!;
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius),
        bottom = Math.min(height, y + radius + 1);
      output[y * width + x] = (sums[bottom]! - sums[top]!) / (bottom - top);
    }
  }
  return output;
}

/** Manhattan distance to the closest pixel selected by the predicate; bounded memory/time. */
function distanceField(
  mask: Buffer,
  width: number,
  height: number,
  selected: (value: number) => boolean,
) {
  const distance = new Uint16Array(mask.length);
  const far = 32767;
  for (let i = 0; i < mask.length; i++) distance[i] = selected(mask[i]!) ? 0 : far;
  for (let i = 0; i < mask.length; i++) {
    if (i % width) distance[i] = Math.min(distance[i]!, distance[i - 1]! + 1);
    if (i >= width) distance[i] = Math.min(distance[i]!, distance[i - width]! + 1);
  }
  for (let i = mask.length - 1; i >= 0; i--) {
    if (i % width < width - 1) distance[i] = Math.min(distance[i]!, distance[i + 1]! + 1);
    if (i < width * (height - 1)) distance[i] = Math.min(distance[i]!, distance[i + width]! + 1);
  }
  return distance;
}

/** Do not remove sub-sampling-sized holes, wires or narrow protected details. */
function isThinFeature(mask: Buffer, index: number, width: number, height: number, limit: number) {
  const label = mask[index]! >= 128,
    x = index % width,
    y = Math.floor(index / width);
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ] as const) {
    let negative = 0,
      positive = 0;
    while (
      negative <= limit &&
      x - negative * dx >= 0 &&
      y - negative * dy >= 0 &&
      mask[index - negative * (dx + dy * width)]! >= 128 === label
    )
      negative++;
    while (
      positive <= limit &&
      x + positive * dx < width &&
      y + positive * dy < height &&
      mask[index + positive * (dx + dy * width)]! >= 128 === label
    )
      positive++;
    if (
      negative <= limit &&
      positive <= limit &&
      negative + positive - 1 <= limit &&
      x - negative * dx >= 0 &&
      y - negative * dy >= 0 &&
      x + positive * dx < width &&
      y + positive * dy < height
    )
      return true;
  }
  return false;
}

/** Local color-line matting uses known sides of a proposed boundary, with residual
 * and contrast checks. This calibrates a boundary, not semantic segmentation. It never
 * consumes a reviewed mask, infers a horizon, or edits outside the bounded mask band.
 * The local smooth-color assumption is described by Levin/Lischinski/Weiss:
 * https://people.csail.mit.edu/alevin/papers/Matting-Levin-Lischinski-Weiss-CVPR06.pdf */
export async function calibrateNativeBackgroundMask(
  sourceBuffer: Buffer,
  maskBuffer: Buffer,
  options: { preserveSurface?: boolean } = {},
): Promise<{ buffer: Buffer; stats: BackgroundCalibrationStats }> {
  const source = await sharp(sourceBuffer, { limitInputPixels: 36_000_000 })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const decoded = await sharp(maskBuffer, { limitInputPixels: 36_000_000 })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = source.info;
  if (decoded.info.width !== width || decoded.info.height !== height)
    throw new Error('背景校准要求原图与候选蒙版尺寸一致。');
  const radius = Math.max(4, Math.min(32, Math.round(Math.min(width, height) / 64)));
  const band = radius * 2;
  const mask = Buffer.from(decoded.data);
  const distanceToWhite = distanceField(mask, width, height, (value) => value === 255);
  let removedInteriorGrayPixels = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]! > 0 && mask[i]! < 255 && distanceToWhite[i]! > band) {
      mask[i] = 0;
      removedInteriorGrayPixels++;
    }
  }
  const binary = Buffer.from(Uint8Array.from(mask, (value) => (value >= 128 ? 255 : 0)));
  const toProtected = distanceField(binary, width, height, (value) => value === 0);
  const toEdited = distanceField(binary, width, height, (value) => value === 255);
  const scale = Math.max(1, Math.max(width, height) / 1024);
  const smallWidth = Math.max(1, Math.round(width / scale)),
    smallHeight = Math.max(1, Math.round(height / scale)),
    count = smallWidth * smallHeight;
  const guide = await sharp(source.data, { raw: source.info })
    .resize(smallWidth, smallHeight, { kernel: 'linear' })
    .raw()
    .toBuffer();
  const proposal = await sharp(binary, { raw: { width, height, channels: 1 } })
    .resize(smallWidth, smallHeight, { kernel: 'linear' })
    .greyscale()
    .raw()
    .toBuffer();
  const fields = Array.from({ length: 4 }, () => new Float32Array(count));
  for (let i = 0; i < count; i++) {
    for (let channel = 0; channel < 3; channel++)
      fields[channel]![i] = guide[i * 3 + channel]! / 255;
    fields[3]![i] = proposal[i]! / 255;
  }
  const smallRadius = Math.max(1, Math.round(radius / scale));
  const localColor = fields.slice(0, 3).map((field) => boxMean(field, smallWidth, smallHeight, 1));
  const boundary = sourceBoundaryProfiles(
    fields[3]!,
    localColor,
    smallWidth,
    smallHeight,
    smallRadius,
    scale,
  );
  const result = Buffer.from(mask);
  let boundaryPixels = 0,
    changedPixels = 0,
    ambiguousBoundaryPixels = 0,
    preservedThinPixels = 0;
  for (let i = 0; i < mask.length; i++) {
    const distance = Math.max(toProtected[i]!, toEdited[i]!);
    if (distance > band) continue;
    boundaryPixels++;
    const x = (((i % width) + 0.5) * smallWidth) / width - 0.5,
      y = ((Math.floor(i / width) + 0.5) * smallHeight) / height - 0.5;
    if (isThinFeature(binary, i, width, height, Math.max(2, Math.ceil(scale * 2)))) {
      preservedThinPixels++;
      continue;
    }
    const nearestIndex =
      Math.max(0, Math.min(smallHeight - 1, Math.round(y))) * smallWidth +
      Math.max(0, Math.min(smallWidth - 1, Math.round(x)));
    const id = boundary.nearest[nearestIndex]!;
    const p = boundary.profiles[id];
    if (!p || !p.confidence) {
      ambiguousBoundaryPixels++;
      continue;
    }
    if (!p.calibrate || p.locked || p.width * scale < 6) continue;
    const position = (x - p.x) * p.nx + (y - p.y) * p.ny;
    const t = Math.max(0, Math.min(1, 0.5 + (position - p.offset) / p.width));
    const alpha = Math.round(t * t * (3 - 2 * t) * 255);
    const strength =
      (distance <= radius ? 1 : (band - distance) / radius) *
      p.confidence *
      Math.max(0, Math.min(1, (p.width * scale - 6) / 6));
    result[i] = Math.round(mask[i]! * (1 - strength) + alpha * strength);
    if (result[i] !== decoded.data[i]) changedPixels++;
  }
  let bottomEdited = 0;
  const bottomStart = width * (height - Math.max(1, Math.round(height * 0.03)));
  for (let i = bottomStart; i < mask.length; i++) bottomEdited += result[i]! / 255;
  const bottomEditableFraction = bottomEdited / (mask.length - bottomStart);
  // A black bottom row alone cannot prove that the supporting plane was protected.
  // Long, unobserved horizontal contours are flagged; no horizon is fabricated here.
  const unsupportedSurfaceBoundaryPixels =
    boundary.profiles.filter((p) => !p.measured && Math.abs(p.ny) > 0.7).length * scale;
  const warnings: string[] = [];
  if (boundary.skippedContours) warnings.push('CONTOUR_CALIBRATION_SKIPPED');
  if (options.preserveSurface && bottomEditableFraction > 0.05)
    warnings.push('SURFACE_PROTECTION_UNCERTAIN');
  if (options.preserveSurface && unsupportedSurfaceBoundaryPixels > width * 0.25)
    warnings.push('SURFACE_BOUNDARY_UNCERTAIN');
  if (boundaryPixels && ambiguousBoundaryPixels / boundaryPixels > 0.15)
    warnings.push('LOW_CONTRAST_BOUNDARY');
  return {
    buffer: await sharp(result, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer(),
    stats: {
      algorithm: 'source-guided-v1',
      radius,
      workingWidth: smallWidth,
      workingHeight: smallHeight,
      boundaryPixels,
      changedPixels,
      removedInteriorGrayPixels,
      ambiguousBoundaryPixels,
      preservedThinPixels,
      bottomEditableFraction,
      unsupportedSurfaceBoundaryPixels,
      skippedContours: boundary.skippedContours,
      measuredContourFraction:
        boundary.profiles.filter((p) => p.measured).length / Math.max(1, boundary.profiles.length),
      warnings,
    },
  };
}

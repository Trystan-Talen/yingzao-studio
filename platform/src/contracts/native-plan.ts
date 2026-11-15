import { z } from 'zod';

/** An explicit planner decision, frozen by the server. Missing means legacy generation. */
export const nativeFirstFrameSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('generate') }).strict(),
  z.object({ mode: z.literal('reference'), assetId: z.string().uuid() }).strict(),
]);

/** Only narrowly scoped, confirmed static-scene motion can synthesize an endpoint. */
export const nativeCameraControlSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('translate'),
      direction: z.enum(['left', 'right']),
      displacementPercent: z.number().min(1).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal('zoom'),
      // Final scale relative to the first frame: 103 means a three-percent enlargement.
      scalePercent: z.number().min(101).max(103),
    })
    .strict(),
]);

/** Known Seedance 2.0 aliases; arbitrary gateway aliases do not prove this capability. */
export function isKnownSeedance2Model(model: string): boolean {
  return /^doubao-seedance-2[.-]0(?:-(?:fast|mini))?(?:-\d{6,8})?$/i.test(model);
}

export function supportsNativeMotionEndpoints(model: string): boolean {
  return isKnownSeedance2Model(model);
}

export const NATIVE_FRAME_LIMITS = {
  minDimension: 300,
  maxDimension: 6000,
  maxBytesExclusive: 30 * 1024 * 1024,
  maxPixels: 36_000_000,
} as const;

/** Permit encoder rounding, never fit by stretching or silently cropping the subject. */
export function matchesNativeFrameRatio(width: number, height: number, ratio: string): boolean {
  const dimensions = ratio.split(':');
  if (dimensions.length !== 2) return false;
  const [rw, rh] = dimensions.map(Number);
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    Number.isFinite(rw) &&
    Number.isFinite(rh) &&
    rw! > 0 &&
    rh! > 0 &&
    Math.abs(width / height / (rw! / rh!) - 1) <= 0.002
  );
}

/** Legacy plans may omit byte size; execution always validates the actual bytes. */
export function nativeReferenceFrameIssue(
  material: { width?: number | null; height?: number | null; byteSize?: number | null },
  ratio: string,
): 'FIRST_FRAME_RATIO_MISMATCH' | 'FIRST_FRAME_LIMIT' | undefined {
  if (
    !material.width ||
    !material.height ||
    !matchesNativeFrameRatio(material.width, material.height, ratio)
  )
    return 'FIRST_FRAME_RATIO_MISMATCH';
  if (
    Math.min(material.width, material.height) < NATIVE_FRAME_LIMITS.minDimension ||
    Math.max(material.width, material.height) > NATIVE_FRAME_LIMITS.maxDimension ||
    (material.byteSize != null &&
      (!Number.isSafeInteger(material.byteSize) ||
        material.byteSize <= 0 ||
        material.byteSize >= NATIVE_FRAME_LIMITS.maxBytesExclusive))
  )
    return 'FIRST_FRAME_LIMIT';
}

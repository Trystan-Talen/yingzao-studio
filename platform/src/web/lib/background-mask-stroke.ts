export interface MaskPoint {
  x: number;
  y: number;
}
export interface BackgroundMaskStroke {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  initialAlpha: Uint8Array;
  coverage: Uint8Array;
  mode: 'brush' | 'erase';
  radius: number;
  softness: number;
}
export interface MaskDirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function createBackgroundMaskStroke(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mode: 'brush' | 'erase',
  radius: number,
  softness: number,
): BackgroundMaskStroke {
  if (
    pixels.length !== width * height * 4 ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(softness) ||
    !Number.isFinite(radius) ||
    radius <= 0
  )
    throw new Error('Invalid background brush dimensions');
  return {
    width,
    height,
    pixels,
    initialAlpha: Uint8Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3]!),
    coverage: new Uint8Array(width * height),
    mode,
    radius,
    softness: Math.max(0, Math.min(100, softness)),
  };
}
/** A stroke is one geometric coverage field over its original alpha, not repeated paint dabs.
 * Distance to each segment makes collinear pointer sampling and pauses exactly equivalent. */
export function applyBackgroundMaskStrokeSegment(
  stroke: BackgroundMaskStroke,
  start: MaskPoint,
  end: MaskPoint,
): MaskDirtyRect | undefined {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return;
  const { width, height, radius, softness } = stroke;
  const left = Math.max(0, Math.floor(Math.min(start.x, end.x) - radius));
  const top = Math.max(0, Math.floor(Math.min(start.y, end.y) - radius));
  const right = Math.min(width, Math.ceil(Math.max(start.x, end.x) + radius));
  const bottom = Math.min(height, Math.ceil(Math.max(start.y, end.y) + radius));
  if (left >= right || top >= bottom) return;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const inner = radius * (1 - softness / 100);
  let changed = false;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const projection = lengthSquared
        ? Math.max(
            0,
            Math.min(1, ((x + 0.5 - start.x) * dx + (y + 0.5 - start.y) * dy) / lengthSquared),
          )
        : 0;
      const distance = Math.hypot(
        x + 0.5 - start.x - projection * dx,
        y + 0.5 - start.y - projection * dy,
      );
      if (distance >= radius) continue;
      const coverage =
        distance <= inner ? 255 : Math.round(((radius - distance) * 255) / (radius - inner));
      const pixel = y * width + x;
      if (coverage <= stroke.coverage[pixel]!) continue;
      stroke.coverage[pixel] = coverage;
      const original = stroke.initialAlpha[pixel]!;
      const alpha = Math.round(
        stroke.mode === 'brush'
          ? original + ((255 - original) * coverage) / 255
          : (original * (255 - coverage)) / 255,
      );
      const index = pixel * 4;
      stroke.pixels[index] = stroke.pixels[index + 1] = stroke.pixels[index + 2] = 255;
      stroke.pixels[index + 3] = alpha;
      changed = true;
    }
  }
  return changed ? { x: left, y: top, width: right - left, height: bottom - top } : undefined;
}

export interface BackgroundMaskGestureOptions {
  width: number;
  height: number;
  mode: 'brush' | 'erase';
  radius: number;
  softness: number;
  preventAccumulation: boolean;
}
export interface BackgroundMaskSession {
  stroke: BackgroundMaskStroke | null;
  options: BackgroundMaskGestureOptions | null;
  previous: MaskPoint | null;
  active: boolean;
}
export function createBackgroundMaskSession(): BackgroundMaskSession {
  return { stroke: null, options: null, previous: null, active: false };
}
export function resetBackgroundMaskSession(session: BackgroundMaskSession): void {
  session.stroke = null;
  session.options = null;
  session.previous = null;
  session.active = false;
}
/** Starting a gesture always disconnects its path. Compatible non-accumulating gestures
 * retain only the shared coverage field, never the previous gesture's endpoint. */
export function beginBackgroundMaskGesture(
  session: BackgroundMaskSession,
  readPixels: () => Uint8ClampedArray,
  options: BackgroundMaskGestureOptions,
): BackgroundMaskStroke {
  const old = session.options;
  const reusable =
    options.preventAccumulation &&
    old?.preventAccumulation &&
    session.stroke &&
    old.width === options.width &&
    old.height === options.height &&
    old.mode === options.mode &&
    old.radius === options.radius &&
    old.softness === options.softness;
  if (!reusable) {
    session.stroke = createBackgroundMaskStroke(
      readPixels(),
      options.width,
      options.height,
      options.mode,
      options.radius,
      options.softness,
    );
  }
  session.options = { ...options };
  session.previous = null;
  session.active = true;
  return session.stroke!;
}
export function moveBackgroundMaskGesture(
  session: BackgroundMaskSession,
  point: MaskPoint,
): MaskDirtyRect | undefined {
  if (!session.active || !session.stroke) return;
  const dirty = applyBackgroundMaskStrokeSegment(session.stroke, session.previous ?? point, point);
  session.previous = point;
  return dirty;
}
export function endBackgroundMaskGesture(session: BackgroundMaskSession): void {
  session.previous = null;
  session.active = false;
  if (!session.options?.preventAccumulation) resetBackgroundMaskSession(session);
}

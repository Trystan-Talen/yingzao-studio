import { describe, expect, it } from 'vitest';
import {
  applyBackgroundMaskStrokeSegment,
  beginBackgroundMaskGesture,
  createBackgroundMaskSession,
  createBackgroundMaskStroke,
  endBackgroundMaskGesture,
  moveBackgroundMaskGesture,
  resetBackgroundMaskSession,
  type BackgroundMaskGestureOptions,
  type MaskPoint,
} from '../src/web/lib/background-mask-stroke';
const width = 200,
  height = 100;
function stroke(mode: 'brush' | 'erase', radius = 20, softness = 100) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = 255;
    pixels[i * 4 + 3] = mode === 'brush' ? 0 : 255;
  }
  return createBackgroundMaskStroke(pixels, width, height, mode, radius, softness);
}
const alpha = (s: ReturnType<typeof stroke>, x: number, y: number) =>
  s.pixels[(y * width + x) * 4 + 3];
describe('background soft stroke invariants', () => {
  it.each(['brush', 'erase'] as const)(
    'keeps the same straight stroke identical regardless of pointer sampling density: %s',
    (mode) => {
      const sparse = stroke(mode),
        dense = stroke(mode);
      applyBackgroundMaskStrokeSegment(sparse, { x: 30, y: 50 }, { x: 30, y: 50 });
      applyBackgroundMaskStrokeSegment(sparse, { x: 30, y: 50 }, { x: 170, y: 50 });
      applyBackgroundMaskStrokeSegment(dense, { x: 30, y: 50 }, { x: 30, y: 50 });
      for (let x = 31; x <= 170; x++)
        applyBackgroundMaskStrokeSegment(dense, { x: x - 1, y: 50 }, { x, y: 50 });
      expect(alpha(sparse, 100, 65)).toBe(alpha(dense, 100, 65));
      expect(dense.pixels).toEqual(sparse.pixels);
    },
  );
  it.each(['brush', 'erase'] as const)(
    'does not harden a soft edge while the pointer pauses within one stroke: %s',
    (mode) => {
      const current = stroke(mode);
      applyBackgroundMaskStrokeSegment(current, { x: 100, y: 50 }, { x: 100, y: 50 });
      const first = alpha(current, 100, 65);
      for (let i = 0; i < 100; i++)
        applyBackgroundMaskStrokeSegment(current, { x: 100, y: 50 }, { x: 100, y: 50 });
      expect(alpha(current, 100, 65)).toBe(first);
    },
  );
});

function drawing(mode: 'brush' | 'erase' = 'brush') {
  const canvas = stroke(mode).pixels;
  const session = createBackgroundMaskSession();
  let reads = 0;
  const options: BackgroundMaskGestureOptions = {
    width,
    height,
    mode,
    radius: 20,
    softness: 100,
    preventAccumulation: true,
  };
  return {
    canvas,
    session,
    get reads() {
      return reads;
    },
    alpha(x: number, y: number) {
      return canvas[(y * width + x) * 4 + 3]!;
    },
    gesture(points: MaskPoint[], overrides: Partial<BackgroundMaskGestureOptions> = {}) {
      beginBackgroundMaskGesture(
        session,
        () => {
          reads++;
          return Uint8ClampedArray.from(canvas);
        },
        { ...options, ...overrides },
      );
      for (const point of points) {
        const dirty = moveBackgroundMaskGesture(session, point);
        if (!dirty) continue;
        // Copy the actual dirty rectangle, as the editor does with putImageData.
        for (let y = dirty.y; y < dirty.y + dirty.height; y++) {
          const offset = (y * width + dirty.x) * 4;
          canvas.set(session.stroke!.pixels.subarray(offset, offset + dirty.width * 4), offset);
        }
      }
      endBackgroundMaskGesture(session);
    },
  };
}

describe('background shared coverage lifecycle', () => {
  const start = { x: 30.5, y: 50.5 },
    middle = { x: 100.5, y: 50.5 },
    end = { x: 170.5, y: 50.5 };
  it.each(['brush', 'erase'] as const)(
    'keeps separate adjoining gestures and retracing identical to one continuous path: %s',
    (mode) => {
      const whole = drawing(mode),
        separate = drawing(mode);
      whole.gesture([start, end]);
      separate.gesture([start, middle]);
      separate.gesture([middle, end]);
      expect(separate.canvas).toEqual(whole.canvas);
      separate.gesture([end, start]);
      expect(separate.canvas).toEqual(whole.canvas);
      expect(separate.reads).toBe(1);
    },
  );
  it('does not connect disconnected gestures across their unpainted gap', () => {
    const current = drawing();
    current.gesture([start, { x: 50.5, y: 50.5 }]);
    current.gesture([{ x: 150.5, y: 50.5 }, end]);
    expect(current.alpha(40, 50)).toBe(255);
    expect(current.alpha(160, 50)).toBe(255);
    expect(current.alpha(100, 50)).toBe(0);
    expect(current.session.previous).toBeNull();
    expect(moveBackgroundMaskGesture(current.session, middle)).toBeUndefined();
  });
  it('switches tools using current pixels without restoring earlier paint inside a new dirty box', () => {
    const current = drawing();
    current.gesture([start, end]);
    current.gesture([middle], { mode: 'erase', softness: 0, radius: 6 });
    expect(current.alpha(100, 50)).toBe(0);
    // The new brush dirty rectangle includes the erased hole, but its circle does not.
    current.gesture([{ x: 115.5, y: 65.5 }]);
    expect(current.alpha(100, 50)).toBe(0);
    expect(current.alpha(115, 65)).toBe(255);
    expect(current.reads).toBe(3);
  });
  it.each([{ radius: 25 }, { softness: 60 }])(
    'ends shared coverage when a brush parameter changes: %j',
    (changed) => {
      const current = drawing();
      current.gesture([middle]);
      const first = current.alpha(100, 65);
      current.gesture([middle], changed);
      expect(current.reads).toBe(2);
      expect(current.alpha(100, 65)).toBeGreaterThan(first);
    },
  );
  it.each(['brush', 'erase'] as const)(
    'allows separate-stroke accumulation only when the option is off: %s',
    (mode) => {
      const current = drawing(mode);
      current.gesture([middle]);
      const first = current.alpha(100, 65);
      current.gesture([middle]);
      expect(current.alpha(100, 65)).toBe(first);
      current.gesture([middle], { preventAccumulation: false });
      const second = current.alpha(100, 65);
      expect(second).toBe(mode === 'brush' ? 112 : 143);
      current.gesture([middle], { preventAccumulation: false });
      const third = current.alpha(100, 65);
      expect(mode === 'brush' ? third > second : third < second).toBe(true);
      current.gesture([middle]);
      const enabled = current.alpha(100, 65);
      current.gesture([middle]);
      expect(current.alpha(100, 65)).toBe(enabled);
      expect(current.reads).toBe(4);
    },
  );
  it('uses the new canvas after clear or source replacement instead of an old coverage image', () => {
    const current = drawing();
    current.gesture([start, end]);
    resetBackgroundMaskSession(current.session);
    for (let i = 0; i < width * height; i++) current.canvas[i * 4 + 3] = 0;
    current.gesture([middle]);
    expect(current.alpha(40, 50)).toBe(0);
    expect(current.alpha(100, 50)).toBe(255);
    expect(current.alpha(100, 65)).toBe(64);
    expect(current.reads).toBe(2);
  });
});

it.each(['brush', 'erase'] as const)(
  'allows accumulation only after starting a new stroke: %s',
  (mode) => {
    const first = stroke(mode);
    applyBackgroundMaskStrokeSegment(first, { x: 100.5, y: 50.5 }, { x: 100.5, y: 50.5 });
    const initialEdge = alpha(first, 100, 65);
    const next = createBackgroundMaskStroke(first.pixels, width, height, mode, 20, 100);
    applyBackgroundMaskStrokeSegment(next, { x: 100.5, y: 50.5 }, { x: 100.5, y: 50.5 });
    expect(initialEdge).toBe(mode === 'brush' ? 64 : 191);
    expect(alpha(next, 100, 65)).toBe(mode === 'brush' ? 112 : 143);
  },
);

it.each(['brush', 'erase'] as const)(
  'composes partial coverage with existing grayscale alpha without changing untouched pixels: %s',
  (mode) => {
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let i = 0; i < width * height; i++) pixels[i * 4 + 3] = 128;
    const current = createBackgroundMaskStroke(pixels, width, height, mode, 20, 100);
    applyBackgroundMaskStrokeSegment(current, { x: 100.5, y: 50.5 }, { x: 100.5, y: 50.5 });
    expect(alpha(current, 100, 65)).toBe(mode === 'brush' ? 160 : 96);
    expect(alpha(current, 0, 0)).toBe(128);
    expect(alpha(current, 100, 50)).toBe(mode === 'brush' ? 255 : 0);
  },
);

it('keeps a retraced stroke identical and safely clips the pointer outside the canvas', () => {
  const current = stroke('erase');
  applyBackgroundMaskStrokeSegment(current, { x: -30, y: 50 }, { x: 230, y: 50 });
  const first = Uint8ClampedArray.from(current.pixels);
  applyBackgroundMaskStrokeSegment(current, { x: 230, y: 50 }, { x: -30, y: 50 });
  expect(current.pixels).toEqual(first);
  expect(alpha(current, 0, 50)).toBeLessThan(10);
  expect(alpha(current, 199, 50)).toBeLessThan(10);
  expect(alpha(current, 0, 0)).toBe(255);
  expect(
    applyBackgroundMaskStrokeSegment(current, { x: -100, y: -100 }, { x: -80, y: -80 }),
  ).toBeUndefined();
});

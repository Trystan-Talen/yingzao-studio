import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { calibrateNativeBackgroundMask } from '../src/server/providers/native-background-calibration';

type Color = readonly [number, number, number];
type SyntheticScene = {
  width: number;
  height: number;
  alpha: (x: number, y: number) => number;
  foreground: Color;
  background: Color;
};

const smooth = (distance: number, width: number) => {
  const t = Math.max(0, Math.min(1, 0.5 + distance / width));
  return t * t * (3 - 2 * t);
};

/** Independent synthetic ground truth, never a mask reviewed on one of the product photos. */
async function scene(spec: SyntheticScene) {
  const { width, height } = spec;
  const rgb = Buffer.alloc(width * height * 3);
  const truth = Buffer.alloc(width * height);
  const candidate = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const alpha = spec.alpha(x + 0.5, y + 0.5);
      truth[index] = Math.round(alpha * 255);
      candidate[index] = alpha >= 0.5 ? 255 : 0;
      for (let channel = 0; channel < 3; channel++)
        rgb[index * 3 + channel] = Math.round(
          spec.foreground[channel]! * (1 - alpha) + spec.background[channel]! * alpha,
        );
    }
  return {
    source: await sharp(rgb, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
    mask: await sharp(candidate, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer(),
    truth,
    candidate,
  };
}

const decode = (buffer: Buffer) => sharp(buffer).greyscale().raw().toBuffer();
function error(actual: Buffer, expected: Buffer) {
  let sum = 0;
  for (let i = 0; i < expected.length; i++) sum += Math.abs(actual[i]! - expected[i]!);
  return sum;
}

describe('independent synthetic calibration holdouts, not photographic acceptance', () => {
  it.each([
    {
      name: 'sloped soft boundary with unfamiliar colors',
      width: 640,
      height: 384,
      foreground: [134, 31, 75] as const,
      background: [42, 211, 168] as const,
      alpha: (x: number, y: number) => smooth((x - 320) * 0.6 + (y - 192) * 0.8, 14),
    },
    {
      name: 'closed curved soft silhouette above the working-resolution limit',
      width: 1536,
      height: 1024,
      foreground: [181, 99, 37] as const,
      background: [28, 77, 196] as const,
      alpha: (x: number, y: number) => smooth(Math.hypot(x - 768, y - 512) - 330, 20),
    },
  ])('improves $name and keeps remote interiors unchanged', async (spec) => {
    const f = await scene(spec);
    const result = await calibrateNativeBackgroundMask(f.source, f.mask);
    const output = await decode(result.buffer);
    expect(error(output, f.truth)).toBeLessThan(error(f.candidate, f.truth) * 0.75);
    expect(output[0]).toBe(f.candidate[0]);
    const interior = Math.floor(spec.height / 4) * spec.width + Math.floor(spec.width / 4);
    expect(output[interior]).toBe(f.candidate[interior]);
  });

  it('keeps tiny true holes and one-to-three-pixel opaque branches at a downsampled working scale', async () => {
    const width = 1600,
      height = 480;
    const f = await scene({
      width,
      height,
      foreground: [20, 48, 88],
      background: [215, 241, 172],
      alpha: (x, y) => {
        if (x < 600) {
          const hole =
            (x >= 100 && x < 101 && y >= 100 && y < 101) ||
            (x >= 200 && x < 202 && y >= 150 && y < 152) ||
            (x >= 300 && x < 304 && y >= 200 && y < 204);
          return Number(hole);
        }
        const trunk = x >= 1000 && x < 1003;
        const diagonal = Math.abs(y - 240 - (x - 1000) * 0.4) < 0.65 && x >= 800 && x <= 1200;
        const horizontal = y >= 100 && y < 102 && x >= 900 && x <= 1150;
        return Number(!(trunk || diagonal || horizontal));
      },
    });
    const result = await calibrateNativeBackgroundMask(f.source, f.mask);
    const output = await decode(result.buffer);
    expect(output).toEqual(f.candidate);
    expect(result.stats.preservedThinPixels).toBeGreaterThan(0);
  });

  it('does not manufacture a surface boundary when an automatic mask cuts through uniform source color', async () => {
    const width = 600,
      height = 400;
    const source = await sharp({ create: { width, height, channels: 3, background: '#c8b9a3' } })
      .png()
      .toBuffer();
    const mask = Buffer.alloc(width * height, 255);
    mask.fill(0, width * 310);
    const png = await sharp(mask, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    const result = await calibrateNativeBackgroundMask(source, png, { preserveSurface: true });
    expect(await decode(result.buffer)).toEqual(mask);
    expect(result.stats.bottomEditableFraction).toBe(0);
    expect(result.stats.warnings).toContain('SURFACE_BOUNDARY_UNCERTAIN');
    // Keeping the candidate is a diagnostic outcome; it is not a corrected semantic mask.
  });

  it('does not introduce random transparency along a weakly contrasted soft boundary', async () => {
    const f = await scene({
      width: 640,
      height: 384,
      foreground: [123, 129, 138],
      background: [129, 133, 141],
      alpha: (x, y) => smooth(x - 320 + Math.sin(y / 48) * 20, 14),
    });
    const result = await calibrateNativeBackgroundMask(f.source, f.mask);
    expect(await decode(result.buffer)).toEqual(f.candidate);
    expect(result.stats.warnings).toContain('LOW_CONTRAST_BOUNDARY');
  });

  it('keeps one heterogeneous connected contour intact instead of alternating soft and hard extrapolation', async () => {
    const width = 640,
      height = 384;
    const f = await scene({
      width,
      height,
      foreground: [35, 76, 119],
      background: [201, 177, 153],
      alpha: (x) => smooth(x - 320, 14),
    });
    const rgb = await sharp(f.source).removeAlpha().raw().toBuffer();
    // A reflection makes a long section indistinguishable from the background.
    for (let y = 140; y < 240; y++)
      for (let x = 280; x < 360; x++)
        for (let c = 0; c < 3; c++) rgb[(y * width + x) * 3 + c] = [201, 177, 153][c]!;
    const source = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    const result = await calibrateNativeBackgroundMask(source, f.mask);
    expect(await decode(result.buffer)).toEqual(f.candidate);
    expect(result.stats.skippedContours).toBe(1);
    expect(result.stats.warnings).toContain('CONTOUR_CALIBRATION_SKIPPED');
    // This prevents a new artifact; it does not assert that the hard candidate is accepted.
  });
});

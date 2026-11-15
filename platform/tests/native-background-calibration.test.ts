import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { calibrateNativeBackgroundMask } from '../src/server/providers/native-background-calibration';

const width = 512,
  height = 512;
async function fixture(softWidth: number, contrast = true) {
  const source = Buffer.alloc(width * height * 3),
    mask = Buffer.alloc(width * height),
    truth = Buffer.alloc(width * height);
  const foreground = [25, 80, 150],
    background = contrast ? [240, 230, 210] : foreground;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = softWidth
        ? Math.max(0, Math.min(1, 0.5 + (x + 0.5 - width / 2) / softWidth))
        : Number(x >= width / 2);
      const alpha = t * t * (3 - 2 * t),
        i = y * width + x;
      truth[i] = Math.round(alpha * 255);
      mask[i] = x >= width / 2 ? 255 : 0;
      for (let c = 0; c < 3; c++)
        source[i * 3 + c] = Math.round(foreground[c]! * (1 - alpha) + background[c]! * alpha);
    }
  return {
    source: await sharp(source, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
    mask: await sharp(mask, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer(),
    maskPixels: mask,
    truth,
  };
}
async function pixels(buffer: Buffer) {
  return sharp(buffer).greyscale().raw().toBuffer();
}
describe('source-derived automatic boundary calibration', () => {
  it('recovers a photographed soft transition from a hard candidate without altering either interior', async () => {
    const f = await fixture(12),
      result = await calibrateNativeBackgroundMask(f.source, f.mask),
      output = await pixels(result.buffer);
    let before = 0,
      after = 0;
    for (let y = 32; y < height - 32; y++)
      for (let x = width / 2 - 12; x < width / 2 + 12; x++) {
        const i = y * width + x;
        before += Math.abs(f.maskPixels[i]! - f.truth[i]!);
        after += Math.abs(output[i]! - f.truth[i]!);
      }
    expect(after).toBeLessThan(before * 0.6);
    for (let y = 0; y < height; y++)
      for (const x of [0, 100, 400, width - 1])
        expect(output[y * width + x]).toBe(f.maskPixels[y * width + x]);
    expect(result.stats.changedPixels).toBeGreaterThan(0);
  });
  it('keeps a sharp opaque boundary sharp rather than blurring it into the background', async () => {
    const f = await fixture(0),
      result = await calibrateNativeBackgroundMask(f.source, f.mask);
    expect(await pixels(result.buffer)).toEqual(f.maskPixels);
  });
  it('keeps an unsupported low-contrast boundary and reports uncertainty instead of inventing transparency', async () => {
    const f = await fixture(12, false),
      result = await calibrateNativeBackgroundMask(f.source, f.mask);
    expect(await pixels(result.buffer)).toEqual(f.maskPixels);
    expect(result.stats.warnings).toContain('LOW_CONTRAST_BOUNDARY');
  });
  it('removes an internal gray model drawing without filling a genuine white hole', async () => {
    const f = await fixture(0);
    f.maskPixels[200 * width + 100] = 80;
    for (let y = 100; y < 102; y++)
      for (let x = 100; x < 102; x++) f.maskPixels[y * width + x] = 255;
    const candidate = await sharp(f.maskPixels, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    const result = await calibrateNativeBackgroundMask(f.source, candidate),
      output = await pixels(result.buffer);
    expect(output[200 * width + 100]).toBe(0);
    for (let y = 100; y < 102; y++)
      for (let x = 100; x < 102; x++) expect(output[y * width + x]).toBe(255);
    expect(result.stats.removedInteriorGrayPixels).toBe(1);
    expect(result.stats.preservedThinPixels).toBeGreaterThan(0);
  });
  it('flags an editable lower frame when the request explicitly protects the supporting surface', async () => {
    const f = await fixture(0),
      result = await calibrateNativeBackgroundMask(f.source, f.mask, { preserveSurface: true });
    expect(result.stats.bottomEditableFraction).toBeCloseTo(0.5);
    expect(result.stats.warnings).toContain('SURFACE_PROTECTION_UNCERTAIN');
  });
  it('refuses a mismatched candidate rather than resizing it to the source', async () => {
    const f = await fixture(0),
      wrong = await sharp(f.mask).resize(256, 256).png().toBuffer();
    await expect(calibrateNativeBackgroundMask(f.source, wrong)).rejects.toThrow('尺寸一致');
  });
  it('is deterministic and does not mutate the source or candidate bytes', async () => {
    const f = await fixture(12),
      source = Buffer.from(f.source),
      mask = Buffer.from(f.mask);
    const a = await calibrateNativeBackgroundMask(f.source, f.mask),
      b = await calibrateNativeBackgroundMask(f.source, f.mask);
    expect(a).toEqual(b);
    expect(f.source).toEqual(source);
    expect(f.mask).toEqual(mask);
  });
});

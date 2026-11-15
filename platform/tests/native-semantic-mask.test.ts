import sharp from 'sharp';
import { expect, it } from 'vitest';
import { normalizeLocalMattingSemanticMask } from '../src/server/providers/native-semantic-mask';
import { normalizeNativeBackgroundMask } from '../src/server/providers/native-background';

const width = 256,
  height = 128;
const gray = (value: (x: number, y: number) => number) =>
  sharp(
    Buffer.from(
      Array.from({ length: width * height }, (_, i) => value(i % width, Math.floor(i / width))),
    ),
    { raw: { width, height, channels: 1 } },
  )
    .png()
    .toBuffer();

it.each([
  [0, 255],
  [1, 230],
  [28, 227],
] as const)(
  'admits concentrated neutral plateaus %s/%s while preserving the semantic split',
  async (dark, light) => {
    const raw = await gray((x) => (x < width / 2 ? dark : light));
    const mask = await sharp(await normalizeLocalMattingSemanticMask(raw, width, height))
      .greyscale()
      .raw()
      .toBuffer();
    expect([...mask]).toEqual(
      Array.from({ length: width * height }, (_, i) => (i % width < width / 2 ? 0 : 255)),
    );
  },
);
it('keeps the legacy near-white rejection and its accepted soft mask normalization unchanged', async () => {
  const nearWhite = await gray((x) => (x < width / 2 ? 1 : 230));
  await expect(
    normalizeNativeBackgroundMask(nearWhite, width, height, { removeIsolatedGray: true }),
  ).rejects.toMatchObject({ code: 'BACKGROUND_MASK_INVALID' });
  const soft = await gray((x) => (x < 124 ? 0 : x > 131 ? 255 : Math.round(((x - 123) * 255) / 9)));
  const old = await sharp(await normalizeNativeBackgroundMask(soft, width, height))
    .greyscale()
    .raw()
    .toBuffer();
  expect(new Set(old).size).toBeGreaterThan(2);
  const current = await sharp(await normalizeLocalMattingSemanticMask(soft, width, height))
    .greyscale()
    .raw()
    .toBuffer();
  expect(new Set(current)).toEqual(new Set([0, 255]));
});
it.each([
  'gradient',
  'endpoint-gradients',
  'photo-gray',
  'color-photo',
  'single-dark',
  'single-light',
  'too-little-dark',
  'too-little-light',
] as const)(
  'rejects %s instead of treating tonal content as a valid two-region proposal',
  async (kind) => {
    let raw: Buffer;
    if (kind === 'color-photo') {
      const data = Buffer.alloc(width * height * 3);
      for (let p = 0; p < width * height; p++)
        data.set(p % width < 128 ? [0, 20, 0] : [230, 250, 230], p * 3);
      raw = await sharp(data, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer();
    } else
      raw = await gray((x, y) =>
        kind === 'gradient'
          ? x
          : kind === 'endpoint-gradients'
            ? x < 128
              ? x % 33
              : 223 + (x % 33)
            : kind === 'photo-gray'
              ? Math.round(128 + 100 * Math.sin(x / 13) * Math.cos(y / 11))
              : kind === 'single-dark'
                ? 1
                : kind === 'single-light'
                  ? 230
                  : kind === 'too-little-dark'
                    ? x === 0
                      ? 1
                      : 230
                    : x === 0
                      ? 230
                      : 1,
      );
    await expect(normalizeLocalMattingSemanticMask(raw, width, height)).rejects.toMatchObject({
      code: 'BACKGROUND_MASK_INVALID',
    });
  },
);
it('retains the 8% transition and 0.5% color limits, including small neutral compression noise', async () => {
  const compressed = await gray((x) => (x < 126 ? 1 + (x % 4) : x > 129 ? 228 + (x % 5) : 128));
  await expect(
    normalizeLocalMattingSemanticMask(compressed, width, height),
  ).resolves.toBeInstanceOf(Buffer);
  const tooSoft = await gray((x) => (x < 110 ? 1 : x > 145 ? 230 : 128));
  await expect(normalizeLocalMattingSemanticMask(tooSoft, width, height)).rejects.toMatchObject({
    code: 'BACKGROUND_MASK_INVALID',
  });
});
it.each([0.0049, 0.0051])(
  'keeps color contamination %.4f on the correct side of the unchanged 0.5% limit',
  async (fraction) => {
    const data = Buffer.alloc(width * height * 3);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const value = pixel % width < 128 ? 1 : 230;
      data.set([value, value, value], pixel * 3);
    }
    for (let pixel = 0; pixel < Math.floor(fraction * width * height); pixel++)
      data.set([1, 21, 1], pixel * 3);
    const raw = await sharp(data, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    if (fraction < 0.005)
      await expect(normalizeLocalMattingSemanticMask(raw, width, height)).resolves.toBeInstanceOf(
        Buffer,
      );
    else
      await expect(normalizeLocalMattingSemanticMask(raw, width, height)).rejects.toMatchObject({
        code: 'BACKGROUND_MASK_INVALID',
      });
  },
);
it('rejects a dimension mismatch or any transparent pixel instead of discarding that information', async () => {
  const raw = await gray((x) => (x < 128 ? 1 : 230));
  await expect(normalizeLocalMattingSemanticMask(raw, width + 1, height)).rejects.toMatchObject({
    code: 'BACKGROUND_MASK_SIZE',
  });
  const alpha = Buffer.alloc(width * height, 255);
  alpha[0] = 254;
  const transparent = await sharp(raw)
    .toColourspace('srgb')
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  await expect(normalizeLocalMattingSemanticMask(transparent, width, height)).rejects.toMatchObject(
    { code: 'BACKGROUND_MASK_INVALID' },
  );
});

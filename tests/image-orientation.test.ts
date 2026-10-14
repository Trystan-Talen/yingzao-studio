import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import sharp from 'sharp';
import { PrivateStorage } from '../src/server/core/storage';
import { canonicalImage } from '../src/server/providers/image-input';

it('uses upright scene dimensions for all EXIF orientations while preserving downloadable originals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yingzao-image-orientation-'));
  try {
    const storage = new PrivateStorage(root);
    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const original = await sharp({
        create: { width: 80, height: 100, channels: 3, background: '#236789' },
      })
        .composite([
          {
            input: { create: { width: 20, height: 30, channels: 3, background: '#ed9021' } },
            left: 0,
            top: 0,
          },
        ])
        .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
        .withMetadata({ orientation })
        .toBuffer();
      const asset = await storage.prepare({
        buffer: original,
        name: `orientation-${orientation}.jpg`,
        mimeType: 'image/jpeg',
      });
      const expectedWidth = orientation >= 5 ? 100 : 80;
      const expectedHeight = orientation >= 5 ? 80 : 100;
      expect({ width: asset.width, height: asset.height }).toEqual({
        width: expectedWidth,
        height: expectedHeight,
      });
      const stored = asset.variants.find((v) => v.variant === 'original')!;
      expect(await storage.read(stored.storageKey)).toEqual(original);
      const preview = asset.variants.find((v) => v.variant === 'preview')!;
      expect({ width: preview.width, height: preview.height }).toEqual({
        width: expectedWidth,
        height: expectedHeight,
      });
      const canonical = await canonicalImage({ buffer: original, mimeType: 'image/jpeg' });
      expect({ width: canonical.width, height: canonical.height }).toEqual({
        width: expectedWidth,
        height: expectedHeight,
      });
      expect(await sharp(canonical.buffer).removeAlpha().raw().toBuffer()).toEqual(
        await sharp(original).rotate().removeAlpha().raw().toBuffer(),
      );
      if (orientation !== 1) {
        expect((await sharp(canonical.buffer).metadata()).orientation).toBeUndefined();
        expect(canonical.mimeType).toBe('image/png');
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

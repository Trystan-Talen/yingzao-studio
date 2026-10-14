import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import { localProvider } from '../src/server/providers/local';
import type { ExecutionContext } from '../src/server/tasks/types';
async function context(
  operation: JobInput['operation'],
  dimensions: [number, number] = [40, 20],
  options: Record<string, unknown> = {},
  count = 1,
): Promise<ExecutionContext> {
  const buffer = await sharp({
    create: { width: dimensions[0], height: dimensions[1], channels: 3, background: '#ea7722' },
  })
    .png()
    .toBuffer();
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse({
      operation,
      providerId: 'local',
      assetIds: Array.from({ length: count }, () => randomUUID()),
      options,
    }),
    readAsset: vi.fn(async () => ({ buffer, mimeType: 'image/png', name: 'fixture.png' })),
  };
}
describe('bounded local image processing', () => {
  it('rejects extremely tall enlargement before attempting an output allocation', async () => {
    const c = await context('local.resize', [16, 4096], { width: 8192 });
    await expect(localProvider.execute(c)).rejects.toThrow('64MP');
    expect(c.readAsset).toHaveBeenCalledTimes(1);
  });
  it('rejects output pixel area even when each side is within the side limit', async () => {
    await expect(
      localProvider.execute(await context('local.resize', [16, 16], { width: 8192, height: 8192 })),
    ).rejects.toThrow('64MP');
  });
  it('preflights cumulative stitch height before rendering its pieces', async () => {
    const c = await context('local.stitch', [300, 600], { width: 8192 }, 2);
    await expect(localProvider.execute(c)).rejects.toThrow('64MP');
    // The first piece itself exceeds the pixel budget; no second-pass reads occur.
    expect(c.readAsset).toHaveBeenCalledTimes(1);
    const cumulative = await context('local.stitch', [1000, 2000], { width: 1000 }, 9);
    await expect(localProvider.execute(cumulative)).rejects.toThrow('16384');
    expect(cumulative.readAsset).toHaveBeenCalledTimes(9);
  });
  it('keeps inside-fit resize and real PNG/JPEG/WebP outputs usable', async () => {
    for (const format of ['png', 'jpeg', 'webp']) {
      const result = await localProvider.execute(
        await context('local.resize', [40, 20], { width: 30, height: 30, format }),
      );
      expect(result.state).toBe('complete');
      if (result.state !== 'complete') throw new Error('not complete');
      const meta = await sharp(result.outputs[0]!.buffer!).metadata();
      expect(meta).toMatchObject({ width: 30, height: 15, format });
    }
  });
  it('applies EXIF orientation before budget and size calculation', async () => {
    const c = await context('local.resize', [40, 20], { width: 20 });
    const buffer = await sharp({
      create: { width: 40, height: 20, channels: 3, background: 'red' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    c.readAsset = async () => ({ buffer, mimeType: 'image/jpeg', name: 'rotated.jpg' });
    const result = await localProvider.execute(c);
    if (result.state !== 'complete') throw new Error('not complete');
    expect(await sharp(result.outputs[0]!.buffer!).metadata()).toMatchObject({
      width: 20,
      height: 40,
    });
  });
  it('creates an ordered vertical stitch within the output budget', async () => {
    const result = await localProvider.execute(
      await context('local.stitch', [40, 20], { width: 100 }, 2),
    );
    if (result.state !== 'complete') throw new Error('not complete');
    expect(await sharp(result.outputs[0]!.buffer!).metadata()).toMatchObject({
      width: 100,
      height: 100,
    });
  });
  it('does not allow removed AI-fusion aliases to silently return converted source images', async () => {
    await expect(localProvider.execute(await context('image-fusion'))).rejects.toThrow('不支持');
  });
});

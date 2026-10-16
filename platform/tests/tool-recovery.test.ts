import { it, expect } from 'vitest';
import type { AssetDto } from '../src/contracts/core';
import { restoreToolAssets } from '../src/web/lib/tool-recovery';
it('keeps every readable tool slot and retains failed identities for explicit retry or removal', async () => {
  const draft = {
    assetIds: ['source-good', 'source-missing'],
    referenceAssetIds: ['target'],
    maskAssetId: 'mask-missing',
    backgroundAssetId: 'background',
  };
  let calls = 0;
  const load = async (id: string) => {
    calls++;
    if (id.endsWith('missing')) throw new Error('Not available');
    return { id } as AssetDto;
  };
  const first = await restoreToolAssets(draft, load);
  expect(first.sources.map((x) => x.id)).toEqual(['source-good']);
  expect(first.references.map((x) => x.id)).toEqual(['target']);
  expect(first.background?.id).toBe('background');
  expect(first.mask).toBe(null);
  expect(first.ready).toBe(false);
  expect(first.failures.map((x) => [x.id, x.slot])).toEqual([
    ['source-missing', 'source'],
    ['mask-missing', 'mask'],
  ]);
  expect(calls).toBe(5);
  const retried = await restoreToolAssets(draft, async (id) => ({ id }) as AssetDto);
  expect(retried.ready).toBe(true);
  expect(retried.mask?.id).toBe('mask-missing');
  expect(retried.sources).toHaveLength(2);
});
it('loads a shared identity once while preserving source and reference roles', async () => {
  let calls = 0;
  const result = await restoreToolAssets(
    { assetIds: ['same'], referenceAssetIds: ['same'] },
    async (id) => {
      calls++;
      return { id } as AssetDto;
    },
  );
  expect(calls).toBe(1);
  expect(result.sources).toEqual(result.references);
});

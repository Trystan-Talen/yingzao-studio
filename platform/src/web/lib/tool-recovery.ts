import type { AssetDto } from '../../contracts/core';
import type { JobInput } from '../../contracts/jobs';
import { restoreAssets } from './creation-recovery';
export type ToolAssetSlot = 'source' | 'reference' | 'mask' | 'background';
export interface MissingToolAsset {
  id: string;
  slot: ToolAssetSlot;
  message: string;
}
export async function restoreToolAssets(
  input: Pick<JobInput, 'assetIds' | 'referenceAssetIds' | 'maskAssetId' | 'backgroundAssetId'>,
  load: (id: string) => Promise<AssetDto>,
) {
  const slots: { id: string; slot: ToolAssetSlot }[] = [
    ...input.assetIds.map((id) => ({ id, slot: 'source' as const })),
    ...input.referenceAssetIds.map((id) => ({ id, slot: 'reference' as const })),
    ...(input.maskAssetId ? [{ id: input.maskAssetId, slot: 'mask' as const }] : []),
    ...(input.backgroundAssetId
      ? [{ id: input.backgroundAssetId, slot: 'background' as const }]
      : []),
  ];
  const result = await restoreAssets(
    slots.map((item) => item.id),
    load,
  );
  const found = new Map(result.assets.map((asset) => [asset.id, asset]));
  const failures = slots.flatMap((item) => {
    const failure = result.failures.find((f) => f.id === item.id);
    return failure ? [{ ...failure, slot: item.slot }] : [];
  });
  return {
    sources: input.assetIds.flatMap((id) => (found.has(id) ? [found.get(id)!] : [])),
    references: input.referenceAssetIds.flatMap((id) => (found.has(id) ? [found.get(id)!] : [])),
    mask: input.maskAssetId ? (found.get(input.maskAssetId) ?? null) : null,
    background: input.backgroundAssetId ? (found.get(input.backgroundAssetId) ?? null) : null,
    failures,
    ready: failures.length === 0,
  };
}

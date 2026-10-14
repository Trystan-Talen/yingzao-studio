import type { ExportPolicy } from '../../contracts/export-policy';
import { exportPolicyManifest } from './export-watermark';
import JSZip from 'jszip';
import { getSceneAssetIds } from '../../contracts/scene';
import { exportScene } from './fabric-adapter';
import type { EditorAsset, ExportBoard, ExportMetadata } from './types';
import { t } from '../lib/i18n';
export function exportFileName(name: string, index: number, extension: string) {
  const clean =
    name
      .normalize('NFKC')
      .replace(/[\u0000-\u001f/\\:*?"<>|]/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 80) || 'canvas';
  return `${String(index + 1).padStart(3, '0')}-${clean}.${extension}`;
}
export function exportManifestEntry(
  board: ExportBoard,
  assets: EditorAsset[],
  file: string,
  size: { width: number; height: number },
  includeProvenance: boolean,
) {
  const scene = board.layerIds
    ? {
        ...board.scene,
        layers: board.scene.layers.filter((layer) => board.layerIds!.includes(layer.id)),
      }
    : board.scene;
  const assetIds = getSceneAssetIds(scene);
  const sourceJobIds = [
    ...new Set(
      assets
        .filter((asset) => assetIds.includes(asset.id))
        .map((asset) => asset.sourceJobId)
        .filter((id): id is string => !!id),
    ),
  ];
  const metadata: ExportMetadata | undefined = board.metadata;
  return {
    file,
    name: board.name,
    boardId: board.id,
    width: size.width,
    height: size.height,
    layerIds: scene.layers.map((layer) => layer.id),
    assetIds,
    ...(includeProvenance
      ? {
          documentId: metadata?.documentId,
          revision: metadata?.revision,
          sourceJobIds,
          sourceJobs: metadata?.sourceJobs?.filter((job) => sourceJobIds.includes(job.id)) || [],
          provenanceStatus: sourceJobIds.length
            ? 'available-source-records-only'
            : 'no-ai-source-record-available',
        }
      : {}),
  };
}
export async function exportSceneBundle(
  boards: ExportBoard[],
  assets: EditorAsset[],
  options: {
    format: 'png' | 'jpeg';
    policy?: ExportPolicy;
    scale: number;
    transparent: boolean;
    signal: AbortSignal;
    includeProvenance?: boolean;
  },
): Promise<Blob> {
  if (!boards.length || boards.length > 20) throw new Error(t('每次打包需要1–20个画板或图层。'));
  const zip = new JSZip();
  const entries: ReturnType<typeof exportManifestEntry>[] = [];
  let bytes = 0,
    pixels = 0;
  for (const [index, board] of boards.entries()) {
    if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let dimensions = { width: board.scene.canvas.width, height: board.scene.canvas.height };
    const blob = await exportScene(board.scene, assets, {
      ...options,
      layerIds: board.layerIds,
      onDimensions: (size) => {
        dimensions = size;
        pixels += size.width * size.height;
        if (pixels > 134_217_728) throw new Error(t('打包总像素超过上限，请减少画板或降低倍率。'));
      },
    });
    bytes += blob.size;
    if (bytes > 150 * 1024 * 1024) throw new Error(t('打包内容超过150MB，请分批导出。'));
    const file = exportFileName(board.name, index, options.format === 'jpeg' ? 'jpg' : 'png');
    zip.file(file, await blob.arrayBuffer());
    entries.push(exportManifestEntry(board, assets, file, dimensions, !!options.includeProvenance));
  }
  const manifest = JSON.stringify(
    {
      format: 'yingzao-export-manifest/v1',
      exportPolicy: exportPolicyManifest(options.policy),
      createdAt: new Date().toISOString(),
      metadataPolicy:
        'Sidecar records only. No AI provenance is embedded in image pixels or image metadata. Missing provider records are not inferred.',
      entries,
    },
    null,
    2,
  );
  if (new Blob([manifest]).size > 1024 * 1024)
    throw new Error(t('来源记录过大，请关闭来源参数导出。'));
  zip.file('manifest.json', manifest);
  const data = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 3 },
  });
  if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

import { resolveExportPolicy } from '../../contracts/export-policy';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { blankScene } from '../../contracts/scene';
import { layerBase } from './scene-operations';
import { exportFileName, exportManifestEntry, exportSceneBundle } from './export-bundle';
import { exportScene } from './fabric-adapter';
import type { EditorAsset, ExportBoard } from './types';
vi.mock('./fabric-adapter', () => ({ exportScene: vi.fn() }));
const render = vi.mocked(exportScene);
const imageId = randomUUID(),
  jobId = randomUUID(),
  layerId = randomUUID();
const scene = blankScene(400, 300);
scene.layers = [
  {
    ...layerBase('图层一', 120, 80),
    id: layerId,
    type: 'image',
    assetId: imageId,
    crop: null,
  },
];
const assets: EditorAsset[] = [
  {
    id: imageId,
    name: '原图',
    kind: 'image',
    originalUrl: '/authorized/original',
    sourceJobId: jobId,
  },
];
const board: ExportBoard = {
  id: randomUUID(),
  name: '../作品/一',
  scene,
  metadata: {
    documentId: randomUUID(),
    revision: 3,
    sourceJobs: [
      {
        id: jobId,
        operation: 'image.generate',
        providerId: 'fal',
        parameters: { prompt: '用户原始需求' },
      },
      {
        id: randomUUID(),
        operation: 'image.generate',
        providerId: 'openai',
        parameters: { prompt: '不相关私有任务' },
      },
    ],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  render.mockImplementation(async (_scene, _assets, options) => {
    options.onDimensions?.({ width: 120, height: 80 });
    return new Blob(['fixture-rendered-by-test'], { type: 'image/png' });
  });
});
describe('export bundles and truthful sidecar provenance', () => {
  it('writes ordered real ZIP entries, exact rendered dimensions and source records only for included assets', async () => {
    const blob = await exportSceneBundle(
      [board, { ...board, id: 'second', name: board.name }],
      assets,
      {
        format: 'png',
        scale: 1,
        transparent: true,
        signal: new AbortController().signal,
        includeProvenance: true,
      },
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names).toEqual(['001-_作品_一.png', '002-_作品_一.png', 'manifest.json']);
    expect(await zip.file(names[0]!)!.async('string')).toBe('fixture-rendered-by-test');
    const m = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(m.entries[0]).toMatchObject({
      width: 120,
      height: 80,
      assetIds: [imageId],
      sourceJobIds: [jobId],
      revision: 3,
    });
    expect(m.entries[0].sourceJobs).toHaveLength(1);
    expect(JSON.stringify(m)).not.toContain('不相关私有任务');
    expect(m.metadataPolicy).toContain('No AI provenance is embedded');
  });
  it('respects explicit provenance opt-out and does not invent missing job parameters', () => {
    const hidden = exportManifestEntry(board, assets, 'a.png', { width: 20, height: 30 }, false);
    expect(hidden).not.toHaveProperty('sourceJobs');
    expect(hidden).not.toHaveProperty('sourceJobIds');
    const unavailable = exportManifestEntry(
      { ...board, metadata: undefined },
      assets,
      'b.png',
      { width: 20, height: 30 },
      true,
    );
    expect(unavailable.sourceJobIds).toEqual([jobId]);
    expect(unavailable.sourceJobs).toEqual([]);
  });
  it('excludes assets from unselected layers and propagates crop selection to renderer', async () => {
    const selected = { ...board, layerIds: [layerId] };
    await exportSceneBundle([selected], assets, {
      format: 'jpeg',
      scale: 2,
      transparent: false,
      signal: new AbortController().signal,
    });
    expect(render).toHaveBeenCalledWith(
      scene,
      assets,
      expect.objectContaining({ layerIds: [layerId], scale: 2 }),
    );
    const empty = exportManifestEntry(
      { ...board, layerIds: [randomUUID()] },
      assets,
      'empty.png',
      { width: 1, height: 1 },
      true,
    );
    expect(empty.assetIds).toEqual([]);
    expect(empty.sourceJobIds).toEqual([]);
  });
  it('rejects cumulative pixel budgets and cancels without emitting partial ZIPs', async () => {
    render.mockImplementation(async (_scene, _assets, options) => {
      options.onDimensions?.({ width: 8192, height: 8192 });
      return new Blob(['fixture']);
    });
    await expect(
      exportSceneBundle([board, board, board], assets, {
        format: 'png',
        scale: 1,
        transparent: false,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('总像素');
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportSceneBundle([board], assets, {
        format: 'png',
        scale: 1,
        transparent: false,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('sanitizes archive paths and rejects empty/oversized board collections', async () => {
    expect(exportFileName('../../x\\y:bad', 0, 'png')).toBe('001-_.._x_y_bad.png');
    const options = {
      format: 'png' as const,
      scale: 1,
      transparent: false,
      signal: new AbortController().signal,
    };
    await expect(exportSceneBundle([], assets, options)).rejects.toThrow('1–20');
    await expect(
      exportSceneBundle(
        Array.from({ length: 21 }, () => board),
        assets,
        options,
      ),
    ).rejects.toThrow('1–20');
  });
});

it('passes one resolved policy to every rendered layer/board and records the actual export policy', async () => {
  const policy = resolveExportPolicy({
    workspaceId: randomUUID(),
    isDemo: false,
    hasActiveSubscription: false,
    config: { mode: 'all', text: 'Test Export Mark' },
  });
  const blob = await exportSceneBundle(
    [board, { ...board, id: 'selection', layerIds: [layerId] }],
    assets,
    {
      format: 'jpeg',
      scale: 2,
      transparent: false,
      signal: new AbortController().signal,
      policy,
    },
  );
  expect(render).toHaveBeenCalledTimes(2);
  for (const call of render.mock.calls) expect(call[2].policy).toEqual(policy);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(manifest.exportPolicy).toMatchObject({ ...policy, applied: true });
  expect(manifest.entries).toHaveLength(2);
});

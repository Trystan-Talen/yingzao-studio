import { t } from '../lib/i18n';
import { util, Point } from 'fabric';
import type { GroupLayer, LayerBase, SceneDocumentV1, SceneLayer } from '../../contracts/scene.js';
import type { EditorAsset } from './types.js';

export function layerBase(name: string, width = 280, height = 180): LayerBase {
  return {
    id: crypto.randomUUID(),
    name,
    x: 80,
    y: 80,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    visible: true,
    locked: false,
  };
}

export function layerFromAsset(asset: EditorAsset, scene: SceneDocumentV1): SceneLayer {
  if (asset.kind !== 'image' && asset.kind !== 'video')
    throw new Error(t('画布支持图片或视频素材。'));
  const sourceWidth = asset.width ?? 640;
  const sourceHeight = asset.height ?? 480;
  const scale = Math.min(
    1,
    (scene.canvas.width * 0.75) / sourceWidth,
    (scene.canvas.height * 0.75) / sourceHeight,
  );
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);
  const base = {
    ...layerBase(asset.name, width, height),
    x: (scene.canvas.width - width) / 2,
    y: (scene.canvas.height - height) / 2,
  };
  if (asset.kind === 'image') return { ...base, type: 'image', assetId: asset.id, crop: null };
  if (!asset.durationMs || asset.durationMs <= 0)
    throw new Error(t('视频尚未读取真实时长，请等待素材处理完成。'));
  return {
    ...base,
    type: 'video',
    assetId: asset.id,
    posterAssetId: null,
    durationMs: asset.durationMs,
    trimStartMs: 0,
    trimEndMs: asset.durationMs,
    muted: true,
    loop: true,
  };
}

export function cloneLayer(layer: SceneLayer): SceneLayer {
  const copy = { ...structuredClone(layer), id: crypto.randomUUID() };
  if (copy.type === 'group') copy.children = copy.children.map(cloneLayer);
  return copy;
}

/** The matrix maps unscaled layer coordinates into its parent's scene coordinates. */
export function layerMatrix(layer: LayerBase) {
  return util.composeMatrix({
    translateX: layer.x,
    translateY: layer.y,
    angle: layer.rotation,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    skewX: layer.skewX ?? 0,
    skewY: layer.skewY ?? 0,
    flipX: layer.flipX ?? false,
    flipY: layer.flipY ?? false,
  });
}

export function layerBounds(layer: LayerBase) {
  const matrix = layerMatrix(layer);
  const points = [
    [0, 0],
    [layer.width, 0],
    [0, layer.height],
    [layer.width, layer.height],
  ].map(([x = 0, y = 0]) => util.transformPoint(new Point(x, y), matrix));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function groupLayers(
  scene: SceneDocumentV1,
  selectedIds: string[],
): { scene: SceneDocumentV1; groupId: string } | null {
  const selected = scene.layers.filter((layer) => selectedIds.includes(layer.id) && !layer.locked);
  if (selected.length < 2) return null;
  const bounds = selected.map(layerBounds);
  const x = Math.min(...bounds.map((b) => b.x));
  const y = Math.min(...bounds.map((b) => b.y));
  const width = Math.max(...bounds.map((b) => b.right)) - x;
  const height = Math.max(...bounds.map((b) => b.bottom)) - y;
  const group: GroupLayer = {
    ...layerBase(t('图层组'), width, height),
    x,
    y,
    type: 'group',
    children: selected.map((layer) => ({ ...layer, x: layer.x - x, y: layer.y - y })),
  };
  const lastIndex = Math.max(...selected.map((layer) => scene.layers.indexOf(layer)));
  const layers = scene.layers.flatMap((layer, index) =>
    index === lastIndex ? [group] : selected.includes(layer) ? [] : [layer],
  );
  return { scene: { ...scene, layers }, groupId: group.id };
}

export function ungroupLayer(
  scene: SceneDocumentV1,
  groupId: string,
): { scene: SceneDocumentV1; selectedIds: string[] } {
  const group = scene.layers.find(
    (layer): layer is GroupLayer => layer.id === groupId && layer.type === 'group',
  );
  if (!group || group.locked) return { scene, selectedIds: [] };
  const children = group.children.map((child): SceneLayer => {
    const matrix = util.multiplyTransformMatrices(layerMatrix(group), layerMatrix(child));
    const transform = util.qrDecompose(matrix);
    return {
      ...child,
      x: matrix[4],
      y: matrix[5],
      rotation: transform.angle,
      scaleX: Math.abs(transform.scaleX),
      scaleY: Math.abs(transform.scaleY),
      flipX: transform.scaleX < 0,
      flipY: transform.scaleY < 0,
      skewX: transform.skewX,
      skewY: 0,
      opacity: child.opacity * group.opacity,
      visible: child.visible && group.visible,
    };
  });
  return {
    scene: {
      ...scene,
      layers: scene.layers.flatMap((layer) => (layer.id === group.id ? children : [layer])),
    },
    selectedIds: children.map((layer) => layer.id),
  };
}

export function reorderLayer(scene: SceneDocumentV1, id: string, delta: -1 | 1): SceneDocumentV1 {
  const layers = [...scene.layers];
  const index = layers.findIndex((layer) => layer.id === id);
  const other = index + delta;
  const current = layers[index];
  const target = layers[other];
  if (!current || !target || current.locked) return scene;
  layers[index] = target;
  layers[other] = current;
  return { ...scene, layers };
}

export function alignLayers(
  scene: SceneDocumentV1,
  ids: string[],
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
): SceneDocumentV1 {
  return {
    ...scene,
    layers: scene.layers.map((layer) => {
      if (!ids.includes(layer.id) || layer.locked) return layer;
      const bounds = layerBounds(layer);
      const width = bounds.right - bounds.x;
      const height = bounds.bottom - bounds.y;
      let x = layer.x;
      let y = layer.y;
      if (alignment === 'left') x -= bounds.x;
      if (alignment === 'center') x += (scene.canvas.width - width) / 2 - bounds.x;
      if (alignment === 'right') x += scene.canvas.width - bounds.right;
      if (alignment === 'top') y -= bounds.y;
      if (alignment === 'middle') y += (scene.canvas.height - height) / 2 - bounds.y;
      if (alignment === 'bottom') y += scene.canvas.height - bounds.bottom;
      return { ...layer, x, y };
    }),
  };
}

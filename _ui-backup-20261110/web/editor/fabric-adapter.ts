import type { ExportPolicy } from '../../contracts/export-policy';
import { applyExportWatermark } from './export-watermark';
import { t } from '../lib/i18n';
import {
  ActiveSelection,
  Ellipse,
  FabricImage,
  FabricObject,
  FixedLayout,
  Group,
  LayoutManager,
  Point,
  Rect,
  StaticCanvas,
  Textbox,
  util,
} from 'fabric';
import { getSceneAssetIds, type SceneDocumentV1, type SceneLayer } from '../../contracts/scene.js';
import type { EditorAsset } from './types.js';

const records = new WeakMap<
  FabricObject,
  { layer: SceneLayer; factorX: number; factorY: number }
>();

export function objectLayerId(object: FabricObject): string | undefined {
  return records.get(object)?.layer.id;
}

interface RenderContext {
  assets: Map<string, EditorAsset>;
  signal: AbortSignal;
  readOnly: boolean;
  strict: boolean;
  failures: string[];
  cleanups: Array<() => void>;
}

function abortError(): DOMException {
  return new DOMException(t('画布加载已取消。'), 'AbortError');
}

async function videoFrame(
  url: string,
  atMs: number,
  context: RenderContext,
): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  const cleanup = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  context.cleanups.push(cleanup);
  await new Promise<void>((resolve, reject) => {
    if (context.signal.aborted) {
      reject(abortError());
      return;
    }
    const timeout = window.setTimeout(
      () => finish(new Error(t('视频读取超时，请重新加载素材。'))),
      15_000,
    );
    const abort = () => finish(abortError());
    const error = () => finish(new Error(t('视频不能读取，请检查原件和访问权限。')));
    const loaded = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(new Error(t('视频未包含可读取的画面尺寸。')));
        return;
      }
      // FabricImage reads width/height, not the HTMLVideoElement's videoWidth/videoHeight.
      video.width = video.videoWidth;
      video.height = video.videoHeight;
      if (atMs > 0 && video.duration * 1000 > atMs) video.currentTime = atMs / 1000;
      else finish();
    };
    const seeked = () => finish();
    function finish(error?: Error) {
      window.clearTimeout(timeout);
      context.signal.removeEventListener('abort', abort);
      video.removeEventListener('error', errorHandler);
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('seeked', seeked);
      if (error) reject(error);
      else resolve();
    }
    const errorHandler = error;
    context.signal.addEventListener('abort', abort, { once: true });
    video.addEventListener('error', errorHandler, { once: true });
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('seeked', seeked, { once: true });
    video.src = url;
  });
  return video;
}

function common(layer: SceneLayer, context: RenderContext) {
  return {
    left: layer.x,
    top: layer.y,
    originX: 'left' as const,
    originY: 'top' as const,
    angle: layer.rotation,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    skewX: layer.skewX ?? 0,
    skewY: layer.skewY ?? 0,
    flipX: layer.flipX ?? false,
    flipY: layer.flipY ?? false,
    opacity: layer.opacity,
    visible: layer.visible,
    selectable: !context.readOnly && !layer.locked,
    evented: !context.readOnly && !layer.locked,
    lockMovementX: layer.locked,
    lockMovementY: layer.locked,
    lockRotation: layer.locked,
    lockScalingX: layer.locked,
    lockScalingY: layer.locked,
    lockSkewingX: true,
    lockSkewingY: true,
    borderColor: '#426856',
    cornerColor: '#FFFFFF',
    cornerStrokeColor: '#426856',
    cornerStyle: 'circle' as const,
    cornerSize: 10,
    transparentCorners: false,
    padding: 2,
    strokeUniform: false,
  };
}

async function renderLayer(layer: SceneLayer, context: RenderContext): Promise<FabricObject> {
  if (context.signal.aborted) throw abortError();
  let object: FabricObject;
  let factorX = 1;
  let factorY = 1;
  const options = common(layer, context);
  if (layer.type === 'text') {
    object = new Textbox(layer.text, {
      ...options,
      width: layer.width,
      fontFamily: layer.fontFamily,
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      fontStyle: layer.fontStyle,
      fill: layer.fill,
      textAlign: layer.textAlign,
      lineHeight: layer.lineHeight,
      underline: layer.underline,
      splitByGrapheme: true,
      editable: !context.readOnly && !layer.locked,
    });
  } else if (layer.type === 'shape') {
    const shapeOptions = {
      ...options,
      width: layer.width,
      height: layer.height,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
    };
    object =
      layer.shape === 'ellipse'
        ? new Ellipse({ ...shapeOptions, rx: layer.width / 2, ry: layer.height / 2 })
        : new Rect({ ...shapeOptions, rx: layer.cornerRadius, ry: layer.cornerRadius });
  } else if (layer.type === 'group') {
    const children: FabricObject[] = [];
    try {
      for (const child of layer.children) children.push(await renderLayer(child, context));
    } catch (error) {
      children.forEach((child) => child.dispose());
      throw error;
    }
    const group = new Group(children, {
      ...options,
      width: layer.width,
      height: layer.height,
      layoutManager: new LayoutManager(new FixedLayout()),
      subTargetCheck: false,
      interactive: false,
    });
    group.set({ ...options, width: layer.width, height: layer.height });
    // Fabric group children use center-relative coordinates; the document does not.
    children.forEach((child, index) => {
      const source = layer.children[index];
      if (source) child.set({ left: source.x - layer.width / 2, top: source.y - layer.height / 2 });
      child.setCoords();
    });
    object = group;
  } else {
    try {
      const asset = context.assets.get(layer.assetId);
      if (!asset) throw new Error(`${t('素材不在当前素材列表中。')} (${layer.name})`);
      if (layer.type === 'image') {
        const image = await FabricImage.fromURL(asset.originalUrl, {
          signal: context.signal,
          crossOrigin: 'anonymous',
        });
        const sourceWidth = image.width;
        const sourceHeight = image.height;
        if (layer.crop) {
          const cropScaleX =
            asset.originalAvailable === false ? sourceWidth / (asset.width || sourceWidth) : 1;
          const cropScaleY =
            asset.originalAvailable === false ? sourceHeight / (asset.height || sourceHeight) : 1;
          const crop = {
            x: layer.crop.x * cropScaleX,
            y: layer.crop.y * cropScaleY,
            width: layer.crop.width * cropScaleX,
            height: layer.crop.height * cropScaleY,
          };
          if (
            crop.x + crop.width > sourceWidth + 0.01 ||
            crop.y + crop.height > sourceHeight + 0.01
          )
            throw new Error(`${t('裁剪超出了原图范围。')} (${layer.name})`);
          image.set({
            cropX: crop.x,
            cropY: crop.y,
            width: crop.width,
            height: crop.height,
          });
        }
        factorX = layer.width / image.width;
        factorY = layer.height / image.height;
        object = image;
      } else {
        const poster = layer.posterAssetId ? context.assets.get(layer.posterAssetId) : undefined;
        if (poster)
          object = await FabricImage.fromURL(poster.originalUrl, {
            signal: context.signal,
            crossOrigin: 'anonymous',
          });
        else if (asset.playable === false) {
          if (!asset.thumbnailUrl) throw new Error(t('分享仅提供视频缩略图，未授权原件播放。'));
          object = await FabricImage.fromURL(asset.thumbnailUrl, {
            signal: context.signal,
            crossOrigin: 'anonymous',
          });
        } else
          object = new FabricImage(await videoFrame(asset.originalUrl, layer.trimStartMs, context));
        factorX = layer.width / object.width;
        factorY = layer.height / object.height;
      }
      object.set({ ...options, scaleX: layer.scaleX * factorX, scaleY: layer.scaleY * factorY });
    } catch (error) {
      if (context.signal.aborted) throw abortError();
      const message = error instanceof Error ? error.message : t('媒体读取失败。');
      if (context.strict) throw new Error(message);
      context.failures.push(message);
      object = new Rect({
        ...options,
        width: layer.width,
        height: layer.height,
        fill: '#F2E8E5',
        stroke: '#B84442',
        strokeWidth: 1,
        strokeDashArray: [8, 6],
      });
    }
  }
  records.set(object, { layer, factorX, factorY });
  object.setCoords();
  return object;
}

export interface RenderedScene {
  objects: FabricObject[];
  failures: string[];
  release: () => void;
}

export async function createSceneObjects(
  scene: SceneDocumentV1,
  assets: EditorAsset[],
  options: { signal: AbortSignal; readOnly?: boolean; strict?: boolean },
): Promise<RenderedScene> {
  const context: RenderContext = {
    assets: new Map(assets.map((asset) => [asset.id, asset])),
    signal: options.signal,
    readOnly: options.readOnly ?? false,
    strict: options.strict ?? false,
    failures: [],
    cleanups: [],
  };
  const objects: FabricObject[] = [];
  try {
    await document.fonts.ready;
    for (const layer of scene.layers) objects.push(await renderLayer(layer, context));
  } catch (error) {
    objects.forEach((object) => object.dispose());
    context.cleanups.forEach((cleanup) => cleanup());
    throw error;
  }
  return {
    objects,
    failures: context.failures,
    release: () => context.cleanups.forEach((cleanup) => cleanup()),
  };
}

export function readObjectLayer(object: FabricObject): SceneLayer | null {
  const record = records.get(object);
  if (!record) return null;
  const { layer, factorX, factorY } = record;
  const updated: SceneLayer = {
    ...layer,
    x: object.left,
    y: object.top,
    scaleX: object.scaleX / factorX,
    scaleY: object.scaleY / factorY,
    rotation: object.angle,
    skewX: object.skewX,
    skewY: object.skewY,
    flipX: object.flipX,
    flipY: object.flipY,
    opacity: object.opacity,
    visible: object.visible,
  };
  if (object.group instanceof ActiveSelection) {
    const matrix = object.calcTransformMatrix();
    const corner = util.transformPoint(new Point(-object.width / 2, -object.height / 2), matrix);
    const transformed = util.qrDecompose(matrix);
    Object.assign(updated, {
      x: corner.x,
      y: corner.y,
      rotation: transformed.angle,
      scaleX: Math.abs(transformed.scaleX) / factorX,
      scaleY: Math.abs(transformed.scaleY) / factorY,
      flipX: transformed.scaleX < 0,
      flipY: transformed.scaleY < 0,
      skewX: transformed.skewX,
      skewY: 0,
    });
  } else if (object.group instanceof Group) {
    updated.x += object.group.width / 2;
    updated.y += object.group.height / 2;
  }
  if (updated.type === 'text' && object instanceof Textbox) {
    updated.text = object.text;
    updated.width = object.width;
    updated.height = object.height;
  }
  if (updated.type === 'group' && object instanceof Group)
    updated.children = object.getObjects().flatMap((child) => {
      const layer = readObjectLayer(child);
      return layer ? [layer] : [];
    });
  return updated;
}

export async function exportScene(
  scene: SceneDocumentV1,
  assets: EditorAsset[],
  options: {
    format: 'png' | 'jpeg';
    policy?: ExportPolicy;
    scale: number;
    transparent: boolean;
    signal: AbortSignal;
    layerIds?: string[];
    onDimensions?: (size: { width: number; height: number }) => void;
  },
): Promise<Blob> {
  if (!Number.isFinite(options.scale) || options.scale < 0.1 || options.scale > 3)
    throw new Error(t('导出倍率无效。'));
  if (options.layerIds) {
    const layers = scene.layers.filter(
      (layer) => options.layerIds!.includes(layer.id) && layer.visible,
    );
    if (!layers.length) throw new Error(t('请先选择可见图层。'));
    scene = { ...scene, layers };
  }
  for (const id of getSceneAssetIds(scene)) {
    if (assets.find((asset) => asset.id === id)?.originalAvailable === false)
      throw new Error(t('原件下载未授权，不能导出原始画布。'));
  }
  if (
    !options.layerIds &&
    scene.canvas.width * scene.canvas.height * options.scale ** 2 > 67_108_864
  )
    throw new Error(t('导出超过6400万像素，请降低倍率。'));
  const element = document.createElement('canvas');
  const canvas = new StaticCanvas(element, {
    width: scene.canvas.width,
    height: scene.canvas.height,
    enableRetinaScaling: false,
    renderOnAddRemove: false,
    backgroundColor:
      options.format === 'png' && options.transparent
        ? ''
        : scene.canvas.background === 'transparent'
          ? '#FFFFFF'
          : scene.canvas.background,
  });
  let result: RenderedScene | undefined;
  try {
    result = await createSceneObjects(scene, assets, {
      signal: options.signal,
      readOnly: true,
      strict: true,
    });
    canvas.add(...result.objects);
    canvas.renderAll();
    let crop: { left: number; top: number; width: number; height: number } | undefined;
    if (options.layerIds) {
      const bounds = result.objects
        .filter((object) => object.visible)
        .map((object) => object.getBoundingRect());
      const left = Math.floor(Math.min(...bounds.map((b) => b.left)));
      const top = Math.floor(Math.min(...bounds.map((b) => b.top)));
      crop = {
        left,
        top,
        width: Math.ceil(Math.max(...bounds.map((b) => b.left + b.width))) - left,
        height: Math.ceil(Math.max(...bounds.map((b) => b.top + b.height))) - top,
      };
    }
    const width = Math.round((crop?.width || scene.canvas.width) * options.scale);
    const height = Math.round((crop?.height || scene.canvas.height) * options.scale);
    if (width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > 67_108_864)
      throw new Error(t('导出超过6400万像素，请降低倍率。'));
    options.onDimensions?.({ width, height });
    const output = canvas.toCanvasElement(options.scale, crop);
    applyExportWatermark(output, options.policy);
    return await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(t('浏览器无法导出此画布。')))),
        `image/${options.format}`,
        0.95,
      ),
    );
  } finally {
    result?.release();
    await canvas.dispose();
  }
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

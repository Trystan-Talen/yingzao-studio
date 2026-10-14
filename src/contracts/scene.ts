import { z } from 'zod';

/** Stable app document: pixels, explicit top-left origin, array order is back to front. */
export interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  skewX?: number;
  skewY?: number;
  flipX?: boolean;
  flipY?: boolean;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  fill: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  underline: boolean;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: string;
  /** Crop is in source-image pixels, before any document transform. */
  crop: { x: number; y: number; width: number; height: number } | null;
}

export interface VideoLayer extends LayerBase {
  type: 'video';
  assetId: string;
  posterAssetId: string | null;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  muted: boolean;
  loop: boolean;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface GroupLayer extends LayerBase {
  type: 'group';
  /** Child positions use the group's unscaled top-left as their origin. */
  children: SceneLayer[];
}

export type SceneLayer = TextLayer | ImageLayer | VideoLayer | ShapeLayer | GroupLayer;

export interface SceneDocumentV1 {
  schemaVersion: 1;
  canvas: { width: number; height: number; background: string };
  layers: SceneLayer[];
}

const color = z.string().regex(/^(#[\da-fA-F]{6}|#[\da-fA-F]{8}|transparent)$/);
const coordinate = z.number().finite().min(-100_000).max(100_000);
const dimension = z.number().finite().min(0.1).max(32_768);
const identifier = z.string().uuid();
const base = {
  id: identifier,
  name: z.string().max(160),
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
  rotation: z.number().finite().min(-360).max(360),
  scaleX: z.number().finite().min(0.001).max(1_000),
  scaleY: z.number().finite().min(0.001).max(1_000),
  opacity: z.number().finite().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  skewX: z.number().finite().min(-89).max(89).optional(),
  skewY: z.number().finite().min(-89).max(89).optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
};

export const sceneLayerSchema: z.ZodType<SceneLayer> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        ...base,
        type: z.literal('text'),
        text: z.string().max(20_000),
        fontFamily: z.string().min(1).max(120),
        fontSize: z.number().min(1).max(2_000),
        fontWeight: z.enum(['normal', 'bold']),
        fontStyle: z.enum(['normal', 'italic']),
        fill: color,
        textAlign: z.enum(['left', 'center', 'right']),
        lineHeight: z.number().min(0.5).max(5),
        underline: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal('image'),
        assetId: identifier,
        crop: z
          .object({
            x: z.number().min(0),
            y: z.number().min(0),
            width: dimension,
            height: dimension,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal('video'),
        assetId: identifier,
        posterAssetId: identifier.nullable(),
        durationMs: z.number().int().positive().max(86_400_000),
        trimStartMs: z.number().int().min(0),
        trimEndMs: z.number().int().positive(),
        muted: z.boolean(),
        loop: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal('shape'),
        shape: z.enum(['rect', 'ellipse']),
        fill: color,
        stroke: color,
        strokeWidth: z.number().min(0).max(1_000),
        cornerRadius: z.number().min(0).max(16_384),
      })
      .strict(),
    z
      .object({ ...base, type: z.literal('group'), children: z.array(sceneLayerSchema).max(500) })
      .strict(),
  ]),
);

const documentShape = z
  .object({
    schemaVersion: z.literal(1),
    canvas: z.object({ width: dimension, height: dimension, background: color }).strict(),
    layers: z.array(sceneLayerSchema).max(500),
  })
  .strict()
  .superRefine((scene, context) => {
    const ids = new Set<string>();
    let count = 0;
    function visit(layers: SceneLayer[], depth: number): void {
      if (depth > 8) {
        context.addIssue({ code: 'custom', message: '图层分组最多允许8级。', path: ['layers'] });
        return;
      }
      for (const layer of layers) {
        count += 1;
        if (ids.has(layer.id))
          context.addIssue({ code: 'custom', message: '图层ID不能重复。', path: ['layers'] });
        ids.add(layer.id);
        if (
          layer.type === 'video' &&
          (layer.trimStartMs >= layer.trimEndMs || layer.trimEndMs > layer.durationMs)
        ) {
          context.addIssue({
            code: 'custom',
            message: '视频裁剪范围必须在原始时长内。',
            path: ['layers'],
          });
        }
        if (layer.type === 'group') visit(layer.children, depth + 1);
      }
    }
    visit(scene.layers, 0);
    if (count > 500)
      context.addIssue({ code: 'custom', message: '文档最多允许500个图层。', path: ['layers'] });
    if (scene.canvas.width * scene.canvas.height > 67_108_864) {
      context.addIssue({ code: 'custom', message: '画布最多允许6400万像素。', path: ['canvas'] });
    }
  });

/** Response/OpenAPI shape has no input preprocessing; request validation retains its depth guard. */
export const sceneDocumentOutputSchema: z.ZodType<SceneDocumentV1> = documentShape;

// Bound depth and total nodes before recursive Zod parsing, including malformed input.
export const sceneDocumentSchema: z.ZodType<SceneDocumentV1> = z.preprocess((input, context) => {
  if (!input || typeof input !== 'object' || !('layers' in input) || !Array.isArray(input.layers))
    return input;
  const pending: Array<{ value: unknown; depth: number }> = input.layers.map((value: unknown) => ({
    value,
    depth: 0,
  }));
  let count = 0;
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    count += 1;
    if (count > 500 || next.depth > 8) {
      context.addIssue({
        code: 'custom',
        message: count > 500 ? '文档最多允许500个图层。' : '图层分组最多允许8级。',
      });
      return z.NEVER;
    }
    if (
      next.value &&
      typeof next.value === 'object' &&
      'children' in next.value &&
      Array.isArray(next.value.children)
    ) {
      for (const value of next.value.children) pending.push({ value, depth: next.depth + 1 });
    }
  }
  return input;
}, documentShape);

export const SceneDocumentSchema = sceneDocumentSchema;

export function blankScene(width = 1200, height = 900): SceneDocumentV1 {
  return sceneDocumentSchema.parse({
    schemaVersion: 1,
    canvas: { width, height, background: '#FFFFFF' },
    layers: [],
  });
}

/** The caller must authorize every reference in this list against the active workspace. */
export function getSceneAssetIds(scene: SceneDocumentV1): string[] {
  const ids = new Set<string>();
  function visit(layers: SceneLayer[]): void {
    for (const layer of layers) {
      if (layer.type === 'image' || layer.type === 'video') ids.add(layer.assetId);
      if (layer.type === 'video' && layer.posterAssetId) ids.add(layer.posterAssetId);
      if (layer.type === 'group') visit(layer.children);
    }
  }
  visit(scene.layers);
  return [...ids];
}

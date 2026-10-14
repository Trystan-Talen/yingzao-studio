import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Point, util } from 'fabric';
import {
  blankScene,
  getSceneAssetIds,
  sceneDocumentSchema,
  sceneDocumentOutputSchema,
  type GroupLayer,
  type ImageLayer,
  type SceneLayer,
  type ShapeLayer,
  type VideoLayer,
} from '../../contracts/scene.js';
import {
  alignLayers,
  cloneLayer,
  groupLayers,
  layerBase,
  layerBounds,
  layerFromAsset,
  layerMatrix,
  reorderLayer,
  ungroupLayer,
} from './scene-operations.js';

function shape(overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    ...layerBase('形状', 100, 80),
    type: 'shape',
    shape: 'rect',
    fill: '#123456',
    stroke: '#000000',
    strokeWidth: 0,
    cornerRadius: 0,
    ...overrides,
  };
}

describe('independent scene document validation', () => {
  it('provides a bidirectional response schema while guarding untrusted request depth', () => {
    const scene = { ...blankScene(), layers: [shape()] };
    expect(z.encode(sceneDocumentOutputSchema, scene)).toEqual(scene);
  });
  it('requires explicit version, rejects executable/engine-specific fields and non-finite geometry', () => {
    expect(sceneDocumentSchema.safeParse(blankScene()).success).toBe(true);
    expect(sceneDocumentSchema.safeParse({ ...blankScene(), schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(sceneDocumentSchema.safeParse({ ...blankScene(), objects: [] }).success).toBe(false);
    expect(
      sceneDocumentSchema.safeParse({
        ...blankScene(),
        layers: [{ ...shape(), onClick: 'alert(1)' }],
      }).success,
    ).toBe(false);
    expect(
      sceneDocumentSchema.safeParse({ ...blankScene(), layers: [shape({ scaleX: Infinity })] })
        .success,
    ).toBe(false);
  });

  it('rejects duplicate nested layer identities and excessive nesting before recursion', () => {
    const child = shape();
    const group: GroupLayer = { ...layerBase('组'), type: 'group', children: [child] };
    expect(sceneDocumentSchema.safeParse({ ...blankScene(), layers: [child, group] }).success).toBe(
      false,
    );
    let nested: unknown = child;
    for (let index = 0; index < 2000; index += 1)
      nested = { ...layerBase('嵌套组'), type: 'group', children: [nested] };
    expect(() =>
      sceneDocumentSchema.safeParse({ ...blankScene(), layers: [nested] }),
    ).not.toThrow();
    expect(sceneDocumentSchema.safeParse({ ...blankScene(), layers: [nested] }).success).toBe(
      false,
    );
  });

  it('validates video ranges and recursively returns all original and poster references once', () => {
    const assetId = crypto.randomUUID();
    const posterId = crypto.randomUUID();
    const video: VideoLayer = {
      ...layerBase('视频'),
      type: 'video',
      assetId,
      posterAssetId: posterId,
      durationMs: 5000,
      trimStartMs: 1000,
      trimEndMs: 4000,
      muted: true,
      loop: false,
    };
    const image: ImageLayer = {
      ...layerBase('图片'),
      type: 'image',
      assetId: posterId,
      crop: null,
    };
    const group: GroupLayer = { ...layerBase('组'), type: 'group', children: [video, image] };
    const scene = { ...blankScene(), layers: [group] };
    expect(sceneDocumentSchema.safeParse(scene).success).toBe(true);
    expect(getSceneAssetIds(scene).sort()).toEqual([assetId, posterId].sort());
    expect(
      sceneDocumentSchema.safeParse({ ...blankScene(), layers: [{ ...video, trimEndMs: 5001 }] })
        .success,
    ).toBe(false);
    expect(
      sceneDocumentSchema.safeParse({ ...blankScene(), layers: [{ ...video, trimStartMs: 4000 }] })
        .success,
    ).toBe(false);
  });

  it('bounds document pixel area and total layers across separate groups', () => {
    expect(() => blankScene(10000, 10000)).toThrow();
    const groups: GroupLayer[] = Array.from({ length: 3 }, () => ({
      ...layerBase('组'),
      type: 'group',
      children: Array.from({ length: 200 }, () => shape()),
    }));
    expect(sceneDocumentSchema.safeParse({ ...blankScene(), layers: groups }).success).toBe(false);
  });
});

describe('document transforms and editing operations', () => {
  it('groups transformed layers without changing their visual corners', () => {
    const first = shape({ x: 40, y: 90, rotation: 35, scaleX: 1.8, scaleY: 0.6 });
    const second = shape({ x: 390, y: 170, rotation: -20, flipX: true });
    const scene = { ...blankScene(), layers: [first, second] };
    const result = groupLayers(scene, [first.id, second.id]);
    expect(result).not.toBeNull();
    const group = result?.scene.layers[0];
    if (group?.type !== 'group') throw new Error('Expected group');
    [first, second].forEach((original, index) => {
      const child = group.children[index];
      if (!child) throw new Error('Missing child');
      const expected = layerMatrix(original);
      const actual = util.multiplyTransformMatrices(layerMatrix(group), layerMatrix(child));
      actual.forEach((number, position) =>
        expect(number).toBeCloseTo(expected[position] ?? NaN, 8),
      );
    });
  });

  it('ungroups rotated/non-uniformly-scaled groups with exact affine composition', () => {
    const child = shape({ x: 30, y: 20, rotation: 42, scaleX: 0.7, scaleY: 1.2 });
    const group: GroupLayer = {
      ...layerBase('组', 400, 300),
      type: 'group',
      x: 190,
      y: 100,
      rotation: -25,
      scaleX: 1.5,
      scaleY: 0.6,
      opacity: 0.5,
      children: [child],
    };
    const before = util.multiplyTransformMatrices(layerMatrix(group), layerMatrix(child));
    const ungrouped = ungroupLayer({ ...blankScene(), layers: [group] }, group.id);
    const layer = ungrouped.scene.layers[0];
    if (!layer) throw new Error('Missing ungrouped layer');
    layerMatrix(layer).forEach((number, index) =>
      expect(number).toBeCloseTo(before[index] ?? NaN, 7),
    );
    expect(layer.opacity).toBe(0.5);
    expect(ungrouped.selectedIds).toEqual([child.id]);
  });

  it('aligns the rotated visual bounds and leaves locked layers unchanged', () => {
    const layer = shape({ rotation: 65, x: 240, y: 100 });
    const locked = shape({ locked: true });
    const scene = { ...blankScene(), layers: [layer, locked] };
    const aligned = alignLayers(scene, [layer.id, locked.id], 'right');
    const changed = aligned.layers[0];
    if (!changed) throw new Error('Missing aligned layer');
    expect(layerBounds(changed).right).toBeCloseTo(scene.canvas.width, 7);
    expect(aligned.layers[1]).toEqual(locked);
  });

  it('duplicates nested IDs and reorders only unlocked layers within bounds', () => {
    const child = shape();
    const group: GroupLayer = { ...layerBase('组'), type: 'group', children: [child] };
    const copy = cloneLayer(group);
    expect(copy.id).not.toBe(group.id);
    expect(copy.type === 'group' && copy.children[0]?.id).not.toBe(child.id);
    const locked = shape({ locked: true });
    const scene = { ...blankScene(), layers: [group, locked] };
    expect(reorderLayer(scene, locked.id, -1)).toBe(scene);
    expect(reorderLayer(scene, group.id, -1)).toBe(scene);
    expect(reorderLayer(scene, group.id, 1).layers.map((layer) => layer.id)).toEqual([
      locked.id,
      group.id,
    ]);
  });

  it('places media inside the artboard and refuses fake video duration', () => {
    const scene = blankScene(800, 600);
    const image = layerFromAsset(
      {
        id: crypto.randomUUID(),
        name: '原图',
        kind: 'image',
        originalUrl: '/protected/original',
        width: 4000,
        height: 2000,
      },
      scene,
    );
    expect(image.width).toBe(600);
    expect(image.height).toBe(300);
    expect(image.x).toBe(100);
    expect(image.y).toBe(150);
    expect(() =>
      layerFromAsset(
        { id: crypto.randomUUID(), name: '视频', kind: 'video', originalUrl: '/video' },
        scene,
      ),
    ).toThrow(/真实时长/);
  });

  it('uses stable left-top pixel origins through serialized roundtrips', () => {
    const layers: SceneLayer[] = [shape({ x: 21.125, y: 9.75, rotation: 90 })];
    const restored = sceneDocumentSchema.parse(
      JSON.parse(JSON.stringify({ ...blankScene(), layers })),
    );
    const layer = restored.layers[0];
    if (!layer) throw new Error('Missing layer');
    const corner = util.transformPoint(new Point(0, 0), layerMatrix(layer));
    expect(corner.x).toBe(21.125);
    expect(corner.y).toBe(9.75);
  });
});

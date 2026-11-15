import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  creativeIntentRequestSchema,
  creativeIntentResultSchema,
} from '../src/contracts/creative-intent';
import { nativeImageEditSchema } from '../src/contracts/native-image-edit';
import { jobInputSchema } from '../src/contracts/jobs';
import { parseNativeIntentResponse } from '../src/server/providers/native-planner';
import {
  compileNativeBackgroundMask,
  composeNativeBackground,
  executeNativeBackground,
  normalizeNativeBackgroundMask,
  normalizeConfirmedNativeBackgroundMask,
} from '../src/server/providers/native-background';
import type {
  ExecutionContext,
  NativeArtifact,
  NativeArtifactRole,
  ProviderOutput,
} from '../src/server/tasks/types';

function fixture() {
  const sourceAssetId = randomUUID();
  const rawPrompt = '仅把后方背景改为#E6E8EB，保留主体各部件、前景台面和接触阴影。';
  const request = creativeIntentRequestSchema.parse({
    version: 1,
    requestId: randomUUID(),
    rawPrompt,
    sourceTexts: [{ id: 'request', text: rawPrompt }],
    answers: [],
    materials: [
      {
        id: sourceAssetId,
        name: '原图.png',
        kind: 'image',
        role: 'input',
        width: 2048,
        height: 2048,
        byteSize: 1000,
      },
    ],
    context: {
      mediaType: 'image',
      platform: '通用电商',
      placement: 'general',
      language: 'zh-CN',
      count: 1,
      ratio: '1:1',
      resolution: '2K',
      supportsReference: true,
      supportsAudio: false,
      supportsText: false,
      supportsBackgroundMask: true,
      imageEditSize: { width: 2048, height: 2048 },
    },
    strategy: { id: 'fixture', guidance: '' },
  });
  const edit = nativeImageEditSchema.parse({
    type: 'solid-background',
    sourceAssetId,
    color: '#E6E8EB',
    regionDescription: '后方背景',
    preserveDescription: '主体各部件、前景台面和接触阴影',
    mask: { mode: 'generate' },
  });
  const result = creativeIntentResultSchema.parse({
    type: 'intent-plan',
    version: 1,
    requestId: request.requestId,
    status: 'ready',
    brief: {
      scope: 'product',
      subject: '参考商品',
      goal: '仅换背景色',
      mediaType: 'image',
      platform: '通用电商',
      placement: 'general',
      productMode: 'reference',
      facts: [{ sourceId: 'request', quote: rawPrompt }],
      constraints: [],
    },
    summary: '原图不重绘，仅替换指定背景颜色。',
    assumptions: [],
    questions: [],
    prompt: rawPrompt,
    imageEdit: edit,
    reviewChecklist: [],
  });
  return { request, result, edit };
}
const response = (value: unknown) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
});

describe('strict background planning', () => {
  it('appends source-specific observations without replacing the user region or treating observations as editing permission', () => {
    const { edit } = fixture();
    edit.visualGuidance = {
      boundaryNotes: '后方为布面柔边，瓶盖外缘是清晰硬边。',
      uncertainties: ['靠近接触阴影的平面界限不清晰'],
      evidence: {
        sourceSha256: 'a'.repeat(64),
        model: 'vision-fixture',
        analyzedAt: '2026-11-13T00:00:00Z',
      },
    };
    const prompt = compileNativeBackgroundMask(edit);
    expect(prompt).toContain(`背景区域：${edit.regionDescription}`);
    expect(prompt).toContain(`保留的区域：${edit.preserveDescription}`);
    expect(prompt).toContain(edit.visualGuidance.boundaryNotes);
    expect(prompt).toContain(edit.visualGuidance.uncertainties[0]);
    expect(prompt).toContain('不是修改授权');
    expect(prompt).toContain('不能当作已证实的区域边界');
  });
  it('keeps explicit source/color/region and discloses the model-mask/local-composite boundary exactly once', () => {
    const { request, result, edit } = fixture();
    const parsed = parseNativeIntentResponse(response(result), request);
    expect(parsed.imageEdit).toEqual(edit);
    expect(parsed.imageEdit!.color).toBe('#e6e8eb');
    expect(parsed.summary).toContain('本机按蒙版精确填色');
    expect(parsed.summary).toContain('分割边界仍需核对');
    expect(parseNativeIntentResponse(response(parsed), request).summary).toBe(parsed.summary);
    const prompt = compileNativeBackgroundMask(edit);
    expect(prompt).toContain('前景台面和接触阴影');
    expect(prompt).toContain('只输出与原图尺寸、构图和坐标完全一致的黑白编辑蒙版');
    expect(prompt).toContain('实心纯黑剪影');
    expect(prompt).toContain('不能只留下主体右方或下方的影子');
    expect(prompt).toContain('不凭空添加直线地平线');
    expect(prompt).not.toMatch(/口红|香水|左前方|中央偏右|#e6e8eb/);
  });
  it.each([
    'no-color',
    'multiple-colors',
    'not-background-only',
    'different-color',
    'attachment-only',
  ] as const)('rejects invented editing intent: %s', (reason) => {
    const { request, result } = fixture();
    result.brief.facts = [];
    if (reason === 'no-color') request.rawPrompt = '仅把背景改为浅灰，保留前景。';
    if (reason === 'multiple-colors') request.rawPrompt += '或者#ffffff。';
    if (reason === 'not-background-only') request.rawPrompt = '整体改为#e6e8eb，同时重新设计主体。';
    if (reason === 'different-color') result.imageEdit!.color = '#112233';
    if (reason === 'attachment-only') {
      request.sourceTexts.push({ id: 'attachment', text: request.rawPrompt });
      request.rawPrompt = '制作一张产品图。';
    }
    expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
      'IMAGE_EDIT_INTENT_UNCONFIRMED',
    );
  });
  it.each(['unowned', 'multiple', 'unsupported'] as const)(
    'rejects unavailable source or mask capability: %s',
    (reason) => {
      const { request, result } = fixture();
      if (reason === 'unowned') result.imageEdit!.sourceAssetId = randomUUID();
      if (reason === 'multiple')
        request.materials.push({ ...request.materials[0]!, id: randomUUID() });
      if (reason === 'unsupported') request.context.supportsBackgroundMask = false;
      expect(() => parseNativeIntentResponse(response(result), request)).toThrow(
        reason === 'unsupported' ? 'IMAGE_EDIT_MASK_UNSUPPORTED' : 'IMAGE_EDIT_SOURCE_INVALID',
      );
    },
  );
  it('clarifies a dimension mismatch instead of resizing or silently reverting to generative editing', () => {
    const { request, result } = fixture();
    request.materials[0]!.width = 1024;
    const parsed = parseNativeIntentResponse(response(result), request);
    expect(parsed.status).toBe('needs_clarification');
    expect(parsed.imageEdit).toBeUndefined();
    expect(parsed.prompt).toBe('');
    expect(parsed.questions[0]!.field).toBe('delivery');
    expect(parsed.summary).toContain('尺寸不匹配');
  });
  it('accepts only the supplied mask role with identical measured dimensions', () => {
    const { request, result } = fixture();
    const id = randomUUID();
    request.materials.push({
      id,
      name: '区域.png',
      kind: 'image',
      role: 'mask',
      width: 2048,
      height: 2048,
    });
    result.imageEdit!.mask = { mode: 'asset', assetId: id };
    request.context.supportsBackgroundMask = false;
    expect(parseNativeIntentResponse(response(result), request).summary).toContain(
      '使用提供的蒙版',
    );
    request.materials[1]!.role = 'reference';
    expect(() => parseNativeIntentResponse(response(result), request)).toThrow();
  });
});

async function pixels(buffer: Buffer) {
  return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
async function image(width: number, height: number, color: string) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}
async function mask(width: number, height: number) {
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width / 3; x++) data[y * width + x] = 255;
  return sharp(data, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

describe('deterministic background composition', () => {
  it('removes only isolated model-gray drawings while retaining white holes and their edge pixels', async () => {
    const width = 32,
      height = 32;
    const data = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < 8; x++) data[y * width + x] = 255;
    data[10 * width + 8] = 96; // Gray beside the main editable region.
    data[11 * width + 9] = 160; // Diagonal connection must also remain.
    data[20 * width + 20] = 255; // A genuine background hole is not sealed.
    data[20 * width + 21] = 128;
    data[15 * width + 15] = 100; // Disconnected model-drawn highlight/outline.
    data[16 * width + 15] = 170;
    const candidate = await sharp(data, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    const normal = await sharp(await normalizeNativeBackgroundMask(candidate, width, height))
      .greyscale()
      .raw()
      .toBuffer();
    const cleaned = await sharp(
      await normalizeNativeBackgroundMask(candidate, width, height, { removeIsolatedGray: true }),
    )
      .greyscale()
      .raw()
      .toBuffer();
    for (const index of [10 * width + 8, 11 * width + 9, 20 * width + 20, 20 * width + 21])
      expect(cleaned[index]).toBe(normal[index]);
    for (const index of [15 * width + 15, 16 * width + 15]) {
      expect(normal[index]).toBeGreaterThan(0);
      expect(cleaned[index]).toBe(0);
    }
    for (let index = 0; index < data.length; index++)
      if (data[index] === 0 || data[index] === 255) expect(cleaned[index]).toBe(data[index]);
  });
  it.each([
    [32, 32, '#d4a26f'],
    [48, 32, '#123456'],
    [32, 48, '#d82f76'],
  ] as const)(
    'preserves every protected pixel and fills the exact target across %s×%s sources',
    async (width, height, color) => {
      const source = await image(width, height, color);
      const matte = await normalizeNativeBackgroundMask(await mask(width, height), width, height);
      const before = await pixels(source);
      const after = await pixels(await composeNativeBackground(source, matte, '#e6e8eb'));
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4;
          expect([...after.data.subarray(index, index + 4)]).toEqual(
            x < width / 3 ? [230, 232, 235, 255] : [...before.data.subarray(index, index + 4)],
          );
        }
    },
  );
  it.each(['color', 'all-white', 'all-black', 'gray', 'wrong-size'] as const)(
    'rejects a %s candidate without resizing it',
    async (kind) => {
      const buffer =
        kind === 'wrong-size'
          ? await mask(16, 16)
          : await image(
              32,
              32,
              kind === 'color'
                ? '#ff0000'
                : kind === 'all-white'
                  ? '#ffffff'
                  : kind === 'all-black'
                    ? '#000000'
                    : '#808080',
            );
      await expect(normalizeNativeBackgroundMask(buffer, 32, 32)).rejects.toThrow(
        kind === 'wrong-size' ? '尺寸' : '蒙版',
      );
    },
  );
});

async function execution() {
  const { edit } = fixture();
  const source = await image(32, 32, '#bc8745');
  const records = new Map<NativeArtifactRole, NativeArtifact>();
  const context: ExecutionContext = {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse({
      providerId: 'native',
      operation: 'image.generate',
      prompt: '仅换背景',
      assetIds: [edit.sourceAssetId],
      imageEdit: edit,
      options: {
        model: 'doubao-seedream-5.0-lite',
        resolution: '2K',
        ratio: '1:1',
        needText: false,
      },
    }),
    readAsset: async () => ({ buffer: source, mimeType: 'image/png', name: '原图.png' }),
    nativeArtifacts: {
      load: async (role) => records.get(role),
      save: async (role, output) => {
        const record = {
          assetId: randomUUID(),
          buffer: output.buffer!,
          mimeType: output.mimeType,
          name: output.name,
        };
        records.set(role, record);
        return record;
      },
    },
  };
  return { context, records, source };
}
describe('confirmed alpha mask precision', () => {
  it('keeps every user alpha level and wide soft transitions instead of applying model thresholds', async () => {
    const width = 256,
      height = 32;
    const sourceAlpha = Buffer.from(
      Array.from({ length: width * height }, (_, index) => index % width),
    );
    const supplied = await sharp({ create: { width, height, channels: 3, background: '#000000' } })
      .joinChannel(sourceAlpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    const normalized = await normalizeConfirmedNativeBackgroundMask(supplied, width, height);
    const values = await sharp(normalized).greyscale().raw().toBuffer();
    expect([...values]).toEqual([...sourceAlpha].map((value) => 255 - value));
    const composite = await composeNativeBackground(
      await image(width, height, '#1e3c5a'),
      normalized,
      '#e6e8eb',
    );
    const pixels = await sharp(composite).removeAlpha().raw().toBuffer();
    for (const alpha of [0, 1, 16, 63, 128, 191, 239, 254, 255]) {
      const expected = [30, 60, 90].map((channel, index) =>
        Math.round((channel * alpha + [230, 232, 235][index]! * (255 - alpha)) / 255),
      );
      expect([...pixels.subarray(alpha * 3, alpha * 3 + 3)]).toEqual(expected);
    }
  });
  it.each([0, 255])(
    'rejects a uniform alpha mask without both protection and editing: %s',
    async (alpha) => {
      const supplied = await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: alpha / 255 },
        },
      })
        .png()
        .toBuffer();
      await expect(normalizeConfirmedNativeBackgroundMask(supplied, 32, 32)).rejects.toThrow(
        '完整保留区',
      );
    },
  );
});
describe('durable mask execution', () => {
  it('binds visual guidance to the exact original source bytes before a paid mask call', async () => {
    const { context, source } = await execution();
    context.input.imageEdit!.visualGuidance = {
      boundaryNotes: '前景保持。',
      uncertainties: [],
      evidence: {
        sourceSha256: '0'.repeat(64),
        model: 'vision-fixture',
        analyzedAt: '2026-11-13T00:00:00Z',
      },
    };
    const generate = vi.fn(async () => ({
      buffer: await mask(32, 32),
      mimeType: 'image/png',
      name: '候选.png',
    }));
    await expect(
      executeNativeBackground(context, generate, { width: 32, height: 32 }),
    ).rejects.toThrow('当前原图不匹配');
    expect(generate).not.toHaveBeenCalled();
    const digest = createHash('sha256').update(source).digest('hex');
    context.input.imageEdit!.visualGuidance.evidence.sourceSha256 = digest;
    const result = await executeNativeBackground(context, generate, { width: 32, height: 32 });
    if (result.state !== 'complete') throw Error('fixture');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.outputs[0]!.processing?.params).toMatchObject({
      visualSourceSha256: digest,
      visualAnalysisModel: 'vision-fixture',
    });
  });
  it('freezes raw, v2 baseline and calibrated mask separately and reuses the saved calibrated bytes', async () => {
    const { context, records } = await execution();
    context.input.imageEdit!.mask = { mode: 'generate', calibration: 'source-guided-v1' };
    const width = 512,
      height = 512;
    const rgb = Buffer.alloc(width * height * 3),
      matte = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const t = Math.max(0, Math.min(1, 0.5 + (x + 0.5 - 256) / 12));
        const alpha = t * t * (3 - 2 * t);
        matte[y * width + x] = x >= 256 ? 255 : 0;
        for (let c = 0; c < 3; c++)
          rgb[(y * width + x) * 3 + c] = Math.round(30 * (1 - alpha) + 210 * alpha);
      }
    const source = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    const raw = await sharp(matte, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    context.readAsset = async () => ({ buffer: source, mimeType: 'image/png', name: '原图.png' });
    const generate = vi.fn(async () => ({
      buffer: raw,
      mimeType: 'image/png',
      name: '模型蒙版.png',
    }));
    const first = await executeNativeBackground(context, generate, { width, height });
    expect([...records.keys()]).toEqual([
      'background-mask-raw',
      'background-mask-baseline',
      'background-mask',
    ]);
    expect(records.get('background-mask-raw')!.buffer).toEqual(raw);
    expect(records.get('background-mask-baseline')!.buffer).toEqual(
      await normalizeNativeBackgroundMask(raw, width, height, { removeIsolatedGray: true }),
    );
    expect(records.get('background-mask')!.buffer).not.toEqual(
      records.get('background-mask-baseline')!.buffer,
    );
    if (first.state !== 'complete') throw Error('fixture');
    expect(first.outputs[0]!.processing).toMatchObject({
      maskAssetIds: { baseline: records.get('background-mask-baseline')!.assetId },
      params: { maskAlgorithm: 'source-guided-v1', calibrationVersion: 'source-guided-v1' },
    });
    expect(first.outputs[0]!.text).toContain('待核对候选');
    expect(first.outputs[0]!.text).toContain('校准只依据原图与自动候选');
    const save = vi.spyOn(context.nativeArtifacts!, 'save');
    context.resumeLocalProcessing = true;
    const resumed = await executeNativeBackground(context, generate, { width, height });
    if (resumed.state !== 'complete') throw Error('fixture');
    expect(resumed.outputs[0]!.buffer).toEqual(first.outputs[0]!.buffer);
    expect(resumed.outputs[0]!.text).toContain('未重新校准或重新评估边界');
    expect(resumed.outputs[0]!.processing?.params?.maskAlgorithm).toBe('saved-checkpoint');
    expect(save).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('recovers after the baseline is persisted without purchasing another mask and reports unsupported edges', async () => {
    const { context, records } = await execution();
    context.input.imageEdit!.mask = { mode: 'generate', calibration: 'source-guided-v1' };
    const originalSave = context.nativeArtifacts!.save;
    let fail = true;
    context.nativeArtifacts!.save = async (role, output) => {
      if (role === 'background-mask' && fail) {
        fail = false;
        throw new Error('simulated checkpoint write interruption');
      }
      return originalSave(role, output);
    };
    const generate = vi.fn(async () => ({
      buffer: await mask(32, 32),
      mimeType: 'image/png',
      name: '模型蒙版.png',
    }));
    await expect(
      executeNativeBackground(context, generate, { width: 32, height: 32 }),
    ).rejects.toThrow('simulated checkpoint');
    expect(records.size).toBe(2);
    const baseline = records.get('background-mask-baseline');
    context.resumeLocalProcessing = true;
    const resumed = await executeNativeBackground(context, generate, { width: 32, height: 32 });
    if (resumed.state !== 'complete') throw Error('fixture');
    expect(records.get('background-mask-baseline')).toBe(baseline);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(resumed.outputs[0]!.processing?.params?.warnings).toContain('LOW_CONTRAST_BOUNDARY');
    expect(resumed.outputs[0]!.text).toContain('不代表区域分割通过');
  });
  it('does not silently create a missing baseline for an already saved calibrated mask', async () => {
    const { context, records } = await execution();
    context.input.imageEdit!.mask = { mode: 'generate', calibration: 'source-guided-v1' };
    records.set('background-mask', {
      assetId: randomUUID(),
      buffer: await mask(32, 32),
      mimeType: 'image/png',
      name: '已存.png',
    });
    const generate = vi.fn();
    await expect(
      executeNativeBackground(context, generate, { width: 32, height: 32 }),
    ).rejects.toThrow('缺少原归一化检查点');
    expect(generate).not.toHaveBeenCalled();
    expect(records.size).toBe(1);
  });
  it('keeps a legacy paid raw-mask recovery on v2 rather than opting it into calibration', async () => {
    const { context, records } = await execution();
    const raw = await mask(32, 32);
    records.set('background-mask-raw', {
      assetId: randomUUID(),
      buffer: raw,
      mimeType: 'image/png',
      name: '已付费.png',
    });
    context.resumeLocalProcessing = true;
    const generate = vi.fn();
    const result = await executeNativeBackground(context, generate, { width: 32, height: 32 });
    if (result.state !== 'complete') throw Error('fixture');
    expect(records.has('background-mask-baseline')).toBe(false);
    expect(result.outputs[0]!.processing?.params?.maskAlgorithm).toBe('grayscale-connected-v2');
    expect(records.get('background-mask')!.buffer).toEqual(
      await normalizeNativeBackgroundMask(raw, 32, 32, { removeIsolatedGray: true }),
    );
    expect(generate).not.toHaveBeenCalled();
  });
  it('does not re-normalize an older saved mask or relabel its algorithm on recovery', async () => {
    const { context, records, source } = await execution();
    const data = await sharp(await mask(32, 32))
      .greyscale()
      .raw()
      .toBuffer();
    data[20 * 32 + 20] = 100;
    const priorMask = await sharp(data, { raw: { width: 32, height: 32, channels: 1 } })
      .png()
      .toBuffer();
    records.set('background-mask', {
      assetId: randomUUID(),
      buffer: priorMask,
      mimeType: 'image/png',
      name: '已保存蒙版.png',
    });
    records.set('background-mask-raw', {
      assetId: randomUUID(),
      buffer: priorMask,
      mimeType: 'image/png',
      name: '已保存原件.png',
    });
    context.resumeLocalProcessing = true;
    const generate = vi.fn();
    const result = await executeNativeBackground(context, generate, { width: 32, height: 32 });
    if (result.state !== 'complete') throw Error('fixture');
    expect(generate).not.toHaveBeenCalled();
    expect(records.get('background-mask')!.buffer).toEqual(priorMask);
    expect(result.outputs[0]!.buffer).toEqual(
      await composeNativeBackground(source, priorMask, '#e6e8eb'),
    );
    expect(result.outputs[0]!.processing?.params?.maskAlgorithm).toBe('saved-checkpoint');
  });
  it('stores raw and normalized masks separately, returns only the composite, and resumes without another model call', async () => {
    const { context, records } = await execution();
    const generate = vi.fn(async (): Promise<ProviderOutput> => ({
      buffer: await mask(32, 32),
      mimeType: 'image/png',
      name: '模型蒙版.png',
    }));
    const first = await executeNativeBackground(context, generate, { width: 32, height: 32 });
    expect(records.size).toBe(2);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first.state).toBe('complete');
    if (first.state !== 'complete') throw Error('fixture');
    expect(first.outputs).toHaveLength(1);
    expect(first.outputs[0]!.processing).toMatchObject({
      method: 'exact-background-v1',
      color: '#e6e8eb',
      maskAssetIds: {
        raw: records.get('background-mask-raw')!.assetId,
        normalized: records.get('background-mask')!.assetId,
      },
      params: { maskAlgorithm: 'grayscale-connected-v2' },
    });
    expect(first.outputs[0]!.text).toContain('不是图片模型原生输出');
    context.resumeLocalProcessing = true;
    const next = await executeNativeBackground(context, generate, { width: 32, height: 32 });
    expect(next.state).toBe('complete');
    if (next.state !== 'complete') throw Error('fixture');
    expect(next.outputs[0]!.buffer).toEqual(first.outputs[0]!.buffer);
    expect(next.outputs[0]!.processing?.params?.maskAlgorithm).toBe('saved-checkpoint');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('retains an invalid paid candidate and never purchases a replacement on recovery', async () => {
    const { context, records } = await execution();
    const generate = vi.fn(async () => ({
      buffer: await image(32, 32, '#ffffff'),
      mimeType: 'image/png',
      name: '原始蒙版.png',
    }));
    await expect(
      executeNativeBackground(context, generate, { width: 32, height: 32 }),
    ).rejects.toThrow('候选');
    expect(records.has('background-mask-raw')).toBe(true);
    expect(records.has('background-mask')).toBe(false);
    context.resumeLocalProcessing = true;
    await expect(
      executeNativeBackground(context, generate, { width: 32, height: 32 }),
    ).rejects.toThrow('候选');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('fails a missing checkpoint on local recovery without calling a model', async () => {
    const { context } = await execution();
    context.resumeLocalProcessing = true;
    const generate = vi.fn();
    await expect(
      executeNativeBackground(context, generate, { width: 32, height: 32 }),
    ).rejects.toThrow('不会再次调用模型');
    expect(generate).not.toHaveBeenCalled();
  });
  it('uses an existing alpha mask without calling the image model', async () => {
    const { context, source } = await execution();
    const id = randomUUID();
    context.input.maskAssetId = id;
    context.input.imageEdit!.mask = { mode: 'asset', assetId: id };
    const edit = await sharp(await mask(32, 32))
      .negate()
      .raw()
      .toBuffer();
    const supplied = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#ffffff' },
    })
      .joinChannel(edit, { raw: { width: 32, height: 32, channels: 1 } })
      .png()
      .toBuffer();
    context.readAsset = async (assetId) => ({
      buffer: assetId === id ? supplied : source,
      mimeType: 'image/png',
      name: '素材.png',
    });
    const generate = vi.fn();
    const result = await executeNativeBackground(context, generate, { width: 32, height: 32 });
    expect(result.state).toBe('complete');
    expect(generate).not.toHaveBeenCalled();
  });
});

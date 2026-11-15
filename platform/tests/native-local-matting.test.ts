import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, expect, it, vi } from 'vitest';
import { jobInputSchema } from '../src/contracts/jobs';
import { nativeImageEditSchema } from '../src/contracts/native-image-edit';
import { executeNativeBackground } from '../src/server/providers/native-background';
import { composeMattingRefinement } from '../src/server/providers/native-matting-refinement';
import {
  canonicalLocalMattingSource,
  probeLocalMatting,
  runLocalMatting,
} from '../src/server/providers/local-matting';
import {
  localProcessEnvironment,
  serialLocalMatting,
} from '../src/server/providers/local-matting-process';
import {
  ProviderError,
  type ExecutionContext,
  type NativeArtifact,
  type NativeArtifactRole,
} from '../src/server/tasks/types';

vi.mock('../src/server/providers/local-matting', async (original) => ({
  ...(await original<typeof import('../src/server/providers/local-matting')>()),
  probeLocalMatting: vi.fn(),
  runLocalMatting: vi.fn(),
}));
const probe = vi.mocked(probeLocalMatting),
  compute = vi.mocked(runLocalMatting);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const gray = (values: number[], width = values.length) =>
  sharp(Buffer.from(values), { raw: { width, height: values.length / width, channels: 1 } })
    .png()
    .toBuffer();
const rgb = (values: number[], width = values.length / 3) =>
  sharp(Buffer.from(values), { raw: { width, height: values.length / width / 3, channels: 3 } })
    .png()
    .toBuffer();
beforeEach(() => {
  probe.mockReset();
  compute.mockReset();
  probe.mockResolvedValue({
    pythonPath: '/unused/python',
    runtimePath: '/unused/ort',
    modelPath: '/unused/model',
    helperDir: '/unused/helpers',
    sharpPath: '/unused/sharp',
    identity: 'fixture',
  });
});

async function fixture() {
  const sourceAssetId = randomUUID();
  const source = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  const mask = await gray(
    Array.from({ length: 64 * 64 }, (_, i) => (i % 64 < 32 ? 0 : 255)),
    64,
  );
  const composite = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#aabbcc' },
  })
    .png()
    .toBuffer();
  const records = new Map<NativeArtifactRole, NativeArtifact>();
  const save = vi.fn(
    async (
      role: NativeArtifactRole,
      output: { buffer?: Buffer; mimeType: string; name: string },
    ) => {
      const record = {
        assetId: randomUUID(),
        buffer: output.buffer!,
        mimeType: output.mimeType,
        name: output.name,
      };
      records.set(role, record);
      return record;
    },
  );
  const pair = vi.fn(async (mask: Buffer, composite: Buffer) => ({
    mask: await save('background-mask', { buffer: mask, mimeType: 'image/png', name: 'mask.png' }),
    composite: await save('background-matting-composite', {
      buffer: composite,
      mimeType: 'image/png',
      name: 'composite.png',
    }),
  }));
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
      prompt: '仅替换背景',
      assetIds: [sourceAssetId],
      imageEdit: {
        type: 'solid-background',
        sourceAssetId,
        color: '#aabbcc',
        regionDescription: '后方背景',
        preserveDescription: '主体',
        mask: { mode: 'generate', calibration: 'local-matting-v2' },
      },
      options: { model: 'fixture', resolution: '2K', ratio: '1:1', needText: false },
    }),
    readAsset: async () => ({ buffer: source, mimeType: 'image/png', name: 'source.png' }),
    nativeArtifacts: { load: async (role) => records.get(role), save, saveMattingPair: pair },
  };
  const generate = vi.fn(async () => ({ buffer: mask, mimeType: 'image/png', name: 'paid.png' }));
  compute.mockResolvedValue({
    mask,
    composite,
    params: { maskAlgorithm: 'lite-linear-cf-ml-v6', calibrationVersion: 'local-matting-v2' },
  });
  return { context, records, save, pair, source, mask, composite, generate };
}

it('blocks missing installation before buying or persisting a mask', async () => {
  const f = await fixture();
  probe.mockRejectedValue(new ProviderError('not installed', false, 'LOCAL_MATTING_UNAVAILABLE'));
  await expect(
    executeNativeBackground(f.context, f.generate, { width: 64, height: 64 }),
  ).rejects.toMatchObject({ code: 'LOCAL_MATTING_UNAVAILABLE' });
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  expect(compute).not.toHaveBeenCalled();
});
it('recovers an already paid near-white binary proposal using its original bytes without calling the model again', async () => {
  const f = await fixture();
  const raw = await gray(
    Array.from({ length: 64 * 64 }, (_, i) => (i % 64 < 32 ? 1 : 230)),
    64,
  );
  f.records.set('background-mask-raw', {
    assetId: randomUUID(),
    buffer: raw,
    mimeType: 'image/png',
    name: 'paid-near-white.png',
  });
  f.context.resumeLocalProcessing = true;
  const result = await executeNativeBackground(f.context, f.generate, { width: 64, height: 64 });
  expect(result.state).toBe('complete');
  expect(f.generate).not.toHaveBeenCalled();
  expect(compute).toHaveBeenCalledOnce();
  expect(compute.mock.calls[0]![0].rawMask).toEqual(raw);
  expect(f.records.get('background-mask-raw')!.buffer).toEqual(raw);
  const baseline = await sharp(f.records.get('background-mask-baseline')!.buffer)
    .greyscale()
    .raw()
    .toBuffer();
  expect([...baseline]).toEqual(Array.from({ length: 64 * 64 }, (_, i) => (i % 64 < 32 ? 0 : 255)));
});
it('resumes a saved paid raw after local failure, then reuses the complete pair without any local installation or model', async () => {
  const f = await fixture();
  compute.mockRejectedValueOnce(new ProviderError('local timeout', false, 'LOCAL_MATTING_TIMEOUT'));
  await expect(
    executeNativeBackground(f.context, f.generate, { width: 64, height: 64 }),
  ).rejects.toMatchObject({ code: 'LOCAL_MATTING_TIMEOUT' });
  expect([...f.records.keys()]).toEqual(['background-mask-raw', 'background-mask-baseline']);
  f.context.resumeLocalProcessing = true;
  const resumed = await executeNativeBackground(f.context, f.generate, { width: 64, height: 64 });
  expect(resumed).toMatchObject({
    state: 'complete',
    outputs: [
      {
        buffer: f.composite,
        processing: {
          method: 'exact-background-v1',
          params: {
            mattingCompositeAssetId: f.records.get('background-matting-composite')!.assetId,
          },
        },
      },
    ],
  });
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(compute).toHaveBeenCalledTimes(2);
  expect(f.pair).toHaveBeenCalledTimes(1);
  probe.mockRejectedValue(new Error('removed installation'));
  compute.mockRejectedValue(new Error('must not compute'));
  f.save.mockClear();
  const repeated = await executeNativeBackground(f.context, f.generate, { width: 64, height: 64 });
  expect(repeated.state === 'complete' && repeated.outputs[0]!.buffer).toEqual(f.composite);
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(compute).toHaveBeenCalledTimes(2);
  expect(f.save).not.toHaveBeenCalled();
});
it.each(['background-mask', 'background-matting-composite'] as const)(
  'refuses an incomplete %s pair without replacing paid material',
  async (role) => {
    const f = await fixture();
    f.records.set(role, {
      assetId: randomUUID(),
      buffer: f.mask,
      mimeType: 'image/png',
      name: 'partial.png',
    });
    await expect(
      executeNativeBackground(f.context, f.generate, { width: 64, height: 64 }),
    ).rejects.toMatchObject({ code: 'NATIVE_CHECKPOINT_INVALID' });
    expect(f.generate).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  },
);
it('passes only frozen scene boundary guidance to local solving and records it on checkpoint replay', async () => {
  const f = await fixture();
  f.context.input.imageEdit!.visualGuidance = {
    boundaryNotes: '单一连续柔焦外背景',
    uncertainties: [],
    sceneBoundary: 'continuous-soft-exterior-v1',
    evidence: { sourceSha256: sha(f.source), model: 'fixture', analyzedAt: '2026-11-13T00:00:00Z' },
  };
  await executeNativeBackground(f.context, f.generate, { width: 64, height: 64 });
  expect(compute).toHaveBeenCalledWith(
    expect.objectContaining({ sceneBoundary: 'continuous-soft-exterior-v1', rawMask: f.mask }),
    undefined,
  );
  const replay = await executeNativeBackground(f.context, f.generate, { width: 64, height: 64 });
  expect(replay.state === 'complete' && replay.outputs[0]!.processing!.params!.sceneBoundary).toBe(
    'continuous-soft-exterior-v1',
  );
});
it('rejects actual transparent pixels before a paid call and leaves opaque source pixels intact', async () => {
  const f = await fixture();
  const transparent = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 18, g: 52, b: 86, alpha: 0.9 } },
  })
    .png()
    .toBuffer();
  f.context.readAsset = async () => ({
    buffer: transparent,
    mimeType: 'image/png',
    name: 'transparent.png',
  });
  await expect(
    executeNativeBackground(f.context, f.generate, { width: 64, height: 64 }),
  ).rejects.toMatchObject({ code: 'LOCAL_MATTING_INPUT_INVALID' });
  expect(f.generate).not.toHaveBeenCalled();
  const normalized = await canonicalLocalMattingSource(f.source, 64, 64);
  expect(await sharp(normalized).raw().toBuffer()).toEqual(await sharp(f.source).raw().toBuffer());
});

async function refinementFixture() {
  const source = await rgb(Array(6).fill([30, 60, 90]).flat());
  const baselineResult = await rgb(Array(6).fill([90, 110, 130]).flat());
  const baselineMask = await gray([128, 128, 128, 128, 0, 255]);
  return {
    source,
    baselineResult,
    baselineMask,
    color: '#c8dcf0',
    baseline: {
      version: 1 as const,
      sourceSha256: sha(source),
      resultAssetId: randomUUID(),
      resultSha256: sha(baselineResult),
      maskAssetId: randomUUID(),
      maskSha256: sha(baselineMask),
      color: '#c8dcf0',
    },
  };
}
it('keeps an unchanged refinement exactly byte-identical and interpolates against immutable root pixels on both sides', async () => {
  const f = await refinementFixture();
  expect(await composeMattingRefinement({ ...f, mask: f.baselineMask })).toBe(f.baselineResult);
  const output = await composeMattingRefinement({
    ...f,
    mask: await gray([0, 64, 192, 255, 128, 128]),
  });
  const values = await sharp(output).removeAlpha().raw().toBuffer();
  expect([...values]).toEqual([
    30, 60, 90, 60, 85, 110, 145, 165, 185, 200, 220, 240, 145, 165, 185, 60, 85, 110,
  ]);
  // Repeating an edit never compounds the previous composite or loses root decontamination.
  expect(
    await composeMattingRefinement({ ...f, mask: await gray([0, 64, 192, 255, 128, 128]) }),
  ).toEqual(output);
});
it.each(['source', 'baselineMask', 'baselineResult', 'dimensions'] as const)(
  'refuses corrupted refinement %s before output',
  async (field) => {
    const f = await refinementFixture();
    const input = { ...f, mask: f.baselineMask };
    if (field === 'dimensions') input.mask = await gray([0, 255]);
    else input[field] = await rgb([0, 0, 0]);
    await expect(composeMattingRefinement(input)).rejects.toMatchObject({
      code: 'NATIVE_CHECKPOINT_INVALID',
    });
  },
);
it('accepts baseline metadata only for same-color confirmed masks', async () => {
  const f = await fixture(),
    r = await refinementFixture();
  const edit = f.context.input.imageEdit!;
  expect(nativeImageEditSchema.safeParse({ ...edit, mattingBaseline: r.baseline }).success).toBe(
    false,
  );
  expect(
    nativeImageEditSchema.safeParse({
      ...edit,
      color: r.color,
      mask: { mode: 'asset', assetId: randomUUID() },
      mattingBaseline: r.baseline,
    }).success,
  ).toBe(true);
  expect(
    nativeImageEditSchema.safeParse({
      ...edit,
      mask: { mode: 'asset', assetId: randomUUID() },
      mattingBaseline: r.baseline,
    }).success,
  ).toBe(false);
});
it('serializes local work and skips an aborted queued job without blocking its successor', async () => {
  let release!: () => void;
  const order: string[] = [];
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = serialLocalMatting(async () => {
    order.push('first');
    await gate;
    order.push('done');
  }, {});
  const abort = new AbortController();
  const second = serialLocalMatting(
    async () => {
      order.push('forbidden');
    },
    { signal: abort.signal },
  );
  const failed = expect(second).rejects.toMatchObject({ code: 'LOCAL_MATTING_CANCELLED' });
  abort.abort();
  const third = serialLocalMatting(async () => {
    order.push('third');
  }, {});
  await failed;
  release();
  await Promise.all([first, third]);
  expect(order).toEqual(['first', 'done', 'third']);
  const env = localProcessEnvironment('/isolated');
  expect(env).not.toHaveProperty('ENCRYPTION_KEY');
  expect(env).not.toHaveProperty('HOME');
  expect(env.ORT_DISABLE_TELEMETRY).toBe('1');
});

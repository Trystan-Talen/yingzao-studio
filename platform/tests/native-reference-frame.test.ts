import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { jobInputSchema } from '../src/contracts/jobs';
import { matchesNativeFrameRatio } from '../src/contracts/native-plan';
import { createNativeProvider } from '../src/server/providers/native';
import { nativeProviderJson } from '../src/server/providers/native-http';
import { nativeMotionEndFrame } from '../src/server/providers/native-motion-frame';
import type { ExecutionContext } from '../src/server/tasks/types';
import type { RuntimeModelConnection } from '../src/server/tasks/model-connections';
vi.mock('../src/server/providers/native-http', () => ({ nativeProviderJson: vi.fn() }));
const call = vi.mocked(nativeProviderJson);
const connection = (kind: 'image' | 'video'): RuntimeModelConnection => ({
  id: kind,
  kind,
  protocol: kind === 'image' ? 'seedream-images' : 'seedance-native',
  baseUrl: 'https://fixture.example/v1',
  model: `fixture-${kind}`,
  secret: 'fixture-secret',
  revision: randomUUID(),
});
const adapter = createNativeProvider({ image: connection('image'), video: connection('video') });
beforeEach(() => {
  vi.clearAllMocks();
  call.mockResolvedValue({ id: 'one-video' });
});
async function setup(width = 512, height = 512, mimeType = 'image/png') {
  const assetId = randomUUID();
  const source = await sharp({ create: { width, height, channels: 3, background: '#aa4455' } })
    [mimeType === 'image/jpeg' ? 'jpeg' : 'png']()
    .toBuffer();
  let frame: { buffer: Buffer; mimeType: string; name: string } | undefined;
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
      operation: 'video.generate',
      prompt: '让原参考图保持主体，只做轻微平移。',
      assetIds: [assetId],
      nativePlan: {
        imagePrompt: '参考原图',
        videoPrompt: '固定朝向的轻微平移',
        firstFrame: { mode: 'reference', assetId },
      },
      options: {
        model: 'fixture-video',
        ratio: '1:1',
        resolution: '720p',
        duration: 5,
        needText: false,
      },
    }),
    readAsset: vi.fn(async () => ({ buffer: source, mimeType, name: '原图' })),
    nativeFrame: {
      load: vi.fn(async () => frame),
      save: vi.fn(async (output) => {
        if (!output.buffer) throw new Error('Expected local source bytes');
        frame = { buffer: output.buffer, mimeType: output.mimeType, name: output.name };
      }),
    },
  };
  return { context, source, getFrame: () => frame };
}
it('preserves PNG bytes and submits only the video, without calling the image model', async () => {
  const { context, source, getFrame } = await setup();
  await adapter.execute(context);
  expect(getFrame()?.buffer.equals(source)).toBe(true);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]?.[1]?.body).toMatchObject({
    content: [
      { type: 'text' },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${source.toString('base64')}` },
      },
    ],
  });
});
it('losslessly normalizes a JPEG without inventing new pixels or resizing', async () => {
  const { context, source, getFrame } = await setup(600, 600, 'image/jpeg');
  await adapter.execute(context);
  const normalized = getFrame()!;
  expect(normalized.mimeType).toBe('image/png');
  const originalPixels = await sharp(source).raw().toBuffer();
  expect((await sharp(normalized.buffer).raw().toBuffer()).equals(originalPixels)).toBe(true);
  expect(call).toHaveBeenCalledTimes(1);
});
it('rejects an unlisted source before reading or generating anything', async () => {
  const { context } = await setup();
  context.input.assetIds = [];
  await expect(adapter.execute(context)).rejects.toThrow('不属于');
  expect(context.readAsset).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
it.each([
  [800, 600],
  [299, 299],
  [6001, 6001],
])('rejects invalid preserved frame %sx%s without redrawing or spending', async (width, height) => {
  const { context } = await setup(width, height);
  await expect(adapter.execute(context)).rejects.toThrow();
  expect(context.nativeFrame!.save).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
it('rechecks ratio on an existing saved preserved frame, never silently cropping it', async () => {
  const { context, source } = await setup(800, 600);
  context.nativeFrame!.load = vi.fn(async () => ({
    buffer: source,
    mimeType: 'image/png',
    name: 'saved',
  }));
  await expect(adapter.execute(context)).rejects.toThrow('比例');
  expect(call).not.toHaveBeenCalled();
});
it('allows minor encoding rounding but rejects stretch-level ratio mismatch', () => {
  expect(matchesNativeFrameRatio(2848, 1600, '16:9')).toBe(true);
  expect(matchesNativeFrameRatio(2880, 1600, '16:9')).toBe(false);
  expect(matchesNativeFrameRatio(2048, 2048, '16:9')).toBe(false);
  expect(matchesNativeFrameRatio(0, 600, '1:1')).toBe(false);
  expect(matchesNativeFrameRatio(600, 600, 'invalid')).toBe(false);
});

it.each([
  [
    'https://xingyunyinli.com/doubao/api/v3/contents/generations/tasks',
    'https://xingyunyinli.com/v1/videos',
  ],
  [
    'https://fixture.example/api/v3/contents/generations/tasks',
    'https://fixture.example/api/v3/contents/generations/tasks',
  ],
] as const)(
  'submits original and controlled endpoint through %s and preserves both on an explicit retry',
  async (baseUrl, submissionUrl) => {
    const video = { ...connection('video'), model: 'doubao-seedance-2.0', baseUrl };
    const controlled = createNativeProvider({ image: connection('image'), video });
    const { context, getFrame } = await setup();
    const width = 512,
      height = 512,
      channels = 3;
    const pixels = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * channels;
        pixels[index] = x % 256;
        pixels[index + 1] = y % 256;
        pixels[index + 2] = (x + y) % 256;
      }
    const source = await sharp(pixels, { raw: { width, height, channels } }).png().toBuffer();
    vi.mocked(context.readAsset).mockResolvedValue({
      buffer: source,
      mimeType: 'image/png',
      name: '原图.png',
    });
    context.input.options.model = video.model;
    const cameraControl = {
      type: 'translate',
      direction: 'right',
      displacementPercent: 2,
    } as const;
    context.input.nativePlan!.cameraControl = cameraControl;
    const expectedTail = await nativeMotionEndFrame(source, cameraControl);
    expect((await sharp(expectedTail).raw().toBuffer()).equals(pixels)).toBe(false);

    await expect(controlled.execute(context)).resolves.toMatchObject({
      state: 'submitted',
      remote: { id: 'one-video' },
    });
    expect(getFrame()!.buffer.equals(source)).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![0]).toBe(submissionUrl);
    expect(call.mock.calls[0]![1]).toMatchObject({ submission: true });
    const body = call.mock.calls[0]![1]!.body as {
      content?: { type: string; role?: string; image_url?: { url: string } }[];
      metadata?: { content: { type: string; role: string; image_url: { url: string } }[] };
    };
    const frames = (body.metadata?.content ?? body.content!).filter(
      (entry) => entry.type === 'image_url',
    );
    expect(frames).toEqual([
      {
        type: 'image_url',
        role: 'first_frame',
        image_url: { url: `data:image/png;base64,${source.toString('base64')}` },
      },
      {
        type: 'image_url',
        role: 'last_frame',
        image_url: { url: `data:image/png;base64,${expectedTail.toString('base64')}` },
      },
    ]);

    // The worker controls whether a retry is authorized; this second adapter execution
    // exercises that retry's already-persisted first frame without another image request.
    call.mockResolvedValueOnce({ id: 'retry-video' });
    await expect(controlled.execute(context)).resolves.toMatchObject({
      state: 'submitted',
      remote: { id: 'retry-video' },
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]![0]).toBe(submissionUrl);
    expect(call.mock.calls[1]![1]!.body).toEqual(call.mock.calls[0]![1]!.body);
    expect(context.readAsset).toHaveBeenCalledTimes(1);
    expect(context.nativeFrame!.save).toHaveBeenCalledTimes(1);
  },
);

it.each(['unverified-video-alias', 'doubao-seedance-2.5'])(
  'rejects controlled motion for %s before reading assets or spending',
  async (model) => {
    const { context } = await setup();
    context.input.options.model = model;
    context.input.nativePlan!.cameraControl = {
      type: 'translate',
      direction: 'left',
      displacementPercent: 2,
    };
    const unsupported = createNativeProvider({
      image: connection('image'),
      video: { ...connection('video'), model },
    });
    await expect(unsupported.execute(context)).rejects.toThrow('不支持受控运镜');
    expect(context.nativeFrame!.load).not.toHaveBeenCalled();
    expect(context.nativeFrame!.save).not.toHaveBeenCalled();
    expect(context.readAsset).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  },
);

it('guides a centered 103% zoom with an unchanged first frame and a separate endpoint', async () => {
  const { context, source, getFrame } = await setup();
  const video = {
    ...connection('video'),
    model: 'doubao-seedance-2.0',
    baseUrl: 'https://xingyunyinli.com/doubao/api/v3/contents/generations/tasks',
  };
  context.input.options.model = video.model;
  context.input.nativePlan!.cameraControl = { type: 'zoom', scalePercent: 103 };
  const controlled = createNativeProvider({ image: connection('image'), video });
  await controlled.execute(context);
  expect(getFrame()!.buffer.equals(source)).toBe(true);
  expect(call).toHaveBeenCalledTimes(1);
  const body = call.mock.calls[0]![1]!.body as {
    metadata: { content: { type: string; role?: string; image_url?: { url: string } }[] };
  };
  const frames = body.metadata.content.filter((item) => item.type === 'image_url');
  expect(frames.map((item) => item.role)).toEqual(['first_frame', 'last_frame']);
  expect(frames[0]!.image_url!.url).toBe(`data:image/png;base64,${source.toString('base64')}`);
  const tail = Buffer.from(frames[1]!.image_url!.url.split(',')[1]!, 'base64');
  expect(await sharp(tail).metadata()).toMatchObject({ width: 512, height: 512 });
});

it('scales both subject axes by 103% around the fixed center without changing canvas size', async () => {
  const width = 1000,
    height = 600;
  const source = await sharp({ create: { width, height, channels: 3, background: '#000000' } })
    .composite([
      {
        input: await sharp({
          create: { width: 400, height: 200, channels: 3, background: '#ffffff' },
        })
          .png()
          .toBuffer(),
        left: 300,
        top: 200,
      },
    ])
    .png()
    .toBuffer();
  const tail = await nativeMotionEndFrame(source, { type: 'zoom', scalePercent: 103 });
  const { data, info } = await sharp(tail)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([width, height]);
  let left = width,
    right = 0,
    top = height,
    bottom = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 3]! > 240) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  expect(Math.abs(right - left + 1 - 412)).toBeLessThanOrEqual(2);
  expect(Math.abs(bottom - top + 1 - 206)).toBeLessThanOrEqual(2);
  expect(Math.abs((left + right) / 2 - 499.5)).toBeLessThanOrEqual(0.5);
  expect(Math.abs((top + bottom) / 2 - 299.5)).toBeLessThanOrEqual(0.5);
});

it('rejects a generated-first-frame motion-control plan before invoking the image model', async () => {
  const { context } = await setup();
  const video = { ...connection('video'), model: 'doubao-seedance-2.0' };
  context.input.options.model = video.model;
  context.input.nativePlan!.firstFrame = { mode: 'generate' };
  context.input.nativePlan!.cameraControl = {
    type: 'translate',
    direction: 'left',
    displacementPercent: 2,
  };
  const controlled = createNativeProvider({ image: connection('image'), video });
  await expect(controlled.execute(context)).rejects.toThrow('不支持受控运镜');
  expect(context.readAsset).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});

it.each([false, true])(
  'rejects truncated pixels before video submission (already saved: %s)',
  async (alreadySaved) => {
    const { context, source } = await setup();
    const truncated = source.subarray(0, Math.floor(source.length * 0.7));
    // A valid header is insufficient: decoding the complete image must still fail.
    expect(await sharp(truncated).metadata()).toMatchObject({ width: 512, height: 512 });
    const frame = { buffer: truncated, mimeType: 'image/png', name: 'incomplete.png' };
    if (alreadySaved) context.nativeFrame!.load = vi.fn(async () => frame);
    else vi.mocked(context.readAsset).mockResolvedValue(frame);
    await expect(adapter.execute(context)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
    expect(context.nativeFrame!.save).not.toHaveBeenCalled();
  },
);

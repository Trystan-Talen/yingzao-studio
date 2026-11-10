import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { jobInputSchema } from '../src/contracts/jobs';
import {
  createOpenaiProvider,
  openaiProvider,
  validateImageGatewayInput,
  type OpenAiImageGatewayConfig,
} from '../src/server/providers/openai';
import { providerJson } from '../src/server/providers/http';
import sharp from 'sharp';
import { ProviderError, type ExecutionContext } from '../src/server/tasks/types';

vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const call = vi.mocked(providerJson);
const gateway = {
  baseUrl: 'https://image-gateway.example.invalid/proxy/v1/',
  model: 'gpt-image-2' as const,
  quality: 'low' as const,
  size: '1024x1024' as const,
};
const seedreamGateway = {
  baseUrl: 'https://seedream-gateway.example.invalid/v1',
  model: 'doubao-seedream-5.0-lite' as const,
  size: '2048x2048' as const,
};
const imageBytes = Buffer.from('isolated-image-contract-fixture');

function context(overrides: Record<string, unknown> = {}): ExecutionContext {
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse({
      operation: 'image.generate',
      providerId: 'openai',
      prompt: '白色陶瓷杯，无品牌标识',
      ...overrides,
    }),
    readAsset: vi.fn().mockRejectedValue(new Error('No asset reads are allowed')),
  };
}

function seedreamContext(overrides: Record<string, unknown> = {}): ExecutionContext {
  return context({
    ...overrides,
    options: {
      model: seedreamGateway.model,
      resolution: '2K',
      ...(overrides.options as Record<string, unknown> | undefined),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  call.mockResolvedValue({ data: [{ b64_json: imageBytes.toString('base64') }] });
});

it('retains the original provider when no gateway is configured', async () => {
  expect(createOpenaiProvider()).toBe(openaiProvider);
  await createOpenaiProvider().execute(context(), 'isolated-contract-key');
  expect(call).toHaveBeenCalledWith(
    'https://api.openai.com/v1/images/generations',
    expect.objectContaining({
      body: expect.objectContaining({ model: 'gpt-image-2.5-flare', quality: 'high', n: 1 }),
    }),
  );
});

it('sends exactly one low-quality text-only image request to the configured API root', async () => {
  const ctx = context({ referenceText: '容量300毫升', conversationContext: '用户希望背景简洁' });
  const result = await createOpenaiProvider(gateway).execute(ctx, 'isolated-contract-key');
  expect(call).toHaveBeenCalledTimes(1);
  const [url, options] = call.mock.calls[0]!;
  expect(url).toBe('https://image-gateway.example.invalid/proxy/v1/images/generations');
  expect(options).toMatchObject({
    method: 'POST',
    submission: true,
    timeoutMs: 900000,
    headers: { Authorization: 'Bearer isolated-contract-key' },
    body: { model: 'gpt-image-2', quality: 'low', size: '1024x1024', n: 1 },
  });
  expect(Object.keys(options!.body as object).sort()).toEqual([
    'model',
    'n',
    'prompt',
    'quality',
    'size',
  ]);
  expect((options!.body as { prompt: string }).prompt).toContain('容量300毫升');
  expect((options!.body as { prompt: string }).prompt).toContain('背景简洁');
  expect(ctx.readAsset).not.toHaveBeenCalled();
  expect(result).toMatchObject({ state: 'complete', outputs: [{ buffer: imageBytes }] });
});

it('returns a signed HTTPS result URL for the existing durable download phase', async () => {
  const url = 'https://cdn.example.invalid/image.png?expires=123&signature=fixture';
  call.mockResolvedValue({ data: [{ url }] });
  const result = await createOpenaiProvider(gateway).execute(context(), 'isolated-contract-key');
  expect(result).toEqual({
    state: 'complete',
    outputs: [{ url, mimeType: 'image/png', name: '映造-image.generate.png' }],
  });
  expect(call).toHaveBeenCalledTimes(1);
});

it('sends the bounded Seedream 2K single-image contract without GPT quality or count fields', async () => {
  const url = 'https://cdn.example.invalid/seedream.png?signature=fixture';
  call.mockResolvedValue({ data: [{ url, size: '2048x2048' }] });
  const ctx = seedreamContext({ options: { width: 2048, height: 2048 } });
  expect(() => validateImageGatewayInput(ctx.input, seedreamGateway)).not.toThrow();
  expect(() => validateImageGatewayInput(ctx.input, seedreamGateway.model)).not.toThrow();
  expect(() => validateImageGatewayInput(ctx.input)).toThrow(ProviderError);
  const result = await createOpenaiProvider(seedreamGateway).execute(ctx, 'isolated-contract-key');
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'https://seedream-gateway.example.invalid/v1/images/generations',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer isolated-contract-key' },
      body: {
        model: 'doubao-seedream-5.0-lite',
        prompt: expect.stringContaining('白色陶瓷杯'),
        size: '2048x2048',
        sequential_image_generation: 'disabled',
        response_format: 'url',
        output_format: 'png',
        watermark: false,
        stream: false,
      },
      submission: true,
      timeoutMs: 900000,
    },
  );
  expect(result).toEqual({
    state: 'complete',
    outputs: [{ url, mimeType: 'image/png', name: '映造-image.generate.png' }],
  });
  expect(ctx.readAsset).not.toHaveBeenCalled();
});

it('defaults Seedream configuration to 2048 square and retains canonical base64 response support', async () => {
  const result = await createOpenaiProvider({
    baseUrl: seedreamGateway.baseUrl,
    model: seedreamGateway.model,
  }).execute(
    seedreamContext({ options: { model: undefined, resolution: '2k' } }),
    'isolated-contract-key',
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]![1]!.body).toMatchObject({
    model: seedreamGateway.model,
    size: '2048x2048',
    sequential_image_generation: 'disabled',
  });
  expect(call.mock.calls[0]![1]!.body).not.toHaveProperty('quality');
  expect(call.mock.calls[0]![1]!.body).not.toHaveProperty('n');
  expect(result).toMatchObject({ state: 'complete', outputs: [{ buffer: imageBytes }] });
});

it.each([
  { operation: 'image-inpaint' },
  { prompt: '   ' },
  { referenceAssetIds: Array.from({ length: 5 }, () => randomUUID()) },
  { maskAssetId: randomUUID() },
  { backgroundAssetId: randomUUID() },
  { backgroundAudioAssetId: randomUUID() },
  { characterId: randomUUID() },
  { brandId: randomUUID() },
  { options: { model: 'gpt-image-2' } },
  { options: { resolution: '1K' } },
  { options: { resolution: '8K' } },
  { options: { width: 1024 } },
  { options: { height: 4096 } },
  { options: { ratio: '8:7' } },
  { options: { count: 2 } },
  { options: { format: 'jpeg' } },
  { options: { designs: [{ id: randomUUID(), name: '组图', kind: 'free', ratio: '1:1' }] } },
])('rejects unsupported Seedream settings before any submission: %j', async (input) => {
  const ctx = seedreamContext(input);
  expect(() => validateImageGatewayInput(ctx.input, seedreamGateway)).toThrow(ProviderError);
  await expect(
    createOpenaiProvider(seedreamGateway).execute(ctx, 'isolated-contract-key'),
  ).rejects.toMatchObject({ ambiguous: false });
  expect(call).not.toHaveBeenCalled();
  expect(ctx.readAsset).not.toHaveBeenCalled();
});

it.each([
  ['3:4', '1728x2304'],
  ['2:3', '1664x2496'],
  ['9:16', '1600x2848'],
])(
  'submits portrait %s with one preserved product reference and one output',
  async (ratio, size) => {
    const id = randomUUID();
    const ctx = seedreamContext({ assetIds: [id], referenceAssetIds: [id], options: { ratio } });
    const buffer = await sharp({
      create: { width: 32, height: 48, channels: 3, background: '#f4eee4' },
    })
      .png()
      .toBuffer();
    ctx.readAsset = vi.fn().mockResolvedValue({ buffer, mimeType: 'image/png' });
    await createOpenaiProvider(seedreamGateway).execute(ctx, 'isolated-contract-key');
    expect(ctx.readAsset).toHaveBeenCalledExactlyOnceWith(id);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![1]!.body).toMatchObject({
      size,
      image: [`data:image/png;base64,${buffer.toString('base64')}`],
      sequential_image_generation: 'disabled',
      prompt: expect.stringContaining('preserve its visible silhouette'),
    });
  },
);

it('keeps a general style reference from becoming an exact product identity constraint', async () => {
  const ctx = seedreamContext({
    referenceAssetIds: [randomUUID()],
    prompt: '只借鉴参考图的水彩色调，创作一只月球上的猫，不复制参考图中的商品。',
    options: { kind: 'free' },
  });
  const buffer = await sharp({
    create: { width: 32, height: 48, channels: 3, background: '#f4eee4' },
  })
    .png()
    .toBuffer();
  ctx.readAsset = vi.fn().mockResolvedValue({ buffer, mimeType: 'image/png' });
  await createOpenaiProvider(seedreamGateway).execute(ctx, 'isolated-contract-key');
  const body = call.mock.calls[0]![1]!.body as { prompt: string };
  expect(body.prompt).toContain(ctx.input.prompt);
  expect(body.prompt).toContain('provide only style guidance');
  expect(body.prompt).toContain('except for changes explicitly requested by the user');
  expect(body.prompt).not.toContain('All reference images depict the same target product');
  expect(body.prompt).not.toContain('packaging, cap');
});

it('rejects non-image or undersized reference pixels before a charged request', async () => {
  const ctx = seedreamContext({ referenceAssetIds: [randomUUID()] });
  ctx.readAsset = vi
    .fn()
    .mockResolvedValue({ buffer: Buffer.from('not-an-image'), mimeType: 'text/plain' });
  await expect(
    createOpenaiProvider(seedreamGateway).execute(ctx, 'isolated-contract-key'),
  ).rejects.toMatchObject({ ambiguous: false });
  ctx.readAsset = vi.fn().mockResolvedValue({
    buffer: await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
  });
  await expect(
    createOpenaiProvider(seedreamGateway).execute(ctx, 'isolated-contract-key'),
  ).rejects.toMatchObject({ ambiguous: false });
  expect(call).not.toHaveBeenCalled();
});

it.each([
  { ...seedreamGateway, quality: 'low' },
  { ...seedreamGateway, size: '1024x1024' },
  { ...gateway, size: '2048x2048' },
  { ...seedreamGateway, sequential_image_generation: 'auto' },
])('rejects cross-model and group-generation configuration: %j', (configuration) => {
  expect(() => createOpenaiProvider(configuration as OpenAiImageGatewayConfig)).toThrow(
    ProviderError,
  );
  expect(call).not.toHaveBeenCalled();
});

it.each([
  { data: [] },
  {
    data: [
      { url: 'https://cdn.example.invalid/one.png' },
      { url: 'https://cdn.example.invalid/two.png' },
    ],
  },
  { data: [{ url: 'http://cdn.example.invalid/unsafe.png' }] },
])(
  'keeps malformed Seedream success output uncertain and never resubmits: %j',
  async (response) => {
    call.mockResolvedValue(response);
    await expect(
      createOpenaiProvider(seedreamGateway).execute(seedreamContext(), 'isolated-contract-key'),
    ).rejects.toMatchObject({ ambiguous: true });
    expect(call).toHaveBeenCalledTimes(1);
  },
);

it.each([
  { operation: 'text.assist' },
  { operation: 'image.ocr' },
  { operation: 'image-inpaint' },
  { providerId: 'fal' },
  { prompt: '   ' },
  { assetIds: [randomUUID()] },
  { referenceAssetIds: [randomUUID()] },
  { maskAssetId: randomUUID() },
  { backgroundAssetId: randomUUID() },
  { backgroundAudioAssetId: randomUUID() },
  { characterId: randomUUID() },
  { brandId: randomUUID() },
  { options: { model: 'gpt-image-2.5-flare' } },
  { options: { ratio: '8:7' } },
  { options: { resolution: '2K' } },
  { options: { count: 2 } },
  { options: { width: 2048 } },
  { options: { height: 2048 } },
  { options: { format: 'jpeg' } },
  { options: { designs: [{ id: randomUUID(), name: '另一张', kind: 'free', ratio: '1:1' }] } },
])(
  'rejects unsupported input before quote validation or any provider request: %j',
  async (input) => {
    const ctx = context(input);
    expect(() => validateImageGatewayInput(ctx.input)).toThrow(ProviderError);
    await expect(
      createOpenaiProvider(gateway).execute(ctx, 'isolated-contract-key'),
    ).rejects.toMatchObject({
      ambiguous: false,
    });
    expect(call).not.toHaveBeenCalled();
    expect(ctx.readAsset).not.toHaveBeenCalled();
  },
);

it.each([
  'http://example.invalid/v1',
  'https://name:password@example.invalid/v1',
  'https://example.invalid/v1?api_key=private-fixture',
  'https://example.invalid/v1#fragment',
  'not-a-url',
])('rejects unsafe gateway configuration without echoing its value: %s', (baseUrl) => {
  let caught: unknown;
  try {
    createOpenaiProvider({ ...gateway, baseUrl });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProviderError);
  expect((caught as Error).message).not.toContain(baseUrl);
  expect(call).not.toHaveBeenCalled();
});

it.each([
  { data: [] },
  {
    data: [
      { b64_json: imageBytes.toString('base64') },
      { b64_json: imageBytes.toString('base64') },
    ],
  },
  { data: [{}] },
  { data: [{ b64_json: 'invalid-base64-characters!!!' }] },
  { data: [{ url: 'http://cdn.example.invalid/image.png' }] },
  { data: [{ url: 'https://name:password@cdn.example.invalid/image.png' }] },
  { data: [{ url: 'https://cdn.example.invalid/image.png#fragment' }] },
  {
    data: [
      { b64_json: imageBytes.toString('base64'), url: 'https://cdn.example.invalid/image.png' },
    ],
  },
])(
  'retains uncertain billing for malformed or unassociated success output: %j',
  async (response) => {
    call.mockResolvedValue(response);
    await expect(
      createOpenaiProvider(gateway).execute(context(), 'isolated-contract-key'),
    ).rejects.toMatchObject({
      ambiguous: true,
    });
    expect(call).toHaveBeenCalledTimes(1);
  },
);

it.each([gateway, seedreamGateway])(
  'propagates definitive rejection and uncertain submission without retrying either: $model',
  async (configuration) => {
    const provider = createOpenaiProvider(configuration);
    const ctx = configuration.model === 'gpt-image-2' ? context() : seedreamContext();
    for (const error of [
      new ProviderError('服务商请求过于频繁，请稍后重试。', false, 'PROVIDER_HTTP_429'),
      new ProviderError('提交结果需要核对。', true, 'PROVIDER_CONNECTION'),
    ]) {
      call.mockClear().mockRejectedValue(error);
      await expect(provider.execute(ctx, 'isolated-contract-key')).rejects.toBe(error);
      expect(call).toHaveBeenCalledTimes(1);
    }
  },
);

it('refuses execution without a secret before any provider request', async () => {
  await expect(createOpenaiProvider(gateway).execute(context())).rejects.toMatchObject({
    ambiguous: false,
  });
  expect(call).not.toHaveBeenCalled();
});

it.each([
  ['16:9', '2K', '2848x1600'],
  ['4:3', '3K', '3456x2592'],
  ['9:16', '3K', '2304x4096'],
  ['21:9', '4K', '6240x2656'],
  ['1:1', '4K', '4096x4096'],
])(
  'sends the actual documented %s / %s pixel size %s without a fictitious quality field',
  async (ratio, resolution, size) => {
    await createOpenaiProvider(seedreamGateway).execute(
      seedreamContext({ options: { ratio, resolution } }),
      'isolated-contract-key',
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![1]!.body).toMatchObject({ size, output_format: 'png' });
    expect(call.mock.calls[0]![1]!.body).not.toHaveProperty('quality');
  },
);

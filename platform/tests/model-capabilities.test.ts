import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createModelCapabilityService } from '../src/server/tasks/model-capabilities';
import { modelCapabilityQuerySchema } from '../src/contracts/model-capabilities';
import {
  jobInputSchema,
  type CapabilitiesDto,
  type OperationCapability,
} from '../src/contracts/jobs';
import type { AppConfig } from '../src/server/config';

const network = vi.fn<typeof fetch>();
const configuration = {
  imageGateway: { baseUrl: 'https://gateway.example/v1', model: 'gpt-image-2' },
  seedance: {
    taskBaseUrl: 'https://video.example/doubao/api/v3/contents/generations/tasks',
    model: 'doubao-seedance-2.0',
  },
} as AppConfig;
let secret: string | undefined;
let configured: boolean;
let service: ReturnType<typeof createModelCapabilityService>;
let operations: OperationCapability[];
let now: number;
const wan = () =>
  modelCapabilityQuerySchema.parse({
    providerId: 'fal',
    operation: 'video.generate',
    modelId: 'wan-2.6',
  });
const image = () =>
  modelCapabilityQuerySchema.parse({
    providerId: 'openai',
    operation: 'image.generate',
    modelId: 'gpt-image-2',
  });
const schema = (
  properties: Record<string, unknown> = {
    aspect_ratio: { type: 'string', enum: ['16:9', '1:1', '21:9'] },
    resolution: { type: 'string', enum: ['720p', '4K'] },
    duration: { type: 'string', enum: ['5', '15', '30'] },
  },
  endpoint = 'wan/v2.6/text-to-video',
) => ({
  models: [
    {
      endpoint_id: endpoint,
      metadata: { status: 'active' },
      openapi: {
        paths: {
          '/queue/submit': {
            post: {
              requestBody: {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/ActualInput' } },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            ActualInput: { type: 'object', properties },
            Output: { properties: { aspect_ratio: { enum: ['99:1'] } } },
          },
        },
      },
    },
  ],
});

beforeEach(() => {
  secret = 'workspace-private-fixture';
  configured = true;
  now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', network);
  network.mockReset();
  operations = [
    {
      id: 'video.generate',
      providerId: 'fal',
      name: 'Video',
      available: true,
      reason: null,
      priceCredits: 5,
      unit: 'second',
      liveVerified: false,
      maxCount: 2,
      models: [
        {
          id: 'wan-2.6',
          name: 'Wan',
          ratios: ['16:9', '9:16', '1:1'],
          resolutions: ['720p', '1080p'],
          durations: [5, 10, 15],
        },
      ],
    },
    {
      id: 'image.generate',
      providerId: 'openai',
      name: 'Image',
      available: true,
      reason: null,
      priceCredits: 8,
      unit: 'image',
      liveVerified: false,
      maxCount: 1,
      models: [
        { id: 'gpt-image-2', name: 'Image', ratios: ['1:1'], resolutions: ['1K'], durations: [] },
      ],
    },
  ];
  service = createModelCapabilityService(configuration, {
    secret: () => secret,
    capabilities: () =>
      ({
        providers: [],
        operations: operations.map((o) => ({ ...o, available: configured })),
      }) as CapabilitiesDto,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('read-only model metadata and adapter intersection', () => {
  it('resolves request refs and intersects with serialized adapter values, never output schemas', async () => {
    network.mockResolvedValue(Response.json(schema()));
    const result = await service.query('workspace-a', wan());
    expect(result).toMatchObject({
      status: 'ready',
      source: 'upstream-schema',
      canGenerate: true,
      modelVerified: true,
      parametersVerified: true,
    });
    expect(result.model).toMatchObject({
      ratios: ['16:9', '1:1'],
      resolutions: ['720p'],
      durations: [5, 15],
    });
    expect(result.parameters.find((p) => p.key === 'count')?.source).toBe('local-adapter');
    expect(result.parameters.find((p) => p.key === 'resolution')?.source).toBe('upstream-schema');
    const [url, init] = network.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.fal.ai/v1/models?endpoint_id=wan%2Fv2.6%2Ftext-to-video&expand=openapi-3.0',
    );
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Key ${secret}` },
    });
    expect(init?.body).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('never labels model-list results as live parameters and preserves fixed gateway quality/size', async () => {
    network.mockResolvedValue(
      Response.json({ data: [{ id: 'gpt-image-2', input_schema: { quality: ['high'] } }] }),
    );
    const result = await service.query('workspace-a', image());
    expect(result).toMatchObject({
      status: 'limited',
      source: 'upstream-model-list',
      modelVerified: true,
      parametersVerified: false,
      reasonCode: 'MODEL_LIST_ONLY',
      canGenerate: true,
    });
    expect(result.parameters).toContainEqual({
      key: 'quality',
      values: ['low'],
      adjustable: false,
      source: 'local-adapter',
    });
    expect(result.parameters).toContainEqual({
      key: 'size',
      values: ['1024x1024'],
      adjustable: false,
      source: 'local-adapter',
    });
    expect(String(network.mock.calls[0]![0])).toBe('https://gateway.example/v1/models');
  });
  it('a schema missing a transmitted field disables generation instead of inheriting static choices', async () => {
    network.mockResolvedValue(
      Response.json(schema({ aspect_ratio: { enum: ['16:9'] }, duration: { enum: ['5'] } })),
    );
    const result = await service.query('workspace-a', wan());
    expect(result).toMatchObject({
      status: 'unavailable',
      canGenerate: false,
      reasonCode: 'NO_COMPATIBLE_OPTIONS',
    });
    expect(result.model.resolutions).toEqual([]);
  });
  it('does not downgrade a present but unresolved request schema into a permissive model-list result', async () => {
    const malformed = schema();
    malformed.models[0]!.openapi.paths['/queue/submit'].post.requestBody.content[
      'application/json'
    ].schema.$ref = 'https://evil.example/request-schema';
    network.mockResolvedValue(Response.json(malformed));
    expect(await service.query('workspace-a', wan())).toMatchObject({
      canGenerate: false,
      reasonCode: 'UPSTREAM_INVALID',
      parametersVerified: false,
    });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('bounds cyclic branching schemas while preserving ordinary nested unions', async () => {
    const nested = schema({
      aspect_ratio: {
        allOf: [{ type: 'string' }, { anyOf: [{ const: '1:1' }, { const: '16:9' }] }],
      },
      resolution: { oneOf: [{ enum: ['720p'] }, { enum: ['1080p'] }] },
      duration: { anyOf: [{ type: 'null' }, { enum: ['5', '10'] }] },
    });
    network.mockResolvedValueOnce(Response.json(nested));
    expect((await service.query('workspace-a', wan())).model).toMatchObject({
      ratios: ['16:9', '1:1'],
      resolutions: ['720p', '1080p'],
      durations: [5, 10],
    });
    const malicious = schema({
      aspect_ratio: { $ref: '#/components/schemas/Loop' },
      resolution: { enum: ['720p'] },
      duration: { enum: ['5'] },
    });
    Object.assign(malicious.models[0]!.openapi.components.schemas, {
      Loop: { anyOf: Array.from({ length: 100 }, () => ({ $ref: '#/components/schemas/Loop' })) },
    });
    now += 3000;
    network.mockResolvedValueOnce(Response.json(malicious));
    const start = performance.now();
    const result = await service.query('workspace-a', { ...wan(), refresh: 'true' });
    expect(result).toMatchObject({ canGenerate: false, reasonCode: 'NO_COMPATIBLE_OPTIONS' });
    expect(performance.now() - start).toBeLessThan(1000);
  });
  it('validates the serialized false audio default when an upstream schema only accepts true', async () => {
    operations[0]!.models = [
      {
        id: 'kling-o3-4k-reference',
        name: 'O3',
        ratios: ['16:9'],
        resolutions: ['4K'],
        durations: [5],
        audio: { mode: 'generated', note: 'fixture' },
      },
    ];
    network.mockResolvedValue(
      Response.json(
        schema(
          {
            aspect_ratio: { enum: ['16:9'] },
            duration: { enum: ['5'] },
            generate_audio: { type: 'boolean', enum: [true] },
          },
          'fal-ai/kling-video/o3/4k/reference-to-video',
        ),
      ),
    );
    const result = await service.query('a', { ...wan(), modelId: 'kling-o3-4k-reference' });
    expect(result.canGenerate).toBe(true);
    const input = jobInputSchema.parse({
      providerId: 'fal',
      operation: 'video.generate',
      capabilityRevision: result.revision,
      options: { model: 'kling-o3-4k-reference', ratio: '16:9', resolution: '4K', duration: 5 },
    });
    expect(input.options.generateAudio).toBeUndefined();
    expect(() => service.validate('a', input)).toThrow(/可用范围/);
    expect(() =>
      service.validate('a', { ...input, options: { ...input.options, generateAudio: true } }),
    ).not.toThrow();
  });
  it('uses the separate image schema and omits a ratio the image endpoint does not accept', async () => {
    network.mockResolvedValue(
      Response.json(
        schema(
          { resolution: { enum: ['720p'] }, duration: { enum: ['5'] } },
          'wan/v2.6/image-to-video',
        ),
      ),
    );
    const result = await service.query('workspace-a', { ...wan(), inputMode: 'image' });
    expect(result.canGenerate).toBe(true);
    expect(result.model.ratios).toEqual([]);
    expect(result.parameters.some((p) => p.key === 'ratio')).toBe(false);
    expect(String(network.mock.calls[0]![0])).toContain('image-to-video');
  });
  it('does not follow remote refs, circular refs, or execute untrusted schema patterns', async () => {
    for (const property of [
      { $ref: 'https://evil.example/schema' },
      { $ref: '#/components/schemas/ActualInput' },
      { type: 'string', pattern: '(a+)+$' },
    ]) {
      now += 3000;
      network.mockResolvedValue(
        Response.json(
          schema({
            aspect_ratio: property,
            resolution: { enum: ['720p'] },
            duration: { enum: ['5'] },
          }),
        ),
      );
      expect((await service.query('workspace-a', { ...wan(), refresh: 'true' })).canGenerate).toBe(
        false,
      );
    }
    expect(network).toHaveBeenCalledTimes(3);
  });
  it('rejects missing or deprecated selected models', async () => {
    network.mockResolvedValueOnce(Response.json({ data: [{ id: 'another-model' }] }));
    expect(await service.query('workspace-a', image())).toMatchObject({
      canGenerate: false,
      reasonCode: 'MODEL_NOT_AVAILABLE',
    });
    const body = schema();
    body.models[0]!.metadata.status = 'deprecated';
    network.mockResolvedValueOnce(Response.json(body));
    expect(await service.query('workspace-a', wan())).toMatchObject({
      canGenerate: false,
      reasonCode: 'MODEL_NOT_AVAILABLE',
    });
  });
  it('unsupported schema discovery and unconfigured services do not cause guessed requests', async () => {
    operations[0] = { ...operations[0]!, providerId: 'flyelep' };
    const result = await service.query('workspace-a', { ...wan(), providerId: 'flyelep' });
    expect(result).toMatchObject({
      status: 'limited',
      source: 'local-adapter',
      fetchedAt: null,
      parametersVerified: false,
      reasonCode: 'LOCAL_ONLY',
    });
    configured = false;
    secret = undefined;
    expect(await service.query('workspace-a', image())).toMatchObject({
      status: 'unavailable',
      reasonCode: 'NOT_CONFIGURED',
    });
    expect(network).not.toHaveBeenCalled();
  });
  it('does not advertise an adjustable batch count for operations that derive results from assets', async () => {
    operations[0] = {
      ...operations[0]!,
      id: 'local.convert',
      providerId: 'local',
      maxCount: undefined,
      models: [{ id: 'sharp', name: 'Local', ratios: [], resolutions: [], durations: [] }],
    };
    const result = await service.query(
      'workspace-a',
      modelCapabilityQuerySchema.parse({
        providerId: 'local',
        operation: 'local.convert',
        modelId: 'sharp',
      }),
    );
    expect(result.maxCount).toBe(1);
    expect(result.parameters).toContainEqual({
      key: 'count',
      values: [1],
      adjustable: false,
      source: 'local-adapter',
    });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500, 302])(
    'fails closed on HTTP %s and never exposes upstream error bodies',
    async (status) => {
      network.mockResolvedValue(new Response(`private ${secret}`, { status }));
      const result = await service.query('workspace-a', image());
      expect(result).toMatchObject({
        status: 'unavailable',
        canGenerate: false,
        fetchedAt: null,
        source: 'none',
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );
  it('bounds malformed or oversized response bodies and rejects unsafe configured URLs', async () => {
    network.mockResolvedValueOnce(new Response('not json'));
    expect((await service.query('workspace-a', image())).reasonCode).toBe('UPSTREAM_INVALID');
    now += 3000;
    network.mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Length': '3000000' } }));
    expect((await service.query('workspace-a', { ...image(), refresh: 'true' })).reasonCode).toBe(
      'UPSTREAM_INVALID',
    );
    configuration.imageGateway!.baseUrl = 'https://user:password@gateway.example/v1';
    expect((await service.query('workspace-a', image())).reasonCode).toBe('CONFIGURATION_INVALID');
    configuration.imageGateway!.baseUrl = 'https://gateway.example/v1';
    expect(network).toHaveBeenCalledTimes(2);
  });
});

describe('credential scoped caching and quote capability proof', () => {
  it('shares non-sensitive mode caches, echoes concurrent selections and invalidates both after failure or credential rotation', async () => {
    let resolve!: (value: Response) => void;
    network.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const text = service.query('a', image());
    const picture = service.query('a', { ...image(), inputMode: 'image' });
    resolve(Response.json({ data: [{ id: 'gpt-image-2' }] }));
    const [textResult, imageResult] = await Promise.all([text, picture]);
    expect(textResult.inputMode).toBe('text');
    expect(imageResult.inputMode).toBe('image');
    expect(imageResult.revision).toBe(textResult.revision);
    expect(network).toHaveBeenCalledTimes(1);
    const input = jobInputSchema.parse({
      providerId: 'openai',
      operation: 'image.generate',
      capabilityRevision: textResult.revision,
      options: { model: 'gpt-image-2', ratio: '1:1', resolution: '1K' },
    });
    expect(() => service.validate('a', { ...input, assetIds: [randomUUID()] })).not.toThrow();
    expect(() =>
      service.validate('a', {
        ...input,
        options: { ...input.options, resolution: '4K' },
        assetIds: [randomUUID()],
      }),
    ).toThrow(/可用范围/);
    now += 3000;
    network.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect(
      (await service.query('a', { ...image(), inputMode: 'image', refresh: 'true' })).canGenerate,
    ).toBe(false);
    expect(() => service.validate('a', input)).toThrow(/过期/);
    expect(() => service.validate('a', { ...input, assetIds: [randomUUID()] })).toThrow(/过期/);
    secret = 'replacement-private-key';
    expect(() => service.validate('a', input)).toThrow(/过期/);
    network.mockResolvedValueOnce(Response.json({ data: [{ id: 'gpt-image-2' }] }));
    const rotated = await service.query('a', image());
    expect(rotated.revision).not.toBe(textResult.revision);
  });
  it('isolates workspaces, deduplicates concurrent refresh, labels cache hits and expires them', async () => {
    network.mockImplementation(async () => Response.json(schema()));
    const [a, b] = await Promise.all([
      service.query('a', wan()),
      service.query('a', { ...wan(), refresh: 'true' }),
    ]);
    expect(a.revision).toBe(b.revision);
    expect(network).toHaveBeenCalledTimes(1);
    expect((await service.query('a', wan())).cache).toBe('hit');
    const other = await service.query('b', wan());
    expect(other.revision).not.toBe(a.revision);
    now += 3000;
    expect((await service.query('a', { ...wan(), refresh: 'true' })).cache).toBe('miss');
    now += 301000;
    expect((await service.query('a', wan())).cache).toBe('miss');
    expect(network).toHaveBeenCalledTimes(4);
  });
  it('does not serve old successful choices when refresh fails, and can retry after cooldown', async () => {
    network.mockResolvedValueOnce(Response.json(schema()));
    const first = await service.query('a', wan());
    now += 3000;
    network.mockRejectedValueOnce(new Error('token-secret-from-upstream'));
    const failure = await service.query('a', { ...wan(), refresh: 'true' });
    expect(failure).toMatchObject({
      canGenerate: false,
      status: 'unavailable',
      reasonCode: 'UPSTREAM_UNAVAILABLE',
      fetchedAt: null,
    });
    expect(failure.revision).not.toBe(first.revision);
    now += 3000;
    network.mockResolvedValueOnce(Response.json(schema()));
    expect((await service.query('a', { ...wan(), refresh: 'true' })).canGenerate).toBe(true);
  });
  it('rejects a response started under credentials that changed while loading', async () => {
    let resolve!: (value: Response) => void;
    network.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = service.query('a', wan());
    secret = 'replacement-private-fixture';
    resolve(Response.json(schema()));
    expect(await pending).toMatchObject({
      canGenerate: false,
      reasonCode: 'CONFIGURATION_CHANGED',
    });
    network.mockResolvedValueOnce(Response.json(schema()));
    expect((await service.query('a', wan())).canGenerate).toBe(true);
    expect(network.mock.calls[1]![1]?.headers).toMatchObject({ Authorization: `Key ${secret}` });
  });
  it('binds proofs to credentials/workspace/operation/model/input mode, values and expiry', async () => {
    network.mockResolvedValue(Response.json(schema()));
    const capability = await service.query('a', wan());
    const input = jobInputSchema.parse({
      providerId: 'fal',
      operation: 'video.generate',
      capabilityRevision: capability.revision,
      options: { model: 'wan-2.6', ratio: '16:9', resolution: '720p', duration: 5 },
    });
    expect(() => service.validate('a', input)).not.toThrow();
    expect(() => service.validate('b', input)).toThrow(/过期/);
    expect(() => service.validate('a', { ...input, operation: 'video.extend' })).toThrow(/过期/);
    expect(() => service.validate('a', { ...input, assetIds: [randomUUID()] })).toThrow(/过期/);
    expect(() =>
      service.validate('a', { ...input, options: { ...input.options, model: 'unknown' } }),
    ).toThrow(/过期/);
    expect(() =>
      service.validate('a', { ...input, options: { ...input.options, duration: 10 } }),
    ).toThrow(/可用范围/);
    expect(() =>
      service.validate('a', { ...input, options: { ...input.options, count: 3 } }),
    ).toThrow(/可用范围/);
    secret = 'rotated-private-fixture';
    expect(() => service.validate('a', input)).toThrow(/过期/);
    secret = 'workspace-private-fixture';
    now += 301000;
    expect(() => service.validate('a', input)).toThrow(/过期/);
    expect(() => service.validate('a', { ...input, capabilityRevision: undefined })).not.toThrow();
  });
});

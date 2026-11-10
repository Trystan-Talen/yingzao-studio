import { afterEach, expect, it, vi } from 'vitest';
import { readModelMetadata } from '../src/server/providers/model-metadata';
import { createModelCapabilityService } from '../src/server/tasks/model-capabilities';
import { seedanceModel, SEEDREAM_SIZE_PRESETS } from '../src/server/providers/documented-models';
import { modelCapabilityQuerySchema } from '../src/contracts/model-capabilities';
import { jobInputSchema, type CapabilitiesDto } from '../src/contracts/jobs';
import type { AppConfig } from '../src/server/config';

const config = {
  imageGateway: { baseUrl: 'https://xingyunyinli.com/v1', model: 'doubao-seedream-5.0-lite' },
} as AppConfig;
const imageQuery = modelCapabilityQuerySchema.parse({
  providerId: 'openai',
  operation: 'image.generate',
  modelId: config.imageGateway!.model,
});
const videoQuery = modelCapabilityQuerySchema.parse({
  providerId: 'seedance',
  operation: 'video.generate',
  modelId: 'doubao-seedance-2.0',
});
const key = 'never-transmit-this-to-public-catalog';
afterEach(() => vi.unstubAllGlobals());

function service() {
  return createModelCapabilityService(config, {
    secret: () => key,
    capabilities: () =>
      ({
        operations: [
          {
            id: 'image.generate',
            providerId: 'openai',
            available: true,
            maxCount: 1,
            models: [
              {
                id: imageQuery.modelId,
                name: 'Seedream',
                ratios: Object.keys(SEEDREAM_SIZE_PRESETS['2K']!),
                resolutions: ['2K', '3K', '4K'],
                durations: [],
              },
            ],
          },
          {
            id: 'video.generate',
            providerId: 'seedance',
            available: true,
            maxCount: 1,
            models: [seedanceModel()],
          },
        ],
      }) as CapabilitiesDto,
  });
}

it('joins live membership and the public catalog with documented ranges without executing billing expressions or leaking credentials', async () => {
  const network = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/models')
      ? Response.json({ data: [{ id: imageQuery.modelId }, { id: videoQuery.modelId }] })
      : Response.json({
          success: true,
          data: [
            {
              model_name: videoQuery.modelId,
              billing_usage_schema: { resolution: { enum: ['8K', '999p'] } },
              billing_expr: 'throw new Error("must never execute")',
            },
          ],
        }),
  );
  vi.stubGlobal('fetch', network);
  const dto = await service().query('workspace', videoQuery);
  expect(dto).toMatchObject({
    source: 'provider-documentation',
    modelVerified: true,
    parametersVerified: false,
    canGenerate: true,
    catalog: { status: 'available' },
  });
  expect(dto.model.resolutions).toEqual(['480p', '720p', '1080p', '4K']);
  expect(dto.model.durations).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  expect(dto.model.ratios).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']);
  expect(network).toHaveBeenCalledTimes(2);
  expect(network.mock.calls[0]![1]).toMatchObject({
    method: 'GET',
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}` },
  });
  expect(new Headers(network.mock.calls[1]![1]?.headers).has('Authorization')).toBe(false);
  expect(network.mock.calls[1]![1]).toMatchObject({
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
  });
  expect(JSON.stringify(dto)).not.toContain(key);
  expect(JSON.stringify(dto)).not.toContain('billing_expr');
});

it('keeps documented image size dependencies and validates the chosen resolution on the same capability revision', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: [{ id: imageQuery.modelId }] })),
  );
  const api = service();
  const dto = await api.query('workspace', imageQuery);
  expect(dto.sizePresets).toHaveLength(24);
  expect(dto.sizePresets).toContainEqual({ ratio: '16:9', resolution: '3K', size: '4096x2304' });
  expect(dto.sizePresets).toContainEqual({ ratio: '21:9', resolution: '4K', size: '6240x2656' });
  expect(dto.parameters.some((p) => p.key === 'quality')).toBe(false);
  expect(dto.parameters.find((p) => p.key === 'size')).toMatchObject({
    source: 'provider-documentation',
    adjustable: false,
  });
  const input = jobInputSchema.parse({
    providerId: 'openai',
    operation: 'image.generate',
    capabilityRevision: dto.revision,
    options: { model: imageQuery.modelId, ratio: '16:9', resolution: '3K' },
  });
  expect(() => api.validate('workspace', input)).not.toThrow();
  expect(() =>
    api.validate('workspace', { ...input, options: { ...input.options, resolution: '8K' } }),
  ).toThrow();
  expect(() => api.validate('another-workspace', input)).toThrow();
});

it('does not query the catalog or enable document options when the model is no longer authorized', async () => {
  const network = vi.fn(async () => Response.json({ data: [] }));
  vi.stubGlobal('fetch', network);
  expect(await service().query('workspace', imageQuery)).toMatchObject({
    canGenerate: false,
    modelVerified: false,
    reasonCode: 'MODEL_NOT_AVAILABLE',
  });
  expect(network).toHaveBeenCalledTimes(1);
});

it('a catalog outage retains reviewed ranges without claiming the catalog refreshed', async () => {
  const network = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/models')
      ? Response.json({ data: [{ id: imageQuery.modelId }] })
      : new Response(null, { status: 503 }),
  );
  vi.stubGlobal('fetch', network);
  expect(await readModelMetadata(config, imageQuery, key)).toMatchObject({
    kind: 'documented',
    available: true,
    catalog: { status: 'unavailable' },
  });
});

it('never probes a pricing endpoint on an arbitrary compatible gateway', async () => {
  const network = vi.fn(async () => Response.json({ data: [{ id: imageQuery.modelId }] }));
  vi.stubGlobal('fetch', network);
  const custom = {
    ...config,
    imageGateway: { ...config.imageGateway!, baseUrl: 'https://custom.example/v1' },
  };
  expect(await readModelMetadata(custom, imageQuery, key)).toMatchObject({
    kind: 'documented',
    available: true,
  });
  expect(network).toHaveBeenCalledTimes(1);
});

it('unknown video aliases do not inherit model-specific options', () => {
  expect(seedanceModel('custom-model-alias')).toMatchObject({
    resolutions: ['480p', '720p'],
    durations: [5],
  });
  expect(seedanceModel('custom-model-alias').audio).toBeUndefined();
});

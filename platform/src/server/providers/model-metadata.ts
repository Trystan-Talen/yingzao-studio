import type { AppConfig } from '../config';
import type { ModelCapabilityQuery } from '../../contracts/model-capabilities';
import { FAL_REFERENCE_ENDPOINTS } from './fal-reference';
import { FAL_MOTION_ENDPOINTS } from './fal-motion';
import { FAL_EXTRA_ENDPOINTS } from './fal-extra';
import { DOCUMENT_REVIEWED_AT, GENERATION_DOCUMENTS } from './documented-models';
import type { ModelCapabilitiesDto } from '../../contracts/model-capabilities';

type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
export interface ModelMetadata {
  kind: 'schema' | 'model-list' | 'documented' | 'unsupported';
  available: boolean;
  /** Only the resolved request properties are used; raw upstream data never leaves the server. */
  properties?: JsonObject;
  document?: JsonObject;
  documentation?: ModelCapabilitiesDto['documentation'];
  catalog?: ModelCapabilitiesDto['catalog'];
}
export class MetadataError extends Error {
  constructor(public readonly code: 'UNAVAILABLE' | 'UNAUTHORIZED' | 'INVALID' | 'CONFIGURATION') {
    super(code);
  }
}

/** Declare endpoint-sensitive input modes in one place. Any future adapter whose
 * metadata/request controls differ by input mode must join this mapping first.
 * All other current endpoints use the same schema for text/image-derived snapshots. */
const MODE_ENDPOINTS: Record<string, Record<'text' | 'image', string>> = {
  'fal:video.generate:wan-2.6': {
    text: 'wan/v2.6/text-to-video',
    image: 'wan/v2.6/image-to-video',
  },
};
function modeEndpoint(
  query: Pick<ModelCapabilityQuery, 'providerId' | 'operation' | 'modelId' | 'inputMode'>,
) {
  return MODE_ENDPOINTS[`${query.providerId}:${query.operation}:${query.modelId}`]?.[
    query.inputMode
  ];
}
export function modelMetadataMode(
  query: Pick<ModelCapabilityQuery, 'providerId' | 'operation' | 'modelId' | 'inputMode'>,
): 'text' | 'image' | 'shared' {
  return modeEndpoint(query) ? query.inputMode : 'shared';
}

function safeUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MetadataError('CONFIGURATION');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new MetadataError('CONFIGURATION');
  return url;
}

/** GET only, bounded body and deadline, no redirects (especially no cross-host credential leak). */
async function metadataJson(url: URL, authorization?: string): Promise<JsonObject> {
  const signal = AbortSignal.timeout(8000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        Accept: 'application/json',
      },
      redirect: 'error',
      credentials: 'omit',
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new MetadataError(
        [401, 403].includes(response.status) ? 'UNAUTHORIZED' : 'UNAVAILABLE',
      );
    }
    const maximum = 2 * 1024 * 1024;
    if (!response.body || Number(response.headers.get('content-length') || 0) > maximum) {
      void response.body?.cancel().catch(() => {});
      throw new MetadataError('INVALID');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximum) {
          void reader.cancel().catch(() => {});
          throw new MetadataError('INVALID');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const parsed = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed) throw new MetadataError('INVALID');
    return parsed;
  } catch (error) {
    if (error instanceof MetadataError) throw error;
    // Never include an upstream response, URL query, credential or network exception in messages.
    throw new MetadataError(error instanceof SyntaxError ? 'INVALID' : 'UNAVAILABLE');
  }
}

/** Resolve only local JSON pointers, with a depth bound; never fetch a schema reference. */
export function resolveSchema(document: JsonObject, value: unknown, depth = 0): JsonObject | null {
  if (depth > 12) return null;
  const schema = object(value);
  if (!schema) return null;
  if (typeof schema.$ref !== 'string') return schema;
  if (!schema.$ref.startsWith('#/')) return null;
  let target: unknown = document;
  for (const part of schema.$ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    const current = object(target);
    if (!current || !Object.hasOwn(current, key)) return null;
    target = current[key];
  }
  return resolveSchema(document, target, depth + 1);
}

function inputProperties(document: JsonObject): JsonObject | undefined {
  // Inspect request bodies, never output/status schemas or a guessed name such as "Input".
  const candidates = Object.values(object(document.paths) || {}).flatMap((path) => {
    const post = object(object(path)?.post);
    const body = resolveSchema(document, post?.requestBody);
    const content = object(object(body?.content)?.['application/json']);
    const schema = resolveSchema(document, content?.schema);
    const properties = object(schema?.properties);
    return properties ? [properties] : [];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function falEndpoint(query: ModelCapabilityQuery): string | undefined {
  const varyingEndpoint = modeEndpoint(query);
  if (varyingEndpoint) return varyingEndpoint;
  if (query.operation === 'video.generate' && Object.hasOwn(FAL_REFERENCE_ENDPOINTS, query.modelId))
    return FAL_REFERENCE_ENDPOINTS[query.modelId as keyof typeof FAL_REFERENCE_ENDPOINTS];
  if (
    query.operation === 'video.motion-replica' &&
    Object.hasOwn(FAL_MOTION_ENDPOINTS, query.modelId)
  )
    return FAL_MOTION_ENDPOINTS[query.modelId as keyof typeof FAL_MOTION_ENDPOINTS];
  if (Object.hasOwn(FAL_EXTRA_ENDPOINTS, query.operation))
    return FAL_EXTRA_ENDPOINTS[query.operation as keyof typeof FAL_EXTRA_ENDPOINTS];
  return (
    {
      'image-cutout': 'fal-ai/birefnet',
      'image-erase': 'fal-ai/bria/eraser',
      'model-replace': 'fal-ai/image-apps-v2/virtual-try-on',
      'image-upscale': 'fal-ai/aura-sr',
    } as Record<string, string>
  )[query.operation];
}

export async function readModelMetadata(
  config: AppConfig,
  query: ModelCapabilityQuery,
  secret: string,
): Promise<ModelMetadata> {
  if (query.providerId === 'fal') {
    const endpoint = falEndpoint(query);
    if (!endpoint) return { kind: 'unsupported', available: true };
    // Official read-only Model API; expand gives the same request schema as the model page.
    const url = new URL('https://api.fal.ai/v1/models');
    url.searchParams.set('endpoint_id', endpoint);
    url.searchParams.set('expand', 'openapi-3.0');
    const data = await metadataJson(url, `Key ${secret}`);
    if (!Array.isArray(data.models)) throw new MetadataError('INVALID');
    const item = data.models.map(object).find((entry) => entry?.endpoint_id === endpoint);
    if (!item || object(item.metadata)?.status === 'deprecated')
      return { kind: 'model-list', available: false };
    const document = object(item.openapi);
    const properties = document ? inputProperties(document) : undefined;
    // A present but unresolvable schema is an error, not permission to silently use
    // a broader static contract. Some model catalog entries legitimately omit it.
    if (item.openapi != null && (!document || !properties)) throw new MetadataError('INVALID');
    return properties && document
      ? { kind: 'schema', available: true, properties, document }
      : { kind: 'model-list', available: true };
  }
  if (query.providerId === 'openai' || query.providerId === 'seedance') {
    const url =
      query.providerId === 'openai'
        ? safeUrl(
            `${(config.imageGateway?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/models`,
          )
        : new URL(
            '/v1/models',
            safeUrl(config.seedance?.taskBaseUrl || 'https://xingyunyinli.com'),
          );
    const data = await metadataJson(url, `Bearer ${secret}`);
    if (
      !Array.isArray(data.data) ||
      data.data.some((entry) => typeof object(entry)?.id !== 'string')
    )
      throw new MetadataError('INVALID');
    const available = data.data.some((entry) => object(entry)?.id === query.modelId);
    if (!available) return { kind: 'model-list', available: false };
    const documentUrls =
      query.providerId === 'openai' &&
      query.operation === 'image.generate' &&
      config.imageGateway?.model === 'doubao-seedream-5.0-lite' &&
      query.modelId === config.imageGateway.model
        ? [GENERATION_DOCUMENTS.seedream]
        : query.providerId === 'seedance' &&
            query.operation === 'video.generate' &&
            query.modelId === 'doubao-seedance-2.0'
          ? [GENERATION_DOCUMENTS.seedance, GENERATION_DOCUMENTS.gateway]
          : [];
    if (!documentUrls.length) return { kind: 'model-list', available: true };
    let catalog: ModelMetadata['catalog'];
    // Observed, documented public route on this gateway only. Never send a model key
    // to the catalog or interpret billing_usage_schema / model_ratio as input limits.
    if (url.origin === 'https://xingyunyinli.com') {
      const catalogUrl = new URL('/api/pricing', url);
      let status: 'available' | 'unavailable' = 'unavailable';
      try {
        const catalogData = await metadataJson(catalogUrl);
        if (
          catalogData.success === true &&
          Array.isArray(catalogData.data) &&
          catalogData.data.some((entry) => object(entry)?.model_name === query.modelId)
        )
          status = 'available';
      } catch {
        /* Catalog outages cannot broaden or invalidate documented input ranges. */
      }
      catalog = { status, checkedAt: new Date().toISOString(), url: catalogUrl.href };
    }
    return {
      kind: 'documented',
      available: true,
      catalog,
      documentation: documentUrls.map((url) => ({ url, reviewedAt: DOCUMENT_REVIEWED_AT })),
    };
  }
  // Dify /parameters describes an app form, not a model's inference controls. Flyelep and
  // TikHub have no verified generation-schema endpoint. Do not probe guessed/billable routes.
  return { kind: 'unsupported', available: true };
}

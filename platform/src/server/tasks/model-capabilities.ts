import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '../config';
import type { ProviderId } from '../../contracts/catalog';
import type {
  CapabilitiesDto,
  JobInput,
  ModelCapability,
  OperationCapability,
} from '../../contracts/jobs';
import type {
  CapabilityParameter,
  ModelCapabilitiesDto,
  ModelCapabilityQuery,
} from '../../contracts/model-capabilities';
import { AppError } from '../errors';
import { imageSize } from '../providers/openai';
import { seedreamSize } from '../providers/documented-models';
import {
  MetadataError,
  modelMetadataMode,
  object,
  readModelMetadata,
  resolveSchema,
  type ModelMetadata,
} from '../providers/model-metadata';

const TTL = 5 * 60_000;
const FAILURE_TTL = 5000;
const REFRESH_COOLDOWN = 2000;
const MAX_CACHE = 512;
const messages: Record<ModelCapabilitiesDto['reasonCode'], string> = {
  DOCUMENTED_PARAMETERS:
    '模型可用性已实时核查；可选参数按已核对的原厂文档接入，文档范围不是实时参数接口。',
  SCHEMA_VERIFIED: '已从上游读取参数，并限制为当前已接入的选项。',
  MODEL_LIST_ONLY: '已核实上游模型；当前模型查询接口未返回参数结构，以下为当前接入支持的选项。',
  LOCAL_ONLY: '此服务未提供已核实的参数查询接口，以下为当前接入支持的选项。',
  SCHEMA_PARTIAL: '已读取上游参数；固定值与本机处理选项仍以当前接入为准。',
  NOT_CONFIGURED: '请先在设置中连接此服务。',
  MODEL_NOT_AVAILABLE: '上游未返回所选模型，或该模型已停用。请重新选择模型。',
  NO_COMPATIBLE_OPTIONS: '上游参数与当前接入没有兼容选项，请刷新或选择其他模型。',
  UPSTREAM_UNAVAILABLE: '暂时无法读取上游参数，请重试。',
  UPSTREAM_UNAUTHORIZED: '上游拒绝读取模型信息，请检查服务凭据与权限。',
  UPSTREAM_INVALID: '上游返回的模型信息无法校验，请重试。',
  CONFIGURATION_INVALID: '服务元数据地址配置无效，请联系管理员。',
  CONFIGURATION_CHANGED: '服务配置已变化，请重新读取模型参数。',
};
interface CacheEntry {
  value: ModelCapabilitiesDto;
  storedAt: number;
}
interface Dependencies {
  secret(wid: string, provider: ProviderId): string | undefined;
  capabilities(wid: string): CapabilitiesDto;
}
export function capabilityInputMode(input: JobInput): 'text' | 'image' {
  return input.assetIds.length || input.referenceAssetIds.length ? 'image' : 'text';
}

/** Evaluate a bounded supported subset against the values our adapter actually serializes. */
function accepts(
  document: Record<string, unknown>,
  raw: unknown,
  value: unknown,
  depth = 0,
  budget = { remaining: 512 },
): boolean {
  if (--budget.remaining < 0) return false;
  const schema = resolveSchema(document, raw);
  if (!schema || depth > 12) return false;
  if (Object.hasOwn(schema, 'const') && schema.const !== value) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (
    Array.isArray(schema.anyOf) &&
    !schema.anyOf.some((s) => accepts(document, s, value, depth + 1, budget))
  )
    return false;
  if (
    Array.isArray(schema.oneOf) &&
    schema.oneOf.filter((s) => accepts(document, s, value, depth + 1, budget)).length !== 1
  )
    return false;
  if (
    Array.isArray(schema.allOf) &&
    !schema.allOf.every((s) => accepts(document, s, value, depth + 1, budget))
  )
    return false;
  if (schema.not || schema.if || schema.then || schema.else) return false;
  if (typeof schema.type === 'string') {
    if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type)
      return false;
  }
  if (
    Array.isArray(schema.type) &&
    !schema.type.some((type) =>
      type === 'integer' ? Number.isInteger(value) : typeof value === type,
    )
  )
    return false;
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
      return false;
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
      return false;
    if (typeof schema.multipleOf === 'number' && value % schema.multipleOf !== 0) return false;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
    // Do not execute untrusted regular expressions; patterns need an explicit adapter mapping.
    if (schema.pattern) return false;
  }
  return budget.remaining >= 0;
}

function localParameters(
  config: AppConfig,
  query: ModelCapabilityQuery,
  operation: OperationCapability,
  model: ModelCapability,
): CapabilityParameter[] {
  const result: CapabilityParameter[] = [];
  const add = (
    key: CapabilityParameter['key'],
    values: CapabilityParameter['values'],
    adjustable = values.length > 1,
  ) => {
    if (values.length)
      result.push({ key, values: [...new Set(values)], source: 'local-adapter', adjustable });
  };
  add('ratio', model.ratios);
  add('resolution', model.resolutions);
  add('duration', model.durations);
  add(
    'count',
    Array.from({ length: adapterMaxCount(query, operation) }, (_, i) => i + 1),
  );
  if (
    query.providerId === 'openai' &&
    query.operation !== 'text.assist' &&
    query.operation !== 'image.ocr'
  ) {
    if (config.imageGateway?.model !== 'doubao-seedream-5.0-lite')
      add('quality', [config.imageGateway ? 'low' : 'high'], false);
    const sizes =
      config.imageGateway?.model === 'doubao-seedream-5.0-lite'
        ? model.ratios.flatMap((ratio) =>
            model.resolutions.map((resolution) => seedreamSize(ratio, resolution)!),
          )
        : config.imageGateway
          ? ['1024x1024']
          : model.ratios.flatMap((ratio) =>
              model.resolutions.map((resolution) => imageSize(ratio, resolution)),
            );
    add('size', sizes, false); // derived from ratio/resolution, not a separate request override
    add('format', ['png'], false);
  }
  if (query.providerId === 'seedance' && !model.audio) add('generateAudio', [false], false);
  if (model.audio?.mode === 'generated') add('generateAudio', [false, true]);
  if (query.providerId === 'local' && query.operation === 'local.convert')
    add('format', ['png', 'jpeg', 'webp']);
  if (query.providerId === 'fal' && query.operation === 'image-cutout')
    add('format', ['png'], false);
  return result;
}

function adapterMaxCount(query: ModelCapabilityQuery, operation: OperationCapability) {
  // splitItems only repeats these operations by count. Other tools derive item count
  // from their source assets/combinations; a count selector would have no effect.
  return (
    operation.maxCount ||
    (['image.generate', 'video.generate', 'image-replica'].includes(query.operation) ? 20 : 1)
  );
}

function applySchema(
  query: ModelCapabilityQuery,
  dto: ModelCapabilitiesDto,
  metadata: ModelMetadata,
) {
  const document = metadata.document!;
  const props = metadata.properties!;
  let verified = 0;
  let incompatible = false;
  // Only map fields actually transmitted by the relevant adapter. "auto", 4K endpoint
  // selection, and local batching are local semantics, never invented upstream enums.
  for (const parameter of dto.parameters) {
    let name: string | undefined;
    let serialize = (v: string | number | boolean): unknown => v;
    if (parameter.key === 'ratio' && !parameter.values.includes('auto')) {
      if (query.modelId === 'wan-2.6' && query.inputMode === 'image') continue;
      name = 'aspect_ratio';
    }
    if (parameter.key === 'resolution' && query.modelId === 'wan-2.6') {
      name = 'resolution';
      serialize = (v) => String(v).toLowerCase();
    }
    if (parameter.key === 'duration') {
      name = query.operation === 'video.extend' ? 'num_frames' : 'duration';
      serialize = query.operation === 'video.extend' ? (v) => Number(v) * 24 + 1 : (v) => String(v);
    }
    if (parameter.key === 'generateAudio') name = 'generate_audio';
    if (parameter.key === 'format' && query.operation === 'image-cutout') name = 'output_format';
    if (!name) continue;
    let schema = props[name];
    if (query.operation === 'model-replace' && name === 'aspect_ratio')
      schema = object(resolveSchema(document, schema)?.properties)?.ratio;
    parameter.values = parameter.values.filter((v) => accepts(document, schema, serialize(v)));
    parameter.adjustable = parameter.adjustable && parameter.values.length > 1;
    parameter.source = 'upstream-schema';
    verified++;
    if (!parameter.values.length) incompatible = true;
    if (parameter.key === 'ratio') dto.model.ratios = parameter.values as string[];
    if (parameter.key === 'resolution') dto.model.resolutions = parameter.values as string[];
    if (parameter.key === 'duration') dto.model.durations = parameter.values as number[];
  }
  dto.parametersVerified = verified > 0 && !incompatible;
  if (incompatible) {
    dto.status = 'unavailable';
    dto.canGenerate = false;
    dto.reasonCode = 'NO_COMPATIBLE_OPTIONS';
  } else {
    dto.status = verified ? 'ready' : 'limited';
    dto.reasonCode = verified ? 'SCHEMA_VERIFIED' : 'SCHEMA_PARTIAL';
  }
}

export function createModelCapabilityService(config: AppConfig, dependencies: Dependencies) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<ModelCapabilitiesDto>>();
  function identity(wid: string, query: ModelCapabilityQuery) {
    const secret = dependencies.secret(wid, query.providerId);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([secret || null, config.imageGateway || null, config.seedance || null]),
      )
      .digest('hex');
    const key = JSON.stringify([
      wid,
      query.providerId,
      query.operation,
      query.modelId,
      modelMetadataMode(query),
      fingerprint,
    ]);
    return { key, secret };
  }
  function remember(key: string, value: ModelCapabilitiesDto) {
    cache.delete(key);
    cache.set(key, { value: structuredClone(value), storedAt: Date.now() });
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  }
  function invalidate(wid: string, provider: ProviderId) {
    for (const key of cache.keys()) {
      const parts = JSON.parse(key) as string[];
      if (parts[0] === wid && parts[1] === provider) cache.delete(key);
    }
  }
  async function query(wid: string, input: ModelCapabilityQuery): Promise<ModelCapabilitiesDto> {
    const operation = dependencies
      .capabilities(wid)
      .operations.find((o) => o.id === input.operation && o.providerId === input.providerId);
    const model = operation?.models.find((m) => m.id === input.modelId);
    if (!operation || !model) throw new AppError(400, 'MODEL_UNSUPPORTED', '所选模型不支持此操作');
    const current = identity(wid, input);
    const prior = cache.get(current.key);
    const time = Date.now();
    if (
      prior &&
      time < Date.parse(prior.value.expiresAt) &&
      (input.refresh !== 'true' || time - prior.storedAt < REFRESH_COOLDOWN)
    )
      return { ...structuredClone(prior.value), inputMode: input.inputMode, cache: 'hit' };
    const pending = inFlight.get(current.key);
    if (pending) return { ...structuredClone(await pending), inputMode: input.inputMode };
    if (inFlight.size >= 32)
      throw new AppError(429, 'CAPABILITY_BUSY', '模型参数查询繁忙，请稍后重试');
    const run = async (): Promise<ModelCapabilitiesDto> => {
      const date = new Date().toISOString();
      const dto: ModelCapabilitiesDto = {
        providerId: input.providerId,
        operation: input.operation,
        modelId: input.modelId,
        inputMode: input.inputMode,
        model: structuredClone(model),
        parameters: localParameters(config, input, operation, model),
        maxCount: adapterMaxCount(input, operation),
        revision: randomUUID(),
        status: 'limited',
        canGenerate: operation.available,
        source: 'local-adapter',
        modelVerified: false,
        parametersVerified: false,
        checkedAt: date,
        fetchedAt: null,
        expiresAt: new Date(Date.now() + TTL).toISOString(),
        cache: 'miss',
        reasonCode: 'LOCAL_ONLY',
        reason: '',
      };
      if (input.providerId === 'openai' && input.modelId === 'doubao-seedream-5.0-lite') {
        dto.sizePresets = model.resolutions.flatMap((resolution) =>
          model.ratios.flatMap((ratio) => {
            const size = seedreamSize(ratio, resolution);
            return size ? [{ ratio, resolution, size }] : [];
          }),
        );
      }
      // A Wan source image controls its output aspect ratio; there is no aspect_ratio input.
      if (
        input.providerId === 'fal' &&
        input.modelId === 'wan-2.6' &&
        input.inputMode === 'image'
      ) {
        dto.model.ratios = [];
        dto.parameters = dto.parameters.filter((p) => p.key !== 'ratio');
      }
      if (!operation.available) {
        dto.canGenerate = false;
        dto.status = 'unavailable';
        dto.reasonCode = 'NOT_CONFIGURED';
      } else if (input.providerId !== 'local') {
        try {
          const metadata = await readModelMetadata(config, input, current.secret!);
          if (metadata.kind !== 'unsupported') {
            dto.fetchedAt = new Date().toISOString();
            dto.modelVerified = metadata.available;
            dto.source = metadata.kind === 'schema' ? 'upstream-schema' : 'upstream-model-list';
            dto.reasonCode = 'MODEL_LIST_ONLY';
          }
          if (!metadata.available) {
            dto.status = 'unavailable';
            dto.canGenerate = false;
            dto.reasonCode = 'MODEL_NOT_AVAILABLE';
          } else if (metadata.kind === 'schema') applySchema(input, dto, metadata);
          else if (metadata.kind === 'documented') {
            dto.source = 'provider-documentation';
            dto.reasonCode = 'DOCUMENTED_PARAMETERS';
            dto.documentation = metadata.documentation;
            dto.catalog = metadata.catalog;
            for (const parameter of dto.parameters) {
              if (
                ['ratio', 'resolution', 'duration', 'size', 'generateAudio', 'format'].includes(
                  parameter.key,
                )
              )
                parameter.source = 'provider-documentation';
            }
          }
        } catch (error) {
          dto.status = 'unavailable';
          dto.canGenerate = false;
          dto.source = 'none';
          dto.reasonCode =
            error instanceof MetadataError
              ? (
                  {
                    UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
                    UNAUTHORIZED: 'UPSTREAM_UNAUTHORIZED',
                    INVALID: 'UPSTREAM_INVALID',
                    CONFIGURATION: 'CONFIGURATION_INVALID',
                  } as const
                )[error.code]
              : 'UPSTREAM_UNAVAILABLE';
        }
      }
      if (identity(wid, input).key !== current.key) {
        dto.status = 'unavailable';
        dto.canGenerate = false;
        dto.reasonCode = 'CONFIGURATION_CHANGED';
      }
      if (!dto.canGenerate) dto.expiresAt = new Date(Date.now() + FAILURE_TTL).toISOString();
      dto.reason = messages[dto.reasonCode];
      if (identity(wid, input).key === current.key) remember(current.key, dto);
      return dto;
    };
    const promise = run();
    inFlight.set(current.key, promise);
    try {
      return structuredClone(await promise);
    } finally {
      inFlight.delete(current.key);
    }
  }
  function validate(wid: string, input: JobInput) {
    if (!input.capabilityRevision) return; // Existing contract clients keep their original behavior.
    const key = identity(wid, {
      providerId: input.providerId,
      operation: input.operation,
      modelId: input.options.model || '',
      inputMode: capabilityInputMode(input),
      refresh: 'false',
    }).key;
    const dto = cache.get(key)?.value;
    if (
      !dto ||
      dto.revision !== input.capabilityRevision ||
      Date.parse(dto.expiresAt) <= Date.now()
    )
      throw new AppError(409, 'CAPABILITY_CHANGED', '模型参数已更新或过期，请重新读取并确认选项。');
    if (!dto.canGenerate) throw new AppError(409, 'CAPABILITY_UNAVAILABLE', dto.reason);
    for (const parameter of dto.parameters) {
      if (parameter.key === 'quality' || parameter.key === 'size') continue; // fixed/derived, no JobInput override
      // O3 sends false when the optional audio toggle is absent; validate the actual
      // serialized default too. Other writable parameter keys have schema defaults.
      const value =
        parameter.key === 'generateAudio'
          ? (input.options.generateAudio ?? false)
          : input.options[parameter.key];
      if (value === undefined) continue;
      const matches = parameter.values.some((allowed) =>
        typeof value === 'string' && typeof allowed === 'string'
          ? value.toLowerCase() === allowed.toLowerCase()
          : value === allowed,
      );
      if (!matches)
        throw new AppError(
          400,
          'MODEL_PARAMETER_UNSUPPORTED',
          '所选参数不在当前模型的可用范围内，请重新确认。',
        );
    }
    return dto;
  }
  return { query, validate, invalidate };
}

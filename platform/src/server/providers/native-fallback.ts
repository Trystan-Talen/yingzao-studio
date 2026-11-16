import { ProviderError } from '../tasks/types';
import { emitExecutionAttempt, withExecutionResource } from './execution-audit';

export interface FallbackConnection {
  id?: string;
  name?: string;
  kind?: string;
  protocol: string;
  baseUrl: string;
  model: string;
  secret: string;
  revision?: string;
  fallbackResources?: FallbackConnection[];
}

/** Only a definite rejection or a pre-submission connection failure may switch resources.
 * A timeout after sending, unclassified 5xx, malformed success or accepted remote task is not
 * retryable. A complete, recognized pre-execution routing rejection is safe to switch.
 */
export function canFallbackModelResource(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    !error.ambiguous &&
    (error.code === 'PROVIDER_CONNECTION' ||
      error.code === 'PROVIDER_NOT_EXECUTED' ||
      /^PROVIDER_HTTP_(400|401|402|403|404|405|415|422|429)$/.test(error.code))
  );
}

export async function withModelFallback<T extends FallbackConnection, R>(
  primary: T,
  execute: (connection: T) => Promise<R>,
  options: { compatible?: (connection: T) => boolean; beforeFallback?: () => void } = {},
): Promise<R> {
  const candidates = [primary, ...(primary.fallbackResources ?? [])] as T[];
  let rejected: unknown;
  for (const [index, connection] of candidates.entries()) {
    const resource = {
      id: connection.id ?? (index === 0 ? 'primary' : `fallback-${index}`),
      name: connection.name ?? (index === 0 ? '首选资源' : `备用资源 ${index}`),
      kind: connection.kind,
      protocol: connection.protocol,
      baseUrl: connection.baseUrl,
      model: connection.model,
    };
    if (index > 0 && options.compatible && !options.compatible(connection)) {
      emitExecutionAttempt({
        action: 'submit',
        status: 'rejected',
        resource,
        errorCode: 'FALLBACK_RESOURCE_INCOMPATIBLE',
        message: '备用资源与已确认参数不兼容，已跳过，未提交请求。',
      });
      continue;
    }
    if (index > 0) options.beforeFallback?.();
    try {
      return await withExecutionResource(resource, () => execute(connection));
    } catch (error) {
      if (!canFallbackModelResource(error)) throw error;
      rejected = error;
    }
  }
  throw rejected ?? new ProviderError('没有可用于已确认参数的模型资源。');
}

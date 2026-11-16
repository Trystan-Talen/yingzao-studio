import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionAttemptEvent, ExecutionResource } from '../../contracts/task-execution';

type Sink = (event: ExecutionAttemptEvent) => void;
interface AuditContext {
  sink: Sink;
  resource?: ExecutionResource;
}
const storage = new AsyncLocalStorage<AuditContext>();
const allowedMetadata = new Set([
  'id',
  'request_id',
  'requestId',
  'task_id',
  'taskId',
  'status',
  'state',
  'code',
  'message',
  'type',
  'param',
  'detail',
  'reason',
  'error',
  'errors',
  'usage',
  'model',
  'created',
  'created_at',
  'updated_at',
  'finished_at',
  'duration',
  'latency',
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'prompt_tokens',
  'completion_tokens',
  'total_cost',
  'currency',
  'finish_reason',
  'object',
  'retry_after',
  'httpStatus',
  'statusCode',
  'bodyTruncated',
  'bodyFormat',
  'contentType',
  'submittedAt',
  'nativeModel',
  'endpoint',
  'stage',
  'itemId',
  'assetId',
  'index',
  'recoveryFailures',
  'nextRetryAt',
]);

/** Only response metadata is retained; payloads, output URLs and credentials are excluded. */
export function sanitizeExecutionMetadata(value: unknown, sensitiveValues: readonly string[] = []) {
  let budget = 12000;
  const text = (raw: string) => {
    let result = raw;
    for (const secret of sensitiveValues.filter((entry) => entry.length > 0)) {
      result = result.split(secret).join('[已隐藏]');
      result = result.split(encodeURIComponent(secret)).join('[已隐藏]');
    }
    result = result
      .replace(/Bearer\s+[^\s,;"'<>]+/gi, 'Bearer [已隐藏]')
      .replace(/\b(?:sk|rk|pk)-[a-z\d_-]{8,}/gi, '[已隐藏]')
      .replace(
        /((?:api[_-]?key|authorization|secret|token|password)\s*[=:]\s*["']?)[^\s,"'<>;&]+/gi,
        '$1[已隐藏]',
      )
      .replace(/https?:\/\/[^\s<>"']+/gi, (rawUrl) => {
        try {
          const url = new URL(rawUrl);
          return `${url.protocol}//${url.host}${url.pathname}`;
        } catch {
          return '[地址已隐藏]';
        }
      });
    const limited = result.slice(0, Math.min(1500, Math.max(0, budget)));
    budget -= limited.length;
    return limited;
  };
  const visit = (entry: unknown, depth: number): unknown => {
    if (budget <= 0 || depth > 5) return '[已截断]';
    // Charge structural nodes too: numeric arrays have no strings but can be enormous.
    budget -= 48;
    if (typeof entry === 'string') return text(entry);
    if (entry === null || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') return Number.isFinite(entry) ? entry : null;
    if (Array.isArray(entry)) return entry.slice(0, 12).map((item) => visit(item, depth + 1));
    if (!entry || typeof entry !== 'object') return null;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(entry).slice(0, 100)) {
      if (allowedMetadata.has(key)) output[key] = visit(item, depth + 1);
      // Common response envelopes are traversed without preserving image/video bodies.
      else if (
        ['data', 'result', 'response', 'output'].includes(key) &&
        item &&
        typeof item === 'object'
      ) {
        const nested = visit(item, depth + 1);
        if (nested && typeof nested === 'object' && Object.keys(nested).length)
          output[key] = nested;
      }
    }
    return output;
  };
  const result = visit(value, 0);
  return JSON.stringify(result).length <= 16000
    ? result
    : { message: '元数据超过日志大小限制，已省略。', bodyTruncated: true };
}

export function sanitizeExecutionEvent(
  event: ExecutionAttemptEvent,
  sensitiveValues: readonly string[] = [],
): ExecutionAttemptEvent {
  const clean = (value: string | undefined) =>
    value === undefined ? undefined : String(sanitizeExecutionMetadata(value, sensitiveValues));
  const resource = event.resource;
  return {
    action: event.action,
    status: event.status,
    attemptId: clean(event.attemptId),
    stage: clean(event.stage),
    ...(resource
      ? {
          resource: {
            id: clean(resource.id)!,
            name: clean(resource.name)!,
            kind: clean(resource.kind),
            baseUrl: clean(resource.baseUrl),
            model: clean(resource.model),
            protocol: clean(resource.protocol),
          },
        }
      : {}),
    httpStatus: event.httpStatus,
    errorCode: clean(event.errorCode),
    message: clean(event.message),
    requestId: clean(event.requestId),
    remoteId: clean(event.remoteId),
    metadata: sanitizeExecutionMetadata(event.metadata, sensitiveValues),
    durationMs: event.durationMs,
  };
}

export function runWithExecutionAudit<T>(sink: Sink, fn: () => T): T {
  return storage.run({ sink }, fn);
}
export function withExecutionResource<T>(resource: ExecutionResource, fn: () => T): T {
  const context = storage.getStore();
  return context ? storage.run({ ...context, resource }, fn) : fn();
}
export function emitExecutionAttempt(
  event: ExecutionAttemptEvent,
  sensitiveValues: readonly string[] = [],
): void {
  const context = storage.getStore();
  if (!context) return;
  context.sink(
    sanitizeExecutionEvent(
      { ...event, resource: event.resource ?? context.resource },
      sensitiveValues,
    ),
  );
}

import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { isPublicAddress } from './http';
import { ProviderError } from '../tasks/types';
import { emitExecutionAttempt } from './execution-audit';
import { isExplicitNativeNonExecution } from './native-rejection';

export interface NativeJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  submission?: boolean;
}

/** User-configured services need the same DNS boundary as untrusted media URLs.
 * Resolve once and pin the socket address; redirects never receive credentials.
 */
export async function nativeProviderJson(
  value: string,
  options: NativeJsonOptions = {},
): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('模型服务地址无效。');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    !hostname.includes('.')
  )
    throw new ProviderError('模型服务须使用公开的 HTTPS（安全超文本传输协议）地址。');

  const timeoutMs = options.timeoutMs ?? 300000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000)
    throw new ProviderError('模型请求时限无效。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  let submitted = false;
  const startedAt = Date.now();
  const attemptId = randomUUID();
  const action =
    options.method === 'GET' ? 'poll' : options.method === 'DELETE' ? 'cancel' : 'submit';
  const sensitiveValues = Object.values(options.headers ?? {}).flatMap((value) => [
    value,
    value.replace(/^Bearer\s+/i, ''),
  ]);
  let httpStatus: number | undefined;
  let requestId: string | undefined;
  let metadata: unknown;
  const record = (event: Parameters<typeof emitExecutionAttempt>[0]) => {
    try {
      emitExecutionAttempt(event, sensitiveValues);
    } catch {
      throw new ProviderError(
        '模型调用日志未能保存，请核对本次请求。',
        submitted && options.submission === true,
        'PROVIDER_AUDIT_FAILED',
      );
    }
  };
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () =>
      reject(
        new ProviderError(
          submitted
            ? '模型服务连接中断，提交结果需要核对。'
            : '模型服务连接超时，尚未提交生成请求。',
          submitted && options.submission === true,
          'PROVIDER_CONNECTION',
        ),
      );
    controller.signal.addEventListener('abort', abort, { once: true });
  });
  try {
    record({ attemptId, action, status: 'started' });
    const result = await Promise.race([
      interrupted,
      (async () => {
        const family = isIP(hostname);
        const addresses = family
          ? [{ address: hostname, family }]
          : await lookup(hostname, { all: true });
        if (controller.signal.aborted)
          throw new ProviderError('模型服务连接超时，尚未提交生成请求。');
        if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
          throw new ProviderError('模型服务地址指向受保护网络，尚未提交生成请求。');
        const pinned = addresses[0]!;
        const body = options.body === undefined ? undefined : JSON.stringify(options.body);
        const buffer = await new Promise<Buffer>((resolve, reject) => {
          const req = request(
            url,
            {
              method: options.method || 'POST',
              headers: { 'Content-Type': 'application/json', ...options.headers },
              signal: controller.signal,
              agent: false,
              lookup: (_name, lookupOptions, callback) => {
                if (typeof lookupOptions === 'object' && lookupOptions.all)
                  callback(null, [pinned]);
                else callback(null, pinned.address, pinned.family);
              },
            },
            (res) => {
              let responseEnded = false;
              const responseInterrupted = () =>
                reject(
                  new ProviderError(
                    '模型服务响应中断，请核对本次请求。',
                    options.submission === true,
                    'PROVIDER_CONNECTION',
                  ),
                );
              res.on('error', responseInterrupted);
              res.once('aborted', responseInterrupted);
              const status = res.statusCode ?? 0;
              httpStatus = status;
              const upstreamRequestId =
                res.headers['x-request-id'] ??
                res.headers['request-id'] ??
                res.headers['x-trace-id'];
              requestId = typeof upstreamRequestId === 'string' ? upstreamRequestId : undefined;
              const failed = status < 200 || status >= 300;
              const maximum = failed ? 65536 : 160 * 1024 * 1024;
              const rejection = (completeBody?: unknown) => {
                if (
                  options.submission === true &&
                  action === 'submit' &&
                  isExplicitNativeNonExecution(status, completeBody)
                )
                  return new ProviderError(
                    '当前模型没有可用通道，服务商确认未执行本次请求。',
                    false,
                    'PROVIDER_NOT_EXECUTED',
                  );
                const ambiguous = Boolean(
                  options.submission && (status >= 500 || (status >= 300 && status < 400)),
                );
                return new ProviderError(
                  status === 401 || status === 403
                    ? '服务密钥无效或账户没有该模型权限。'
                    : status === 429
                      ? '服务商请求过于频繁，请稍后重试。'
                      : status >= 300 && status < 400
                        ? '模型服务要求跳转，已停止请求，请核对接口地址。'
                        : `服务商返回错误（${status}）。`,
                  ambiguous,
                  `PROVIDER_HTTP_${status}`,
                );
              };
              // Once rejected, collect only a short bounded diagnostic body. A stalled
              // error stream must not occupy the full image-generation deadline.
              const errorBodyTimer = failed
                ? setTimeout(() => {
                    metadata = { bodyTruncated: true, contentType: res.headers['content-type'] };
                    reject(rejection());
                    res.destroy();
                  }, 5000)
                : undefined;
              errorBodyTimer?.unref();
              res.once('close', () => {
                clearTimeout(errorBodyTimer);
                if (!responseEnded) responseInterrupted();
              });
              if (Number(res.headers['content-length'] || 0) > maximum) {
                metadata = { bodyTruncated: true, contentType: res.headers['content-type'] };
                reject(
                  failed
                    ? rejection()
                    : new ProviderError('模型服务响应超过大小限制。', options.submission === true),
                );
                res.destroy();
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              res.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > maximum) {
                  metadata = { bodyTruncated: true, contentType: res.headers['content-type'] };
                  reject(
                    failed
                      ? rejection()
                      : new ProviderError(
                          '模型服务响应超过大小限制。',
                          options.submission === true,
                        ),
                  );
                  res.destroy();
                } else chunks.push(chunk);
              });
              res.on('end', () => {
                responseEnded = true;
                clearTimeout(errorBodyTimer);
                if (res.complete === false || res.aborted === true) {
                  responseInterrupted();
                  return;
                }
                const response = Buffer.concat(chunks);
                if (failed) {
                  try {
                    metadata = JSON.parse(response.toString('utf8')) as unknown;
                  } catch {
                    metadata = { bodyFormat: 'non-json', contentType: res.headers['content-type'] };
                  }
                  reject(rejection(metadata));
                } else resolve(response);
              });
            },
          );
          req.on('error', () =>
            reject(
              new ProviderError(
                '模型服务连接中断，提交结果需要核对。',
                options.submission === true,
                'PROVIDER_CONNECTION',
              ),
            ),
          );
          // Invalid local headers/options may throw while constructing the request. No
          // bytes have been submitted then; do not strand a paid task as uncertain.
          submitted = true;
          req.end(body);
        });
        try {
          metadata = JSON.parse(buffer.toString('utf8')) as unknown;
          return metadata;
        } catch {
          throw new ProviderError('模型服务返回无法解析的响应。', options.submission === true);
        }
      })(),
    ]);
    const body =
      result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
    const remoteId = typeof body?.id === 'string' ? body.id : undefined;
    const status = body?.status;
    record({
      attemptId,
      action,
      status: ['failed', 'expired', 'cancelled'].includes(String(status))
        ? 'failed'
        : ['pending', 'queued', 'running', 'processing'].includes(String(status))
          ? 'running'
          : options.submission && remoteId && !body?.choices
            ? 'submitted'
            : 'succeeded',
      httpStatus,
      requestId,
      remoteId,
      metadata,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    record({
      attemptId,
      action,
      status: error instanceof ProviderError && error.ambiguous ? 'uncertain' : 'rejected',
      httpStatus,
      requestId,
      metadata,
      errorCode: error instanceof ProviderError ? error.code : 'PROVIDER_CONNECTION',
      message:
        error instanceof ProviderError ? error.message : '模型服务连接失败，请核对服务地址。',
      durationMs: Date.now() - startedAt,
    });
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      '模型服务连接失败，请核对服务地址。',
      submitted && options.submission === true,
      'PROVIDER_CONNECTION',
    );
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', abort);
  }
}

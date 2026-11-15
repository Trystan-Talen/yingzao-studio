import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { isPublicAddress } from './http';
import { ProviderError } from '../tasks/types';

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
    return await Promise.race([
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
          const maximum = 160 * 1024 * 1024;
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
              res.on('error', () =>
                reject(
                  new ProviderError(
                    '模型服务响应中断，请核对本次请求。',
                    options.submission === true,
                    'PROVIDER_CONNECTION',
                  ),
                ),
              );
              const status = res.statusCode ?? 0;
              if (status < 200 || status >= 300) {
                const ambiguous = Boolean(
                  options.submission && (status >= 500 || (status >= 300 && status < 400)),
                );
                reject(
                  new ProviderError(
                    status === 401 || status === 403
                      ? '服务密钥无效或账户没有该模型权限。'
                      : status === 429
                        ? '服务商请求过于频繁，请稍后重试。'
                        : status >= 300 && status < 400
                          ? '模型服务要求跳转，已停止请求，请核对接口地址。'
                          : `服务商返回错误（${status}）。`,
                    ambiguous,
                    `PROVIDER_HTTP_${status}`,
                  ),
                );
                res.destroy();
                return;
              }
              if (Number(res.headers['content-length'] || 0) > maximum) {
                reject(
                  new ProviderError('模型服务响应超过大小限制。', options.submission === true),
                );
                res.destroy();
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              res.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > maximum) {
                  reject(
                    new ProviderError('模型服务响应超过大小限制。', options.submission === true),
                  );
                  res.destroy();
                } else chunks.push(chunk);
              });
              res.on('end', () => resolve(Buffer.concat(chunks)));
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
          return JSON.parse(buffer.toString('utf8')) as unknown;
        } catch {
          throw new ProviderError('模型服务返回无法解析的响应。', options.submission === true);
        }
      })(),
    ]);
  } catch (error) {
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

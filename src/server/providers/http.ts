import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { ProviderError } from '../tasks/types';
export async function providerJson(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
    submission?: boolean;
  } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs || 300000),
    });
  } catch {
    throw new ProviderError(
      '服务连接中断，提交结果需要核对。',
      options.submission === true,
      'PROVIDER_CONNECTION',
    );
  }
  if (!response.ok) {
    const ambiguous = Boolean(options.submission && response.status >= 500);
    throw new ProviderError(
      response.status === 401 || response.status === 403
        ? '服务密钥无效或账户没有该模型权限。'
        : response.status === 429
          ? '服务商请求过于频繁，请稍后重试。'
          : `服务商返回错误（${response.status}）。`,
      ambiguous,
      `PROVIDER_HTTP_${response.status}`,
    );
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 160 * 1024 * 1024)
    throw new ProviderError('服务响应超过大小限制。', Boolean(options.submission));
  try {
    if (!response.body) throw new Error('EMPTY_RESPONSE');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 160 * 1024 * 1024) {
        await reader.cancel();
        throw new ProviderError('服务响应超过大小限制。', Boolean(options.submission));
      }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('服务商返回无法解析的响应。', Boolean(options.submission));
  }
}
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const p = address.split('.').map(Number);
    const a = p[0]!,
      b = p[1]!;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && p[2] === 100))) ||
      (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) ||
      (a === 203 && b === 0 && p[2] === 113)
    );
  }
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return isPublicAddress(a.slice(7));
    // Only global unicast; reject IPv4-compatible/NAT64/link-local and transition ranges.
    return (
      /^[23][0-9a-f]{3}:/.test(a) &&
      !a.startsWith('2001:db8:') &&
      !a.startsWith('2001:0:') &&
      !a.startsWith('2002:')
    );
  }
  return false;
}
/** DNS is resolved once, validated, then pinned for this request (including redirects). */
export async function downloadPublicMedia(
  value: string,
  limit = 200 * 1024 * 1024,
  redirects = 0,
): Promise<Buffer> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new ProviderError('产物地址不是允许的 HTTPS 媒体地址。');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new ProviderError('产物地址指向受保护网络。');
  const pinned = addresses[0]!;
  return new Promise<Buffer>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) {
            callback(null, [pinned]);
          } else callback(null, pinned.address, pinned.family);
        },
        headers: { Accept: 'image/*,video/*,audio/*' },
        timeout: 120000,
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          if (redirects >= 3) {
            reject(new ProviderError('产物地址重定向过多。'));
            return;
          }
          downloadPublicMedia(new URL(res.headers.location, url).href, limit, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new ProviderError(`产物下载失败（${res.statusCode}）。`));
          return;
        }
        if (Number(res.headers['content-length'] || 0) > limit) {
          res.destroy();
          reject(new ProviderError('产物超过文件大小限制。'));
          return;
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            res.destroy(new Error('FILE_TOO_LARGE'));
            return;
          }
          parts.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(parts)));
        res.on('error', () => reject(new ProviderError('下载产物中断，请重试保存结果。')));
      },
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', () => reject(new ProviderError('无法下载服务商产物。')));
    req.end();
  });
}

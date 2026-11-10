import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { z } from 'zod';
import { ProviderError } from '../tasks/types';

export type MediaDnsMode = 'system' | 'public-doh';
export interface MediaDownloadOptions {
  dnsMode?: MediaDnsMode;
  timeoutMs?: number;
}
const publicDnsResponse = z.object({
  Status: z.literal(0),
  TC: z.literal(false).optional(),
  Question: z.array(z.object({ name: z.string(), type: z.literal(1) })).length(1),
  Answer: z.array(z.object({ type: z.number().int(), data: z.string() })).max(256),
});

const publicDnsEndpoints = ['https://dns.google/resolve', 'https://cloudflare-dns.com/dns-query'];
class DnsTransportError extends Error {}

async function queryPublicDns(hostname: string, endpointValue: string, signal: AbortSignal) {
  // Fixed operator-selected resolvers, never caller/provider-supplied URLs.
  // https://developers.google.com/speed/public-dns/docs/doh/json
  // https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/
  const endpoint = new URL(endpointValue);
  endpoint.searchParams.set('name', hostname);
  endpoint.searchParams.set('type', 'A');
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
      credentials: 'omit',
      // Inspect 3xx without following them; they are policy failures, not fallback triggers.
      redirect: 'manual',
      signal,
    });
  } catch {
    throw new DnsTransportError();
  }
  const maximum = 64 * 1024;
  if (Number(response.headers.get('content-length') || 0) > maximum) {
    void response.body?.cancel().catch(() => {});
    throw new Error('DNS_RESPONSE_TOO_LARGE');
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 429 || response.status >= 500) throw new DnsTransportError();
    throw new Error('INVALID_DNS_RESPONSE');
  }
  if (!response.body) throw new Error('INVALID_DNS_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new DnsTransportError();
      }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        throw new Error('DNS_RESPONSE_TOO_LARGE');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const parsed = publicDnsResponse.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const normalize = (name: string) => name.toLowerCase().replace(/\.$/, '');
  if (normalize(parsed.Question[0]!.name) !== normalize(hostname))
    throw new Error('DNS_QUESTION_MISMATCH');
  const addresses = parsed.Answer.filter((answer) => answer.type === 1 || answer.type === 28).map(
    (answer) => ({ address: answer.data, family: answer.type === 1 ? 4 : 6 }),
  );
  // Validate every address, including unexpected AAAA answers, before selecting IPv4.
  if (
    addresses.some(
      (answer) => isIP(answer.address) !== answer.family || !isPublicAddress(answer.address),
    )
  )
    throw new ProviderError('产物地址指向受保护网络。');
  const ipv4 = addresses.filter((answer) => answer.family === 4);
  if (!ipv4.length) throw new Error('NO_PUBLIC_IPV4');
  return ipv4;
}

async function resolvePublicDns(hostname: string, signal: AbortSignal) {
  for (const endpoint of publicDnsEndpoints) {
    if (signal.aborted) throw new ProviderError('下载产物超时，请重试保存结果。');
    const attempt = new AbortController();
    const abort = () => attempt.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8000);
    timer.unref();
    let rejectAttempt!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectAttempt = () => reject(new DnsTransportError());
      attempt.signal.addEventListener('abort', rejectAttempt, { once: true });
    });
    try {
      // The local bound covers headers and body; the parent remains the total download bound.
      return await Promise.race([queryPublicDns(hostname, endpoint, attempt.signal), interrupted]);
    } catch (error) {
      if (signal.aborted) throw new ProviderError('下载产物超时，请重试保存结果。');
      if (error instanceof DnsTransportError) continue;
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('公共 DNS 解析失败，请检查网络后重试保存结果。');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      attempt.signal.removeEventListener('abort', rejectAttempt);
    }
  }
  throw new ProviderError('公共 DNS 解析失败，请检查网络后重试保存结果。');
}
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
  options: MediaDownloadOptions = {},
): Promise<Buffer> {
  // One deadline covers DNS, headers, all redirects and the entire response body.
  // Socket inactivity timeouts alone allow a trickle response to hold a worker forever.
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000)
    throw new ProviderError('媒体下载时限必须是 1000 至 600000 毫秒之间的整数。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const abort = () => reject(new ProviderError('下载产物超时，请重试保存结果。'));
      controller.signal.addEventListener('abort', abort, { once: true });
      downloadMedia(value, limit, redirects, controller.signal, options.dnsMode ?? 'system').then(
        (buffer) => {
          controller.signal.removeEventListener('abort', abort);
          resolve(buffer);
        },
        (error: unknown) => {
          controller.signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  } finally {
    clearTimeout(timer);
  }
}
async function downloadMedia(
  value: string,
  limit: number,
  redirects: number,
  signal: AbortSignal,
  dnsMode: MediaDnsMode,
): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('产物地址不是有效的媒体地址。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new ProviderError('产物地址不是允许的 HTTPS 媒体地址。');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : dnsMode === 'public-doh'
      ? await resolvePublicDns(hostname, signal)
      : await lookup(url.hostname, { all: true });
  if (signal.aborted) throw new ProviderError('下载产物超时，请重试保存结果。');
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new ProviderError('产物地址指向受保护网络。');
  const pinned = addresses[0]!;
  return new Promise<Buffer>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        signal,
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) {
            callback(null, [pinned]);
          } else callback(null, pinned.address, pinned.family);
        },
        headers: { Accept: 'image/*,video/*,audio/*' },
        timeout: 120000,
      },
      (res) => {
        res.on('error', () => reject(new ProviderError('下载产物中断，请重试保存结果。')));
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.destroy();
          if (redirects >= 3) {
            reject(new ProviderError('产物地址重定向过多。'));
            return;
          }
          try {
            const target = new URL(res.headers.location, url).href;
            downloadMedia(target, limit, redirects + 1, signal, dnsMode).then(resolve, reject);
          } catch {
            reject(new ProviderError('产物返回了无效的跳转地址，请核对服务商结果。'));
          }
          return;
        }
        if (res.statusCode !== 200) {
          res.destroy();
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
      },
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', () => reject(new ProviderError('无法下载服务商产物。')));
    req.end();
  });
}

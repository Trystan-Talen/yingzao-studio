import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { downloadPublicMedia } from '../src/server/providers/http';
import { loadConfig } from '../src/server/config';

vi.mock('dotenv/config', () => ({}));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
const mediaUrl = 'https://cdn.example.com/video.mp4';
const options = { dnsMode: 'public-doh' as const };
const configEnv = {
  NODE_ENV: 'test',
  SESSION_SECRET: 'fixture-session',
  ENCRYPTION_KEY: 'fixture-encryption',
};

function dns(addresses = ['36.144.112.105'], name = 'cdn.example.com.') {
  return {
    Status: 0,
    TC: false,
    Question: [{ name, type: 1 }],
    Answer: addresses.map((data) => ({ type: 1, data })),
  };
}
function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), init);
}
function media(status = 200, headers: Record<string, string> = {}, body = 'video', delay = 0) {
  vi.mocked(request).mockImplementationOnce(((
    _url: URL,
    _options: unknown,
    callback: (res: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as ClientRequest;
    req.end = (() => {
      const respond = () => {
        const stream = Object.assign(new PassThrough(), { statusCode: status, headers });
        callback(stream as unknown as IncomingMessage);
        stream.end(body);
      };
      if (delay) setTimeout(respond, delay);
      else queueMicrotask(respond);
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof request);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(lookup).mockResolvedValue([{ address: '198.18.0.161', family: 4 }] as never);
  fetchMock.mockResolvedValue(json(dns()));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('explicit public DNS for media downloads', () => {
  it('keeps system DNS as the default and rejects proxy fake-IP addresses', async () => {
    expect(loadConfig(configEnv).mediaDnsMode).toBe('system');
    await expect(downloadPublicMedia(mediaUrl)).rejects.toThrow('受保护网络');
    expect(lookup).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('only accepts the two configured DNS modes', () => {
    expect(loadConfig({ ...configEnv, MEDIA_DNS_MODE: 'public-doh' }).mediaDnsMode).toBe(
      'public-doh',
    );
    expect(() =>
      loadConfig({ ...configEnv, MEDIA_DNS_MODE: 'https://custom-resolver.example.com' }),
    ).toThrow();
  });

  it('defaults the total download deadline to 120 seconds and accepts explicit bounded values', () => {
    expect(loadConfig(configEnv).mediaDownloadTimeoutMs).toBe(120000);
    for (const timeout of ['1000', '300000', '600000'])
      expect(
        loadConfig({ ...configEnv, MEDIA_DOWNLOAD_TIMEOUT_MS: timeout }).mediaDownloadTimeoutMs,
      ).toBe(Number(timeout));
  });

  it.each(['999', '600001', 'Infinity', 'NaN', '120000.5'])(
    'rejects invalid configured download deadline %s',
    (timeout) => {
      expect(() => loadConfig({ ...configEnv, MEDIA_DOWNLOAD_TIMEOUT_MS: timeout })).toThrow();
    },
  );

  it('resolves through a fixed HTTPS endpoint and pins a validated public IP while retaining the TLS hostname', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...dns(['36.144.112.105', '36.144.112.108']),
        Answer: [
          { type: 5, data: 'cdn-chain.example.com.' },
          ...dns(['36.144.112.105', '36.144.112.108']).Answer,
        ],
      }),
    );
    media();
    expect(await downloadPublicMedia(mediaUrl, 200, 0, options)).toEqual(Buffer.from('video'));
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dns.google/resolve?name=cdn.example.com&type=A');
    expect(init).toEqual({
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
      credentials: 'omit',
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    });
    const [requestedUrl, requestOptions] = vi.mocked(request).mock.calls[0]!;
    expect(String(requestedUrl)).toBe(mediaUrl);
    const httpOptions = requestOptions as {
      lookup: (host: string, options: object, callback: (...args: unknown[]) => void) => void;
      signal: AbortSignal;
      rejectUnauthorized?: boolean;
      headers: Record<string, string>;
    };
    expect(httpOptions.signal).toBeInstanceOf(AbortSignal);
    expect(httpOptions.signal.aborted).toBe(false);
    expect(init?.signal?.aborted).toBe(false);
    expect(httpOptions.rejectUnauthorized).toBeUndefined();
    expect(httpOptions.headers).toEqual({ Accept: 'image/*,video/*,audio/*' });
    const callback = vi.fn();
    httpOptions.lookup('cdn.example.com', {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, '36.144.112.105', 4);
    httpOptions.lookup('cdn.example.com', { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: '36.144.112.105', family: 4 }]);
  });

  it.each(['198.18.0.161', '127.0.0.1', '10.0.0.1', '169.254.169.254', '192.0.2.1'])(
    'rejects every protected answer, including %s after a public one',
    async (address) => {
      fetchMock.mockResolvedValue(json(dns(['36.144.112.105', address])));
      await expect(downloadPublicMedia(mediaUrl, 200, 0, options)).rejects.toThrow('受保护网络');
      expect(request).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('also validates any unexpected IPv6 answer before choosing IPv4', async () => {
    fetchMock.mockResolvedValue(
      json({ ...dns(), Answer: [...dns().Answer, { type: 28, data: '::1' }] }),
    );
    await expect(downloadPublicMedia(mediaUrl, 200, 0, options)).rejects.toThrow('受保护网络');
    expect(request).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { ...dns(), Status: 3 },
    { ...dns(), TC: true },
    dns([], 'cdn.example.com.'),
    dns(['36.144.112.105'], 'unrelated.example.com.'),
    { ...dns(), Question: [{ name: 'cdn.example.com.', type: 28 }] },
    { ...dns(), Answer: [{ type: 5, data: 'http://127.0.0.1/' }] },
  ])('fails closed on invalid or incomplete DNS response %#', async (body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(downloadPublicMedia(mediaUrl, 200, 0, options)).rejects.toThrow('公共 DNS');
    expect(request).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('never follows resolver redirects or falls back to the system resolver', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://private.example.com/resolve' },
      }),
    );
    await expect(downloadPublicMedia(mediaUrl, 200, 0, options)).rejects.toThrow('公共 DNS');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![1]!.redirect).toBe('manual');
    expect(request).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    new Response('x', { headers: { 'content-length': String(65537) } }),
    new Response('x'.repeat(65537)),
    new Response('not JSON'),
    new Response('error', { status: 400 }),
  ])('bounds and validates DNS HTTP responses %#', async (response) => {
    fetchMock.mockResolvedValue(response);
    await expect(downloadPublicMedia(mediaUrl, 200, 0, options)).rejects.toThrow('公共 DNS');
    expect(request).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('re-resolves and validates every media redirect with the same DNS mode', async () => {
    fetchMock
      .mockResolvedValueOnce(json(dns()))
      .mockResolvedValueOnce(json(dns(['198.18.0.161'], 'redirect.example.com.')));
    media(302, { location: 'https://redirect.example.com/file' });
    await expect(downloadPublicMedia(mediaUrl, 200, 0, options)).rejects.toThrow('受保护网络');
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      'https://dns.google/resolve?name=redirect.example.com&type=A',
    );
    expect(fetchMock.mock.calls[1]![1]!.signal).toBeInstanceOf(AbortSignal);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not resolve or request private literal addresses through the public resolver', async () => {
    await expect(
      downloadPublicMedia('https://198.18.0.161/video', 200, 0, options),
    ).rejects.toThrow('受保护网络');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('switches to the fixed backup after 8 seconds and ignores a late primary result', async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(json(dns(['220.181.116.109'])));
    media();
    const downloading = downloadPublicMedia(mediaUrl, 200, 0, options);
    await vi.advanceTimersByTimeAsync(7999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await downloading).toEqual(Buffer.from('video'));
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      'https://cloudflare-dns.com/dns-query?name=cdn.example.com&type=A',
    );
    finish(json(dns()));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledOnce();
    expect(lookup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts after both local DNS deadlines without reverting to the system resolver', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const downloading = downloadPublicMedia(mediaUrl, 200, 0, options).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(16001);
    expect(await downloading).toMatchObject({ message: expect.stringContaining('公共 DNS') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init!.signal!.aborted)).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([429, 500, 503])(
    'uses the fixed backup after temporary HTTP %i failures',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(new Response('unavailable', { status }))
        .mockResolvedValueOnce(json(dns()));
      media();
      expect(await downloadPublicMedia(mediaUrl, 200, 0, options)).toEqual(Buffer.from('video'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1]![0])).toContain(
        'https://cloudflare-dns.com/dns-query?',
      );
    },
  );

  it('uses the fixed backup after a connection failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('connection failed'))
      .mockResolvedValueOnce(json(dns()));
    media();
    expect(await downloadPublicMedia(mediaUrl, 200, 0, options)).toEqual(Buffer.from('video'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('includes the DNS response body in the 8-second attempt limit', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response(new ReadableStream()))
      .mockResolvedValueOnce(json(dns()));
    media();
    const downloading = downloadPublicMedia(mediaUrl, 200, 0, options);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await downloading).toEqual(Buffer.from('video'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never starts the backup when the original total deadline aborts during a later DNS query', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(json(dns()))
      .mockImplementationOnce(() => new Promise(() => {}));
    media(302, { location: 'https://redirect.example.com/file' }, '', 119000);
    const downloading = downloadPublicMedia(mediaUrl, 200, 0, options).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(119001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await downloading).toMatchObject({ message: expect.stringContaining('超时') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1]!.signal!.aborted).toBe(true);
    expect(
      fetchMock.mock.calls.every(([url]) => new URL(String(url)).hostname === 'dns.google'),
    ).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

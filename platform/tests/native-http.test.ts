import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  validateHeaderValue,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import type { LookupAddress } from 'node:dns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: transport.lookup }));
vi.mock('node:https', () => ({ request: transport.request }));
import { nativeProviderJson } from '../src/server/providers/native-http';

function respond(status = 200, body = '{"ok":true}', headers: Record<string, string> = {}) {
  transport.request.mockImplementation(
    (_url: URL, _options: RequestOptions, receive: (res: IncomingMessage) => void) => {
      const req = new EventEmitter() as ClientRequest;
      req.end = vi.fn(() => {
        queueMicrotask(() => {
          const res = Readable.from([Buffer.from(body)]) as IncomingMessage;
          res.statusCode = status;
          res.headers = headers;
          receive(res);
        });
        return req;
      }) as ClientRequest['end'];
      return req;
    },
  );
}

beforeEach(() => {
  transport.lookup.mockReset();
  transport.request.mockReset();
  transport.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  respond();
});

describe('native model network boundary', () => {
  it('reports synchronous request-construction rejection as definitely not submitted', async () => {
    // Node rejects invalid Authorization header characters before opening/sending a request.
    transport.request.mockImplementation((_url: URL, options: RequestOptions) => {
      validateHeaderValue(
        'Authorization',
        (options.headers as Record<string, string>).Authorization!,
      );
      throw new Error('Invalid header unexpectedly accepted');
    });
    await expect(
      nativeProviderJson('https://relay.example/v1/chat/completions', {
        headers: { Authorization: 'Bearer synthetic\nprivate-key' },
        submission: true,
      }),
    ).rejects.toMatchObject({
      ambiguous: false,
      code: 'PROVIDER_CONNECTION',
      message: '模型服务连接失败，请核对服务地址。',
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['127.0.0.1', 4],
    ['10.1.2.3', 4],
    ['169.254.169.254', 4],
    ['::1', 6],
    ['fc00::1', 6],
  ])(
    'rejects a domain resolving to %s before sending credentials or a paid request',
    async (address, family) => {
      transport.lookup.mockResolvedValue([{ address, family }]);
      await expect(
        nativeProviderJson('https://relay.example/v1/images/generations', {
          headers: { Authorization: 'Bearer synthetic-secret' },
          submission: true,
        }),
      ).rejects.toMatchObject({ ambiguous: false });
      expect(transport.request).not.toHaveBeenCalled();
    },
  );

  it('rejects mixed public and private DNS answers', async () => {
    transport.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ]);
    await expect(nativeProviderJson('https://relay.example/v1/chat/completions')).rejects.toThrow(
      '受保护网络',
    );
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('pins a validated public address on a new socket and preserves the original TLS hostname', async () => {
    await expect(
      nativeProviderJson('https://relay.example/v1/chat/completions', {
        body: { model: 'sample-text-v1' },
        headers: { Authorization: 'Bearer synthetic-secret' },
        submission: true,
      }),
    ).resolves.toEqual({ ok: true });
    const [url, options] = transport.request.mock.calls[0] as [URL, RequestOptions];
    expect(url.hostname).toBe('relay.example');
    expect(options.agent).toBe(false);
    expect(options.headers).toMatchObject({ Authorization: 'Bearer synthetic-secret' });
    // Even if subsequent DNS results change, Node's actual socket lookup remains pinned.
    transport.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const pin = options.lookup as (
      host: string,
      opts: { all: true },
      done: (error: Error | null, addresses: LookupAddress[]) => void,
    ) => void;
    const actual = await new Promise<LookupAddress[]>((resolve, reject) =>
      pin('relay.example', { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      ),
    );
    expect(actual).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(transport.lookup).toHaveBeenCalledTimes(1);
  });

  it('does not follow redirects or forward credentials to the target', async () => {
    respond(302, '', { location: 'https://another.example/collect' });
    await expect(
      nativeProviderJson('https://relay.example/v1/images/generations', {
        headers: { Authorization: 'Bearer synthetic-secret' },
        submission: true,
      }),
    ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_HTTP_302' });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    'http://relay.example/v1',
    'https://relay.example:444/v1',
    'https://user:secret@relay.example/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://relay.example/v1?key=secret',
  ])('rejects disallowed endpoint %s', async (url) => {
    await expect(nativeProviderJson(url, { submission: true })).rejects.toMatchObject({
      ambiguous: false,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('limits DNS wait without ever submitting after its deadline', async () => {
    let release!: (addresses: LookupAddress[]) => void;
    transport.lookup.mockReturnValue(
      new Promise<LookupAddress[]>((resolve) => {
        release = resolve;
      }),
    );
    await expect(
      nativeProviderJson('https://relay.example/v1/chat/completions', {
        timeoutMs: 10,
        submission: true,
      }),
    ).rejects.toMatchObject({ ambiguous: false });
    release([{ address: '93.184.216.34', family: 4 }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('rejects oversized and invalid responses without exposing their body', async () => {
    respond(200, 'synthetic-sensitive-body', { 'content-length': String(161 * 1024 * 1024) });
    await expect(
      nativeProviderJson('https://relay.example/v1/chat/completions', { submission: true }),
    ).rejects.toMatchObject({ ambiguous: true, message: '模型服务响应超过大小限制。' });
    respond(200, 'synthetic-sensitive-body');
    await expect(
      nativeProviderJson('https://relay.example/v1/chat/completions', { submission: true }),
    ).rejects.toMatchObject({ ambiguous: true, message: '模型服务返回无法解析的响应。' });
  });

  it('preserves definite authentication failures and ambiguous server failures', async () => {
    respond(401);
    await expect(
      nativeProviderJson('https://relay.example/v1/chat/completions', { submission: true }),
    ).rejects.toMatchObject({ ambiguous: false, code: 'PROVIDER_HTTP_401' });
    respond(503);
    await expect(
      nativeProviderJson('https://relay.example/v1/chat/completions', { submission: true }),
    ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_HTTP_503' });
  });
});

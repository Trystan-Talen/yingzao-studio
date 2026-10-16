import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { downloadPublicMedia } from '../src/server/providers/http';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
});
afterEach(() => vi.resetAllMocks());
function response(status: number, headers: Record<string, string>, body: string | Error = '') {
  vi.mocked(request).mockImplementationOnce(((
    _url: URL,
    _options: unknown,
    callback: (res: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as ClientRequest;
    req.end = (() => {
      queueMicrotask(() => {
        const stream = Object.assign(new PassThrough(), { statusCode: status, headers });
        callback(stream as unknown as IncomingMessage);
        if (body instanceof Error) stream.destroy(body);
        else stream.end(body);
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof request);
}

it('rejects malformed redirect addresses as a promise error without crashing the worker', async () => {
  response(302, { location: 'https://[invalid' });
  await expect(downloadPublicMedia('https://cdn.example.com/file')).rejects.toThrow('跳转地址');
  expect(request).toHaveBeenCalledTimes(1);
});

it('revalidates DNS for every redirect and never sends a request to a private destination', async () => {
  response(302, { location: 'https://private.example.com/file' });
  vi.mocked(lookup)
    .mockReset()
    .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as never)
    .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
  await expect(downloadPublicMedia('https://cdn.example.com/file')).rejects.toThrow('受保护网络');
  expect(request).toHaveBeenCalledTimes(1);
});

it('handles relative redirects and applies the same byte limit to their response', async () => {
  response(302, { location: '/resolved' });
  response(200, {}, '12345');
  await expect(downloadPublicMedia('https://cdn.example.com/file', 4)).rejects.toThrow('中断');
  expect(String(vi.mocked(request).mock.calls[1]![0])).toBe('https://cdn.example.com/resolved');
});

it('observes response errors even for rejected HTTP statuses and normalizes invalid entry URLs', async () => {
  response(503, {}, new Error('fixture-connection-error'));
  await expect(downloadPublicMedia('https://cdn.example.com/file')).rejects.toThrow('503');
  await expect(downloadPublicMedia('https://[invalid')).rejects.toThrow('有效的媒体地址');
  expect(request).toHaveBeenCalledTimes(1);
});

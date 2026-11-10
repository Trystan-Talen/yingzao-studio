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
  vi.useFakeTimers();
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('bounds a DNS lookup that never completes and never issues its eventual stale request', async () => {
  let resolveDns!: (value: Awaited<ReturnType<typeof lookup>>) => void;
  vi.mocked(lookup).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveDns = resolve;
      }),
  );
  let settled = false;
  const downloading = downloadPublicMedia('https://cdn.example.com/video').catch(
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await vi.advanceTimersByTimeAsync(120_001);
  expect(settled).toBe(true);
  expect(await downloading).toMatchObject({ message: expect.stringContaining('超时') });
  resolveDns([{ address: '8.8.8.8', family: 4 }] as never);
  await vi.advanceTimersByTimeAsync(0);
  expect(request).not.toHaveBeenCalled();
});

it('aborts a continuously active response at the total deadline instead of renewing an idle timeout', async () => {
  let stream!: PassThrough;
  const destroy = vi.fn();
  vi.mocked(request).mockImplementationOnce(((
    _url: URL,
    options: { signal?: AbortSignal },
    callback: (res: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as ClientRequest;
    req.destroy = ((error?: Error) => {
      destroy();
      req.emit('error', error || new Error('ABORTED'));
      stream?.destroy();
      return req;
    }) as ClientRequest['destroy'];
    options.signal?.addEventListener('abort', () => req.destroy(new Error('ABORTED')), {
      once: true,
    });
    req.end = (() => {
      stream = new PassThrough();
      callback(
        Object.assign(stream, { statusCode: 200, headers: {} }) as unknown as IncomingMessage,
      );
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof request);
  let settled = false;
  const downloading = downloadPublicMedia('https://cdn.example.com/video').catch(
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await vi.advanceTimersByTimeAsync(0);
  for (let index = 0; index < 4; index++) {
    stream.write(Buffer.from('chunk'));
    await vi.advanceTimersByTimeAsync(30_000);
  }
  expect(settled).toBe(true);
  expect(await downloading).toMatchObject({ message: expect.stringContaining('超时') });
  expect(destroy).toHaveBeenCalledOnce();
});

it('keeps the same total deadline after a delayed redirect', async () => {
  vi.mocked(request).mockImplementationOnce(((
    _url: URL,
    _options: unknown,
    callback: (res: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as ClientRequest;
    req.end = (() => {
      setTimeout(() => {
        const stream = Object.assign(new PassThrough(), {
          statusCode: 302,
          headers: { location: '/redirected' },
        });
        callback(stream as unknown as IncomingMessage);
      }, 90_000);
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof request);
  vi.mocked(lookup)
    .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as never)
    .mockImplementationOnce(() => new Promise(() => {}));
  let settled = false;
  const downloading = downloadPublicMedia('https://cdn.example.com/video').catch(
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await vi.advanceTimersByTimeAsync(90_001);
  expect(settled).toBe(false);
  expect(lookup).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(settled).toBe(true);
  expect(await downloading).toMatchObject({ message: expect.stringContaining('超时') });
  expect(request).toHaveBeenCalledTimes(1);
});

it('allows an explicit 300-second total deadline without truncating an active download at 120 seconds', async () => {
  let stream!: PassThrough;
  let signal!: AbortSignal;
  vi.mocked(request).mockImplementationOnce(((
    _url: URL,
    options: { signal: AbortSignal },
    callback: (res: IncomingMessage) => void,
  ) => {
    signal = options.signal;
    const req = new EventEmitter() as ClientRequest;
    req.destroy = ((error?: Error) => {
      req.emit('error', error || new Error('ABORTED'));
      stream?.destroy();
      return req;
    }) as ClientRequest['destroy'];
    signal.addEventListener('abort', () => req.destroy(new Error('ABORTED')), { once: true });
    req.end = (() => {
      stream = new PassThrough();
      callback(
        Object.assign(stream, { statusCode: 200, headers: {} }) as unknown as IncomingMessage,
      );
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof request);
  let settled = false;
  const downloading = downloadPublicMedia('https://cdn.example.com/video', undefined, 0, {
    timeoutMs: 300000,
  }).catch((error: unknown) => {
    settled = true;
    return error;
  });
  await vi.advanceTimersByTimeAsync(0);
  for (let index = 0; index < 4; index++) {
    stream.write(Buffer.from('chunk'));
    await vi.advanceTimersByTimeAsync(30000);
  }
  expect(settled).toBe(false);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(179999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await downloading).toMatchObject({ message: expect.stringContaining('超时') });
  expect(signal.aborted).toBe(true);
});

it.each([999, 600001, Number.POSITIVE_INFINITY, Number.NaN, 120000.5])(
  'rejects invalid caller-supplied deadline %s before DNS or media access',
  async (timeoutMs) => {
    await expect(
      downloadPublicMedia('https://cdn.example.com/video', undefined, 0, { timeoutMs }),
    ).rejects.toThrow('下载时限');
    expect(lookup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  },
);

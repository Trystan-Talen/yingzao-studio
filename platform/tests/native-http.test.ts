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
import {
  runWithExecutionAudit,
  withExecutionResource,
} from '../src/server/providers/execution-audit';
import type { ExecutionAttemptEvent } from '../src/contracts/task-execution';
import { canFallbackModelResource } from '../src/server/providers/native-fallback';

const noChannelMessage =
  'status_code=503, Current group g1 has no available channels for model gpt-image-2 under billing mode [pay-as-you-go, pay-per-request] (request id: fixture-request)';

function respond(
  status = 200,
  body = '{"ok":true}',
  headers: Record<string, string> = {},
  state: Partial<Pick<IncomingMessage, 'complete' | 'aborted'>> = {},
) {
  transport.request.mockImplementation(
    (_url: URL, _options: RequestOptions, receive: (res: IncomingMessage) => void) => {
      const req = new EventEmitter() as ClientRequest;
      req.end = vi.fn(() => {
        queueMicrotask(() => {
          const res = Readable.from([Buffer.from(body)]) as IncomingMessage;
          res.statusCode = status;
          res.headers = headers;
          Object.assign(res, state);
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
  it('recognizes a complete explicit routing rejection, retains its evidence and permits fallback', async () => {
    const metadata = { error: { type: 'upstream_error', code: '', message: noChannelMessage } };
    respond(503, JSON.stringify(metadata), { 'x-request-id': 'fixture-request' });
    const events: ExecutionAttemptEvent[] = [];
    let rejection: unknown;
    try {
      await runWithExecutionAudit(
        (event) => events.push(event),
        () =>
          nativeProviderJson('https://relay.example/v1/images/generations', { submission: true }),
      );
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toMatchObject({
      ambiguous: false,
      code: 'PROVIDER_NOT_EXECUTED',
      message: '当前模型没有可用通道，服务商确认未执行本次请求。',
    });
    expect(canFallbackModelResource(rejection)).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      status: 'rejected',
      httpStatus: 503,
      requestId: 'fixture-request',
      errorCode: 'PROVIDER_NOT_EXECUTED',
      metadata,
    });
  });
  it.each([
    {
      status: 503,
      error: {
        message: noChannelMessage.replace(/^status_code=503, /, ''),
        type: 'shell_api_error',
        param: '',
        code: null,
      },
    },
    {
      status: 500,
      error: {
        code: 'no_available_channel',
        message: 'Current group default has no available channels for model gpt-image-2',
      },
    },
    {
      status: 503,
      error: {
        code: 'channel_not_found',
        message: '当前分组 默认 下对于模型 gpt-image-2 无可用渠道 (request id: fixture-cn)',
      },
    },
    { status: 503, error: { code: 'no_available_channels', message: 'No available channels' } },
  ])('recognizes the supported complete routing error envelope: %j', async ({ status, error }) => {
    respond(status, JSON.stringify({ error }));
    await expect(
      nativeProviderJson('https://relay.example/v1/images/generations', { submission: true }),
    ).rejects.toMatchObject({ ambiguous: false, code: 'PROVIDER_NOT_EXECUTED' });
  });
  it.each([
    { error: { message: 'Service unavailable' } },
    { error: { message: 'No available channels' } },
    { error: { code: 'no_available_channel' } },
    {
      error: {
        code: 'no_available_channel',
        message: 'Request accepted but no available channels',
      },
    },
    { error: { code: 'generation_failed', message: noChannelMessage } },
    { error: { type: 'task_processing', message: noChannelMessage } },
    { error: { type: 'accepted', message: noChannelMessage } },
    { error: { param: 'task_id=existing-task', message: noChannelMessage } },
    { error: { message: `Previously: ${noChannelMessage}` } },
    { error: { message: `${noChannelMessage}; existing task is still running` } },
    { message: noChannelMessage },
    { error: noChannelMessage },
    { error: { message: noChannelMessage }, id: 'existing-task' },
    { error: { message: noChannelMessage, task_id: 'existing-task' } },
    { error: { message: noChannelMessage }, taskId: 'existing-task' },
    { error: { message: noChannelMessage }, status: 'running' },
    { error: { message: noChannelMessage }, data: [{ b64_json: 'existing-image' }] },
    { error: { message: noChannelMessage }, output: { url: 'https://example.test/image' } },
    { error: { message: noChannelMessage }, usage: { total_tokens: 1 } },
    { error: { message: noChannelMessage }, id: null },
    { error: { message: noChannelMessage }, data: [] },
  ])('keeps ambiguous or contradictory error metadata uncertain: %j', async (metadata) => {
    respond(503, JSON.stringify(metadata));
    let rejection: unknown;
    try {
      await nativeProviderJson('https://relay.example/v1/images/generations', { submission: true });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toMatchObject({ ambiguous: true, code: 'PROVIDER_HTTP_503' });
    expect(canFallbackModelResource(rejection)).toBe(false);
  });
  it('does not reinterpret a polling response as evidence that the original request was never executed', async () => {
    respond(503, JSON.stringify({ error: { message: noChannelMessage } }));
    await expect(
      nativeProviderJson('https://relay.example/tasks/existing-task', {
        method: 'GET',
        submission: true,
      }),
    ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_HTTP_503' });
  });
  it.each([
    ['malformed', '{"error":{"message":"Current group g1 has no available channels'],
    ['plain text', noChannelMessage],
    [
      'oversized',
      JSON.stringify({ error: { message: noChannelMessage }, padding: 'x'.repeat(65536) }),
    ],
  ])('does not trust a %s routing rejection body', async (_name, body) => {
    respond(503, body);
    await expect(
      nativeProviderJson('https://relay.example/v1/images/generations', { submission: true }),
    ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_HTTP_503' });
  });
  it('does not use a fully parseable error chunk until the response has ended', async () => {
    vi.useFakeTimers();
    try {
      transport.request.mockImplementation(
        (_url: URL, _options: RequestOptions, receive: (res: IncomingMessage) => void) => {
          const req = new EventEmitter() as ClientRequest;
          req.end = vi.fn(() => {
            const res = new Readable({ read() {} }) as IncomingMessage;
            res.statusCode = 503;
            res.headers = {};
            receive(res);
            res.push(Buffer.from(JSON.stringify({ error: { message: noChannelMessage } })));
            return req;
          }) as ClientRequest['end'];
          return req;
        },
      );
      const events: ExecutionAttemptEvent[] = [];
      const pending = expect(
        runWithExecutionAudit(
          (event) => events.push(event),
          () =>
            nativeProviderJson('https://relay.example/v1/images/generations', { submission: true }),
        ),
      ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_HTTP_503' });
      await vi.advanceTimersByTimeAsync(5001);
      await pending;
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ status: 'uncertain', metadata: { bodyTruncated: true } });
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps a routing response uncertain when its stream fails before completion', async () => {
    transport.request.mockImplementation(
      (_url: URL, _options: RequestOptions, receive: (res: IncomingMessage) => void) => {
        const req = new EventEmitter() as ClientRequest;
        req.end = vi.fn(() => {
          const res = new Readable({ read() {} }) as IncomingMessage;
          res.statusCode = 503;
          res.headers = {};
          receive(res);
          res.push(Buffer.from(JSON.stringify({ error: { message: noChannelMessage } })));
          queueMicrotask(() => res.destroy(new Error('connection reset')));
          return req;
        }) as ClientRequest['end'];
        return req;
      },
    );
    const events: ExecutionAttemptEvent[] = [];
    await expect(
      runWithExecutionAudit(
        (event) => events.push(event),
        () =>
          nativeProviderJson('https://relay.example/v1/images/generations', { submission: true }),
      ),
    ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_CONNECTION' });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ status: 'uncertain' });
  });
  it.each(['aborted', 'close'])(
    'does not classify a parseable routing response whose stream emits %s without end',
    async (event) => {
      transport.request.mockImplementation(
        (_url: URL, _options: RequestOptions, receive: (res: IncomingMessage) => void) => {
          const req = new EventEmitter() as ClientRequest;
          req.end = vi.fn(() => {
            const res = new Readable({ read() {} }) as IncomingMessage;
            res.statusCode = 503;
            res.headers = {};
            receive(res);
            res.push(Buffer.from(JSON.stringify({ error: { message: noChannelMessage } })));
            queueMicrotask(() => {
              res.emit(event);
              res.destroy();
            });
            return req;
          }) as ClientRequest['end'];
          return req;
        },
      );
      const events: ExecutionAttemptEvent[] = [];
      await expect(
        runWithExecutionAudit(
          (entry) => events.push(entry),
          () =>
            nativeProviderJson('https://relay.example/v1/images/generations', { submission: true }),
        ),
      ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_CONNECTION' });
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ status: 'uncertain' });
    },
  );
  it.each([{ complete: false }, { aborted: true }])(
    'keeps an ended response uncertain when transport completeness contradicts it: %j',
    async (state) => {
      respond(503, JSON.stringify({ error: { message: noChannelMessage } }), {}, state);
      await expect(
        nativeProviderJson('https://relay.example/v1/images/generations', { submission: true }),
      ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_CONNECTION' });
    },
  );
  it('bounds a stalled rejection body independently of the long generation timeout', async () => {
    vi.useFakeTimers();
    try {
      transport.request.mockImplementation(
        (_url: URL, _options: RequestOptions, receive: (res: IncomingMessage) => void) => {
          const req = new EventEmitter() as ClientRequest;
          req.end = vi.fn(() => {
            const res = new Readable({ read() {} }) as IncomingMessage;
            res.statusCode = 503;
            res.headers = {};
            receive(res);
            return req;
          }) as ClientRequest['end'];
          return req;
        },
      );
      const pending = expect(
        nativeProviderJson('https://relay.example/v1/images/generations', {
          submission: true,
          timeoutMs: 900000,
        }),
      ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_HTTP_503' });
      await vi.advanceTimersByTimeAsync(5001);
      await pending;
      expect(transport.request).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not classify an accepted request as safe to repeat when its audit sink fails', async () => {
    let events = 0;
    await expect(
      runWithExecutionAudit(
        () => {
          if (++events > 1) throw new Error('database unavailable');
        },
        () =>
          nativeProviderJson('https://relay.example/v1/images/generations', { submission: true }),
      ),
    ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_AUDIT_FAILED' });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
  it('records bounded upstream rejection metadata and request IDs without leaking echoed credentials or output media', async () => {
    const secret = 'fixture-private-key-without-prefix';
    respond(
      503,
      JSON.stringify({
        error: {
          code: 'no_available_channel',
          message: `unavailable ${secret}`,
          authorization: secret,
        },
        request_id: 'upstream-123',
        data: [
          { b64_json: 'sensitive-image-bytes', url: 'https://media.example/private?token=private' },
        ],
      }),
      { 'x-request-id': 'header-request-123' },
    );
    const events: ExecutionAttemptEvent[] = [];
    await expect(
      runWithExecutionAudit(
        (event) => events.push(event),
        () =>
          withExecutionResource({ id: 'image', name: '首选图片', model: 'gpt-image-2' }, () =>
            nativeProviderJson('https://relay.example/v1/images/generations', {
              submission: true,
              headers: { Authorization: `Bearer ${secret}` },
            }),
          ),
      ),
    ).rejects.toMatchObject({ ambiguous: true, code: 'PROVIDER_HTTP_503' });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      attemptId: events[0]!.attemptId,
      resource: { id: 'image' },
      status: 'uncertain',
      httpStatus: 503,
      requestId: 'header-request-123',
      metadata: { error: { code: 'no_available_channel' } },
    });
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain('sensitive-image-bytes');
    expect(JSON.stringify(events)).not.toContain('media.example');
  });
  it('records a successful task submission separately from subsequent polling', async () => {
    const events: ExecutionAttemptEvent[] = [];
    respond(
      200,
      JSON.stringify({
        id: 'task-123',
        status: 'queued',
        usage: { total_tokens: 7 },
        secret: 'never-log-me',
      }),
    );
    await runWithExecutionAudit(
      (event) => events.push(event),
      () => nativeProviderJson('https://relay.example/tasks', { submission: true }),
    );
    expect(events[1]).toMatchObject({
      action: 'submit',
      status: 'running',
      remoteId: 'task-123',
      metadata: { usage: { total_tokens: 7 } },
    });
    events.length = 0;
    await runWithExecutionAudit(
      (event) => events.push(event),
      () => nativeProviderJson('https://relay.example/tasks/task-123', { method: 'GET' }),
    );
    expect(events[1]).toMatchObject({ action: 'poll', status: 'running', remoteId: 'task-123' });
    expect(JSON.stringify(events)).not.toContain('never-log-me');
  });
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setApiWorkspace } from '../src/web/lib/api';
import { submissionWasRejected } from '../src/web/lib/creation-recovery';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setApiWorkspace(null);
});

describe('bounded server confirmation', () => {
  it('stops waiting for an accepted request without resubmitting or calling it rejected', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;
    const requestId = crypto.randomUUID();
    const accepted = { id: crypto.randomUUID(), requestId };
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal;
      // The server accepted the command, but its response never arrives.
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal('fetch', fetch);
    const request = api('/jobs', {
      method: 'POST',
      body: JSON.stringify({ clientRequestId: requestId }),
      timeoutMs: 15_000,
    });
    const observed = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await observed;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'REQUEST_TIMEOUT', status: 0 });
    expect(submissionWasRejected(error as ApiError)).toBe(false);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).clientRequestId).toBe(requestId);

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: accepted })));
    expect(await api(`/jobs/by-request/${requestId}`, { timeoutMs: 15_000 })).toEqual(accepted);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0]).toBe(`/api/v1/jobs/by-request/${requestId}`);
    expect(fetch.mock.calls[1]![1]!.method).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds a stalled response body after headers have arrived', async () => {
    vi.useFakeTimers();
    const response = new Response();
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const observed = api('/jobs', { method: 'POST', timeoutMs: 1_000 }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await observed).toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its deadline after success and forwards the workspace and request fields', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'job' } })));
    vi.stubGlobal('fetch', fetch);
    setApiWorkspace('workspace');
    expect(await api('/jobs', { method: 'POST', body: '{}', timeoutMs: 1_000 })).toEqual({
      id: 'job',
    });
    const init = fetch.mock.calls[0]![1] as RequestInit & { timeoutMs?: number };
    expect(new Headers(init.headers).get('x-workspace-id')).toBe('workspace');
    expect(init.credentials).toBe('same-origin');
    expect(init.timeoutMs).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps caller cancellation distinct from an unknown server confirmation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason), {
              once: true,
            });
          }),
      ),
    );
    const request = api('/jobs', { signal: controller.signal, timeoutMs: 1_000 });
    const observed = request.catch((error: unknown) => error);
    controller.abort();
    expect(await observed).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

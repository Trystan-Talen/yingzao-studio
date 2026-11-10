import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { creativeIntentRequestSchema } from '../src/contracts/creative-intent';
import {
  CREATIVE_INTENT_CLIENT_TIMEOUT_MS,
  CREATIVE_INTENT_SERVER_TIMEOUT_MS,
} from '../src/contracts/creative-intent-timing';
import { analyzeDifyIntent } from '../src/server/providers/dify';

const captured = JSON.parse(
  readFileSync('tests/fixtures/dify-intent-ready-missing-questions.json', 'utf8'),
) as { request: unknown };
const input = creativeIntentRequestSchema.parse(captured.request);

beforeEach(() => {
  vi.useFakeTimers();
  // Node's native AbortSignal.timeout uses internal timers. Route just this clock
  // through fake timers while exercising the real providerJson and intent adapter.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function delayedWorkflow(milliseconds: number) {
  const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve(
          new Response(
            JSON.stringify({
              workflow_run_id: 'timeout-regression-run',
              data: {
                status: 'failed',
                outputs: null,
                error: 'PRIVATE-UPSTREAM-ERROR',
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }, milliseconds);
      signal?.addEventListener('abort', abort, { once: true });
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it.each([121_487, 141_000])(
  'receives an explicit workflow failure at %i ms through the real transport without retrying',
  async (milliseconds) => {
    const fetcher = delayedWorkflow(milliseconds);
    let settled = false;
    const pending = analyzeDifyIntent(input, 'test-only-key', { user: 'timeout_regression' }).catch(
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(milliseconds - 120_000);
    expect(await pending).toMatchObject({
      code: 'DIFY_INTENT_FAILED',
      ambiguous: false,
      message: expect.not.stringContaining('PRIVATE-UPSTREAM-ERROR'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(160_000);
    await vi.advanceTimersByTimeAsync(CREATIVE_INTENT_CLIENT_TIMEOUT_MS);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it('keeps a response arriving after the 160-second deadline uncertain and never retries it', async () => {
  const fetcher = delayedWorkflow(165_000);
  let settled = false;
  const pending = analyzeDifyIntent(input, 'test-only-key', { user: 'timeout_regression' }).catch(
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await vi.advanceTimersByTimeAsync(CREATIVE_INTENT_SERVER_TIMEOUT_MS - 1);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ code: 'DIFY_INTENT_UNCERTAIN', ambiguous: true });
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

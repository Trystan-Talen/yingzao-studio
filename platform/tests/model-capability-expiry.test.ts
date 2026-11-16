// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCapabilitiesDto } from '../src/contracts/model-capabilities';
import type { OperationCapability } from '../src/contracts/jobs';
import {
  useModelCapability,
  type ModelCapabilitySelection,
  type ModelCapabilityState,
} from '../src/web/lib/use-model-capability';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/web/context', () => ({
  useStudio: () => ({ workspace: { id: 'isolated-space' } }),
}));
vi.mock('../src/web/lib/api', async (original) => ({
  ...(await original<typeof import('../src/web/lib/api')>()),
  api: request,
}));
const model = {
  id: 'image-a',
  name: 'Isolated model',
  ratios: ['1:1'],
  resolutions: ['2K'],
  durations: [],
};
const operation: OperationCapability = {
  id: 'image.generate',
  providerId: 'native',
  name: '图片',
  available: true,
  reason: null,
  models: [model],
  priceCredits: 8,
  unit: 'image',
  liveVerified: false,
};
const dto = (patch: Partial<ModelCapabilitiesDto> = {}): ModelCapabilitiesDto => ({
  providerId: 'native',
  operation: 'image.generate',
  modelId: model.id,
  inputMode: 'text',
  status: 'limited',
  canGenerate: true,
  source: 'local-adapter',
  modelVerified: false,
  parametersVerified: false,
  model,
  maxCount: 1,
  revision: `revision-${Date.now()}`,
  parameters: [],
  checkedAt: new Date().toISOString(),
  fetchedAt: null,
  expiresAt: new Date(Date.now() + 1000).toISOString(),
  cache: 'miss',
  reasonCode: 'LOCAL_ONLY',
  reason: '',
  ...patch,
});
let root: Root;
let node: HTMLDivElement;
let client: QueryClient;
let selection: ModelCapabilitySelection;
let state: ModelCapabilityState;
let visibility: DocumentVisibilityState;
function Probe() {
  state = useModelCapability(selection);
  return createElement('button', { disabled: !state.canGenerate }, state.model?.id);
}
async function render() {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe)));
  });
  await advance(1);
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  selection = { operation, model };
  request.mockImplementation(async () => dto());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    await client.cancelQueries();
    client.clear();
  });
  node.remove();
  request.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('mounted model capability expiration lifecycle', () => {
  it('reschedules an early timer when wall time moved backwards before the deadline', async () => {
    await render();
    await advance(900);
    vi.setSystemTime(Date.now() - 100);
    await advance(101);
    expect(request).toHaveBeenCalledTimes(1);
    await advance(100);
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.canGenerate).toBe(true);
  });

  it('recovers an expired result detected during a render even if its timer has not run', async () => {
    await render();
    vi.setSystemTime(Date.now() + 1200);
    await render();
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.canGenerate).toBe(true);
  });

  it.each(['focus', 'pageshow'])(
    'recovers on window %s before a delayed timer runs, sharing duplicate resume events',
    async (eventName) => {
      let finish!: (value: ModelCapabilitiesDto) => void;
      request.mockResolvedValueOnce(dto()).mockImplementationOnce(
        () =>
          new Promise<ModelCapabilitiesDto>((resolve) => {
            finish = resolve;
          }),
      );
      await render();
      vi.setSystemTime(Date.now() + 1200);
      await act(async () => {
        window.dispatchEvent(new Event(eventName));
      });
      expect(request).toHaveBeenCalledTimes(2);
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event(eventName));
      });
      expect(request).toHaveBeenCalledTimes(2);
      expect(state.canGenerate).toBe(false);
      await act(async () => {
        finish(dto());
      });
      await advance(1);
      expect(state.canGenerate).toBe(true);
    },
  );

  it('stops automatic recovery when the server keeps returning different expired deadlines', async () => {
    request
      .mockResolvedValueOnce(dto())
      .mockImplementation(async () => dto({ expiresAt: new Date(Date.now() - 10).toISOString() }));
    await render();
    await advance(1001);
    expect(request).toHaveBeenCalledTimes(2);
    await render();
    await advance(60000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.canGenerate).toBe(false);
  });

  it('renews at expiry, blocks during renewal and recovers without changing the selection', async () => {
    let finish!: (value: ModelCapabilitiesDto) => void;
    request.mockResolvedValueOnce(dto()).mockImplementationOnce(
      () =>
        new Promise<ModelCapabilitiesDto>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    expect(state.canGenerate).toBe(true);
    await advance(1001);
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.isExpired).toBe(true);
    expect(state.canGenerate).toBe(false);
    await act(async () => {
      finish(dto());
    });
    await advance(1);
    expect(state.canGenerate).toBe(true);
    expect(state.model?.id).toBe('image-a');
  });

  it('waits while hidden and renews once when the expired page becomes visible', async () => {
    await render();
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(6000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(state.canGenerate).toBe(false);
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.canGenerate).toBe(true);
  });

  it('does not loop failed renewals and supports an explicit retry', async () => {
    request.mockResolvedValueOnce(dto()).mockRejectedValueOnce(new Error('isolated offline'));
    await render();
    await advance(1001);
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.canGenerate).toBe(false);
    expect(state.error).toBeTruthy();
    await advance(60000);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValueOnce(dto({ expiresAt: new Date(Date.now() + 60000).toISOString() }));
    await act(async () => {
      await state.refresh();
    });
    await advance(1);
    expect(request).toHaveBeenCalledTimes(3);
    expect(state.canGenerate).toBe(true);
  });

  it('does not retry an unavailable or unchanged expired response on a timer', async () => {
    const original = dto();
    request.mockResolvedValue(original);
    await render();
    await advance(1001);
    expect(request).toHaveBeenCalledTimes(2);
    await advance(60000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.canGenerate).toBe(false);
    request.mockResolvedValueOnce(dto({ canGenerate: false, reasonCode: 'NOT_CONFIGURED' }));
    await act(async () => {
      await state.refresh();
    });
    await advance(60000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(state.canGenerate).toBe(false);
  });

  it('cancels an expired selection request and ignores its late response after switching models', async () => {
    let finish!: (value: ModelCapabilitiesDto) => void;
    let oldSignal!: AbortSignal;
    request
      .mockResolvedValueOnce(dto())
      .mockImplementationOnce((_path, init: { signal: AbortSignal }) => {
        oldSignal = init.signal;
        return new Promise<ModelCapabilitiesDto>((resolve) => {
          finish = resolve;
        });
      });
    await render();
    await advance(1001);
    expect(request).toHaveBeenCalledTimes(2);
    const replacement = { ...model, id: 'image-b' };
    selection = { operation: { ...operation, models: [replacement] }, model: replacement };
    request.mockResolvedValueOnce(dto({ modelId: replacement.id, model: replacement }));
    await render();
    expect(oldSignal.aborted).toBe(true);
    expect(state.canGenerate).toBe(true);
    await act(async () => {
      finish(dto());
    });
    await advance(1);
    expect(state.data?.modelId).toBe('image-b');
    expect(state.canGenerate).toBe(true);
  });
});

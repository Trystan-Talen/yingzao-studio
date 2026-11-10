import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelCapabilitiesDto } from '../src/contracts/model-capabilities';
import type { OperationCapability } from '../src/contracts/jobs';
import {
  capabilityCanGenerate,
  capabilityMatchesSelection,
  capabilitySelectionIssue,
  fixedCapabilityOptions,
  modelCapabilityQueryOptions,
  type ModelCapabilityState,
} from '../src/web/lib/use-model-capability';
import { ModelCapabilityStatus } from '../src/web/components/ModelCapabilityStatus';
import { setLocale, t } from '../src/web/lib/i18n';
import { MODEL_CAPABILITY_TRANSLATIONS } from '../src/web/lib/model-capability-translations';
import { newModelDefaults, resolveModelSelection } from '../src/web/lib/model-selection';
import { canConfirmQuote, quoteFormFingerprint } from '../src/web/lib/quote-confirmation';
import { jobInput } from '../src/web/lib/tasks';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/web/lib/api', async (original) => ({
  ...(await original<typeof import('../src/web/lib/api')>()),
  api: request,
}));
const model = {
  id: 'wan-2.6',
  name: 'Wan',
  ratios: ['16:9'],
  resolutions: ['720p'],
  durations: [5],
};
const operation: OperationCapability = {
  id: 'video.generate',
  providerId: 'fal',
  name: '视频',
  available: true,
  reason: null,
  models: [model],
  priceCredits: 5,
  unit: 'second',
  liveVerified: false,
};
const dto = (patch: Partial<ModelCapabilitiesDto> = {}): ModelCapabilitiesDto => ({
  providerId: 'fal',
  operation: 'video.generate',
  modelId: model.id,
  inputMode: 'text',
  status: 'ready',
  canGenerate: true,
  source: 'upstream-schema',
  modelVerified: true,
  parametersVerified: true,
  model,
  maxCount: 2,
  revision: '91a845e2-8d39-4e7e-941b-e6ac364f2c31',
  parameters: [{ key: 'duration', values: [5, 10], adjustable: true, source: 'upstream-schema' }],
  checkedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  cache: 'miss',
  reasonCode: 'SCHEMA_VERIFIED',
  reason: '',
  ...patch,
});
afterEach(() => {
  request.mockReset();
  setLocale('zh-CN');
});

describe('model capability boundaries', () => {
  it('initializes legal fresh-draft defaults without inventing unsupported image-mode ratios', () => {
    expect(
      newModelDefaults(
        {
          ...model,
          ratios: ['1:1', '16:9', '9:16'],
          resolutions: ['480p', '720p', '1080p', '4K'],
          durations: [4, 5, 6, 15],
        },
        1,
        'video',
      ),
    ).toMatchObject({ ratio: '16:9', resolution: '720p', duration: 5, count: 1 });
    expect(
      newModelDefaults(
        { ...model, id: 'seedream', resolutions: ['2K'], ratios: ['1:1', '3:4'] },
        1,
      ),
    ).toMatchObject({ ratio: '1:1', resolution: '2K', count: 1 });
    expect(newModelDefaults({ ...model, ratios: [] }, 2).ratio).toBeUndefined();
    expect(newModelDefaults({ ...model, id: 'kling-o1-first-last' }, 2).referenceMode).toBe(
      'first-last',
    );
    expect(
      newModelDefaults({ ...model, textOverlay: { mode: 'unsupported', note: '' } }, 1).needText,
    ).toBe(false);
  });
  it('does not substitute another provider or model for a restored explicit selection', () => {
    expect(resolveModelSelection([operation], '', '').model).toEqual(model);
    expect(
      resolveModelSelection([operation], 'video.generate:retired', 'wan-2.6').operation,
    ).toBeUndefined();
    expect(
      resolveModelSelection([operation], 'video.generate:fal', 'retired').model,
    ).toBeUndefined();
  });
  it('requires re-quoting changed creative settings while allowing project creation during preparation', () => {
    const input = jobInput({
      operation: 'video.generate',
      providerId: 'fal',
      prompt: 'scene',
      options: { model: model.id, duration: 5 },
    });
    const fingerprint = quoteFormFingerprint(input);
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    expect(
      quoteFormFingerprint({
        ...input,
        projectId: 'new-project',
        documentId: 'new-document',
        baseRevision: 1,
      }),
    ).toBe(fingerprint);
    expect(canConfirmQuote(true, fingerprint, fingerprint, expiresAt)).toBe(true);
    for (const changed of [
      { ...input, capabilityRevision: 'new-revision' },
      { ...input, prompt: 'changed' },
      { ...input, options: { ...input.options, duration: 10 } },
      { ...input, referenceAssetIds: ['new-reference'] },
    ])
      expect(canConfirmQuote(true, fingerprint, quoteFormFingerprint(changed), expiresAt)).toBe(
        false,
      );
    expect(canConfirmQuote(false, fingerprint, fingerprint, expiresAt)).toBe(false);
    expect(canConfirmQuote(true, fingerprint, fingerprint, new Date(0).toISOString())).toBe(false);
  });
  it('preserves unsupported selections and matches case-insensitive server validation', () => {
    const data = dto({
      parameters: [
        { key: 'resolution', values: ['720p'], adjustable: true, source: 'upstream-schema' },
      ],
    });
    const draft = { resolution: '1080p', count: 4 };
    expect(capabilitySelectionIssue(data, draft)).toContain('原值已保留');
    expect(draft).toEqual({ resolution: '1080p', count: 4 });
    expect(capabilitySelectionIssue(data, { resolution: '720P' })).toBeNull();
    expect(capabilitySelectionIssue(data, { count: 3 })).toContain('最多支持 2');
  });
  it('requires explicit adoption of fixed semantic settings and does not invent options for absent parameters', () => {
    const data = dto({
      parameters: [
        { key: 'duration', values: [5], adjustable: false, source: 'upstream-schema' },
        { key: 'size', values: ['1024x1024'], adjustable: false, source: 'local-adapter' },
      ],
    });
    expect(capabilitySelectionIssue(data, { duration: 10 })).toContain('时长');
    expect(fixedCapabilityOptions(data)).toEqual({ duration: 5 });
    expect(capabilitySelectionIssue(data, { ratio: '9:16', size: 'custom' })).toBeNull();
    expect(capabilityCanGenerate(dto({ parameters: [] }), false, null)).toBe(true);
    expect(
      capabilityCanGenerate(
        dto({
          parameters: [{ key: 'ratio', values: [], adjustable: false, source: 'upstream-schema' }],
        }),
        false,
        null,
      ),
    ).toBe(false);
  });
  it('checks omitted generated audio against the serialized false default without rewriting the draft', () => {
    const data = dto({
      parameters: [
        { key: 'generateAudio', values: [true], adjustable: false, source: 'upstream-schema' },
      ],
    });
    const draft = {};
    expect(capabilitySelectionIssue(data, draft)).toContain('生成音频');
    expect(capabilitySelectionIssue(data, { generateAudio: false })).toContain('生成音频');
    expect(capabilitySelectionIssue(data, { generateAudio: true })).toBeNull();
    expect(draft).toEqual({});
    expect(
      capabilitySelectionIssue(
        dto({ parameters: [{ ...data.parameters[0]!, values: [false] }] }),
        draft,
      ),
    ).toBeNull();
  });
  it('blocks fetching, stale, unavailable and failed reads even if an older response exists', () => {
    const data = dto();
    expect(capabilityCanGenerate(data, false, null)).toBe(true);
    expect(capabilityCanGenerate(data, true, null)).toBe(false);
    expect(capabilityCanGenerate(data, false, new Error('offline'))).toBe(false);
    expect(capabilityCanGenerate(dto({ expiresAt: new Date(0).toISOString() }), false, null)).toBe(
      false,
    );
    expect(capabilityCanGenerate(dto({ expiresAt: 'invalid' }), false, null)).toBe(false);
    expect(capabilityCanGenerate(dto({ canGenerate: false }), false, null)).toBe(false);
  });
  it('rejects a late response for another provider, operation, model or input mode', () => {
    const selected = { operation, model };
    expect(capabilityMatchesSelection(dto(), selected)).toBe(true);
    for (const patch of [
      { providerId: 'openai' },
      { operation: 'image.generate' },
      { modelId: 'other' },
      { inputMode: 'image' },
    ] as Partial<ModelCapabilitiesDto>[]) {
      expect(capabilityMatchesSelection(dto(patch), selected)).toBe(false);
    }
  });
  it('scopes requests by workspace and consumes the abort signal with forced refresh', async () => {
    const controller = new AbortController();
    request.mockResolvedValue(dto());
    const options = modelCapabilityQueryOptions(
      { operation, model, inputMode: 'image' },
      'space-a',
    );
    expect(options.queryKey).not.toEqual(
      modelCapabilityQueryOptions({ operation, model, inputMode: 'image' }, 'space-b').queryKey,
    );
    await options.queryFn({ signal: controller.signal });
    expect(request).toHaveBeenCalledWith(
      expect.stringMatching(/refresh=true/),
      { signal: controller.signal, timeoutMs: 20000 },
      'space-a',
    );
    expect(request.mock.calls[0]?.[0]).toContain('inputMode=image');
    expect(modelCapabilityQueryOptions({ operation }, 'space-a').enabled).toBe(false);
  });
  it('refetches when returning to a cached model and cancels the abandoned selection', async () => {
    const pending: { signal: AbortSignal; resolve: (data: ModelCapabilitiesDto) => void }[] = [];
    request.mockImplementation(
      (_path, init: { signal: AbortSignal }) =>
        new Promise<ModelCapabilitiesDto>((resolve) =>
          pending.push({ signal: init.signal, resolve }),
        ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const a = modelCapabilityQueryOptions({ operation, model }, 'space-a');
    client.setQueryData(a.queryKey, dto());
    const observer = new QueryObserver(client, a);
    const unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().isFetching).toBe(true);
    observer.setOptions(
      modelCapabilityQueryOptions({ operation, model: { ...model, id: 'other' } }, 'space-a'),
    );
    expect(pending[0]?.signal.aborted).toBe(true);
    observer.setOptions(a);
    expect(pending[1]?.signal.aborted).toBe(true);
    const returning = observer.getCurrentResult();
    expect(returning.data).toBeTruthy();
    expect(capabilityCanGenerate(returning.data, returning.isFetching, returning.error)).toBe(
      false,
    );
    pending[2]!.resolve(dto());
    await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false));
    expect(capabilityCanGenerate(observer.getCurrentResult().data, false, null)).toBe(true);
    unsubscribe();
    client.clear();
  });
  it.each(['en', 'ar'] as const)('localizes status and parameter failures in %s', (locale) => {
    setLocale(locale);
    for (const key of Object.keys(MODEL_CAPABILITY_TRANSLATIONS)) {
      expect(t(key)).not.toBe(key);
      expect(t(key)).not.toMatch(/[\u3400-\u9fff]/);
    }
    const data = dto({ parametersVerified: false, source: 'upstream-model-list' });
    const state = {
      data,
      canGenerate: true,
      canRefresh: true,
      fixedOptions: {},
      refresh: vi.fn(),
      isFetching: false,
    } as unknown as ModelCapabilityState;
    const html = renderToStaticMarkup(
      createElement(ModelCapabilityStatus, {
        capability: state,
        selectionIssue: capabilitySelectionIssue(data, { duration: 60 }),
      }),
    );
    expect(html).not.toMatch(/[\u3400-\u9fff]/);
    expect(html).toContain('<details>');
  });
});

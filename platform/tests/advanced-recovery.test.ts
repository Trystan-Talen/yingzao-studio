import { describe, expect, it } from 'vitest';
import {
  advancedDraftStorageKey,
  advancedParameterSelection,
  findAdvancedDraftBatch,
  matchingAdvancedDraft,
  saveAdvancedDraft,
} from '../src/web/lib/advanced-recovery';
import { jobInput } from '../src/web/lib/tasks';
const draft = jobInput({
  operation: 'image.text-edit',
  providerId: 'flyelep',
  prompt: '保留修改',
  options: {
    model: 'saved-model',
    textReplacements: [{ originalText: '原字', replaceText: '新字', rect: [0, 0, 100, 40] }],
  },
});
describe('advanced tool durable drafts', () => {
  it('isolates each OCR job, item and region while preferring an edited local input for its source', () => {
    const key = (jobId = 'job', itemId = 'item', region = '0') =>
      advancedDraftStorageKey('user', 'space', 'image.text-edit', undefined, {
        jobId,
        itemId,
        region,
      });
    expect(new Set([key(), key('other'), key('job', 'other'), key('job', 'item', '1')]).size).toBe(
      4,
    );
    expect(
      matchingAdvancedDraft(
        { version: 1, updatedAt: 'now', input: draft, drafts: {} },
        'image.text-edit',
      )?.options.textReplacements?.[0]?.replaceText,
    ).toBe('新字');
    expect(
      matchingAdvancedDraft(
        { version: 1, updatedAt: 'now', input: draft, drafts: {} },
        'video.edit',
      ),
    ).toBeUndefined();
  });
  it('scans in bounded batches without treating a limited search as an empty draft', async () => {
    const requested: number[] = [];
    const read = async (page: number) => {
      requested.push(page);
      return {
        page,
        pageSize: 100,
        total: 501,
        items: page === 6 ? [{ createdAt: '2026-10-01', metadata: { draft } }] : [],
      };
    };
    const signal = new AbortController().signal;
    const first = await findAdvancedDraftBatch('image.text-edit', read, signal);
    expect(first).toMatchObject({ status: 'limited', nextPage: 5 });
    expect(requested).toEqual([1, 2, 3, 4]);
    const second = await findAdvancedDraftBatch('image.text-edit', read, signal, first.nextPage);
    expect(second.draft).toEqual(draft);
    expect(requested).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('does not accept a late page after cancellation and exposes invalid server drafts as failures', async () => {
    const controller = new AbortController();
    await expect(
      findAdvancedDraftBatch(
        'image.text-edit',
        async () => {
          controller.abort();
          return {
            page: 1,
            pageSize: 100,
            total: 1,
            items: [{ createdAt: 'now', metadata: { draft } }],
          };
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      findAdvancedDraftBatch(
        'image.text-edit',
        async () => ({
          page: 1,
          pageSize: 100,
          total: 1,
          items: [{ createdAt: 'now', metadata: { draft: { ...draft, assetIds: ['invalid'] } } }],
        }),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it('preserves unsupported provider/model/technical values and requires an explicit choice', () => {
    const operations = [
      {
        id: 'video.extend',
        name: 'Video',
        providerId: 'flyelep',
        available: true,
        reason: null,
        models: [
          { id: 'new-model', name: 'New', durations: [5], resolutions: ['720p'], ratios: [] },
        ],
        priceCredits: 1,
        unit: 'request' as const,
        liveVerified: false,
      },
    ];
    const missing = advancedParameterSelection(
      { providerId: 'old-provider', modelId: 'saved-model', duration: 10, resolution: '8K' },
      operations,
    );
    expect(missing.providerId).toBe('old-provider');
    expect(missing.modelId).toBe('saved-model');
    expect(missing.operation).toBeUndefined();
    const model = advancedParameterSelection(
      { providerId: 'flyelep', modelId: 'new-model', duration: 10, resolution: '8K' },
      operations,
    );
    expect(model.warnings).toHaveLength(2);
    expect(
      advancedParameterSelection(
        {
          operation: 'video.translate',
          providerId: '',
          modelId: '',
          duration: 5,
          resolution: '720p',
          language: 'unknown',
        },
        operations,
      ).warnings,
    ).toEqual(['保存的目标语言“unknown”当前不受支持，原值已保留。']);
    expect(
      advancedParameterSelection(
        {
          operation: 'video.upscale',
          providerId: '',
          modelId: '',
          duration: 5,
          resolution: '720p',
          scale: 3,
        },
        operations,
      ).warnings,
    ).toEqual(['保存的放大倍数“3”当前不受支持，原值已保留。']);
  });
  it('pins every project request to the original workspace and persists identity before leaving', async () => {
    const calls: [string, string][] = [];
    let active = true;
    let persisted = draft;
    const result = await saveAdvancedDraft(
      draft,
      { workspaceId: 'original-space', projectId: null, name: '改字', kind: 'image' },
      {
        request: async <T>(path: string, _init: RequestInit, wid: string) => {
          calls.push([path, wid]);
          active = false;
          return { id: 'created-project' } as T;
        },
        persist: (value) => {
          persisted = value;
        },
        isActive: () => active,
      },
    );
    expect(result).toEqual({ projectId: 'created-project', saved: false });
    expect(persisted.projectId).toBe('created-project');
    expect(calls).toEqual([['/projects', 'original-space']]);
  });
  it('writes the saved message with the project identity and leaves failed saves recoverable', async () => {
    const calls: [string, string][] = [];
    let persisted = draft;
    await expect(
      saveAdvancedDraft(
        draft,
        { workspaceId: 'original-space', projectId: null, name: '改字', kind: 'image' },
        {
          request: async <T>(path: string, _init: RequestInit, wid: string) => {
            calls.push([path, wid]);
            if (path.endsWith('/messages')) throw new Error('offline');
            return { id: 'created-project' } as T;
          },
          persist: (value) => {
            persisted = value;
          },
          isActive: () => true,
        },
      ),
    ).rejects.toThrow('offline');
    expect(persisted.projectId).toBe('created-project');
    expect(calls).toEqual([
      ['/projects', 'original-space'],
      ['/projects/created-project/messages', 'original-space'],
    ]);
  });
});

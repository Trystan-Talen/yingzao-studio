import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { jobInputSchema } from '../src/contracts/jobs';
import {
  draftStorageKey,
  latestMediaDraft,
  latestMediaDraftRecord,
  readDraft,
  writeDraft,
  restoreAssets,
  readPendingSubmissions,
  writePendingSubmission,
  removePendingSubmission,
  submissionWasRejected,
  type RecoveryStorage,
} from '../src/web/lib/creation-recovery';

function memory(): RecoveryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
const user = randomUUID(),
  workspace = randomUUID(),
  project = randomUUID();
const input = jobInputSchema.parse({
  operation: 'image.generate',
  providerId: 'openai',
  prompt: '尚未提交的主图',
  assetIds: [randomUUID(), randomUUID()],
  options: { ratio: '9:16', count: 3 },
});

describe('creation recovery boundaries', () => {
  it('recovers unacknowledged warnings after a legacy task message and respects explicit acknowledgement', () => {
    const messages = [
      {
        createdAt: '2026-10-16T01:00:00Z',
        metadata: { draft: input, creationWarnings: ['旧方案需要核对尺寸'] },
      },
      { createdAt: '2026-10-16T02:00:00Z', metadata: { draft: input } },
    ];
    expect(latestMediaDraftRecord(messages)?.metadata?.creationWarnings).toEqual([
      '旧方案需要核对尺寸',
    ]);
    messages.push({
      createdAt: '2026-10-16T03:00:00Z',
      metadata: { draft: input, creationWarnings: [] },
    });
    messages.push({ createdAt: '2026-10-16T04:00:00Z', metadata: { draft: input } });
    expect(latestMediaDraftRecord(messages)?.metadata?.creationWarnings).toEqual([]);
  });
  it('restores a complete draft after remount without crossing user/workspace/project boundaries', () => {
    const storage = memory();
    const key = draftStorageKey(user, workspace, project);
    writeDraft(storage, key, { input, drafts: { image: input } });
    expect(readDraft(storage, key).value?.input).toEqual(input);
    for (const other of [
      draftStorageKey(randomUUID(), workspace, project),
      draftStorageKey(user, randomUUID(), project),
      draftStorageKey(user, workspace, randomUUID()),
    ]) {
      expect(readDraft(storage, other).value).toBeNull();
    }
  });
  it('preserves unresolved plan warnings separately for image and video drafts', () => {
    const storage = memory(),
      key = draftStorageKey(user, workspace, project);
    const warnings = {
      image: ['方案建议 8K，当前模型不支持，仍使用 1K。'],
      video: ['画面文字由提示引导。'],
    };
    writeDraft(storage, key, { input, drafts: { image: input }, warnings });
    expect(readDraft(storage, key).value?.warnings).toEqual(warnings);
    writeDraft(storage, key, {
      input,
      drafts: { image: input },
      warnings: { ...warnings, image: [] },
    });
    expect(readDraft(storage, key).value?.warnings).toEqual({ ...warnings, image: [] });
  });
  it('keeps media inputs when a newer assistant or tool task is recorded', () => {
    const media = { createdAt: '2026-10-16T01:00:00Z', metadata: { draft: input } };
    const assistant = {
      createdAt: '2026-10-16T02:00:00Z',
      metadata: {
        draft: jobInputSchema.parse({
          operation: 'text.assist',
          providerId: 'openai',
          prompt: '帮我写',
        }),
      },
    };
    const tool = {
      createdAt: '2026-10-16T03:00:00Z',
      metadata: { draft: jobInputSchema.parse({ operation: 'local.resize', providerId: 'local' }) },
    };
    expect(latestMediaDraft([media, assistant, tool])).toEqual(input);
  });
  it('restores assets independently and preserves repeated first/last-frame references', async () => {
    const good = input.assetIds[0]!,
      missing = input.assetIds[1]!;
    const result = await restoreAssets([good, missing, good], async (id) => {
      if (id === missing) throw new Error('素材无权限');
      return { id, name: '首尾帧' };
    });
    expect(result.assets.map((a) => a.id)).toEqual([good, good]);
    expect(result.failures).toEqual([{ id: missing, message: '素材无权限' }]);
    expect(result.ready).toBe(false);
  });
  it('reports corrupt/blocked storage rather than reporting a saved empty draft', () => {
    const storage = memory(),
      key = draftStorageKey(user, workspace, project);
    storage.setItem(key, '{broken');
    expect(readDraft(storage, key).error).toBeTruthy();
    expect(readDraft(storage, key).value).toBeNull();
    const unavailable = {
      ...storage,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => writeDraft(unavailable, key, { input, drafts: {} })).toThrow();
  });
});

describe('confirmed submission journal', () => {
  const make = (scope: string) => ({
    version: 1 as const,
    scope,
    input,
    requestId: randomUUID(),
    confirmedAt: new Date().toISOString(),
    quote: {
      id: randomUUID(),
      inputHash: 'hash',
      pricingVersion: 'v1',
      maxCredits: 3,
      expiresAt: new Date().toISOString(),
      providerId: 'openai',
      operation: 'image.generate',
      units: 3,
    },
  });
  it('keeps exactly the original confirmed identity and snapshot across refresh, without dropping other submissions', () => {
    const storage = memory(),
      first = make('composer:new'),
      second = make('tool:resize');
    writePendingSubmission(storage, user, workspace, first);
    writePendingSubmission(storage, user, workspace, second);
    expect(readPendingSubmissions(storage, user, workspace).value).toEqual([first, second]);
    expect(readPendingSubmissions(storage, randomUUID(), workspace).value).toEqual([]);
    expect(readPendingSubmissions(storage, user, randomUUID()).value).toEqual([]);
    removePendingSubmission(storage, user, workspace, first.requestId);
    expect(readPendingSubmissions(storage, user, workspace).value).toEqual([second]);
  });
  it('refuses to overwrite an existing id with different input or quote', () => {
    const storage = memory(),
      pending = make('composer:new');
    writePendingSubmission(storage, user, workspace, pending);
    expect(() =>
      writePendingSubmission(storage, user, workspace, {
        ...pending,
        input: { ...input, prompt: 'another' },
      }),
    ).toThrow();
    expect(readPendingSubmissions(storage, user, workspace).value).toEqual([pending]);
  });
  it('releases explicitly rejected submissions but preserves unknown outcomes and identities that need reconciliation', () => {
    for (const error of [
      { status: 400, code: 'INPUT_COUNT' },
      { status: 409, code: 'QUOTE_EXPIRED' },
      { status: 409, code: 'RETRY_ALREADY_SUBMITTED' },
      { status: 404, code: 'NOT_FOUND' },
      { status: 503, code: 'CAPABILITY_UNAVAILABLE' },
    ])
      expect(submissionWasRejected(error)).toBe(true);
    for (const error of [
      { status: 0, code: 'NETWORK_ERROR' },
      { status: 202, code: 'INVALID_RESPONSE' },
      { status: 401, code: 'UNAUTHORIZED' },
      { status: 403, code: 'FORBIDDEN' },
      { status: 404, code: 'REQUEST_FAILED' },
      { status: 409, code: 'IDEMPOTENCY_CONFLICT' },
      { status: 500, code: 'INTERNAL_ERROR' },
      { status: 503, code: 'REQUEST_FAILED' },
    ])
      expect(submissionWasRejected(error)).toBe(false);
  });
});

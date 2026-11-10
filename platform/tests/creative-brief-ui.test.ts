import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CreativeBrief } from '../src/web/components/CreativeBrief';
import { CREATIVE_BRIEF_TRANSLATIONS } from '../src/web/lib/creative-brief-translations';
import { creativeInputFingerprint } from '../src/contracts/creative-fingerprint';
import type { CreativePreparation } from '../src/contracts/creative-intent';
import { jobInputSchema } from '../src/contracts/jobs';
import {
  advanceCreativeBrief,
  checkCreativePreparation,
  creativeAnswersComplete,
  creativeBriefStorageKey,
  readCreativeBrief,
  updateCreativeAnswer,
  writeCreativeBrief,
} from '../src/web/lib/creative-brief';

const input = jobInputSchema.parse({
  operation: 'image.generate',
  providerId: 'openai',
  prompt: '  一只在月球看海的猫，水彩画。  ',
});
const preparation = (status: CreativePreparation['status'] = 'ready'): CreativePreparation => {
  const id = randomUUID();
  return {
    id,
    status,
    input: { ...input, creativeBriefId: id },
    result: {
      type: 'intent-plan',
      version: 1,
      requestId: randomUUID(),
      status,
      brief: {
        scope: 'general',
        subject: '月球上的猫',
        goal: '通用创作',
        mediaType: 'image',
        platform: input.options.platform,
        placement: 'general',
        productMode: 'not-applicable',
        facts: [],
        constraints: [],
      },
      summary: '绘制月球上的猫。',
      assumptions: [],
      prompt: status === 'ready' ? '经过理解的执行提示' : '',
      reviewChecklist: [],
      questions:
        status === 'ready'
          ? []
          : [
              {
                id: 'subject',
                field: 'subject',
                question: '希望画什么？',
                reason: '需要主体。',
                options: ['猫', '狗'],
              },
            ],
    },
  };
};

describe('creative brief UI boundaries', () => {
  const renderBrief = (
    result: CreativePreparation,
    answers: { questionId: string; answer: string }[] = [],
    extra: Partial<Parameters<typeof CreativeBrief>[0]> = {},
  ) =>
    renderToStaticMarkup(
      createElement(CreativeBrief, {
        preparation: result,
        answers,
        busy: false,
        locked: false,
        canRestart: false,
        onRestart: () => undefined,
        onAnswer: () => undefined,
        mediaType: 'image',
        ...extra,
      }),
    );
  it('puts the full question and options first, without repeating the summary or opening explanations', () => {
    const result = preparation('needs_clarification');
    result.result.questions[0]!.question =
      '你要求不改商品外观，也要求删掉原有标识：这次要保留标识，还是明确允许删掉？';
    const html = renderBrief(result);
    expect(html).toContain('creative-brief-questions');
    expect(html).toContain(result.result.questions[0]!.question);
    expect(html).not.toContain(result.result.summary);
    expect(html).toContain('为什么需要确认？');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<details open');
    expect(html).not.toMatch(/<button[^>]*>[^<]*继续/);
  });
  it('keeps option answers compact, restores custom answers, and immediately offers a field for freeform questions', () => {
    const result = preparation('needs_clarification');
    const selected = renderBrief(result, [{ questionId: 'subject', answer: '猫' }]);
    expect(selected).toContain('aria-pressed="true"');
    expect(selected).not.toContain('<textarea');
    const custom = renderBrief(result, [{ questionId: 'subject', answer: 'a cat with no collar' }]);
    expect(custom).toContain('<textarea');
    expect(custom).toContain('a cat with no collar');
    result.result.questions[0]!.options = [];
    expect(renderBrief(result)).toContain('<textarea');
  });
  it('marks the actual missing question and exposes only relevant settings or reference navigation', () => {
    const result = preparation('needs_clarification');
    result.result.questions[0]!.field = 'reference';
    const reference = renderBrief(result, [], {
      missingQuestionId: 'subject',
      onAddReference: () => undefined,
      onEditSettings: () => undefined,
    });
    expect(reference).toContain('role="alert"');
    expect(reference).toContain('请先回答这一题。');
    expect(reference).toContain('添加参考图');
    expect(reference).not.toContain('修改相关设置');
    result.result.questions[0]!.field = 'conflict';
    const conflict = renderBrief(result, [], { onEditSettings: () => undefined });
    expect(conflict).toContain('修改相关设置');
    expect(conflict).not.toContain('添加参考图');
  });
  it('collapses ready details and preserves unknown-result recovery instead of offering a new request', () => {
    const ready = renderBrief(preparation());
    expect(ready).toContain('需求已整理，查看详情');
    expect(ready).not.toContain('open=""');
    const unknown = renderBrief(preparation('needs_clarification'), [], {
      locked: true,
      error: '请求结果未知，不能确认是否仍在运行。',
    });
    expect(unknown).toContain('核对同一次请求');
    expect(unknown).toContain('请求结果未知，不能确认是否仍在运行。');
    expect(unknown).not.toContain('>重新检查<');
  });
  it('provides reviewed English and Arabic copy for the new static clarification labels', () => {
    for (const text of ['确认这一点', '确认这两点', '自己填写', '请先回答这一题。']) {
      expect(CREATIVE_BRIEF_TRANSLATIONS[text]?.en).toBeTruthy();
      expect(CREATIVE_BRIEF_TRANSLATIONS[text]?.ar).toBeTruthy();
    }
  });
  it('accepts a bound server result while keeping the exact user wording', () => {
    const result = preparation();
    expect(checkCreativePreparation(result, input).input.prompt).toBe(input.prompt);
    expect(result.input.prompt).not.toBe(result.result.prompt);
    expect(() =>
      checkCreativePreparation(
        { ...result, input: { ...result.input, prompt: result.result.prompt } },
        input,
      ),
    ).toThrow();
    expect(() => checkCreativePreparation({ ...result, id: randomUUID() }, input)).toThrow();
    const projectId = randomUUID();
    const owned = { ...result, input: { ...result.input, projectId } };
    expect(() => checkCreativePreparation(owned, { ...input, projectId: randomUUID() })).toThrow();
    expect(checkCreativePreparation(result, { ...input, projectId }).id).toBe(result.id);
  });
  it('invalidates each changed creative condition, but not assigned identities or refreshed capability proofs', () => {
    const fingerprint = creativeInputFingerprint(input);
    for (const changed of [
      { ...input, prompt: '另一只猫' },
      { ...input, assetIds: [randomUUID()] },
      { ...input, referenceAssetIds: [randomUUID()] },
      { ...input, backgroundAudioAssetId: randomUUID() },
      { ...input, options: { ...input.options, platform: 'Amazon' } },
      { ...input, options: { ...input.options, creativePlacement: 'main-image' as const } },
      { ...input, options: { ...input.options, creativeMarket: 'US' } },
      { ...input, options: { ...input.options, ratio: '9:16' } },
    ])
      expect(creativeInputFingerprint(changed)).not.toBe(fingerprint);
    expect(
      creativeInputFingerprint({
        ...input,
        projectId: randomUUID(),
        documentId: randomUUID(),
        baseRevision: 2,
        creativeBriefId: randomUUID(),
        capabilityRevision: randomUUID(),
      }),
    ).toBe(fingerprint);
  });
  it('keeps pending request IDs and separate answers across storage recovery and account boundaries', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const fingerprint = creativeInputFingerprint(input);
    const key = creativeBriefStorageKey('user', 'workspace', fingerprint);
    const record = {
      version: 1 as const,
      fingerprint,
      previousId: randomUUID(),
      answers: [{ questionId: 'subject', answer: '一只猫' }],
      pending: { requestId: randomUUID(), answers: [{ questionId: 'subject', answer: '一只猫' }] },
    };
    writeCreativeBrief(storage, key, record);
    expect(readCreativeBrief(storage, key, fingerprint)).toEqual(record);
    for (const other of [
      creativeBriefStorageKey('other', 'workspace', fingerprint),
      creativeBriefStorageKey('user', 'other', fingerprint),
      creativeBriefStorageKey('user', 'workspace', fingerprint, randomUUID()),
    ])
      expect(readCreativeBrief(storage, other, fingerprint).pending).toBeUndefined();
    expect(() => readCreativeBrief(storage, key, 'different')).toThrow();
  });
  it('requires only returned questions and preserves multiword answers during editing', () => {
    const pending = preparation('needs_clarification');
    expect(creativeAnswersComplete(pending, [])).toBe(false);
    const answers = updateCreativeAnswer([], 'subject', 'a cat ');
    expect(answers[0]?.answer).toBe('a cat ');
    expect(creativeAnswersComplete(pending, answers)).toBe(true);
    expect(updateCreativeAnswer(answers, 'subject', '  ')).toEqual([]);
    expect(creativeAnswersComplete(preparation(), [])).toBe(true);
  });
  it('rejects extra questions and inconsistent ready states instead of generating through them', () => {
    const pending = preparation('needs_clarification');
    expect(() => checkCreativePreparation({ ...pending, status: 'ready' }, input)).toThrow();
    expect(() =>
      checkCreativePreparation(
        {
          ...pending,
          result: {
            ...pending.result,
            questions: [0, 1, 2].map((i) => ({
              ...pending.result.questions[0],
              id: `subject-${i}`,
            })),
          },
        },
        input,
      ),
    ).toThrow();
  });
  it('clears completed-round answers even when a follow-up repeats a question ID', () => {
    const first = preparation('needs_clarification');
    const second = preparation('needs_clarification');
    const record = {
      version: 1 as const,
      fingerprint: creativeInputFingerprint(input),
      previousId: first.id,
      answers: [{ questionId: 'subject', answer: '一只猫' }],
      pending: {
        requestId: second.result.requestId,
        previousId: first.id,
        answers: [{ questionId: 'subject', answer: '一只猫' }],
      },
    };
    const next = advanceCreativeBrief(record, second);
    expect(next.previousId).toBe(second.id);
    expect(next.pending).toBeUndefined();
    expect(creativeAnswersComplete(second, next.answers)).toBe(false);
    const thirdAnswers = updateCreativeAnswer(next.answers, 'subject', '一只橘猫');
    expect(thirdAnswers).toEqual([{ questionId: 'subject', answer: '一只橘猫' }]);
    const ready = advanceCreativeBrief({ ...next, answers: thirdAnswers }, preparation());
    expect(ready.answers).toEqual([]);
  });
});

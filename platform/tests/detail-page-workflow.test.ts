import { describe, expect, it } from 'vitest';
import { detailPagePlanSchema } from '../src/contracts/detail-page';
import { emptyDetailPageDraft, readDetailPageDraft } from '../src/web/lib/detail-page-draft';
import {
  defaultDetailPageEditor,
  detailPageBriefKey,
  detailPageFieldIssues,
  detailPageStepAvailable,
  isDetailPagePlanOutdated,
  readDetailPageEditor,
} from '../src/web/lib/detail-page-workflow';

const plan = detailPagePlanSchema.parse({
  productName: '陶瓷杯',
  productFacts: ['容量350毫升'],
  audience: '通勤人群',
  visualStyle: '自然光商品摄影',
  palette: ['米白'],
  consistencyNotes: '保持杯形',
  unknowns: [],
  screens: ['hero', 'detail'].map((id, index) => ({
    id,
    title: `第${index + 1}屏`,
    purpose: '说明已知卖点',
    copy: ['日常随行'],
    prompt: '完整展示杯体',
    ratio: '3:4',
  })),
});

describe('detail-page workflow navigation and draft recovery', () => {
  it('does not unlock review or generation before the prerequisites exist', () => {
    const empty = { hasPlan: false, hasPlanning: false, hasResult: false, readyToGenerate: false };
    expect([0, 1, 2].map((step) => detailPageStepAvailable(step as 0 | 1 | 2, empty))).toEqual([
      true,
      false,
      false,
    ]);
    expect(detailPageStepAvailable(1, { ...empty, hasPlanning: true })).toBe(true);
    expect(detailPageStepAvailable(2, { ...empty, hasPlan: true })).toBe(false);
    expect(detailPageStepAvailable(2, { ...empty, hasPlan: true, readyToGenerate: true })).toBe(
      true,
    );
  });
  it('keeps already submitted results reachable when the next draft is incomplete', () => {
    expect(
      detailPageStepAvailable(2, {
        hasPlan: true,
        hasPlanning: false,
        hasResult: true,
        readyToGenerate: false,
      }),
    ).toBe(true);
  });
  it('restores editing a new version instead of letting an old completed job force the result step', () => {
    const draft = {
      ...emptyDetailPageDraft(),
      plan,
      generationJobId: '0ad639bd-cdf3-413e-a066-cf339d834c98',
    };
    const editor = {
      ...defaultDetailPageEditor(draft),
      step: 1 as const,
      resultMode: 'draft' as const,
    };
    const storage = { getItem: () => JSON.stringify({ ...draft, editor }) };
    expect(readDetailPageEditor(storage, 'draft', draft)).toEqual(editor);
    expect(readDetailPageDraft(storage, 'draft').draft.generationJobId).toBe(draft.generationJobId);
    expect(readDetailPageDraft(storage, 'draft').draft.plan).toEqual(plan);
  });
  it('opens legacy drafts at the relevant step and ignores corrupt editor metadata', () => {
    const draft = { ...emptyDetailPageDraft(), plan };
    expect(
      readDetailPageEditor({ getItem: () => JSON.stringify(draft) }, 'draft', draft).step,
    ).toBe(1);
    expect(readDetailPageEditor({ getItem: () => '{bad' }, 'draft', draft).step).toBe(1);
    expect(
      readDetailPageEditor(
        {
          getItem: () => JSON.stringify({ editor: { ...defaultDetailPageEditor(draft), step: 9 } }),
        },
        'draft',
        draft,
      ).step,
    ).toBe(1);
  });
  it('does not restore a generation-only step without a plan or original job', () => {
    const draft = emptyDetailPageDraft();
    const storage = {
      getItem: () => JSON.stringify({ editor: { ...defaultDetailPageEditor(draft), step: 2 } }),
    };
    expect(readDetailPageEditor(storage, 'draft', draft).step).toBe(0);
  });
});

describe('detail-page brief provenance', () => {
  const brief = { brief: '白色陶瓷杯', screenCount: 6, ratio: '3:4' };
  const source = detailPageBriefKey(brief);
  it.each([
    { ...brief, brief: '黑色保温杯' },
    { ...brief, screenCount: 8 },
    { ...brief, ratio: '9:16' },
  ])('marks a changed input as needing a new plan or explicit retention: %j', (changed) => {
    expect(isDetailPagePlanOutdated(detailPageBriefKey(changed), source, null)).toBe(true);
  });
  it('requires a fresh retention choice after every further edit', () => {
    const accepted = detailPageBriefKey({ ...brief, brief: '新增要求' });
    expect(isDetailPagePlanOutdated(accepted, source, accepted)).toBe(false);
    expect(
      isDetailPagePlanOutdated(
        detailPageBriefKey({ ...brief, brief: '再次修改' }),
        source,
        accepted,
      ),
    ).toBe(true);
  });
  it('does not mark whitespace-only changes or unproven legacy provenance as outdated', () => {
    expect(
      isDetailPagePlanOutdated(
        detailPageBriefKey({ ...brief, brief: `  ${brief.brief}  ` }),
        source,
        null,
      ),
    ).toBe(false);
    expect(isDetailPagePlanOutdated(source, null, null)).toBe(false);
  });
});

describe('field-specific detail-page validation', () => {
  it('points to the exact screen and line for blank and overlong copy', () => {
    const invalid = structuredClone(plan);
    invalid.screens[1]!.title = '';
    invalid.screens[1]!.copy = ['', '字'.repeat(151)];
    const issues = detailPageFieldIssues(invalid);
    expect(issues).toHaveLength(3);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          screenId: 'detail',
          screenIndex: 1,
          field: 'title',
          label: '分屏标题',
        }),
        expect.objectContaining({
          screenId: 'detail',
          field: 'copy',
          label: '画面文案第 1 行',
          message: '请填写内容，不能只包含空格。',
        }),
        expect.objectContaining({
          screenId: 'detail',
          field: 'copy',
          label: '画面文案第 2 行',
          message: '最多 150 个字符，请缩短内容。',
        }),
      ]),
    );
  });
  it('distinguishes invalid shared direction fields from valid optional empty screen copy', () => {
    const invalid = structuredClone(plan);
    invalid.palette = [];
    invalid.productFacts = [''];
    invalid.screens[0]!.copy = [];
    expect(detailPageFieldIssues(invalid)).toEqual([
      expect.objectContaining({ field: 'productFacts', label: '商品事实第 1 行' }),
      expect.objectContaining({ field: 'palette', message: '至少填写 1 项。' }),
    ]);
    expect(detailPageFieldIssues(plan)).toEqual([]);
  });
});

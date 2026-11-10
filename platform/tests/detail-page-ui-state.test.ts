import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DetailPagePlanningNotice,
  DetailPageUnknowns,
} from '../src/web/components/DetailPageStatus';
import { describe, expect, it } from 'vitest';
import { detailPagePlanSchema } from '../src/contracts/detail-page';
import { jobInputSchema } from '../src/contracts/jobs';
import {
  detailPageDraftKey,
  emptyDetailPageDraft,
  readDetailPageDraft,
  updateDetailPageScreen,
  RECOVERED_DETAIL_PLAN_NOTE,
  recoveredDetailPagePlan,
  adoptRecoveredDetailPagePlan,
} from '../src/web/lib/detail-page-draft';

const plan = detailPagePlanSchema.parse({
  productName: '陶瓷杯',
  productFacts: ['容量 350ml'],
  audience: '通勤人群',
  visualStyle: '自然光',
  palette: ['米白'],
  consistencyNotes: '保持杯形与颜色',
  unknowns: ['确认杯盖材质'],
  screens: [
    {
      id: 'hero',
      title: '首屏',
      purpose: '介绍商品',
      copy: ['日常随行'],
      prompt: '完整展示杯体',
      ratio: '3:4',
    },
    {
      id: 'features',
      title: '细节',
      purpose: '展示材质',
      copy: [],
      prompt: '展示杯身表面',
      ratio: '3:4',
    },
  ],
});

describe('detail-page editing and recovery', () => {
  it('recovers unfinished edits without treating them as a valid generation plan', () => {
    const draft = {
      ...emptyDetailPageDraft(),
      plan: {
        ...plan,
        screens: plan.screens.map((screen, index) =>
          index === 0 ? { ...screen, purpose: '' } : screen,
        ),
      },
    };
    const recovered = readDetailPageDraft({ getItem: () => JSON.stringify(draft) }, 'draft');
    expect(recovered.error).toBeNull();
    expect(recovered.draft.plan?.screens[0]?.purpose).toBe('');
    expect(detailPagePlanSchema.safeParse(recovered.draft.plan).success).toBe(false);
  });
  it('does not silently accept corrupted browser storage as an empty saved draft', () => {
    const recovered = readDetailPageDraft({ getItem: () => '{corrupted' }, 'draft');
    expect(recovered.error).toContain('暂时无法恢复');
    expect(recovered.draft.plan).toBeNull();
  });
  it('separates user, workspace and project draft scopes', () => {
    const keys = [
      detailPageDraftKey('user1', 'space1'),
      detailPageDraftKey('user2', 'space1'),
      detailPageDraftKey('user1', 'space2'),
      detailPageDraftKey('user1', 'space1', 'project1'),
    ];
    expect(new Set(keys).size).toBe(4);
  });
  it('changes one screen immutably and preserves its stable result identifier', () => {
    const updated = updateDetailPageScreen(plan, 'hero', { title: '新的首屏', id: 'changed-id' });
    expect(updated.screens[0]?.title).toBe('新的首屏');
    expect(updated.screens[0]?.id).toBe('hero');
    expect(plan.screens[0]?.title).toBe('首屏');
    expect(updated.screens[1]).toBe(plan.screens[1]);
  });
  it('recovers task ids and image references so a reload can query the original jobs', () => {
    const saved = {
      ...emptyDetailPageDraft(),
      projectId: 'db4b7b26-8121-4edc-b988-b45654db16d0',
      planningJobId: 'f1dc920b-d038-41a0-97a9-30b83d04d4e1',
      generationJobId: '0ad639bd-cdf3-413e-a066-cf339d834c98',
      referenceAssetIds: ['f4e8e8d9-8ae3-42fb-9614-f177b5ab3881'],
      plan,
    };
    expect(readDetailPageDraft({ getItem: () => JSON.stringify(saved) }, 'draft').draft).toEqual(
      saved,
    );
  });
});

describe('explicit adoption of locally recovered planning output', () => {
  const projectId = 'db4b7b26-8121-4edc-b988-b45654db16d0';
  const messageId = 'fa33735c-df89-467a-851c-41886f10b914';
  function message() {
    return {
      id: messageId,
      role: 'user',
      createdAt: '2026-10-30T08:00:00.000Z',
      metadata: {
        creationWarnings: [RECOVERED_DETAIL_PLAN_NOTE],
        draft: jobInputSchema.parse({
          operation: 'image.generate',
          providerId: 'openai',
          projectId,
          prompt: '本机恢复原策划',
          options: { detailPagePlan: plan },
        }),
      },
    };
  }
  it('requires both a current-project match and the explicit recovery provenance', () => {
    expect(recoveredDetailPagePlan([message()], projectId)?.messageId).toBe(messageId);
    expect(recoveredDetailPagePlan([message()], 'different-project')).toBeNull();
    const unmarked = message();
    unmarked.metadata.creationWarnings = [];
    expect(recoveredDetailPagePlan([unmarked], projectId)).toBeNull();
    expect(recoveredDetailPagePlan([{ ...message(), role: 'assistant' }], projectId)).toBeNull();
  });
  it('rejects malformed plans and a screen count or ratio inconsistent with the original request', () => {
    const invalid = message();
    invalid.metadata.draft.options.detailPagePlan!.screens[0]!.purpose = '';
    expect(recoveredDetailPagePlan([invalid], projectId)).toBeNull();
    expect(recoveredDetailPagePlan([message()], projectId, { screenCount: 6 })).toBeNull();
    expect(
      recoveredDetailPagePlan([message()], projectId, { screenCount: 2, ratio: '9:16' }),
    ).toBeNull();
  });
  it('preserves all fourteen original unknowns under the repaired strict schema', () => {
    const recovered = message();
    recovered.metadata.draft.options.detailPagePlan!.unknowns = Array.from(
      { length: 14 },
      (_, index) => `待核对事实 ${index + 1}`,
    );
    expect(recoveredDetailPagePlan([recovered], projectId)?.plan.unknowns).toEqual(
      recovered.metadata.draft.options.detailPagePlan!.unknowns,
    );
  });
  it('adopts only a draft, retains the failed task id, and requires new screen confirmation', () => {
    const failedJobId = 'f1dc920b-d038-41a0-97a9-30b83d04d4e1';
    const draft = {
      ...emptyDetailPageDraft(),
      projectId,
      planningJobId: failedJobId,
      adoptedPlanningJobId: failedJobId,
      plan,
      confirmedScreens: ['hero', 'features'],
      factsConfirmed: true,
    };
    const adopted = adoptRecoveredDetailPagePlan(
      draft,
      recoveredDetailPagePlan([message()], projectId)!,
    );
    expect(adopted.planningJobId).toBe(failedJobId);
    expect(adopted.adoptedPlanningJobId).toBeUndefined();
    expect(adopted.recoveredPlanMessageId).toBe(messageId);
    expect(adopted.confirmedScreens).toEqual([]);
    expect(adopted.factsConfirmed).toBe(false);
    expect(draft.factsConfirmed).toBe(true);
    expect(adopted.generationJobId).toBeUndefined();
  });
  it('persists the recovery source marker across a page reload', () => {
    const adopted = adoptRecoveredDetailPagePlan(
      emptyDetailPageDraft(),
      recoveredDetailPagePlan([message()], projectId)!,
    );
    expect(
      readDetailPageDraft({ getItem: () => JSON.stringify(adopted) }, 'draft').draft
        .recoveredPlanMessageId,
    ).toBe(messageId);
  });
});

describe('recovered plan history versus current image progress', () => {
  const originalFailure = '商品详情页策划工作流执行失败或已停止，未提交图片生成';
  it('keeps the original failure actionable before a recovery has been adopted', () => {
    const markup = renderToStaticMarkup(
      createElement(DetailPagePlanningNotice, {
        recovered: false,
        failed: true,
        hasGeneration: false,
        failureMessage: originalFailure,
      }),
    );
    expect(markup).toContain('策划暂未完成');
    expect(markup).toContain(originalFailure);
  });
  it('does not contradict an existing image task after recovery', () => {
    const markup = renderToStaticMarkup(
      createElement(DetailPagePlanningNotice, {
        recovered: true,
        failed: true,
        hasGeneration: true,
        failureMessage: originalFailure,
      }),
    );
    expect(markup).toContain('已采用修复校验后的原方案');
    expect(markup).toContain('原策划失败记录已保留');
    expect(markup).not.toContain('策划暂未完成');
    expect(markup).not.toContain('未提交图片生成');
    expect(markup).not.toContain('图片生成仍需另行确认报价');
  });
  it('does not replay a no-image-submission claim for an existing image job without a recovery marker either', () => {
    const markup = renderToStaticMarkup(
      createElement(DetailPagePlanningNotice, {
        recovered: false,
        failed: true,
        hasGeneration: true,
        failureMessage: originalFailure,
      }),
    );
    expect(markup).toContain('原策划运行未完成');
    expect(markup).toContain('已提交的图片任务独立展示');
    expect(markup).not.toContain('未提交图片生成');
  });
  it('retains an explicit pricing reminder until image generation is actually submitted', () => {
    const markup = renderToStaticMarkup(
      createElement(DetailPagePlanningNotice, {
        recovered: true,
        failed: true,
        hasGeneration: false,
      }),
    );
    expect(markup).toContain('图片生成仍需另行确认报价');
    expect(markup).not.toContain('策划暂未完成');
  });
  it('keeps all unknowns inspectable but collapsed during and after image generation', () => {
    const unknowns = Array.from({ length: 14 }, (_, index) => `仍需核对的事实 ${index + 1}`);
    const markup = renderToStaticMarkup(
      createElement(DetailPageUnknowns, { unknowns, expanded: false }),
    );
    expect(markup).toContain('待核对信息');
    expect(markup).toContain('14');
    expect(markup).not.toContain('open=');
    expect(markup.match(/<li>/g)).toHaveLength(14);
    expect(markup).toContain('图片生成完成不代表商品事实已经确认');
    expect(
      renderToStaticMarkup(createElement(DetailPageUnknowns, { unknowns, expanded: true })),
    ).toContain('open=');
  });
});

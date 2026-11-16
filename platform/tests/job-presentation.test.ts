/** Deterministic display contracts only; no browser, runtime database or model requests. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  jobInputSchema,
  type JobDto,
  type JobItemDto,
  type JobStatus,
} from '../src/contracts/jobs';
import { JobProgress } from '../src/web/components/JobProgress';
import { setLocale } from '../src/web/lib/i18n';
import {
  elapsedJobSeconds,
  elapsedLabel,
  presentJob,
  mergeJobSnapshots,
  jobInputSummary,
} from '../src/web/lib/job-presentation';

const createdAt = '2026-10-29T12:00:00.000Z';
const currentTime = Date.parse('2026-10-29T12:02:03.000Z');

describe('submission snapshot summaries', () => {
  it('collapses whitespace and bounds a normal prompt without splitting a Unicode character', () => {
    const input = jobInputSchema.parse({
      operation: 'image.generate',
      providerId: 'openai',
      prompt: `  商品\n\t展示  ${'🌿'.repeat(120)}  `,
    });
    const summary = jobInputSummary(input);
    expect(summary).toBe(`商品 展示 ${'🌿'.repeat(94)}…`);
    expect(Array.from(summary)).toHaveLength(101);
    expect(input.prompt).toContain('\n\t');
  });

  it('provides a concise fallback for a blank description', () => {
    expect(
      jobInputSummary(
        jobInputSchema.parse({
          operation: 'image.generate',
          providerId: 'openai',
          prompt: ' \n  ',
        }),
      ),
    ).toBe('创作任务');
  });
});

function job(overrides: Partial<JobDto> = {}, itemOverrides: Partial<JobItemDto> = {}): JobDto {
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: '隔离任务展示测试',
  });
  return {
    id: 'fixture-job',
    workspaceId: 'fixture-workspace',
    projectId: null,
    createdBy: 'fixture-user',
    isArchived: false,
    downloadedAt: null,
    operation: input.operation,
    providerId: input.providerId,
    prompt: input.prompt,
    status: 'running',
    stage: '请求模型服务',
    requestedCredits: 8,
    settledCredits: 0,
    createdAt,
    updatedAt: '2026-10-29T12:01:00.000Z',
    errorMessage: null,
    input,
    outputAssets: [],
    items: [
      {
        id: 'fixture-item',
        index: 0,
        status: 'running',
        assetId: null,
        assetIds: [],
        outputKind: 'single',
        remoteId: null,
        errorMessage: null,
        resultText: null,
        phase: 'submitting',
        recoveryAttempts: 0,
        nextRetryAt: null,
        canResume: false,
        ...itemOverrides,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  setLocale('zh-CN');
  vi.spyOn(Date, 'now').mockReturnValue(currentTime);
});
afterEach(() => {
  vi.restoreAllMocks();
  setLocale('zh-CN');
});

describe('server-confirmed task progress', () => {
  it('shows a queued request as accepted without claiming model progress', () => {
    expect(
      presentJob(
        job({ status: 'queued', stage: '等待执行' }, { status: 'queued', phase: 'queued' }),
      ),
    ).toMatchObject({
      title: '任务已提交，等待执行器',
      description: '已保存在本机队列，尚未开始生成。无需重复提交。',
      step: 0,
      tone: 'active',
      animated: true,
      canResume: false,
    });
  });

  it('does not call a pending submission generated, saved or safely resumable', () => {
    const result = presentJob(
      job(
        { status: 'reconciliation_required' },
        { status: 'reconciliation_required', phase: 'submitting' },
      ),
    );
    expect(result).toMatchObject({
      title: '执行结果需要核对',
      step: null,
      tone: 'warning',
      animated: false,
      canResume: false,
    });
    expect(result.description).toContain('避免重复生成');
    expect(result.title).not.toMatch(/已生成|已保存|已完成/);
  });

  it('treats a returned download as unvalidated content until storage completes', () => {
    const result = presentJob(job({ stage: '保存原始产物' }, { phase: 'downloading' }));
    expect(result).toMatchObject({
      title: '已收到生成结果，正在保存',
      step: 2,
      animated: true,
      tone: 'active',
    });
    expect(result.description).toContain('校验');
    expect(result.title).not.toContain('作品已生成');
    expect(result.title).not.toContain('作品已保存');
  });

  it('distinguishes an automatic save retry from ongoing model generation', () => {
    const result = presentJob(
      job(
        { stage: '保存原始产物' },
        {
          phase: 'downloading',
          recoveryAttempts: 2,
          nextRetryAt: '2026-10-29T12:02:10.000Z',
          errorMessage: '暂时无法获取结果，稍后自动恢复',
        },
      ),
    );
    expect(result).toMatchObject({
      title: '连接中断，正在恢复保存',
      step: 2,
      tone: 'warning',
      animated: true,
      canResume: false,
    });
    expect(result.description).toContain('无需重新提交');
  });

  it('offers restoring an existing download without claiming a validated artifact', () => {
    const result = presentJob(
      job(
        { status: 'reconciliation_required' },
        {
          status: 'reconciliation_required',
          phase: 'downloading',
          canResume: true,
          recoveryAttempts: 10,
          errorMessage: '下载原件失败',
        },
      ),
    );
    expect(result).toMatchObject({
      title: '已收到生成结果，保存已暂停',
      step: 2,
      tone: 'warning',
      animated: false,
      canResume: true,
      resumeLabel: '恢复保存作品',
    });
    expect(result.description).toContain('不会再次调用模型');
    expect(result.title).not.toContain('作品已生成');
  });

  it('offers querying the original remote task separately from saving an output', () => {
    const result = presentJob(
      job(
        { status: 'reconciliation_required' },
        {
          status: 'reconciliation_required',
          phase: 'polling',
          remoteId: 'fixture-remote',
          canResume: true,
        },
      ),
    );
    expect(result).toMatchObject({
      title: '任务已受理，查询已暂停',
      step: 1,
      tone: 'warning',
      animated: false,
      canResume: true,
      resumeLabel: '继续查询结果',
    });
    expect(result.description).toContain('不会创建新的生成任务');
    expect(result.title).not.toMatch(/生成结果|作品已生成|保存/);
  });

  it('shows an interrupted remote query as a query retry rather than resubmission', () => {
    expect(
      presentJob(
        job(
          {},
          {
            phase: 'polling',
            remoteId: 'fixture-remote',
            recoveryAttempts: 1,
            nextRetryAt: '2026-10-29T12:02:10.000Z',
          },
        ),
      ),
    ).toMatchObject({
      title: '连接中断，正在恢复查询',
      step: 1,
      tone: 'warning',
      animated: true,
      canResume: false,
    });
  });

  it('does not infer connection failure from a healthy asynchronous task', () => {
    expect(presentJob(job({}, { phase: 'polling', remoteId: 'fixture-remote' }))).toMatchObject({
      title: '任务已受理，正在查询进度',
      step: 1,
      tone: 'active',
      animated: true,
      canResume: false,
    });
  });

  it('labels local processing without pretending to call a model', () => {
    expect(
      presentJob(job({ providerId: 'local', operation: 'image.crop' }, { phase: 'submitting' })),
    ).toMatchObject({ title: '正在处理素材', step: 1, animated: true });
  });

  it.each(['image.generate', 'video.generate'])(
    'shows only terminal %s success as saved',
    (operation) => {
      const result = presentJob(
        job({ status: 'succeeded', operation }, { status: 'succeeded', phase: 'done' }),
      );
      expect(result).toMatchObject({
        title: '作品已保存',
        step: 3,
        tone: 'success',
        animated: false,
        canResume: false,
      });
      expect(result.description).not.toContain('当前项目');
    },
  );

  it('distinguishes a text plan from a generated media artifact', () => {
    expect(
      presentJob(
        job(
          { status: 'succeeded', operation: 'text.assist' },
          { status: 'succeeded', phase: 'done' },
        ),
      ),
    ).toMatchObject({ title: '创作建议已就绪', step: 3, tone: 'success', animated: false });
  });

  it.each<{ status: JobStatus; title: string; tone: string }>([
    { status: 'failed', title: '这次创作未完成', tone: 'error' },
    { status: 'partial', title: '部分作品已完成', tone: 'warning' },
    { status: 'cancelled', title: '任务已取消', tone: 'neutral' },
  ])('does not animate terminal $status as continuing generation', ({ status, title, tone }) => {
    expect(
      presentJob(
        job({ status }, { status: status === 'partial' ? 'failed' : status, phase: 'done' }),
      ),
    ).toMatchObject({ title, tone, animated: false, step: null, canResume: false });
  });
});

describe('elapsed time and accessible progress are not invented percentages', () => {
  it('reports wall-clock waiting time independently of the returned model phase', () => {
    expect(elapsedJobSeconds(createdAt, currentTime)).toBe(123);
    expect(elapsedLabel(123)).toBe('02:03');
    expect(elapsedLabel(3600)).toBe('60:00');
    expect(elapsedJobSeconds(createdAt, Date.parse(createdAt) - 1000)).toBe(0);
    expect(elapsedJobSeconds('invalid-date', currentTime)).toBeNull();
    expect(elapsedJobSeconds(createdAt, Number.NaN)).toBeNull();
  });

  it.each(['submitting', 'polling', 'downloading'])(
    'renders %s without a fabricated numeric progress value',
    (phase) => {
      const html = renderToStaticMarkup(createElement(JobProgress, { job: job({}, { phase }) }));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('02:03');
      expect(html).not.toContain('aria-valuenow');
      expect(html).not.toMatch(/\d+%/);
    },
  );

  it.each<JobStatus>(['succeeded', 'failed', 'partial', 'cancelled'])(
    'does not keep a live waiting clock after $status',
    (status) => {
      const terminal = job(
        { status },
        { status: status === 'partial' ? 'failed' : status, phase: 'done' },
      );
      const before = renderToStaticMarkup(createElement(JobProgress, { job: terminal }));
      vi.mocked(Date.now).mockReturnValue(currentTime + 60_000);
      const after = renderToStaticMarkup(createElement(JobProgress, { job: terminal }));
      expect(before).toBe(after);
      expect(before).not.toContain('result-elapsed');
      expect(before).not.toContain('is-working');
      expect(before).not.toContain('aria-valuenow');
    },
  );
});

describe('overlapping task snapshots', () => {
  it('keeps one newest task when separate status requests straddle a transition', () => {
    const queued = job({ status: 'queued', updatedAt: '2026-10-29T12:00:00.000Z' });
    const running = job({ status: 'running', updatedAt: '2026-10-29T12:01:00.000Z' });
    expect(mergeJobSnapshots([running], [queued])).toEqual([running]);
    expect(mergeJobSnapshots([queued], [running])).toEqual([running]);
  });
  it('shows a newer resume response while preserving unrelated tasks', () => {
    const paused = job({ status: 'reconciliation_required' }, { canResume: true });
    const resumed = job(
      { status: 'running', updatedAt: '2026-10-29T12:02:00.000Z' },
      { phase: 'downloading', canResume: false },
    );
    const other = job({ id: 'another-task' });
    expect(mergeJobSnapshots([paused, other], [resumed])).toEqual([resumed, other]);
  });
  it('lets a confirmed response replace equally dated cached evidence', () => {
    const cached = job({ status: 'reconciliation_required' });
    const confirmed = job({ status: 'running' });
    expect(mergeJobSnapshots([cached], [confirmed])).toEqual([confirmed]);
  });
  it('keeps successful media feedback compact without a historical stepper', () => {
    const markup = renderToStaticMarkup(
      createElement(JobProgress, {
        job: job({ status: 'succeeded' }, { status: 'succeeded', phase: 'done' }),
      }),
    );
    expect(markup).toContain('作品已保存');
    expect(markup).not.toContain('result-steps');
    expect(markup).not.toContain('result-elapsed');
  });
});

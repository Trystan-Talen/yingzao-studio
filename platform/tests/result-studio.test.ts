/** Presentation regressions only. No browser, database or provider is contacted. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AssetDto } from '../src/contracts/core';
import { jobInputSchema, type JobDto, type JobItemDto } from '../src/contracts/jobs';
import { JobCard } from '../src/web/components/TaskCenter';

vi.mock('../src/web/context', () => ({
  useStudio: () => ({
    canEdit: true,
    isAdmin: false,
    session: { user: { id: 'test-user', preferences: {} } },
    workspace: { id: 'test-workspace' },
  }),
}));
vi.mock('../src/web/lib/api', async (original) => ({
  ...(await original<typeof import('../src/web/lib/api')>()),
  useApi: () => ({ data: undefined, error: null, isLoading: false, refetch: vi.fn() }),
  useRefresh: () => async () => undefined,
}));

const image: AssetDto = {
  id: 'saved-artwork',
  workspaceId: 'test-workspace',
  projectId: 'test-project',
  name: '真实原件.png',
  kind: 'image',
  extractionStatus: 'not-applicable',
  mimeType: 'image/png',
  byteSize: 1200,
  width: 720,
  height: 1280,
  durationMs: null,
  source: 'generation',
  sourceJobId: 'test-job',
  tags: [],
  isFavorite: false,
  originalUrl: '/media/original.png',
  previewUrl: '/media/preview.png',
  thumbnailUrl: null,
  createdBy: 'test-user',
  createdAt: '2026-11-04T12:00:00Z',
  updatedAt: '2026-11-04T12:00:00Z',
  deletedAt: null,
};
function job(overrides: Partial<JobDto> = {}): JobDto {
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: '保留原话与参考',
  });
  return {
    id: 'test-job',
    workspaceId: 'test-workspace',
    projectId: 'test-project',
    createdBy: 'test-user',
    isArchived: false,
    downloadedAt: null,
    operation: input.operation,
    providerId: input.providerId,
    prompt: input.prompt,
    input,
    status: 'succeeded',
    stage: '已完成',
    requestedCredits: 4,
    settledCredits: 4,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
    errorMessage: null,
    outputAssets: [image],
    items: [],
    ...overrides,
  };
}
function render(record: JobDto) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(JobCard, { job: record, onAcceptAsset: vi.fn() }),
    ),
  );
}

describe('result presentation retains actionable evidence', () => {
  it('places the saved artwork and original-download action before the collapsed description', () => {
    const html = render(job());
    const description = html.indexOf('<details class="result-description">');
    expect(description).toBeGreaterThan(0);
    expect(html.indexOf('src="/media/preview.png"')).toBeLessThan(description);
    expect(html.indexOf('下载原件')).toBeLessThan(description);
    expect(html.indexOf('作为参考')).toBeLessThan(description);
    expect(html).toContain('保留原话与参考');
    expect(html).not.toContain('creation-card');
    expect(html).not.toContain('result-progress');
  });

  it('plays the actual original video with native controls, without autoplay or replacing it with a thumbnail', () => {
    const video = {
      ...image,
      kind: 'video' as const,
      mimeType: 'video/mp4',
      originalUrl: '/media/original.mp4',
      durationMs: 5042,
    };
    const html = render(job({ operation: 'video.generate', outputAssets: [video] }));
    expect(html).toMatch(
      /<video[^>]*src="\/media\/original.mp4"[^>]*controls=""[^>]*preload="metadata"[^>]*playsInline=""/,
    );
    expect(html).not.toContain('autoPlay');
    expect(html).toContain('下载原件');
  });

  it('keeps the full saving failure and original-task recovery visible outside collapsed details', () => {
    const error = `保存原件中断：${'待继续获取已有结果。'.repeat(30)}`;
    const item = {
      status: 'reconciliation_required',
      phase: 'downloading',
      canResume: true,
      retryable: false,
      errorMessage: error,
    } as JobItemDto;
    const html = render(
      job({
        status: 'reconciliation_required',
        outputAssets: [],
        errorMessage: error,
        items: [item],
      }),
    );
    expect(html).toContain(error);
    expect(html).toContain('已收到生成结果，保存已暂停');
    expect(html).toContain('恢复保存作品');
    const afterProgress = html.slice(html.indexOf('</details>') + 10);
    expect(afterProgress.indexOf(error)).toBeLessThan(afterProgress.indexOf('<details'));
    expect(afterProgress.indexOf('恢复保存作品')).toBeLessThan(afterProgress.indexOf('<details'));
    expect(html).toContain('沿用原任务，不会再次生成');
    expect(html).not.toContain('下载原件');
  });

  it('does not present an uncertain provider result as complete or offer a new generation action', () => {
    const html = render(
      job({
        status: 'reconciliation_required',
        outputAssets: [],
        errorMessage: '供应商结果尚未确认',
      }),
    );
    expect(html).toContain('执行结果需要核对');
    expect(html).toContain('避免重复生成');
    expect(html).toContain('供应商结果尚未确认');
    expect(html).not.toContain('下载原件');
    expect(html).not.toContain('为可重试项重新估价');
  });

  it('preserves a partial saved result and its error alongside the download action', () => {
    const html = render(job({ status: 'partial', errorMessage: '第二项生成失败，首项已保存' }));
    expect(html).toContain('部分作品已完成');
    expect(html).toContain('第二项生成失败，首项已保存');
    expect(html).toContain('src="/media/preview.png"');
    expect(html).toContain('下载原件');
  });
});

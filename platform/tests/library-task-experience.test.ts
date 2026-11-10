import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetDto, ProjectDto } from '../src/contracts/core';
import { jobInputSchema, type JobDto } from '../src/contracts/jobs';
import {
  readTaskLocation,
  writeTaskLocation,
  TaskList,
  JobCard,
} from '../src/web/components/TaskCenter';
import { Assets, Projects } from '../src/web/pages/Library';

const fixture = vi.hoisted(() => ({
  responses: new Map<string, unknown>(),
  reads: [] as string[],
  canEdit: true,
}));
vi.mock('../src/web/context', () => ({
  useStudio: () => ({
    canEdit: fixture.canEdit,
    isAdmin: false,
    session: { user: { id: 'user-one', preferences: {} } },
    workspace: { id: 'space-one' },
  }),
}));
vi.mock('../src/web/lib/api', async (original) => ({
  ...(await original<typeof import('../src/web/lib/api')>()),
  useApi: (path: string, enabled = true) => {
    if (enabled) fixture.reads.push(path);
    return {
      data: enabled ? fixture.responses.get(path) : undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useRefresh: () => async () => undefined,
}));

const asset = (overrides: Partial<AssetDto> = {}): AssetDto => ({
  id: 'old-cover',
  workspaceId: 'space-one',
  projectId: 'project-one',
  name: '商品图片',
  kind: 'image',
  extractionStatus: 'not-applicable',
  mimeType: 'image/png',
  byteSize: 1200,
  width: 768,
  height: 1024,
  durationMs: null,
  source: 'generation',
  sourceJobId: 'job-one',
  tags: [],
  isFavorite: false,
  originalUrl: '/media/original.png',
  previewUrl: '/media/preview.png',
  thumbnailUrl: null,
  createdBy: 'user-one',
  createdAt: '2026-10-30T12:00:00Z',
  updatedAt: '2026-10-30T12:00:00Z',
  deletedAt: null,
  ...overrides,
});
const page = <T>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 24 });
function render(node: ReturnType<typeof createElement>, location = '/tasks') {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [location] }, node));
}
beforeEach(() => {
  fixture.responses.clear();
  fixture.reads.length = 0;
  fixture.canEdit = true;
  fixture.responses.set('/projects?pageSize=100', page([]));
  fixture.responses.set('/members?pageSize=100', page([]));
  fixture.responses.set('/capabilities', { operations: [] });
  fixture.responses.set('/collections?pageSize=100', page([]));
});

describe('task history bookmarks', () => {
  it('restores filters and the requested page without replacing the selected job', () => {
    const params = new URLSearchParams(
      'job=job-one&q=白杯&status=failed&projectId=project-one&page=4&archived=true&downloaded=false',
    );
    const state = readTaskLocation(params);
    expect(state.page).toBe(4);
    expect(state.filters).toMatchObject({
      q: '白杯',
      status: 'failed',
      projectId: 'project-one',
      archived: 'true',
      downloaded: 'false',
    });
    const changed = writeTaskLocation(params, { ...state.filters, status: 'running' });
    expect(changed.get('job')).toBe('job-one');
    expect(changed.get('status')).toBe('running');
    expect(changed.has('page')).toBe(false);
  });

  it('clears only filter fields and leaves the focused job intact', () => {
    const initial = readTaskLocation(new URLSearchParams()).filters;
    const cleared = writeTaskLocation(
      new URLSearchParams('job=job-one&status=failed&q=杯&page=8&return=project'),
      initial,
    );
    expect(cleared.toString()).toBe('job=job-one&return=project');
  });

  it.each(['2026-99-01', '2026-02-30', 'not-a-date', '2026-10-30T00:00:00Z'])(
    'rejects a malformed or impossible bookmark date: %s',
    (date) => {
      const parsed = readTaskLocation(
        new URLSearchParams({ from: date, to: date, page: 'NaN', status: 'unknown' }),
      );
      expect(parsed).toMatchObject({ page: 1, filters: { from: '', to: '', status: '' } });
      expect(() =>
        render(
          createElement(TaskList, { syncUrl: true }),
          `/tasks?from=${encodeURIComponent(date)}`,
        ),
      ).not.toThrow();
    },
  );

  it('rejects a reversed date range without losing the valid starting day', () => {
    const parsed = readTaskLocation(new URLSearchParams('from=2026-10-30&to=2026-10-01&page=-2'));
    expect(parsed).toMatchObject({ page: 1, filters: { from: '2026-10-30', to: '' } });
  });

  it('issues the same filtered history read when opening or refreshing a bookmark', () => {
    const location = '/tasks?status=failed&q=白杯&page=3&from=2026-10-01';
    for (let visit = 0; visit < 2; visit++) {
      const html = render(createElement(TaskList, { syncUrl: true }), location);
      expect(html).toContain('value="白杯"');
      expect(html).toContain('当前筛选');
      const path = fixture.reads.filter((value) => value.startsWith('/jobs?')).at(-1)!;
      const query = new URLSearchParams(path.split('?')[1]);
      expect(query.get('status')).toBe('failed');
      expect(query.get('q')).toBe('白杯');
      expect(query.get('page')).toBe('3');
      expect(query.get('from')).toMatch(/^2026-10-0[12]T/);
    }
  });

  it('keeps drawer filters independent from the page query', () => {
    render(createElement(TaskList), '/projects?status=failed&page=9&q=project');
    const path = fixture.reads.find((value) => value.startsWith('/jobs?'))!;
    const query = new URLSearchParams(path.split('?')[1]);
    expect(query.get('status')).toBeNull();
    expect(query.get('q')).toBeNull();
    expect(query.get('page')).toBe('1');
  });
});

describe('library continuation and discovery', () => {
  it('provides a reference handoff for images while preserving the original-download control', () => {
    fixture.responses.set('/assets?page=1', page([asset({ id: 'image/with space' })]));
    const html = render(createElement(Assets), '/assets');
    expect(html).toContain('href="/workbench?kind=image&amp;asset=image%2Fwith%20space"');
    expect(html).toContain('作为参考');
    expect(html).toContain('下载原件');
    expect(html).toContain('收藏素材');
  });

  it('does not offer image references for videos or to read-only members', () => {
    fixture.responses.set(
      '/assets?page=1',
      page([asset({ kind: 'video', mimeType: 'video/mp4' })]),
    );
    const video = render(createElement(Assets), '/assets');
    expect(video).not.toContain('href="/workbench?kind=image');
    expect(video).toContain('查看详情');
    fixture.canEdit = false;
    fixture.responses.set('/assets?page=1', page([asset()]));
    expect(render(createElement(Assets), '/assets')).not.toContain('href="/workbench?kind=image');
  });

  it.each([
    ['media', '/workbench/project-one'],
    ['detail-page', '/detail-pages/project-one'],
  ] as const)(
    'loads an older cover and returns the %s project to its own editor',
    (workflow, destination) => {
      const project: ProjectDto = {
        id: 'project-one',
        workspaceId: 'space-one',
        name: '白杯商品',
        description: '产品展示',
        kind: 'image',
        workflow,
        coverAssetId: 'old-cover',
        documentId: 'document-one',
        tags: [],
        isFavorite: false,
        createdBy: 'user-one',
        createdAt: '2026-10-30T12:00:00Z',
        updatedAt: '2026-10-30T12:00:00Z',
        deletedAt: null,
      };
      fixture.responses.set('/projects?page=1', page([project]));
      fixture.responses.set('/assets/old-cover', asset());
      const html = render(createElement(Projects), '/projects');
      expect(fixture.reads).toContain('/assets/old-cover');
      expect(fixture.reads).not.toContain('/assets?pageSize=100');
      expect(html).toContain('/media/preview.png');
      expect(html).toContain('继续创作');
      expect(html).toContain(`href="${destination}"`);
      if (workflow === 'detail-page') expect(html).toContain('商品详情页');
    },
  );

  it('offers clear first actions for an empty project and asset library', () => {
    fixture.responses.set('/projects?page=1', page([]));
    fixture.responses.set('/assets?page=1', page([]));
    expect(render(createElement(Projects), '/projects')).toContain('新建项目');
    expect(render(createElement(Assets), '/assets')).toContain('上传第一份素材');
  });

  it('summarizes a detail-page result and links back to its own workflow', () => {
    const input = jobInputSchema.parse({
      operation: 'image.generate',
      providerId: 'openai',
      prompt: '内部逐屏生成指令'.repeat(80),
      options: {
        detailPagePlan: {
          productName: '白杯',
          productFacts: ['陶瓷'],
          audience: '日常用户',
          visualStyle: '自然光',
          palette: ['白'],
          consistencyNotes: '保持一致',
          unknowns: [],
          screens: [1, 2].map((index) => ({
            id: `screen_${index}`,
            title: '展示',
            purpose: '展示商品',
            copy: [],
            prompt: '白杯',
            ratio: '3:4',
          })),
        },
      },
    });
    const job: JobDto = {
      id: 'job-one',
      workspaceId: 'space-one',
      projectId: 'project-one',
      createdBy: 'user-one',
      isArchived: false,
      downloadedAt: null,
      operation: input.operation,
      providerId: input.providerId,
      prompt: input.prompt,
      status: 'succeeded',
      stage: '已完成',
      requestedCredits: 1,
      settledCredits: 1,
      createdAt: '2026-10-30T12:00:00Z',
      updatedAt: '2026-10-30T12:00:00Z',
      errorMessage: null,
      input,
      outputAssets: [asset()],
      items: [],
    };
    const html = render(createElement(JobCard, { job, compact: true, showProjectLink: true }));
    expect(html).toContain('白杯 · 2 屏详情页 · 3:4');
    expect(html).not.toContain('内部逐屏生成指令');
    expect(html).toContain('/detail-pages/project-one?job=job-one');
  });
});

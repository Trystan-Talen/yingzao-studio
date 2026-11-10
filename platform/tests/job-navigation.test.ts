/** Rendering and navigation regressions only; no browser or provider requests. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jobInputSchema, type JobDto } from '../src/contracts/jobs';
import type { AssetDto } from '../src/contracts/core';
import { detailPagePlanSchema } from '../src/contracts/detail-page';
import { jobDestination } from '../src/web/lib/job-navigation';
import { JobCard, TaskList } from '../src/web/components/TaskCenter';
import { Tasks } from '../src/web/pages/Tasks';
import { JobCreatedReceipt } from '../src/web/components/JobSubmit';

const fixture = vi.hoisted(() => ({
  responses: new Map<string, unknown>(),
  reads: [] as string[],
}));
vi.mock('../src/web/context', () => ({
  useStudio: () => ({
    canEdit: true,
    isAdmin: false,
    session: { user: { id: 'fixture-user', preferences: {} } },
    workspace: { id: 'fixture-space' },
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

function job(overrides: Partial<JobDto> = {}): JobDto {
  const input = jobInputSchema.parse({ operation: 'image.generate', providerId: 'openai' });
  return {
    id: 'target-job',
    workspaceId: 'fixture-space',
    projectId: 'project-one',
    createdBy: 'fixture-user',
    isArchived: false,
    downloadedAt: null,
    operation: input.operation,
    providerId: input.providerId,
    prompt: '目标创作',
    status: 'succeeded',
    stage: '结果已保存',
    requestedCredits: 1,
    settledCredits: 1,
    createdAt: '2026-10-29T12:00:00Z',
    updatedAt: '2026-10-29T12:01:00Z',
    errorMessage: null,
    input,
    outputAssets: [],
    items: [],
    ...overrides,
  };
}
function render(node: ReturnType<typeof createElement>, location = '/tasks') {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [location] }, node));
}
beforeEach(() => {
  fixture.responses.clear();
  fixture.reads.length = 0;
  fixture.responses.set('/projects?pageSize=100', { items: [] });
  fixture.responses.set('/members?pageSize=100', { items: [] });
  fixture.responses.set('/capabilities', { operations: [] });
});

describe('task destinations', () => {
  it('keeps the selected job when opening a project, including older jobs', () => {
    expect(jobDestination(job())).toBe('/workbench/project-one?job=target-job');
  });
  it('opens detail-page planning in its dedicated studio', () => {
    const input = jobInputSchema.parse({
      operation: 'text.assist',
      providerId: 'dify',
      options: { assistantMode: 'detail-page' },
    });
    expect(jobDestination(job({ input }))).toBe('/detail-pages/project-one?job=target-job');
  });
  it('opens detail-page images in the same dedicated studio', () => {
    const detailPagePlan = detailPagePlanSchema.parse({
      productName: '白杯',
      productFacts: ['白色陶瓷'],
      audience: '日常用户',
      visualStyle: '暖白',
      palette: ['白'],
      consistencyNotes: '保持同一商品',
      unknowns: [],
      screens: [1, 2].map((index) => ({
        id: `screen_${index}`,
        title: '商品',
        purpose: '介绍商品',
        copy: [],
        prompt: '白杯',
        ratio: '3:4',
      })),
    });
    const input = jobInputSchema.parse({
      operation: 'image.generate',
      providerId: 'openai',
      options: { detailPagePlan },
    });
    expect(jobDestination(job({ input }))).toBe('/detail-pages/project-one?job=target-job');
  });
  it('keeps standalone jobs accessible without inventing a project', () => {
    expect(jobDestination(job({ projectId: null }))).toBe('/tasks?job=target-job');
  });
  it('does not confuse a generic image kind with the dedicated detail-page workflow', () => {
    const input = jobInputSchema.parse({
      operation: 'image.generate',
      providerId: 'openai',
      options: { kind: 'detail' },
    });
    expect(jobDestination(job({ input }))).toBe('/workbench/project-one?job=target-job');
  });
});

describe('submission receipts', () => {
  it('shows the frozen six-panel product summary and task link instead of the internal generation prompt', () => {
    const frozenInput = jobInputSchema.parse({
      operation: 'image.generate',
      providerId: 'openai',
      prompt: '整套统一风格、商品事实和模型生成指令。'.repeat(200),
      options: {
        detailPagePlan: {
          productName: '植物精华',
          productFacts: ['植物精华'],
          audience: '日常用户',
          visualStyle: '暖白自然光',
          palette: ['米白'],
          consistencyNotes: '保持同一商品',
          unknowns: [],
          screens: Array.from({ length: 6 }, (_, index) => ({
            id: `screen_${index + 1}`,
            title: '商品展示',
            purpose: '介绍商品',
            copy: [],
            prompt: '保留参考图商品外观',
            ratio: '3:4',
          })),
        },
      },
    });
    const accepted = job({ input: structuredClone(frozenInput), prompt: frozenInput.prompt });
    const draft = structuredClone(frozenInput);
    draft.options.detailPagePlan!.productName = '后来编辑的另一款商品';
    draft.options.detailPagePlan!.screens.splice(2);
    const html = render(createElement(JobCreatedReceipt, { job: accepted }));
    expect(html).toContain('植物精华 · 6 屏详情页 · 3:4');
    expect(html).not.toContain('模型生成指令');
    expect(html).not.toContain(draft.options.detailPagePlan!.productName);
    expect(html).toContain('任务已创建');
    expect(html).toContain('查看这次任务');
    expect(html).toContain('href="/detail-pages/project-one?job=target-job"');
    expect(accepted.input.prompt).toBe(frozenInput.prompt);
  });
});

describe('task discovery', () => {
  it('keeps task lists compact while full workbench cards still show every result', () => {
    const outputAssets: AssetDto[] = Array.from({ length: 6 }, (_, index) => ({
      id: `asset-${index}`,
      workspaceId: 'fixture-space',
      projectId: 'project-one',
      name: `第${index + 1}屏`,
      kind: 'image',
      extractionStatus: 'not-applicable',
      mimeType: 'image/png',
      byteSize: 100,
      width: 768,
      height: 1024,
      durationMs: null,
      source: 'generation',
      sourceJobId: 'target-job',
      tags: [],
      isFavorite: false,
      originalUrl: `/media/image-${index}.png`,
      previewUrl: null,
      thumbnailUrl: null,
      createdBy: 'fixture-user',
      createdAt: '2026-10-29T12:00:00Z',
      updatedAt: '2026-10-29T12:00:00Z',
      deletedAt: null,
    }));
    const record = job({ prompt: '商品设计需求'.repeat(50), outputAssets });
    const compact = render(
      createElement(JobCard, { job: record, compact: true, showProjectLink: true }),
    );
    const full = render(createElement(JobCard, { job: record }));
    expect(compact.match(/<img /g)).toHaveLength(1);
    expect(compact).toContain('6 个作品已保存');
    expect(compact.match(/class="creation-prompt"[^>]*>([^<]*)/)?.[1]).toHaveLength(101);
    expect(full.match(/<img /g)).toHaveLength(6);
    expect(full.match(/class="creation-prompt"[^>]*>([^<]*)/)?.[1]).toBe(record.prompt);
  });
  it('retains active progress in compact cards without a large placeholder', () => {
    const html = render(
      createElement(JobCard, {
        job: job({ status: 'running', stage: '正在生成第2屏' }),
        compact: true,
      }),
    );
    expect(html).toContain('正在生成第2屏');
    expect(html).toContain('result-progress-icon is-working');
    expect(html).toContain('<details class="result-progress-details">');
    expect(html).not.toContain('result-placeholder');
  });
  it('starts with workspace tasks so the activity badge and task history use the same scope', () => {
    const html = render(createElement(TaskList));
    expect(html).toContain('当前空间任务');
    const history = fixture.reads.find((path) => path.startsWith('/jobs?'));
    expect(history).toBeDefined();
    expect(history).not.toContain('createdBy=');
  });
  it('provides a visible destination on the card without opening parameter details', () => {
    const html = render(createElement(JobCard, { job: job(), showProjectLink: true }));
    expect(html).toContain('href="/workbench/project-one?job=target-job"');
    expect(html).toContain('查看任务');
  });
  it('loads a deep-linked standalone job separately from the first history page after refresh', () => {
    fixture.responses.set(
      '/jobs/target-job',
      job({ projectId: null, prompt: '不在第一页的目标任务' }),
    );
    const location = '/tasks?job=target-job';
    for (let refresh = 0; refresh < 2; refresh++) {
      const html = render(createElement(Tasks), location);
      expect(html).toContain('不在第一页的目标任务');
      expect(html).toContain('当前查看的任务');
      expect(html).toContain('target-job');
    }
    expect(fixture.reads.filter((path) => path === '/jobs/target-job')).toHaveLength(2);
  });
});

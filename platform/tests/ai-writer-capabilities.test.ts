import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationCapability } from '../src/contracts/jobs';
import { setLocale, t } from '../src/web/lib/i18n';
import {
  AIWriter,
  AIWriterModeControls,
  writerModeAvailability,
  writerRequestLimit,
} from '../src/web/components/AIWriter';

const fixture = vi.hoisted(() => ({
  operations: [] as OperationCapability[],
  loading: false,
  error: null as Error | null,
}));
vi.mock('../src/web/lib/api', async (original) => ({
  ...(await original<typeof import('../src/web/lib/api')>()),
  useApi: (path: string) => ({
    data: path === '/capabilities' ? { operations: fixture.operations } : undefined,
    isLoading: path === '/capabilities' && fixture.loading,
    error: path === '/capabilities' ? fixture.error : null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../src/web/components/ui', async (original) => ({
  ...(await original<typeof import('../src/web/components/ui')>()),
  // Portals are browser infrastructure; keep the assistant content visible to SSR tests.
  Modal: ({ children }: { children: ReactNode }) => createElement('section', null, children),
}));
vi.mock('../src/web/components/JobSubmit', () => ({
  JobSubmit: ({ valid, operation }: { valid: boolean; operation?: OperationCapability }) =>
    createElement('button', {
      'data-submit': true,
      'data-provider': operation?.providerId,
      disabled: !valid || !operation?.available,
    }),
}));
vi.mock('../src/web/lib/use-model-capability', () => ({
  useModelCapability: () => ({
    canGenerate: true,
    canRefresh: true,
    revision: 'checked',
    parameters: [],
    fixedOptions: {},
    refresh: vi.fn(),
  }),
  capabilityParameterLabels: {},
}));

const operation = (overrides: Partial<OperationCapability> = {}): OperationCapability => ({
  id: 'text.assist',
  providerId: 'dify',
  name: '创作建议',
  available: true,
  reason: null,
  models: [{ id: 'kimi-k3', name: 'Kimi · 创作策划', ratios: [], resolutions: [], durations: [] }],
  priceCredits: 2,
  unit: 'request',
  liveVerified: false,
  ...overrides,
});
const render = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, node));
const writer = (prompt = '保留已有商品需求') =>
  render(
    createElement(AIWriter, {
      open: true,
      prompt,
      assets: [],
      onClose: vi.fn(),
      onAccept: vi.fn(),
      onAcceptPlan: vi.fn(),
    }),
  );
const controls = (mode: 'ideas' | 'design-plan', operations = fixture.operations, ready = true) =>
  render(createElement(AIWriterModeControls, { mode, operations, ready, onChange: vi.fn() }));

beforeEach(() => {
  fixture.operations = [operation()];
  fixture.loading = false;
  fixture.error = null;
});
afterEach(() => setLocale('zh-CN'));

describe('assistant modes follow actual text capabilities', () => {
  it('does not mistake a connected image gateway for native structured text assistance', () => {
    const capabilities = [operation(), operation({ id: 'image.generate', providerId: 'openai' })];
    expect(writerModeAvailability(capabilities, 'ideas').available).toBe(true);
    expect(writerModeAvailability(capabilities, 'design-plan')).toMatchObject({
      available: false,
      operations: [],
      reason: expect.stringContaining('图片生成服务不能用于生成设计方案'),
    });
    const html = controls('ideas', capabilities);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*disabled=""[^>]*>完整设计方案/);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"(?![^>]*disabled)[^>]*>创作建议/);
    expect(html).toContain('完整设计方案暂不可用');
  });

  it('keeps design-plan restricted to the provider supported by the existing backend', () => {
    const capabilities = [operation(), operation({ providerId: 'flyelep' })];
    expect(writerModeAvailability(capabilities, 'design-plan').available).toBe(false);
    expect(writerModeAvailability(capabilities, 'ideas').operations).toHaveLength(2);
  });

  it('enables design-plan when native text assistance is available', () => {
    const capabilities = [operation({ providerId: 'openai' })];
    expect(writerModeAvailability(capabilities, 'design-plan').available).toBe(true);
    expect(controls('design-plan', capabilities)).not.toContain('disabled=""');
    expect(controls('design-plan', capabilities)).not.toContain('暂不可用');
  });

  it('shows the capability reason when native text assistance is disconnected', () => {
    fixture.operations.push(
      operation({ providerId: 'openai', available: false, reason: '原生文字服务未连接' }),
    );
    const html = controls('design-plan');
    expect(html).toContain('原生文字服务未连接');
    expect(html).toContain('切换到创作建议');
    expect(html).toContain('href="/settings"');
  });

  it('lets a previously selected design-plan mode return to suggestions without losing its recovery explanation', () => {
    const html = controls('design-plan');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*disabled=""[^>]*>完整设计方案/);
    expect(html).toContain('切换到创作建议');
    expect(html).toContain('已有需求与历史结果仍保留');
    expect(html).toContain('查看服务设置');
  });

  it('offers setup when neither mode can generate and does not present a fake usable fallback', () => {
    const html = controls('design-plan', []);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain('切换到创作建议');
    expect(html).toContain('href="/settings"');
    fixture.operations = [];
    const assistant = writer();
    expect(assistant).toContain('当前模式没有可用的文案服务');
    expect(assistant).toMatch(/data-submit="true"[^>]*disabled=""/);
    expect(assistant).toContain('保留已有商品需求');
  });

  it('preserves the available suggestion submission when the structured mode is unsupported', () => {
    const html = writer();
    expect(html).toMatch(/data-submit="true" data-provider="dify"(?![^>]*disabled)/);
    expect(html).toContain('完整设计方案暂不可用');
  });

  it('does not submit against stale capabilities while the current read is loading or failed', () => {
    fixture.loading = true;
    expect(writer()).toMatch(/data-submit="true"[^>]*disabled=""/);
    fixture.loading = false;
    fixture.error = new Error('能力读取失败');
    expect(writer()).toMatch(/data-submit="true"[^>]*disabled=""/);
    expect(writer()).toContain('能力读取失败');
  });

  it.each([
    ['dify', 8000],
    ['openai', 12000],
  ])('shows the %s service limit and blocks only input above its boundary', (providerId, limit) => {
    fixture.operations = [operation({ providerId })];
    const accepted = writer('文'.repeat(limit));
    expect(accepted).toContain(`${limit} / ${limit} 字符`);
    const submitButton = accepted.match(/<button data-submit="true"[^>]*>/)?.[0];
    expect(submitButton).toBeTruthy();
    expect(submitButton).not.toContain('disabled');
    expect(accepted).not.toContain('aria-invalid="true"');
    const request = '文'.repeat(limit + 1);
    const blocked = writer(request);
    expect(blocked).toContain(request);
    expect(blocked).toContain('aria-invalid="true"');
    expect(blocked).toContain('已超出 1 个');
    expect(blocked).toMatch(/data-submit="true"[^>]*disabled=""/);
    expect(blocked).not.toContain('maxLength=');
    expect(blocked).not.toContain('maxlength=');
  });

  it('recomputes the limit from the selected service without trimming an existing request', () => {
    const request = '文'.repeat(9000);
    fixture.operations = [operation({ providerId: 'openai' })];
    expect(writerRequestLimit(fixture.operations[0])).toBe(12000);
    expect(writer(request)).toContain('9000 / 12000 字符');
    fixture.operations = [operation({ providerId: 'dify' })];
    expect(writerRequestLimit(fixture.operations[0])).toBe(8000);
    const html = writer(request);
    expect(html).toContain('9000 / 8000 字符');
    expect(html).toContain('已超出 1000 个');
    expect(html).toContain(request);
  });

  it.each(['en', 'ar'] as const)(
    'localizes unavailable modes and recovery actions in %s',
    (locale) => {
      setLocale(locale);
      expect(controls('design-plan')).not.toMatch(/[\u3400-\u9fff]/);
      expect(controls('ideas', [])).not.toMatch(/[\u3400-\u9fff]/);
      for (const message of [
        '正在读取可用的创作服务…',
        '当前模式没有可用的文案服务',
        '请在设置中连接服务',
        '当前创作策划仅处理文字，请先在创作框移除附件后生成。',
        '{count} / {limit} 字符',
        '当前服务最多支持 {limit} 个字符，已超出 {excess} 个。请缩短需求后再生成；现有内容已完整保留。',
      ]) {
        expect(t(message)).not.toBe(message);
        expect(t(message)).not.toMatch(/[\u3400-\u9fff]/);
      }
    },
  );
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DemoModeGenerationNotice,
  isDemoGenerationBlocked,
  localRealModeSettingsUrl,
} from '../src/web/components/DemoModeGenerationNotice';
import { apiQueryKey } from '../src/web/lib/api';
import { setLocale } from '../src/web/lib/i18n';

const reason = '演示模式不调用自定义模型，请在正式模式配置并生成';
function render({
  demoMode,
  confirmedDemo,
  origin = 'http://127.0.0.1:5174',
}: {
  demoMode?: boolean;
  confirmedDemo?: boolean;
  origin?: string;
}) {
  vi.stubGlobal('window', { location: { origin } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (demoMode !== undefined) client.setQueryData(apiQueryKey('/health'), { demoMode });
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(DemoModeGenerationNotice, { confirmedDemo }),
      ),
    );
  } finally {
    client.clear();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('zh-CN');
});

describe('runtime demo-mode generation guidance', () => {
  it('uses the actual runtime flag and never guesses demo mode from a local address', () => {
    expect(render({ demoMode: false })).toBe('');
    expect(render({})).toBe('');
    const html = render({ demoMode: true });
    expect(html).toContain('aria-label="演示模式生成说明"');
    expect(html).toContain(reason);
    expect(html).toContain('href="http://127.0.0.1:5176/settings?tab=models"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('演示配置不会自动迁移');
    expect(html).toContain('真实生成模式使用独立的账号、模型配置与数据');
    expect(html).toContain('这是本机的独立入口，不是线上环境。');
  });
  it('accepts the explicit server restriction while runtime health is still unavailable', () => {
    expect(isDemoGenerationBlocked(reason)).toBe(true);
    expect(isDemoGenerationBlocked('请在模型配置中启用文本与图片服务')).toBe(false);
    expect(isDemoGenerationBlocked(undefined)).toBe(false);
    expect(render({ confirmedDemo: true })).toContain('打开本机真实生成');
  });
  it.each(['http://127.0.0.1:5174', 'http://localhost:5174'])(
    'uses the documented real-mode origin for %s',
    (origin) => {
      expect(localRealModeSettingsUrl(origin)).toBe('http://127.0.0.1:5176/settings?tab=models');
    },
  );
  it.each([
    'https://studio.example',
    'http://127.0.0.1:5176',
    'http://127.0.0.1:80',
    'https://localhost:5174',
    'http://localhost.evil.example:5174',
    'http://127.0.0.1:5174@evil.example',
    'http://[::1]:5174',
    '',
  ])('never invents a formal deployment URL for %s', (origin) => {
    expect(localRealModeSettingsUrl(origin)).toBeUndefined();
    const html = render({ demoMode: true, origin });
    expect(html).toContain('请联系管理员提供正式模式入口。');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('5176');
    expect(html).not.toContain('这是本机的独立入口，不是线上环境。');
  });
  it.each(['en', 'ar'] as const)('localizes the runtime guidance in %s', (locale) => {
    setLocale(locale);
    expect(render({ demoMode: true })).not.toMatch(/[\u3400-\u9fff]/);
    expect(render({ demoMode: true, origin: 'https://studio.example' })).not.toMatch(
      /[\u3400-\u9fff]/,
    );
  });
});

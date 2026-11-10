import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, Loading } from '../src/web/components/ui';
import { setLocale } from '../src/web/lib/i18n';

describe('shared interface controls', () => {
  it('keeps the button appearance when a caller adds its own layout class', () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: 'secondary', className: 'full-width', busy: true }, 'Save'),
    );
    expect(html).toContain('class="button secondary full-width"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });

  it('localizes the shared loading status', () => {
    setLocale('en');
    try {
      expect(renderToStaticMarkup(createElement(Loading))).toContain('Loading');
    } finally {
      setLocale('zh-CN');
    }
  });
});

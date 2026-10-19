import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
const state = vi.hoisted(() => ({
  admin: true,
  calls: [] as { path: string; enabled: boolean }[],
}));
vi.mock('../src/web/context', () => ({
  useStudio: () => ({ isAdmin: state.admin, workspace: { id: 'fixture-space', isDemo: false } }),
}));
vi.mock('../src/web/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/web/lib/api')>('../src/web/lib/api');
  return {
    ...actual,
    useRefresh: () => async () => {},
    useApi: (path: string, enabled = true) => {
      state.calls.push({ path, enabled });
      let data: unknown = { items: [], total: 0, page: 1, pageSize: 100 };
      if (path === '/credits/api')
        data = {
          balance: 40,
          available: 30,
          reserved: 10,
          spent: 7,
          isDemo: false,
          unit: 'credits',
        };
      if (path === '/credits')
        data = {
          balance: 160,
          available: 160,
          reserved: 0,
          spent: 11,
          isDemo: false,
          unit: 'credits',
        };
      if (path.startsWith('/plans'))
        data = {
          items: [
            {
              id: 'pack',
              name: 'Fixture credit package',
              kind: 'credits',
              priceMinor: 100,
              currency: 'USD',
              interval: null,
              credits: 10,
              limits: {},
              providerConfigured: false,
            },
            {
              id: 'member',
              name: 'Fixture web membership',
              kind: 'subscription',
              priceMinor: 100,
              currency: 'USD',
              interval: 'month',
              credits: 10,
              limits: {},
              providerConfigured: false,
            },
          ],
        };
      if (path.endsWith('/buckets')) data = [];
      return {
        data: enabled ? data : undefined,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: async () => {},
      };
    },
  };
});
import { Usage } from '../src/web/pages/Usage';
import { Developer } from '../src/web/pages/Developer';
function render(component: typeof Usage | typeof Developer, url: string) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [url] }, createElement(component)),
  );
}
beforeEach(() => {
  state.admin = true;
  state.calls = [];
  vi.stubGlobal('location', { origin: 'http://fixture.local' });
});
describe('API billing management views', () => {
  it('shows only the independent API balance and credit packages in API recharge', () => {
    const html = render(Usage, '/usage?account=api&tab=plans');
    expect(html).toContain('接口额度与订单');
    expect(html).toContain('不是现金余额');
    expect(html).toContain('Fixture credit package');
    expect(html).not.toContain('Fixture web membership');
    expect(html).not.toContain('兑换额度');
    expect(state.calls.find((call) => call.path === '/credits')?.enabled).not.toBe(true);
    expect(state.calls.find((call) => call.path === '/subscriptions')?.enabled).toBe(false);
    expect(state.calls.filter((call) => call.enabled).map((call) => call.path)).toEqual([
      '/credits/api',
      '/plans/eligible?pageSize=100',
    ]);
  });
  it('does not request account data or show recharge controls for non-administrators', () => {
    state.admin = false;
    const html = render(Usage, '/usage?account=api&tab=plans');
    expect(html).toContain('只有创建者与管理员可以查看接口额度账户');
    expect(html).not.toContain('创建订单');
    expect(state.calls.some((call) => call.enabled)).toBe(false);
  });
  it('links developer balances to the API recharge and ledger views', () => {
    const html = render(Developer, '/developer');
    expect(html).toContain('接口独立额度账户');
    expect(html).toContain('/usage?account=api&amp;tab=plans');
    expect(html).toContain('/usage?account=api&amp;tab=ledger');
    expect(state.calls.find((call) => call.path === '/credits/api')?.enabled).toBe(true);
  });
});

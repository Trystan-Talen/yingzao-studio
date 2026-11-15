// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StudioProvider, useStudio } from '../src/web/context';
import { setApiIdentity, useApi } from '../src/web/lib/api';

const wid = 'shared-team';
const session = (userId: string) => ({
  user: { id: userId, preferences: { locale: 'zh-CN', theme: 'dark' } },
  activeWorkspaceId: wid,
  workspaces: [{ id: wid, role: 'member', name: 'Shared', kind: 'team' }],
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { data } : { error: { code: 'UNAUTHENTICATED' } }), {
    status,
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let node: HTMLDivElement;
let root: Root;
let client: QueryClient;
let scope: ReturnType<typeof useStudio>;
let identity: string | null;
let pendingMe: Promise<Response> | null;
let hangMemories: boolean;
function Probe() {
  scope = useStudio();
  const memories = useApi<{ items: string[] }>('/memories', !!scope.session);
  return createElement(
    'div',
    null,
    `${scope.session?.user.id ?? 'signed-out'}|${scope.session ? (memories.data?.items.join(',') ?? 'loading') : ''}`,
  );
}
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
beforeEach(async () => {
  identity = 'alice';
  pendingMe = null;
  hangMemories = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/v1/auth/me') {
        if (pendingMe) {
          const pending = pendingMe;
          pendingMe = null;
          return pending;
        }
        return identity ? response(session(identity)) : response(null, 401);
      }
      if (path === '/api/v1/memories') {
        if (hangMemories) return new Promise<Response>(() => undefined);
        return response({ items: [`${identity} private memory`] });
      }
      if (path === '/api/v1/auth/logout') return response({ signedOut: true });
      throw new Error(`Unexpected isolated request: ${path}`);
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 15000, retry: false } } });
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(StudioProvider, null, createElement(Probe)),
      ),
    );
  });
  await settle();
  expect(node.textContent).toContain('alice private memory');
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    await client.cancelQueries();
    client.clear();
  });
  node.remove();
  setApiIdentity(null, null);
  vi.unstubAllGlobals();
});

describe('account-scoped browser query state', () => {
  it('never renders another account private cache when identity changes in the same workspace', async () => {
    identity = 'bob';
    hangMemories = true;
    await act(async () => {
      await scope.refreshSession();
    });
    await settle();
    expect(node.textContent).toContain('bob|');
    expect(node.textContent).not.toContain('alice private memory');
  });
  it('purges private cache after 401 before another account logs into the same workspace', async () => {
    identity = null;
    await act(async () => {
      await scope.refreshSession();
    });
    expect(node.textContent).toContain('signed-out');
    expect(client.getQueryCache().findAll({ queryKey: ['api', wid] })).toHaveLength(0);
    identity = 'bob';
    hangMemories = true;
    await act(async () => {
      await scope.refreshSession();
    });
    await settle();
    expect(node.textContent).not.toContain('alice private memory');
  });
  it('ignores an old session response arriving after a newer account refresh', async () => {
    const oldResponse = deferred<Response>();
    pendingMe = oldResponse.promise;
    let oldRefresh!: Promise<void>;
    await act(async () => {
      oldRefresh = scope.refreshSession();
    });
    identity = 'bob';
    await act(async () => {
      await scope.refreshSession();
    });
    await act(async () => {
      oldResponse.resolve(response(session('alice')));
      await oldRefresh;
    });
    expect(scope.session?.user.id).toBe('bob');
    expect(node.textContent).not.toContain('alice private memory');
  });
  it('does not restore a session from an old response after explicit sign-out', async () => {
    const oldResponse = deferred<Response>();
    pendingMe = oldResponse.promise;
    let oldRefresh!: Promise<void>;
    await act(async () => {
      oldRefresh = scope.refreshSession();
    });
    await act(async () => {
      await scope.signOut();
    });
    await act(async () => {
      oldResponse.resolve(response(session('alice')));
      await oldRefresh;
    });
    expect(scope.session).toBeNull();
    expect(node.textContent).toContain('signed-out');
  });
});

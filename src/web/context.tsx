import { setLocale } from './lib/i18n';
import { t } from './lib/i18n';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UserDto, WorkspaceDto } from '../contracts/core';
import { api, post, setApiWorkspace } from './lib/api';
import { Loading, ErrorState } from './components/ui';
interface Session {
  user: UserDto;
  workspaces: WorkspaceDto[];
  activeWorkspaceId: string | null;
}
interface StudioContextValue {
  session: Session | null;
  workspace: WorkspaceDto | null;
  refreshSession: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<boolean>;
  registerWorkspaceGuard: (guard: () => Promise<boolean>) => () => void;
  canEdit: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}
const StudioContext = createContext<StudioContextValue | null>(null);
export function StudioProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const query = useQueryClient();
  const workspaceGuard = useRef<(() => Promise<boolean>) | null>(null);
  const registerWorkspaceGuard = useCallback((guard: () => Promise<boolean>) => {
    workspaceGuard.current = guard;
    return () => {
      if (workspaceGuard.current === guard) workspaceGuard.current = null;
    };
  }, []);
  setLocale(session?.user.preferences.locale ?? 'zh-CN');
  async function refreshSession() {
    try {
      const data = await api<Session>('/auth/me');
      const active =
        data.workspaces.find((w) => w.id === data.activeWorkspaceId) ?? data.workspaces[0] ?? null;
      setLocale(data.user.preferences.locale);
      setApiWorkspace(active?.id ?? null);
      setSession({ ...data, activeWorkspaceId: active?.id ?? null });
      setError(null);
    } catch (err) {
      if (err instanceof Error && 'status' in err && err.status === 401) {
        setSession(null);
        setApiWorkspace(null);
      } else setError(err);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void refreshSession();
  }, []);
  const workspace = session?.workspaces.find((w) => w.id === session.activeWorkspaceId) ?? null;
  useEffect(() => {
    if (!workspace?.id) return;
    const stream = new EventSource(
      `/api/v1/job-events?workspaceId=${encodeURIComponent(workspace.id)}&after=0`,
    );
    const update = () => {
      void query.invalidateQueries({ queryKey: ['api', workspace.id] });
    };
    stream.addEventListener('job', update);
    return () => {
      stream.removeEventListener('job', update);
      stream.close();
    };
  }, [workspace?.id, query]);
  useEffect(() => {
    const theme = session?.user.preferences.theme ?? 'system';
    const locale = session?.user.preferences.locale ?? 'zh-CN';
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [session?.user.preferences]);
  async function switchWorkspace(id: string) {
    if (id === workspace?.id) return true;
    if (workspaceGuard.current && !(await workspaceGuard.current())) return false;
    await post(`/workspaces/${id}/activate`);
    await query.cancelQueries();
    setApiWorkspace(id);
    query.clear();
    await refreshSession();
    return true;
  }
  async function signOut() {
    if (workspaceGuard.current && !(await workspaceGuard.current())) return;
    await post('/auth/logout');
    await query.cancelQueries();
    setApiWorkspace(null);
    setSession(null);
    query.clear();
  }
  if (!ready)
    return (
      <div className="splash">
        <div className="brand-mark">{t('映')}</div>
        <Loading label={t('正在打开映造工作空间…')} />
      </div>
    );
  if (error)
    return (
      <div className="splash">
        <ErrorState error={error} retry={refreshSession} />
      </div>
    );
  return (
    <StudioContext.Provider
      value={{
        session,
        workspace,
        refreshSession,
        switchWorkspace,
        registerWorkspaceGuard,
        canEdit: !!workspace && workspace.role !== 'viewer',
        isAdmin: workspace?.role === 'owner' || workspace?.role === 'admin',
        signOut,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}
export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error('StudioProvider is required');
  return value;
}

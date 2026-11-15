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
import { api, post, setApiIdentity, setApiWorkspace } from './lib/api';
import { createWorkspaceJobRefresh } from './lib/job-event-refresh';
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
  const sessionEpoch = useRef(0);
  const currentUser = useRef<string | null>(null);
  const workspaceGuard = useRef<(() => Promise<boolean>) | null>(null);
  const registerWorkspaceGuard = useCallback((guard: () => Promise<boolean>) => {
    workspaceGuard.current = guard;
    return () => {
      if (workspaceGuard.current === guard) workspaceGuard.current = null;
    };
  }, []);
  setLocale(session?.user.preferences.locale ?? 'zh-CN');
  async function refreshSession() {
    const epoch = ++sessionEpoch.current;
    try {
      const data = await api<Session>('/auth/me');
      if (epoch !== sessionEpoch.current) return;
      const active =
        data.workspaces.find((w) => w.id === data.activeWorkspaceId) ?? data.workspaces[0] ?? null;
      if (currentUser.current !== data.user.id) {
        await query.cancelQueries();
        if (epoch !== sessionEpoch.current) return;
        query.clear();
      }
      currentUser.current = data.user.id;
      setLocale(data.user.preferences.locale);
      setApiIdentity(data.user.id, active?.id ?? null);
      setSession({ ...data, activeWorkspaceId: active?.id ?? null });
      setError(null);
    } catch (err) {
      if (epoch !== sessionEpoch.current) return;
      if (err instanceof Error && 'status' in err && err.status === 401) {
        await query.cancelQueries();
        if (epoch !== sessionEpoch.current) return;
        query.clear();
        currentUser.current = null;
        setApiIdentity(null, null);
        setSession(null);
        setError(null);
      } else setError(err);
    } finally {
      if (epoch === sessionEpoch.current) setReady(true);
    }
  }
  useEffect(() => {
    void refreshSession();
    return () => {
      sessionEpoch.current++;
    };
  }, []);
  const workspace = session?.workspaces.find((w) => w.id === session.activeWorkspaceId) ?? null;
  useEffect(() => {
    if (!workspace?.id) return;
    const refresh = createWorkspaceJobRefresh(query, workspace.id);
    let stream: EventSource | null = null;
    let cursor = '0';
    let wasHidden = document.visibilityState === 'hidden';
    const onJob = (event: MessageEvent) => {
      if (/^\d+$/.test(event.lastEventId)) cursor = event.lastEventId;
      refresh.schedule(event.data);
    };
    const close = () => {
      stream?.removeEventListener('job', onJob);
      stream?.close();
      stream = null;
    };
    const syncVisibility = () => {
      // HTTP/1 browsers share a small connection pool across tabs. Background
      // streams must not occupy every slot and block module loads or downloads.
      if (document.visibilityState === 'hidden') {
        wasHidden = true;
        close();
        return;
      }
      if (stream) return;
      if (wasHidden) {
        wasHidden = false;
        // Restore data changed while hidden immediately, including non-job data.
        void query.invalidateQueries({ queryKey: ['api', workspace.id] }, { cancelRefetch: false });
      }
      stream = new EventSource(
        `/api/v1/job-events?workspaceId=${encodeURIComponent(workspace.id)}&after=${cursor}`,
      );
      stream.addEventListener('job', onJob);
    };
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      close();
      refresh.dispose();
    };
  }, [workspace?.id, query]);
  useEffect(() => {
    const theme = session?.user.preferences.theme ?? 'dark';
    const locale = session?.user.preferences.locale ?? 'zh-CN';
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    // The brand default, including the legacy `system` preference, is always dark.
    // Light is an explicit user choice; OS appearance must not change the product style.
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }, [session?.user.preferences]);
  async function switchWorkspace(id: string) {
    if (id === workspace?.id) return true;
    if (workspaceGuard.current && !(await workspaceGuard.current())) return false;
    sessionEpoch.current++;
    await post(`/workspaces/${id}/activate`);
    sessionEpoch.current++;
    await query.cancelQueries();
    setApiWorkspace(id);
    query.clear();
    await refreshSession();
    return true;
  }
  async function signOut() {
    if (workspaceGuard.current && !(await workspaceGuard.current())) return;
    sessionEpoch.current++;
    await post('/auth/logout');
    const epoch = ++sessionEpoch.current;
    await query.cancelQueries();
    if (epoch !== sessionEpoch.current) return;
    currentUser.current = null;
    setApiIdentity(null, null);
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

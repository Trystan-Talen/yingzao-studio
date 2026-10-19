import { t } from './lib/i18n';
import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { useStudio } from './context';
import { Layout } from './components/Layout';
import { Empty, Button, Loading } from './components/ui';
const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const PasswordRecovery = lazy(() =>
  import('./pages/PasswordRecovery').then((module) => ({ default: module.PasswordRecovery })),
);
const IdentityRegistration = lazy(() =>
  import('./pages/IdentityRegistration').then((module) => ({
    default: module.IdentityRegistration,
  })),
);
const Inspiration = lazy(() =>
  import('./pages/Inspiration').then((module) => ({ default: module.Inspiration })),
);
const Workbench = lazy(() =>
  import('./pages/Workbench').then((module) => ({ default: module.Workbench })),
);
const Tools = lazy(() => import('./pages/Tools').then((module) => ({ default: module.Tools })));
const ToolDetail = lazy(() =>
  import('./pages/Tools').then((module) => ({ default: module.ToolDetail })),
);
const Projects = lazy(() =>
  import('./pages/Library').then((module) => ({ default: module.Projects })),
);
const Assets = lazy(() => import('./pages/Library').then((module) => ({ default: module.Assets })));
const Brands = lazy(() =>
  import('./pages/Identities').then((module) => ({ default: module.Brands })),
);
const Characters = lazy(() =>
  import('./pages/Identities').then((module) => ({ default: module.Characters })),
);
const Team = lazy(() => import('./pages/Team').then((module) => ({ default: module.Team })));
const Usage = lazy(() => import('./pages/Usage').then((module) => ({ default: module.Usage })));
const Developer = lazy(() =>
  import('./pages/Developer').then((module) => ({ default: module.Developer })),
);
const Settings = lazy(() =>
  import('./pages/Settings').then((module) => ({ default: module.Settings })),
);
const Support = lazy(() =>
  import('./pages/Support').then((module) => ({ default: module.Support })),
);
const PublicShare = lazy(() =>
  import('./pages/Public').then((module) => ({ default: module.PublicShare })),
);
const InvitePage = lazy(() =>
  import('./pages/Public').then((module) => ({ default: module.InvitePage })),
);
const AdvancedToolPage = lazy(() =>
  import('./components/AdvancedTools').then((module) => ({ default: module.AdvancedToolPage })),
);

function page(content: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="page">
          <Loading />
        </div>
      }
    >
      {content}
    </Suspense>
  );
}

class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page render failed', error, info.componentStack);
  }
  render() {
    return this.state.error ? (
      <div className="page">
        <Empty
          title={t('此页面暂时无法显示')}
          description={t('你的已保存内容仍然保留。请重新打开页面，或把问题反馈给管理员。')}
          action={<Button onClick={() => location.reload()}>{t('重新加载')}</Button>}
        />
      </div>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  const { session, workspace } = useStudio();
  if (location.pathname === '/auth/complete-registration')
    return <PageBoundary>{page(<IdentityRegistration />)}</PageBoundary>;
  if (['/password/forgot', '/password/reset'].includes(location.pathname))
    return <PageBoundary>{page(<PasswordRecovery />)}</PageBoundary>;
  if (location.pathname.startsWith('/share'))
    return <PageBoundary>{page(<PublicShare />)}</PageBoundary>;
  if (!session) return page(<Login />);
  if (location.pathname === '/invite') return page(<InvitePage />);
  return (
    <PageBoundary key={workspace?.id ?? 'no-workspace'}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={page(<Inspiration />)} />
          <Route path="workbench" element={page(<Workbench />)} />
          <Route path="workbench/:projectId" element={page(<Workbench />)} />
          <Route path="tools" element={page(<Tools />)} />
          <Route path="tools/:toolId" element={page(<ToolDetail />)} />
          <Route path="advanced/:operationId" element={page(<AdvancedToolPage />)} />
          <Route path="projects" element={page(<Projects />)} />
          <Route path="assets" element={page(<Assets />)} />
          <Route path="brands" element={page(<Brands />)} />
          <Route path="characters" element={page(<Characters />)} />
          <Route path="team" element={page(<Team key={workspace?.id} />)} />
          <Route path="usage" element={page(<Usage />)} />
          <Route path="developer" element={page(<Developer />)} />
          <Route path="settings" element={page(<Settings />)} />
          <Route path="support" element={page(<Support />)} />
          <Route
            path="register"
            element={
              <div className="page">
                <Empty
                  title={t('当前账户已登录')}
                  description={t('注册邀请供新账户使用；当前账户可以继续使用工作空间。')}
                  action={
                    <Link className="button secondary" to="/">
                      {t('回到灵感广场')}
                    </Link>
                  }
                />
              </div>
            }
          />
          <Route
            path="*"
            element={
              <div className="page">
                <Empty
                  title={t('这个页面暂不存在')}
                  action={
                    <Link className="button secondary" to="/">
                      {t('回到灵感广场')}
                    </Link>
                  }
                />
              </div>
            }
          />
        </Route>
      </Routes>
    </PageBoundary>
  );
}

import { t } from '../lib/i18n';
import { Onboarding } from './Onboarding';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Code2,
  FolderOpen,
  HelpCircle,
  Image,
  LayoutGrid,
  LayoutTemplate,
  LogOut,
  Menu,
  MoreHorizontal,
  Search,
  Settings2,
  Sparkles,
  Users,
  UserRound,
  Wallet,
  Workflow,
} from 'lucide-react';
import { useStudio } from '../context';
import type { ProjectDto } from '../../contracts/core';
import { useApi, type Page } from '../lib/api';
import type { CreditDto } from '../../contracts/jobs';
import {
  Badge,
  Button,
  Drawer,
  Empty,
  ErrorState,
  IconButton,
  Loading,
  Modal,
  useAction,
} from './ui';
import { TaskCenter } from './TaskCenter';
import { projectDestination } from '../lib/project-navigation';
import { useJobActivity } from '../lib/use-job-activity';
import { NotificationCenter } from './NotificationCenter';
import { TeamCreation } from './TeamCreation';
import '../styles/studio-navigation.css';

const primaryNavigation = [
  { to: '/', label: '创作', icon: Sparkles },
  { to: '/inspiration', label: '灵感', icon: LayoutGrid },
  { to: '/tasks', label: '任务', icon: Workflow },
  { to: '/assets', label: '素材', icon: Image },
  { to: '/tools', label: '工具', icon: Settings2 },
];
const moreNavigation = [
  {
    label: '创作与项目',
    items: [
      { to: '/projects', label: '项目', icon: FolderOpen },
      { to: '/detail-pages', label: '商品详情页', icon: LayoutTemplate },
    ],
  },
  {
    label: '空间管理',
    items: [
      { to: '/brands', label: '品牌', icon: Workflow },
      { to: '/characters', label: '人物', icon: UserRound },
      { to: '/team', label: '团队', icon: Users },
      { to: '/usage', label: '用量与订单', icon: Wallet },
    ],
  },
  {
    label: '设置与帮助',
    items: [
      { to: '/developer', label: '开发者', icon: Code2 },
      { to: '/settings', label: '设置', icon: Settings2 },
      { to: '/support', label: '帮助与支持', icon: HelpCircle },
    ],
  },
];
type NavigationPanel = 'navigation' | 'more' | 'workspace' | 'account';
function matchesNavigation(path: string, destination: string) {
  if (destination === '/')
    return path === '/' || path === '/workbench' || path.startsWith('/workbench/');
  if (destination === '/tools' && path.startsWith('/advanced/')) return true;
  return path === destination || path.startsWith(destination + '/');
}
export function Layout() {
  const routeLocation = useLocation();
  const { session, workspace, switchWorkspace, signOut } = useStudio();
  const [panel, setPanel] = useState<NavigationPanel | null>(null);
  const [panelOrigin, setPanelOrigin] = useState<'desktop' | 'mobile'>('desktop');
  const panelContent = useRef<HTMLDivElement>(null);
  const [createSpace, setCreateSpace] = useState(false);
  const [tasks, setTasks] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState('');
  const searchTerm = q.trim();
  const taskActivity = useJobActivity(!!workspace);
  const credit = useApi<CreditDto>('/credits', !!workspace, 30000);
  const projects = useApi<Page<ProjectDto>>(
    '/projects?q=' + encodeURIComponent(searchTerm) + '&pageSize=8',
    search && searchTerm.length > 0,
  );
  const navigate = useNavigate();
  const action = useAction();
  const locale = session?.user.preferences.locale;
  const currentPage =
    [...primaryNavigation, ...moreNavigation.flatMap((group) => group.items)].find((item) =>
      matchesNavigation(routeLocation.pathname, item.to),
    )?.label ?? '工作空间';
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [routeLocation.pathname]);
  useEffect(() => {
    setTasks(false);
    setPanel(null);
  }, [routeLocation.key]);
  useEffect(() => {
    document.title = t(currentPage) + ' · ' + t('映造 Studio');
  }, [currentPage, locale]);
  useEffect(() => {
    if (panel === 'workspace' || panel === 'account')
      panelContent.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [panel]);
  const closeNavigation = () => setPanel(null);
  const openPanel = (view: NavigationPanel, origin: 'desktop' | 'mobile' = 'desktop') => {
    setPanelOrigin(origin);
    setPanel(view);
  };
  const roleName =
    workspace?.role === 'owner'
      ? '空间创建者'
      : workspace?.role === 'viewer'
        ? '只读成员'
        : '空间成员';
  const moreActive = moreNavigation.some((group) =>
    group.items.some((item) => matchesNavigation(routeLocation.pathname, item.to)),
  );
  const navigationLinks = (rail: boolean) => (
    <nav
      className={rail ? 'studio-primary-navigation' : 'studio-panel-primary'}
      aria-label={t('主导航')}
    >
      {primaryNavigation.map((item) => {
        const active = matchesNavigation(routeLocation.pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={active ? 'is-active' : undefined}
            aria-current={active ? 'page' : undefined}
            onClick={closeNavigation}
          >
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>{t(item.label)}</span>
            {item.to === '/tasks' && !!taskActivity.total && (
              <span className="studio-navigation-count" aria-label={t('项进行中或需要处理')}>
                {taskActivity.total}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
  const brand = (className: string, wordmark = false) => (
    <Link
      className={className + ' studio-brand'}
      to="/"
      aria-label={t('映造 · 创作')}
      title={t('映造 · 创作')}
      onClick={closeNavigation}
    >
      <svg className="studio-brand-glyph" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M5 21V7h14M13 25h14V11"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="m11 21 10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
      {wordmark && <span>{t('映造')}</span>}
    </Link>
  );
  const accountLinks = (
    <div className="studio-panel-account-links">
      <button type="button" onClick={() => setPanel('workspace')}>
        <span className="workspace-avatar" aria-hidden="true">
          {workspace?.name.slice(0, 1) ?? t('我')}
        </span>
        <span>
          <strong>{workspace?.name ?? t('选择工作空间')}</strong>
          <small>{t('切换工作空间')}</small>
        </span>
      </button>
      <button type="button" onClick={() => setPanel('account')}>
        <span className="user-avatar" aria-hidden="true">
          {session?.user.displayName.slice(0, 1)}
        </span>
        <span>
          <strong>{session?.user.displayName}</strong>
          <small>{t('账户与退出')}</small>
        </span>
      </button>
    </div>
  );
  return (
    <div className="app-shell studio-shell studio-navigation-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        {t('跳到主要内容')}
      </a>
      <Onboarding />
      <aside className="studio-navigation-rail" aria-label={t('工作空间导航')}>
        {brand('studio-rail-brand')}
        {navigationLinks(true)}
        <div className="studio-rail-controls">
          <button
            type="button"
            aria-label={t('切换工作空间') + ' · ' + (workspace?.name ?? '')}
            title={workspace?.name}
            aria-haspopup="dialog"
            aria-expanded={panel === 'workspace'}
            onClick={() => openPanel('workspace')}
          >
            <span className="workspace-avatar" aria-hidden="true">
              {workspace?.name.slice(0, 1) ?? t('我')}
            </span>
            <span>{t('空间')}</span>
          </button>
          <button
            type="button"
            aria-label={t('账户与退出') + ' · ' + (session?.user.displayName ?? '')}
            title={session?.user.displayName}
            aria-haspopup="dialog"
            aria-expanded={panel === 'account'}
            onClick={() => openPanel('account')}
          >
            <span className="user-avatar" aria-hidden="true">
              {session?.user.displayName.slice(0, 1)}
            </span>
            <span>{t('账户')}</span>
          </button>
        </div>
      </aside>
      <div className="studio-main">
        <header className="studio-header">
          {brand('studio-mobile-brand', true)}
          {workspace?.isDemo && (
            <span className="studio-demo-label" title={t('演示空间 · 测试数据')}>
              {t('演示')}
            </span>
          )}
          <div className="studio-header-actions">
            <Link
              to="/usage"
              className="studio-header-credit"
              aria-label={t('查看额度明细')}
              title={workspace?.isDemo ? t('本机测试额度') : t('可用额度')}
            >
              <Wallet size={16} aria-hidden="true" />
              <strong>{credit.data?.available.toLocaleString() ?? '—'}</strong>
              <span>{t('积分')}</span>
            </Link>
            <IconButton label={t('搜索项目')} onClick={() => setSearch(true)}>
              <Search size={19} />
            </IconButton>
            <button
              aria-label={
                t('当前进度') +
                (taskActivity.total
                  ? ' · ' + taskActivity.total + ' ' + t('项进行中或需要处理')
                  : '')
              }
              className={'studio-task-button' + (taskActivity.total ? ' has-activity' : '')}
              onClick={() => setTasks(true)}
            >
              <Workflow size={18} aria-hidden="true" />
              <span>{t('当前进度')}</span>
              {!!taskActivity.total && (
                <b className="studio-activity-count">{taskActivity.total}</b>
              )}
            </button>
            <NotificationCenter />
            <IconButton
              label={t('更多')}
              className={'studio-header-more' + (moreActive ? ' is-active' : '')}
              aria-haspopup="dialog"
              aria-expanded={panel === 'more'}
              onClick={() => openPanel('more')}
            >
              <MoreHorizontal size={21} />
            </IconButton>
            <IconButton
              label={t('展开导航')}
              className="studio-mobile-menu"
              aria-haspopup="dialog"
              aria-expanded={panel !== null && panelOrigin === 'mobile'}
              onClick={() => openPanel('navigation', 'mobile')}
            >
              <Menu size={21} />
            </IconButton>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>{t('映造 · 创意工作室')}</span>
          <span>{t('想法有迹可循，作品随时继续。')}</span>
        </footer>
      </div>
      <Drawer
        open={panel !== null}
        onClose={closeNavigation}
        title={t(
          panel === 'workspace'
            ? '切换工作空间'
            : panel === 'account'
              ? '账户与退出'
              : panel === 'more'
                ? '更多'
                : '导航',
        )}
      >
        <div className="studio-navigation-panel" ref={panelContent}>
          {(panel === 'workspace' || panel === 'account') && (
            <Button
              variant="ghost"
              className="studio-panel-back"
              onClick={() => setPanel(panelOrigin === 'mobile' ? 'navigation' : 'more')}
            >
              <ArrowLeft size={16} />
              {t('返回导航')}
            </Button>
          )}
          {panel === 'navigation' && navigationLinks(false)}
          {(panel === 'navigation' || panel === 'more') && (
            <>
              {workspace?.isDemo && <p className="studio-panel-demo">{t('演示空间 · 测试数据')}</p>}
              {moreNavigation.map((group) => (
                <section
                  className="studio-more-group"
                  key={group.label}
                  aria-label={t(group.label)}
                >
                  <h3>{t(group.label)}</h3>
                  {group.items.map((item) => {
                    const active = matchesNavigation(routeLocation.pathname, item.to);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={active ? 'is-active' : undefined}
                        aria-current={active ? 'page' : undefined}
                        onClick={closeNavigation}
                      >
                        <item.icon size={19} aria-hidden="true" />
                        <span>{t(item.label)}</span>
                      </Link>
                    );
                  })}
                </section>
              ))}
              <Link
                to="/usage"
                className="studio-credit-summary"
                aria-label={t('查看额度明细')}
                onClick={closeNavigation}
              >
                <Wallet size={19} aria-hidden="true" />
                <span>
                  {workspace?.isDemo ? t('本机测试额度') : t('可用额度')}
                  <strong>{credit.data?.available.toLocaleString() ?? '—'}</strong>
                </span>
              </Link>
              {accountLinks}
            </>
          )}
          {panel === 'workspace' && (
            <section className="studio-workspace-list" aria-label={t('工作空间')}>
              <p className="muted">{t('选择要进入的工作空间')}</p>
              {session?.workspaces.map((space) => (
                <button
                  key={space.id}
                  type="button"
                  disabled={action.busy}
                  aria-current={space.id === workspace?.id ? 'true' : undefined}
                  onClick={() =>
                    void action.run(async () => {
                      const changed = await switchWorkspace(space.id);
                      if (changed) {
                        closeNavigation();
                        navigate('/');
                      }
                    })
                  }
                >
                  <span className="workspace-avatar" aria-hidden="true">
                    {space.name.slice(0, 1)}
                  </span>
                  <span>{space.name}</span>
                  {space.id === workspace?.id && <Check size={18} aria-label={t('当前')} />}
                </button>
              ))}
              <Button variant="secondary" onClick={() => setCreateSpace(true)}>
                {t('＋ 创建团队空间')}
              </Button>
            </section>
          )}
          {panel === 'account' && (
            <section className="studio-account-details" aria-label={t('账户')}>
              <span className="user-avatar" aria-hidden="true">
                {session?.user.displayName.slice(0, 1)}
              </span>
              <h3>{session?.user.displayName}</h3>
              <Badge tone="green">{t(roleName)}</Badge>
              <Link to="/settings" onClick={closeNavigation}>
                <Settings2 size={18} />
                {t('设置')}
              </Link>
              <Button
                variant="secondary"
                busy={action.busy}
                onClick={() => void action.run(signOut)}
              >
                <LogOut size={18} />
                {t('退出登录')}
              </Button>
            </section>
          )}
        </div>
      </Drawer>
      <TaskCenter open={tasks} onClose={() => setTasks(false)} title={t('当前进度')} />
      <Modal open={search} onClose={() => setSearch(false)} title={t('搜索项目')}>
        <div className="studio-navigation-search">
          <input
            autoFocus
            placeholder={t('搜索项目名称…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('搜索项目')}
          />
          {!searchTerm && <p className="search-hint muted">{t('输入项目名称开始搜索。')}</p>}
          {searchTerm && projects.isFetching && <Loading />}
          {searchTerm && projects.isError && (
            <ErrorState error={projects.error} retry={() => projects.refetch()} />
          )}
          {searchTerm &&
            !projects.isError &&
            projects.data?.items.map((project) => (
              <button
                key={project.id}
                className="search-result"
                onClick={() => {
                  navigate(projectDestination(project));
                  setSearch(false);
                }}
              >
                <FolderOpen size={18} />
                {project.name}
              </button>
            ))}
          {searchTerm &&
            !projects.isFetching &&
            !projects.isError &&
            projects.data?.items.length === 0 && <Empty title={t('没有找到相关项目')} />}
        </div>
      </Modal>
      <TeamCreation open={createSpace} onClose={() => setCreateSpace(false)} />
    </div>
  );
}

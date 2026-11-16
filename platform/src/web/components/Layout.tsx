import { t } from '../lib/i18n';
import { Onboarding } from './Onboarding';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Code2,
  Command,
  Copy,
  FolderOpen,
  HelpCircle,
  Image,
  LayoutGrid,
  LayoutTemplate,
  LogOut,
  Menu,
  MoreHorizontal,
  Palette,
  Package,
  Search,
  Settings2,
  Sparkles,
  Users,
  UserRound,
  Wallet,
  Wand2,
  Workflow,
  Zap,
} from 'lucide-react';
import { useStudio } from '../context';
import type { ProjectDto } from '../../contracts/core';
import { useApi, type Page } from '../lib/api';
import type { CreditDto } from '../../contracts/jobs';
import { Badge, Button, Drawer, Empty, ErrorState, Loading, Modal, useAction } from './ui';
import { TaskCenter } from './TaskCenter';
import { projectDestination } from '../lib/project-navigation';
import { useJobActivity } from '../lib/use-job-activity';
import { NotificationCenter } from './NotificationCenter';
import { TeamCreation } from './TeamCreation';
import { BrandMark } from './BrandMark';
import '../styles/brand/shell.css';

const primaryNavigation = [
  { to: '/', label: '创作', icon: Sparkles },
  { to: '/inspiration', label: '灵感', icon: LayoutGrid },
  { to: '/tasks', label: '任务', icon: Workflow },
  { to: '/assets', label: '素材', icon: Image },
  { to: '/tools', label: '工具', icon: Wand2 },
];
const studioNavigation = [
  { to: '/replica', label: '爆款复刻', icon: Copy },
  { to: '/projects', label: '项目', icon: FolderOpen },
  { to: '/detail-pages', label: '详情页', icon: LayoutTemplate },
  { to: '/brands', label: '品牌', icon: Palette },
  { to: '/products', label: '产品库', icon: Package },
];
const moreNavigation = [
  {
    label: '创作与项目',
    items: [
      { to: '/replica', label: '爆款复刻', icon: Copy },
      { to: '/projects', label: '项目', icon: FolderOpen },
      { to: '/detail-pages', label: '商品详情页', icon: LayoutTemplate },
    ],
  },
  {
    label: '空间管理',
    items: [
      { to: '/brands', label: '品牌', icon: Palette },
      { to: '/products', label: '产品库', icon: Package },
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
  const allItems = [...primaryNavigation, ...moreNavigation.flatMap((group) => group.items)];
  const currentPage =
    allItems.find((item) => matchesNavigation(routeLocation.pathname, item.to))?.label ??
    '工作空间';
  const isHome = routeLocation.pathname === '/';
  // Management pages get a compact header; content pages keep the large editorial one.
  const isManagement = [
    '/settings',
    '/usage',
    '/team',
    '/developer',
    '/support',
    '/brands',
    '/products',
    '/characters',
  ].some((path) => routeLocation.pathname.startsWith(path));
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [routeLocation.pathname]);
  useEffect(() => {
    setTasks(false);
    setPanel(null);
    // A delayed child may normalize query parameters without leaving the page.
    // Keep an already opened drawer usable through that background URL update.
  }, [routeLocation.pathname]);
  useEffect(() => {
    document.title = t(currentPage) + ' · ' + t('映造 Studio');
  }, [currentPage, locale]);
  useEffect(() => {
    if (panel === 'workspace' || panel === 'account')
      panelContent.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [panel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
    group.items.some(
      (item) =>
        !studioNavigation.some((studio) => studio.to === item.to) &&
        matchesNavigation(routeLocation.pathname, item.to),
    ),
  );
  const creditLabel = credit.data?.available.toLocaleString() ?? '—';

  const railLink = (item: (typeof primaryNavigation)[number], compact = false) => {
    const active = matchesNavigation(routeLocation.pathname, item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        className={'yz-rail-link' + (active ? ' is-active' : '') + (compact ? ' is-compact' : '')}
        aria-current={active ? 'page' : undefined}
        onClick={closeNavigation}
      >
        <span className="yz-rail-icon">
          <item.icon size={compact ? 18 : 20} strokeWidth={1.75} aria-hidden="true" />
          {item.to === '/tasks' && !!taskActivity.total && (
            <span className="yz-rail-count" aria-label={t('项进行中或需要处理')}>
              {taskActivity.total}
            </span>
          )}
        </span>
        <span className="yz-rail-label">{t(item.label)}</span>
      </Link>
    );
  };

  const accountLinks = (
    <div className="yz-panel-account">
      <button type="button" onClick={() => setPanel('workspace')}>
        <span className="yz-avatar is-space" aria-hidden="true">
          {workspace?.name.slice(0, 1) ?? t('我')}
        </span>
        <span>
          <strong>{workspace?.name ?? t('选择工作空间')}</strong>
          <small>{t('切换工作空间')}</small>
        </span>
      </button>
      <button type="button" onClick={() => setPanel('account')}>
        <span className="yz-avatar" aria-hidden="true">
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
    <div className={'yz-shell' + (isHome ? ' is-home' : '') + (scrolled ? ' is-scrolled' : '')}>
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

      {/* ---------------- Desktop rail ---------------- */}
      <aside className="yz-rail" aria-label={t('工作空间导航')}>
        <Link
          className="yz-rail-brand"
          to="/"
          aria-label={t('映造 · 创作')}
          title={t('映造 · 创作')}
        >
          <BrandMark size={38} />
        </Link>
        <nav className="yz-rail-nav" aria-label={t('主导航')}>
          {primaryNavigation.map((item) => railLink(item))}
        </nav>
        <span className="yz-rail-divider" aria-hidden="true" />
        <nav className="yz-rail-nav is-secondary" aria-label={t('创作与项目')}>
          {studioNavigation.map((item) => railLink(item, true))}
          <button
            type="button"
            className={'yz-rail-link is-compact' + (moreActive ? ' is-active' : '')}
            aria-haspopup="dialog"
            aria-expanded={panel === 'more'}
            onClick={() => openPanel('more')}
          >
            <span className="yz-rail-icon">
              <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="yz-rail-label">{t('更多')}</span>
          </button>
        </nav>
        <div className="yz-rail-foot">
          <button
            type="button"
            className="yz-rail-avatar"
            aria-label={t('切换工作空间') + ' · ' + (workspace?.name ?? '')}
            title={workspace?.name}
            aria-haspopup="dialog"
            aria-expanded={panel === 'workspace'}
            onClick={() => openPanel('workspace')}
          >
            <span className="yz-avatar is-space" aria-hidden="true">
              {workspace?.name.slice(0, 1) ?? t('我')}
            </span>
          </button>
          <button
            type="button"
            className="yz-rail-avatar"
            aria-label={t('账户与退出') + ' · ' + (session?.user.displayName ?? '')}
            title={session?.user.displayName}
            aria-haspopup="dialog"
            aria-expanded={panel === 'account'}
            onClick={() => openPanel('account')}
          >
            <span className="yz-avatar" aria-hidden="true">
              {session?.user.displayName.slice(0, 1)}
            </span>
          </button>
        </div>
      </aside>

      <div className="yz-main">
        {/* ---------------- Top bar ---------------- */}
        <header className="yz-topbar">
          <Link className="yz-topbar-brand" to="/" aria-label={t('映造 · 创作')}>
            <BrandMark size={30} />
            <span className="yz-wordmark">
              {t('映造')}
              <small>STUDIO</small>
            </span>
          </Link>
          <div className="yz-crumb" aria-hidden={isHome}>
            <span className="yz-crumb-space">{workspace?.name ?? t('工作空间')}</span>
            <span className="yz-crumb-sep">/</span>
            <span className="yz-crumb-page">{t(currentPage)}</span>
            {workspace?.isDemo && (
              <span className="yz-demo-tag" title={t('演示空间 · 测试数据')}>
                {t('演示')}
              </span>
            )}
          </div>
          <button type="button" className="yz-search-trigger" onClick={() => setSearch(true)}>
            <Search size={16} aria-hidden="true" />
            <span>{t('搜索项目')}</span>
            <kbd>
              <Command size={11} aria-hidden="true" />K
            </kbd>
          </button>
          <div className="yz-topbar-actions">
            <button
              type="button"
              className="yz-icon-only yz-search-mobile"
              aria-label={t('搜索项目')}
              onClick={() => setSearch(true)}
            >
              <Search size={19} />
            </button>
            <Link
              to="/usage"
              className="yz-credit"
              aria-label={t('查看额度明细')}
              title={workspace?.isDemo ? t('本机测试额度') : t('可用额度')}
            >
              <Zap size={14} aria-hidden="true" />
              <strong>{creditLabel}</strong>
              <span>{t('积分')}</span>
            </Link>
            <button
              type="button"
              aria-label={
                t('当前进度') +
                (taskActivity.total
                  ? ' · ' + taskActivity.total + ' ' + t('项进行中或需要处理')
                  : '')
              }
              className={'yz-progress' + (taskActivity.total ? ' has-activity' : '')}
              onClick={() => setTasks(true)}
            >
              <span className="yz-progress-dot" aria-hidden="true" />
              <span className="yz-progress-label">{t('当前进度')}</span>
              {!!taskActivity.total && <b>{taskActivity.total}</b>}
            </button>
            <NotificationCenter />
            <button
              type="button"
              className="yz-icon-only yz-mobile-menu"
              aria-label={t('展开导航')}
              aria-haspopup="dialog"
              aria-expanded={panel !== null && panelOrigin === 'mobile'}
              onClick={() => openPanel('navigation', 'mobile')}
            >
              <Menu size={21} />
            </button>
          </div>
        </header>

        <main
          id="main-content"
          className={'yz-content' + (isManagement ? ' is-management' : '')}
          tabIndex={-1}
        >
          <Outlet />
        </main>
      </div>

      {/* ---------------- Mobile dock ---------------- */}
      <nav className="yz-dock" aria-label={t('主导航')}>
        {primaryNavigation.map((item) => {
          const active = matchesNavigation(routeLocation.pathname, item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={active ? 'is-active' : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>{t(item.label)}</span>
              {item.to === '/tasks' && !!taskActivity.total && (
                <i aria-hidden="true">{taskActivity.total}</i>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ---------------- Panels ---------------- */}
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
        <div className="yz-panel" ref={panelContent}>
          {(panel === 'workspace' || panel === 'account') && (
            <Button
              variant="ghost"
              className="yz-panel-back"
              onClick={() => setPanel(panelOrigin === 'mobile' ? 'navigation' : 'more')}
            >
              <ArrowLeft size={16} />
              {t('返回导航')}
            </Button>
          )}
          {panel === 'navigation' && (
            <nav className="yz-panel-primary" aria-label={t('主导航')}>
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
                  </Link>
                );
              })}
            </nav>
          )}
          {(panel === 'navigation' || panel === 'more') && (
            <>
              <Link
                to="/usage"
                className="yz-panel-credit"
                aria-label={t('查看额度明细')}
                onClick={closeNavigation}
              >
                <span className="yz-panel-credit-label">
                  {workspace?.isDemo ? t('本机测试额度') : t('可用额度')}
                </span>
                <strong>{creditLabel}</strong>
                <span className="yz-panel-credit-unit">{t('积分')}</span>
              </Link>
              {workspace?.isDemo && <p className="yz-panel-demo">{t('演示空间 · 测试数据')}</p>}
              {moreNavigation.map((group) => (
                <section className="yz-panel-group" key={group.label} aria-label={t(group.label)}>
                  <h3>{t(group.label)}</h3>
                  <div>
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
                          <item.icon size={18} strokeWidth={1.75} aria-hidden="true" />
                          <span>{t(item.label)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
              {accountLinks}
            </>
          )}
          {panel === 'workspace' && (
            <section className="yz-panel-spaces" aria-label={t('工作空间')}>
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
                  <span className="yz-avatar is-space" aria-hidden="true">
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
            <section className="yz-panel-profile" aria-label={t('账户')}>
              <span className="yz-avatar is-large" aria-hidden="true">
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
        <div className="yz-search">
          <div className="yz-search-field">
            <Search size={18} aria-hidden="true" />
            <input
              autoFocus
              placeholder={t('搜索项目名称…')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t('搜索项目')}
            />
          </div>
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

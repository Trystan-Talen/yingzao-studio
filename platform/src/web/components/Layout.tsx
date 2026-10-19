import { TOOLS } from '../../contracts/catalog';
import { t } from '../lib/i18n';
import { Onboarding } from './Onboarding';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  Code2,
  FolderOpen,
  HelpCircle,
  Image,
  Layers3,
  LayoutGrid,
  LogOut,
  Menu,
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
import { Badge, Drawer, Empty, IconButton, Modal, useAction } from './ui';
import { TaskCenter } from './TaskCenter';
import { NotificationCenter } from './NotificationCenter';
import { TeamCreation } from './TeamCreation';
const nav = [
  {
    title: '创作',
    items: [
      { to: '/', label: '灵感广场', en: 'Inspiration', ar: 'الإلهام', icon: LayoutGrid },
      {
        to: '/workbench',
        label: '创作工作台',
        en: 'Workspace',
        ar: 'مساحة الإبداع',
        icon: Layers3,
      },
      { to: '/tools', label: 'AI 工具', en: 'AI tools', ar: 'أدوات الذكاء', icon: Sparkles },
    ],
  },
  {
    title: '管理',
    items: [
      { to: '/projects', label: '项目', en: 'Projects', ar: 'المشاريع', icon: FolderOpen },
      { to: '/assets', label: '素材', en: 'Assets', ar: 'الأصول', icon: Image },
      { to: '/brands', label: '品牌', en: 'Brands', ar: 'العلامات', icon: Workflow },
      { to: '/characters', label: '人物', en: 'Characters', ar: 'الشخصيات', icon: UserRound },
    ],
  },
  {
    title: '协作',
    items: [
      { to: '/team', label: '团队', en: 'Team', ar: 'الفريق', icon: Users },
      {
        to: '/usage',
        label: '用量与订单',
        en: 'Usage & billing',
        ar: 'الاستخدام والفواتير',
        icon: Wallet,
      },
    ],
  },
];
export function Layout() {
  const routeLocation = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [routeLocation.pathname]);
  const { session, workspace, switchWorkspace, signOut } = useStudio();
  const [mobile, setMobile] = useState(false);
  const [spaces, setSpaces] = useState(false);
  const [createSpace, setCreateSpace] = useState(false);
  const [tasks, setTasks] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState('');
  const credit = useApi<CreditDto>('/credits', !!workspace, 30000);
  const projects = useApi<Page<ProjectDto>>(
    `/projects?q=${encodeURIComponent(q)}&pageSize=8`,
    search && q.length > 0,
  );
  const navigate = useNavigate();
  const action = useAction();
  const locale = session?.user.preferences.locale;
  const translated = (item: { label: string; en: string; ar: string }) =>
    locale === 'en' ? item.en : locale === 'ar' ? item.ar : item.label;
  const sidebar = (
    <>
      <a className="wordmark" href="/">
        <span className="brand-mark">{t('映')}</span>
        <strong>
          {t('映造')}
          <span>Studio</span>
        </strong>
      </a>
      <div className="workspace-wrap">
        <button
          className="workspace-switch"
          onClick={() => setSpaces(!spaces)}
          aria-expanded={spaces}
        >
          <span className="workspace-avatar">{workspace?.name.slice(0, 1) ?? '我'}</span>
          <span>
            <strong>{workspace?.name ?? '选择工作空间'}</strong>
            <small>
              {workspace?.kind === 'team' ? t('团队空间') : t('个人空间')}
              {workspace?.isDemo ? t(' · 演示') : ''}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        {spaces && (
          <div className="workspace-menu">
            {session?.workspaces.map((space) => (
              <button
                key={space.id}
                onClick={() =>
                  void action.run(async () => {
                    const changed = await switchWorkspace(space.id);
                    setSpaces(false);
                    if (changed) navigate('/');
                  })
                }
              >
                {space.name}
                {space.id === workspace?.id && <Badge tone="green">{t('当前')}</Badge>}
              </button>
            ))}
            <button
              onClick={() => {
                setCreateSpace(true);
                setSpaces(false);
              }}
            >
              {t('＋ 创建团队空间')}
            </button>
          </div>
        )}
      </div>
      <nav className="navigation" aria-label={t('主导航')}>
        {nav.map((group) => (
          <div className="nav-group" key={group.title}>
            <span className="nav-group-label">
              {locale === 'en'
                ? { 创作: 'CREATE', 管理: 'LIBRARY', 协作: 'WORKSPACE' }[group.title]
                : locale === 'ar'
                  ? { 创作: 'إنشاء', 管理: 'المكتبة', 协作: 'التعاون' }[group.title]
                  : group.title}
            </span>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobile(false)}
              >
                <item.icon size={19} strokeWidth={1.75} />
                <span>{translated(item)}</span>
                {item.to === '/tools' && <span className="nav-count">{TOOLS.length}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="credit-card">
          <span>
            <span className="credit-dot" /> {workspace?.isDemo ? t('本机测试额度') : t('可用额度')}
          </span>
          <div>
            <strong>{credit.data?.available.toLocaleString() ?? '—'}</strong>
            <NavLink to="/usage" aria-label={t('查看额度明细')}>
              {t('详情 ↗')}
            </NavLink>
          </div>
          <div className="credit-line" />
        </div>
        <NavLink to="/developer">
          <Code2 size={18} />
          {locale === 'en' ? 'Developer' : locale === 'ar' ? 'المطور' : t('开发者')}
        </NavLink>
        <NavLink to="/settings">
          <Settings2 size={18} />
          {locale === 'en' ? 'Settings' : locale === 'ar' ? 'الإعدادات' : t('设置')}
        </NavLink>
        <NavLink to="/support">
          <HelpCircle size={18} />
          {locale === 'en' ? 'Help & support' : locale === 'ar' ? 'المساعدة' : t('帮助与支持')}
        </NavLink>
        <div className="user-row">
          <span className="user-avatar">{session?.user.displayName.slice(0, 1)}</span>
          <div>
            <strong>{session?.user.displayName}</strong>
            <small>
              {workspace?.role === 'owner'
                ? t('空间创建者')
                : workspace?.role === 'viewer'
                  ? t('只读成员')
                  : t('空间成员')}
            </small>
          </div>
          <IconButton label={t('退出登录')} onClick={() => void action.run(signOut)}>
            <LogOut size={16} />
          </IconButton>
        </div>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <Onboarding />
      <aside className="sidebar">{sidebar}</aside>
      <div className="main-shell">
        <header className="topbar">
          <IconButton label={t('展开导航')} className="mobile-menu" onClick={() => setMobile(true)}>
            <Menu size={20} />
          </IconButton>
          <span className="topbar-location">
            {t('工作空间')}
            <span>/</span> <strong>{t('映造 Studio')}</strong>
          </span>
          <div className="topbar-actions">
            {workspace?.isDemo && <span className="demo-label">{t('演示空间')}</span>}
            <IconButton label={t('全局搜索')} onClick={() => setSearch(true)}>
              <Search size={19} />
            </IconButton>
            <NotificationCenter />
            <button
              aria-label={t('任务中心')}
              className="task-button"
              onClick={() => setTasks(true)}
            >
              <Workflow size={16} />
              <span>{t('任务中心')}</span>
            </button>
          </div>
        </header>
        <main>
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>{t('映造 Studio')}</span>
          <span>{t('从想法出发，让创作发生。')}</span>
        </footer>
      </div>
      <Drawer open={mobile} onClose={() => setMobile(false)} title={t('映造 Studio')}>
        <div className="mobile-sidebar">{sidebar}</div>
      </Drawer>
      <TaskCenter open={tasks} onClose={() => setTasks(false)} />
      <Modal open={search} onClose={() => setSearch(false)} title={t('搜索工作空间')}>
        <input
          autoFocus
          placeholder={t('搜索项目名称…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('搜索项目')}
        />
        {projects.data?.items.map((project) => (
          <button
            key={project.id}
            className="search-result"
            onClick={() => {
              navigate(`/workbench/${project.id}`);
              setSearch(false);
            }}
          >
            <FolderOpen size={18} />
            {project.name}
          </button>
        ))}
        {q && projects.data?.items.length === 0 && <Empty title={t('没有找到相关项目')} />}
      </Modal>
      <TeamCreation open={createSpace} onClose={() => setCreateSpace(false)} />
    </div>
  );
}

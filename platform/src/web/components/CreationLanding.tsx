import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  FolderOpen,
  Image,
  LayoutTemplate,
  Plus,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { originalInspirations } from '../../contracts/inspirations';
import type { AssetDto } from '../../contracts/core';
import { useApi, type Page } from '../lib/api';
import type { Job } from '../lib/tasks';
import { t } from '../lib/i18n';
import { Composer, type ComposerController } from './Composer';
import { Button, Empty, ErrorState, Loading, Modal } from './ui';
import { JobCard } from './TaskCenter';
import { useStudio } from '../context';
import '../styles/creative-studio.css';
import '../styles/brand/create.css';

type Idea = (typeof originalInspirations)[number];

const discoveryOrder = [
  'botanical-serum',
  'amber-perfume',
  'studio-headphones',
  'citrus-drink',
  'leather-bag',
  'sculptural-lamp',
  'trail-sneaker',
  'matcha-ritual',
];
/** The rotating object in the greeting follows the chosen medium. */
const rotatingWords = {
  image: ['商品主图', '种草海报', '白底图', '场景大片', '营销物料'],
  video: ['种草短片', '产品广告', '开箱视频', '品牌短片', '口播视频'],
} as const;

function greetingFor(hour: number) {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function useRotatingIndex(length: number, interval = 2600) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % length), interval);
    return () => window.clearInterval(timer);
  }, [length, interval]);
  return index;
}

const capabilities = [
  { to: '/detail-pages', label: '商品详情页', hint: '整套长图', icon: LayoutTemplate },
  { to: '/tools', label: 'AI 工具', hint: '抠图 · 扩图 · 高清', icon: Wand2 },
  { to: '/assets', label: '我的素材', hint: '上传与复用', icon: FolderOpen },
  { to: '/inspiration', label: '灵感广场', hint: '海量案例', icon: Sparkles },
];

export function CreationLanding() {
  const [params, setParams] = useSearchParams();
  const requestedKind =
    params.get('kind') === 'video' ? 'video' : params.get('kind') === 'image' ? 'image' : undefined;
  const [kind, setKind] = useState<'image' | 'video'>(requestedKind ?? 'image');
  const sourceAssetId = params.get('asset');
  const { session } = useStudio();
  const words = rotatingWords[kind];
  const wordIndex = useRotatingIndex(words.length);
  const greeting = greetingFor(new Date().getHours());
  const [reuseError, setReuseError] = useState('');
  const controller = useRef<ComposerController>(null);
  const focusPromptAfterPreview = useRef(false);
  const source = useApi<AssetDto>(
    `/assets/${encodeURIComponent(sourceAssetId ?? '')}`,
    !!sourceAssetId,
  );
  const [view, setView] = useState<'inspiration' | 'recent'>('inspiration');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Idea | null>(null);
  const recent = useApi<Page<Job>>('/jobs?archived=false&pageSize=6', view === 'recent', 5000);
  const discoveryIdeas = discoveryOrder
    .map((id) => originalInspirations.find((item) => item.id === id))
    .filter((item): item is Idea => !!item);
  const categories = [...new Set(originalInspirations.map((item) => item.category))];
  const clearSource = () => {
    const next = new URLSearchParams(params);
    next.delete('asset');
    setParams(next, { replace: true });
    setReuseError('');
  };
  const applyIdea = (mode: 'replace' | 'append') => {
    if (!selected) return;
    controller.current?.setIdea(t(selected.prompt), mode);
    focusPromptAfterPreview.current = true;
    setSelected(null);
  };
  const visibleIdeas = discoveryIdeas.filter(
    (item) => category === 'all' || item.category === category,
  );

  return (
    <div className="creation-studio yz-create">
      <div className="yz-aurora" aria-hidden="true">
        <span className="yz-aurora-a" />
        <span className="yz-aurora-b" />
        <span className="yz-aurora-c" />
        <span className="yz-gridlines" />
      </div>

      <header className="studio-launch-heading yz-hero">
        <p className="yz-greeting">
          <span className="yz-kicker-dot" aria-hidden="true" />
          {t(greeting)}
          {session?.user.displayName ? `，${session.user.displayName}` : ''}
        </p>
        <h1 aria-label={t('今天想映造什么？')}>
          <span aria-hidden="true">{t('今天想')}</span>
          <em aria-hidden="true">{t('映造')}</em>
          <span className="yz-rotator" aria-hidden="true">
            <span key={`${kind}-${wordIndex}`} className="yz-rotator-word">
              {t(words[wordIndex] ?? words[0])}
            </span>
            <span className="yz-caret" />
          </span>
        </h1>
      </header>

      <section className="studio-launch yz-launch" aria-label={t('快速创作')}>
        <div className="studio-compose-shell yz-compose-shell">
          {sourceAssetId && (
            <section className="composer-reuse-notice" aria-label={t('复用素材')}>
              {source.isLoading ? (
                <Loading label={t('正在读取参考素材…')} />
              ) : source.error ? (
                <ErrorState error={source.error} retry={source.refetch} />
              ) : (
                source.data && (
                  <>
                    <p>
                      {t('将此素材添加到当前草稿：')}
                      <strong>{source.data.name}</strong>
                    </p>
                    <div className="inline-actions">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          try {
                            controller.current?.addReference(source.data!);
                            clearSource();
                          } catch (error) {
                            setReuseError(
                              error instanceof Error ? error.message : t('无法添加参考素材'),
                            );
                          }
                        }}
                      >
                        {t('添加为参考')}
                      </Button>
                      <Button variant="ghost" onClick={clearSource}>
                        {t('取消')}
                      </Button>
                    </div>
                  </>
                )
              )}
              {reuseError && (
                <p role="alert" className="field-error">
                  {reuseError}
                </p>
              )}
              {source.error && (
                <Button variant="ghost" onClick={clearSource}>
                  {t('取消')}
                </Button>
              )}
            </section>
          )}
          <Composer
            presentation="quick"
            visualVariant="studio"
            requestedKind={requestedKind}
            controllerRef={controller}
            onKindChange={(nextKind) => {
              setKind(nextKind);
              const next = new URLSearchParams(params);
              next.set('kind', nextKind);
              setParams(next, { replace: true });
            }}
          />
        </div>
      </section>

      <p className="yz-result-hint">
        {t('参考图可直接拖到「添加素材」 · 生成的作品自动保存到项目，进度可在')}{' '}
        <Link to="/tasks">{t('任务')}</Link> {t('中查看')}
      </p>

      <nav className="studio-shortcuts yz-capabilities" aria-label={t('更多创作入口')}>
        {capabilities.map((item) => (
          <Link key={item.to} to={item.to} className="yz-capability">
            <span className="yz-capability-icon">
              <item.icon size={17} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="yz-capability-text">
              <strong>{t(item.label)}</strong>
              <small>{t(item.hint)}</small>
            </span>
            <ArrowUpRight className="yz-capability-arrow" size={15} aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <section className="studio-discover yz-discover" aria-label={t('创作灵感')}>
        <header className="yz-section-head">
          <div className="yz-section-title">
            <span className="yz-section-index" aria-hidden="true">
              01
            </span>
            <h2>
              {t(view === 'recent' ? '最近创作' : '灵感')}
              <span aria-hidden="true">{view === 'recent' ? 'RECENT' : 'INSPIRATION'}</span>
            </h2>
          </div>
          <div className="yz-section-actions">
            <div className="segments" role="group" aria-label={t('浏览内容')}>
              <button
                type="button"
                className={view === 'inspiration' ? 'active' : undefined}
                aria-pressed={view === 'inspiration'}
                onClick={() => setView('inspiration')}
              >
                <Sparkles size={14} aria-hidden="true" />
                {t('灵感推荐')}
              </button>
              <button
                type="button"
                className={view === 'recent' ? 'active' : undefined}
                aria-pressed={view === 'recent'}
                onClick={() => setView('recent')}
              >
                <Clock3 size={14} aria-hidden="true" />
                {t('最近创作')}
              </button>
            </div>
            <Link to={view === 'recent' ? '/tasks' : '/inspiration'} className="yz-link-arrow">
              {t(view === 'recent' ? '全部记录' : '浏览灵感库')}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </header>

        {view === 'inspiration' ? (
          <>
            <div className="yz-chips" role="group" aria-label={t('灵感分类')}>
              {['all', ...categories].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                >
                  {t(value === 'all' ? '全部' : value)}
                </button>
              ))}
            </div>
            {kind === 'video' && (
              <p className="yz-note">{t('以下为静态画面灵感，可用于构思视频；不是视频成片。')}</p>
            )}
            <div className="yz-masonry">
              {visibleIdeas.map((idea, index) => (
                <button
                  className="studio-idea-card yz-idea"
                  type="button"
                  key={idea.id}
                  style={{ '--i': index } as CSSProperties}
                  onClick={() => setSelected(idea)}
                  aria-label={`${t('预览灵感')}：${t(idea.title)}`}
                >
                  <img src={`/gallery/${idea.id}.webp`} alt={t(idea.title)} loading="lazy" />
                  <span className="yz-idea-tag">{t(idea.category)}</span>
                  <span className="yz-idea-caption">
                    <span>
                      <strong>{t(idea.title)}</strong>
                      <small>{t(idea.tag)}</small>
                    </span>
                    <span className="yz-idea-use" aria-hidden="true">
                      <Plus size={18} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="yz-note">{t('原创画面示例 · 点击预览，选择后再填入想法')}</p>
          </>
        ) : recent.isLoading ? (
          <Loading />
        ) : recent.error ? (
          <ErrorState error={recent.error} retry={recent.refetch} />
        ) : recent.data?.items.length ? (
          <div className="studio-recent-grid yz-recent">
            {recent.data.items.map((job) => (
              <JobCard key={job.id} job={job} showProjectLink compact />
            ))}
          </div>
        ) : (
          <Empty
            icon={<Image size={28} />}
            title={t('还没有创作记录')}
            description={t('写下想法，完成的作品会保存在这里。')}
          />
        )}
      </section>

      <footer className="yz-signature" aria-hidden="true">
        <span>YINGZAO</span>
        <span>{t('映造')}</span>
      </footer>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        onCloseAutoFocus={(event) => {
          if (!focusPromptAfterPreview.current) return;
          focusPromptAfterPreview.current = false;
          event.preventDefault();
          controller.current?.focusPrompt();
        }}
        title={selected ? t(selected.title) : t('预览灵感')}
        wide
      >
        {selected && (
          <div className="studio-idea-preview yz-preview">
            <div className="yz-preview-media">
              <img src={`/gallery/${selected.id}.webp`} alt={t(selected.title)} />
            </div>
            <div className="yz-preview-copy">
              <span className="eyebrow">{t(selected.category)}</span>
              <h3>{t('从这个画面开始')}</h3>
              <p className="yz-preview-prompt">{t(selected.prompt)}</p>
              <p className="muted small">{t('仅填入想法，不添加示例图片，也不会开始生成。')}</p>
              {controller.current?.getPrompt().trim() ? (
                <>
                  <div className="yz-preview-existing">
                    <strong>{t('你正在写的需求')}</strong>
                    <p>{controller.current.getPrompt()}</p>
                  </div>
                  <div className="yz-preview-actions">
                    <Button variant="secondary" onClick={() => applyIdea('append')}>
                      {t('补充到当前需求')}
                    </Button>
                    <Button onClick={() => applyIdea('replace')}>{t('替换当前需求')}</Button>
                  </div>
                </>
              ) : (
                <Button className="yz-preview-cta" onClick={() => applyIdea('replace')}>
                  <Plus size={16} />
                  {t('使用这个想法')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

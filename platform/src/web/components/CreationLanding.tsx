import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Image, Clock3, Plus, Sparkles } from 'lucide-react';
import { originalInspirations } from '../../contracts/inspirations';
import type { AssetDto } from '../../contracts/core';
import { useApi, type Page } from '../lib/api';
import type { Job } from '../lib/tasks';
import { t } from '../lib/i18n';
import { Composer, type ComposerController } from './Composer';
import { Button, Empty, ErrorState, Loading, Modal } from './ui';
import { JobCard } from './TaskCenter';
import '../styles/creative-studio.css';

export function CreationLanding() {
  const [params, setParams] = useSearchParams();
  const requestedKind =
    params.get('kind') === 'video' ? 'video' : params.get('kind') === 'image' ? 'image' : undefined;
  const [kind, setKind] = useState<'image' | 'video'>(requestedKind ?? 'image');
  const sourceAssetId = params.get('asset');
  const [reuseError, setReuseError] = useState('');
  const controller = useRef<ComposerController>(null);
  const focusPromptAfterPreview = useRef(false);
  const source = useApi<AssetDto>(
    `/assets/${encodeURIComponent(sourceAssetId ?? '')}`,
    !!sourceAssetId,
  );
  const [view, setView] = useState<'inspiration' | 'recent'>('inspiration');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<(typeof originalInspirations)[number] | null>(null);
  const recent = useApi<Page<Job>>('/jobs?archived=false&pageSize=6', view === 'recent', 5000);
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
  const discoveryIdeas = discoveryOrder.map((id) =>
    originalInspirations.find((item) => item.id === id)!,
  );
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
  return (
    <div className="creation-studio">
      <header className="studio-launch-heading">
        <span className="studio-eyebrow">{t('为商品，创造更多可能')}</span>
        <h1>{t('好作品，从一个想法开始')}</h1>
        <p>{t('商品图、营销海报和短视频，一处开始。')}</p>
      </header>
      <section className="studio-launch" aria-label={t('快速创作')}>
        <div className="studio-compose-shell">
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
      <div className="studio-shortcuts" aria-label={t('更多创作入口')}>
        <Link to="/detail-pages">
          <Image size={15} />
          {t('商品详情页')}
          <ArrowRight size={13} />
        </Link>
        <Link to="/assets">
          <Plus size={15} />
          {t('我的素材')}
          <ArrowRight size={13} />
        </Link>
      </div>
      <section className="studio-discover" aria-label={t('创作灵感')}>
        <div className="studio-discover-toolbar">
          <div className="studio-view-tabs" role="group" aria-label={t('浏览内容')}>
            <button
              type="button"
              aria-pressed={view === 'inspiration'}
              onClick={() => setView('inspiration')}
            >
              <Sparkles size={16} />
              {t('灵感推荐')}
            </button>
            <button
              type="button"
              aria-pressed={view === 'recent'}
              onClick={() => setView('recent')}
            >
              <Clock3 size={16} />
              {t('最近创作')}
            </button>
          </div>
          <Link to={view === 'recent' ? '/tasks' : '/inspiration'} className="text-button">
            {t(view === 'recent' ? '全部记录' : '浏览灵感库')}
            <ArrowRight size={14} />
          </Link>
        </div>
        {view === 'inspiration' ? (
          <>
            <div className="studio-gallery-filters" role="group" aria-label={t('灵感分类')}>
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
              <p className="studio-gallery-note">
                {t('以下为静态画面灵感，可用于构思视频；不是视频成片。')}
              </p>
            )}
            <div className="studio-idea-grid">
              {discoveryIdeas
                .filter((item) => category === 'all' || item.category === category)
                .map((idea) => (
                  <button
                    className="studio-idea-card"
                    type="button"
                    key={idea.id}
                    onClick={() => setSelected(idea)}
                    aria-label={`${t('预览灵感')}：${t(idea.title)}`}
                  >
                    <img src={`/gallery/${idea.id}.webp`} alt={t(idea.title)} loading="lazy" />
                    <span className="studio-idea-caption">
                      <span>
                        <strong>{t(idea.title)}</strong>
                        <small>{t(idea.tag)}</small>
                      </span>
                      <Plus size={20} />
                    </span>
                  </button>
                ))}
            </div>
            <p className="studio-gallery-note">{t('原创画面示例 · 点击预览，选择后再填入想法')}</p>
          </>
        ) : recent.isLoading ? (
          <Loading />
        ) : recent.error ? (
          <ErrorState error={recent.error} retry={recent.refetch} />
        ) : recent.data?.items.length ? (
          <div className="studio-recent-grid">
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
          <div className="studio-idea-preview">
            <img src={`/gallery/${selected.id}.webp`} alt={t(selected.title)} />
            <div className="studio-idea-preview-copy">
              <span className="studio-preview-category">{t(selected.category)}</span>
              <h3>{t('从这个画面开始')}</h3>
              <p>{t(selected.prompt)}</p>
              <p className="muted">{t('仅填入想法，不添加示例图片，也不会开始生成。')}</p>
              {controller.current?.getPrompt().trim() ? (
                <>
                  <div className="studio-existing-idea">
                    <strong>{t('你正在写的需求')}</strong>
                    <p>{controller.current.getPrompt()}</p>
                  </div>
                  <div className="studio-preview-actions">
                    <Button variant="secondary" onClick={() => applyIdea('append')}>
                      {t('补充到当前需求')}
                    </Button>
                    <Button onClick={() => applyIdea('replace')}>{t('替换当前需求')}</Button>
                  </div>
                </>
              ) : (
                <Button onClick={() => applyIdea('replace')}>
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

import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Sparkles } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Composer } from '../components/Composer';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  Notice,
  useAction,
} from '../components/ui';
import { api, post, put, patch, qs, useApi, useRefresh, type Page } from '../lib/api';
import type { AssetDto } from '../../contracts/core';
import {
  reuseInspirationSchema,
  type InspirationDto,
  type InspirationReuseDto,
  videoInspirationCategorySchema,
  VIDEO_INSPIRATION_LABELS,
} from '../../contracts/inspirations';
import { useStudio } from '../context';
import { AssetPicker } from '../components/AssetPicker';
export function Inspiration() {
  const { isAdmin, session, workspace } = useStudio();
  const reuseKey = `yingzao:inspiration-reuse:v1:${session?.user.id}:${workspace?.id}`;
  const currentScope = useRef<string | null>(reuseKey);
  currentScope.current = reuseKey;
  const [pendingReuse, setPendingReuse] = useState<{
    key: string;
    id: string;
    requestId: string;
    prompt: string;
    language: string;
    intent: 'create' | 'replicate';
  } | null>(null);
  const [reuseError, setReuseError] = useState('');
  useEffect(() => {
    currentScope.current = reuseKey;
    try {
      const raw = localStorage.getItem(reuseKey);
      if (!raw) setPendingReuse(null);
      else {
        const saved = JSON.parse(raw) as Record<string, unknown>;
        if (typeof saved.id !== 'string' || !saved.id || saved.id.length > 80)
          throw new Error('invalid inspiration');
        const request = reuseInspirationSchema.parse({
          requestId: saved.requestId,
          prompt: saved.prompt,
          language: saved.language,
          intent: saved.intent,
        });
        setPendingReuse({ key: reuseKey, id: saved.id, ...request });
      }
      setReuseError('');
    } catch {
      setReuseError('上次灵感复用记录无法读取，请先检查项目列表，避免重复创建。');
    }
    return () => {
      currentScope.current = null;
    };
  }, [reuseKey]);
  const pending = pendingReuse?.key === reuseKey ? pendingReuse : null;
  const [category, setCategory] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = ['image', 'video'].includes(searchParams.get('kind') ?? '')
    ? searchParams.get('kind')!
    : '';
  const parsedVideoCategory = videoInspirationCategorySchema.safeParse(
    searchParams.get('videoCategory'),
  );
  const videoCategory =
    kind === 'video' && parsedVideoCategory.success ? parsedVideoCategory.data : '';
  const [newVideoCategory, setNewVideoCategory] = useState('');
  const [platform, setPlatform] = useState('');
  const [page, setPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [manage, setManage] = useState(false);
  const [newAssets, setNewAssets] = useState<AssetDto[]>([]);
  const [form, setForm] = useState({
    title: '',
    category: '',
    tag: '',
    platform: '通用电商',
    ratio: '3:4',
    prompt: '',
    source: '',
  });
  const [selected, setSelected] = useState<InspirationDto | null>(null);
  const [prompt, setPrompt] = useState('');
  const [q, setQ] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const catalog = useApi<Page<InspirationDto>>(
    `/inspirations${qs({ page, pageSize: 12, q, category, kind, videoCategory, platform, favorite: onlyFavorites || undefined, archived: showArchived || undefined })}`,
  );
  const facets = useApi<{ categories: string[]; platforms: string[] }>('/inspirations/facets');
  const favoriteSet = new Set(catalog.data?.items.filter((i) => i.isFavorite).map((i) => i.id));
  const action = useAction();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const filtered = catalog.data?.items ?? [];
  async function addInspiration() {
    const asset = newAssets[0];
    if (!asset) return;
    await action.run(async () => {
      await post('/inspirations', {
        ...form,
        assetId: asset.id,
        kind: asset.kind,
        videoCategory: asset.kind === 'video' ? newVideoCategory || null : null,
        color: '#eaf1ec',
      });
      setManage(false);
      setNewAssets([]);
      setNewVideoCategory('');
      setForm({
        title: '',
        category: '',
        tag: '',
        platform: '通用电商',
        ratio: '3:4',
        prompt: '',
        source: '',
      });
      setPage(1);
      await refresh();
    });
  }
  async function create(resume = false, intent: 'create' | 'replicate' = 'create') {
    if (!workspace || (!selected && !resume)) return;
    const targetWorkspace = workspace.id,
      targetKey = reuseKey;
    await action.run(async () => {
      if (pending && !resume) throw new Error('请先找回上次复用结果，再开始新的创作。');
      const request = resume
        ? pending
        : {
            key: targetKey,
            id: selected!.id,
            requestId: crypto.randomUUID(),
            prompt,
            language: session?.user.preferences.defaultCreationLanguage ?? 'zh-CN',
            intent,
          };
      if (!request) return;
      const payload = reuseInspirationSchema.parse({
        requestId: request.requestId,
        prompt: request.prompt,
        language: request.language,
        intent: request.intent,
      });
      localStorage.setItem(targetKey, JSON.stringify(request));
      setPendingReuse(request);
      setSelected(null);
      const result = await api<InspirationReuseDto>(
        `/inspirations/${encodeURIComponent(request.id)}/reuse`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        targetWorkspace,
      );
      localStorage.removeItem(targetKey);
      if (currentScope.current !== targetKey) return;
      setPendingReuse(null);
      navigate(
        result.draft.operation === 'video.motion-replica'
          ? `/tools/video-replica?projectId=${result.project.id}`
          : `/workbench/${result.project.id}`,
      );
    });
  }
  return (
    <div className="page inspiration-page">
      <PageHeader
        eyebrow="CREATIVE WORKSPACE"
        title={t('让好想法，有好作品。')}
        description={t('从一份灵感出发，把脑海里的画面变成你的下一件作品。')}
        action={
          <span className="hero-stamp">
            <Sparkles size={15} />
            {t('为创作者而造')}
          </span>
        }
      />
      {(pending || reuseError) && (
        <Notice tone="warning">
          <p>{reuseError || `上次灵感复用结果待确认：${pending?.prompt.slice(0, 80)}`}</p>
          <p>继续会使用原请求编号找回同一个项目，不会调用模型。</p>
          {pending && (
            <Button busy={action.busy} variant="secondary" onClick={() => void create(true)}>
              继续上次灵感复用
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                localStorage.removeItem(reuseKey);
                setPendingReuse(null);
                setReuseError('');
              })
            }
          >
            已检查项目，清除复用记录
          </Button>
        </Notice>
      )}
      <Composer />
      <section className="inspiration-section">
        <div className="section-heading">
          <div>
            <h2>
              {t('探索灵感')}
              <span className="count-dot">{catalog.data?.total ?? 0}</span>
            </h2>
            <p className="muted">{t('不同风格，同样值得开始。')}</p>
          </div>
          <div className="inline-actions">
            {isAdmin && (
              <Button variant="secondary" onClick={() => setManage(true)}>
                {t('新增灵感')}
              </Button>
            )}
            <IconButton
              label={onlyFavorites ? t('显示全部灵感') : t('仅显示已收藏')}
              className={onlyFavorites ? 'is-active' : ''}
              onClick={() => {
                setOnlyFavorites(!onlyFavorites);
                setPage(1);
              }}
            >
              <Bookmark size={18} />
            </IconButton>
            <input
              className="small-search"
              aria-label={t('搜索灵感')}
              placeholder={t('寻找灵感…')}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="category-tabs">
          {['', ...(facets.data?.categories ?? [])].map((item) => (
            <button
              key={item}
              className={category === item ? 'active' : ''}
              onClick={() => {
                setCategory(item);
                setPage(1);
              }}
            >
              {t(item || '全部')}
            </button>
          ))}
        </div>
        <div className="inline-actions inspiration-filters">
          <select
            aria-label={t('灵感类型')}
            value={kind}
            onChange={(e) => {
              const value = e.target.value;
              setSearchParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  if (value) next.set('kind', value);
                  else next.delete('kind');
                  next.delete('videoCategory');
                  return next;
                },
                { replace: true },
              );
              setPage(1);
            }}
          >
            <option value="">{t('所有类型')}</option>
            <option value="image">{t('图片')}</option>
            <option value="video">{t('视频')}</option>
          </select>
          {kind === 'video' && (
            <select
              aria-label={t('视频内容分类')}
              value={videoCategory}
              onChange={(event) => {
                const value = event.target.value;
                setSearchParams(
                  (previous) => {
                    const next = new URLSearchParams(previous);
                    if (value) next.set('videoCategory', value);
                    else next.delete('videoCategory');
                    return next;
                  },
                  { replace: true },
                );
                setPage(1);
              }}
            >
              <option value="">{t('全部视频内容')}</option>
              {videoInspirationCategorySchema.options.map((value) => (
                <option key={value} value={value}>
                  {t(VIDEO_INSPIRATION_LABELS[value])}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label={t('发布平台')}
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('所有平台')}</option>
            {facets.data?.platforms.map((p) => (
              <option key={p} value={p}>
                {t(p)}
              </option>
            ))}
          </select>
          {isAdmin && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => {
                  setShowArchived(e.target.checked);
                  setPage(1);
                }}
              />
              {t('包含已下架')}
            </label>
          )}
        </div>
        {catalog.isLoading && <Loading />}
        {catalog.error && <ErrorState error={catalog.error} retry={() => void catalog.refetch()} />}
        <div className="masonry">
          {filtered.map((item) => (
            <article className="inspiration-card" key={item.id}>
              <button
                className="inspiration-image"
                aria-label={`${item.title} · ${t('以此创作')}`}
                style={{ background: item.color }}
                onClick={() => {
                  setSelected(item);
                  setPrompt(item.prompt);
                }}
              >
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt={item.title} loading="lazy" />
                ) : (
                  <div className="media-placeholder" style={{ minHeight: 240 }}>
                    {t(item.mediaUnavailable ? '素材已不可用' : '视频灵感')}
                  </div>
                )}
                {item.kind === 'video' && (
                  <span className="sample-label">
                    {t('视频')}
                    {item.videoCategory
                      ? ` · ${t(VIDEO_INSPIRATION_LABELS[item.videoCategory])}`
                      : ''}
                  </span>
                )}
                <span className="image-overlay">
                  <span>{t('以此创作')}</span>
                  <ArrowUpRight size={20} />
                </span>
              </button>
              <button
                className={`save-inspiration ${favoriteSet.has(item.id) ? 'saved' : ''}`}
                aria-label={`${t(favoriteSet.has(item.id) ? '取消收藏' : '收藏')} ${item.title}`}
                onClick={() =>
                  void action.run(async () => {
                    await put(`/inspirations/${item.id}/favorite`, {
                      favorite: !favoriteSet.has(item.id),
                    });
                    await refresh();
                  })
                }
              >
                <Bookmark size={16} fill={favoriteSet.has(item.id) ? 'currentColor' : 'none'} />
              </button>
              <div className="inspiration-caption">
                <div>
                  <h3>{item.title}</h3>
                  <span>{item.tag}</span>
                </div>
                <span className="sample-label">{t(item.archived ? '已下架' : '灵感示例')}</span>
              </div>
            </article>
          ))}
        </div>
        {!catalog.isLoading && !catalog.error && !filtered.length && (
          <Empty title={t('暂时没有匹配的灵感')} description={t('试试其他关键词或分类。')} />
        )}
        <Pagination page={page} pageSize={12} total={catalog.data?.total ?? 0} onPage={setPage} />
        <p className="gallery-footnote">{t('原创灵感素材 · 仅用于风格参考，非实时生成结果')}</p>
      </section>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title ?? '灵感详情'}
        description={t('以这份灵感为起点，写出属于你的新想法。')}
        wide
      >
        {selected && (
          <div className="inspiration-detail">
            {selected.mediaUrl ? (
              selected.kind === 'video' ? (
                <video
                  key={selected.id}
                  src={selected.mediaUrl}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ width: '100%', maxHeight: 500 }}
                />
              ) : (
                <img src={selected.mediaUrl} alt={selected.title} />
              )
            ) : (
              <Empty
                title={t('素材已不可用')}
                description={t('原素材已删除，请联系空间管理员。')}
              />
            )}
            <div>
              <Badge tone="green">
                {t('灵感示例 ·')}
                {selected.category}
              </Badge>
              <label className="field">
                <span className="field-label">{t('创作提示词')}</span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={8}
                  maxLength={12000}
                />
              </label>
              <dl className="detail-list">
                <div>
                  <dt>{t('建议比例')}</dt>
                  <dd>{selected.ratio}</dd>
                </div>
                <div>
                  <dt>{t('使用方式')}</dt>
                  <dd>{t('创建可编辑草稿')}</dd>
                </div>
              </dl>
              {selected.kind === 'video' && (
                <Field label={t('视频内容分类')}>
                  {isAdmin && selected.workspaceId ? (
                    <select
                      value={selected.videoCategory ?? ''}
                      disabled={action.busy}
                      onChange={(event) => {
                        const value = event.target.value,
                          targetId = selected.id,
                          targetScope = reuseKey;
                        void action.run(async () => {
                          const updated = await patch<InspirationDto>(`/inspirations/${targetId}`, {
                            videoCategory: value || null,
                          });
                          if (currentScope.current === targetScope)
                            setSelected((current) =>
                              current?.id === targetId ? updated : current,
                            );
                          await refresh();
                        });
                      }}
                    >
                      <option value="">{t('未分类')}</option>
                      {videoInspirationCategorySchema.options.map((value) => (
                        <option key={value} value={value}>
                          {t(VIDEO_INSPIRATION_LABELS[value])}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>
                      {t(
                        selected.videoCategory
                          ? VIDEO_INSPIRATION_LABELS[selected.videoCategory]
                          : '未分类',
                      )}
                    </span>
                  )}
                </Field>
              )}
              <Button
                onClick={() => void create()}
                busy={action.busy}
                disabled={
                  selected.archived ||
                  selected.mediaUnavailable ||
                  !prompt.trim() ||
                  !!pending ||
                  !!reuseError
                }
              >
                <Sparkles size={16} />
                {t('以此创作')}
              </Button>
              {selected.kind === 'video' && (
                <Button
                  variant="secondary"
                  onClick={() => void create(false, 'replicate')}
                  busy={action.busy}
                  disabled={
                    selected.archived ||
                    selected.mediaUnavailable ||
                    !prompt.trim() ||
                    !!pending ||
                    !!reuseError
                  }
                >
                  {t('进入视频复刻')}
                </Button>
              )}
              {selected.kind === 'video' && (
                <p className="muted small">
                  {t(
                    '动作复刻会继承视频；请补充主体图片、检查片段及授权，再确认费用。仅支持人物动作参考；超过30秒先预选前30秒，不会自动生成。',
                  )}
                </p>
              )}
              <p className="muted small">
                {t(
                  '将继承参考素材、需求、类型与已有参数。模型不支持的设置会在创作页说明；此操作只保存草稿，不调用模型。',
                )}
              </p>
              <p className="muted small">{selected.source}</p>
              {isAdmin && selected.workspaceId && (
                <Button
                  variant="ghost"
                  busy={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await patch(`/inspirations/${selected.id}`, { archived: !selected.archived });
                      setSelected(null);
                      await refresh();
                    })
                  }
                >
                  {t(selected.archived ? '重新上架' : '下架灵感')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={manage}
        onClose={() => setManage(false)}
        title={t('新增灵感')}
        description={t('仅在当前工作空间展示，请使用拥有使用权的图片或视频。')}
        wide
      >
        <div className="form-grid">
          {(
            [
              ['title', '灵感标题'],
              ['category', '行业分类'],
              ['tag', '主题标签'],
              ['platform', '发布平台'],
              ['ratio', '建议比例'],
              ['source', '素材来源与使用权说明'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={t(label)}>
              <input
                value={form[key]}
                maxLength={key === 'source' ? 300 : 120}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <AssetPicker
          value={newAssets}
          onChange={(items) =>
            setNewAssets(items.filter((a) => a.kind === 'image' || a.kind === 'video'))
          }
          kind="all"
          max={1}
          label={t('灵感素材')}
        />
        {newAssets[0]?.kind === 'video' && (
          <Field label={t('视频内容分类')}>
            <select
              value={newVideoCategory}
              onChange={(event) => setNewVideoCategory(event.target.value)}
            >
              <option value="">{t('未分类')}</option>
              {videoInspirationCategorySchema.options.map((value) => (
                <option key={value} value={value}>
                  {t(VIDEO_INSPIRATION_LABELS[value])}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('创作提示词')}>
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            rows={5}
            maxLength={12000}
          />
        </Field>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setManage(false)}>
            {t('取消')}
          </Button>
          <Button
            busy={action.busy}
            disabled={
              !newAssets.length ||
              !form.title.trim() ||
              !form.category.trim() ||
              !form.source.trim() ||
              !form.prompt.trim()
            }
            onClick={() => void addInspiration()}
          >
            {t('保存灵感')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

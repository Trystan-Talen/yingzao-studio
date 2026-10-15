import { t } from '../lib/i18n';
import { useState } from 'react';
import { ArrowUpRight, Bookmark, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  useAction,
} from '../components/ui';
import { post, put, patch, qs, useApi, useRefresh, type Page } from '../lib/api';
import type { AssetDto, ProjectDto } from '../../contracts/core';
import type { InspirationDto } from '../../contracts/inspirations';
import { jobInputSchema } from '../../contracts/jobs';
import { useStudio } from '../context';
import { AssetPicker } from '../components/AssetPicker';
export function Inspiration() {
  const { isAdmin, session } = useStudio();
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
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
    `/inspirations${qs({ page, pageSize: 12, q, category, kind, platform, favorite: onlyFavorites || undefined, archived: showArchived || undefined })}`,
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
        color: '#eaf1ec',
      });
      setManage(false);
      setNewAssets([]);
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
  async function create() {
    if (!selected) return;
    await action.run(async () => {
      const project = await post<ProjectDto>('/projects', {
        name: selected.title,
        kind: selected.kind,
        description: prompt,
      });
      await post(`/projects/${project.id}/messages`, {
        role: 'user',
        content: prompt,
        metadata: {
          inspirationId: selected.id,
          draft: jobInputSchema.parse({
            operation: selected.kind === 'video' ? 'video.generate' : 'image.generate',
            providerId: selected.kind === 'video' ? 'fal' : 'openai',
            prompt,
            assetIds: selected.assetId ? [selected.assetId] : [],
            options: {
              ...selected.options,
              ratio: selected.ratio,
              platform: selected.platform,
              language: session?.user.preferences.defaultCreationLanguage ?? 'zh-CN',
              kind: selected.kind === 'video' ? 'product' : 'single',
              ...(selected.kind === 'video'
                ? selected.assetId
                  ? {
                      model: 'kling-o3-4k-reference',
                      resolution: '4K',
                      referenceMode: 'all',
                      duration: 5,
                    }
                  : { model: 'wan-2.6', resolution: '720p', duration: 5 }
                : {}),
            },
          }),
        },
      });
      navigate(`/workbench/${project.id}`);
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
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('所有类型')}</option>
            <option value="image">{t('图片')}</option>
            <option value="video">{t('视频')}</option>
          </select>
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
                {item.kind === 'video' && <span className="sample-label">{t('视频')}</span>}
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
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={8} />
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
              <Button
                onClick={() => void create()}
                busy={action.busy}
                disabled={selected.archived || selected.mediaUnavailable}
              >
                <Sparkles size={16} />
                {t('以此创作')}
              </Button>
              <p className="muted small">{t('此操作仅保存草稿。模型生成会在你确认报价后开始。')}</p>
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

import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Play, Search, Sparkles } from 'lucide-react';
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Modal,
  Pagination,
  Notice,
  useAction,
} from '../components/ui';
import {
  api,
  CONFIRMATION_TIMEOUT_MS,
  post,
  put,
  patch,
  qs,
  useApi,
  useRefresh,
  type Page,
} from '../lib/api';
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
import '../styles/inspiration-studio.css';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const filterUpdates = useRef({
    locationKey: location.key,
    scope: reuseKey,
    latest: searchParams,
    targets: new Set<string>(),
  });
  function syncFilterUpdates() {
    const updates = filterUpdates.current;
    // History may commit before Router's transition renders. An input event must
    // use that actual address, not revive the previous page's filter snapshot.
    const browserKey = typeof window === 'undefined' ? undefined : window.history.state?.key;
    const key = typeof browserKey === 'string' ? browserKey : location.key;
    if (updates.locationKey === key && updates.scope === reuseKey) return;
    const actual =
      typeof window === 'undefined' ? searchParams : new URLSearchParams(window.location.search);
    const observed = actual.toString();
    const external =
      updates.scope !== reuseKey ||
      (location.key === key && navigationType === 'POP') ||
      !updates.targets.has(observed);
    updates.locationKey = key;
    updates.scope = reuseKey;
    if (external) updates.latest = actual;
    if (external || observed === updates.latest.toString()) updates.targets.clear();
    else updates.targets.delete(observed);
  }
  syncFilterUpdates();
  const kind = ['image', 'video'].includes(searchParams.get('kind') ?? '')
    ? searchParams.get('kind')!
    : '';
  const parsedVideoCategory = videoInspirationCategorySchema.safeParse(
    searchParams.get('videoCategory'),
  );
  const videoCategory =
    kind === 'video' && parsedVideoCategory.success ? parsedVideoCategory.data : '';
  const [newVideoCategory, setNewVideoCategory] = useState('');
  const category = (searchParams.get('category') ?? '').slice(0, 60);
  const platform = (searchParams.get('platform') ?? '').slice(0, 80);
  const q = (searchParams.get('q') ?? '').slice(0, 120);
  const requestedPage = Number(searchParams.get('page') ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const showArchived = isAdmin && searchParams.get('archived') === 'true';
  const onlyFavorites = searchParams.get('favorite') === 'true';
  function updateFilters(values: Record<string, string>, resetPage = true) {
    // Router search setters do not queue functional updates like React state.
    // Keep consecutive control changes until their latest navigation commits.
    syncFilterUpdates();
    const updates = filterUpdates.current;
    const next = new URLSearchParams(updates.latest);
    if (resetPage) next.delete('page');
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    updates.latest = next;
    updates.targets.add(next.toString());
    setSearchParams(next, { replace: true });
  }
  const setPage = (value: number) =>
    updateFilters({ page: value === 1 ? '' : String(value) }, false);
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
  const catalog = useApi<Page<InspirationDto>>(
    `/inspirations${qs({ page, pageSize: 20, q, category, kind, videoCategory, platform, favorite: onlyFavorites || undefined, archived: showArchived || undefined })}`,
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
          timeoutMs: CONFIRMATION_TIMEOUT_MS,
          body: JSON.stringify(payload),
        },
        targetWorkspace,
      );
      let notice: string | undefined;
      try {
        localStorage.removeItem(targetKey);
      } catch {
        notice = '灵感已保存为项目。本机复用记录未能清理，再次找回会打开同一个项目。';
      }
      if (currentScope.current !== targetKey) return;
      setPendingReuse(null);
      navigate(
        result.draft.operation === 'video.motion-replica'
          ? `/tools/video-replica?projectId=${result.project.id}`
          : `/workbench/${result.project.id}`,
        { state: { notice } },
      );
    });
  }
  return (
    <div className="page inspiration-studio">
      {(pending || reuseError) && (
        <Notice tone="warning">
          <p>
            {reuseError ||
              `${t(action.busy ? '正在创建灵感项目' : '上次灵感复用结果待确认')}：${pending?.prompt.slice(0, 80)}`}
          </p>
          <p>{t('继续会使用原请求编号找回同一个项目，不会调用模型。')}</p>
          {pending && (
            <Button busy={action.busy} variant="secondary" onClick={() => void create(true)}>
              {t('继续上次灵感复用')}
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
            {t('已检查项目，清除复用记录')}
          </Button>
        </Notice>
      )}
      <section className="inspiration-studio-section" aria-labelledby="inspiration-heading">
        <div className="inspiration-studio-toolbar">
          <div className="inspiration-studio-heading">
            <span className="eyebrow yz-page-kicker">INSPIRATION · {t('灵感')}</span>
            <div className="inspiration-studio-title">
              <h1 id="inspiration-heading" aria-label={t('灵感探索')}>
                {t('灵感广场')}
              </h1>
              <span className="inspiration-studio-count">{catalog.data?.total ?? 0}</span>
            </div>
            <p className="inspiration-studio-subtitle">{t('发现产品图、营销海报与短片灵感。')}</p>
          </div>
          <div className="inspiration-studio-actions">
            <div className="inspiration-studio-search">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label={t('搜索灵感')}
                placeholder={t('寻找灵感…')}
                value={q}
                maxLength={120}
                onChange={(event) => updateFilters({ q: event.target.value })}
              />
            </div>
            <IconButton
              label={onlyFavorites ? t('显示全部灵感') : t('仅显示已收藏')}
              className={onlyFavorites ? 'is-active' : ''}
              onClick={() => updateFilters({ favorite: onlyFavorites ? '' : 'true' })}
            >
              <Bookmark size={18} fill={onlyFavorites ? 'currentColor' : 'none'} />
            </IconButton>
            {isAdmin && (
              <Button variant="secondary" onClick={() => setManage(true)}>
                {t('新增灵感')}
              </Button>
            )}
          </div>
        </div>
        <div className="inspiration-studio-filters" role="group" aria-label={t('灵感筛选')}>
          <div className="inspiration-studio-categories">
            {['', ...(facets.data?.categories ?? [])].map((item) => (
              <button
                key={item}
                className={category === item ? 'active' : ''}
                aria-pressed={category === item}
                onClick={() => updateFilters({ category: item })}
              >
                {t(item || '全部')}
              </button>
            ))}
          </div>
          <div className="inspiration-studio-selects">
            <select
              aria-label={t('灵感类型')}
              value={kind}
              onChange={(event) => updateFilters({ kind: event.target.value, videoCategory: '' })}
            >
              <option value="">{t('所有类型')}</option>
              <option value="image">{t('图片')}</option>
              <option value="video">{t('视频')}</option>
            </select>
            {kind === 'video' && (
              <select
                aria-label={t('视频内容分类')}
                value={videoCategory}
                onChange={(event) => updateFilters({ videoCategory: event.target.value })}
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
              onChange={(event) => updateFilters({ platform: event.target.value })}
            >
              <option value="">{t('所有平台')}</option>
              {facets.data?.platforms.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
            {isAdmin && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) =>
                    updateFilters({ archived: event.target.checked ? 'true' : '' })
                  }
                />
                {t('包含已下架')}
              </label>
            )}
          </div>
        </div>
        {catalog.isLoading && <Loading />}
        {catalog.error && <ErrorState error={catalog.error} retry={() => void catalog.refetch()} />}
        <div className="inspiration-studio-grid">
          {filtered.map((item) => (
            <article className="inspiration-studio-card" key={item.id}>
              <button
                className="inspiration-studio-image"
                aria-label={`${item.title} · ${t('预览灵感')}`}
                onClick={() => {
                  setSelected(item);
                  setPrompt(item.prompt);
                }}
              >
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt={item.title} loading="lazy" />
                ) : (
                  <div className="inspiration-studio-placeholder">
                    {t(item.mediaUnavailable ? '素材已不可用' : '视频灵感')}
                  </div>
                )}
                {item.kind === 'video' && (
                  <span className="inspiration-studio-video-label">
                    <Play size={11} fill="currentColor" aria-hidden="true" />
                    {t('视频')}
                    {item.videoCategory
                      ? ` · ${t(VIDEO_INSPIRATION_LABELS[item.videoCategory])}`
                      : ''}
                  </span>
                )}
                <span className="inspiration-studio-overlay">
                  <span>{t('预览灵感')}</span>
                  <ArrowUpRight size={20} />
                </span>
              </button>
              <button
                className={`inspiration-studio-save ${favoriteSet.has(item.id) ? 'saved' : ''}`}
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
              <div className="inspiration-studio-caption">
                <div>
                  <h3>{item.title}</h3>
                  <span>{item.tag}</span>
                </div>
                {item.archived && (
                  <span className="inspiration-studio-archived">{t('已下架')}</span>
                )}
              </div>
            </article>
          ))}
        </div>
        {!catalog.isLoading && !catalog.error && !filtered.length && (
          <Empty title={t('暂时没有匹配的灵感')} description={t('试试其他关键词或分类。')} />
        )}
        <Pagination page={page} pageSize={20} total={catalog.data?.total ?? 0} onPage={setPage} />
        <p className="inspiration-studio-footnote">
          {t('原创灵感素材 · 仅用于风格参考，非实时生成结果')}
        </p>
      </section>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title ?? '灵感详情'}
        wide
      >
        {selected && (
          <div className="inspiration-studio-detail" key={selected.id}>
            <div className="inspiration-studio-media">
              {selected.mediaUrl ? (
                selected.kind === 'video' ? (
                  <video
                    key={selected.id}
                    src={selected.mediaUrl}
                    controls
                    playsInline
                    preload="metadata"
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
            </div>
            <div className="inspiration-studio-info">
              <Badge tone="green">
                {t('灵感示例 ·')}
                {selected.category}
              </Badge>
              <p className="inspiration-studio-intro">
                {t('带着参考开始创作，细节可在工作台继续调整。')}
              </p>
              <Button
                className="inspiration-studio-use"
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
                {t('使用此灵感')}
                <ArrowUpRight size={16} />
              </Button>
              <p className="inspiration-studio-draft-note">
                {t('先保存为草稿，生成前再确认费用。')}
              </p>
              <details className="inspiration-studio-prompt">
                <summary>{t('查看或调整提示词')}</summary>
                <Field label={t('创作提示词')}>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={5}
                    maxLength={12000}
                  />
                </Field>
                {!prompt.trim() && (
                  <p className="field-error" role="alert">
                    {t('请填写创作提示词后再使用此灵感。')}
                  </p>
                )}
              </details>
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
              <details className="inspiration-studio-source">
                <summary>{t('素材来源与使用说明')}</summary>
                <p className="muted small">
                  {t(
                    '将继承参考素材、需求、类型与已有参数。模型不支持的设置会在创作页说明；此操作只保存草稿，不调用模型。',
                  )}
                </p>
                <p className="muted small">{selected.source}</p>
              </details>
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

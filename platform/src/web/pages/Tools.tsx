import { useStudio } from '../context';
import { restoreToolAssets, type MissingToolAsset } from '../lib/tool-recovery';
import { t } from '../lib/i18n';
import { productWarning } from '../lib/product-messages';
import { AdvancedToolCards } from '../components/AdvancedTools';
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Clapperboard,
  Copy,
  Expand,
  Focus,
  GalleryVerticalEnd,
  Image,
  Languages,
  Maximize,
  Paintbrush,
  Palette,
  Replace,
  Scissors,
  Sparkles,
  Tag,
} from 'lucide-react';
import { TOOLS, LANGUAGES, IMAGE_RATIOS } from '../../contracts/catalog';
import { extractAssetMentions } from '../../contracts/mentions';
import type { AssetDto, ProjectDto } from '../../contracts/core';
import { api, post, qs, useApi, useRefresh, type Page } from '../lib/api';
import { jobInput, type Capabilities, type Job, type JobInput } from '../lib/tasks';
import { AssetPicker } from '../components/AssetPicker';
import { JobSubmit } from '../components/JobSubmit';
import { JobCard } from '../components/TaskCenter';
import { MaskEditor } from '../components/MaskEditor';
import {
  Badge,
  Button,
  Confirm,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  Segments,
  useAction,
} from '../components/ui';
const icons = {
  Copy,
  Clapperboard,
  GalleryVerticalEnd,
  Sparkles,
  Tag,
  Paintbrush,
  Replace,
  Scissors,
  Image,
  Languages,
  Focus,
  Maximize,
  Expand,
  Palette,
};
export function Tools() {
  const [category, setCategory] = useState('全部');
  const [q, setQ] = useState('');
  const capabilities = useApi<Capabilities>('/capabilities');
  return (
    <div className="page">
      <PageHeader
        eyebrow="YOUR CREATIVE TOOLKIT"
        title={t('好工具，让创作更从容。')}
        description={t('从细节调整到画面重构，为每一步创作提供独立工具。')}
      />
      <div className="tools-feature">
        <div>
          <span className="eyebrow">WORK SMARTER, CREATE MORE</span>
          <h2>
            {t('让每张图片，')}
            <br />
            {t('拥有更多可能。')}
          </h2>
          <p>{t('编辑、增强、复刻，从你的原始素材出发。')}</p>
          <Link className="button secondary" to="/tools/image-inpaint">
            {t('试试局部重绘')}
            <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="tools-feature-art">
          <img src="/gallery/amber-perfume.webp" alt={t('商品图片编辑灵感')} />
          <div className="tool-floating">
            <Sparkles size={18} />
            {t('为细节注入新想法')}
          </div>
        </div>
      </div>
      <div className="toolbar">
        <div className="category-tabs">
          {['全部', '编辑', '增强', '复刻'].map((value) => (
            <button
              key={value}
              className={category === value ? 'active' : ''}
              onClick={() => setCategory(value)}
            >
              {t(value)}
            </button>
          ))}
        </div>
        <input
          className="small-search"
          placeholder={t('搜索工具…')}
          aria-label={t('搜索工具')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="tools-grid">
        {TOOLS.filter(
          (tool) =>
            (category === '全部' || tool.category === category) &&
            `${t(tool.name)}${t(tool.description)}`.includes(q),
        ).map((tool) => {
          const Icon = icons[tool.icon];
          const op = capabilities.data?.operations.find(
            (item) => item.id === tool.id && item.available && item.providerId !== 'local',
          );
          return (
            <Link className="tool-card" to={`/tools/${tool.id}`} key={tool.id}>
              <span className="tool-icon" style={{ background: tool.color }}>
                <Icon size={25} strokeWidth={1.6} />
              </span>
              <div className="tool-title">
                <h3>{t(tool.name)}</h3>
                <ArrowUpRight size={17} />
              </div>
              <p>{t(tool.description)}</p>
              <div>
                <Badge>{t(tool.category)}</Badge>
                <span className={op ? 'tool-connected' : 'muted'}>
                  {op ? t('已连接') : t('可配置服务')}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      <AdvancedToolCards />
      <section className="local-tools-banner">
        <div>
          <Badge tone="green">{t('本机处理')}</Badge>
          <h3>{t('无需模型，也能完成基础处理。')}</h3>
          <p className="muted">{t('图片缩放、格式转换、长图拼接与视频裁剪。')}</p>
        </div>
        <Link className="button secondary" to="/tools/local.resize">
          {t('打开本机工具')}
          <ArrowUpRight size={16} />
        </Link>
      </section>
    </div>
  );
}
export function ToolDetail() {
  const { toolId = '' } = useParams();
  const [toolSearch] = useSearchParams();
  const tool = TOOLS.find((item) => item.id === toolId);
  const localIds = ['local.resize', 'local.convert', 'local.stitch', 'local.video-trim'];
  if (!tool && !localIds.includes(toolId))
    return (
      <div className="page">
        <Empty
          title={t('没有找到这个工具')}
          action={
            <Link to="/tools" className="button secondary">
              {t('返回工具箱')}
            </Link>
          }
        />
      </div>
    );
  return (
    <ToolForm key={`${toolId}:${toolSearch.get('projectId') ?? 'new'}`} id={toolId} tool={tool} />
  );
}
function ToolForm({ id, tool }: { id: string; tool: (typeof TOOLS)[number] | undefined }) {
  const { canEdit } = useStudio();
  const [search] = useSearchParams();
  const projectId = search.get('projectId') ?? undefined;
  const [draftPage, setDraftPage] = useState(1);
  const savedDraft = useApi<
    Page<{ createdAt: string; metadata?: { draft?: JobInput; creationWarnings?: string[] } }>
  >(`/projects/${projectId}/messages?pageSize=100&page=${draftPage}`, !!projectId);
  const [restored, setRestored] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [restoringAssets, setRestoringAssets] = useState(false);
  const [missingAssets, setMissingAssets] = useState<MissingToolAsset[]>([]);
  const [missingToRemove, setMissingToRemove] = useState<MissingToolAsset | null>(null);
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [mask, setMask] = useState<AssetDto | null>(null);
  const [restoredMask, setRestoredMask] = useState<AssetDto | null>(null);
  const [background, setBackground] = useState<AssetDto | null>(null);
  const [prompt, setPrompt] = useState('');
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [mode, setMode] = useState(id === 'image-fusion' ? 'ai' : 'creative');
  const [scale, setScale] = useState(2);
  const [strength, setStrength] = useState('standard');
  const [languages, setLanguages] = useState<string[]>(['en']);
  const [colorInput, setColorInput] = useState('#426856');
  const [resolution, setResolution] = useState('720p');
  const [duration, setDuration] = useState(5);
  const [replacementType, setReplacementType] = useState('product');
  const [keepMusicRhythm, setKeepMusicRhythm] = useState(true);
  const [sellingPoints, setSellingPoints] = useState('');
  const [price, setPrice] = useState('');
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(1200);
  const [format, setFormat] = useState('png');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(5);
  const [needText, setNeedText] = useState(true);
  const [motionOrientation, setMotionOrientation] = useState<'video' | 'image'>('video');
  const [referenceAuthorized, setReferenceAuthorized] = useState(false);
  const [forceTranslation, setForceTranslation] = useState(false);
  const [channel, setChannel] = useState('premium');
  const [historyFilter, setHistoryFilter] = useState('all');
  const action = useAction();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const caps = useApi<Capabilities>('/capabilities');
  useEffect(() => {
    if (restored || !savedDraft.data) return;
    const saved = savedDraft.data.items
      .filter(
        (m) =>
          m.metadata?.draft &&
          m.metadata.draft.operation !== 'text.assist' &&
          (m.metadata.draft.operation === id ||
            (id === 'image-fusion' && m.metadata.draft.operation === 'local.stitch') ||
            (id === 'video-replica' && m.metadata.draft.operation === 'video.motion-replica')),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const draft = saved?.metadata?.draft;
    if (!draft) {
      if (savedDraft.data.page * savedDraft.data.pageSize < savedDraft.data.total)
        setDraftPage(savedDraft.data.page + 1);
      else setRestored(true);
      return;
    }
    setRestored(true);
    const o = draft.options;
    setPrompt(draft.prompt);
    setDraftWarnings(draft.creationWarnings ?? saved?.metadata?.creationWarnings ?? []);
    setProvider(draft.providerId);
    setModel(o.model ?? '');
    setRatio(o.ratio);
    setMode(
      draft.operation === 'local.stitch' && id === 'image-fusion'
        ? 'stitch'
        : draft.operation === 'video.motion-replica'
          ? 'exact'
          : o.mode,
    );
    setScale(o.scale);
    setStrength(o.strength);
    setLanguages(o.languages ?? [o.language]);
    setForceTranslation(o.forceTranslation ?? false);
    setColorInput(o.colors?.join(', ') ?? '#426856');
    setResolution(o.resolution);
    setDuration(o.duration);
    setReplacementType(o.replacementType);
    setKeepMusicRhythm(o.keepMusicRhythm);
    setSellingPoints(o.sellingPoints ?? '');
    setPrice(o.price ?? '');
    setWidth(o.width ?? 1200);
    setHeight(o.height ?? 1200);
    setFormat(o.format);
    setTrimStart(o.trimStart);
    setTrimEnd(o.trimEnd ?? 5);
    setNeedText(o.needText);
    setMotionOrientation(o.motionOrientation ?? 'video');
    setReferenceAuthorized(o.referenceAuthorized ?? false);
    setChannel(o.channel);
    setRestoringAssets(true);
    void restoreToolAssets(draft, (assetId) => api<AssetDto>(`/assets/${assetId}`))
      .then((result) => {
        setAssets(result.sources);
        setReferences(result.references);
        setMask(result.mask);
        setRestoredMask(result.mask);
        setBackground(result.background);
        setMissingAssets(result.failures);
        setRestoreError('');
      })
      .catch((e) => setRestoreError(e instanceof Error ? e.message : '草稿素材读取失败'))
      .finally(() => setRestoringAssets(false));
  }, [savedDraft.data, restored]);
  async function retryMissingAssets() {
    setRestoringAssets(true);
    const missing = [...missingAssets];
    const result = await restoreToolAssets(
      {
        assetIds: missing.filter((f) => f.slot === 'source').map((f) => f.id),
        referenceAssetIds: missing.filter((f) => f.slot === 'reference').map((f) => f.id),
        maskAssetId: missing.find((f) => f.slot === 'mask')?.id,
        backgroundAssetId: missing.find((f) => f.slot === 'background')?.id,
      },
      (assetId) => api<AssetDto>(`/assets/${assetId}`),
    );
    setAssets((current) => [
      ...current,
      ...result.sources.filter((a) => !current.some((b) => b.id === a.id)),
    ]);
    setReferences((current) => [
      ...current,
      ...result.references.filter((a) => !current.some((b) => b.id === a.id)),
    ]);
    if (result.mask) {
      setMask(result.mask);
      setRestoredMask(result.mask);
    }
    if (result.background) setBackground(result.background);
    setMissingAssets(result.failures);
    setRestoringAssets(false);
  }

  const isMotion = id === 'video-replica' && mode === 'exact';
  const actualOperation = isMotion
    ? 'video.motion-replica'
    : id === 'image-fusion' && mode === 'stitch'
      ? 'local.stitch'
      : id;
  const operations =
    caps.data?.operations.filter(
      (item) =>
        item.id === actualOperation &&
        (id !== 'image-fusion' || mode === 'stitch' || item.providerId !== 'local'),
    ) ?? [];
  const operation =
    operations.find((item) => item.providerId === provider) ??
    operations.find((item) => item.available) ??
    operations[0];
  const currentModel = operation?.models.find((item) => item.id === model) ?? operation?.models[0];
  const history = useApi<Page<Job>>(
    `/jobs${qs({ operation: actualOperation, pageSize: 30 })}`,
    true,
    5000,
  );
  const isVideo = id === 'video-replica' || id === 'local.video-trim';
  const title =
    tool?.name ??
    {
      'local.resize': '图片缩放',
      'local.convert': '格式转换',
      'local.stitch': '长图拼接',
      'local.video-trim': '视频裁剪',
    }[id] ??
    '本机工具';
  const has = (value: string) => (tool?.options as readonly string[] | undefined)?.includes(value);
  const colors = colorInput.split(/[，,\s]+/).filter(Boolean);
  const effectiveRatio =
    currentModel?.ratios.includes(ratio) || !currentModel?.ratios.length
      ? ratio
      : (currentModel.ratios[0] ?? '1:1');
  const isKling = id === 'video-replica' && operation?.providerId === 'fal' && !isMotion;
  const input = jobInput({
    operation: actualOperation,
    providerId:
      operation?.providerId ?? (actualOperation.startsWith('local.') ? 'local' : 'flyelep'),
    prompt,
    creationWarnings: draftWarnings,
    ...(projectId ? { projectId } : {}),
    assetIds: assets.map((a) => a.id),
    referenceAssetIds: references.map((a) => a.id),
    ...(mask ? { maskAssetId: mask.id } : {}),
    ...(background ? { backgroundAssetId: background.id } : {}),
    options: {
      model: currentModel?.id,
      ratio: isMotion || isKling ? 'auto' : effectiveRatio,
      motionOrientation,
      referenceAuthorized,
      mode: isKling ? 'creative' : mode,
      scale,
      strength,
      ...(id === 'image-translate' && operation?.providerId === 'openai'
        ? { forceTranslation }
        : {}),
      languages,
      colors,
      width,
      height,
      format,
      trimStart: isKling ? 0 : trimStart,
      ...(!isKling ? { trimEnd } : {}),
      resolution:
        isMotion || isKling
          ? 'auto'
          : currentModel?.resolutions.includes(resolution) || !currentModel?.resolutions.length
            ? resolution
            : currentModel.resolutions[0],
      duration: isMotion
        ? Math.max(2, Math.ceil((trimEnd || (references[0]?.durationMs ?? 0) / 1000) - trimStart))
        : isKling
          ? Math.max(2, Math.ceil((assets[0]?.durationMs ?? 5000) / 1000))
          : currentModel?.durations.includes(duration) || !currentModel?.durations.length
            ? duration
            : currentModel.durations[0],
      replacementType: isMotion ? 'model' : replacementType,
      keepMusicRhythm,
      sellingPoints,
      price,
      needText: isMotion ? false : needText,
      channel,
      language: languages[0] ?? 'en',
    },
  });
  const projectRecoveryReady = !projectId || restored;
  const assetsReady =
    projectRecoveryReady && !restoringAssets && missingAssets.length === 0 && !restoreError;
  const valid =
    assetsReady &&
    draftWarnings.length === 0 &&
    (!isMotion ||
      (assets[0]?.kind === 'image' &&
        references.length === 1 &&
        references[0]?.kind === 'video' &&
        referenceAuthorized)) &&
    assets.length >= (tool?.minInputs ?? 1) &&
    (!['image-inpaint', 'image-erase'].includes(id) || !!mask) &&
    (id !== 'model-replace' || references.length === 1) &&
    (!(operation?.providerId === 'fal' && ['image-erase', 'model-replace'].includes(id)) ||
      (!prompt.trim() && !background)) &&
    (id !== 'image-translate' || languages.length > 0) &&
    (id !== 'product-recolor' || colors.length > 0) &&
    (!['scene-replace', 'product-replace'].includes(id) ||
      !!prompt.trim() ||
      references.length > 0);
  async function saveDraft() {
    if (!assetsReady) return;
    await action.run(async () => {
      const project = projectId
        ? await api<ProjectDto>(`/projects/${projectId}`)
        : await post<ProjectDto>('/projects', {
            name: `${title} · ${new Date().toLocaleDateString('zh-CN')}`,
            kind: isVideo ? 'video' : 'image',
            description: prompt,
          });
      await post(`/projects/${project.id}/messages`, {
        role: 'user',
        content: prompt || title,
        metadata: { draft: input, creationWarnings: draftWarnings },
      });
      navigate(`/workbench/${project.id}`);
    }, '工具草稿已保存');
  }
  return (
    <div className="page tool-detail-page">
      {!projectRecoveryReady && (
        <Notice tone={savedDraft.error ? 'warning' : undefined}>
          {savedDraft.error ? (
            <>
              <p>{t('项目草稿读取失败；恢复成功前不能保存或提交，以免覆盖已有需求。')}</p>
              <Button
                variant="secondary"
                busy={savedDraft.isFetching}
                onClick={() => void savedDraft.refetch()}
              >
                {t('重试恢复项目草稿')}
              </Button>
            </>
          ) : (
            <p>{t('正在查找并恢复此工具的项目草稿，完成前不能保存或提交。')}</p>
          )}
        </Notice>
      )}
      {!!draftWarnings.length && (
        <Notice tone="warning">
          {draftWarnings.map((warning, index) => (
            <p key={index}>{productWarning(warning)}</p>
          ))}
          <Button variant="secondary" onClick={() => setDraftWarnings([])}>
            {t('已核对，保留当前设置')}
          </Button>
        </Notice>
      )}
      {restoreError && <Notice tone="warning">{restoreError}</Notice>}
      {projectRecoveryReady && !assetsReady && (
        <Notice tone="warning">
          {t(
            restoringAssets
              ? '正在恢复参考素材，完成前暂不能提交。'
              : '部分参考素材未恢复。请重试，或明确移除失效引用后继续。',
          )}
          {missingAssets.map((f) => (
            <div key={`${f.slot}:${f.id}`}>
              <p>
                {t(
                  { source: '原素材', reference: '参考素材', mask: '蒙版', background: '背景' }[
                    f.slot
                  ],
                )}{' '}
                · {f.id.slice(-8)} · {f.message}
              </p>
              <Button
                variant="ghost"
                disabled={restoringAssets}
                onClick={() => setMissingToRemove(f)}
              >
                {t('移除失效引用')}
              </Button>
            </div>
          ))}
          {!!missingAssets.length && (
            <Button
              variant="secondary"
              busy={restoringAssets}
              onClick={() => void retryMissingAssets()}
            >
              {t('重试恢复素材')}
            </Button>
          )}
        </Notice>
      )}
      <Confirm
        open={!!missingToRemove}
        onClose={() => setMissingToRemove(null)}
        title={t('移除失效素材及引用？')}
        description={t('将从当前草稿及物料模块移除此素材的引用，其他素材和文案保持不变。')}
        onConfirm={() => {
          if (!missingToRemove) return;
          setMissingAssets((current) =>
            current.filter(
              (f) => !(f.id === missingToRemove.id && f.slot === missingToRemove.slot),
            ),
          );
          setPrompt((text) =>
            extractAssetMentions(text).reduce(
              (value, mention) =>
                mention.assetId === missingToRemove.id
                  ? value.replaceAll(mention.token, '')
                  : value,
              text,
            ),
          );
          setMissingToRemove(null);
        }}
      />
      <Link className="back-link" to="/tools">
        <ArrowLeft size={16} />
        {t('全部工具')}
      </Link>
      <PageHeader
        title={t(title)}
        description={t(tool?.description ?? '在本机处理你的原始素材，结果保存到当前空间。')}
        action={
          <Button
            variant="secondary"
            onClick={() => void saveDraft()}
            busy={action.busy}
            disabled={!canEdit || !assetsReady}
          >
            {t('保存为项目')}
          </Button>
        }
      />
      {id.startsWith('local.') && (
        <div className="category-tabs">
          {['local.resize', 'local.convert', 'local.stitch', 'local.video-trim'].map((value) => (
            <Link key={value} to={`/tools/${value}`} className={id === value ? 'active' : ''}>
              {t(
                {
                  'local.resize': '缩放',
                  'local.convert': '转换',
                  'local.stitch': '拼接',
                  'local.video-trim': '裁剪',
                }[value]!,
              )}
            </Link>
          ))}
        </div>
      )}
      <div className="tool-workspace">
        <section className="tool-form panel" inert={!projectRecoveryReady}>
          <div className="panel-heading">
            <h2>{t('输入与参数')}</h2>
            <Badge tone={actualOperation.startsWith('local.') ? 'green' : 'neutral'}>
              {actualOperation.startsWith('local.') ? t('本机处理') : t('AI 工具')}
            </Badge>
          </div>
          {id === 'image-translate' && operation?.providerId === 'openai' && (
            <>
              <Notice>
                {t(
                  '默认先检查文字，无文字返回原图并释放平台额度；预检可能产生供应商费用。识别有遗漏时可强制翻译，按正常任务结算。提交前仍需具备报价所需额度。',
                )}
              </Notice>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={forceTranslation}
                  onChange={(event) => setForceTranslation(event.target.checked)}
                  disabled={!canEdit}
                />
                {t('仍然翻译未识别到文字的图片')}
              </label>
            </>
          )}
          {(id === 'video-replica' || id === 'image-fusion') && (
            <Field label={t('处理方式')}>
              <Segments
                value={mode}
                onChange={setMode}
                options={
                  id === 'video-replica'
                    ? [
                        { value: 'creative', label: '创意视频编辑' },
                        { value: 'exact', label: '人物动作复刻' },
                      ]
                    : [
                        { value: 'ai', label: 'AI 融合' },
                        { value: 'stitch', label: '普通拼接' },
                      ]
                }
              />
            </Field>
          )}
          <AssetPicker
            value={assets}
            onChange={(items) => {
              if (items[0]?.id !== assets[0]?.id) {
                setMask(null);
                setRestoredMask(null);
              }
              setAssets(items);
            }}
            label={
              isMotion
                ? t('人物主体图片')
                : id === 'model-replace'
                  ? t('服装 / 人台原图')
                  : id === 'image-replica'
                    ? t('参考构图图片')
                    : isVideo
                      ? t('参考视频')
                      : t('原始图片')
            }
            kind={isMotion ? 'image' : isVideo ? 'video' : 'image'}
            max={
              isKling || (id === 'video-replica' && mode === 'exact')
                ? 1
                : (tool?.maxInputs ?? (id === 'local.stitch' ? 20 : 1))
            }
          />
          {tool?.reference && (
            <AssetPicker
              value={references}
              onChange={setReferences}
              kind={
                isMotion
                  ? 'video'
                  : id === 'model-replace'
                    ? 'image'
                    : isKling
                      ? 'image'
                      : undefined
              }
              label={
                isMotion
                  ? t('动作参考视频')
                  : id === 'model-replace'
                    ? t('目标模特图')
                    : id === 'product-tagging'
                      ? t('打标样式参考图')
                      : id === 'image-replica'
                        ? t('商品素材')
                        : id === 'scene-replace'
                          ? t('场景参考图（可选）')
                          : id === 'image-inpaint'
                            ? t('替换素材（可选）')
                            : t('参考商品 / 主体素材')
              }
              max={
                isMotion || id === 'model-replace'
                  ? 1
                  : isKling
                    ? 4
                    : id === 'product-tagging' || id === 'scene-replace' || id === 'image-inpaint'
                      ? 1
                      : 20
              }
            />
          )}
          {id === 'model-replace' && (
            <AssetPicker
              kind="image"
              max={1}
              value={background ? [background] : []}
              onChange={(items) => setBackground(items[0] ?? null)}
              label={t('背景参考（可选）')}
            />
          )}
          {['image-erase', 'model-replace'].includes(id) && (
            <Notice>
              {id === 'image-erase'
                ? t(
                    '涂画要移除的物体，未涂画区域保留原图像素。图片最多10MiB、宽高8192、6400万像素、长短边比不超过5。',
                  )
                : t(
                    '服装、目标模特与背景分别保存。请使用获授权的素材，服装细节与人物一致性需检查真实结果。',
                  )}
              {operation?.providerId === 'fal' &&
                (id === 'image-erase'
                  ? t('此消除模型只接受原图与蒙版、最多2500万像素；补充说明请选择OpenAI服务。')
                  : t('此试衣模型只接受服装与目标模特；使用背景或补充说明请选择OpenAI服务。'))}
            </Notice>
          )}
          <Field
            label={
              id === 'product-tagging' || ['image-erase', 'model-replace'].includes(id)
                ? t('补充说明（可选）')
                : t('创作说明')
            }
            hint={
              id === 'image-cutout'
                ? t('输出保留透明背景。')
                : t('描述要保留的细节和希望进行的调整。')
            }
          >
            <textarea
              rows={3}
              value={prompt}
              maxLength={isMotion ? 300 : isKling ? 2100 : 12000}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('写下你的想法…')}
            />
          </Field>
          {operations.length > 0 && (
            <Field label={t('处理服务')}>
              <select
                value={operation?.providerId ?? ''}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel('');
                }}
              >
                {operations.map((item) => (
                  <option value={item.providerId} key={item.providerId}>
                    {
                      { openai: 'OpenAI', fal: 'fal.ai', flyelep: 'Flyelep', local: 'Local' }[
                        item.providerId
                      ]
                    }{' '}
                    · {t(item.name)}
                    {item.available ? '' : t(' · 未连接')}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {currentModel && (
            <Field label={t('模型')}>
              <select value={currentModel.id} onChange={(e) => setModel(e.target.value)}>
                {operation?.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.name)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="form-grid">
            {has('ratio') && !isMotion && !isKling && (
              <Field label={t('画幅比例')}>
                <select value={effectiveRatio} onChange={(e) => setRatio(e.target.value)}>
                  {(currentModel?.ratios.length ? currentModel.ratios : IMAGE_RATIOS).map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </select>
              </Field>
            )}
            {has('scale') && (
              <Field label={t('放大倍数')}>
                <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                  {[2, 4, 8].map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {has('strength') && (
              <Field label={t('增强程度')}>
                <select value={strength} onChange={(e) => setStrength(e.target.value)}>
                  <option value="light">{t('轻度')}</option>
                  <option value="standard">{t('标准')}</option>
                  <option value="strong">{t('强力')}</option>
                </select>
              </Field>
            )}
            {has('colors') && (
              <Field label={t('目标颜色')} hint={t('多个 HEX 色值用逗号分隔')}>
                <input
                  value={colorInput}
                  onChange={(e) => setColorInput(e.target.value)}
                  placeholder="#426856, #DDF3AD"
                />
              </Field>
            )}
            {(has('width') || id === 'local.resize') && (
              <Field label={t('输出宽度（像素）')}>
                <input
                  type="number"
                  min={16}
                  max={8192}
                  value={width}
                  onChange={(e) =>
                    setWidth(Math.min(8192, Math.max(16, Number(e.target.value) || 16)))
                  }
                />
              </Field>
            )}
            {id === 'local.resize' && (
              <Field label={t('输出高度（像素）')}>
                <input
                  type="number"
                  min={16}
                  max={8192}
                  value={height}
                  onChange={(e) =>
                    setHeight(Math.min(8192, Math.max(16, Number(e.target.value) || 16)))
                  }
                />
              </Field>
            )}
            {id === 'local.convert' && (
              <Field label={t('输出格式')}>
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="png">{t('PNG（保留透明）')}</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </Field>
            )}
            {isVideo && !isKling && !isMotion && (
              <>
                <Field label={t('输出清晰度')}>
                  <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                    {(currentModel?.resolutions.length
                      ? currentModel.resolutions
                      : ['720p', '1080p']
                    ).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                {mode !== 'exact' && id !== 'local.video-trim' && (
                  <Field label={t('时长（秒）')}>
                    <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                      {(currentModel?.durations.length ? currentModel.durations : [5, 10, 15]).map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                  </Field>
                )}
                {mode === 'exact' && (
                  <Field label={t('替换对象')}>
                    <select
                      value={replacementType}
                      onChange={(e) => setReplacementType(e.target.value)}
                    >
                      <option value="model">{t('模特')}</option>
                      <option value="clothing">{t('服饰')}</option>
                      <option value="face">{t('人脸')}</option>
                      <option value="product">{t('商品')}</option>
                    </select>
                  </Field>
                )}
                {(mode === 'exact' || id === 'local.video-trim') && (
                  <>
                    <Field label={t('开始时间（秒）')}>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={trimStart}
                        onChange={(e) =>
                          setTrimStart(Math.min(3600, Math.max(0, Number(e.target.value))))
                        }
                      />
                    </Field>
                    <Field label={t('结束时间（秒）')}>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={trimEnd}
                        onChange={(e) =>
                          setTrimEnd(Math.min(3600, Math.max(0.1, Number(e.target.value) || 0.1)))
                        }
                      />
                    </Field>
                  </>
                )}
              </>
            )}
            {has('sellingPoints') && (
              <Field label={t('商品卖点')}>
                <textarea
                  maxLength={300}
                  value={sellingPoints}
                  onChange={(e) => setSellingPoints(e.target.value)}
                />
              </Field>
            )}
            {has('price') && (
              <Field label={t('展示价格')}>
                <input
                  maxLength={40}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={t('例如 ¥129')}
                />
              </Field>
            )}
            {has('language') && !has('languages') && !isMotion && !isKling && (
              <Field label={t('文字语言')}>
                <select value={languages[0]} onChange={(e) => setLanguages([e.target.value])}>
                  {LANGUAGES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(item.name)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {id === 'image-replica' && (
              <Field label={t('生成通道')}>
                <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="premium">{t('精品')}</option>
                  <option value="promotion">{t('推广')}</option>
                </select>
              </Field>
            )}
          </div>
          {has('languages') && (
            <div className="field">
              <span className="field-label">{t('目标语言（可多选）')}</span>
              <div className="language-options">
                {LANGUAGES.map((item) => (
                  <label className="checkbox" key={item.id}>
                    <input
                      type="checkbox"
                      checked={languages.includes(item.id)}
                      onChange={(e) =>
                        setLanguages(
                          e.target.checked
                            ? [...languages, item.id]
                            : languages.filter((id) => id !== item.id),
                        )
                      }
                    />
                    {t(item.name)}
                  </label>
                ))}
              </div>
            </div>
          )}
          {(id === 'image-replica' || (id === 'video-replica' && !isMotion)) && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={needText}
                onChange={(e) => setNeedText(e.target.checked)}
              />
              {t('包含文字 / 字幕')}
            </label>
          )}
          {id === 'video-replica' && (isMotion || isKling) && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={keepMusicRhythm}
                onChange={(e) => setKeepMusicRhythm(e.target.checked)}
              />
              {isKling ? t('保留原视频音轨') : t('保留原视频音乐与节奏')}
            </label>
          )}
          {has('mask') &&
            (assets[0] ? (
              <MaskEditor
                asset={assets[0]}
                onMask={setMask}
                initialMask={restoredMask}
                purpose={id === 'image-erase' ? 'erase' : 'edit'}
                disabled={!canEdit}
              />
            ) : (
              <Notice>{t('上传原始图片后，在画面上标记需要重绘的区域。')}</Notice>
            ))}
          {isMotion && (
            <>
              <Field label={t('画面方向')}>
                <select
                  value={motionOrientation}
                  onChange={(event) =>
                    setMotionOrientation(event.target.value as 'video' | 'image')
                  }
                >
                  <option value="video">{t('跟随动作视频（最长30秒）')}</option>
                  <option value="image">{t('跟随主体图片（最长10秒）')}</option>
                </select>
              </Field>
              <div className="form-grid">
                <Field label={t('开始时间（秒）')}>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={trimStart}
                    onChange={(e) => setTrimStart(Number(e.target.value))}
                  />
                </Field>
                <Field label={t('结束时间（秒）')}>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(Number(e.target.value))}
                  />
                </Field>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={referenceAuthorized}
                  onChange={(e) => setReferenceAuthorized(e.target.checked)}
                />
                {t('我有权使用人物图片与动作参考视频')}
              </label>
              <Notice>
                {t(
                  '人物图片+动作视频选段，按片段秒数报价；先在本机真实裁剪再发送。画幅与清晰度由模型决定，不提供独立字幕控制。服装、人脸、商品的精准替换尚未支持；不承诺原视频背景或逐像素1:1。',
                )}
              </Notice>
            </>
          )}
          {id === 'video-replica' && !isMotion && (
            <Notice>
              {isKling
                ? t(
                    '参考视频编辑：1段3–10秒源视频，宽高720–2160像素、24–60fps；最多4张参考图，至少300像素、比例0.4–2.5。输出跟随源片，不承诺逐镜头精确1:1。',
                  )
                : t('分享链接解析与人物认证需要相应外部服务。目前请上传有权使用的本地视频与素材。')}
            </Notice>
          )}
          <JobSubmit
            input={input}
            operation={operation}
            valid={valid}
            label={t('开始处理')}
            onCreated={() => void refresh()}
          />
        </section>
        <section className="tool-results">
          <div className="section-heading">
            <h2>{t('处理记录')}</h2>
            <select
              aria-label={t('记录状态')}
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
            >
              <option value="all">{t('全部状态')}</option>
              <option value="succeeded">{t('已完成')}</option>
              <option value="failed">{t('未完成')}</option>
              <option value="running">{t('处理中')}</option>
            </select>
          </div>
          {history.isLoading ? (
            <Loading />
          ) : history.error ? (
            <ErrorState error={history.error} retry={history.refetch} />
          ) : history.data?.items.filter(
              (job) =>
                job.operation === actualOperation &&
                (historyFilter === 'all' || job.status === historyFilter),
            ).length ? (
            history.data.items
              .filter(
                (job) =>
                  job.operation === actualOperation &&
                  (historyFilter === 'all' || job.status === historyFilter),
              )
              .map((job) => <JobCard key={job.id} job={job} />)
          ) : (
            <div className="tool-empty">
              <div className="tool-empty-visual">
                <img src="/gallery/botanical-serum.webp" alt={t('处理风格参考')} />
                <span>
                  <Sparkles size={20} />
                </span>
              </div>
              <h3>{t('你的好作品，值得再进一步。')}</h3>
              <p>{t('添加素材并设置参数，处理进度和真实结果会出现在这里。')}</p>
              <Badge>{t('图片仅为原创风格参考')}</Badge>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

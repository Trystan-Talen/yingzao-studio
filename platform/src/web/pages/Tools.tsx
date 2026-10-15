import { useStudio } from '../context';
import { t } from '../lib/i18n';
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
        description={t('从一个小细节，到一整幅新画面。14 种工具，各尽其用。')}
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
  return <ToolForm key={toolId} id={toolId} tool={tool} />;
}
function ToolForm({ id, tool }: { id: string; tool: (typeof TOOLS)[number] | undefined }) {
  const { canEdit } = useStudio();
  const [search] = useSearchParams();
  const projectId = search.get('projectId') ?? undefined;
  const savedDraft = useApi<Page<{ createdAt: string; metadata?: { draft?: JobInput } }>>(
    `/projects/${projectId}/messages?pageSize=100`,
    !!projectId,
  );
  const [restored, setRestored] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [mask, setMask] = useState<AssetDto | null>(null);
  const [prompt, setPrompt] = useState('');
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
  const [forceTranslation, setForceTranslation] = useState(false);
  const [channel, setChannel] = useState('premium');
  const [historyFilter, setHistoryFilter] = useState('all');
  const action = useAction();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const caps = useApi<Capabilities>('/capabilities');
  useEffect(() => {
    if (restored || !savedDraft.data) return;
    const draft = savedDraft.data.items
      .filter((m) => m.metadata?.draft)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.metadata?.draft;
    if (!draft) return;
    setRestored(true);
    const o = draft.options;
    setPrompt(draft.prompt);
    setProvider(draft.providerId);
    setModel(o.model ?? '');
    setRatio(o.ratio);
    setMode(draft.operation === 'local.stitch' && id === 'image-fusion' ? 'stitch' : o.mode);
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
    setChannel(o.channel);
    void Promise.all([
      Promise.all(draft.assetIds.map((a) => api<AssetDto>(`/assets/${a}`))),
      Promise.all(draft.referenceAssetIds.map((a) => api<AssetDto>(`/assets/${a}`))),
      draft.maskAssetId ? api<AssetDto>(`/assets/${draft.maskAssetId}`) : Promise.resolve(null),
    ])
      .then(([sources, refs, maskAsset]) => {
        setAssets(sources);
        setReferences(refs);
        setMask(maskAsset);
      })
      .catch((e) => setRestoreError(e instanceof Error ? e.message : '草稿素材读取失败'));
  }, [savedDraft.data, restored]);
  const actualOperation = id === 'image-fusion' && mode === 'stitch' ? 'local.stitch' : id;
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
  const isKling = id === 'video-replica' && operation?.providerId === 'fal';
  const input = jobInput({
    operation: actualOperation,
    providerId:
      operation?.providerId ?? (actualOperation.startsWith('local.') ? 'local' : 'flyelep'),
    prompt,
    ...(projectId ? { projectId } : {}),
    assetIds: assets.map((a) => a.id),
    referenceAssetIds: references.map((a) => a.id),
    ...(mask ? { maskAssetId: mask.id } : {}),
    options: {
      model: currentModel?.id,
      ratio: effectiveRatio,
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
      trimStart,
      trimEnd,
      resolution:
        currentModel?.resolutions.includes(resolution) || !currentModel?.resolutions.length
          ? resolution
          : currentModel.resolutions[0],
      duration:
        currentModel?.durations.includes(duration) || !currentModel?.durations.length
          ? duration
          : currentModel.durations[0],
      replacementType,
      keepMusicRhythm,
      sellingPoints,
      price,
      needText,
      channel,
      language: languages[0] ?? 'en',
    },
  });
  const valid =
    assets.length >= (tool?.minInputs ?? 1) &&
    (id !== 'image-inpaint' || !!mask) &&
    (id !== 'image-translate' || languages.length > 0) &&
    (id !== 'product-recolor' || colors.length > 0) &&
    (!['scene-replace', 'product-replace'].includes(id) ||
      !!prompt.trim() ||
      references.length > 0);
  async function saveDraft() {
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
        metadata: { draft: input },
      });
      navigate(`/workbench/${project.id}`);
    }, '工具草稿已保存');
  }
  return (
    <div className="page tool-detail-page">
      {restoreError && <Notice tone="warning">{restoreError}</Notice>}
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
            disabled={!canEdit}
          >
            {t('保存为项目')}
          </Button>
        }
      />
      {id.startsWith('local.') && (
        <div className="category-tabs">
          {['local.resize', 'local.convert', 'local.stitch', 'local.video-trim'].map((value) => (
            <Link key={value} to={`/tools/${value}`} className={id === value ? 'active' : ''}>
              {
                {
                  'local.resize': '缩放',
                  'local.convert': '转换',
                  'local.stitch': '拼接',
                  'local.video-trim': '裁剪',
                }[value]
              }
            </Link>
          ))}
        </div>
      )}
      <div className="tool-workspace">
        <section className="tool-form panel">
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
          {((id === 'video-replica' && !isKling) || id === 'image-fusion') && (
            <Field label={t('处理方式')}>
              <Segments
                value={mode}
                onChange={setMode}
                options={
                  id === 'video-replica'
                    ? [
                        { value: 'creative', label: '创意复刻' },
                        { value: 'exact', label: '1:1 复刻' },
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
            onChange={setAssets}
            label={
              id === 'image-replica' ? t('参考构图图片') : isVideo ? t('参考视频') : t('原始图片')
            }
            kind={isVideo ? 'video' : 'image'}
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
              label={
                id === 'product-tagging'
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
                isKling
                  ? 4
                  : id === 'product-tagging' || id === 'scene-replace' || id === 'image-inpaint'
                    ? 1
                    : 20
              }
            />
          )}
          <Field
            label={id === 'product-tagging' ? t('补充说明') : t('创作说明')}
            hint={
              id === 'image-cutout'
                ? t('输出保留透明背景。')
                : t('描述要保留的细节和希望进行的调整。')
            }
          >
            <textarea
              rows={3}
              value={prompt}
              maxLength={12000}
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
            {(has('ratio') || isVideo) && (
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
            {isVideo && !isKling && (
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
            {has('language') && !has('languages') && (
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
          {(id === 'image-replica' || id === 'video-replica') && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={needText}
                onChange={(e) => setNeedText(e.target.checked)}
              />
              {t('包含文字 / 字幕')}
            </label>
          )}
          {id === 'video-replica' && (mode === 'exact' || isKling) && (
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
              <MaskEditor asset={assets[0]} onMask={setMask} />
            ) : (
              <Notice>{t('上传原始图片后，在画面上标记需要重绘的区域。')}</Notice>
            ))}
          {id === 'video-replica' && (
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

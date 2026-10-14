import { formatAssetMention, extractAssetMentions } from '../../contracts/mentions';
import { t } from '../lib/i18n';
import { DesignPlanner, createDesign, type MaterialDesign } from './DesignPlanner';
import { AIWriter } from './AIWriter';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Save, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AssetDto, BrandDto, ProjectDto } from '../../contracts/core';
import {
  IMAGE_KINDS,
  VIDEO_KINDS,
  IMAGE_RATIOS,
  LANGUAGES,
  PLATFORMS,
} from '../../contracts/catalog';
import { api, post, useApi, useRefresh, type Page } from '../lib/api';
import {
  jobInput,
  modelName,
  modelValue,
  type Capabilities,
  type Job,
  type JobInput,
} from '../lib/tasks';
import { AssetPicker } from './AssetPicker';
import { JobSubmit } from './JobSubmit';
import { Button, Confirm, Field, Notice, Segments, useAction, useToast } from './ui';
import { useStudio } from '../context';
interface Props {
  initialDraft?: JobInput;
  initialPrompt?: string;
  initialKind?: 'image' | 'video';
  projectId?: string;
  documentId?: string;
  revision?: number;
  compact?: boolean;
  onCreated?: (job: Job) => void;
  onSaved?: (project: ProjectDto) => void;
}
export function Composer({
  initialDraft,
  initialPrompt = '',
  initialKind = 'image',
  projectId,
  documentId,
  revision,
  compact = false,
  onCreated,
  onSaved,
}: Props) {
  const { canEdit, session } = useStudio();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(
    null,
  );
  const [pendingAssets, setPendingAssets] = useState<{
    kind: 'main' | 'extra';
    assets: AssetDto[];
    removed: string[];
  } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [kind, setKind] = useState<'image' | 'video'>(
    initialDraft?.operation === 'video.generate' ? 'video' : initialKind,
  );
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? initialPrompt);
  const [expanded, setExpanded] = useState(compact);
  const [extraReferences, setExtraReferences] = useState<AssetDto[]>([]);
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [operationKey, setOperationKey] = useState(
    initialDraft ? `${initialDraft.operation}:${initialDraft.providerId}` : '',
  );
  const [model, setModel] = useState(initialDraft?.options.model ?? '');
  const [ratio, setRatio] = useState(initialDraft?.options.ratio ?? '1:1');
  const [count, setCount] = useState(initialDraft?.options.count ?? 1);
  const [duration, setDuration] = useState(initialDraft?.options.duration ?? 5);
  const [resolution, setResolution] = useState(initialDraft?.options.resolution ?? '1K');
  const [outputKind, setOutputKind] = useState(initialDraft?.options.kind ?? 'free');
  const [designs, setDesigns] = useState<MaterialDesign[]>(initialDraft?.options.designs ?? []);
  const multiple =
    kind === 'image' &&
    ['detail', 'product-set', 'main-secondary', 'marketing'].includes(outputKind);
  const [brandId, setBrandId] = useState(initialDraft?.brandId ?? '');
  const [language, setLanguage] = useState(
    initialDraft?.options.language ?? session?.user.preferences.defaultCreationLanguage ?? 'zh-CN',
  );
  const [platform, setPlatform] = useState(
    initialDraft?.options.platform ?? session?.user.preferences.defaultPlatform ?? '通用电商',
  );
  const [needText, setNeedText] = useState(initialDraft?.options.needText ?? true);
  const [referenceMode, setReferenceMode] = useState<string>(
    initialDraft?.options.referenceMode ?? 'all',
  );
  const navigate = useNavigate();
  const refresh = useRefresh();
  const toast = useToast();
  const action = useAction();
  const capabilities = useApi<Capabilities>('/capabilities');
  const brands = useApi<Page<BrandDto>>('/brands?pageSize=100');
  const operations =
    capabilities.data?.operations.filter((op) => op.id === `${kind}.generate`) ?? [];
  const operation =
    operations.find((op) => `${op.id}:${op.providerId}` === operationKey) ??
    operations.find((op) => op.available) ??
    operations[0];
  const currentModel = operation?.models.find((m) => m.id === model) ?? operation?.models[0];
  const firstLast = kind === 'video' && referenceMode === 'first-last';
  const isO3 = currentModel?.id === 'kling-o3-4k-reference';
  const isKling = kind === 'video' && currentModel?.id.startsWith('kling-');
  const acceptsFirstLast = kind === 'video' && (currentModel?.id === 'kling-o1-first-last' || isO3);
  const sourceMax = kind === 'image' ? 20 : firstLast ? 2 : isKling ? 7 : 1;
  const invalidVideoReferences =
    kind === 'video' &&
    (references.length > sourceMax ||
      references.some((a) => a.kind !== 'image' && !(isO3 && !firstLast && a.kind === 'video')) ||
      (firstLast && references.length !== 2) ||
      (isKling && !firstLast && references.length < 1) ||
      (isO3 && [...references, ...extraReferences].filter((a) => a.kind === 'video').length > 1) ||
      (!!isKling && prompt.length > 2100));
  useEffect(() => {
    setPrompt(initialDraft?.prompt ?? initialPrompt);
  }, [initialPrompt, initialDraft?.prompt]);
  useEffect(() => {
    let cancelled = false;
    if (initialDraft?.referenceAssetIds.length)
      void Promise.all(initialDraft.referenceAssetIds.map((id) => api<AssetDto>(`/assets/${id}`)))
        .then((items) => {
          if (!cancelled) setExtraReferences(items);
        })
        .catch((error) =>
          toast(error instanceof Error ? error.message : '草稿素材加载失败', 'error'),
        );
    if (initialDraft?.assetIds.length)
      void Promise.all(initialDraft.assetIds.map((id) => api<AssetDto>(`/assets/${id}`)))
        .then((items) => {
          if (!cancelled) setReferences(items);
        })
        .catch((error) =>
          toast(error instanceof Error ? error.message : '草稿素材加载失败', 'error'),
        );
    return () => {
      cancelled = true;
    };
  }, [initialDraft?.assetIds.join(','), initialDraft?.referenceAssetIds.join(',')]);
  useEffect(() => {
    if (currentModel) {
      if (kind === 'video') {
        if (currentModel.id === 'kling-o1-first-last') setReferenceMode('first-last');
        else if (currentModel.id !== 'kling-o3-4k-reference') setReferenceMode('all');
      }
      if (!currentModel.ratios.includes(ratio)) setRatio(currentModel.ratios[0] ?? '1:1');
      if (!currentModel.resolutions.includes(resolution))
        setResolution(currentModel.resolutions[0] ?? '1K');
      if (currentModel.durations.length && !currentModel.durations.includes(duration))
        setDuration(currentModel.durations[0] ?? 5);
    }
  }, [currentModel?.id]);
  const input = jobInput({
    operation: `${kind}.generate`,
    providerId: operation?.providerId ?? 'openai',
    prompt,
    assetIds: references.map((asset) => asset.id),
    referenceAssetIds: firstLast && isO3 ? extraReferences.map((a) => a.id) : [],
    ...(projectId ? { projectId } : {}),
    ...(initialDraft?.characterId
      ? { characterId: initialDraft.characterId, characterRevision: initialDraft.characterRevision }
      : {}),
    ...(documentId && revision && revision >= 1 ? { documentId, baseRevision: revision } : {}),
    ...(brandId && !(firstLast && !isO3) ? { brandId } : {}),
    options: {
      ...(multiple && designs.length
        ? { designs: designs.map((d) => ({ ...d, name: d.name.trim() || '未命名模块' })) }
        : {}),
      model: currentModel?.id,
      kind: outputKind,
      ratio,
      count,
      resolution,
      duration,
      language,
      platform,
      needText,
      referenceMode,
    },
  });
  const mentionAssets = [
    ...new Map([...references, ...extraReferences].map((asset) => [asset.id, asset])).values(),
  ];
  function editPrompt(value: string, caret: number) {
    setPrompt(value);
    const before = value.slice(0, caret);
    const match = before.match(/(?:^|\s)@([^\s@\[\]]*)$/);
    setMention(
      match ? { start: before.lastIndexOf('@'), end: caret, query: match[1] ?? '' } : null,
    );
  }
  function insertMention(asset: AssetDto) {
    const start = mention?.start ?? promptRef.current?.selectionStart ?? prompt.length;
    const end = mention?.end ?? promptRef.current?.selectionEnd ?? start;
    const token = formatAssetMention(asset.name, asset.id) + ' ';
    const next = prompt.slice(0, start) + token + prompt.slice(end);
    setPrompt(next);
    setMention(null);
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  function changeAssets(next: AssetDto[], kind: 'main' | 'extra') {
    const previous = kind === 'main' ? references : extraReferences;
    const removed = previous.filter((a) => !next.some((b) => a.id === b.id)).map((a) => a.id);
    if (extractAssetMentions(prompt).some((item) => removed.includes(item.assetId))) {
      setPendingAssets({ kind, assets: next, removed });
      return;
    }
    if (kind === 'main') setReferences(next);
    else setExtraReferences(next);
  }
  async function save() {
    await action.run(async () => {
      let project: ProjectDto;
      if (projectId) {
        await post(`/projects/${projectId}/messages`, {
          role: 'user',
          content: prompt,
          metadata: { draft: input },
        });
        project = await api<ProjectDto>(`/projects/${projectId}`);
      } else {
        project = await post<ProjectDto>('/projects', {
          name:
            extractAssetMentions(prompt)
              .reduce((text, item) => text.replaceAll(item.token, item.name), prompt)
              .trim()
              .slice(0, 60) || '未命名创作',
          kind,
          description: prompt,
        });
        await post(`/projects/${project.id}/messages`, {
          role: 'user',
          content: prompt || '新的创作草稿',
          metadata: { draft: input },
        });
      }
      await refresh();
      onSaved?.(project);
      if (!projectId) navigate(`/workbench/${project.id}`);
    }, '草稿已保存');
  }
  return (
    <div className={`composer ${compact ? 'composer-compact' : ''}`}>
      <div className="composer-top">
        <Segments
          value={kind}
          onChange={(next) => {
            setKind(next);
            setModel('');
            setOperationKey('');
            setOutputKind('free');
          }}
          options={[
            { value: 'image', label: '图片创作' },
            { value: 'video', label: '视频创作' },
          ]}
        />
        <span className="composer-note">
          <Sparkles size={14} />
          {t('让灵感更进一步')}
        </span>
      </div>
      <textarea
        ref={promptRef}
        className="prompt-input"
        aria-label={t('创作需求')}
        value={prompt}
        onChange={(e) => editPrompt(e.target.value, e.target.selectionStart)}
        placeholder={
          kind === 'image'
            ? t('描述你的下一件作品，比如：为一款植物精华设计自然、清新的商品主图…')
            : t('描述画面、主体动作与镜头，比如：一束晨光缓缓掠过产品，镜头轻轻推进…')
        }
        maxLength={isKling ? 2100 : 12000}
      />
      {mention && (
        <div className="mention-menu" role="listbox" aria-label={t('选择引用素材')}>
          {mentionAssets.filter((a) =>
            a.name.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase()),
          ).length ? (
            mentionAssets
              .filter((a) => a.name.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase()))
              .map((asset) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  key={asset.id}
                  onClick={() => insertMention(asset)}
                >
                  {asset.name}
                </button>
              ))
          ) : (
            <p>{t('先添加参考素材，再输入 @ 选择引用。')}</p>
          )}
        </div>
      )}
      {mentionAssets.length > 0 && (
        <div className="mention-chips">
          <span className="muted">{t('引用素材')}</span>
          {mentionAssets.map((asset) => (
            <button
              type="button"
              key={asset.id}
              onClick={() => insertMention(asset)}
              title={asset.name}
            >
              @ {asset.name}
            </button>
          ))}
        </div>
      )}
      <div className="composer-options">
        <label className="compact-select">
          <span className="sr-only">{t('模型与服务')}</span>
          <select
            value={operation ? `${operation.id}:${operation.providerId}` : ''}
            onChange={(e) => {
              setOperationKey(e.target.value);
              setModel('');
            }}
          >
            {!operations.length && <option value="">{t('加载模型…')}</option>}
            {operations.map((op) => (
              <option key={`${op.id}:${op.providerId}`} value={`${op.id}:${op.providerId}`}>
                {
                  { openai: 'OpenAI', fal: 'fal.ai', flyelep: 'Flyelep', local: 'Local' }[
                    op.providerId
                  ]
                }{' '}
                · {t(op.name)}
                {op.available ? '' : t(' · 未连接')}
              </option>
            ))}
          </select>
        </label>
        {operation && operation.models.length > 0 && (
          <label className="compact-select">
            <span className="sr-only">{t('生成模型')}</span>
            <select value={currentModel?.id ?? ''} onChange={(e) => setModel(e.target.value)}>
              {operation.models.map((m) => (
                <option key={modelValue(m)} value={modelValue(m)}>
                  {modelName(m)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="compact-select">
          <span className="sr-only">{t('比例')}</span>
          <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
            {(currentModel?.ratios.length ? currentModel.ratios : IMAGE_RATIOS).map((item) => (
              <option key={item} value={item}>
                {item === 'auto' ? t('智能比例') : item}
              </option>
            ))}
          </select>
        </label>
        {kind === 'image' ? (
          <label className="compact-select">
            <span className="sr-only">{t('生成数量')}</span>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                  {t('张')}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="compact-select">
            <span className="sr-only">{t('时长')}</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {(currentModel?.durations.length ? currentModel.durations : [5, 10]).map((n) => (
                <option key={n} value={n}>
                  {n}
                  {t('秒')}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="text-button" type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t('收起') : t('更多设置')}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {expanded && (
        <div className="composer-advanced">
          <AssetPicker
            value={references}
            onChange={(items) => changeAssets(items, 'main')}
            kind={kind === 'image' ? 'all' : isO3 && !firstLast ? 'visual' : 'image'}
            max={sourceMax}
            roleLabels={firstLast ? ['首帧', '尾帧'] : undefined}
            projectId={projectId}
            label={
              kind === 'image'
                ? t('参考图片、视频或文档')
                : firstLast
                  ? t('首帧与尾帧（按顺序）')
                  : t('视频创作参考素材')
            }
          />
          {firstLast && references.length === 1 && (
            <Button variant="ghost" onClick={() => setReferences([references[0]!, references[0]!])}>
              {t('使用同一图片作为首尾帧')}
            </Button>
          )}
          {firstLast && references.length === 2 && (
            <Button variant="ghost" onClick={() => setReferences([...references].reverse())}>
              {t('交换首尾帧')}
            </Button>
          )}
          {firstLast && isO3 && (
            <AssetPicker
              value={extraReferences}
              onChange={(items) => changeAssets(items, 'extra')}
              kind="visual"
              max={7}
              projectId={projectId}
              label={t('额外参考素材（可选）')}
            />
          )}
          {isKling && (
            <Notice>
              {firstLast
                ? t('首帧与尾帧必须是两张图片，并按先后顺序排列。')
                : t('参考模式需要 1–7 份素材。')}{' '}
              {t('图片宽高至少 300px，比例 0.4–2.5。提示词最多 2100 字符。')}
              {isO3 && t('最多参考一个视频，3–10 秒、720–2160px、24–60fps。')}
            </Notice>
          )}
          {invalidVideoReferences && (
            <Notice tone="warning">
              {t('请按当前视频模型要求调整参考素材数量、类型或提示词长度。')}
            </Notice>
          )}
          <div className="form-grid">
            <Field label={t('创作类型')}>
              <select
                value={outputKind}
                onChange={(e) => {
                  setOutputKind(e.target.value);
                  if (
                    !designs.length &&
                    ['detail', 'product-set', 'main-secondary', 'marketing'].includes(
                      e.target.value,
                    )
                  )
                    setDesigns([
                      createDesign('hero'),
                      createDesign('benefits'),
                      createDesign('lifestyle'),
                    ]);
                }}
              >
                {(kind === 'image' ? IMAGE_KINDS : VIDEO_KINDS).map((option) => (
                  <option key={option.id} value={option.id}>
                    {t(option.name)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('清晰度')}>
              <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                {(currentModel?.resolutions.length ? currentModel.resolutions : ['1K', '2K']).map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label={t('参考品牌')}>
              <select
                disabled={firstLast && !isO3}
                value={firstLast && !isO3 ? '' : brandId}
                onChange={(e) => setBrandId(e.target.value)}
              >
                <option value="">{t('不使用品牌')}</option>
                {brands.data?.items.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('发布平台')}>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {PLATFORMS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label={t('画面文字语言')}>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((value) => (
                  <option key={value.id} value={value.id}>
                    {t(value.name)}
                  </option>
                ))}
              </select>
            </Field>
            {kind === 'video' && (
              <Field label={t('参考方式')}>
                <select
                  disabled={!acceptsFirstLast || currentModel?.id === 'kling-o1-first-last'}
                  value={referenceMode}
                  onChange={(e) => setReferenceMode(e.target.value)}
                >
                  {currentModel?.id !== 'kling-o1-first-last' && (
                    <option value="all">{t('全能参考')}</option>
                  )}
                  {acceptsFirstLast && <option value="first-last">{t('首尾帧')}</option>}
                </select>
              </Field>
            )}
          </div>
          {multiple && (
            <DesignPlanner
              value={designs}
              onChange={setDesigns}
              ratios={currentModel?.ratios}
              projectId={projectId}
              count={count}
            />
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={needText}
              onChange={(e) => setNeedText(e.target.checked)}
            />
            {t('生成画面文案 / 字幕')}
          </label>
        </div>
      )}
      <div className="composer-bottom">
        <Button variant="ghost" onClick={() => setAssistantOpen(true)} disabled={!canEdit}>
          <Sparkles size={15} />
          {t('AI 帮我写')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void save()}
          busy={action.busy}
          disabled={!canEdit || !prompt.trim()}
        >
          <Save size={15} />
          {t('保存草稿')}
        </Button>
        <span className="muted">
          {prompt.length} / {isKling ? 2100 : 12000}
        </span>
      </div>
      {assistantOpen && (
        <AIWriter
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          prompt={prompt}
          assets={references}
          projectId={projectId}
          onAccept={setPrompt}
        />
      )}
      <Confirm
        open={!!pendingAssets}
        onClose={() => setPendingAssets(null)}
        title={t('移除素材与引用？')}
        description={t(
          '创作需求正在引用这些素材。确认后将同时移除素材和对应的 @ 引用，其他文案保持不变。',
        )}
        onConfirm={() => {
          if (!pendingAssets) return;
          let next = prompt;
          for (const item of extractAssetMentions(prompt))
            if (pendingAssets.removed.includes(item.assetId))
              next = next.replaceAll(item.token, '');
          setPrompt(next);
          if (pendingAssets.kind === 'main') setReferences(pendingAssets.assets);
          else setExtraReferences(pendingAssets.assets);
          setPendingAssets(null);
        }}
      />
      <JobSubmit
        input={input}
        operation={operation}
        valid={
          !!prompt.trim() &&
          !invalidVideoReferences &&
          (!multiple || (designs.length > 0 && designs.every((d) => !!d.name.trim())))
        }
        onCreated={onCreated}
      />
    </div>
  );
}

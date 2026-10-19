import { useStudio } from '../context';
import { parseOcrResult } from './OCRResultPanel';
import { t } from '../lib/i18n';
import { productWarning } from '../lib/product-messages';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  FileType,
  Layers3,
  Languages,
  Maximize,
  Plus,
  ScanText,
  Scissors,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import type { AssetDto } from '../../contracts/core';
import { LANGUAGES } from '../../contracts/catalog';
import { jobInput, type Capabilities, type Job, type JobInput } from '../lib/tasks';
import { api, qs, useApi, type Page } from '../lib/api';
import { readDraft, writeDraft, restoreAssets } from '../lib/creation-recovery';
import {
  advancedDraftStorageKey,
  matchingAdvancedDraft,
  findAdvancedDraftBatch,
  advancedParameterSelection,
  saveAdvancedDraft,
  type ToolDraftPage,
} from '../lib/advanced-recovery';
import { AssetPicker } from './AssetPicker';
import { JobSubmit } from './JobSubmit';
import { JobCard } from './TaskCenter';
import {
  Badge,
  Confirm,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  useToast,
} from './ui';
export const advancedTools = [
  {
    id: 'image.ocr',
    name: '图片文字识别',
    description: '读取图片中的文字，保留真实识别结果',
    icon: ScanText,
    kind: 'image',
  },
  {
    id: 'image.text-edit',
    name: '图片改字',
    description: '替换指定文字与区域，保留画面风格',
    icon: FileType,
    kind: 'image',
  },
  {
    id: 'image.layers',
    name: '图层拆分',
    description: '将图片拆解成可独立使用的元素',
    icon: Layers3,
    kind: 'image',
  },
  {
    id: 'video.extend',
    name: '视频延长',
    description: '从已有片段继续生成后续内容',
    icon: Video,
    kind: 'video',
  },
  {
    id: 'video.edit',
    name: '视频编辑',
    description: '按描述调整视频画面与场景',
    icon: Sparkles,
    kind: 'video',
  },
  {
    id: 'video.upscale',
    name: '视频超分',
    description: '改善原视频分辨率与清晰度',
    icon: Maximize,
    kind: 'video',
  },
  {
    id: 'video.erase-subtitles',
    name: '视频去字幕',
    description: '使用通用编辑模型处理短视频文字区域，效果需预览确认',
    icon: Scissors,
    kind: 'video',
  },
  {
    id: 'video.translate',
    name: '视频翻译',
    description: '将视频中的语言转换为目标语言',
    icon: Languages,
    kind: 'video',
  },
] as const;
export function AdvancedToolCards() {
  return (
    <section className="section-spaced">
      <div className="section-heading">
        <div>
          <h2>{t('进阶工作流')}</h2>
          <p className="muted">{t('从文字识别到视频后期，连接对应服务后执行。')}</p>
        </div>
        <Badge>{t('图片与视频')}</Badge>
      </div>
      <div className="tools-grid">
        {advancedTools.map((tool) => (
          <Link to={`/advanced/${tool.id}`} className="tool-card" key={tool.id}>
            <span className="tool-icon" style={{ background: '#eaf1ec' }}>
              <tool.icon size={24} />
            </span>
            <div className="tool-title">
              <h3>{t(tool.name)}</h3>
              <ArrowUpRight size={16} />
            </div>
            <p>{t(tool.description)}</p>
            <Badge>{tool.kind === 'image' ? t('图片处理') : t('视频后期')}</Badge>
          </Link>
        ))}
      </div>
    </section>
  );
}
interface TextReplacement {
  originalText: string;
  replaceText: string;
  rect: [number, number, number, number];
}
export function AdvancedToolPage() {
  const { operationId } = useParams();
  const [pageSearch] = useSearchParams();
  const { workspace, session } = useStudio();
  const tool = advancedTools.find((item) => item.id === operationId);
  if (!tool)
    return (
      <div className="page">
        <Empty title={t('未找到此工作流')} action={<Link to="/tools">{t('返回工具箱')}</Link>} />
      </div>
    );
  return (
    <AdvancedToolForm
      key={`${session?.user.id}:${workspace?.id}:${tool.id}:${pageSearch.toString()}`}
      tool={tool}
    />
  );
}
function AdvancedToolForm({ tool }: { tool: (typeof advancedTools)[number] }) {
  const { canEdit, session, workspace } = useStudio();
  const [search] = useSearchParams();
  const projectId = search.get('projectId') ?? undefined;
  const ocrJobId = search.get('ocrJobId');
  const ocrSource =
    ocrJobId && tool.id === 'image.text-edit'
      ? {
          jobId: ocrJobId,
          itemId: search.get('ocrItemId') ?? '',
          region: search.get('region') ?? '0',
        }
      : undefined;
  const ocrSourceKey = ocrSource ? JSON.stringify(ocrSource) : '';
  const navigate = useNavigate();
  const toast = useToast();
  const storageKey = advancedDraftStorageKey(
    session!.user.id,
    workspace!.id,
    tool.id,
    projectId,
    ocrSource,
  );
  const [localDraft] = useState(() => {
    try {
      return readDraft(localStorage, storageKey);
    } catch {
      return { value: null, error: '浏览器草稿存储不可用。' };
    }
  });
  const localInput = matchingAdvancedDraft(localDraft.value, tool.id);
  const [storageError, setStorageError] = useState(localDraft.error);
  const [storageBlocked, setStorageBlocked] = useState(!!localDraft.error);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [failures, setFailures] = useState<{ id: string; message: string }[]>([]);
  const [resolvedKey, setResolvedKey] = useState('');
  const [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const createdProject = useRef<string | null>(projectId ?? null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [saving, setSaving] = useState(false);
  const [restored, setRestored] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [searchState, setSearchState] = useState<{
    status: 'loading' | 'ready' | 'limited' | 'error';
    nextPage: number;
    error?: string;
  }>({ status: 'loading', nextPage: 1 });
  const [searchStart, setSearchStart] = useState(1);
  const [searchRound, setSearchRound] = useState(0);
  const [ocrAttempt, setOcrAttempt] = useState(0);
  const ocrJob = useApi<Job>(`/jobs/${ocrJobId ?? ''}`, !!ocrSource && !localInput && !restored);
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [prompt, setPrompt] = useState('');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [language, setLanguage] = useState('en');
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState(tool.kind === 'image' ? '1K' : '1080p');
  const [scale, setScale] = useState(2);
  const [replacements, setReplacements] = useState<TextReplacement[]>([
    { originalText: '', replaceText: '', rect: [0, 0, 100, 40] },
  ]);
  function applyDraft(draft: JobInput | undefined) {
    setRestored(true);
    if (!draft) return;
    createdProject.current = projectId ?? draft.projectId ?? null;
    setPrompt(draft.prompt);
    setProviderId(draft.providerId);
    setModelId(draft.options.model ?? '');
    setLanguage(draft.options.language);
    setDuration(draft.options.duration);
    setResolution(draft.options.resolution);
    setScale(draft.options.scale);
    setReplacements(draft.options.textReplacements ?? []);
    setAssetIds(draft.assetIds);
    setReferenceIds(draft.referenceAssetIds);
  }
  useEffect(() => {
    if (restored) return;
    if (localInput) {
      applyDraft(localInput);
      return;
    }
    if (ocrSourceKey) return;
    if (!projectId) {
      applyDraft(undefined);
      return;
    }
    const controller = new AbortController();
    setSearchState((previous) => ({ ...previous, status: 'loading', error: undefined }));
    void findAdvancedDraftBatch(
      tool.id,
      (page, signal) =>
        api<ToolDraftPage>(
          `/projects/${projectId}/messages?pageSize=100&page=${page}`,
          { signal },
          workspace!.id,
        ),
      controller.signal,
      searchStart,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setSearchState(result);
        if (result.status === 'ready') applyDraft(result.draft);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setSearchState((previous) => ({
            ...previous,
            status: 'error',
            error: error instanceof Error ? error.message : '工具草稿读取失败',
          }));
      });
    return () => controller.abort();
  }, [
    restored,
    localInput,
    projectId,
    ocrSourceKey,
    tool.id,
    searchStart,
    searchRound,
    workspace?.id,
  ]);
  const assetKey = JSON.stringify([assetIds, referenceIds]);
  useEffect(() => {
    let cancelled = false;
    void restoreAssets([...assetIds, ...referenceIds], (id) =>
      api<AssetDto>(`/assets/${id}`, {}, workspace!.id),
    ).then((result) => {
      if (cancelled) return;
      const byId = new Map(result.assets.map((asset) => [asset.id, asset]));
      setAssets(assetIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
      setReferences(referenceIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
      setFailures(result.failures);
      setResolvedKey(assetKey);
    });
    return () => {
      cancelled = true;
    };
  }, [assetKey, retry, workspace?.id]);
  const referencesReady = resolvedKey === assetKey && !failures.length;
  useEffect(() => {
    if (restored || localInput || !ocrJob.data || !ocrSource) return;
    setRestoreError('');
    const item = ocrSource.itemId
      ? ocrJob.data.items.find((item) => item.id === ocrSource.itemId)
      : ocrJob.data.items.find((item) => item.resultText);
    const result = item?.resultText ? parseOcrResult(item.resultText) : null;
    if (!result) {
      setRestoreError('该任务没有可导入的结构化文字区域。');
      return;
    }
    const index = Number(ocrSource.region);
    const region = result.regions[index];
    if (!Number.isSafeInteger(index) || index < 0 || !region) {
      setRestoreError('该任务没有可导入的结构化文字区域。');
      return;
    }
    let cancelled = false;
    void api<AssetDto>(`/assets/${result.imageAssetId}`, {}, workspace!.id)
      .then((asset) => {
        if (cancelled) return;
        setAssets([asset]);
        setAssetIds([asset.id]);
        setReplacements([{ originalText: region.text, replaceText: '', rect: region.rect }]);
        createdProject.current = projectId ?? ocrJob.data.projectId ?? null;
        setRestored(true);
        setRestoreError('');
      })
      .catch((error) => {
        if (!cancelled)
          setRestoreError(error instanceof Error ? error.message : '草稿素材读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, [ocrJob.data, restored, localInput, ocrSourceKey, ocrAttempt, projectId, workspace?.id]);
  const caps = useApi<Capabilities>('/capabilities');
  const operations = caps.data?.operations.filter((item) => item.id === tool.id) ?? [];
  const selection = advancedParameterSelection(
    { operation: tool.id, providerId, modelId, duration, resolution, language, scale },
    operations,
  );
  const { operation, model } = selection;
  const history = useApi<Page<Job>>(`/jobs${qs({ operation: tool.id, pageSize: 30 })}`, true, 5000);
  const input = jobInput({
    operation: tool.id,
    providerId: selection.providerId || 'flyelep',
    prompt,
    ...(createdProject.current ? { projectId: createdProject.current } : {}),
    assetIds,
    referenceAssetIds: referenceIds,
    options: {
      model: selection.modelId || undefined,
      language,
      duration,
      resolution,
      scale,
      ...(tool.id === 'image.text-edit' ? { textReplacements: replacements } : {}),
    },
  });
  const snapshot = JSON.stringify(input);
  useEffect(() => {
    if (!restored || caps.isLoading || storageBlocked) return;
    try {
      writeDraft(localStorage, storageKey, { input, drafts: {} });
      setStorageError(null);
    } catch {
      setStorageError('本机草稿保存失败，请保存到项目后离开。');
    }
  }, [snapshot, restored, caps.isLoading, storageKey, storageBlocked]);
  const valid =
    restored &&
    !selection.warnings.length &&
    referencesReady &&
    assets.length > 0 &&
    (tool.id !== 'video.erase-subtitles' ||
      (!!assets[0]?.durationMs &&
        assets[0].durationMs > 0 &&
        assets[0].durationMs < 5000 &&
        prompt.length <= 1000)) &&
    (tool.id !== 'image.text-edit' ||
      (replacements.length > 0 &&
        replacements.every(
          (item) =>
            item.rect[0] >= 0 &&
            item.rect[1] >= 0 &&
            item.rect[2] > 0 &&
            item.rect[3] > 0 &&
            item.rect[0] + item.rect[2] <= (assets[0]?.width ?? 32768) &&
            item.rect[1] + item.rect[3] <= (assets[0]?.height ?? 32768),
        ))) &&
    (tool.id !== 'image.text-edit' ||
      replacements.every((item) => item.originalText.trim() && item.replaceText.trim()));
  async function saveDraft() {
    if (saving || !restored) return;
    setSaving(true);
    try {
      const result = await saveAdvancedDraft(
        input,
        {
          workspaceId: workspace!.id,
          projectId: createdProject.current,
          name: tool.name,
          kind: tool.kind,
        },
        {
          request: api,
          isActive: () => mounted.current,
          persist: (savedInput) => {
            createdProject.current = savedInput.projectId ?? null;
            try {
              writeDraft(localStorage, storageKey, { input: savedInput, drafts: {} });
            } catch {
              if (mounted.current)
                setStorageError('项目已创建，本机恢复记录无法保存，请保持此页重试。');
            }
          },
        },
      );
      if (mounted.current && result.saved) {
        toast(t('工具草稿已保存'));
        navigate(`/workbench/${result.projectId}`);
      }
    } catch (error) {
      if (mounted.current)
        toast(error instanceof Error ? error.message : '工具草稿保存失败', 'error');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <div className="page">
      {storageError && (
        <Notice tone="warning">
          {storageError}
          {storageBlocked && (
            <Button variant="ghost" onClick={() => setStorageBlocked(false)}>
              {t('已核对项目草稿，用当前内容替换本机记录')}
            </Button>
          )}
        </Notice>
      )}
      {!restored && ocrSource && (
        <Notice tone={ocrJob.error || restoreError ? 'warning' : 'info'}>
          {ocrJob.error ? (
            <ErrorState error={ocrJob.error} retry={ocrJob.refetch} />
          ) : (
            restoreError || '正在读取识别结果与原图…'
          )}
          {!!restoreError && (
            <Button
              variant="secondary"
              onClick={() => {
                void ocrJob.refetch();
                setOcrAttempt((value) => value + 1);
              }}
            >
              {t('重试导入')}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setRestoreError('');
              setRestored(true);
            }}
          >
            {t('放弃导入，手动编辑')}
          </Button>
        </Notice>
      )}
      {!restored && !ocrSource && projectId && (
        <Notice tone={searchState.status === 'error' ? 'warning' : 'info'}>
          {searchState.status === 'loading'
            ? t('正在查找此工具的历史草稿…')
            : searchState.status === 'limited'
              ? '已查找本批历史消息，尚未找到此工具草稿。更早消息尚未读取。'
              : searchState.error}
          {['limited', 'error'].includes(searchState.status) && (
            <Button
              variant="secondary"
              onClick={() => {
                setSearchStart(
                  searchState.status === 'limited' ? searchState.nextPage : searchStart,
                );
                setSearchRound((value) => value + 1);
              }}
            >
              {searchState.status === 'error' ? t('重试查找') : t('继续查找更早草稿')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setRestored(true)}>
            {t('停止查找，使用空白草稿')}
          </Button>
        </Notice>
      )}
      {!caps.isLoading && selection.warnings.length > 0 && (
        <Notice tone="warning">
          {selection.warnings.map((warning) => (
            <p key={warning}>{productWarning(warning)}</p>
          ))}
          <p>{t('原参数仍保存在草稿中。请逐项选择当前支持的值后提交。')}</p>
        </Notice>
      )}
      {!referencesReady && (
        <Notice tone="warning">
          {resolvedKey !== assetKey
            ? t('正在恢复素材，完成前暂不能提交。')
            : t('部分素材未恢复，现有引用仍保留。请重试或明确移除后继续。')}
          {failures.map((failure) => (
            <div key={failure.id}>
              <p>
                {failure.id.slice(-8)} · {failure.message}
              </p>
              <Button variant="ghost" onClick={() => setRemoving(failure.id)}>
                {t('移除失效引用')}
              </Button>
            </div>
          ))}
          {!!failures.length && (
            <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
              {t('重试恢复素材')}
            </Button>
          )}
        </Notice>
      )}
      <Confirm
        open={!!removing}
        title={t('移除失效引用？')}
        description={t('确认后将从当前工具草稿移除此素材引用；不会删除原文件。')}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          setAssetIds((ids) => ids.filter((id) => id !== removing));
          setReferenceIds((ids) => ids.filter((id) => id !== removing));
          setRemoving(null);
        }}
      />
      <Link to="/tools" className="back-link">
        <ArrowLeft size={16} />
        {t('全部工具')}
      </Link>
      <PageHeader
        title={t(tool.name)}
        description={t(tool.description)}
        action={
          <Button
            variant="secondary"
            busy={saving}
            disabled={!canEdit || !restored}
            onClick={() => void saveDraft()}
          >
            {t('保存为项目')}
          </Button>
        }
      />
      <div className="tool-workspace">
        <section className="panel tool-form">
          <div className="panel-heading">
            <h2>{t('输入与参数')}</h2>
            <Badge>{tool.kind === 'video' ? t('视频后期') : t('图片处理')}</Badge>
          </div>
          <fieldset
            disabled={!restored || saving || !canEdit}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <AssetPicker
              disabled={!restored || saving}
              value={assets}
              onChange={(next) => {
                if (tool.id === 'image.text-edit' && next[0]?.id !== assets[0]?.id)
                  setReplacements([{ originalText: '', replaceText: '', rect: [0, 0, 100, 40] }]);
                setAssets(next);
                setAssetIds([
                  ...next.map((asset) => asset.id),
                  ...assetIds.filter((id) => !assets.some((asset) => asset.id === id)),
                ]);
              }}
              label={tool.kind === 'image' ? t('原始图片') : t('原始视频')}
              kind={tool.kind}
              max={1}
            />
            {(tool.id === 'video.edit' || tool.id === 'video.extend') && (
              <AssetPicker
                disabled={!restored || saving}
                value={references}
                onChange={(next) => {
                  setReferences(next);
                  setReferenceIds([
                    ...next.map((asset) => asset.id),
                    ...referenceIds.filter((id) => !references.some((asset) => asset.id === id)),
                  ]);
                }}
                label={tool.id === 'video.extend' ? t('尾帧参考（可选）') : t('参考图片（可选）')}
                max={tool.id === 'video.extend' ? 1 : 4}
              />
            )}
            <Field label={t('处理说明')}>
              <textarea
                disabled={!restored || saving}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={tool.id === 'video.erase-subtitles' ? 1000 : 12000}
                rows={3}
                placeholder={
                  tool.id === 'image.ocr'
                    ? t('可选：说明需要关注的文字区域')
                    : t('描述你希望得到的结果…')
                }
              />
            </Field>
            <Field label={t('处理服务')}>
              <select
                disabled={!restored || saving}
                value={selection.providerId}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  setModelId('');
                }}
              >
                {providerId && !operation && (
                  <option value={providerId}>
                    {providerId}
                    {t('（当前不可用，原值保留）')}
                  </option>
                )}
                {!operations.length && (
                  <option value="">
                    {caps.isLoading ? t('正在加载能力…') : t('当前暂无已连接的适配能力')}
                  </option>
                )}
                {operations.map((item) => (
                  <option key={item.providerId} value={item.providerId}>
                    {t(item.name)} · {item.providerId}
                    {item.available ? '' : t('（未连接）')}
                  </option>
                ))}
              </select>
            </Field>
            {(operation?.models.length || modelId) && (
              <Field label={t('模型')}>
                <select
                  disabled={!restored || saving}
                  value={selection.modelId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  {modelId && !model && (
                    <option value={modelId}>
                      {modelId}
                      {t('（当前不支持，原值保留）')}
                    </option>
                  )}
                  {operation?.models.map((item) => (
                    <option value={item.id} key={item.id}>
                      {t(item.name)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {tool.id === 'video.erase-subtitles' && (
              <Notice
                tone={
                  assets[0] && (!assets[0].durationMs || assets[0].durationMs >= 5000)
                    ? 'warning'
                    : 'info'
                }
              >
                {t('Bria · 短片文字区域擦除')}
                <br />
                {t(
                  '仅支持小于 5 秒的源视频，保留音轨，不会自动裁短。通用编辑模型的处理效果需要预览确认，不保证无痕去字幕。',
                )}
                {assets[0] && (!assets[0].durationMs || assets[0].durationMs >= 5000) && (
                  <p>{t('请先裁剪视频到 5 秒以下，再提交处理。')}</p>
                )}
              </Notice>
            )}
            {(tool.id === 'video.extend' || !!model?.durations.length) && (
              <Field label={tool.id === 'video.extend' ? t('延长时长（秒）') : t('时长（秒）')}>
                <select
                  disabled={!restored || saving}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {model?.durations.length && !model.durations.includes(duration) ? (
                    <option value={duration}>
                      {duration}
                      {t('（当前不支持，原值保留）')}
                    </option>
                  ) : null}
                  {(model?.durations.length ? model.durations : [5, 10]).map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
            )}
            {!!model?.resolutions.length && (
              <Field label={t('清晰度')}>
                <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  {!model.resolutions.includes(resolution) && (
                    <option value={resolution}>
                      {resolution}
                      {t('（当前不支持，原值保留）')}
                    </option>
                  )}
                  {model.resolutions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {tool.id === 'video.upscale' && (
              <div className="form-grid">
                <Field label={t('放大倍数')}>
                  <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                    {![2, 4, 8].includes(scale) && (
                      <option value={scale}>
                        {scale}
                        {t('×（当前不支持，原值保留）')}
                      </option>
                    )}
                    {[2, 4, 8].map((value) => (
                      <option key={value} value={value}>
                        {value}×
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('预计输出尺寸')}>
                  <input
                    readOnly
                    value={
                      assets[0]?.width && assets[0]?.height
                        ? `${assets[0].width * scale} × ${assets[0].height * scale}`
                        : t('选择源视频后显示')
                    }
                  />
                </Field>
              </div>
            )}
            {tool.id === 'video.translate' && (
              <Field label={t('目标语言')}>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {!LANGUAGES.some((item) => item.id === language) && (
                    <option value={language}>
                      {language}
                      {t('（当前不支持，原值保留）')}
                    </option>
                  )}
                  {LANGUAGES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(item.name)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {tool.id === 'image.text-edit' && (
              <div className="replacement-list">
                <div className="section-heading">
                  <h3>{t('文字替换')}</h3>
                  <Button
                    variant="ghost"
                    disabled={replacements.length >= 100}
                    onClick={() =>
                      setReplacements([
                        ...replacements,
                        { originalText: '', replaceText: '', rect: [0, 0, 100, 40] },
                      ])
                    }
                  >
                    <Plus size={14} />
                    {t('添加')}
                  </Button>
                </div>
                {replacements.map((item, index) => (
                  <div className="replacement-row" key={index}>
                    <div className="form-grid">
                      <Field label={`${t('原文字')} ${index + 1}`}>
                        <input
                          value={item.originalText}
                          maxLength={1000}
                          onChange={(e) =>
                            setReplacements(
                              replacements.map((r, i) =>
                                i === index ? { ...r, originalText: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label={t('替换为')}>
                        <input
                          value={item.replaceText}
                          maxLength={1000}
                          onChange={(e) =>
                            setReplacements(
                              replacements.map((r, i) =>
                                i === index ? { ...r, replaceText: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="replacement-coordinates">
                      {['X', 'Y', '宽度', '高度'].map((label, position) => (
                        <Field key={label} label={t(label)}>
                          <input
                            type="number"
                            min={position < 2 ? 0 : 1}
                            max={32768}
                            value={item.rect[position]}
                            onChange={(e) =>
                              setReplacements(
                                replacements.map((r, i) => {
                                  if (i !== index) return r;
                                  const rect = [...r.rect] as TextReplacement['rect'];
                                  rect[position] = Math.max(
                                    position < 2 ? 0 : 1,
                                    Math.min(32768, Number(e.target.value) || 0),
                                  );
                                  return { ...r, rect };
                                }),
                              )
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      disabled={replacements.length === 1}
                      onClick={() => setReplacements(replacements.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={13} />
                      {t('移除')}
                    </Button>
                  </div>
                ))}
                <Notice>
                  {t(
                    '区域坐标为原图像素的 X、Y、宽、高。识别结果中的四角坐标需要先换算，不能直接填入这里。',
                  )}
                </Notice>
              </div>
            )}
            {tool.id === 'image.layers' && (
              <Notice>
                {t('模型输出 4 个独立图层，一次请求统一结算；应用到画布时将作为可展开的组合插入。')}
              </Notice>
            )}
          </fieldset>
          <JobSubmit
            recoveryScope={`advanced:${tool.id}:${projectId ?? 'new'}`}
            input={input}
            operation={operation}
            valid={valid}
            label={t('开始处理')}
          />
        </section>
        <section className="tool-results">
          <h2 className="section-heading">{t('处理记录')}</h2>
          {history.isLoading ? (
            <Loading />
          ) : history.error ? (
            <ErrorState error={history.error} />
          ) : history.data?.items.length ? (
            history.data.items
              .filter((job) => job.operation === tool.id)
              .map((job) => <JobCard key={job.id} job={job} />)
          ) : (
            <Empty
              title={t('准备好素材，开始下一步')}
              description={t('真实处理结果与文字输出会保存在任务记录中。')}
            />
          )}
        </section>
      </div>
    </div>
  );
}

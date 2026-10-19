import { formatAssetMention, extractAssetMentions } from '../../contracts/mentions';
import { t } from '../lib/i18n';
import { productWarning } from '../lib/product-messages';
import { DesignPlanner, createDesign, type MaterialDesign } from './DesignPlanner';
import { AIWriter } from './AIWriter';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
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
import { api, useApi, useRefresh, type Page } from '../lib/api';
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
import { Button, Confirm, Field, Notice, Segments, useAction } from './ui';
import { useStudio } from '../context';
import {
  draftStorageKey,
  readDraft,
  writeDraft,
  restoreAssets,
  type CreationDraft,
} from '../lib/creation-recovery';
import type { DesignPlan } from '../../contracts/design-plan';
import { buildPlanApplication } from '../lib/design-plan';
export interface ComposerController {
  applyPlan: (plan: DesignPlan, index: number) => void;
  addReference: (asset: AssetDto) => void;
}
interface Props {
  controllerRef?: Ref<ComposerController>;
  initialWarnings?: string[];
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
  initialDraft: serverDraft,
  initialWarnings = [],
  controllerRef,
  initialPrompt = '',
  initialKind = 'image',
  projectId,
  documentId,
  revision,
  compact = false,
  onCreated,
  onSaved,
}: Props) {
  const { canEdit, session, workspace } = useStudio();
  const storageKey = draftStorageKey(session!.user.id, workspace!.id, projectId);
  const [localDraft] = useState(() => {
    try {
      return readDraft(localStorage, storageKey);
    } catch {
      return { value: null, error: '浏览器存储不可用，当前修改仅保留在此页面。' };
    }
  });
  const initialDraft = localDraft.value?.input ?? serverDraft;
  const draftKind = initialDraft
    ? initialDraft.operation === 'video.generate'
      ? 'video'
      : 'image'
    : initialKind;
  const typeDrafts = useRef<CreationDraft['drafts']>(localDraft.value?.drafts ?? {});
  const [draftError, setDraftError] = useState(localDraft.error);
  const [draftBlocked, setDraftBlocked] = useState(!!localDraft.error);
  const [draftStatus, setDraftStatus] = useState(localDraft.value ? '已恢复本机草稿' : '');
  const warningDrafts = useRef<NonNullable<CreationDraft['warnings']>>(
    localDraft.value?.warnings ?? {},
  );
  const [planWarnings, setPlanWarnings] = useState<string[]>(
    warningDrafts.current[draftKind] ?? initialDraft?.creationWarnings ?? initialWarnings,
  );
  const finalized = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [boundProjectId, setBoundProjectId] = useState(projectId ?? initialDraft?.projectId);
  const projectRef = useRef(boundProjectId);
  const projectCreation = useRef<Promise<ProjectDto> | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(
    null,
  );
  const [pendingAssets, setPendingAssets] = useState<{
    kind: 'main' | 'extra';
    assets: AssetDto[];
    removed: string[];
  } | null>(null);
  const [missingToRemove, setMissingToRemove] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [kind, setKind] = useState<'image' | 'video'>(draftKind);
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? initialPrompt);
  const [expanded, setExpanded] = useState(false);
  const [extraReferences, setExtraReferences] = useState<AssetDto[]>([]);
  const [backgroundAudioId, setBackgroundAudioId] = useState(initialDraft?.backgroundAudioAssetId);
  const [backgroundAudio, setBackgroundAudio] = useState<AssetDto | undefined>();
  const [generateAudio, setGenerateAudio] = useState(initialDraft?.options.generateAudio ?? false);
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [referenceIds, setReferenceIds] = useState(initialDraft?.assetIds ?? []);
  const [extraReferenceIds, setExtraReferenceIds] = useState(initialDraft?.referenceAssetIds ?? []);
  const [assetFailures, setAssetFailures] = useState<{ id: string; message: string }[]>([]);
  const [assetRetry, setAssetRetry] = useState(0);
  const [restoringAssets, setRestoringAssets] = useState(false);
  const [resolvedAssetKey, setResolvedAssetKey] = useState('');
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
  const allReferenceIds = [
    ...(backgroundAudioId ? [backgroundAudioId] : []),
    ...referenceIds,
    ...extraReferenceIds,
    ...designs.flatMap((design) => design.assetIds),
  ];
  const referenceKey = JSON.stringify([
    backgroundAudioId,
    referenceIds,
    extraReferenceIds,
    designs.map((design) => design.assetIds),
  ]);
  const referencesReady =
    resolvedAssetKey === referenceKey && !restoringAssets && !assetFailures.length;
  useEffect(() => {
    let cancelled = false;
    setRestoringAssets(allReferenceIds.length > 0);
    const loaded = new Map<string, AssetDto>();
    void restoreAssets(allReferenceIds, async (id) => {
      const asset = await api<AssetDto>(`/assets/${id}`, {}, workspace!.id);
      if (!cancelled) {
        loaded.set(id, asset);
        setReferences(referenceIds.flatMap((key) => (loaded.has(key) ? [loaded.get(key)!] : [])));
        setExtraReferences(
          extraReferenceIds.flatMap((key) => (loaded.has(key) ? [loaded.get(key)!] : [])),
        );
      }
      return asset;
    }).then((result) => {
      if (cancelled) return;
      const byId = new Map(result.assets.map((asset) => [asset.id, asset]));
      setReferences(referenceIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
      setExtraReferences(extraReferenceIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
      setBackgroundAudio(backgroundAudioId ? byId.get(backgroundAudioId) : undefined);
      setAssetFailures(result.failures);
      setResolvedAssetKey(referenceKey);
      setRestoringAssets(false);
    });
    return () => {
      cancelled = true;
    };
  }, [referenceKey, assetRetry, workspace?.id]);
  useEffect(() => {
    if (currentModel) {
      const warnings: string[] = [];
      if (model && model !== currentModel.id) {
        warnings.push(`原模型当前不可选，已切换为 ${currentModel.name}，请确认参数。`);
        setModel(currentModel.id);
      }
      if (kind === 'video') {
        if (currentModel.id === 'kling-o1-first-last') setReferenceMode('first-last');
        else if (currentModel.id !== 'kling-o3-4k-reference') setReferenceMode('all');
      }
      if (!currentModel.ratios.includes(ratio)) {
        warnings.push(`当前模型不支持比例 ${ratio}，已调整为 ${currentModel.ratios[0] ?? '1:1'}。`);
        setRatio(currentModel.ratios[0] ?? '1:1');
      }
      if (!currentModel.resolutions.includes(resolution)) {
        warnings.push(
          `当前模型不支持清晰度 ${resolution}，已调整为 ${currentModel.resolutions[0] ?? '1K'}。`,
        );
        setResolution(currentModel.resolutions[0] ?? '1K');
      }
      if (currentModel.durations.length && !currentModel.durations.includes(duration)) {
        warnings.push(
          `当前模型不支持 ${duration} 秒，已调整为 ${currentModel.durations[0] ?? 5} 秒。`,
        );
        setDuration(currentModel.durations[0] ?? 5);
      }
      if (warnings.length)
        setPlanWarnings((previous) => [...new Set([...previous, ...warnings])].slice(-30));
    }
  }, [currentModel?.id]);
  const input = jobInput({
    creationWarnings: planWarnings,
    backgroundAudioAssetId: backgroundAudioId,
    operation: `${kind}.generate`,
    providerId: operation?.providerId ?? 'openai',
    prompt,
    assetIds: referenceIds,
    referenceAssetIds: firstLast && isO3 ? extraReferenceIds : [],
    ...(boundProjectId ? { projectId: boundProjectId } : {}),
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
      ...(currentModel?.audio?.mode === 'generated' || generateAudio ? { generateAudio } : {}),
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
  const localInput: JobInput = {
    ...input,
    creationWarnings: planWarnings,
    referenceAssetIds: extraReferenceIds,
    options: {
      ...input.options,
      model: model || currentModel?.id,
      ...(designs.length
        ? { designs: designs.map((d) => ({ ...d, name: d.name || '未命名模块' })) }
        : {}),
    },
  };
  const latestDraft = useRef({ input: localInput, kind, warnings: planWarnings });
  latestDraft.current = { input: localInput, kind, warnings: planWarnings };
  function acceptUploaded(
    asset: AssetDto,
    sourceKind: 'image' | 'video',
    slot: 'main' | 'extra' | 'audio',
    limit: number,
  ) {
    if (!mounted.current || finalized.current) return;
    const latest = latestDraft.current;
    const active = latest.kind === sourceKind;
    const original = active ? latest.input : typeDrafts.current[sourceKind];
    if (!original) return;
    const field = slot === 'main' ? 'assetIds' : 'referenceAssetIds';
    const selected =
      slot === 'audio'
        ? original.backgroundAudioAssetId
          ? [original.backgroundAudioAssetId]
          : []
        : original[field];
    if (selected.includes(asset.id)) return;
    if (selected.length >= limit) {
      setDraftError(
        t('上传已保存到素材库，但原草稿的素材槽已满。请从素材库选择，或先移除不需要的素材。'),
      );
      return;
    }
    const updated: JobInput =
      slot === 'audio'
        ? { ...original, backgroundAudioAssetId: asset.id }
        : { ...original, [field]: [...selected, asset.id] };
    typeDrafts.current[sourceKind] = updated;
    if (active) {
      latestDraft.current = { ...latest, input: updated };
      if (slot === 'main') {
        setReferenceIds(updated.assetIds);
        setReferences((items) => [...items.filter((item) => item.id !== asset.id), asset]);
      } else if (slot === 'extra') {
        setExtraReferenceIds(updated.referenceAssetIds);
        setExtraReferences((items) => [...items.filter((item) => item.id !== asset.id), asset]);
      } else {
        setBackgroundAudioId(asset.id);
        setBackgroundAudio(asset);
      }
    }
    try {
      const current = active ? updated : latest.input;
      writeDraft(localStorage, storageKey, {
        input: current,
        drafts: { ...typeDrafts.current, [latest.kind]: current },
        warnings: { ...warningDrafts.current, [latest.kind]: latest.warnings },
      });
      setDraftError(null);
    } catch {
      setDraftError(t('当前修改仅保留在此页面。浏览器无法保存草稿，请使用“保存草稿”保存到项目。'));
    }
  }
  function currentRecovery(project: string) {
    const latest = latestDraft.current;
    return {
      input: { ...latest.input, projectId: project },
      drafts: { ...typeDrafts.current, [latest.kind]: { ...latest.input, projectId: project } },
      warnings: { ...warningDrafts.current, [latest.kind]: latest.warnings },
    };
  }
  const draftSnapshot = JSON.stringify([localInput, planWarnings]);
  useEffect(() => {
    if (finalized.current || draftBlocked) return;
    typeDrafts.current[kind] = localInput;
    warningDrafts.current[kind] = planWarnings;
    try {
      writeDraft(localStorage, storageKey, {
        input: localInput,
        drafts: typeDrafts.current,
        warnings: warningDrafts.current,
      });
      setDraftError(null);
      setDraftStatus('草稿已保存在本机');
    } catch {
      setDraftError('当前修改仅保留在此页面。浏览器无法保存草稿，请使用“保存草稿”保存到项目。');
    }
  }, [draftSnapshot, storageKey, draftBlocked]);
  function switchKind(next: 'image' | 'video') {
    typeDrafts.current[kind] = localInput;
    warningDrafts.current[kind] = planWarnings;
    setPlanWarnings(warningDrafts.current[next] ?? []);
    const draft = typeDrafts.current[next];
    setKind(next);
    setPrompt(draft?.prompt ?? '');
    setOperationKey(draft ? `${draft.operation}:${draft.providerId}` : '');
    setModel(draft?.options.model ?? '');
    setRatio(draft?.options.ratio ?? (next === 'video' ? '16:9' : '1:1'));
    setCount(draft?.options.count ?? 1);
    setDuration(draft?.options.duration ?? 5);
    setResolution(draft?.options.resolution ?? (next === 'video' ? '720p' : '1K'));
    setOutputKind(draft?.options.kind ?? 'free');
    setDesigns(draft?.options.designs ?? []);
    setBrandId(draft?.brandId ?? '');
    setLanguage(
      draft?.options.language ?? session?.user.preferences.defaultCreationLanguage ?? 'zh-CN',
    );
    setPlatform(draft?.options.platform ?? session?.user.preferences.defaultPlatform ?? '通用电商');
    setNeedText(draft?.options.needText ?? true);
    setReferenceMode(draft?.options.referenceMode ?? 'all');
    setReferenceIds(draft?.assetIds ?? []);
    setExtraReferenceIds(draft?.referenceAssetIds ?? []);
    setReferences([]);
    setExtraReferences([]);
    setBackgroundAudioId(draft?.backgroundAudioAssetId);
    setBackgroundAudio(undefined);
    setGenerateAudio(draft?.options.generateAudio ?? false);
  }
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
    applyAssets(next, kind);
  }
  function applyAssets(next: AssetDto[], target: 'main' | 'extra') {
    const previous = target === 'main' ? references : extraReferences;
    const ids = target === 'main' ? referenceIds : extraReferenceIds;
    const unresolved = ids.filter((id) => !previous.some((asset) => asset.id === id));
    if (target === 'main') {
      setReferences(next);
      setReferenceIds([...next.map((asset) => asset.id), ...unresolved]);
    } else {
      setExtraReferences(next);
      setExtraReferenceIds([...next.map((asset) => asset.id), ...unresolved]);
    }
  }
  async function ensureProject(): Promise<ProjectDto> {
    if (projectRef.current)
      return api<ProjectDto>(`/projects/${projectRef.current}`, {}, workspace!.id);
    if (!projectCreation.current) {
      projectCreation.current = api<ProjectDto>(
        '/projects',
        {
          method: 'POST',
          body: JSON.stringify({
            name:
              extractAssetMentions(prompt)
                .reduce((text, item) => text.replaceAll(item.token, item.name), prompt)
                .trim()
                .slice(0, 60) || '未命名创作',
            kind,
            description: prompt,
          }),
        },
        workspace!.id,
      )
        .then((project) => {
          projectRef.current = project.id;
          if (mounted.current) setBoundProjectId(project.id);
          try {
            writeDraft(localStorage, storageKey, currentRecovery(project.id));
          } catch {
            setDraftError('项目已创建，请保存草稿后进入项目。浏览器无法保存本机恢复记录。');
          }
          return project;
        })
        .finally(() => {
          projectCreation.current = null;
        });
    }
    return projectCreation.current;
  }
  async function saveProjectDraft(payload: JobInput) {
    await api(
      `/projects/${payload.projectId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          role: 'user',
          content: payload.prompt || '新的创作草稿',
          metadata: { draft: payload, creationWarnings: planWarnings },
        }),
      },
      workspace!.id,
    );
  }
  async function prepareSubmission(payload: JobInput): Promise<JobInput> {
    const project = await ensureProject();
    const document =
      payload.documentId && payload.baseRevision
        ? { id: payload.documentId, revision: payload.baseRevision }
        : await api<{ id: string; revision: number }>(
            `/projects/${project.id}/document`,
            {},
            workspace!.id,
          );
    const prepared = {
      ...payload,
      projectId: project.id,
      documentId: document.id,
      baseRevision: document.revision,
    };
    await saveProjectDraft(prepared);
    return prepared;
  }
  async function save() {
    await action.run(async () => {
      const project = await ensureProject();
      await saveProjectDraft({ ...localInput, projectId: project.id });
      if (!mounted.current) return;
      setDraftStatus('草稿已保存到项目');
      await refresh();
      if (!mounted.current) return;
      onSaved?.(project);
      if (!projectId) {
        try {
          writeDraft(
            localStorage,
            draftStorageKey(session!.user.id, workspace!.id, project.id),
            currentRecovery(project.id),
          );
          localStorage.removeItem(storageKey);
        } catch {
          setDraftError(
            '项目已保存，但保存期间的最新修改未能转存。当前页面保留全部修改，请恢复浏览器存储后再次保存。',
          );
          return;
        }
        finalized.current = true;
        navigate(`/workbench/${project.id}`);
      }
    }, '草稿已保存');
  }
  function applyPlan(plan: DesignPlan, index: number) {
    if (!canEdit) throw new Error(t('当前角色不能编辑创作草稿。'));
    if (!currentModel || capabilities.isLoading)
      throw new Error(t('模型能力尚未读取完成，请稍后采用方案。'));

    const application = buildPlanApplication(plan, index, {
      ratios: currentModel?.ratios ?? [],
      resolutions: currentModel?.resolutions ?? [],
      languages: LANGUAGES.map((language) => language.id),
      maxPromptLength: isKling ? 2100 : 12000,
    });
    setPrompt(application.prompt);
    if (application.ratio) setRatio(application.ratio);
    if (application.resolution) setResolution(application.resolution);
    if (application.language) setLanguage(application.language);
    setNeedText(application.needText);
    setPlanWarnings(application.warnings);

    promptRef.current?.focus();
  }
  function addReference(asset: AssetDto) {
    if (!canEdit) throw new Error(t('当前角色不能编辑创作草稿。'));
    if (referenceIds.includes(asset.id)) {
      promptRef.current?.focus();
      return;
    }
    if (referenceIds.length >= sourceMax)
      throw new Error(`当前模式最多支持 ${sourceMax} 份参考素材，请先移除不需要的参考。`);
    if (asset.kind === 'video' && !(isO3 && !firstLast))
      throw new Error(t('当前模式不支持视频参考，请先选择支持视频参考的模型与模式。'));
    if (!['image', 'video'].includes(asset.kind)) throw new Error(t('此结果不能用作媒体参考。'));
    setReferenceIds((ids) => [...ids, asset.id]);
    setReferences((assets) => [...assets, asset]);
    promptRef.current?.focus();
  }
  useImperativeHandle(controllerRef, () => ({ applyPlan, addReference }));
  return (
    <div className={`composer ${compact ? 'composer-compact' : ''}`}>
      <div className="composer-top">
        <Segments
          value={kind}
          onChange={switchKind}
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
      <p className="field-hint" role="status">
        {t(draftStatus)} · {t('与画布保存分别记录')}
      </p>
      {draftError && (
        <Notice tone="warning">
          {draftError}
          {draftBlocked && (
            <Button variant="ghost" onClick={() => setDraftBlocked(false)}>
              {t('已核对项目草稿，用当前内容替换本机记录')}
            </Button>
          )}
        </Notice>
      )}
      {!!planWarnings.length && (
        <Notice tone="warning">
          {planWarnings.map((warning) => (
            <p key={warning}>{productWarning(warning)}</p>
          ))}
          <Button variant="ghost" onClick={() => setPlanWarnings([])}>
            {t('已核对当前参数')}
          </Button>
        </Notice>
      )}
      {!referencesReady && (
        <Notice tone="warning">
          {restoringAssets || resolvedAssetKey !== referenceKey
            ? t('正在恢复参考素材，完成前暂不能提交。')
            : t('部分参考素材未恢复。请重试，或明确移除失效引用后继续。')}
          {assetFailures.map((failure) => (
            <div key={failure.id}>
              <p>
                {failure.id.slice(-8)} · {failure.message}
              </p>
              <Button variant="ghost" onClick={() => setMissingToRemove(failure.id)}>
                {t('移除失效引用')}
              </Button>
            </div>
          ))}
          {!!assetFailures.length && (
            <Button variant="secondary" onClick={() => setAssetRetry((value) => value + 1)}>
              {t('重试恢复素材')}
            </Button>
          )}
        </Notice>
      )}
      <div className="composer-materials">
        <AssetPicker
          value={references}
          onChange={(items) => changeAssets(items, 'main')}
          uploadScope={`${kind}:main`}
          onUploaded={(asset) => acceptUploaded(asset, kind, 'main', sourceMax)}
          kind={kind === 'image' ? 'all' : isO3 && !firstLast ? 'visual' : 'image'}
          max={sourceMax}
          roleLabels={firstLast ? ['首帧', '尾帧'] : undefined}
          projectId={boundProjectId}
          label={
            kind === 'image'
              ? t('参考图片、视频或文档')
              : firstLast
                ? t('首帧与尾帧（按顺序）')
                : t('视频创作参考素材')
          }
        />
        <div hidden={!(currentModel?.audio?.mode === 'background-music' || backgroundAudioId)}>
          <AssetPicker
            value={backgroundAudio ? [backgroundAudio] : []}
            uploadScope={`${kind}:audio`}
            onUploaded={(asset) => acceptUploaded(asset, kind, 'audio', 1)}
            onChange={(assets) => {
              setBackgroundAudio(assets[0]);
              setBackgroundAudioId(assets[0]?.id);
            }}
            kind="audio"
            max={1}
            projectId={boundProjectId}
            label={t('背景音乐（可选）')}
          />
          <Notice>
            {currentModel?.audio?.mode === 'background-music'
              ? t(currentModel.audio.note)
              : t('当前模型不支持背景音乐。原音频已保留，请移除音频或切换支持的模型后提交。')}
          </Notice>
        </div>
        {(currentModel?.audio?.mode === 'generated' || generateAudio) && (
          <>
            <label className="check-row">
              <input
                type="checkbox"
                checked={generateAudio}
                onChange={(event) => setGenerateAudio(event.target.checked)}
              />
              {t('生成视频音轨')}
            </label>
            <Notice>
              {currentModel?.audio?.mode === 'generated'
                ? t(currentModel.audio.note)
                : t('当前模型不支持生成音轨。请关闭此选项或切换支持的模型。')}
            </Notice>
          </>
        )}
        {firstLast && references.length === 1 && (
          <Button
            variant="ghost"
            onClick={() => applyAssets([references[0]!, references[0]!], 'main')}
          >
            {t('使用同一图片作为首尾帧')}
          </Button>
        )}
        {firstLast && references.length === 2 && (
          <Button variant="ghost" onClick={() => applyAssets([...references].reverse(), 'main')}>
            {t('交换首尾帧')}
          </Button>
        )}
        {firstLast && isO3 && (
          <AssetPicker
            value={extraReferences}
            onChange={(items) => changeAssets(items, 'extra')}
            uploadScope={`${kind}:extra`}
            onUploaded={(asset) => acceptUploaded(asset, kind, 'extra', 7)}
            kind="visual"
            max={7}
            projectId={boundProjectId}
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
      </div>
      <p className="composer-section-label">{t('创作需求')}</p>
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
      <div className="composer-basics">
        <Field label={t('创作类型')}>
          <select
            value={outputKind}
            onChange={(e) => {
              setOutputKind(e.target.value);
              if (
                !designs.length &&
                ['detail', 'product-set', 'main-secondary', 'marketing'].includes(e.target.value)
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
      </div>
      <div className="composer-options">
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
            <span className="sr-only">{t(multiple ? '每模块生成数量' : '生成数量')}</span>
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
          {expanded ? t('收起高级设置') : t('模型与高级设置')}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      <p className="composer-model-summary">
        {currentModel ? t(currentModel.name) : t('正在读取模型')} ·{' '}
        {operation?.available ? t('服务已连接') : t('服务未连接')}
      </p>
      {multiple && (
        <details className="composer-materials">
          <summary>
            {t('物料规划 ·')}
            {designs.length}
            {t('个模块 · 共')}
            {designs.length * count}
            {t('张，展开编辑')}
          </summary>
          <DesignPlanner
            value={designs}
            onChange={setDesigns}
            ratios={currentModel?.ratios}
            projectId={boundProjectId}
            count={count}
          />
        </details>
      )}
      {expanded && (
        <div className="composer-advanced">
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
                      {t(modelName(m))}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="form-grid">
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
          <label className="checkbox">
            <input
              type="checkbox"
              checked={needText}
              onChange={(e) => setNeedText(e.target.checked)}
            />
            {t('生成画面文案 / 字幕')}
          </label>
          {currentModel?.textOverlay && <Notice>{t(currentModel.textOverlay.note)}</Notice>}
        </div>
      )}
      <div className="composer-bottom">
        <Button
          variant="ghost"
          onClick={() => setAssistantOpen(true)}
          disabled={!canEdit || !referencesReady}
        >
          <Sparkles size={15} />
          {t('AI 帮我写')}
        </Button>
        <Button variant="ghost" onClick={() => void save()} busy={action.busy} disabled={!canEdit}>
          <Save size={15} />
          {t('保存草稿')}
        </Button>
        <span className="muted">
          {prompt.length} / {isKling ? 2100 : 12000}
        </span>
      </div>
      {assistantOpen && (
        <AIWriter
          technical={{ ratio, resolution, language }}
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          prompt={prompt}
          assets={references}
          projectId={boundProjectId}
          onAccept={setPrompt}
          onAcceptPlan={applyPlan}
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
          applyAssets(pendingAssets.assets, pendingAssets.kind);
          setPendingAssets(null);
        }}
      />
      <Confirm
        open={!!missingToRemove}
        onClose={() => setMissingToRemove(null)}
        title={t('移除失效素材及引用？')}
        description={t('将从当前草稿及物料模块移除此素材的引用，其他素材和文案保持不变。')}
        onConfirm={() => {
          if (!missingToRemove) return;
          setReferenceIds((ids) => ids.filter((id) => id !== missingToRemove));
          setExtraReferenceIds((ids) => ids.filter((id) => id !== missingToRemove));
          if (backgroundAudioId === missingToRemove) {
            setBackgroundAudioId(undefined);
            setBackgroundAudio(undefined);
          }
          setDesigns((items) =>
            items.map((item) => ({
              ...item,
              assetIds: item.assetIds.filter((id) => id !== missingToRemove),
            })),
          );
          setPrompt((text) =>
            extractAssetMentions(text).reduce(
              (value, mention) =>
                mention.assetId === missingToRemove ? value.replaceAll(mention.token, '') : value,
              text,
            ),
          );
          setMissingToRemove(null);
        }}
      />
      <JobSubmit
        input={input}
        operation={operation}
        recoveryScope={`composer:${projectId ?? 'new'}`}
        prepareInput={prepareSubmission}
        valid={
          !!prompt.trim() &&
          referencesReady &&
          (!backgroundAudioId || currentModel?.audio?.mode === 'background-music') &&
          (!generateAudio || currentModel?.audio?.mode === 'generated') &&
          !invalidVideoReferences &&
          (!multiple || (designs.length > 0 && designs.every((d) => !!d.name.trim())))
        }
        onCreated={(job) => {
          if (!projectId && job.projectId) {
            try {
              writeDraft(
                localStorage,
                draftStorageKey(session!.user.id, workspace!.id, job.projectId),
                currentRecovery(job.projectId),
              );
              localStorage.removeItem(storageKey);
            } catch {
              setDraftError(
                '任务已提交，但最新修改未能转存到项目。当前页面保留修改，请先保存草稿；可在任务中心查看已提交任务。',
              );
              onCreated?.(job);
              return;
            }
            finalized.current = true;
            navigate(`/workbench/${job.projectId}`);
          }
          onCreated?.(job);
        }}
      />
    </div>
  );
}

import { formatAssetMention, extractAssetMentions } from '../../contracts/mentions';
import { t } from '../lib/i18n';
import { productWarning } from '../lib/product-messages';
import { DesignPlanner, createDesign, type MaterialDesign } from './DesignPlanner';
import { AIWriter } from './AIWriter';
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  Link2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { AssetDto, BrandDto, ProjectDto } from '../../contracts/core';
import type { MemoryDto, ProductDto } from '../../contracts/knowledge';
import { KnowledgeSelect } from './KnowledgeFields';
import { MemoryEditor } from './MemorySettings';
import '../styles/knowledge.css';
import { IMAGE_KINDS, VIDEO_KINDS, LANGUAGES } from '../../contracts/catalog';
import { api, CONFIRMATION_TIMEOUT_MS, useApi, useRefresh, type Page } from '../lib/api';
import { jobDestination } from '../lib/job-navigation';
import { jobInput, modelName, type Capabilities, type Job, type JobInput } from '../lib/tasks';
import { AssetPicker } from './AssetPicker';
import { JobSubmit } from './JobSubmit';
import { CreativeBrief } from './CreativeBrief';
import { ComposerSettingsPopover } from './ComposerSettingsPopover';
import { useCreativeBrief } from '../lib/use-creative-brief';
import { ModelCapabilityStatus } from './ModelCapabilityStatus';
import { useModelCapability } from '../lib/use-model-capability';
import { newModelDefaults, resolveModelSelection } from '../lib/model-selection';
import { Button, Confirm, Field, Modal, Notice, Segments, useAction } from './ui';
import { useStudio } from '../context';
import {
  draftStorageKey,
  readDraft,
  writeDraft,
  restoreAssets,
  type CreationDraft,
  type CreationMode,
  type ReplicaAspect,
  composerModeKey,
  defaultReplicaAspects,
} from '../lib/creation-recovery';
import type { DesignPlan } from '../../contracts/design-plan';
import { buildPlanApplication } from '../lib/design-plan';
import {
  resolveCreativePlacement,
  type CreativePreparation,
} from '../../contracts/creative-intent';
import '../styles/composer-layout.css';
export interface ComposerController {
  applyPlan: (plan: DesignPlan, index: number) => void;
  addReference: (asset: AssetDto) => void;
  addReplicaReference: (asset: AssetDto) => void;
  setIdea: (prompt: string, mode?: 'replace' | 'append') => void;
  getPrompt: () => string;
  focusPrompt: () => void;
}
interface Props {
  purpose?: 'creation' | 'replica';
  onPreparationChange?: (preparation?: CreativePreparation) => void;
  controllerRef?: Ref<ComposerController>;
  initialWarnings?: string[];
  initialDraft?: JobInput;
  initialRecovery?: Pick<
    CreationDraft,
    'input' | 'drafts' | 'warnings' | 'modelDefaultsPending' | 'modeDrafts' | 'activeModes'
  >;
  onRecoveryPersisted?: () => void;
  initialPrompt?: string;
  initialKind?: 'image' | 'video';
  requestedKind?: 'image' | 'video';
  onKindChange?: (kind: 'image' | 'video') => void;
  projectId?: string;
  documentId?: string;
  revision?: number;
  compact?: boolean;
  presentation?: 'default' | 'home' | 'quick';
  visualVariant?: 'studio';
  onCreated?: (job: Job) => void;
  onSaved?: (project: ProjectDto) => void;
}
export function Composer({
  purpose = 'creation',
  onPreparationChange,
  initialDraft: serverDraft,
  initialRecovery,
  onRecoveryPersisted,
  initialWarnings = [],
  controllerRef,
  initialPrompt = '',
  initialKind = 'image',
  requestedKind,
  onKindChange,
  projectId,
  documentId,
  revision,
  compact = false,
  presentation = 'default',
  visualVariant,
  onCreated,
  onSaved,
}: Props) {
  const isQuick = presentation === 'quick';
  const isHome = presentation === 'home' || isQuick;
  const { canEdit, session, workspace } = useStudio();
  const baseStorageKey = draftStorageKey(session!.user.id, workspace!.id, projectId);
  const storageKeyFor = (project?: string) =>
    `${draftStorageKey(session!.user.id, workspace!.id, project)}${purpose === 'replica' ? ':replica' : ''}`;
  const storageKey = storageKeyFor(projectId);
  const [localDraft] = useState(() => {
    if (initialRecovery)
      return {
        value: { ...initialRecovery, version: 1 as const, updatedAt: new Date().toISOString() },
        error: null,
      };
    try {
      const current = readDraft(localStorage, storageKey);
      // Copy legacy replica drafts into the independent entry only on its first visit.
      // Keep the original key untouched so the creation draft remains recoverable.
      return purpose === 'replica' && !current.value && !current.error
        ? readDraft(localStorage, baseStorageKey)
        : current;
    } catch {
      return { value: null, error: '浏览器存储不可用，当前修改仅保留在此页面。' };
    }
  });
  const savedInput = localDraft.value?.input ?? serverDraft;
  const savedKind = savedInput?.operation === 'video.generate' ? 'video' : 'image';
  const draftKind = requestedKind ?? (savedInput ? savedKind : initialKind);
  const creationMode: CreationMode = purpose === 'replica' ? 'replica' : 'original';
  const legacyDraft =
    localDraft.value?.drafts?.[draftKind] ?? (savedKind === draftKind ? savedInput : undefined);
  const legacyMode =
    localDraft.value?.activeModes?.[draftKind] ?? (legacyDraft?.replica ? 'replica' : 'original');
  const initialModeDraft = localDraft.value?.modeDrafts?.[composerModeKey(draftKind, creationMode)];
  const initialDraft =
    initialModeDraft?.input ??
    (legacyMode === creationMode ? legacyDraft : undefined) ??
    (serverDraft &&
    (serverDraft.operation === 'video.generate' ? 'video' : 'image') === draftKind &&
    (serverDraft.replica ? 'replica' : 'original') === creationMode
      ? serverDraft
      : undefined);
  const legacyReplicaPreserved = purpose === 'creation' && legacyMode === 'replica';
  const typeDrafts = useRef<CreationDraft['drafts']>(localDraft.value?.drafts ?? {});
  const modeDrafts = useRef<NonNullable<CreationDraft['modeDrafts']>>({
    ...(legacyDraft
      ? {
          [composerModeKey(draftKind, legacyMode)]: {
            input: legacyDraft,
            aspects: legacyDraft.replica?.aspects ?? defaultReplicaAspects(draftKind),
            trimStart: legacyDraft.replica?.trimStart ?? 0,
            trimDuration: legacyDraft.replica?.trimDuration,
            defaultsPending: localDraft.value?.modelDefaultsPending?.[draftKind] ?? false,
          },
        }
      : {}),
    ...localDraft.value?.modeDrafts,
  });
  const activeModes = useRef<NonNullable<CreationDraft['activeModes']>>(
    localDraft.value?.activeModes ?? {},
  );
  const isReplica = purpose === 'replica';
  const [replicaAspects, setReplicaAspects] = useState<ReplicaAspect[]>(
    initialModeDraft?.aspects ?? initialDraft?.replica?.aspects ?? defaultReplicaAspects(draftKind),
  );
  const [replicaTrimStart, setReplicaTrimStart] = useState(
    initialModeDraft?.trimStart ?? initialDraft?.replica?.trimStart ?? 0,
  );
  const [replicaTrimDuration, setReplicaTrimDuration] = useState<number | undefined>(
    initialModeDraft?.trimDuration ?? initialDraft?.replica?.trimDuration,
  );
  const [draftError, setDraftError] = useState(localDraft.error);
  const [draftBlocked, setDraftBlocked] = useState(!!localDraft.error);
  const [draftStatus, setDraftStatus] = useState(localDraft.value ? '已恢复本机草稿' : '');
  const warningDrafts = useRef<NonNullable<CreationDraft['warnings']>>(
    localDraft.value?.warnings ?? {},
  );
  const [planWarnings, setPlanWarnings] = useState<string[]>(
    initialDraft?.creationWarnings ??
      (legacyMode === creationMode ? warningDrafts.current[draftKind] : undefined) ??
      initialWarnings,
  );
  const finalized = useRef(false);
  const recoveryPersisted = useRef(false);
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
  const promptHintId = useId();
  const [promptRequested, setPromptRequested] = useState(false);
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
  const kindChangeListener = useRef(onKindChange);
  kindChangeListener.current = onKindChange;
  useEffect(() => {
    kindChangeListener.current?.(kind);
  }, [kind]);
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? initialPrompt);
  const [expanded, setExpanded] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const contextSettingsId = useId();
  const contextTrigger = useRef<HTMLButtonElement>(null);
  const [pendingIdea, setPendingIdea] = useState<string | null>(null);
  const [ideaError, setIdeaError] = useState('');
  const [ideaUndo, setIdeaUndo] = useState<{
    before: string;
    after: string;
    kind: 'image' | 'video';
  } | null>(null);
  const settingsId = useId();
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(0);
  const composerRef = useRef<HTMLDivElement>(null);
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
  const pendingModelDefaults = useRef(localDraft.value?.modelDefaultsPending ?? {});
  const initialDefaultsPending =
    !initialDraft ||
    (initialModeDraft?.defaultsPending ?? pendingModelDefaults.current[draftKind]) === true;
  const defaultsPending = useRef(initialDefaultsPending);
  const needTextTouched = useRef(initialDraft?.options.needText !== undefined);
  const [defaultsReady, setDefaultsReady] = useState(!initialDefaultsPending);
  const [outputKind, setOutputKind] = useState(initialDraft?.options.kind ?? 'free');
  const [designs, setDesigns] = useState<MaterialDesign[]>(initialDraft?.options.designs ?? []);
  const [brandId, setBrandId] = useState(initialDraft?.brandId ?? '');
  const [productId, setProductId] = useState(initialDraft?.productId ?? '');
  const [planningMode, setPlanningMode] = useState<'assisted' | 'direct'>(
    initialDraft?.planningMode ?? 'assisted',
  );
  const [useMemory, setUseMemory] = useState<boolean | undefined>(
    initialDraft ? initialDraft.useMemory : true,
  );
  const [includeProductImages, setIncludeProductImages] = useState<boolean | undefined>(
    initialDraft?.includeProductImages,
  );
  const [remembering, setRemembering] = useState(false);
  const [character, setCharacter] = useState(() =>
    initialDraft?.characterId
      ? { id: initialDraft.characterId, revision: initialDraft.characterRevision }
      : undefined,
  );
  const [language, setLanguage] = useState(
    initialDraft?.options.language ?? session?.user.preferences.defaultCreationLanguage ?? 'zh-CN',
  );
  const [platform, setPlatform] = useState(
    initialDraft?.options.platform ?? session?.user.preferences.defaultPlatform ?? '通用电商',
  );
  const onboardingIncomplete = session?.user.preferences.onboardingCompleted === false;
  // The homepage mounts behind the first-run modal. Do not persist its provisional
  // defaults as a user draft before the selected onboarding preferences arrive.
  const [onboardingDefaultsReady, setOnboardingDefaultsReady] = useState(
    !onboardingIncomplete || !!initialDraft || !!projectId,
  );
  useEffect(() => {
    if (onboardingDefaultsReady || onboardingIncomplete) return;
    setPlatform(session?.user.preferences.defaultPlatform ?? '通用电商');
    setLanguage(session?.user.preferences.defaultCreationLanguage ?? 'zh-CN');
    setOnboardingDefaultsReady(true);
  }, [
    onboardingDefaultsReady,
    onboardingIncomplete,
    session?.user.preferences.defaultPlatform,
    session?.user.preferences.defaultCreationLanguage,
  ]);
  const [creativePlacement, setCreativePlacement] = useState(() => {
    const placement = resolveCreativePlacement({
      mediaType: draftKind,
      kind: initialDraft?.options.kind,
      placement: initialDraft?.options.creativePlacement,
    });
    return placement === 'general' && !initialDraft?.options.creativePlacement
      ? undefined
      : placement;
  });
  const [creativeMarket, setCreativeMarket] = useState(initialDraft?.options.creativeMarket);
  const [creativeRecoveryInput, setCreativeRecoveryInput] = useState(initialDraft);
  const [needText, setNeedText] = useState(initialDraft?.options.needText ?? true);
  const [referenceMode, setReferenceMode] = useState<string>(
    initialDraft?.options.referenceMode ?? 'all',
  );
  const navigate = useNavigate();
  const refresh = useRefresh();
  const queries = useQueryClient();
  const refreshLibraryContext = () =>
    queries.invalidateQueries({
      queryKey: ['api', workspace!.id],
      predicate: (query) =>
        query.queryKey[3] === session!.user.id &&
        typeof query.queryKey[2] === 'string' &&
        /^\/(products|brands|memories)(?:[/?]|$)/.test(query.queryKey[2]),
    });
  const action = useAction();
  const capabilities = useApi<Capabilities>('/capabilities');
  const selectedProduct = useApi<ProductDto>(`/products/${productId}`, !!productId);
  const linkedBrand = useApi<BrandDto>(
    `/brands/${selectedProduct.data?.brandId ?? ''}`,
    !!selectedProduct.data?.brandId,
  );
  const memories = useApi<Page<MemoryDto>>('/memories?pageSize=100', useMemory === true, 60_000);
  const eligibleMemories =
    memories.data?.items.filter(
      (item) => item.eligible && (item.mediaType === 'all' || item.mediaType === kind),
    ) ?? [];
  const operations =
    capabilities.data?.operations.filter(
      (op) => op.id === `${kind}.generate` && (!isReplica || op.providerId === 'native'),
    ) ?? [];
  const {
    operation,
    model: selectedModel,
    replacementModel,
  } = resolveModelSelection(operations, operationKey, model);
  const modelSelectionMissing =
    !!capabilities.data && !!(operationKey || model) && (!operation || !selectedModel);
  function selectGenerationModel(operationId: string, providerId: string, modelId: string) {
    if (
      operation?.id === operationId &&
      operation?.providerId === providerId &&
      selectedModel?.id === modelId
    )
      return;
    defaultsPending.current = isQuick;
    setDefaultsReady(!isQuick);
    setOperationKey(`${operationId}:${providerId}`);
    setModel(modelId);
  }
  const modelCapability = useModelCapability({
    operation,
    model: selectedModel,
    inputMode:
      referenceIds.length ||
      (includeProductImages === true && selectedProduct.data?.referenceAssetIds.length) ||
      (referenceMode === 'first-last' &&
        selectedModel?.id === 'kling-o3-4k-reference' &&
        extraReferenceIds.length)
        ? 'image'
        : 'text',
  });
  const currentModel = modelCapability.model;
  const firstLast = kind === 'video' && referenceMode === 'first-last';
  const isO3 = currentModel?.id === 'kling-o3-4k-reference';
  const productConflict = !!(
    productId &&
    brandId &&
    !(firstLast && !isO3) &&
    selectedProduct.data?.brandId &&
    selectedProduct.data.brandId !== brandId
  );
  const productIssue =
    productId &&
    (selectedProduct.isPending ||
      !!selectedProduct.error ||
      (!!selectedProduct.data?.brandId && (linkedBrand.isPending || !!linkedBrand.error)) ||
      productConflict ||
      (selectedProduct.data?.validUntil &&
        Date.parse(selectedProduct.data.validUntil) <= Date.now()));
  const isKling = kind === 'video' && currentModel?.id.startsWith('kling-');
  // These gateways reject ordinary design batches before splitting items. The
  // dedicated, confirmed detail-page flow has its own server-side exception.
  const supportsOrdinaryDesigns = !(
    operation?.providerId === 'native' ||
    (operation?.providerId === 'openai' &&
      ['gpt-image-2', 'doubao-seedream-5.0-lite'].includes(currentModel?.id ?? model))
  );
  const multiple =
    kind === 'image' &&
    (['detail', 'product-set', 'main-secondary'].includes(outputKind) ||
      (outputKind === 'marketing' && (supportsOrdinaryDesigns || designs.length > 0)));
  const acceptsFirstLast = kind === 'video' && (currentModel?.id === 'kling-o1-first-last' || isO3);
  const textOnly = operation?.inputMode === 'text-only';
  const sourceMax = textOnly
    ? 0
    : isReplica
      ? 1
      : kind === 'image'
        ? 20
        : firstLast
          ? 2
          : isKling
            ? 7
            : 1;
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
    creationMode,
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
    if (!modelCapability.data?.canGenerate || !currentModel) return;
    if (defaultsPending.current) {
      defaultsPending.current = false;
      setDefaultsReady(true);
      const defaults = newModelDefaults(currentModel, modelCapability.maxCount, kind);
      if (defaults.ratio) setRatio(defaults.ratio);
      if (defaults.resolution) setResolution(defaults.resolution);
      if (defaults.duration !== undefined) setDuration(defaults.duration);
      setCount(defaults.count);
      setReferenceMode(defaults.referenceMode);
      if (!needTextTouched.current) setNeedText(defaults.needText);
      setGenerateAudio(false);
      return;
    }
    // Other controls can be changed before the capability request finishes.
    // Keep those explicit values, while still correcting an untouched toggle
    // that the selected model cannot serialize (for example Seedance subtitles).
    if (!needTextTouched.current) {
      const supported = currentModel.textOverlay?.mode !== 'unsupported';
      setNeedText((previous) => (previous === supported ? previous : supported));
    }
  }, [modelCapability.data?.revision, currentModel?.id, kind]);
  const input = jobInput({
    capabilityRevision: modelCapability.revision,
    creationWarnings: planWarnings,
    backgroundAudioAssetId: backgroundAudioId,
    operation: `${kind}.generate`,
    providerId: operation?.providerId ?? operationKey.split(':')[1] ?? 'openai',
    prompt,
    ...(planningMode === 'direct' ? { planningMode } : {}),
    assetIds: referenceIds,
    referenceAssetIds: isReplica || (firstLast && isO3) ? extraReferenceIds : [],
    ...(isReplica &&
    referenceIds[0] &&
    extraReferenceIds[0] &&
    referenceIds[0] !== extraReferenceIds[0] &&
    replicaAspects.length &&
    Number.isFinite(replicaTrimStart) &&
    replicaTrimStart >= 0 &&
    replicaTrimStart <= 3600 &&
    (replicaTrimDuration === undefined ||
      (Number.isFinite(replicaTrimDuration) &&
        replicaTrimDuration >= 2 &&
        replicaTrimDuration <= 15))
      ? {
          replica: {
            subjectAssetId: referenceIds[0],
            referenceAssetId: extraReferenceIds[0],
            aspects: replicaAspects,
            trimStart: replicaTrimStart,
            ...(replicaTrimDuration === undefined ? {} : { trimDuration: replicaTrimDuration }),
          },
        }
      : {}),
    ...(boundProjectId ? { projectId: boundProjectId } : {}),
    ...(character ? { characterId: character.id, characterRevision: character.revision } : {}),
    ...(documentId && revision && revision >= 1 ? { documentId, baseRevision: revision } : {}),
    ...(brandId && !(firstLast && !isO3) ? { brandId } : {}),
    ...(productId
      ? {
          productId,
          ...(multiple
            ? { includeProductImages: false }
            : includeProductImages === undefined
              ? {}
              : { includeProductImages }),
        }
      : {}),
    ...(multiple ? { useMemory: false } : useMemory === undefined ? {} : { useMemory }),
    options: {
      ...(multiple && designs.length
        ? { designs: designs.map((d) => ({ ...d, name: d.name.trim() || '未命名模块' })) }
        : {}),
      model: model || currentModel?.id,
      ...(currentModel?.audio?.mode === 'generated' || generateAudio ? { generateAudio } : {}),
      kind: outputKind,
      ratio,
      count,
      resolution,
      duration,
      language,
      platform,
      creativePlacement,
      creativeMarket,
      needText,
      referenceMode,
    },
  });
  const creativeBrief = useCreativeBrief({
    input,
    recoveryInput:
      multiple && creativeRecoveryInput
        ? {
            ...creativeRecoveryInput,
            useMemory: false,
            ...(creativeRecoveryInput.productId ? { includeProductImages: false } : {}),
          }
        : creativeRecoveryInput,
    userId: session!.user.id,
    workspaceId: workspace!.id,
  });
  const preparationListener = useRef(onPreparationChange);
  preparationListener.current = onPreparationChange;
  useEffect(() => {
    preparationListener.current?.(creativeBrief.preparation);
  }, [creativeBrief.preparation]);
  const [preparationSubmissionLocked, setPreparationSubmissionLocked] = useState(false);
  const referenceModeIssue =
    kind === 'video' &&
    currentModel &&
    ((currentModel.id === 'kling-o1-first-last' && referenceMode !== 'first-last') ||
      (!acceptsFirstLast && referenceMode === 'first-last'));
  const textModeIssue = currentModel?.textOverlay?.mode === 'unsupported' && needText;
  const directModeUnsupported = isReplica || multiple;
  const planningIssue =
    planningMode === 'direct' && directModeUnsupported
      ? t('参考复刻与分组物料需要思考模式，请开启后继续。')
      : planningMode !== 'direct' && operation?.planningAvailable === false
        ? t('思考模式需要文本模型。可关闭思考直接生成，或前往模型配置。')
        : null;
  const selectionIssue =
    (multiple && productId
      ? t('分组物料暂不支持关联产品与个人记忆，请切换单张创作或取消关联')
      : null) ??
    (multiple && !supportsOrdinaryDesigns
      ? t('当前模型仅支持单张创作。分组草稿已保留，请切换支持分组的模型，或改用单张类型。')
      : null) ??
    modelCapability.selectionIssue(input.options) ??
    (referenceModeIssue ? t('当前参考方式不受此模型支持，请在更多创作设置中重新选择。') : null) ??
    (textModeIssue ? t('当前模型不支持画面文字，请在更多创作设置中关闭该选项。') : null);
  const ratios = currentModel?.ratios ?? [];
  const resolutions = currentModel?.resolutions ?? [];
  const durations = currentModel?.durations ?? [];
  const counts = Array.from({ length: modelCapability.maxCount }, (_, index) => index + 1);
  const outputSize = modelCapability.data?.sizePresets?.find(
    (preset) =>
      preset.ratio === ratio && preset.resolution.toLowerCase() === resolution.toLowerCase(),
  )?.size;
  function useFixedParameters() {
    const fixed = modelCapability.fixedOptions;
    if (typeof fixed.ratio === 'string') setRatio(fixed.ratio);
    if (typeof fixed.resolution === 'string') setResolution(fixed.resolution);
    if (typeof fixed.duration === 'number') setDuration(fixed.duration);
    if (typeof fixed.count === 'number') setCount(fixed.count);
    if (typeof fixed.generateAudio === 'boolean') setGenerateAudio(fixed.generateAudio);
  }
  const localInput: JobInput = {
    ...input,
    // Preserve dormant single-creation choices; execution uses the guarded input above.
    useMemory,
    includeProductImages,
    creativeBriefId: creativeBrief.briefId,
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
  const latestDraft = useRef({
    input: localInput,
    kind,
    mode: creationMode,
    warnings: planWarnings,
  });
  latestDraft.current = { input: localInput, kind, mode: creationMode, warnings: planWarnings };
  function captureModeDraft() {
    activeModes.current[kind] = creationMode;
    modeDrafts.current[composerModeKey(kind, creationMode)] = {
      input: localInput,
      aspects: replicaAspects,
      trimStart: replicaTrimStart,
      trimDuration: replicaTrimDuration,
      defaultsPending: !defaultsReady,
    };
  }
  captureModeDraft();
  function acceptUploaded(
    asset: AssetDto,
    sourceKind: 'image' | 'video',
    sourceMode: CreationMode,
    slot: 'main' | 'extra' | 'audio',
    limit: number,
  ) {
    if (!mounted.current || finalized.current) return;
    const latest = latestDraft.current;
    const active = latest.kind === sourceKind && latest.mode === sourceMode;
    const sourceKey = composerModeKey(sourceKind, sourceMode);
    const sourceDraft = modeDrafts.current[sourceKey];
    const original = active ? latest.input : sourceDraft?.input;
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
        ? { ...original, creativeBriefId: undefined, backgroundAudioAssetId: asset.id }
        : { ...original, creativeBriefId: undefined, [field]: [...selected, asset.id] };
    if (sourceDraft) modeDrafts.current[sourceKey] = { ...sourceDraft, input: updated };
    if (activeModes.current[sourceKind] === sourceMode) typeDrafts.current[sourceKind] = updated;
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
        modelDefaultsPending: pendingModelDefaults.current,
        modeDrafts: modeDrafts.current,
        activeModes: activeModes.current,
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
      modelDefaultsPending: pendingModelDefaults.current,
      modeDrafts: modeDrafts.current,
      activeModes: activeModes.current,
    };
  }
  function transferDraft(project: string) {
    const recoveryDraft = currentRecovery(project);
    try {
      writeDraft(localStorage, storageKeyFor(project), recoveryDraft);
      localStorage.removeItem(storageKey);
      return {};
    } catch {
      return {
        recoveryDraft,
        notice: '最新编辑内容已随页面保留；浏览器草稿存储异常，请保存草稿到项目。',
      };
    }
  }
  // A refreshed proof is not a creative edit. In particular, an untouched older
  // tab must not overwrite a newer draft merely because model metadata changed.
  const draftSnapshot = JSON.stringify([
    { ...localInput, capabilityRevision: undefined },
    planWarnings,
    creationMode,
    replicaAspects,
    replicaTrimStart,
    replicaTrimDuration,
  ]);
  useEffect(() => {
    if (finalized.current || draftBlocked || onboardingIncomplete || !onboardingDefaultsReady)
      return;
    pendingModelDefaults.current[kind] = !defaultsReady;
    typeDrafts.current[kind] = localInput;
    warningDrafts.current[kind] = planWarnings;
    let saved = false;
    try {
      writeDraft(localStorage, storageKey, {
        input: localInput,
        drafts: typeDrafts.current,
        warnings: warningDrafts.current,
        modelDefaultsPending: pendingModelDefaults.current,
        modeDrafts: modeDrafts.current,
        activeModes: activeModes.current,
      });
      setDraftError(null);
      setDraftStatus('草稿已保存在本机');
      saved = true;
    } catch {
      setDraftError('当前修改仅保留在此页面。浏览器无法保存草稿，请使用“保存草稿”保存到项目。');
    }
    if (saved && initialRecovery && !recoveryPersisted.current) {
      recoveryPersisted.current = true;
      onRecoveryPersisted?.();
    }
  }, [
    draftSnapshot,
    storageKey,
    draftBlocked,
    defaultsReady,
    onboardingIncomplete,
    onboardingDefaultsReady,
  ]);
  function switchKind(next: 'image' | 'video') {
    switchDraft(next, creationMode);
  }
  function switchDraft(next: 'image' | 'video', nextMode: CreationMode) {
    captureModeDraft();
    typeDrafts.current[kind] = localInput;
    warningDrafts.current[kind] = planWarnings;
    const modeDraft = modeDrafts.current[composerModeKey(next, nextMode)];
    const legacyDraft = typeDrafts.current[next];
    const draft =
      modeDraft?.input ??
      ((legacyDraft?.replica ? 'replica' : 'original') === nextMode ? legacyDraft : undefined);
    setPlanWarnings(draft?.creationWarnings ?? []);
    activeModes.current[next] = nextMode;
    setReplicaAspects(modeDraft?.aspects ?? draft?.replica?.aspects ?? defaultReplicaAspects(next));
    setReplicaTrimStart(modeDraft?.trimStart ?? draft?.replica?.trimStart ?? 0);
    setReplicaTrimDuration(modeDraft?.trimDuration ?? draft?.replica?.trimDuration);
    setPendingAssets(null);
    setMissingToRemove(null);
    setIdeaUndo(null);
    setKind(next);
    setPrompt(draft?.prompt ?? '');
    setOperationKey(draft ? `${draft.operation}:${draft.providerId}` : '');
    setModel(draft?.options.model ?? '');
    setRatio(draft?.options.ratio ?? (next === 'video' ? '16:9' : '1:1'));
    setCount(draft?.options.count ?? 1);
    setDuration(draft?.options.duration ?? 5);
    defaultsPending.current = modeDraft
      ? modeDraft.defaultsPending
      : !draft || pendingModelDefaults.current[next] === true;
    setDefaultsReady(!defaultsPending.current);
    setPromptRequested(false);
    setResolution(draft?.options.resolution ?? (next === 'video' ? '720p' : '1K'));
    setOutputKind(draft?.options.kind ?? 'free');
    setDesigns(draft?.options.designs ?? []);
    setBrandId(draft?.brandId ?? '');
    setProductId(draft?.productId ?? '');
    setPlanningMode(draft?.planningMode ?? (draft ? 'assisted' : planningMode));
    setUseMemory(draft ? draft.useMemory : true);
    setIncludeProductImages(draft?.includeProductImages);
    setCharacter(
      draft?.characterId ? { id: draft.characterId, revision: draft.characterRevision } : undefined,
    );
    setLanguage(
      draft?.options.language ?? session?.user.preferences.defaultCreationLanguage ?? 'zh-CN',
    );
    setPlatform(draft?.options.platform ?? session?.user.preferences.defaultPlatform ?? '通用电商');
    const placement = resolveCreativePlacement({
      mediaType: next,
      kind: draft?.options.kind,
      placement: draft?.options.creativePlacement,
    });
    setCreativePlacement(
      placement === 'general' && !draft?.options.creativePlacement ? undefined : placement,
    );
    setCreativeMarket(draft?.options.creativeMarket);
    setCreativeRecoveryInput(draft);
    needTextTouched.current = draft?.options.needText !== undefined;
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
    setIdeaError('');
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
      return api<ProjectDto>(
        `/projects/${projectRef.current}`,
        { timeoutMs: CONFIRMATION_TIMEOUT_MS },
        workspace!.id,
      );
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
          creativeBrief.bindProject(project.id);
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
            { timeoutMs: CONFIRMATION_TIMEOUT_MS },
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
      onSaved?.(project);
      if (!projectId) {
        const state = transferDraft(project.id);
        finalized.current = true;
        navigate(`${isReplica ? '/replica' : '/workbench'}/${project.id}`, { state });
      }
      void refresh().catch(() => undefined);
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
    defaultsPending.current = false;
    setDefaultsReady(true);
    setPrompt(application.prompt);
    if (application.ratio) setRatio(application.ratio);
    if (application.resolution) {
      setResolution(application.resolution);
    }
    if (application.language) setLanguage(application.language);
    needTextTouched.current = true;
    setNeedText(application.needText);
    setPlanWarnings(application.warnings);

    promptRef.current?.focus();
  }
  function addReference(asset: AssetDto) {
    if (!canEdit) throw new Error(t('当前角色不能编辑创作草稿。'));
    if (textOnly) throw new Error(t('当前模型仅支持文字生成，请先选择支持参考图的模型。'));
    if (capabilities.isLoading || !operation)
      throw new Error(t('模型能力尚未读取完成，请稍后添加。'));
    if (referenceIds.includes(asset.id)) {
      promptRef.current?.focus();
      return;
    }
    if (referenceIds.length >= sourceMax)
      throw new Error(`当前模式最多支持 ${sourceMax} 份参考素材，请先移除不需要的参考。`);
    if (asset.kind === 'video' && (isReplica || !(isO3 && !firstLast)))
      throw new Error(t('当前模式不支持视频参考，请先选择支持视频参考的模型与模式。'));
    if (!['image', 'video'].includes(asset.kind)) throw new Error(t('此结果不能用作媒体参考。'));
    setReferenceIds((ids) => [...ids, asset.id]);
    setReferences((assets) => [...assets, asset]);
    promptRef.current?.focus();
  }
  function addReplicaReference(asset: AssetDto) {
    if (!canEdit) throw new Error(t('当前角色不能编辑创作草稿。'));
    if (!isReplica || asset.kind !== kind) throw new Error(t('参考素材类型须与当前复刻类型一致。'));
    if (referenceIds.includes(asset.id)) throw new Error(t('参考素材与主体图片必须是不同素材。'));
    changeAssets([asset], 'extra');
  }
  function applyIdea(idea: string, mode?: 'replace' | 'append') {
    if (!canEdit) return;
    setIdeaError('');
    if (prompt.trim() && !mode) {
      setPendingIdea(idea);
      return;
    }
    const next = mode === 'append' && prompt.trim() ? `${prompt}\n\n${idea}` : idea;
    if (next.length > (isKling ? 2100 : 12000)) {
      setIdeaError(t('文字已超出当前模型上限，原需求已保留。请先精简需求，或选择替换。'));
      if (!pendingIdea)
        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
        });
      return;
    }
    setIdeaUndo({ before: prompt, after: next, kind });
    setPrompt(next);
    setPendingIdea(null);
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    });
  }
  useImperativeHandle(controllerRef, () => ({
    applyPlan,
    addReference,
    addReplicaReference,
    setIdea: applyIdea,
    getPrompt: () => prompt,
    focusPrompt: () => {
      promptRef.current?.focus();
      promptRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    },
  }));
  const replicaReference = extraReferences[0];
  const replicaRemainingSeconds = replicaReference?.durationMs
    ? replicaReference.durationMs / 1000 - replicaTrimStart
    : 0;
  const replicaClipDuration =
    replicaTrimDuration ?? Math.min(15, Math.max(0, replicaRemainingSeconds));
  const replicaIssue = !isReplica
    ? null
    : operation?.providerId !== 'native'
      ? t('参考复刻需要已配置的原生创作服务。')
      : operation.replicaAvailable !== true
        ? t(operation.replicaReason || '请先配置可读取参考画面的视觉分析模型。')
        : referenceIds.length !== 1 || extraReferenceIds.length !== 1
          ? t('请分别添加一份参考素材和一张需要保留的主体图片。')
          : referenceIds[0] === extraReferenceIds[0]
            ? t('参考素材与主体图片必须是不同素材。')
            : references[0]?.kind !== 'image' || replicaReference?.kind !== kind
              ? t('主体必须是图片，参考素材类型须与当前图片或视频创作一致。')
              : !replicaAspects.length
                ? t('请至少选择一项参考要点。')
                : kind === 'video' &&
                    (!Number.isFinite(replicaTrimStart) ||
                      replicaTrimStart < 0 ||
                      replicaTrimStart > 3600 ||
                      !Number.isFinite(replicaClipDuration) ||
                      replicaClipDuration < 2 ||
                      replicaClipDuration > 15 ||
                      replicaClipDuration > replicaRemainingSeconds)
                  ? t('参考视频选段须为2至15秒，并且不能超出原视频。')
                  : null;
  const materials = (
    <div className="composer-materials">
      {textOnly &&
        (referenceIds.length > 0 ||
        extraReferenceIds.length > 0 ||
        brandId ||
        character ||
        designs.length > 0 ||
        backgroundAudioId ? (
          <Notice tone="warning">
            {t('当前服务仅接受文字描述。请移除参考素材、品牌、人物或多图方案后再生成。')}
          </Notice>
        ) : (
          <p className="composer-input-mode">
            <span>{t('文字生成')}</span>
            {t('用文字描述画面与细节')}
          </p>
        ))}
      <div hidden={isReplica || (textOnly && references.length === 0)}>
        <AssetPicker
          inline
          value={isReplica ? [] : references}
          onChange={(items) => changeAssets(items, 'main')}
          uploadScope={`${kind}:${creationMode}:main`}
          onUploaded={(asset) => acceptUploaded(asset, kind, creationMode, 'main', sourceMax)}
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
      </div>
      <section hidden={!isReplica} data-replica-materials aria-label={t('复刻素材与参考要点')}>
        <p className="field-hint">
          {t('借鉴参考的构图、光线或节奏，保留你的主体。先分析并确认方案，效果不保证成为爆款。')}
        </p>
        <AssetPicker
          value={isReplica ? extraReferences : []}
          onChange={(items) => changeAssets(items, 'extra')}
          uploadScope={`${kind}:replica:extra`}
          onUploaded={(asset) => acceptUploaded(asset, kind, 'replica', 'extra', 1)}
          kind={kind}
          max={1}
          projectId={boundProjectId}
          label={t(kind === 'image' ? '风格参考图片' : '节奏与镜头参考视频')}
        />
        <AssetPicker
          value={isReplica ? references : []}
          onChange={(items) => changeAssets(items, 'main')}
          uploadScope={`${kind}:replica:main`}
          onUploaded={(asset) => acceptUploaded(asset, kind, 'replica', 'main', 1)}
          kind="image"
          max={1}
          projectId={boundProjectId}
          label={t('需要保留的主体图片')}
        />
        <div className="field" role="group" aria-label={t('参考要点')}>
          <span className="field-label">{t('参考要点')}</span>
          <div className="language-options">
            {(
              [
                ['composition', '构图'],
                ['lighting', '光线'],
                ['palette', '配色'],
                ...(kind === 'video'
                  ? [
                      ['camera', '镜头运动'],
                      ['pacing', '节奏'],
                    ]
                  : []),
              ] as [ReplicaAspect, string][]
            ).map(([aspect, label]) => (
              <label className="checkbox" key={aspect}>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={replicaAspects.includes(aspect)}
                  onChange={(event) =>
                    setReplicaAspects((current) =>
                      event.target.checked
                        ? [...current, aspect]
                        : current.filter((value) => value !== aspect),
                    )
                  }
                />
                {t(label)}
              </label>
            ))}
          </div>
        </div>
        {kind === 'video' && (
          <div className="form-grid">
            <p className="field-hint">
              {t('根据抽帧分析迁移运镜与节奏，不直接传整段视频；未分析音轨，不保证逐帧复制。')}
            </p>
            <Field label={t('参考选段起点（秒）')}>
              <input
                type="number"
                min={0}
                step={0.1}
                value={replicaTrimStart}
                onChange={(event) => setReplicaTrimStart(Number(event.target.value))}
              />
            </Field>
            <Field label={t('参考选段时长（秒）')} hint={t('只分析并参考这段视频，时长2至15秒。')}>
              <input
                type="number"
                min={2}
                max={15}
                step={0.1}
                value={replicaClipDuration || ''}
                onChange={(event) =>
                  setReplicaTrimDuration(
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
              />
            </Field>
            {replicaReference && (
              <p className="field-hint" role="status">
                {t('参考区间')}：{replicaTrimStart.toFixed(1)} –{' '}
                {(replicaTrimStart + replicaClipDuration).toFixed(1)} {t('秒')}
              </p>
            )}
          </div>
        )}
        {replicaIssue && <Notice tone="warning">{replicaIssue}</Notice>}
      </section>
      <div hidden={!(currentModel?.audio?.mode === 'background-music' || backgroundAudioId)}>
        <AssetPicker
          value={backgroundAudio ? [backgroundAudio] : []}
          uploadScope={`${kind}:${creationMode}:audio`}
          onUploaded={(asset) => acceptUploaded(asset, kind, creationMode, 'audio', 1)}
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
          <label className="check-row composer-audio-toggle">
            <input
              type="checkbox"
              checked={generateAudio}
              onChange={(event) => setGenerateAudio(event.target.checked)}
            />
            {t('生成视频音轨')}
          </label>
          {(!isQuick || currentModel?.audio?.mode !== 'generated') && (
            <Notice>
              {currentModel?.audio?.mode === 'generated'
                ? t(currentModel.audio.note)
                : t('当前模型不支持生成音轨。请关闭此选项或切换支持的模型。')}
            </Notice>
          )}
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
      {!isReplica && firstLast && isO3 && (
        <AssetPicker
          value={extraReferences}
          onChange={(items) => changeAssets(items, 'extra')}
          uploadScope={`${kind}:${creationMode}:extra`}
          onUploaded={(asset) => acceptUploaded(asset, kind, creationMode, 'extra', 7)}
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
  );
  function chooseOutputKind(value: string) {
    setOutputKind(value);
    const placement = resolveCreativePlacement({ mediaType: kind, kind: value });
    setCreativePlacement(placement === 'general' ? undefined : placement);
    if (
      !designs.length &&
      supportsOrdinaryDesigns &&
      ['detail', 'product-set', 'main-secondary', 'marketing'].includes(value)
    ) {
      setDesigns([createDesign('hero'), createDesign('benefits'), createDesign('lifestyle')]);
    }
  }
  const basics = (
    <div className="composer-basics">
      <Field label={t('创作类型')}>
        <select value={outputKind} onChange={(e) => chooseOutputKind(e.target.value)}>
          {(kind === 'image'
            ? IMAGE_KINDS.filter(
                (option) =>
                  (option.id !== 'detail' || outputKind === 'detail') &&
                  (supportsOrdinaryDesigns ||
                    !['detail', 'product-set', 'main-secondary'].includes(option.id) ||
                    option.id === outputKind),
              )
            : VIDEO_KINDS
          ).map((option) => (
            <option key={option.id} value={option.id}>
              {t(option.id === 'detail' ? '旧版分组物料' : option.name)}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
  const secondaryActions = (
    <div className="composer-bottom">
      <Button variant="ghost" onClick={() => void save()} busy={action.busy} disabled={!canEdit}>
        <Save size={15} />
        {t('保存草稿')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={!canEdit || !prompt.trim()}
        onClick={() => setRemembering(true)}
      >
        {t('记住这次要求')}
      </Button>
      <span className="muted" hidden={isHome}>
        {prompt.length} / {isKling ? 2100 : 12000}
      </span>
    </div>
  );
  const generationReady =
    (!productIssue || creativeBrief.preparation?.status === 'ready') &&
    !replicaIssue &&
    defaultsReady &&
    modelCapability.canGenerate &&
    !selectionIssue &&
    !planningIssue &&
    referencesReady &&
    (!textOnly ||
      (!referenceIds.length &&
        !extraReferenceIds.length &&
        !brandId &&
        !character &&
        !designs.length)) &&
    (!backgroundAudioId || currentModel?.audio?.mode === 'background-music') &&
    (!generateAudio || currentModel?.audio?.mode === 'generated') &&
    !invalidVideoReferences &&
    (!multiple || (designs.length > 0 && designs.every((d) => !!d.name.trim())));
  const promptEditor = (
    <>
      <p className="composer-section-label">{t('你想创作什么？')}</p>
      <textarea
        ref={promptRef}
        className="prompt-input"
        aria-label={t('创作需求')}
        aria-invalid={promptRequested && !prompt.trim() ? true : undefined}
        aria-describedby={promptRequested && !prompt.trim() ? promptHintId : undefined}
        value={prompt}
        onChange={(e) => editPrompt(e.target.value, e.target.selectionStart)}
        placeholder={
          kind === 'image'
            ? t('比如：给这款精华瓶做一张小红书氛围图，清晨窗边，干净自然。')
            : t('比如：做一条 5 秒香水短片，晨光掠过瓶身，镜头缓缓推进。')
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
      {materials}
      {promptRequested && !prompt.trim() && (
        <p className="quick-prompt-guidance" id={promptHintId} role="status">
          {t('写一句想法，或选择下方灵感，就可以开始。')}
        </p>
      )}
    </>
  );
  const platformControl = (
    <Field label={t('发布平台')} className="composer-platform-field">
      <select
        aria-label={t('发布平台')}
        value={platform}
        onChange={(event) => setPlatform(event.target.value)}
      >
        {[
          ['通用电商', '通用电商'],
          ['Amazon', 'Amazon（亚马逊）'],
          ['TikTok', 'TikTok（海外短视频平台）'],
          ['抖音', '抖音'],
          ['小红书', '小红书'],
          ['淘宝', '淘宝'],
          ...(!['通用电商', 'Amazon', 'TikTok', '抖音', '小红书', '淘宝'].includes(platform)
            ? [[platform, `${platform}（原草稿平台）`]]
            : []),
        ].map(([value, label]) => (
          <option key={value} value={value}>
            {t(label!)}
          </option>
        ))}
      </select>
    </Field>
  );
  const composerToolbar = (
    <div className="composer-toolbar">
      {platformControl}
      <button
        type="button"
        ref={settingsTrigger}
        className="composer-settings-toggle"
        aria-haspopup={visualVariant === 'studio' ? 'dialog' : undefined}
        aria-label={t(expanded ? '收起高级设置' : '更多创作设置')}
        aria-expanded={expanded}
        aria-controls={settingsId}
        onClick={() => {
          setContextExpanded(false);
          setExpanded(!expanded);
        }}
      >
        <SlidersHorizontal size={15} />
        {visualVariant === 'studio' && currentModel && (
          <span className="composer-settings-model">{t(modelName(currentModel))}</span>
        )}
        <span>
          {ratio} · {resolution} ·{' '}
          {kind === 'video' ? `${duration}${t('秒')}` : `${count}${t('张')}`}
        </span>
        <span>{t('设置')}</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      <button
        type="button"
        ref={contextTrigger}
        className="composer-context-toggle"
        aria-label={t('关联配置')}
        aria-haspopup="dialog"
        aria-expanded={contextExpanded}
        aria-controls={contextSettingsId}
        onClick={() => {
          setExpanded(false);
          setContextExpanded(!contextExpanded);
        }}
      >
        <Link2 size={15} />
        <span>{t('关联配置')}</span>
        {(brandId || productId) && (
          <span className="composer-context-count">{Number(!!brandId) + Number(!!productId)}</span>
        )}
        <ChevronDown size={14} />
      </button>
      <label
        className="composer-planning-toggle"
        title={t(planningMode === 'direct' ? '已关闭 · 直接生成' : '已开启 · 先规划再生成')}
      >
        <input
          type="checkbox"
          role="switch"
          aria-label={t('思考模式')}
          checked={planningMode === 'assisted'}
          disabled={
            !canEdit || preparationSubmissionLocked || creativeBrief.busy || creativeBrief.locked
          }
          onChange={(event) => setPlanningMode(event.target.checked ? 'assisted' : 'direct')}
        />
        <span>{t('思考')}</span>
        <span className="composer-planning-state">
          {t(planningMode === 'direct' ? '关' : '开')}
        </span>
      </label>
    </div>
  );
  const generationControls = (
    <>
      <div className="composer-selection-controls">
        <Field label={t('生成模型')} className="composer-model-field">
          <select
            value={
              operation && currentModel
                ? `${operation.id}|${operation.providerId}|${currentModel.id}`
                : operationKey && model
                  ? `${operationKey.replace(':', '|')}|${model}`
                  : ''
            }
            onChange={(event) => {
              const [operationId, providerId, modelId] = event.target.value.split('|');
              if (operationId && providerId && modelId)
                selectGenerationModel(operationId, providerId, modelId);
            }}
          >
            {(operationKey || model) && (!operation || !selectedModel) && (
              <option
                value={operationKey && model ? `${operationKey.replace(':', '|')}|${model}` : ''}
              >
                {model || operationKey}
                {t('（当前不可用，原值保留）')}
              </option>
            )}
            {!operations.length && <option value="">{t('正在读取模型…')}</option>}
            {operations.map((op) =>
              op.models.map((item) => (
                <option
                  key={`${op.id}|${op.providerId}|${item.id}`}
                  value={`${op.id}|${op.providerId}|${item.id}`}
                >
                  {t(modelName(item))}
                  {op.available ? '' : t(' · 未连接')}
                </option>
              )),
            )}
          </select>
        </Field>
        {visualVariant === 'studio' && operation && currentModel && (
          <div
            className={`composer-model-card${operation.available ? ' is-connected' : ''}`}
            aria-live="polite"
          >
            <div className="composer-model-card-head">
              <strong>{t(modelName(currentModel))}</strong>
              <span className="composer-model-card-status">
                {operation.available ? t('已连接') : t('未连接')}
              </span>
            </div>
            <dl>
              <div>
                <dt>{t('服务商')}</dt>
                <dd>
                  {capabilities.data?.providers.find((item) => item.id === operation.providerId)
                    ?.name ?? operation.providerId}
                </dd>
              </div>
              <div>
                <dt>{t('积分')}</dt>
                <dd>
                  {operation.priceCredits} /{' '}
                  {t(operation.unit === 'image' ? '张' : operation.unit === 'second' ? '秒' : '次')}
                </dd>
              </div>
              {!!currentModel.resolutions.length && (
                <div>
                  <dt>{t('最高清晰度')}</dt>
                  <dd>{currentModel.resolutions[currentModel.resolutions.length - 1]}</dd>
                </div>
              )}
              {!!currentModel.ratios.length && (
                <div>
                  <dt>{t('可选比例')}</dt>
                  <dd>
                    {currentModel.ratios.length} {t('种')}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
      <div className="composer-specs">
        {!!ratios.length && !modelCapability.adjustable('ratio') && (
          <Field label={t('比例')}>
            <span className="capability-fixed-value">
              {ratios.map((value) => (value === 'auto' ? t('智能比例') : value)).join(' / ')} ·{' '}
              {t('固定')}
            </span>
          </Field>
        )}
        {!!resolutions.length && !modelCapability.adjustable('resolution') && (
          <Field label={t('清晰度')}>
            <span className="capability-fixed-value">
              {resolutions.join(' / ')} · {t('固定')}
            </span>
          </Field>
        )}
        {kind === 'image' && !modelCapability.adjustable('count') && !isQuick && (
          <Field label={t(multiple ? '每模块生成数量' : '生成数量')}>
            <span className="capability-fixed-value">
              {modelCapability.fixedOptions.count} {t('张')} · {t('固定')}
            </span>
          </Field>
        )}
        {kind === 'video' && !!durations.length && !modelCapability.adjustable('duration') && (
          <Field label={t('时长')}>
            <span className="capability-fixed-value">
              {durations.join(' / ')} {t('秒')} · {t('固定')}
            </span>
          </Field>
        )}
        {!!ratios.length && modelCapability.adjustable('ratio') && (
          <Field label={t('比例')}>
            <select
              value={ratio}
              disabled={!modelCapability.adjustable('ratio')}
              onChange={(event) => {
                defaultsPending.current = false;
                setDefaultsReady(true);
                setRatio(event.target.value);
              }}
            >
              {!ratios.includes(ratio) && (
                <option value={ratio}>
                  {ratio} · {t('请重新选择')}
                </option>
              )}
              {ratios.map((value) => (
                <option key={value} value={value}>
                  {value === 'auto' || value === 'adaptive' ? t('智能比例') : value}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!!resolutions.length && modelCapability.adjustable('resolution') && (
          <Field label={t('清晰度')}>
            <select
              value={resolution}
              disabled={!modelCapability.adjustable('resolution')}
              onChange={(event) => {
                defaultsPending.current = false;
                setDefaultsReady(true);
                setResolution(event.target.value);
              }}
            >
              {!resolutions.includes(resolution) && (
                <option value={resolution}>
                  {resolution} · {t('请重新选择')}
                </option>
              )}
              {resolutions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        )}
        {kind === 'image'
          ? modelCapability.adjustable('count') && (
              <Field label={t(multiple ? '每模块生成数量' : '生成数量')}>
                <select
                  value={count}
                  disabled={!modelCapability.adjustable('count')}
                  onChange={(event) => {
                    defaultsPending.current = false;
                    setDefaultsReady(true);
                    setCount(Number(event.target.value));
                  }}
                >
                  {!counts.includes(count) && (
                    <option value={count}>
                      {count} · {t('请重新选择')}
                    </option>
                  )}
                  {counts.map((value) => (
                    <option key={value} value={value}>
                      {value}
                      {t('张')}
                    </option>
                  ))}
                </select>
              </Field>
            )
          : !!durations.length &&
            modelCapability.adjustable('duration') && (
              <Field label={t('时长')}>
                <select
                  value={duration}
                  disabled={!modelCapability.adjustable('duration')}
                  onChange={(event) => {
                    defaultsPending.current = false;
                    setDefaultsReady(true);
                    setDuration(Number(event.target.value));
                  }}
                >
                  {!durations.includes(duration) && (
                    <option value={duration}>
                      {duration} · {t('请重新选择')}
                    </option>
                  )}
                  {durations.map((value) => (
                    <option key={value} value={value}>
                      {value}
                      {t('秒')}
                    </option>
                  ))}
                </select>
              </Field>
            )}
      </div>
    </>
  );
  const modelInformation = (
    <>
      {outputSize && (
        <p className="field-hint quick-output-meta" data-testid="generation-output-size">
          {t('输出尺寸')}：{outputSize.replace('x', ' × ')} {t('像素')}
        </p>
      )}
      <ModelCapabilityStatus
        capability={modelCapability}
        selectionIssue={selectionIssue}
        onUseFixed={useFixedParameters}
      />
      <div className="composer-settings-toolbar">
        <p className={`composer-model-summary${operation?.available ? ' is-connected' : ''}`}>
          {currentModel ? t(currentModel.name) : t('正在读取模型')} ·{' '}
          {operation?.available ? t('服务已连接') : t('服务未连接')}
        </p>
      </div>
    </>
  );
  const creationContext = (
    <section className="composer-creation-context" aria-label={t('关联品牌与产品')}>
      <div className="composer-context-heading">
        <h3 className="composer-context-title">{t('关联品牌与产品')}</h3>
        <div className="composer-context-links">
          <Link to="/brands">{t('管理品牌')}</Link>
          <Link to="/products">{t('管理产品库')}</Link>
        </div>
      </div>
      <div className="form-grid">
        <KnowledgeSelect
          type="brands"
          label={t('参考品牌')}
          value={firstLast && !isO3 ? '' : brandId}
          emptyLabel={selectedProduct.data?.brandId ? t('采用产品所属品牌') : undefined}
          onChange={setBrandId}
          disabled={firstLast && !isO3}
        />
        <KnowledgeSelect
          type="products"
          label={t('参考产品')}
          value={productId}
          disabled={multiple}
          onChange={(value) => {
            setProductId(value);
            setIncludeProductImages(undefined);
          }}
        />
      </div>
      {productId && (
        <>
          {selectedProduct.data?.brandId && (
            <p className="field-hint">
              {t('产品所属品牌')}：
              {linkedBrand.data?.name ?? t(linkedBrand.error ? '关联品牌不可用' : '正在读取资料')} ·{' '}
              {t('未另选品牌时会采用产品所属品牌。')}
            </p>
          )}
          {linkedBrand.error && (
            <Notice tone="warning">
              <p>{t('关联品牌无法读取，请重试或在产品库修复关联。')}</p>
              <Button variant="secondary" type="button" onClick={() => void linkedBrand.refetch()}>
                {t('重试')}
              </Button>
            </Notice>
          )}
          {productConflict && (
            <Notice tone="warning">
              {t('所选品牌与产品所属品牌冲突，请改选品牌或产品。')}
              <Button type="button" variant="secondary" onClick={() => setBrandId('')}>
                {t('采用产品所属品牌')}
              </Button>
            </Notice>
          )}
          {selectedProduct.data?.validUntil &&
            Date.parse(selectedProduct.data.validUntil) <= Date.now() && (
              <Notice tone="warning">{t('产品资料已过期，请更新资料或重新选择。')}</Notice>
            )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!multiple && includeProductImages === true}
              disabled={multiple}
              onChange={(event) => setIncludeProductImages(event.target.checked)}
            />
            {t('带入产品参考图')}
          </label>
          <p className="field-hint">
            {t('默认仅使用产品文字资料；参考图与本次素材共同受模型数量限制。')}
          </p>
        </>
      )}
      {multiple && (
        <Notice tone="warning">
          {t('分组物料暂不支持关联产品与个人记忆，请切换单张创作或取消关联')}
          {productId && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setProductId('');
                setIncludeProductImages(undefined);
              }}
            >
              {t('取消产品关联')}
            </Button>
          )}
        </Notice>
      )}
      <p className="field-hint">
        {t(
          planningMode === 'direct'
            ? kind === 'video'
              ? '直接使用需求与已选资料，跳过文本规划；视频仍可能需要生成首帧。'
              : '直接使用需求与已选资料生成，跳过文本模型规划，减少规划费用。'
            : '先由文本模型梳理需求，再调用生成模型；可关闭以跳过文本规划。',
        )}
      </p>
    </section>
  );
  const optionalPreferences = (
    <>
      <div className="knowledge-memory-controls">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!multiple && useMemory === true}
            disabled={multiple}
            onChange={(event) => setUseMemory(event.target.checked)}
          />
          {t('使用创作记忆')}
        </label>
        <p className="field-hint">
          {t('仅采用当前空间中你确认过且仍有效的记忆；本次明确要求优先。')}{' '}
          <Link to="/settings?tab=memory">{t('管理创作记忆')}</Link>
        </p>
        {!multiple && useMemory && memories.error && (
          <Notice tone="warning">
            {t('记忆预览读取失败，请重试；规划时会重新核对。')}{' '}
            <Button type="button" variant="ghost" onClick={() => void memories.refetch()}>
              {t('重试')}
            </Button>
          </Notice>
        )}
        {!multiple && useMemory && eligibleMemories.length > 0 && (
          <details>
            <summary>
              {t('当前可用记忆')} · {eligibleMemories.length}
            </summary>
            <ul className="knowledge-preview">
              {eligibleMemories.map((item) => (
                <li key={item.id}>
                  <strong>{item.topic}</strong>：{item.content}
                </li>
              ))}
            </ul>
            <p className="field-hint">
              {t('这里只预览当前页，实际采用项以规划后的资料快照为准。')}
            </p>
          </details>
        )}
      </div>
      <div className="form-grid">
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
              disabled={
                !referenceModeIssue &&
                (!acceptsFirstLast || currentModel?.id === 'kling-o1-first-last')
              }
              value={referenceMode}
              onChange={(e) => {
                defaultsPending.current = false;
                setDefaultsReady(true);
                setReferenceMode(e.target.value);
              }}
            >
              {referenceModeIssue && (
                <option value={referenceMode}>
                  {t(referenceMode === 'first-last' ? '首尾帧' : '全能参考')}
                  {t('（当前不支持，原值保留）')}
                </option>
              )}
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
          disabled={currentModel?.textOverlay?.mode === 'unsupported' && !needText}
          onChange={(e) => {
            defaultsPending.current = false;
            setDefaultsReady(true);
            needTextTouched.current = true;
            setNeedText(e.target.checked);
          }}
        />
        {t('生成画面文案 / 字幕')}
      </label>
      {currentModel?.textOverlay && <Notice>{t(currentModel.textOverlay.note)}</Notice>}
      <Button
        variant="ghost"
        onClick={() => {
          if (visualVariant === 'studio') setExpanded(false);
          setAssistantOpen(true);
        }}
        disabled={!canEdit || !referencesReady || planningMode === 'direct'}
      >
        <Sparkles size={15} />
        {t('AI 帮我写')}
      </Button>
    </>
  );
  const advancedControls = (
    <>
      {generationControls}
      {basics}
      {modelInformation}
      {visualVariant === 'studio' ? (
        <details className="composer-settings-preferences">
          <summary>{t('更多偏好')}</summary>
          <div>{optionalPreferences}</div>
        </details>
      ) : (
        optionalPreferences
      )}
    </>
  );
  return (
    <>
      <div
        ref={composerRef}
        data-purpose={purpose}
        data-presentation={presentation}
        data-media-kind={kind}
        className={
          visualVariant === 'studio'
            ? 'composer composer-studio'
            : `composer composer-v2 ${compact ? 'composer-compact' : ''} ${isHome ? 'composer-home' : ''} ${isQuick ? 'composer-quick' : ''}`
        }
      >
        <div className="composer-top">
          <Segments
            value={kind}
            onChange={switchKind}
            options={[
              { value: 'image', label: '图片创作' },
              { value: 'video', label: '视频创作' },
            ]}
          />
          {isHome && (
            <div className="composer-directions" role="group" aria-label={t('创作方向')}>
              {(kind === 'image'
                ? [
                    { id: 'free', name: '自由创作' },
                    ...IMAGE_KINDS.filter((option) =>
                      (supportsOrdinaryDesigns
                        ? ['single', 'white-background', 'main-secondary', 'marketing']
                        : ['single', 'white-background', 'marketing']
                      ).includes(option.id),
                    ),
                  ]
                : [
                    { id: 'free', name: '自由创作' },
                    ...VIDEO_KINDS.filter((option) => option.id !== 'free'),
                  ]
              ).map((option) => (
                <button
                  type="button"
                  key={option.id}
                  aria-pressed={outputKind === option.id}
                  disabled={!canEdit}
                  onClick={() => chooseOutputKind(option.id)}
                >
                  {t(option.name)}
                </button>
              ))}
              {kind === 'image' && <Link to="/detail-pages">{t('商品详情页')} ↗</Link>}
            </div>
          )}
          <span
            className="composer-note"
            role={isHome || visualVariant === 'studio' ? 'status' : undefined}
          >
            {isHome || visualVariant === 'studio' ? (
              t(draftStatus)
            ) : (
              <>
                <Sparkles size={14} />
                {t('草稿自动保存')}
              </>
            )}
          </span>
        </div>
        <p className="field-hint" role="status" hidden={isHome || visualVariant === 'studio'}>
          {t(draftStatus)}
        </p>
        {!projectId && boundProjectId && (
          <Link
            className="text-button"
            to={`${isReplica ? '/replica' : '/workbench'}/${boundProjectId}`}
            state={{ recoveryDraft: currentRecovery(boundProjectId) }}
          >
            {t('继续此项目草稿')}
          </Link>
        )}
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
        {legacyReplicaPreserved && (
          <p className="field-hint composer-legacy-replica">
            <Link to={`${projectId ? `/replica/${projectId}` : '/replica'}?kind=${kind}`}>
              {t('复刻草稿已保留，前往独立复刻页')}
            </Link>
          </p>
        )}
        <div className="creative-prompt-surface">{promptEditor}</div>
        {planningIssue && (
          <Notice tone="warning">
            {planningIssue}{' '}
            {planningMode !== 'direct' && <Link to="/settings?tab=models">{t('模型配置')}</Link>}
          </Notice>
        )}
        {!!productIssue && !contextExpanded && (
          <Notice tone="warning">
            {t('关联资料需要核对，请打开关联配置。')}
            <Button variant="ghost" onClick={() => setContextExpanded(true)}>
              {t('关联配置')}
            </Button>
          </Notice>
        )}
        {ideaError && !pendingIdea && (
          <p className="field-error" role="alert">
            {ideaError}
          </p>
        )}
        {ideaUndo && ideaUndo.kind === kind && prompt === ideaUndo.after && (
          <div className="composer-idea-undo" role="status">
            <span>{t('已填入灵感，可继续修改')}</span>
            <Button
              variant="ghost"
              disabled={!canEdit}
              onClick={() => {
                setPrompt(ideaUndo.before);
                setIdeaUndo(null);
                promptRef.current?.focus();
              }}
            >
              <Undo2 size={14} />
              {t('撤销填入')}
            </Button>
          </div>
        )}
        <Modal
          open={pendingIdea !== null}
          onClose={() => setPendingIdea(null)}
          title={t('如何使用这个想法？')}
        >
          <p>{t('当前需求会保留，选择补充或明确替换后再应用。')}</p>
          <p className="studio-pending-idea">{pendingIdea}</p>
          {ideaError && (
            <p className="field-error" role="alert">
              {ideaError}
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() => pendingIdea && applyIdea(pendingIdea, 'append')}
            >
              {t('补充到当前需求')}
            </Button>
            <Button onClick={() => pendingIdea && applyIdea(pendingIdea, 'replace')}>
              {t('替换当前需求')}
            </Button>
          </div>
        </Modal>

        {modelSelectionMissing && (
          <section aria-label={t('模型选择需要更新')}>
            <Notice tone="warning">
              <strong>{t('模型配置已更新，草稿中的模型已不可用。')}</strong>
              <p>
                {t(
                  isQuick
                    ? '采用新模型时将使用其默认参数，创作需求与素材会保留。'
                    : '创作需求、素材与生成参数已保留，请选择模型并核对参数。',
                )}
              </p>
              <Button
                variant="secondary"
                disabled={!canEdit || preparationSubmissionLocked}
                onClick={() => {
                  if (operation && replacementModel)
                    selectGenerationModel(operation.id, operation.providerId, replacementModel.id);
                  setExpanded(true);
                  setSettingsFocusRequest((value) => value + 1);
                }}
              >
                {replacementModel
                  ? t('使用已配置模型（{model}）').replace('{model}', replacementModel.id)
                  : t('重新选择模型')}
              </Button>
            </Notice>
          </section>
        )}
        {!modelSelectionMissing &&
          !expanded &&
          (!modelCapability.canGenerate || selectionIssue) && (
            <ModelCapabilityStatus
              capability={modelCapability}
              selectionIssue={selectionIssue}
              onUseFixed={useFixedParameters}
            />
          )}
        {outputKind === 'detail' && (
          <Notice>
            {t('这是旧版分组物料草稿。新的整套详情页请使用专用流程。')}{' '}
            <Link className="text-button" to="/detail-pages">
              {t('前往商品详情页')}
            </Link>
          </Notice>
        )}
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
        <ComposerSettingsPopover
          id={contextSettingsId}
          title="关联配置"
          open={contextExpanded}
          onOpenChange={setContextExpanded}
          anchorRef={contextTrigger}
          focusRequest={0}
        >
          {creationContext}
        </ComposerSettingsPopover>
        {visualVariant === 'studio' ? (
          <ComposerSettingsPopover
            id={settingsId}
            open={expanded}
            onOpenChange={setExpanded}
            anchorRef={settingsTrigger}
            focusRequest={settingsFocusRequest}
            restoreFocus={!assistantOpen}
          >
            {advancedControls}
          </ComposerSettingsPopover>
        ) : expanded ? (
          <section className="composer-advanced" id={settingsId} aria-label={t('创作设置')}>
            {advancedControls}
          </section>
        ) : null}
        {assistantOpen && (
          <AIWriter
            technical={{ ratio, resolution, language }}
            open={assistantOpen}
            onClose={() => setAssistantOpen(false)}
            onCloseAutoFocus={
              visualVariant === 'studio'
                ? (event) => {
                    event.preventDefault();
                    settingsTrigger.current?.focus();
                  }
                : undefined
            }
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
        {remembering && (
          <MemoryEditor initialContent={prompt} onClose={() => setRemembering(false)} />
        )}
        <CreativeBrief
          reviewExpanded={isReplica}
          planningMode={planningMode}
          preparation={creativeBrief.preparation}
          answers={creativeBrief.answers}
          busy={creativeBrief.busy}
          locked={creativeBrief.locked || !canEdit}
          error={creativeBrief.error}
          canRestart={creativeBrief.canRestart && canEdit}
          onRestart={() => {
            if (canEdit && !preparationSubmissionLocked && creativeBrief.canRestart) {
              creativeBrief.restart();
              void refreshLibraryContext();
            }
          }}
          canRefreshSources={
            creativeBrief.canRefreshSources && canEdit && !preparationSubmissionLocked
          }
          onRefreshSources={
            input.productId || input.brandId || input.useMemory
              ? () => {
                  if (canEdit && !preparationSubmissionLocked && creativeBrief.canRefreshSources) {
                    creativeBrief.refreshSources();
                    // A visible tab does not receive updates made by another client.
                    // Refresh read-only metadata so a renewed product cannot remain locally blocked.
                    void refreshLibraryContext();
                  }
                }
              : undefined
          }
          onAnswer={creativeBrief.answer}
          mediaType={kind}
          missingQuestionId={creativeBrief.missingQuestionId}
          focusRequest={creativeBrief.focusRequest}
          onEditSettings={() => {
            setExpanded(true);
            if (visualVariant === 'studio') {
              setSettingsFocusRequest((value) => value + 1);
            } else {
              requestAnimationFrame(() => {
                const settings = document.getElementById(settingsId);
                settings
                  ?.querySelector<HTMLElement>('select:not(:disabled), input:not(:disabled)')
                  ?.focus();
              });
            }
          }}
          onAddReference={
            !textOnly && references.length < sourceMax && canEdit
              ? () => {
                  composerRef.current
                    ?.querySelector<HTMLButtonElement>(
                      isReplica
                        ? '[data-replica-materials] .asset-picker:nth-of-type(2) .asset-add'
                        : '.asset-picker-inline .asset-add',
                    )
                    ?.click();
                }
              : undefined
          }
        />
        <JobSubmit
          forceConfirmation={isReplica}
          label={
            isReplica && creativeBrief.preparation?.status !== 'ready'
              ? creativeBrief.preparation?.status === 'needs_clarification'
                ? '补充完成，继续分析'
                : '分析参考作品'
              : creativeBrief.preparation?.status === 'needs_clarification'
                ? '补充完成，继续'
                : kind === 'image'
                  ? '生成图片'
                  : '生成视频'
          }
          busyLabel={
            creativeBrief.busy && planningMode !== 'direct' ? '正在理解你的想法…' : '正在准备…'
          }
          estimateReady={defaultsReady && modelCapability.canGenerate && !selectionIssue}
          input={input}
          operation={operation}
          secondaryActions={
            <div className="composer-footer-tools">
              {composerToolbar}
              {secondaryActions}
            </div>
          }
          recoveryScope={`${isReplica ? 'replica' : 'composer'}:${projectId ?? 'new'}`}
          creationPurpose={purpose}
          beforePrepareInput={async (value) => {
            const requiresAnalysis = isReplica && creativeBrief.preparation?.status !== 'ready';
            const prepared = await creativeBrief.prepare(value);
            return requiresAnalysis ? null : prepared;
          }}
          onPreparationInvalid={creativeBrief.invalidatePreparation}
          preparationRevision={creativeBrief.sourceRevision}
          onPreparationLockChange={setPreparationSubmissionLocked}
          prepareInput={prepareSubmission}
          onCapabilityChanged={async () => {
            const result = await modelCapability.refresh();
            return !!result?.data?.canGenerate && !result.error;
          }}
          valid={!!prompt.trim() && generationReady}
          onRequestPrompt={
            generationReady
              ? () => {
                  setPromptRequested(true);
                  promptRef.current?.focus();
                }
              : undefined
          }
          onCreated={(job) => {
            if (!projectId && job.projectId) {
              const state = transferDraft(job.projectId);
              finalized.current = true;
              navigate(jobDestination(job), { state: { ...state, submittedJob: job } });
            }
            onCreated?.(job);
          }}
        />
      </div>
    </>
  );
}

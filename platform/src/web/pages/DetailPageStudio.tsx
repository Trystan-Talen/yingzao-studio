import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Download,
  FileImage,
  Layers3,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AssetDto, ProjectDto } from '../../contracts/core';
import type { JobItemDto } from '../../contracts/jobs';
import {
  detailPagePlanResultSchema,
  detailPagePlanSchema,
  detailPageScreenSchema,
  type DetailPagePlan,
  type DetailPageScreen,
} from '../../contracts/detail-page';
import { useStudio } from '../context';
import { api, downloadFile, downloadPost, post, useApi, useRefresh, type Page } from '../lib/api';
import { jobInput, type Capabilities, type Job, type JobInput, type Quote } from '../lib/tasks';
import { t } from '../lib/i18n';
import {
  detailPageDraftKey,
  emptyDetailPageDraft,
  readDetailPageDraft,
  recoveredDetailPagePlan,
  adoptRecoveredDetailPagePlan,
  updateDetailPageScreen,
  type DetailPageDraft,
} from '../lib/detail-page-draft';
import { restoreAssets } from '../lib/creation-recovery';
import {
  defaultDetailPageEditor,
  detailPageBriefKey,
  detailPageFieldIssues,
  detailPageStepAvailable,
  isDetailPagePlanOutdated,
  readDetailPageEditor,
  type DetailPageStep,
} from '../lib/detail-page-workflow';
import { presentJob } from '../lib/job-presentation';
import { AssetPicker } from '../components/AssetPicker';
import { JobSubmit } from '../components/JobSubmit';
import { useModelCapability } from '../lib/use-model-capability';
import { ModelCapabilityStatus } from '../components/ModelCapabilityStatus';
import { JobProgress } from '../components/JobProgress';
import { JobCard } from '../components/TaskCenter';
import { jobDestination } from '../lib/job-navigation';
import { selectMatchingJobSnapshot } from '../lib/job-snapshot';
import { DetailPagePlanningNotice, DetailPageUnknowns } from '../components/DetailPageStatus';
import {
  Badge,
  Button,
  Confirm,
  ErrorState,
  Loading,
  Field,
  Modal,
  Notice,
  useAction,
} from '../components/ui';

interface ScreenResult {
  screenId: string;
  index: number;
  item: JobItemDto | null;
  jobId: string;
  outputAssets: AssetDto[];
}
interface DetailPageResult {
  job: Job;
  plan: DetailPagePlan;
  screens: ScreenResult[];
  complete: boolean;
}
type PreparedQuote = { input: JobInput; quote: Quote };
const ongoing = (job?: Job) =>
  !!job && ['queued', 'running', 'reconciliation_required'].includes(job.status);

export function DetailPageStudio() {
  const { projectId } = useParams();
  return <DetailPageWorkspace key={projectId ?? 'new'} routeProjectId={projectId} />;
}
function DetailPageWorkspace({ routeProjectId }: { routeProjectId?: string }) {
  const { session, workspace, canEdit } = useStudio();
  const navigate = useNavigate();
  const location = useLocation();
  const focusedJobId = new URLSearchParams(location.search).get('job');
  const focusedQuery = useApi<Job>(
    `/jobs/${encodeURIComponent(focusedJobId ?? '')}`,
    !!focusedJobId,
    3000,
  );
  const storageKey = detailPageDraftKey(session!.user.id, workspace!.id, routeProjectId);
  const [recovery] = useState(() => {
    try {
      return readDetailPageDraft(localStorage, storageKey);
    } catch {
      return { draft: emptyDetailPageDraft(), error: '浏览器存储不可用，当前修改仅保留在此页面。' };
    }
  });
  const [draft, setDraft] = useState<DetailPageDraft>(() => ({
    ...recovery.draft,
    ...(routeProjectId ? { projectId: routeProjectId } : {}),
  }));
  const focusedJob = selectMatchingJobSnapshot(
    { id: focusedJobId, projectId: draft.projectId, workspaceId: workspace?.id },
    focusedQuery.data,
  );
  const [storageError, setStorageError] = useState<string | null>(recovery.error);
  const [storageBlocked, setStorageBlocked] = useState(!!recovery.error);
  const [references, setReferences] = useState<AssetDto[]>([]);
  const [referenceFailures, setReferenceFailures] = useState<{ id: string; message: string }[]>([]);
  const [referenceRetry, setReferenceRetry] = useState(0);
  const [referencesReady, setReferencesReady] = useState(!draft.referenceAssetIds.length);
  const [confirmedPlanning, setConfirmedPlanning] = useState<Job | null>(null);
  const [confirmedGeneration, setConfirmedGeneration] = useState<Job | null>(null);
  const [selectedScreen, setSelectedScreen] = useState<string | null>(
    draft.plan?.screens[0]?.id ?? null,
  );
  const [editor, setEditor] = useState(() => {
    try {
      return readDetailPageEditor(localStorage, storageKey, draft);
    } catch {
      return defaultDetailPageEditor(draft);
    }
  });
  const [directionOpen, setDirectionOpen] = useState(false);
  const currentStep: DetailPageStep = focusedJobId
    ? focusedJob?.input.options.detailPagePlan
      ? 2
      : 1
    : editor.step;
  function setView(view: 'plan' | 'results') {
    setEditor((previous) => ({
      ...previous,
      step: view === 'plan' ? 1 : 2,
      resultMode: view === 'results' ? 'result' : 'draft',
    }));
  }
  const [preview, setPreview] = useState<AssetDto | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const center = useRef<HTMLElement>(null);
  const projectCreation = useRef<Promise<string> | null>(null);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const action = useAction();
  const refresh = useRefresh();
  const caps = useApi<Capabilities>('/capabilities');
  const planningOperation = caps.data?.operations.find(
    (operation) => operation.id === 'text.assist' && operation.providerId === 'dify',
  );
  const imageOperation = caps.data?.operations.find(
    (operation) => operation.id === 'image.generate' && operation.providerId === 'openai',
  );
  const planningCapability = useModelCapability({
    operation: planningOperation,
    model: planningOperation?.models[0],
    inputMode: 'text',
  });
  const imageCapability = useModelCapability({
    operation: imageOperation,
    model: imageOperation?.models[0],
    inputMode: draft.referenceAssetIds.length ? 'image' : 'text',
  });
  const supportedRatios = ['3:4', '2:3', '9:16'].filter((ratio) =>
    imageCapability.model?.ratios.includes(ratio),
  );
  const imageCapabilityIssue =
    draft.plan?.screens
      .map((screen) =>
        imageCapability.selectionIssue({
          ratio: screen.ratio,
          resolution: draft.resolution ?? '2K',
        }),
      )
      .find(Boolean) ??
    imageCapability.selectionIssue({ ratio: draft.ratio, resolution: draft.resolution ?? '2K' });
  const planningQuery = useApi<Job>(
    `/jobs/${draft.planningJobId ?? ''}`,
    !!draft.planningJobId,
    3000,
  );
  const selectedGenerationId = focusedJob?.input.options.detailPagePlan
    ? focusedJob.id
    : draft.generationJobId;
  const generationQuery = useApi<DetailPageResult>(
    `/detail-pages/${selectedGenerationId ?? ''}`,
    !!selectedGenerationId && (!focusedJobId || !!focusedJob),
    3000,
  );
  useEffect(() => {
    if (focusedJob?.input.options.detailPagePlan) setView('results');
  }, [focusedJob?.id, focusedJob?.input.options.detailPagePlan]);
  const history = useApi<Page<Job>>(
    `/jobs?projectId=${draft.projectId ?? ''}&pageSize=30`,
    !!draft.projectId,
    5000,
  );
  const projectMessages = useApi<Page<unknown>>(
    `/projects/${draft.projectId ?? ''}/messages?pageSize=30`,
    !!draft.projectId,
    5000,
  );
  const recent = useApi<Page<Job>>(
    '/jobs?operation=image.generate&pageSize=24',
    !routeProjectId,
    10000,
  );
  const planning =
    confirmedPlanning &&
    (!planningQuery.data || confirmedPlanning.updatedAt >= planningQuery.data.updatedAt)
      ? confirmedPlanning
      : planningQuery.data;
  const recoveredPlan = draft.projectId
    ? recoveredDetailPagePlan(
        projectMessages.data?.items ?? [],
        draft.projectId,
        planning
          ? {
              screenCount: planning.input.options.detailPageScreenCount,
              ratio: planning.input.options.ratio,
            }
          : undefined,
      )
    : null;
  const generationScope = {
    id: !focusedJobId || focusedJob ? selectedGenerationId : undefined,
    projectId: draft.projectId,
    workspaceId: workspace?.id,
  };
  const generationResult = selectMatchingJobSnapshot(generationScope, generationQuery.data?.job)
    ? generationQuery.data
    : undefined;
  const generation = selectMatchingJobSnapshot(
    generationScope,
    generationResult?.job,
    confirmedGeneration,
    focusedJob,
  );
  const displayedView =
    currentStep === 2 && (focusedJobId || editor.resultMode === 'result') ? 'results' : 'plan';
  const generating =
    ongoing(generation) ||
    !!generationResult?.screens.some((screen) =>
      ['queued', 'running', 'reconciliation_required'].includes(screen.item?.status ?? ''),
    );
  const planningResult = planning?.items
    .map((item) => detailPagePlanResultSchema.safeParse(item.resultData))
    .find((result) => result.success);
  const nextPlan = planningResult?.success ? planningResult.data.plan : null;
  const activePlan =
    displayedView === 'results'
      ? (generationResult?.plan ?? generation?.input.options.detailPagePlan ?? draft.plan)
      : draft.plan;
  const planValidation = detailPagePlanSchema.safeParse(draft.plan);
  const approvedCount =
    draft.plan?.screens.filter((screen) => draft.confirmedScreens.includes(screen.id)).length ?? 0;
  const allConfirmed =
    !!draft.plan && approvedCount === draft.plan.screens.length && draft.factsConfirmed;
  const savedCount =
    generationResult?.screens.filter(
      (screen) => screen.item?.status === 'succeeded' && screen.outputAssets.length > 0,
    ).length ?? 0;
  const complete = generationResult?.complete === true;
  const resultItems =
    generationResult?.screens.flatMap((screen) => (screen.item ? [screen.item] : [])) ?? [];
  const generationDisplay =
    generation && generationResult
      ? ({
          ...generation,
          status: complete
            ? 'succeeded'
            : resultItems.some((item) => ['queued', 'running'].includes(item.status))
              ? 'running'
              : resultItems.some((item) => item.canResume)
                ? 'reconciliation_required'
                : savedCount > 0
                  ? 'partial'
                  : generation.status,
          items: resultItems,
          stage: t('已保存 {saved} / {total} 屏，各屏状态会持续更新。')
            .replace('{saved}', String(savedCount))
            .replace('{total}', String(generationResult.plan.screens.length)),
        } satisfies Job)
      : generation;
  const currentBriefKey = detailPageBriefKey(draft);
  const planningBriefKey = planning
    ? detailPageBriefKey({
        brief: planning.input.prompt,
        screenCount: Number(planning.input.options.detailPageScreenCount ?? draft.screenCount),
        ratio: String(planning.input.options.ratio ?? draft.ratio),
      })
    : null;
  const planBriefKey =
    editor.planBriefKey ??
    (planning && (!draft.adoptedPlanningJobId || draft.adoptedPlanningJobId === planning.id)
      ? planningBriefKey
      : null);
  const planOutdated =
    !!draft.plan &&
    isDetailPagePlanOutdated(currentBriefKey, planBriefKey, editor.acceptedBriefKey);
  const fieldIssues = detailPageFieldIssues(draft.plan);
  const selected =
    draft.plan?.screens.find((screen) => screen.id === selectedScreen) ?? draft.plan?.screens[0];
  const editingDisabled = !canEdit || generating || ongoing(planning);
  const readyToGenerate =
    planValidation.success &&
    allConfirmed &&
    referencesReady &&
    references.length >= 1 &&
    !planOutdated &&
    !storageBlocked;
  const generationBlocker = planOutdated
    ? t('商品信息已改变，请先重新策划或明确保留当前方案。')
    : !draft.plan
      ? t('请先完成商品策划。')
      : fieldIssues.length
        ? t('还有 {count} 项内容需要修改。').replace('{count}', String(fieldIssues.length))
        : approvedCount < (draft.plan?.screens.length ?? 0)
          ? t('还有 {count} 屏待确认。').replace(
              '{count}',
              String((draft.plan?.screens.length ?? 0) - approvedCount),
            )
          : !draft.factsConfirmed
            ? t('请核对商品事实和待确认信息。')
            : !referencesReady
              ? t('商品参考图尚未恢复，请返回准备商品处理。')
              : !references.length
                ? t('请先添加至少 1 张商品参考图。')
                : storageBlocked
                  ? t('请先处理草稿保存问题。')
                  : ongoing(planning)
                    ? t('策划正在进行，请等待完成。')
                    : generating
                      ? t('图片正在生成，可以查看当前进度。')
                      : null;
  function fieldError(field: string, screenId?: string) {
    return (
      fieldIssues
        .filter((issue) => issue.field === field && issue.screenId === screenId)
        .map((issue) => `${issue.label}：${issue.message}`)
        .join(' ') || undefined
    );
  }
  function availableStep(step: DetailPageStep) {
    return detailPageStepAvailable(step, {
      hasPlan: !!draft.plan,
      hasPlanning: !!planning || !!draft.planningJobId,
      hasResult: !!generation || !!draft.generationJobId,
      readyToGenerate,
    });
  }
  function goToStep(step: DetailPageStep) {
    if (!availableStep(step)) return;
    if (focusedJobId) navigate(location.pathname, { replace: true });
    setEditor((previous) => ({
      ...previous,
      step,
      ...(step === 2 && !readyToGenerate && generation ? { resultMode: 'result' as const } : {}),
    }));
    showCenter();
  }
  function changeBrief(patch: Partial<Pick<DetailPageDraft, 'brief' | 'screenCount' | 'ratio'>>) {
    if (draft.plan)
      setEditor((previous) => ({
        ...previous,
        resultMode: 'draft',
        planBriefKey: previous.planBriefKey ?? planBriefKey ?? currentBriefKey,
      }));
    update(patch);
  }
  function adoptPlanSource() {
    setEditor((previous) => ({
      ...previous,
      step: 1,
      resultMode: 'draft',
      planBriefKey: planningBriefKey ?? currentBriefKey,
      acceptedBriefKey: null,
    }));
  }
  function startNewVersion() {
    if (focusedJobId) navigate(location.pathname, { replace: true });
    update({ confirmedScreens: [], factsConfirmed: false });
    setView('plan');
    showCenter();
  }
  const referenceKey = draft.referenceAssetIds.join(',');

  function update(patch: Partial<DetailPageDraft>) {
    if (patch.confirmedScreens !== undefined || patch.factsConfirmed !== undefined)
      setEditor((previous) => ({ ...previous, resultMode: 'draft' }));
    setDraft((previous) => ({ ...previous, ...patch }));
  }
  useEffect(() => {
    if (storageBlocked) return;
    try {
      const serialized = JSON.stringify({ ...draft, editor });
      localStorage.setItem(storageKey, serialized);
      if (draft.projectId)
        localStorage.setItem(
          detailPageDraftKey(session!.user.id, workspace!.id, draft.projectId),
          serialized,
        );
      setStorageError(null);
    } catch {
      setStorageError('当前修改暂未保存到本机。请恢复浏览器存储后再离开页面。');
      setStorageBlocked(true);
    }
  }, [draft, editor, storageKey, storageBlocked, session?.user.id, workspace?.id]);
  useEffect(() => {
    let cancelled = false;
    setReferencesReady(false);
    void restoreAssets(draft.referenceAssetIds, (id) => api<AssetDto>(`/assets/${id}`)).then(
      (result) => {
        if (cancelled) return;
        const images = result.assets.filter((asset) => asset.kind === 'image');
        setReferences(images);
        setReferenceFailures([
          ...result.failures,
          ...result.assets
            .filter((asset) => asset.kind !== 'image')
            .map((asset) => ({ id: asset.id, message: '详情页只接受商品图片，请移除此素材。' })),
        ]);
        setReferencesReady(result.ready && images.length === draft.referenceAssetIds.length);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [referenceKey, referenceRetry, workspace?.id]);
  useEffect(() => {
    if (
      !routeProjectId ||
      !history.data ||
      draft.planningJobId ||
      draft.generationJobId ||
      draft.plan
    )
      return;
    const planJob = history.data.items.find(
      (job) => job.input.options.assistantMode === 'detail-page',
    );
    const imageJob = history.data.items.find((job) => !!job.input.options.detailPagePlan);
    if (!planJob && !imageJob) return;
    setDraft((previous) => ({
      ...previous,
      brief: previous.brief || planJob?.prompt || '',
      screenCount:
        planJob?.input.options.detailPageScreenCount ??
        imageJob?.input.options.detailPagePlan?.screens.length ??
        previous.screenCount,
      ratio: (planJob?.input.options.ratio ??
        imageJob?.input.options.detailPagePlan?.screens[0]?.ratio ??
        previous.ratio) as DetailPageDraft['ratio'],
      planningJobId: planJob?.id,
      generationJobId: imageJob?.id,
      resolution: (imageJob?.input.options.resolution ??
        previous.resolution) as DetailPageDraft['resolution'],
      adoptedPlanningJobId: imageJob?.input.options.detailPagePlanningJobId,
      plan: imageJob?.input.options.detailPagePlan ?? previous.plan,
      referenceAssetIds: imageJob?.input.referenceAssetIds ?? previous.referenceAssetIds,
    }));
    if (imageJob) setView('results');
  }, [routeProjectId, history.data, draft.planningJobId, draft.generationJobId, draft.plan]);
  useEffect(() => {
    if (nextPlan && planning && !draft.plan) {
      setDraft((previous) => ({
        ...previous,
        plan: nextPlan,
        adoptedPlanningJobId: planning.id,
        recoveredPlanMessageId: undefined,
        confirmedScreens: [],
        factsConfirmed: false,
      }));
      setSelectedScreen(nextPlan.screens[0]?.id ?? null);
      adoptPlanSource();
    }
  }, [nextPlan, planning?.id, draft.plan]);
  async function ensureProject() {
    if (latestDraft.current.projectId) return latestDraft.current.projectId;
    if (!projectCreation.current) {
      projectCreation.current = post<ProjectDto>('/projects', {
        name: (
          latestDraft.current.plan?.productName ||
          `商品详情页 · ${latestDraft.current.brief.slice(0, 24) || '新创作'}`
        ).slice(0, 80),
        kind: 'image',
        workflow: 'detail-page',
        description: latestDraft.current.brief.slice(0, 4000),
      })
        .then((project) => {
          setDraft((previous) => ({ ...previous, projectId: project.id }));
          return project.id;
        })
        .catch((error: unknown) => {
          projectCreation.current = null;
          throw error;
        });
    }
    return projectCreation.current;
  }
  function showCenter() {
    requestAnimationFrame(() =>
      center.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      }),
    );
  }
  function patchPlan(patch: Partial<DetailPagePlan>) {
    setEditor((previous) => ({ ...previous, resultMode: 'draft' }));
    setDraft((previous) =>
      previous.plan
        ? {
            ...previous,
            plan: { ...previous.plan, ...patch },
            confirmedScreens: [],
            factsConfirmed: false,
          }
        : previous,
    );
  }
  function patchScreen(id: string, patch: Partial<DetailPageScreen>) {
    setEditor((previous) => ({ ...previous, resultMode: 'draft' }));
    setDraft((previous) =>
      previous.plan
        ? {
            ...previous,
            plan: updateDetailPageScreen(previous.plan, id, patch),
            confirmedScreens: previous.confirmedScreens.filter((screenId) => screenId !== id),
          }
        : previous,
    );
  }
  function moveScreen(index: number, offset: number) {
    if (!draft.plan) return;
    const screens = [...draft.plan.screens];
    const screen = screens.splice(index, 1)[0];
    if (!screen) return;
    screens.splice(index + offset, 0, screen);
    patchPlan({ screens });
  }
  const planningInput = jobInput({
    operation: 'text.assist',
    providerId: 'dify',
    capabilityRevision: planningCapability.revision,
    prompt: draft.brief,
    assetIds: [],
    referenceAssetIds: [],
    ...(draft.projectId ? { projectId: draft.projectId } : {}),
    options: {
      model: planningOperation?.models[0]?.id,
      assistantMode: 'detail-page',
      detailPageScreenCount: draft.screenCount,
      ratio: draft.ratio,
      count: 1,
    },
  });
  const generationInput = jobInput({
    operation: 'image.generate',
    providerId: 'openai',
    capabilityRevision: imageCapability.revision,
    prompt: draft.plan?.productName || draft.brief,
    assetIds: [],
    referenceAssetIds: draft.referenceAssetIds,
    ...(draft.projectId ? { projectId: draft.projectId } : {}),
    options: {
      model: imageOperation?.models[0]?.id,
      resolution: draft.resolution ?? '2K',
      ratio: draft.ratio,
      count: 1,
    },
  });
  const resumableJobs = [
    ...new Set(
      generationResult?.screens
        .filter((screen) => screen.item?.canResume)
        .map((screen) => screen.jobId) ?? [],
    ),
  ];
  const retryJobs = [
    ...new Set(
      generationResult?.screens
        .filter((screen) => screen.item?.retryable === true)
        .map((screen) => screen.jobId) ?? [],
    ),
  ];
  const historySets = history.data?.items.filter((job) => !!job.input.options.detailPagePlan) ?? [];
  const recentSets = [
    ...new Map(
      (recent.data?.items ?? [])
        .filter((job) => !!job.input.options.detailPagePlan && job.projectId)
        .map((job) => [job.projectId, job]),
    ).values(),
  ].slice(0, 4);

  const downloadButton = (
    <Button
      className="detail-download-all"
      variant={complete ? 'primary' : 'secondary'}
      disabled={!complete}
      busy={action.busy}
      onClick={() =>
        void action.run(async () => {
          await downloadPost(
            '/jobs/download-zip',
            { jobIds: [selectedGenerationId] },
            `${generationResult?.plan.productName ?? '商品详情页'}-整套.zip`,
          );
          await post(`/jobs/${selectedGenerationId}/downloaded`);
          void refresh();
        }, '整套详情页已下载')
      }
    >
      <Download size={16} />
      {t('下载整套详情页')}
    </Button>
  );

  return (
    <div className="detail-studio">
      <header className="detail-studio-header">
        <div className="detail-studio-brand">
          <span className="detail-studio-emblem">
            <LayoutTemplate size={22} />
          </span>
          <div>
            <span className="detail-eyebrow">{t('商品视觉工作室')}</span>
            <h1>{t('商品详情页')}</h1>
          </div>
          <Badge>{t('整套创作')}</Badge>
        </div>
        <div className="inline-actions">
          <Link className="button secondary" to="/tasks">
            {t('全部任务')}
          </Link>
          <span className="detail-autosave">
            {storageError ? t('草稿待保存') : t('已保存到此浏览器')}
          </span>
          <Button variant="ghost" onClick={() => setResetOpen(true)}>
            <Plus size={15} />
            {t('新建详情页')}
          </Button>
        </div>
      </header>
      {focusedJobId && (
        <section className="detail-task-location" aria-label={t('当前查看的任务')}>
          {focusedQuery.isLoading && <Loading label={t('正在读取指定任务…')} />}
          {focusedQuery.error && (
            <ErrorState error={focusedQuery.error} retry={focusedQuery.refetch} />
          )}
          {focusedJob && (
            <div className="task-receipt" role="status">
              <strong>{t('已定位到此任务')}</strong>
              <span>{t('此页显示所选任务的进度与结果，可从「任务」再次打开。')}</span>
              <code>{focusedJob.id.slice(0, 8)}</code>
            </div>
          )}
          {focusedJob && !focusedJob.input.options.detailPagePlan && <JobCard job={focusedJob} />}
          <Link className="button secondary" to={location.pathname}>
            {t('返回项目继续编辑')}
          </Link>
          {focusedQuery.data && !focusedJob && (
            <Notice tone="warning">
              {t('该任务不属于当前项目。')}{' '}
              <Link to={jobDestination(focusedQuery.data)}>{t('打开对应任务')}</Link>
            </Notice>
          )}
        </section>
      )}
      <nav className="detail-flow" aria-label={t('详情页创作流程')} ref={center}>
        {[
          ['准备商品', '填写需求与参考图'],
          ['确认方案', '逐屏调整文案与画面'],
          ['生成与导出', '确认费用，查看作品'],
        ].map(([label, description], index) => (
          <button
            type="button"
            key={label}
            className={index === currentStep ? 'current' : index < currentStep ? 'done' : ''}
            aria-current={index === currentStep ? 'step' : undefined}
            disabled={!availableStep(index as DetailPageStep)}
            onClick={() => goToStep(index as DetailPageStep)}
          >
            <span className="detail-flow-number">
              {index < currentStep ? <Check size={16} /> : index + 1}
            </span>
            <span>
              <strong>{t(label!)}</strong>
              <small>{t(description!)}</small>
            </span>
            {index !== 2 && <ArrowRight size={16} />}
          </button>
        ))}
      </nav>
      {planOutdated && currentStep !== 2 && !focusedJobId && (
        <Notice tone="warning">
          <strong>{t('商品信息已修改，现有方案尚未更新')}</strong>
          <p>
            {t(
              '新的简报、屏数或比例不会自动改写已有方案。重新策划会单独确认费用；也可以继续使用当前方案。',
            )}
          </p>
          <div className="inline-actions">
            <Button variant="secondary" onClick={() => goToStep(0)}>
              {t('返回准备商品，重新策划')}
            </Button>
            <Button
              variant="ghost"
              disabled={editingDisabled}
              onClick={() =>
                setEditor((previous) => ({ ...previous, acceptedBriefKey: currentBriefKey }))
              }
            >
              {t('保留当前方案继续')}
            </Button>
          </div>
        </Notice>
      )}
      {(generating || ongoing(planning)) && currentStep === 0 && (
        <div className="detail-running-strip" role="status">
          <RefreshCw size={16} className="spin" />
          <span>
            {t(
              generating
                ? '图片正在生成，离开页面后任务仍会继续。'
                : '商品策划正在进行，完成后可逐屏确认。',
            )}
          </span>
          <Button variant="ghost" onClick={() => goToStep(generating ? 2 : 1)}>
            {t('查看进度')} <ArrowRight size={14} />
          </Button>
        </div>
      )}
      {storageError && (
        <Notice tone="warning">
          {t(storageError)}
          {storageBlocked && (
            <Button variant="ghost" onClick={() => setStorageBlocked(false)}>
              {t('已核对，保存当前内容')}
            </Button>
          )}
        </Notice>
      )}
      {(!focusedJobId || !!focusedJob?.input.options.detailPagePlan) && (
        <div
          className={`detail-studio-layout detail-step-${currentStep}${focusedJobId ? ' detail-focused-layout' : ''}`}
        >
          <aside className="detail-brief-panel" hidden={currentStep !== 0 || !!focusedJobId}>
            <div className="detail-panel-heading">
              <span className="detail-eyebrow">{t('第一步 · 准备商品')}</span>
              <h2>{t('把商品和想法告诉我们')}</h2>
              <p>{t('先生成可编辑的分屏方案。你确认后，才会开始生成图片。')}</p>
            </div>
            <div className="detail-setup-grid">
              <div className="detail-brief-form">
                <Field label={t('商品信息与创作要求')}>
                  <textarea
                    value={draft.brief}
                    disabled={editingDisabled}
                    maxLength={5000}
                    rows={6}
                    onChange={(event) => changeBrief({ brief: event.target.value })}
                    placeholder={t(
                      '商品是什么？有哪些已确认的卖点、材质、规格？面向谁，想呈现怎样的风格？\n\n例如：一款 350ml 陶瓷随行杯，双层杯壁、硅胶杯盖。面向通勤人群，希望用温暖自然的画面呈现日常使用场景。',
                    )}
                  />
                  <span className="detail-field-count">{draft.brief.length} / 5000</span>
                </Field>
                <div className="detail-brief-options">
                  <Field label={t('页面数量')}>
                    <select
                      value={draft.screenCount}
                      onChange={(event) => changeBrief({ screenCount: Number(event.target.value) })}
                      disabled={editingDisabled}
                    >
                      {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => (
                        <option key={count} value={count}>
                          {count} {t('屏')}
                          {count === 6 ? ` · ${t('推荐')}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('单屏比例')}>
                    <select
                      value={draft.ratio}
                      onChange={(event) =>
                        changeBrief({ ratio: event.target.value as DetailPageDraft['ratio'] })
                      }
                      disabled={editingDisabled}
                    >
                      {!supportedRatios.includes(draft.ratio) && (
                        <option value={draft.ratio}>
                          {draft.ratio}
                          {t('（当前不支持，原值保留）')}
                        </option>
                      )}
                      {supportedRatios.map((ratio) => (
                        <option key={ratio}>{ratio}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
              <div className="detail-reference-pane">
                <div className="detail-reference-heading">
                  <h3>{t('商品参考图')}</h3>
                  <span>{draft.referenceAssetIds.length} / 4</span>
                </div>
                <AssetPicker
                  label={t('上传商品图片')}
                  value={references}
                  onChange={(assets) => {
                    setReferences(assets);
                    update({ referenceAssetIds: assets.map((asset) => asset.id) });
                  }}
                  kind="image"
                  max={4}
                  projectId={draft.projectId}
                  disabled={editingDisabled}
                  uploadScope="detail-page-product"
                />
                <p className="detail-help">
                  {t(
                    '请提供 1–4 张清晰商品图，用于生成时参考外观。策划依据上方文字信息，请写明图片中的关键细节。',
                  )}
                </p>
                {!referencesReady && !!draft.referenceAssetIds.length && (
                  <Notice tone="warning">
                    {referenceFailures.length
                      ? t('部分商品图未恢复，请重试或移除后继续。')
                      : t('正在恢复商品图…')}
                    {referenceFailures.map((failure) => (
                      <div key={failure.id}>
                        <p>{failure.message}</p>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            update({
                              referenceAssetIds: draft.referenceAssetIds.filter(
                                (id) => id !== failure.id,
                              ),
                            })
                          }
                        >
                          {t('移除此引用')}
                        </Button>
                      </div>
                    ))}
                    {!!referenceFailures.length && (
                      <Button
                        variant="ghost"
                        onClick={() => setReferenceRetry((value) => value + 1)}
                      >
                        {t('重试恢复')}
                      </Button>
                    )}
                  </Notice>
                )}
                <details className="detail-deliverables">
                  <summary>{t('你会得到什么')}</summary>
                  <p>
                    {draft.screenCount}{' '}
                    {t('屏有顺序的商品详情页，可逐屏修改；完成后导出原图、拼接长图和清单。')}
                  </p>
                </details>
              </div>
            </div>
            <div className="detail-planning-submit">
              {!draft.brief.trim() && (
                <p className="detail-submit-guidance">
                  {t('先填写商品信息，再开始策划。商品图可在生成前补充。')}
                </p>
              )}
              <ModelCapabilityStatus capability={planningCapability} />
              <JobSubmit
                input={planningInput}
                operation={planningOperation}
                forceConfirmation
                recoveryScope={`detail-page:plan:${draft.projectId ?? 'new'}`}
                valid={
                  planningCapability.canGenerate &&
                  !!draft.brief.trim() &&
                  !ongoing(planning) &&
                  !generating &&
                  !storageBlocked
                }
                label={draft.plan ? '重新策划整套方案' : '开始整套策划'}
                quoteFactory={async () => {
                  const projectId = await ensureProject();
                  return post<PreparedQuote>('/detail-pages/plan-quote', {
                    capabilityRevision: planningCapability.revision,
                    brief: draft.brief,
                    screenCount: draft.screenCount,
                    ratio: draft.ratio,
                    projectId,
                  });
                }}
                onCreated={(job) => {
                  setConfirmedPlanning(job);
                  update({ planningJobId: job.id, projectId: job.projectId ?? draft.projectId });
                  setView('plan');
                  showCenter();
                }}
              />
              <p>{t('先确认策划费用；图片生成会在方案确认后单独报价。')}</p>
              {draft.plan && (
                <Button variant="secondary" onClick={() => goToStep(1)}>
                  {t('继续编辑已有方案')} <ArrowRight size={16} />
                </Button>
              )}
            </div>
            {!!recentSets.length && (
              <div className="detail-recent">
                <h3>{t('继续最近的详情页')}</h3>
                {recentSets.map((job) => (
                  <Link key={job.id} to={`/detail-pages/${job.projectId}`}>
                    <Layers3 size={14} />
                    <span>{job.input.options.detailPagePlan?.productName}</span>
                    <ArrowRight size={13} />
                  </Link>
                ))}
              </div>
            )}
          </aside>
          <section className="detail-canvas-panel" hidden={currentStep === 0}>
            <div className="detail-canvas-heading">
              <div>
                <span className="detail-eyebrow">{t('从第一眼，到购买理由')}</span>
                <h2>{activePlan?.productName || t('构建一套完整的商品叙事')}</h2>
                <p>
                  {currentStep === 1
                    ? t('选择一屏，调整内容并确认。所有屏幕确认后再开始生成。')
                    : t('每一屏独立保存，可以查看原图和导出整套作品。')}
                </p>
              </div>
              <Badge>{t(currentStep === 1 ? '第二步 · 确认方案' : '第三步 · 生成与导出')}</Badge>
            </div>
            {!focusedJobId && currentStep === 1 && (
              <>
                {planningQuery.error && (
                  <ErrorState error={planningQuery.error} retry={planningQuery.refetch} />
                )}
                {ongoing(planning) && <JobProgress job={planning!} />}
                {planning?.items.some((item) => item.canResume) && (
                  <div className="detail-plan-resume">
                    <Button
                      variant="secondary"
                      disabled={!canEdit}
                      busy={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          const resumed = await post<Job>(`/jobs/${planning.id}/resume-result`);
                          setConfirmedPlanning(resumed);
                          await planningQuery.refetch();
                          void refresh();
                        }, '已恢复原策划，不会重新生成')
                      }
                    >
                      <RefreshCw size={14} />
                      {t('恢复已有策划')}
                    </Button>
                    <span>{t('继续获取原任务结果，不会再次发起策划。')}</span>
                  </div>
                )}
                {planning?.status === 'succeeded' && !nextPlan && (
                  <Notice tone="warning">
                    {t(
                      '本次策划未返回可编辑的分屏方案。原始结果保留在任务中心，请检查策划服务后重试。',
                    )}
                  </Notice>
                )}
                {recoveredPlan && recoveredPlan.messageId !== draft.recoveredPlanMessageId && (
                  <Notice>
                    <strong>{t('原策划的修复方案可采用')}</strong>
                    <p>
                      {recoveredPlan.plan.productName} · {recoveredPlan.plan.screens.length}{' '}
                      {t('屏')} · {recoveredPlan.plan.unknowns.length} {t('条待核对信息')}
                    </p>
                    <p>
                      {t(
                        '方案已通过修复后的结构校验。采用会替换当前编辑草稿；原策划失败记录保留，不会重新调用模型。',
                      )}
                    </p>
                    <Button
                      variant="secondary"
                      disabled={!canEdit || generating || ongoing(planning)}
                      onClick={() => {
                        setDraft((previous) =>
                          adoptRecoveredDetailPagePlan(previous, recoveredPlan),
                        );
                        setSelectedScreen(recoveredPlan.plan.screens[0]?.id ?? null);
                        adoptPlanSource();
                      }}
                    >
                      {t('采用恢复方案')}
                    </Button>
                  </Notice>
                )}
                <DetailPagePlanningNotice
                  recovered={!!draft.recoveredPlanMessageId}
                  failed={planning?.status === 'failed'}
                  hasGeneration={!!draft.generationJobId || !!generation}
                  failureMessage={
                    planning?.errorMessage ||
                    planning?.items.find((item) => item.errorMessage)?.errorMessage
                  }
                />
                {nextPlan && draft.plan && planning?.id !== draft.adoptedPlanningJobId && (
                  <Notice>
                    <strong>{t('新的整套方案已就绪')}</strong>
                    <p>{t('当前编辑仍然保留，采用新方案后需要重新核对各屏。')}</p>
                    <Button
                      variant="secondary"
                      disabled={editingDisabled}
                      onClick={() => {
                        update({
                          plan: nextPlan,
                          adoptedPlanningJobId: planning?.id,
                          recoveredPlanMessageId: undefined,
                          confirmedScreens: [],
                          factsConfirmed: false,
                        });
                        setSelectedScreen(nextPlan.screens[0]?.id ?? null);
                        adoptPlanSource();
                      }}
                    >
                      {t('采用这份新方案')}
                    </Button>
                  </Notice>
                )}
              </>
            )}
            {currentStep === 1 && draft.plan ? (
              <>
                <details
                  className="detail-visual-direction"
                  open={directionOpen}
                  onToggle={(event) => setDirectionOpen(event.currentTarget.open)}
                >
                  <summary>
                    <span>
                      <Sparkles size={15} />
                      {t('统一视觉方向')}
                    </span>
                    <span>{t('编辑')}</span>
                  </summary>
                  <div className="detail-direction-fields">
                    <Field label={t('商品名称')} error={fieldError('productName')}>
                      <input
                        disabled={editingDisabled}
                        value={draft.plan.productName}
                        maxLength={120}
                        onChange={(event) => patchPlan({ productName: event.target.value })}
                      />
                    </Field>
                    <Field label={t('目标人群')} error={fieldError('audience')}>
                      <textarea
                        disabled={editingDisabled}
                        rows={2}
                        maxLength={500}
                        value={draft.plan.audience}
                        onChange={(event) => patchPlan({ audience: event.target.value })}
                      />
                    </Field>
                    <Field label={t('视觉风格')} error={fieldError('visualStyle')}>
                      <textarea
                        disabled={editingDisabled}
                        rows={2}
                        maxLength={500}
                        value={draft.plan.visualStyle}
                        onChange={(event) => patchPlan({ visualStyle: event.target.value })}
                      />
                    </Field>
                    <Field label={t('配色（每行一种）')} error={fieldError('palette')}>
                      <textarea
                        disabled={editingDisabled}
                        rows={2}
                        value={draft.plan.palette.join('\n')}
                        onChange={(event) => patchPlan({ palette: event.target.value.split('\n') })}
                      />
                    </Field>
                    <Field
                      label={t('已确认的商品事实（每行一条）')}
                      error={fieldError('productFacts')}
                    >
                      <textarea
                        disabled={editingDisabled}
                        rows={3}
                        value={draft.plan.productFacts.join('\n')}
                        onChange={(event) =>
                          patchPlan({ productFacts: event.target.value.split('\n') })
                        }
                      />
                    </Field>
                    <Field label={t('各屏一致性要求')} error={fieldError('consistencyNotes')}>
                      <textarea
                        disabled={editingDisabled}
                        rows={3}
                        maxLength={500}
                        value={draft.plan.consistencyNotes}
                        onChange={(event) => patchPlan({ consistencyNotes: event.target.value })}
                      />
                    </Field>
                  </div>
                </details>
                <div className="detail-plan-workspace">
                  <nav className="detail-screen-index" aria-label={t('选择要编辑的分屏')}>
                    <div className="detail-index-heading">
                      <strong>{t('分屏目录')}</strong>
                      <span>
                        {approvedCount} / {draft.plan.screens.length} {t('已确认')}
                      </span>
                    </div>
                    {draft.plan.screens.map((screen, index) => {
                      const hasErrors = fieldIssues.some((issue) => issue.screenId === screen.id);
                      const approved = draft.confirmedScreens.includes(screen.id);
                      return (
                        <button
                          type="button"
                          key={screen.id}
                          aria-current={selected?.id === screen.id ? 'true' : undefined}
                          className={selected?.id === screen.id ? 'selected' : ''}
                          onClick={() => setSelectedScreen(screen.id)}
                        >
                          <span className="detail-index-thumbnail">
                            {String(index + 1).padStart(2, '0')}
                            <span style={{ aspectRatio: screen.ratio.replace(':', '/') }} />
                          </span>
                          <span>
                            <strong>{screen.title || t('未命名分屏')}</strong>
                            <small>
                              {t(hasErrors ? '需要补全内容' : approved ? '已确认' : '待确认')}
                            </small>
                          </span>
                          {approved && <CheckCircle2 size={16} />}
                        </button>
                      );
                    })}
                  </nav>
                  <div className="detail-screen-grid">
                    {draft.plan.screens.map((screen, index) => {
                      if (screen.id !== selected?.id) return null;
                      const expanded = true;
                      const approved = draft.confirmedScreens.includes(screen.id);
                      return (
                        <article
                          key={screen.id}
                          className={`detail-screen-card${expanded ? ' selected' : ''}${approved ? ' approved' : ''}`}
                        >
                          <button
                            className="detail-screen-select"
                            onClick={() => setSelectedScreen(screen.id)}
                            aria-expanded={expanded}
                          >
                            <span className="detail-screen-number">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span>
                              <strong>{screen.title || t('未命名分屏')}</strong>
                              <small>{screen.purpose || t('填写这一屏要传达的内容')}</small>
                            </span>
                            {approved ? (
                              <CheckCircle2 size={18} />
                            ) : (
                              <span className="detail-screen-ratio">{screen.ratio}</span>
                            )}
                          </button>
                          {expanded ? (
                            <div className="detail-screen-editor">
                              <Field label={t('分屏标题')} error={fieldError('title', screen.id)}>
                                <input
                                  disabled={editingDisabled}
                                  value={screen.title}
                                  maxLength={80}
                                  onChange={(event) =>
                                    patchScreen(screen.id, { title: event.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={t('这一屏的任务')}
                                error={fieldError('purpose', screen.id)}
                              >
                                <textarea
                                  disabled={editingDisabled}
                                  rows={2}
                                  value={screen.purpose}
                                  maxLength={300}
                                  onChange={(event) =>
                                    patchScreen(screen.id, { purpose: event.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={t('画面文案（每行一句，可留空）')}
                                error={fieldError('copy', screen.id)}
                              >
                                <textarea
                                  disabled={editingDisabled}
                                  rows={3}
                                  value={screen.copy.join('\n')}
                                  onChange={(event) =>
                                    patchScreen(screen.id, {
                                      copy: event.target.value
                                        ? event.target.value.split('\n')
                                        : [],
                                    })
                                  }
                                />
                              </Field>
                              <Field
                                label={t('画面与构图要求')}
                                error={fieldError('prompt', screen.id)}
                              >
                                <textarea
                                  disabled={editingDisabled}
                                  rows={4}
                                  maxLength={1000}
                                  value={screen.prompt}
                                  onChange={(event) =>
                                    patchScreen(screen.id, { prompt: event.target.value })
                                  }
                                />
                              </Field>
                              <div className="detail-screen-tools">
                                <select
                                  aria-label={t('单屏比例')}
                                  disabled={editingDisabled}
                                  value={screen.ratio}
                                  onChange={(event) =>
                                    patchScreen(screen.id, {
                                      ratio: event.target.value as DetailPageScreen['ratio'],
                                    })
                                  }
                                >
                                  {!supportedRatios.includes(screen.ratio) && (
                                    <option value={screen.ratio}>
                                      {screen.ratio}
                                      {t('（当前不支持，原值保留）')}
                                    </option>
                                  )}
                                  {supportedRatios.map((ratio) => (
                                    <option key={ratio}>{ratio}</option>
                                  ))}
                                </select>
                                <Button
                                  variant="ghost"
                                  disabled={editingDisabled || index === 0}
                                  aria-label={t('上移此屏')}
                                  onClick={() => moveScreen(index, -1)}
                                >
                                  <ArrowUp size={14} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  disabled={
                                    editingDisabled || index === draft.plan!.screens.length - 1
                                  }
                                  aria-label={t('下移此屏')}
                                  onClick={() => moveScreen(index, 1)}
                                >
                                  <ArrowDown size={14} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  disabled={editingDisabled || draft.plan!.screens.length <= 2}
                                  aria-label={t('删除此屏')}
                                  onClick={() =>
                                    patchPlan({
                                      screens: draft.plan!.screens.filter(
                                        (item) => item.id !== screen.id,
                                      ),
                                    })
                                  }
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="detail-screen-copy">
                              <p>{screen.copy.join(' · ') || t('以画面叙事为主，不添加文案')}</p>
                              <span>{screen.prompt}</span>
                            </div>
                          )}
                          <label className="detail-screen-confirm">
                            <input
                              type="checkbox"
                              checked={approved}
                              disabled={
                                editingDisabled || !detailPageScreenSchema.safeParse(screen).success
                              }
                              onChange={(event) =>
                                update({
                                  confirmedScreens: event.target.checked
                                    ? [...draft.confirmedScreens, screen.id]
                                    : draft.confirmedScreens.filter((id) => id !== screen.id),
                                })
                              }
                            />
                            <span>{t('已核对本屏内容')}</span>
                            {approved && <Check size={13} />}
                          </label>
                          <div className="detail-screen-navigation">
                            <Button
                              variant="ghost"
                              disabled={index === 0}
                              onClick={() => setSelectedScreen(draft.plan!.screens[index - 1]!.id)}
                            >
                              <ArrowLeft size={15} />
                              {t('上一屏')}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={
                                editingDisabled || !detailPageScreenSchema.safeParse(screen).success
                              }
                              onClick={() => {
                                update({
                                  confirmedScreens: [
                                    ...new Set([...draft.confirmedScreens, screen.id]),
                                  ],
                                });
                                if (index < draft.plan!.screens.length - 1)
                                  setSelectedScreen(draft.plan!.screens[index + 1]!.id);
                              }}
                            >
                              {t(
                                index < draft.plan!.screens.length - 1
                                  ? '确认本屏，下一屏'
                                  : '确认本屏',
                              )}
                              <Check size={15} />
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
                {draft.plan.screens.length < 10 && (
                  <Button
                    className="detail-add-screen"
                    variant="ghost"
                    disabled={editingDisabled}
                    onClick={() => {
                      const id = `screen_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
                      patchPlan({
                        screens: [
                          ...draft.plan!.screens,
                          { id, title: '', purpose: '', copy: [], prompt: '', ratio: draft.ratio },
                        ],
                      });
                      setSelectedScreen(id);
                    }}
                  >
                    <Plus size={15} />
                    {t('增加一屏')}
                  </Button>
                )}
                {!!fieldIssues.length && (
                  <div className="detail-validation-summary" role="alert">
                    <strong>{t('请修改以下内容后继续')}</strong>
                    {fieldIssues.map((issue, index) => (
                      <button
                        type="button"
                        key={`${issue.screenId ?? 'plan'}-${issue.field}-${index}`}
                        onClick={() => {
                          if (issue.screenId) setSelectedScreen(issue.screenId);
                          else setDirectionOpen(true);
                          showCenter();
                        }}
                      >
                        {issue.screenIndex === undefined
                          ? t('统一视觉方向')
                          : `${t('第')} ${issue.screenIndex + 1} ${t('屏')}`}{' '}
                        · {issue.label}：{issue.message}
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : displayedView === 'results' && generation ? (
              <>
                {generationQuery.error && (
                  <ErrorState error={generationQuery.error} retry={generationQuery.refetch} />
                )}
                <div className="detail-result-summary">
                  <span>
                    {t('已保存')} <strong>{savedCount}</strong> / {activePlan?.screens.length ?? 0}{' '}
                    {t('屏')}
                  </span>
                  <span>
                    {complete ? t('整套作品已就绪') : t('逐屏状态持续更新，成功作品自动呈现')}
                  </span>
                </div>
                <div className="detail-result-grid">
                  {(activePlan?.screens ?? []).map((screen, index) => {
                    const result = generationResult?.screens.find(
                      (row) => row.screenId === screen.id,
                    );
                    const asset = result?.outputAssets[0];
                    const presentation = result?.item
                      ? presentJob({
                          ...generation,
                          status: result.item?.status ?? '',
                          items: result.item ? [result.item] : [],
                        })
                      : null;
                    return (
                      <article className="detail-result-card" key={screen.id}>
                        <div className="detail-result-topline">
                          <span>
                            {String(index + 1).padStart(2, '0')} · {screen.title}
                          </span>
                          {result && (
                            <Badge
                              tone={
                                result.item?.status === 'succeeded'
                                  ? 'green'
                                  : result.item?.canResume
                                    ? 'orange'
                                    : 'neutral'
                              }
                            >
                              {presentation?.title}
                            </Badge>
                          )}
                        </div>
                        {asset ? (
                          <button
                            className="detail-result-image"
                            onClick={() => setPreview(asset)}
                            aria-label={`${t('预览')} ${screen.title}`}
                          >
                            <img
                              src={asset.previewUrl ?? asset.originalUrl}
                              alt={screen.title}
                              loading="lazy"
                            />
                          </button>
                        ) : (
                          <div
                            className={`detail-result-placeholder${result && ['queued', 'running'].includes(result.item?.status ?? '') ? ' processing' : ''}`}
                            style={{ aspectRatio: screen.ratio.replace(':', '/') }}
                          >
                            <FileImage size={28} strokeWidth={1.1} />
                            <strong>{presentation?.title ?? t('正在读取任务状态')}</strong>
                            <p>
                              {presentation?.description ?? t('任务已提交，逐屏结果将在这里显示。')}
                            </p>
                          </div>
                        )}
                        {result?.item?.errorMessage && (
                          <p className="detail-screen-error">{result.item.errorMessage}</p>
                        )}
                        <div className="detail-result-actions">
                          <span>{screen.ratio}</span>
                          {asset && (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                void action.run(
                                  () =>
                                    downloadFile(
                                      asset.originalUrl,
                                      `${String(index + 1).padStart(2, '0')}-${asset.name}`,
                                    ),
                                  '已下载原件',
                                )
                              }
                            >
                              <Download size={14} />
                              {t('下载此屏')}
                            </Button>
                          )}
                          {result?.item?.canResume && (
                            <Button
                              variant="secondary"
                              busy={action.busy}
                              disabled={!canEdit}
                              onClick={() =>
                                void action.run(async () => {
                                  await post(`/jobs/${result.jobId}/resume-result`);
                                  void refresh();
                                }, '已恢复原任务，不会重新生成')
                              }
                            >
                              <RefreshCw size={13} />
                              {t('恢复结果')}
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : focusedJobId || (displayedView === 'results' && selectedGenerationId) ? (
              generationQuery.error ? (
                <ErrorState error={generationQuery.error} retry={generationQuery.refetch} />
              ) : (
                <Loading label={t('正在读取此任务的分屏结果…')} />
              )
            ) : currentStep === 2 && draft.plan ? (
              <div className="detail-generation-review">
                <div className="detail-review-heading">
                  <LayoutTemplate size={24} />
                  <h3>{t('即将生成这一套详情页')}</h3>
                  <p>
                    {t('确认下方方案摘要和费用后开始。生成期间可以离开页面，结果会保存在项目中。')}
                  </p>
                </div>
                <div className="detail-review-screens">
                  {draft.plan.screens.map((screen, index) => (
                    <article key={screen.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <strong>{screen.title}</strong>
                        <p>{screen.copy.join(' · ') || screen.purpose}</p>
                      </div>
                      <Badge>{screen.ratio}</Badge>
                    </article>
                  ))}
                </div>
                <div className="detail-review-references">
                  <strong>{t('本次参考图')}</strong>
                  <div>
                    {references.map((asset) => (
                      <img
                        key={asset.id}
                        src={asset.previewUrl ?? asset.originalUrl}
                        alt={asset.name}
                      />
                    ))}
                  </div>
                </div>
                {generation && (
                  <Button variant="ghost" onClick={() => setView('results')}>
                    {t('查看上一次生成结果')}
                    <ArrowRight size={15} />
                  </Button>
                )}
              </div>
            ) : (
              <div className="detail-blank-canvas">
                <LayoutTemplate size={34} strokeWidth={1.4} />
                <h3>
                  {t(ongoing(planning) ? '正在把商品信息整理成方案' : '准备好商品信息后开始策划')}
                </h3>
                <p>
                  {t(
                    ongoing(planning)
                      ? '方案会包含每一屏的标题、文案和画面要求。完成后可以逐屏修改，确认之前不会生成图片。'
                      : '你的参考图和简报会保留。返回第一步补充信息，或重新发起策划。',
                  )}
                </p>
                {!ongoing(planning) && (
                  <Button variant="secondary" onClick={() => goToStep(0)}>
                    {t('返回准备商品')}
                    <ArrowRight size={16} />
                  </Button>
                )}
              </div>
            )}
          </section>
          <aside className="detail-delivery-panel" hidden={currentStep === 0}>
            <div className="detail-panel-heading">
              <span className="detail-eyebrow">
                {t(currentStep === 1 ? '确认后继续' : '本次交付')}
              </span>
              <h2>
                {t(
                  currentStep === 1
                    ? '检查你的方案'
                    : displayedView === 'results'
                      ? '作品与下载'
                      : '确认生成',
                )}
              </h2>
            </div>
            {currentStep === 1 && !focusedJobId && (
              <>
                <div className="detail-confirm-progress">
                  <strong>
                    {approvedCount}
                    <span> / {draft.plan?.screens.length ?? draft.screenCount}</span>
                  </strong>
                  <span>{t('屏已确认')}</span>
                  <progress
                    aria-label={t('分屏确认进度')}
                    value={approvedCount}
                    max={draft.plan?.screens.length ?? draft.screenCount}
                  />
                </div>
                <div className="detail-delivery-checklist">
                  <div>
                    <span className={referencesReady && references.length ? 'ready' : ''}>
                      {referencesReady && references.length ? <Check size={14} /> : '1'}
                    </span>
                    <p>
                      {t('商品参考图')}
                      <small>
                        {referencesReady && references.length
                          ? `${references.length} ${t('张已准备')}`
                          : t('请在第一步添加至少 1 张')}
                      </small>
                    </p>
                  </div>
                  <div>
                    <span className={!fieldIssues.length && draft.plan ? 'ready' : ''}>
                      {!fieldIssues.length && draft.plan ? <Check size={14} /> : '2'}
                    </span>
                    <p>
                      {t('方案内容')}
                      <small>
                        {fieldIssues.length
                          ? `${fieldIssues.length} ${t('项内容需要修改')}`
                          : t(draft.plan ? '必填内容已完整' : '等待策划完成')}
                      </small>
                    </p>
                  </div>
                </div>
                {draft.plan && (
                  <div className="detail-facts-confirm">
                    <DetailPageUnknowns unknowns={draft.plan.unknowns} expanded={true} />
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.factsConfirmed}
                        disabled={editingDisabled}
                        onChange={(event) => update({ factsConfirmed: event.target.checked })}
                      />
                      <span>{t('我已核对商品事实、文案和待确认信息，可用于本次生成。')}</span>
                    </label>
                  </div>
                )}
                {generationBlocker && (
                  <p className="detail-next-hint" role="status">
                    {generationBlocker}
                  </p>
                )}
                <Button
                  className="detail-next-button"
                  disabled={!readyToGenerate || editingDisabled}
                  onClick={() => {
                    setEditor((previous) => ({ ...previous, step: 2, resultMode: 'draft' }));
                    showCenter();
                  }}
                >
                  {t('继续，确认生成')}
                  <ArrowRight size={16} />
                </Button>
                <p className="detail-help">{t('下一步会展示整套费用，确认前不会生成图片。')}</p>
                <Button variant="ghost" onClick={() => goToStep(0)}>
                  <ArrowLeft size={15} />
                  {t('返回准备商品')}
                </Button>
                {generation && (
                  <Button variant="ghost" onClick={() => setView('results')}>
                    {t('查看已有生成结果')}
                    <ArrowRight size={15} />
                  </Button>
                )}
              </>
            )}
            {currentStep === 2 && displayedView === 'plan' && !focusedJobId && (
              <>
                <dl className="detail-generation-spec">
                  <div>
                    <dt>{t('页面数量')}</dt>
                    <dd>
                      {draft.plan?.screens.length ?? 0} {t('屏')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('商品参考图')}</dt>
                    <dd>
                      {references.length} {t('张')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('导出内容')}</dt>
                    <dd>{t('原图、长图与清单')}</dd>
                  </div>
                </dl>
                {generationBlocker && (
                  <p className="detail-next-hint" role="status">
                    {generationBlocker}
                  </p>
                )}
                <div className="detail-generate-submit">
                  <Field label={t('清晰度')}>
                    <select
                      value={draft.resolution ?? '2K'}
                      disabled={generating}
                      onChange={(event) =>
                        update({ resolution: event.target.value as DetailPageDraft['resolution'] })
                      }
                    >
                      {!imageCapability.model?.resolutions.includes(draft.resolution ?? '2K') && (
                        <option value={draft.resolution ?? '2K'}>
                          {draft.resolution ?? '2K'} · {t('请重新选择')}
                        </option>
                      )}
                      {imageCapability.model?.resolutions.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <ModelCapabilityStatus
                    capability={imageCapability}
                    selectionIssue={imageCapabilityIssue}
                  />
                  <JobSubmit
                    input={generationInput}
                    operation={imageOperation}
                    forceConfirmation
                    recoveryScope={`detail-page:generate:${draft.projectId ?? 'new'}`}
                    valid={
                      imageCapability.canGenerate &&
                      !imageCapabilityIssue &&
                      readyToGenerate &&
                      !generating &&
                      !ongoing(planning)
                    }
                    label={
                      complete
                        ? '确认新版报价（重新计费）'
                        : draft.plan
                          ? t('确认 {count} 屏报价').replace(
                              '{count}',
                              String(draft.plan.screens.length),
                            )
                          : '确认整套报价'
                    }
                    quoteFactory={async () => {
                      const plan = detailPagePlanSchema.parse(draft.plan);
                      const projectId = await ensureProject();
                      return post<PreparedQuote>('/detail-pages/quote', {
                        capabilityRevision: imageCapability.revision,
                        plan,
                        resolution: draft.resolution ?? '2K',
                        referenceAssetIds: draft.referenceAssetIds,
                        projectId,
                        ...(draft.adoptedPlanningJobId
                          ? { planningJobId: draft.adoptedPlanningJobId }
                          : {}),
                      });
                    }}
                    onCreated={(job) => {
                      setConfirmedGeneration(job);
                      update({
                        generationJobId: job.id,
                        projectId: job.projectId ?? draft.projectId,
                      });
                      setView('results');
                      showCenter();
                    }}
                  />
                  <p>
                    {t(
                      complete
                        ? '当前版本和作品会保留。新版将重新计费，只有最终确认后才开始生成。'
                        : '确认时展示整套费用和各屏任务。只有最终确认后才开始图片生成。',
                    )}
                  </p>
                </div>

                <Button variant="ghost" onClick={() => goToStep(1)}>
                  <ArrowLeft size={15} />
                  {t('返回修改方案')}
                </Button>
              </>
            )}
            {currentStep === 2 && displayedView === 'results' && generation && (
              <div className="detail-delivery-complete">
                {complete && (
                  <span className="detail-delivery-complete-icon">
                    <CheckCircle2 size={26} />
                  </span>
                )}
                <h3>{t(complete ? '整套详情页已就绪' : '正在收集逐屏结果')}</h3>
                <p>
                  {complete
                    ? t('全部原图与拼接长图已保存。')
                    : `${t('已保存')} ${savedCount} / ${activePlan?.screens.length ?? 0} ${t('屏，成功的图片可单独下载。')}`}
                </p>
                {downloadButton}
                <p className="detail-download-note">
                  {t('整套下载包含按顺序排列的原图、拼接长图与清单。全部保存后可下载。')}
                </p>
                <DetailPageUnknowns unknowns={activePlan?.unknowns ?? []} expanded={false} />
                <Button
                  variant="secondary"
                  disabled={!canEdit || generating}
                  onClick={startNewVersion}
                >
                  {t('继续编辑当前方案')}
                </Button>
                <small>{t('当前版本会保留，核对新版方案后再确认费用。')}</small>
              </div>
            )}
            {generation && currentStep === 2 && displayedView === 'results' && (
              <div className="detail-generation-status">
                <JobProgress job={generationDisplay!} />
                {!!resumableJobs.length && (
                  <Button
                    variant="secondary"
                    busy={action.busy}
                    disabled={!canEdit}
                    onClick={() =>
                      void action.run(async () => {
                        for (const id of resumableJobs) await post(`/jobs/${id}/resume-result`);
                        void refresh();
                      }, '已恢复原任务，不会重新生成')
                    }
                  >
                    <RefreshCw size={14} />
                    {t('恢复已有结果')}
                  </Button>
                )}
                {retryJobs.map((id) => (
                  <JobSubmit
                    key={id}
                    input={generation.input}
                    operation={imageOperation}
                    forceConfirmation
                    recoveryScope={`detail-page:retry:${id}`}
                    label="为未完成屏重新估价"
                    quoteFactory={async () => {
                      const original = await api<Job>(`/jobs/${id}`);
                      const quote = await post<Quote & { input?: JobInput }>(
                        `/jobs/${id}/retry-quote`,
                      );
                      return { input: quote.input ?? original.input, quote };
                    }}
                    onCreated={() => {
                      void refresh();
                      setView('results');
                    }}
                  />
                ))}
              </div>
            )}
            {historySets.length > 1 && (
              <Field label={t('历史生成版本')}>
                <select
                  value={selectedGenerationId ?? ''}
                  onChange={(event) => {
                    update({ generationJobId: event.target.value });
                    setConfirmedGeneration(null);
                    setView('results');
                    const target = historySets.find((job) => job.id === event.target.value);
                    if (target) navigate(jobDestination(target), { replace: true });
                  }}
                >
                  {historySets.map((job, index) => (
                    <option key={job.id} value={job.id}>
                      {t('版本')} {historySets.length - index} ·{' '}
                      {job.input.options.detailPagePlan?.productName}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {draft.projectId && (
              <Link className="detail-project-link" to={`/detail-pages/${draft.projectId}`}>
                {t('打开此详情页项目')}
                <ArrowRight size={14} />
              </Link>
            )}
          </aside>
        </div>
      )}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name ?? t('作品预览')}
        wide
      >
        {preview && (
          <img className="detail-original-preview" src={preview.originalUrl} alt={preview.name} />
        )}
      </Modal>
      <Confirm
        open={resetOpen}
        title={t('开始一套新的详情页？')}
        description={t('当前项目与已提交任务会保留。新的创作将使用独立草稿。')}
        onClose={() => setResetOpen(false)}
        onConfirm={() => {
          localStorage.setItem(
            detailPageDraftKey(session!.user.id, workspace!.id),
            JSON.stringify(emptyDetailPageDraft()),
          );
          setResetOpen(false);
          if (routeProjectId) navigate('/detail-pages');
          else {
            setDraft(emptyDetailPageDraft());
            setConfirmedPlanning(null);
            setConfirmedGeneration(null);
            projectCreation.current = null;
            setEditor(defaultDetailPageEditor(emptyDetailPageDraft()));
          }
        }}
      />
    </div>
  );
}

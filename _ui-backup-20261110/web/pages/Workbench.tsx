import { t } from '../lib/i18n';
import { CreationLanding } from '../components/CreationLanding';
import '../styles/creative-studio.css';
import '../styles/workflow-studio.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useBlocker, useLocation } from 'react-router-dom';
import { ArrowDown, ArrowLeft, Check, History, Layers, Save, Share2, Sparkles } from 'lucide-react';
import type { AssetDto, ProjectDto } from '../../contracts/core';
import type { PendingApplyDto, JobInput } from '../../contracts/jobs';
import { getSceneAssetIds, type SceneDocumentV1 } from '../../contracts/scene';
import {
  api,
  ApiError,
  dateTime,
  patch,
  remove,
  post,
  uploadAsset,
  useApi,
  useRefresh,
  type Page,
} from '../lib/api';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Badge,
  Loading,
  Modal,
  Notice,
  Pagination,
  Segments,
  useAction,
} from '../components/ui';
import { Composer, type ComposerController } from '../components/Composer';
import { JobCard } from '../components/TaskCenter';
import type { Job } from '../lib/tasks';
import { mergeJobSnapshots } from '../lib/job-presentation';
import { CanvasEditor } from '../editor/CanvasEditor';
import type { ExportPolicy } from '../../contracts/export-policy';
import { useStudio } from '../context';
import { latestMediaDraftRecord, type CreationDraft } from '../lib/creation-recovery';
import { jobDestination } from '../lib/job-navigation';
import { selectMatchingJobSnapshot } from '../lib/job-snapshot';
interface DocumentDto {
  id: string;
  projectId: string;
  name: string;
  revision: number;
  scene: SceneDocumentV1;
  updatedAt: string;
}
interface Version {
  id: string;
  revision: number;
  reason: string;
  createdAt: string;
}
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  jobId: string | null;
  createdAt: string;
  metadata?: { draft?: JobInput; creationWarnings?: string[] };
}
export function Workbench() {
  const { projectId } = useParams();
  if (!projectId) return <CreationLanding />;
  return <ProjectWorkbench key={projectId} projectId={projectId} />;
}
function ProjectWorkbench({ projectId }: { projectId: string }) {
  const { canEdit, workspace, registerWorkspaceGuard } = useStudio();
  const location = useLocation();
  const routeState = location.state as {
    submittedJob?: Job;
    recoveryDraft?: Pick<CreationDraft, 'input' | 'drafts' | 'warnings' | 'modelDefaultsPending'>;
    notice?: string;
  } | null;
  const focusedJobId = new URLSearchParams(location.search).get('job');
  const focusedQuery = useApi<Job>(
    `/jobs/${encodeURIComponent(focusedJobId ?? '')}`,
    !!focusedJobId,
    3000,
  );
  const [submittedJob, setSubmittedJob] = useState<Job | null>(() => {
    const candidate = (location.state as { submittedJob?: Job } | null)?.submittedJob;
    return candidate?.projectId === projectId && candidate.workspaceId === workspace?.id
      ? candidate
      : null;
  });
  const resultsRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<HTMLDivElement>(null);
  const query = useApi<ProjectDto>(`/projects/${projectId}`);
  const documentQuery = useApi<DocumentDto>(`/projects/${projectId}/document`);
  const exportPolicy = useApi<ExportPolicy>('/export-policy');
  const assets = useApi<Page<AssetDto>>('/assets?pageSize=100');
  const [jobPage, setJobPage] = useState(1);
  const jobs = useApi<Page<Job>>(
    `/jobs?projectId=${projectId}&pageSize=12&page=${jobPage}`,
    true,
    3000,
  );
  const projectJobs = (jobs.data?.items ?? []).filter((job) => job.projectId === projectId);
  const focusedJob = selectMatchingJobSnapshot(
    { id: focusedJobId, projectId, workspaceId: workspace?.id },
    focusedQuery.data,
    submittedJob,
  );
  const visibleJobs = mergeJobSnapshots(
    projectJobs.filter((job) => job.id !== focusedJob?.id),
    jobPage === 1 && submittedJob ? [submittedJob] : [],
  )
    .filter((job) => job.id !== focusedJob?.id)
    .sort((a, b) => {
      const active = (job: Job) =>
        ['queued', 'running', 'reconciliation_required'].includes(job.status) ? 1 : 0;
      return active(b) - active(a) || b.createdAt.localeCompare(a.createdAt);
    });
  useEffect(() => {
    if (
      submittedJob &&
      jobs.data?.items.some(
        (job) =>
          job.id === submittedJob.id &&
          job.updatedAt >= submittedJob.updatedAt &&
          job.status === submittedJob.status,
      )
    )
      setSubmittedJob(null);
    else if (
      submittedJob &&
      jobs.data?.items.some(
        (job) => job.id === submittedJob.id && job.updatedAt > submittedJob.updatedAt,
      )
    )
      setSubmittedJob(null);
  }, [jobs.data, submittedJob]);
  useEffect(() => {
    if (!focusedJob || query.isLoading || documentQuery.isLoading) return;
    const frame = requestAnimationFrame(() =>
      focusedRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusedJob?.id, query.isLoading, documentQuery.isLoading]);
  const [conversationPage, setConversationPage] = useState(1);
  const historyMessages = useApi<Page<Message>>(
    `/projects/${projectId}/messages?pageSize=100&page=${conversationPage}`,
    conversationPage > 1,
  );
  const messages = useApi<Page<Message>>(`/projects/${projectId}/messages?pageSize=100`);
  const [draftSearch, setDraftSearch] = useState<{
    status: 'loading' | 'ready' | 'limited' | 'error';
    draft?: JobInput;
    warnings?: string[];
    nextPage: number;
    error?: string;
  }>({ status: 'loading', nextPage: 2 });
  const composerRef = useRef<ComposerController>(null);
  function focusCreation() {
    setSidebarTab('create');
    requestAnimationFrame(() => composerRef.current?.focusPrompt());
  }
  const [draftSearchRound, setDraftSearchRound] = useState(0);
  const [scene, setScene] = useState<SceneDocumentV1 | null>(null);
  const [workspaceChangePending, setWorkspaceChangePending] = useState(false);
  const workspaceChangeResolver = useRef<((allow: boolean) => void) | null>(null);
  function resolveWorkspaceChange(allow: boolean) {
    workspaceChangeResolver.current?.(allow);
    workspaceChangeResolver.current = null;
    setWorkspaceChangePending(false);
  }
  useEffect(
    () =>
      registerWorkspaceGuard(async () => {
        if (!dirtyRef.current) return true;
        return new Promise<boolean>((resolve) => {
          workspaceChangeResolver.current = resolve;
          setWorkspaceChangePending(true);
        });
      }),
    [registerWorkspaceGuard],
  );
  useEffect(
    () => () => {
      workspaceChangeResolver.current?.(false);
    },
    [],
  );
  const [sceneAssets, setSceneAssets] = useState<AssetDto[]>([]);
  const [sceneAssetError, setSceneAssetError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'create' | 'history'>('create');
  const [mainView, setMainView] = useState<'results' | 'canvas'>('results');
  useEffect(() => {
    if (focusedJobId) setMainView('results');
  }, [focusedJobId]);
  const [canvasOpened, setCanvasOpened] = useState(false);
  const [canvasFocus, setCanvasFocus] = useState(true);
  function showCanvas() {
    setCanvasOpened(true);
    setMainView('canvas');
  }
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [allowOriginalDownload, setAllowOriginalDownload] = useState(false);
  const [restoring, setRestoring] = useState<Version | null>(null);
  const [applyItem, setApplyItem] = useState<PendingApplyDto | null>(null);
  const [applyMode, setApplyMode] = useState('new-layer');
  const [draftRecovery, setDraftRecovery] = useState(false);
  const latestScene = useRef(scene);
  const revisionRef = useRef(revision);
  const dirtyRef = useRef(dirty);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const action = useAction();
  const refresh = useRefresh();
  const navigate = useNavigate();
  useEffect(() => {
    const routeState = location.state as {
      submittedJob?: Job;
      recoveryDraft?: Pick<CreationDraft, 'input' | 'drafts' | 'warnings' | 'modelDefaultsPending'>;
    } | null;
    // Let the composer persist a recovery handoff first. Two replace navigations
    // in the same effect flush could otherwise restore its already-cleared draft.
    if (routeState?.submittedJob && !routeState.recoveryDraft)
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: { ...routeState, submittedJob: undefined },
      });
  }, [navigate, location.pathname, location.search, location.state]);
  const documentId = documentQuery.data?.id;
  const pending = useApi<Page<PendingApplyDto>>(
    `/pending-applies?documentId=${documentId ?? ''}`,
    !!documentId,
    5000,
  );
  const versions = useApi<Page<Version>>(
    `/documents/${documentId ?? ''}/versions`,
    versionsOpen && !!documentId,
  );
  const shares = useApi<
    Page<{
      id: string;
      createdAt: string;
      expiresAt: string;
      revokedAt: string | null;
      allowOriginalDownload: boolean;
    }>
  >(`/projects/${projectId}/shares`, shareOpen);
  const newestDraft = messages.data?.items
    .filter((m) => m.metadata?.draft)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.metadata?.draft;
  useEffect(() => {
    if (!messages.data) return;
    const controller = new AbortController();
    const current = latestMediaDraftRecord(messages.data.items);
    if (current) {
      setDraftSearch({
        status: 'ready',
        draft: current.metadata?.draft,
        warnings: current.metadata?.creationWarnings,
        nextPage: 2,
      });
      return;
    }
    const totalPages = Math.ceil(messages.data.total / messages.data.pageSize);
    const firstPage = draftSearch.nextPage;
    setDraftSearch((previous) => ({ ...previous, status: 'loading', error: undefined }));
    void (async () => {
      try {
        // Bound each automatic scan; the user can explicitly request the next group.
        for (let page = firstPage; page <= Math.min(firstPage + 3, totalPages); page++) {
          const data = await api<Page<Message>>(
            `/projects/${projectId}/messages?pageSize=100&page=${page}`,
            { signal: controller.signal },
            workspace!.id,
          );
          if (controller.signal.aborted) return;
          const draft = latestMediaDraftRecord(data.items);
          if (draft) {
            setDraftSearch({
              status: 'ready',
              draft: draft.metadata?.draft,
              warnings: draft.metadata?.creationWarnings,
              nextPage: page + 1,
            });
            return;
          }
        }
        if (!controller.signal.aborted)
          setDraftSearch({
            status: firstPage + 4 <= totalPages ? 'limited' : 'ready',
            nextPage: firstPage + 4,
          });
      } catch (error) {
        if (!controller.signal.aborted)
          setDraftSearch((previous) => ({
            ...previous,
            status: 'error',
            error: error instanceof Error ? error.message : '历史草稿读取失败',
          }));
      }
    })();
    return () => controller.abort();
  }, [!!messages.data, draftSearchRound, projectId, workspace?.id]);
  const mediaDraft = draftSearch.draft;
  useEffect(() => {
    let cancelled = false;
    const ids = scene ? getSceneAssetIds(scene) : [];
    void Promise.allSettled(
      ids.map((id) => api<AssetDto>(`/assets/${id}`, {}, workspace?.id ?? null)),
    ).then((results) => {
      if (cancelled) return;
      setSceneAssets(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      );
      setSceneAssetError(
        results.some((result) => result.status === 'rejected')
          ? '部分画布素材无法访问。请在素材库恢复原件，或检查工作空间权限。'
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [scene ? getSceneAssetIds(scene).join(',') : '', workspace?.id]);
  useEffect(() => {
    latestScene.current = scene;
    dirtyRef.current = dirty;
    revisionRef.current = revision;
  }, [scene, dirty, revision]);
  useEffect(() => {
    const incoming = documentQuery.data;
    if (!incoming) return;
    if (!latestScene.current) {
      setScene(incoming.scene);
      setRevision(incoming.revision);
    } else if (incoming.revision > revisionRef.current && !dirtyRef.current && !saving) {
      setScene(incoming.scene);
      setRevision(incoming.revision);
    }
  }, [documentQuery.data, saving]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const save = useCallback(async () => {
    if (!documentId || !latestScene.current || saving || !canEdit || conflict) return;
    setSaving(true);
    setError(null);
    const snapshot = latestScene.current;
    try {
      const saved = await patch<DocumentDto>(`/documents/${documentId}`, {
        expectedRevision: revisionRef.current,
        scene: snapshot,
      });
      setRevision(saved.revision);
      revisionRef.current = saved.revision;
      if (latestScene.current === snapshot) {
        setDirty(false);
        dirtyRef.current = false;
      }
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REVISION_CONFLICT') setConflict(true);
      else setError(err instanceof Error ? err.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }, [documentId, saving, canEdit, conflict]);
  useEffect(() => {
    if (!dirty || conflict || !canEdit) return;
    const timer = setTimeout(() => void save(), 1800);
    return () => clearTimeout(timer);
  }, [scene, dirty, conflict, save, canEdit]);
  useEffect(() => {
    if (blocker.state === 'blocked' && !dirty && !saving) blocker.proceed();
    if (workspaceChangePending && !dirty && !saving) resolveWorkspaceChange(true);
  }, [blocker, dirty, saving, workspaceChangePending]);
  async function upload(file: File) {
    const asset = await uploadAsset<AssetDto>(file, projectId);
    await refresh();
    return asset;
  }
  async function duplicate() {
    await action.run(async () => {
      if (!scene) throw new Error(t('画布还未准备好'));
      const created = await post<ProjectDto>('/projects', {
        name: `${query.data?.name ?? '创作'} · 草稿副本`,
        kind: query.data?.kind ?? 'image',
        description: query.data?.description ?? '',
      });
      const doc = await api<DocumentDto>(`/projects/${created.id}/document`);
      await patch(`/documents/${doc.id}`, { expectedRevision: doc.revision, scene });
      setDirty(false);
      navigate(`/workbench/${created.id}`);
    }, '草稿已另存');
  }
  if (query.isLoading || documentQuery.isLoading)
    return (
      <div className="workbench creation-experience">
        <Loading label={t('正在打开项目…')} />
        {submittedJob && <JobCard job={submittedJob} />}
      </div>
    );
  const initialError =
    (!query.data ? query.error : null) ?? (!documentQuery.data ? documentQuery.error : null);
  if (initialError)
    return (
      <ErrorState
        error={initialError}
        retry={() => {
          void query.refetch();
          void documentQuery.refetch();
        }}
      />
    );
  return (
    <div className="workbench workflow-studio">
      <header className="workbench-heading">
        <div>
          <Link to="/projects" className="icon-button" aria-label={t('返回项目')}>
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 title={query.data?.name}>{query.data?.name}</h1>
            <span className={error ? 'field-error' : 'muted'}>
              {saving
                ? t('正在保存…')
                : (error ??
                  (dirty
                    ? t('画布有未保存的修改')
                    : mainView === 'canvas'
                      ? t('画布已保存 · 版本 {revision}').replace('{revision}', String(revision))
                      : t('创作记录与结果保存在此项目')))}
            </span>
          </div>
        </div>
        <div className="inline-actions">
          <Link className="button secondary" to="/tasks">
            {t('全部任务')}
          </Link>
          {mainView === 'canvas' && (
            <>
              <Button variant="ghost" onClick={() => setVersionsOpen(true)}>
                <History size={16} />
                <span>{t('版本')}</span>
              </Button>
              <Button variant="ghost" onClick={() => setShareOpen(true)}>
                <Share2 size={16} />
                <span>{t('分享')}</span>
              </Button>
              {canEdit && (
                <Button
                  variant="secondary"
                  onClick={() => void save()}
                  busy={saving}
                  disabled={!dirty || conflict}
                >
                  <Save size={16} />
                  {t('保存')}
                </Button>
              )}
            </>
          )}
        </div>
      </header>
      {(query.error || documentQuery.error) && (
        <ErrorState
          error={query.error ?? documentQuery.error}
          retry={() => {
            void query.refetch();
            void documentQuery.refetch();
          }}
        />
      )}
      {routeState?.notice && <Notice tone="warning">{routeState.notice}</Notice>}
      {focusedJob && (
        <div className="workflow-receipt" role="status">
          <Check size={15} aria-hidden="true" />
          <span>{t('创作已记录，离开后也能在任务中找回。')}</span>
        </div>
      )}
      <Button
        className="workbench-results-shortcut"
        variant="secondary"
        onClick={() => {
          setMainView('results');
          requestAnimationFrame(() =>
            resultsRef.current?.scrollIntoView({
              block: 'start',
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
            }),
          );
        }}
      >
        <ArrowDown size={15} />
        {t('查看作品与进度')}
      </Button>
      {conflict && (
        <Notice tone="warning">
          {t('画布已有新版本。当前草稿完整保留，请另存副本，或确认放弃当前修改后重新加载。')}
          <div className="inline-actions">
            <Button variant="secondary" onClick={() => void duplicate()} busy={action.busy}>
              {t('另存草稿')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraftRecovery(true);
              }}
            >
              {t('重新加载…')}
            </Button>
          </div>
        </Notice>
      )}
      <div
        className={`workbench-body${mainView === 'canvas' && canvasFocus ? ' canvas-focused' : ''}`}
      >
        <aside
          className="creation-sidebar"
          id="project-creation-sidebar"
          hidden={mainView === 'canvas' && canvasFocus}
        >
          <div className="workflow-editor-heading">
            <h2>{t('继续创作')}</h2>
            <Button
              variant="ghost"
              aria-expanded={sidebarTab === 'history'}
              aria-controls="project-conversation"
              onClick={() => setSidebarTab(sidebarTab === 'history' ? 'create' : 'history')}
            >
              <History size={14} />
              {t(sidebarTab === 'history' ? '返回创作' : '创作会话')}
            </Button>
          </div>
          <div hidden={sidebarTab !== 'create'}>
            <>
              {newestDraft &&
                !['image.generate', 'video.generate', 'text.assist'].includes(
                  newestDraft.operation,
                ) && (
                  <Notice>
                    <p>{t('此项目包含已保存的工具参数与素材。')}</p>
                    <Link
                      className="text-button"
                      to={`${newestDraft.operation === 'video.motion-replica' ? '/tools/video-replica' : `${newestDraft.operation.includes('.') && !newestDraft.operation.startsWith('local.') ? '/advanced' : '/tools'}/${newestDraft.operation}`}?projectId=${projectId}`}
                    >
                      {t('继续编辑工具草稿 ↗')}
                    </Link>
                  </Notice>
                )}
              {messages.error && messages.data && (
                <ErrorState error={messages.error} retry={messages.refetch} />
              )}
              {messages.error && !messages.data ? (
                <ErrorState error={messages.error} retry={messages.refetch} />
              ) : messages.isLoading || draftSearch.status === 'loading' ? (
                <Loading label={t('正在恢复创作草稿…')} />
              ) : draftSearch.status === 'limited' || draftSearch.status === 'error' ? (
                <Notice tone="warning">
                  <p>
                    {draftSearch.error ??
                      t('近期会话中没有媒体草稿。可继续查找更早记录，或从项目描述开始。')}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => setDraftSearchRound((round) => round + 1)}
                  >
                    {t('继续查找历史草稿')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDraftSearch((previous) => ({ ...previous, status: 'ready' }))}
                  >
                    {t('从项目描述开始')}
                  </Button>
                </Notice>
              ) : (
                <Composer
                  key={projectId}
                  initialPrompt={mediaDraft?.prompt ?? query.data?.description ?? ''}
                  initialKind={query.data?.kind === 'video' ? 'video' : 'image'}
                  initialDraft={mediaDraft}
                  initialRecovery={routeState?.recoveryDraft}
                  onRecoveryPersisted={() => {
                    navigate(`${location.pathname}${location.search}`, {
                      replace: true,
                      state: { ...routeState, recoveryDraft: undefined, notice: undefined },
                    });
                  }}
                  initialWarnings={draftSearch.warnings}
                  controllerRef={composerRef}
                  projectId={projectId}
                  documentId={documentId}
                  revision={revision}
                  compact
                  visualVariant="studio"
                  onCreated={(created) => {
                    setSubmittedJob(created);
                    setJobPage(1);
                    setMainView('results');
                    navigate(jobDestination(created), { replace: true });
                    void refresh().catch(() => undefined);
                  }}
                />
              )}
            </>
          </div>
          <div
            className="conversation-list"
            id="project-conversation"
            hidden={sidebarTab !== 'history'}
            style={sidebarTab !== 'history' ? { display: 'none' } : undefined}
          >
            {(conversationPage === 1 ? messages.data : historyMessages.data)?.items.map(
              (message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <span>
                    {message.role === 'user'
                      ? t('你')
                      : message.role === 'assistant'
                        ? t('创作助手')
                        : t('工作空间')}
                  </span>
                  <p>{message.content}</p>
                  <small>{dateTime(message.createdAt)}</small>
                </article>
              ),
            )}
            {messages.data && (
              <Pagination
                page={conversationPage}
                total={messages.data.total}
                pageSize={messages.data.pageSize}
                onPage={setConversationPage}
              />
            )}
            {!messages.data?.items.length && (
              <Empty
                title={t('开始第一轮创作')}
                description={t('你的创作需求和结果将保存在会话中。')}
              />
            )}
          </div>
        </aside>
        <section className="project-stage" aria-label={t('项目作品与编辑')}>
          <div className="project-stage-heading">
            <div>
              <h2>{t('作品与进度')}</h2>
            </div>
            <div className="project-stage-actions">
              {mainView === 'canvas' && (
                <Button
                  variant="ghost"
                  aria-controls="project-creation-sidebar"
                  aria-expanded={!canvasFocus}
                  onClick={() => setCanvasFocus(!canvasFocus)}
                >
                  {t(canvasFocus ? '展开创作区' : '收起创作区')}
                </Button>
              )}
              <Segments
                value={mainView}
                onChange={(view) => (view === 'canvas' ? showCanvas() : setMainView(view))}
                options={[
                  { value: 'results', label: '作品与任务' },
                  { value: 'canvas', label: '画布编辑' },
                ]}
              />
            </div>
          </div>
          {sceneAssetError && <Notice tone="warning">{sceneAssetError}</Notice>}
          {mainView === 'canvas' &&
            pending.data?.items
              .filter((item) => item.status === 'pending')
              .map((item) => (
                <div className="pending-result" key={item.id}>
                  <span>
                    <Sparkles size={16} />
                    {item.outputKind === 'layers'
                      ? `${item.assetIds.length} 个图层等待应用`
                      : t('有一个新结果等待应用')}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setApplyItem(item);
                      setApplyMode('new-layer');
                    }}
                  >
                    {t('预览并添加到画布')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void action.run(async () => {
                        await post(`/pending-applies/${item.id}/dismiss`);
                        await refresh();
                      }, '已放弃应用，结果仍保留在素材库')
                    }
                  >
                    {t('放弃')}
                  </Button>
                </div>
              ))}
          <div className="project-results" ref={resultsRef} hidden={mainView !== 'results'}>
            {projectJobs.some(
              (job) =>
                job.input.options.detailPagePlan ||
                job.input.options.assistantMode === 'detail-page',
            ) && (
              <Link
                className="detail-studio-entry"
                to={jobDestination(
                  projectJobs.find((job) => !!job.input.options.detailPagePlan) ??
                    projectJobs.find((job) => job.input.options.assistantMode === 'detail-page')!,
                )}
              >
                <Layers size={22} />
                <div>
                  <strong>{t('查看整套商品详情页')}</strong>
                  <p>{t('进入专用工作室查看分屏结果、历史版本与整套下载。')}</p>
                </div>
                <span>↗</span>
              </Link>
            )}
            {focusedJobId && (
              <div className="focused-task" ref={focusedRef} aria-label={t('当前查看的任务')}>
                <div className="focused-task-heading">
                  <span>{t('本次创作')}</span>
                  <Link to={`/workbench/${projectId}`} className="text-button">
                    {t('查看项目全部任务')}
                  </Link>
                </div>
                {focusedQuery.isLoading && !focusedJob && (
                  <Loading label={t('正在读取指定任务…')} />
                )}
                {focusedQuery.error && !focusedJob && (
                  <ErrorState error={focusedQuery.error} retry={focusedQuery.refetch} />
                )}
                {focusedQuery.data && focusedQuery.data.projectId !== projectId && (
                  <Notice tone="warning">
                    {t('该任务不属于当前项目。')}{' '}
                    <Link to={jobDestination(focusedQuery.data)}>{t('打开对应任务')}</Link>
                  </Notice>
                )}
                {focusedJob && (
                  <JobCard
                    job={focusedJob}
                    onJobCreated={(created) => {
                      setSubmittedJob(created);
                      navigate(jobDestination(created), { replace: true });
                    }}
                    onAcceptAsset={
                      canEdit
                        ? (asset) => {
                            if (!composerRef.current)
                              throw new Error(t('创作草稿尚未恢复，请先完成恢复。'));
                            composerRef.current.addReference(asset);
                            focusCreation();
                          }
                        : undefined
                    }
                    onAcceptPlan={
                      canEdit
                        ? (plan, index) => {
                            if (!composerRef.current)
                              throw new Error(t('创作草稿尚未恢复，请先完成恢复。'));
                            composerRef.current.applyPlan(plan, index);
                            focusCreation();
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            )}
            {jobs.isLoading && !submittedJob && <Loading label={t('正在读取项目任务…')} />}
            {jobs.error && <ErrorState error={jobs.error} retry={jobs.refetch} />}
            {!visibleJobs.length && !focusedJobId && !jobs.isLoading && (
              <Empty
                title={t('第一件作品，从这里开始')}
                description={t(
                  '选择素材、写下需求并确认费用。任务提交后会在这里持续更新；离开或刷新仍可找回。',
                )}
                action={
                  <Button variant="secondary" onClick={showCanvas}>
                    {t('先从空白画布编辑')}
                  </Button>
                }
              />
            )}
            <div className="project-result-grid">
              {visibleJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onJobCreated={(created) => {
                    setSubmittedJob(created);
                    setJobPage(1);
                    navigate(jobDestination(created), { replace: true });
                  }}
                  onAcceptAsset={
                    canEdit
                      ? (asset) => {
                          if (!composerRef.current)
                            throw new Error(t('创作草稿尚未恢复，请先完成恢复。'));
                          composerRef.current.addReference(asset);
                          focusCreation();
                        }
                      : undefined
                  }
                  onAcceptPlan={
                    canEdit
                      ? (plan, index) => {
                          if (!composerRef.current)
                            throw new Error(t('创作草稿尚未恢复，请先在创作区完成恢复。'));
                          composerRef.current.applyPlan(plan, index);
                          focusCreation();
                        }
                      : undefined
                  }
                />
              ))}
            </div>
            {jobs.data && (
              <Pagination
                page={jobPage}
                total={jobs.data.total}
                pageSize={jobs.data.pageSize}
                onPage={setJobPage}
              />
            )}
          </div>
          <div className="canvas-host" hidden={mainView !== 'canvas'}>
            {scene && canvasOpened && (
              <CanvasEditor
                scene={scene}
                exportPolicy={exportPolicy.data}
                resolveExportPolicy={() =>
                  api<ExportPolicy>('/export-policy', {}, workspace?.id ?? null)
                }
                exportMetadata={{
                  documentId,
                  revision,
                  sourceJobs: jobs.data?.items.map((job) => ({
                    id: job.id,
                    operation: job.operation,
                    providerId: job.providerId,
                    parameters: job.input,
                  })),
                }}
                onChange={(next) => {
                  setScene(next);
                  setDirty(true);
                }}
                assets={[
                  ...new Map(
                    [...(assets.data?.items ?? []), ...sceneAssets].map((asset) => [
                      asset.id,
                      asset,
                    ]),
                  ).values(),
                ]}
                onUpload={upload}
                readOnly={!canEdit}
              />
            )}
          </div>
        </section>
      </div>
      <Modal
        open={blocker.state === 'blocked' || workspaceChangePending}
        onClose={() => {
          if (blocker.state === 'blocked') blocker.reset();
          resolveWorkspaceChange(false);
        }}
        title={t('保存后再离开？')}
        description={t('画布有尚未保存的修改，可以保存后继续，或保留当前页面。')}
      >
        {error && <Notice tone="warning">{error}</Notice>}
        <div className="modal-actions">
          <Button
            variant="ghost"
            onClick={() => {
              if (blocker.state === 'blocked') blocker.proceed();
              resolveWorkspaceChange(true);
            }}
          >
            {t('放弃修改并离开')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (blocker.state === 'blocked') blocker.reset();
              resolveWorkspaceChange(false);
            }}
          >
            {t('继续编辑')}
          </Button>
          <Button
            busy={saving}
            disabled={conflict}
            onClick={() =>
              void (async () => {
                await save();
                if (!dirtyRef.current && blocker.state === 'blocked') blocker.proceed();
                if (!dirtyRef.current) resolveWorkspaceChange(true);
              })()
            }
          >
            {t('保存并离开')}
          </Button>
        </div>
      </Modal>
      <Modal
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        title={t('版本历史')}
        description={t('恢复会创建一个新版本，不会覆盖旧记录。')}
      >
        {versions.isLoading ? (
          <Loading />
        ) : versions.error ? (
          <ErrorState error={versions.error} />
        ) : (
          versions.data?.items.map((version) => (
            <div className="version-row" key={version.id}>
              <div>
                <strong>
                  {t('版本')}
                  {version.revision}
                </strong>
                <p>
                  {dateTime(version.createdAt)} ·{' '}
                  {t(
                    { create: '创建', save: '保存', restore: '恢复', 'job-apply': '应用结果' }[
                      version.reason
                    ] ?? version.reason,
                  )}
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={!canEdit || version.revision === revision}
                onClick={() => setRestoring(version)}
              >
                {t('恢复')}
              </Button>
            </div>
          ))
        )}
      </Modal>
      <Modal
        open={!!restoring}
        onClose={() => setRestoring(null)}
        title={t('恢复这个版本？')}
        description={t('当前未保存的修改将被替换。建议先保存或另存草稿。')}
      >
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setRestoring(null)}>
            {t('取消')}
          </Button>
          <Button
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                if (!restoring || !documentId) return;
                const doc = await post<DocumentDto>(`/documents/${documentId}/restore`, {
                  targetRevision: restoring.revision,
                  expectedRevision: revision,
                });
                setScene(doc.scene);
                setRevision(doc.revision);
                setDirty(false);
                setRestoring(null);
                setVersionsOpen(false);
                await refresh();
              }, '版本已恢复')
            }
          >
            {t('确认恢复')}
          </Button>
        </div>
      </Modal>
      <Modal
        open={draftRecovery}
        onClose={() => setDraftRecovery(false)}
        title={t('放弃当前修改并重新加载？')}
        description={t('未保存的本地修改将丢失。可取消并先另存草稿。')}
      >
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setDraftRecovery(false)}>
            {t('保留草稿')}
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              void action.run(async () => {
                const doc = await api<DocumentDto>(`/documents/${documentId}`);
                setScene(doc.scene);
                setRevision(doc.revision);
                setDirty(false);
                setConflict(false);
                setDraftRecovery(false);
              })
            }
          >
            {t('放弃并重新加载')}
          </Button>
        </div>
      </Modal>
      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={t('分享项目')}
        description={t('仅分享明确授权的画布与引用素材。')}
      >
        {shareUrl ? (
          <>
            <Field label={t('分享链接')}>
              <input readOnly value={shareUrl} />
            </Field>
            <Button
              onClick={() =>
                void action.run(() => navigator.clipboard.writeText(shareUrl), '链接已复制')
              }
            >
              {t('复制链接')}
            </Button>
          </>
        ) : (
          <>
            <Notice>
              {t('生成可撤销的只读链接。分享前，请确认项目中引用的素材适合对外展示。')}{' '}
              {t('关闭原件下载不会阻止截图或保存预览。')}
            </Notice>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allowOriginalDownload}
                onChange={(e) => setAllowOriginalDownload(e.target.checked)}
              />
              {t('允许下载原件')}
            </label>
            <div className="modal-actions">
              <Button
                disabled={!canEdit}
                busy={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const share = await post<{ url: string; shareUrl?: string }>('/shares', {
                      projectId,
                      expiresInDays: 7,
                      allowOriginalDownload,
                    });
                    setShareUrl(share.shareUrl ?? share.url);
                    await shares.refetch();
                  }, '分享链接已创建')
                }
              >
                {t('创建 7 天分享链接')}
              </Button>
            </div>
          </>
        )}
        <section className="section-spaced">
          <h3>{t('已创建的分享')}</h3>
          {shares.error ? (
            <ErrorState error={shares.error} retry={shares.refetch} />
          ) : shares.data?.items.length ? (
            shares.data.items.map((item) => (
              <div className="search-result" key={item.id}>
                <div>
                  <strong>{item.revokedAt ? t('已撤销') : t('只读分享')}</strong>
                  <Badge>{item.allowOriginalDownload ? t('允许下载原件') : t('仅预览')}</Badge>
                  <p className="muted">
                    {t('到期：')}
                    {dateTime(item.expiresAt)}
                  </p>
                </div>
                {!item.revokedAt && (
                  <Button
                    variant="ghost"
                    disabled={!canEdit}
                    busy={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await remove(`/shares/${item.id}`);
                        setShareUrl('');
                        await shares.refetch();
                      }, '分享已撤销')
                    }
                  >
                    {t('撤销链接')}
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="muted">{t('暂无分享链接')}</p>
          )}
        </section>
      </Modal>
      <Modal
        open={!!applyItem}
        onClose={() => setApplyItem(null)}
        title={t('应用创作结果')}
        description={t('结果不会自动覆盖画布中的新修改。')}
      >
        {applyItem && (
          <>
            <img
              className="pending-preview"
              src={
                assets.data?.items.find((a) => a.id === applyItem.assetId)?.previewUrl ??
                assets.data?.items.find((a) => a.id === applyItem.assetId)?.originalUrl ??
                `/api/v1/assets/${applyItem.assetId}/content`
              }
              alt={t('待应用结果')}
            />
            <Field label={t('应用方式')}>
              <select value={applyMode} onChange={(e) => setApplyMode(e.target.value)}>
                <option value="new-layer">
                  {applyItem.outputKind === 'layers'
                    ? `将 ${applyItem.assetIds.length} 层作为组合插入`
                    : t('插入为新图层')}
                </option>
                {scene?.layers.some((layer) => layer.id === applyItem.targetLayerId) && (
                  <option value="replace">{t('替换原目标图层')}</option>
                )}
              </select>
            </Field>
            {applyMode === 'replace' && (
              <Notice tone="warning">
                {t('将替换图层「')}
                {scene?.layers.find((layer) => layer.id === applyItem.targetLayerId)?.name}
                {t('」。当前画布的其他修改会保留。')}
              </Notice>
            )}
            <div className="modal-actions">
              <Button
                busy={action.busy}
                disabled={dirty || saving || !canEdit}
                onClick={() =>
                  void action.run(async () => {
                    await post(`/pending-applies/${applyItem.id}/apply`, {
                      expectedRevision: revision,
                      mode: applyMode,
                      ...(applyMode === 'replace' ? { layerId: applyItem.targetLayerId } : {}),
                    });
                    setApplyItem(null);
                    showCanvas();
                    const doc = await api<DocumentDto>(`/documents/${documentId}`);
                    setScene(doc.scene);
                    setRevision(doc.revision);
                    setDirty(false);
                    await refresh();
                  }, '结果已应用到画布')
                }
              >
                {t('确认应用')}
              </Button>
            </div>
            {dirty && <p className="field-hint">{t('请先保存当前画布，再应用新结果。')}</p>}
          </>
        )}
      </Modal>
    </div>
  );
}

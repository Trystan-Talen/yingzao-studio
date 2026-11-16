import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, Copy, Link2, ScanEye } from 'lucide-react';
import type { AssetDto, ProjectDto } from '../../contracts/core';
import type { CreativePreparation } from '../../contracts/creative-intent';
import type { JobInput } from '../../contracts/jobs';
import { parseSocialVideoLink } from '../../contracts/social-import';
import { Composer, type ComposerController } from '../components/Composer';
import { JobSubmit } from '../components/JobSubmit';
import { JobCard } from '../components/TaskCenter';
import { Button, Empty, ErrorState, Field, Loading, Notice } from '../components/ui';
import { useStudio } from '../context';
import { api, errorMessage, useApi, useRefresh, type Page } from '../lib/api';
import { latestMediaDraftRecord, type CreationDraft } from '../lib/creation-recovery';
import { selectMatchingJobSnapshot } from '../lib/job-snapshot';
import { jobDestination } from '../lib/job-navigation';
import { jobInput, type Capabilities, type Job } from '../lib/tasks';
import { t } from '../lib/i18n';
import '../styles/creative-studio.css';
import '../styles/replica-studio.css';

type Recovery = Pick<
  CreationDraft,
  'input' | 'drafts' | 'warnings' | 'modelDefaultsPending' | 'modeDrafts' | 'activeModes'
>;
interface Message {
  createdAt: string;
  metadata?: { draft?: JobInput; creationWarnings?: string[] };
}

export function ReplicaStudio() {
  const { projectId } = useParams();
  return <ReplicaWorkspace key={projectId ?? 'new'} projectId={projectId} />;
}

function ReplicaWorkspace({ projectId }: { projectId?: string }) {
  const { workspace, canEdit } = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [params, setParams] = useSearchParams();
  const requestedKind = params.get('kind') === 'video' ? 'video' : undefined;
  const [kind, setKind] = useState<'image' | 'video'>(requestedKind ?? 'image');
  const routeState = location.state as {
    submittedJob?: Job;
    recoveryDraft?: Recovery;
    notice?: string;
  } | null;
  const controller = useRef<ComposerController>(null);
  const creation = useRef<HTMLElement>(null);
  const results = useRef<HTMLElement>(null);
  const [preparation, setPreparation] = useState<CreativePreparation>();
  const [draft, setDraft] = useState<{
    ready: boolean;
    input?: JobInput;
    warnings?: string[];
    error?: string;
  }>({ ready: !projectId });
  const [draftRetry, setDraftRetry] = useState(0);
  const project = useApi<ProjectDto>(`/projects/${projectId ?? ''}`, !!projectId);
  useEffect(() => {
    if (!projectId) return;
    const signal = new AbortController();
    setDraft({ ready: false });
    void (async () => {
      try {
        for (let page = 1; ; page++) {
          const messages = await api<Page<Message>>(
            `/projects/${projectId}/messages?pageSize=100&page=${page}`,
            { signal: signal.signal },
            workspace!.id,
          );
          const latest = latestMediaDraftRecord(messages.items);
          if (latest || page * messages.pageSize >= messages.total) {
            if (!signal.signal.aborted)
              setDraft({
                ready: true,
                input: latest?.metadata?.draft,
                warnings: latest?.metadata?.creationWarnings,
              });
            return;
          }
        }
      } catch (error) {
        if (!signal.signal.aborted) setDraft({ ready: false, error: errorMessage(error) });
      }
    })();
    return () => signal.abort();
  }, [projectId, workspace?.id, draftRetry]);

  const focusedId = params.get('job');
  const focusedQuery = useApi<Job>(`/jobs/${focusedId ?? ''}`, !!focusedId, 3000);
  const focused = selectMatchingJobSnapshot(
    { id: focusedId, projectId, workspaceId: workspace?.id },
    focusedQuery.data,
    routeState?.submittedJob,
  );
  const focusedReplica = focused?.input.replica ? focused : undefined;
  const recent = useApi<Page<Job>>(
    projectId ? `/jobs?projectId=${projectId}&pageSize=12` : '/jobs?archived=false&pageSize=12',
    true,
    5000,
  );
  const recentReplicas = recent.data?.items.filter(
    (job) => job.input.replica && job.id !== focusedReplica?.id,
  );
  useEffect(() => {
    if (!focusedReplica) return;
    const frame = requestAnimationFrame(() =>
      results.current?.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusedReplica?.id]);

  const [link, setLink] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [acceptedCost, setAcceptedCost] = useState(false);
  const capabilities = useApi<Capabilities>('/capabilities');
  const importOperation = capabilities.data?.operations.find(
    (operation) => operation.id === 'media.import' && operation.providerId === 'tikhub',
  );
  let linkIssue: string | undefined;
  try {
    if (link.trim()) parseSocialVideoLink(link);
  } catch (error) {
    linkIssue = errorMessage(error);
  }
  const importId = params.get('importJob');
  const importQuery = useApi<Job>(`/jobs/${importId ?? ''}`, !!importId, 3000);
  const imported =
    importQuery.data?.workspaceId === workspace?.id &&
    importQuery.data.operation === 'media.import'
      ? importQuery.data
      : undefined;
  const [referenceError, setReferenceError] = useState('');
  const [acceptedReference, setAcceptedReference] = useState<string>();
  const referenceId = params.get('reference');
  const reference = useApi<AssetDto>(`/assets/${referenceId ?? ''}`, !!referenceId);
  const addReference = (asset: AssetDto) => {
    try {
      if (!controller.current) throw new Error(t('请等待复刻草稿加载完成。'));
      if (asset.kind !== kind)
        throw new Error(t('请先切换到与参考作品一致的图片或视频复刻。'));
      controller.current.addReplicaReference(asset);
      setAcceptedReference(asset.id);
      setReferenceError('');
      creation.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    } catch (error) {
      setReferenceError(errorMessage(error));
    }
  };
  const importInput = jobInput({
    operation: 'media.import',
    providerId: 'tikhub',
    ...(projectId ? { projectId } : {}),
    linkUrl: link,
    options: { referenceAuthorized: authorized, externalCostAccepted: acceptedCost, count: 1 },
  });
  const stage = focusedReplica ? 3 : preparation?.status === 'ready' ? 2 : 1;
  const composerReady = draft.ready && (!projectId || !!project.data);

  return (
    <div className="page replica-studio">
      <header className="replica-heading">
        <div>
          <p className="replica-eyebrow"><Copy size={16} />{t('从参考作品到自己的创作')}</p>
          <h1>{t('爆款复刻')}</h1>
          <p>{t('分析构图、光线与节奏，保留自己的产品或人物，再确认方案生成。')}</p>
        </div>
        <Link className="button ghost" to="/"><ArrowLeft size={16} />{t('返回创作')}</Link>
      </header>
      {routeState?.notice && <Notice>{routeState.notice}</Notice>}
      <nav className="replica-steps" aria-label={t('复刻流程')}>
        {[
          { title: '准备参考与主体', note: '参考负责风格，主体负责外观' },
          { title: '分析并确认方案', note: '先核对参考分析，再提交生成' },
          { title: '查看结果与调整', note: '下载原件，保留方案继续创作' },
        ].map((step, index) => (
          <div key={step.title} className={stage === index + 1 ? 'is-current' : ''} aria-current={stage === index + 1 ? 'step' : undefined}>
            <span>{stage > index + 1 ? <Check size={16} /> : index + 1}</span>
            <div><strong>{t(step.title)}</strong><small>{t(step.note)}</small></div>
          </div>
        ))}
      </nav>

      <section className="replica-source" aria-label={t('参考作品来源')}>
        <div className="replica-source-heading"><Link2 size={18} /><h2>{t('参考作品')}</h2></div>
        <p>{t('图片可直接上传；视频可上传文件，或导入支持的公开分享链接。')}</p>
        <details className="replica-import">
          <summary>{t('从分享链接导入视频参考')}</summary>
          <p className="field-hint">{t('支持抖音与 TikTok（国际版抖音）公开视频；其他平台和图片请下载后上传。')}</p>
          <Field label={t('参考作品分享链接')}>
            <textarea value={link} onChange={(event) => setLink(event.target.value)} rows={2} maxLength={4096} placeholder={t('粘贴包含一个公开视频链接的分享内容')} />
          </Field>
          {linkIssue && <p className="field-error" role="alert">{linkIssue}</p>}
          <label className="checkbox"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />{t('我确认有权使用该参考作品')}</label>
          <label className="checkbox"><input type="checkbox" checked={acceptedCost} onChange={(event) => setAcceptedCost(event.target.checked)} />{t('我知晓链接解析服务可能另行收费')}</label>
          <JobSubmit input={importInput} operation={importOperation} label="导入参考视频" forceConfirmation valid={!!link.trim() && !linkIssue && authorized && acceptedCost} recoveryScope={`replica-import:${projectId ?? 'new'}`} onCreated={(job) => {
            const next = new URLSearchParams(params);
            next.set('importJob', job.id);
            setParams(next, { replace: true });
            void refresh();
          }} />
        </details>
        {importQuery.error && <ErrorState error={importQuery.error} retry={importQuery.refetch} />}
        {imported && (
          <div className="replica-import-result">
            <JobCard job={imported} compact onJobCreated={(job) => {
              const next = new URLSearchParams(params);
              next.set('importJob', job.id);
              setParams(next, { replace: true });
            }} />
            {imported.outputAssets.filter((asset) => asset.kind === 'video').map((asset) => <Button key={asset.id} variant="secondary" disabled={!canEdit || !composerReady || acceptedReference === asset.id} onClick={() => addReference(asset)}>{t(acceptedReference === asset.id ? '已带入参考作品' : '用作参考作品')} · {asset.name}</Button>)}
            {kind !== 'video' && !!imported.outputAssets.length && <p className="field-hint">{t('请先切换到视频复刻，再带入导入的参考作品。')}</p>}
          </div>
        )}
        {reference.error && <ErrorState error={reference.error} retry={reference.refetch} />}
        {reference.data && <Button variant="secondary" disabled={!canEdit || !composerReady || acceptedReference === reference.data.id} onClick={() => addReference(reference.data!)}>{t(acceptedReference === reference.data.id ? '已带入参考作品' : '用作参考作品')} · {reference.data.name}</Button>}
        {referenceError && <Notice tone="warning">{referenceError}</Notice>}
      </section>

      <section ref={creation} className="replica-compose" aria-label={t('复刻创作工作区')}>
        <div className="replica-source-heading"><ScanEye size={19} /><h2>{t('准备素材并分析')}</h2></div>
        <p className="replica-role-note">{t('参考作品只提供构图、光线或运镜；主体图片提供需要保留的商品或人物外观。两者请分别添加。')}</p>
        {project.error ? <ErrorState error={project.error} retry={project.refetch} /> : draft.error ? <ErrorState error={new Error(draft.error)} retry={() => setDraftRetry((value) => value + 1)} /> : !composerReady ? <Loading label={t('正在读取复刻草稿…')} /> : (
          <Composer purpose="replica" visualVariant="studio" projectId={projectId} initialDraft={draft.input} initialWarnings={draft.warnings} initialRecovery={routeState?.recoveryDraft} requestedKind={requestedKind} controllerRef={controller} onPreparationChange={setPreparation} onKindChange={(nextKind) => {
            setKind(nextKind);
            setAcceptedReference(undefined);
          }} onRecoveryPersisted={() => navigate(location.pathname + location.search, { replace: true, state: { ...routeState, recoveryDraft: undefined } })} onCreated={(job) => {
            if (projectId) navigate(jobDestination(job), { state: { submittedJob: job } });
            void refresh();
          }} />
        )}
      </section>

      <section ref={results} className="replica-results" aria-label={t('复刻结果')}>
        <div className="replica-results-heading"><div><h2>{t('复刻结果')}</h2><p>{t('任务和原件会保留；调整需求后可再次分析并生成。')}</p></div><Button variant="secondary" onClick={() => controller.current?.focusPrompt()}>{t('继续调整需求')}</Button></div>
        {focusedQuery.error && <ErrorState error={focusedQuery.error} retry={focusedQuery.refetch} />}
        {focusedId && focusedQuery.isLoading && <Loading />}
        {focused && !focusedReplica && <Notice tone="warning">{t('此任务不属于参考复刻，请到对应创作页面查看。')} <Link to={jobDestination(focused)}>{t('查看这次任务')}<ArrowUpRight size={14} /></Link></Notice>}
        {focusedReplica && <JobCard job={focusedReplica} onJobCreated={(job) => navigate(jobDestination(job), { state: { submittedJob: job } })} />}
        {recent.error && <ErrorState error={recent.error} retry={recent.refetch} />}
        {!focusedReplica && !recent.isLoading && !recent.error && !recentReplicas?.length && <Empty title={t('复刻结果会显示在这里')} description={t('先分析并确认方案，再生成你的图片或视频。')} />}
        {!!recentReplicas?.length && <div className="replica-recent"><h3>{t('最近的复刻任务')}</h3>{recentReplicas.map((job) => <JobCard key={job.id} job={job} compact showProjectLink />)}</div>}
      </section>
    </div>
  );
}

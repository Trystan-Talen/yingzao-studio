import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Workflow } from 'lucide-react';
import { JobCard, TaskList } from '../components/TaskCenter';
import { Button, ErrorState, Loading, PageHeader } from '../components/ui';
import { useApi } from '../lib/api';
import { jobDestination } from '../lib/job-navigation';
import type { Job } from '../lib/tasks';
import { t } from '../lib/i18n';

export function Tasks() {
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job');
  const navigate = useNavigate();
  const focused = useApi<Job>(
    `/jobs/${encodeURIComponent(jobId ?? '')}`,
    !!jobId,
    jobId ? 3000 : undefined,
  );
  return (
    <div className="page tasks-page">
      <PageHeader
        eyebrow={t('每次创作，都有记录')}
        title={t('任务中心')}
        description={t('查看进度、找回作品，或处理需要你确认的任务。')}
        action={
          <Link className="button primary" to="/">
            <Plus size={16} /> {t('开始新创作')}
          </Link>
        }
      />
      {jobId && (
        <section className="focused-task" aria-label={t('当前查看的任务')}>
          <div className="section-heading">
            <div>
              <h2>{t('当前查看的任务')}</h2>
              <p className="muted">
                {t('任务编号')}：{jobId}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('job');
                setParams(next, { replace: true });
              }}
            >
              <ArrowLeft size={16} /> {t('查看全部任务')}
            </Button>
          </div>
          {focused.isLoading ? (
            <Loading label={t('正在读取任务进度与结果…')} />
          ) : focused.error ? (
            <>
              <ErrorState error={focused.error} retry={focused.refetch} />
              <p className="muted">{t('请确认当前工作空间；原任务不会因此重新生成。')}</p>
            </>
          ) : focused.data ? (
            <JobCard
              job={focused.data}
              showProjectLink={!!focused.data.projectId}
              onJobCreated={(job) => navigate(jobDestination(job))}
            />
          ) : null}
        </section>
      )}
      <div className="task-history-heading">
        <Workflow size={18} aria-hidden="true" />
        <h2>{t('全部创作记录')}</h2>
        <span>{t('已提交的任务会持续保留')}</span>
      </div>
      <TaskList syncUrl />
    </div>
  );
}

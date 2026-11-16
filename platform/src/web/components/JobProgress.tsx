import { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Clock3, Image, LoaderCircle, Video } from 'lucide-react';
import type { Job } from '../lib/tasks';
import { elapsedJobSeconds, elapsedLabel, presentJob } from '../lib/job-presentation';
import { t } from '../lib/i18n';
import '../styles/result-studio.css';

export function JobProgress({ job }: { job: Job }) {
  const presentation = presentJob(job);
  const [now, setNow] = useState(() => Date.now());
  const waiting = ['queued', 'running', 'reconciliation_required'].includes(job.status);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  const elapsed = elapsedJobSeconds(job.createdAt, now);
  const delayedQueue = job.status === 'queued' && elapsed !== null && elapsed >= 120;
  const Icon = delayedQueue
    ? Clock3
    : presentation.animated
      ? LoaderCircle
      : presentation.tone === 'success'
        ? CheckCircle2
        : AlertCircle;
  const steps = [
    '任务已提交',
    job.providerId === 'local' ? '处理素材' : '模型处理',
    '保存结果',
    '完成',
  ];
  return (
    <div
      className={`result-progress tone-${delayedQueue ? 'warning' : presentation.tone}`}
      data-job-phase={job.items.find((item) => item.phase)?.phase ?? job.status}
    >
      <div className="result-progress-heading">
        <span
          className={`result-progress-icon${presentation.animated && !delayedQueue ? ' is-working' : ''}`}
          aria-hidden="true"
        >
          <Icon size={21} />
        </span>
        <div className="result-progress-copy" role="status" aria-live="polite">
          <strong>{t(delayedQueue ? '任务仍在排队，等待执行器' : presentation.title)}</strong>
          {job.status !== 'succeeded' && (
            <p>
              {t(
                delayedQueue
                  ? '已等待较长时间，尚未开始处理。请管理员查看执行日志及执行器状态；不要重复提交。'
                  : presentation.description,
              )}
            </p>
          )}
        </div>
        {waiting && elapsed !== null && (
          <span className="result-elapsed" aria-label={`${t('提交至今')} ${elapsedLabel(elapsed)}`}>
            <Clock3 size={13} aria-hidden="true" />
            <span>
              {t('提交至今')}
              <b>{elapsedLabel(elapsed)}</b>
            </span>
          </span>
        )}
      </div>
      {waiting && (presentation.step !== null || job.stage) && (
        <details className="result-progress-details">
          <summary>{t('查看处理阶段')}</summary>
          {presentation.step !== null && (
            <ol className="result-steps" aria-label={t('任务处理阶段')}>
              {steps.map((label, index) => (
                <li
                  key={index}
                  className={
                    index < presentation.step!
                      ? 'is-done'
                      : index === presentation.step
                        ? 'is-current'
                        : ''
                  }
                  aria-current={index === presentation.step ? 'step' : undefined}
                >
                  <span aria-hidden="true">
                    {index < presentation.step! || job.status === 'succeeded' ? (
                      <Check size={11} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {t(label)}
                </li>
              ))}
            </ol>
          )}
          {job.stage && (
            <p className="result-server-stage">
              {t('最新状态')}：{t(job.stage)}
            </p>
          )}
        </details>
      )}
    </div>
  );
}

export function CreationPlaceholder({ video = false }: { video?: boolean }) {
  const Icon = video ? Video : Image;
  return (
    <div className="result-placeholder" aria-hidden="true">
      <span className="result-placeholder-frame">
        <Icon size={32} strokeWidth={1.2} />
      </span>
    </div>
  );
}

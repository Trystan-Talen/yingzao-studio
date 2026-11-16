import type { Job } from './tasks';

/** Keep the selected job in the URL so revisiting a result survives refreshes. */
export function jobDestination(job: Pick<Job, 'id' | 'projectId' | 'input'>): string {
  const query = `?job=${encodeURIComponent(job.id)}`;
  if (!job.projectId) return `/tasks${query}`;
  const detailPage =
    !!job.input.options.detailPagePlan || job.input.options.assistantMode === 'detail-page';
  const studio = detailPage ? '/detail-pages' : job.input.replica ? '/replica' : '/workbench';
  return `${studio}/${encodeURIComponent(job.projectId)}${query}`;
}

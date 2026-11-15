import { useApi, type Page } from './api';
import type { Job } from './tasks';
import { mergeJobSnapshots } from './job-presentation';

/** Totals use filtered pages; visible overlapping transitions are counted once. */
export function useJobActivity(enabled = true) {
  const queued = useApi<Page<Job>>('/jobs?status=queued&archived=false&pageSize=12', enabled, 5000);
  const running = useApi<Page<Job>>(
    '/jobs?status=running&archived=false&pageSize=12',
    enabled,
    5000,
  );
  const paused = useApi<Page<Job>>(
    '/jobs?status=reconciliation_required&archived=false&pageSize=12',
    enabled,
    5000,
  );
  const queries = [queued, running, paused];
  const ready = queries.every((query) => !!query.data);
  const snapshots = queries.flatMap((query) => query.data?.items ?? []);
  const items = mergeJobSnapshots(snapshots).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const overlap = snapshots.length - items.length;
  return {
    items,
    total: ready
      ? Math.max(0, queries.reduce((sum, query) => sum + (query.data?.total ?? 0), 0) - overlap)
      : null,
    isLoading: queries.some((query) => query.isLoading),
    error: queries.find((query) => query.error)?.error,
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
  };
}

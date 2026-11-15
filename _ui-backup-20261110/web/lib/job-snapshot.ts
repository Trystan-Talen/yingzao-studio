import type { Job } from './tasks';

type JobScope = {
  id: string | null | undefined;
  projectId: string | null | undefined;
  workspaceId: string | undefined;
};

/** A pending read must never fall back to another task or workspace. */
export function selectMatchingJobSnapshot(
  scope: JobScope,
  ...snapshots: (Job | null | undefined)[]
): Job | undefined {
  if (!scope.id || scope.projectId === undefined || !scope.workspaceId) return undefined;
  let selected: Job | undefined;
  for (const snapshot of snapshots) {
    if (
      snapshot?.id !== scope.id ||
      snapshot.projectId !== scope.projectId ||
      snapshot.workspaceId !== scope.workspaceId
    )
      continue;
    // Keep the first (server) snapshot on equal timestamps.
    if (!selected || snapshot.updatedAt > selected.updatedAt) selected = snapshot;
  }
  return selected;
}

import type { QueryClient, QueryKey } from '@tanstack/react-query';

interface JobEvent {
  jobId: string;
  type: string;
  payload?: { status?: string };
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function queryPath(key: QueryKey, workspaceId: string): string | undefined {
  return key[0] === 'api' && key[1] === workspaceId && typeof key[2] === 'string'
    ? key[2]
    : undefined;
}
function taskPath(path: string, ids: Set<string>) {
  const pathname = path.split('?')[0]!;
  return pathname === '/jobs' || [...ids].some((id) => pathname === `/jobs/${id}`);
}
function snapshots(client: QueryClient, workspaceId: string, ids: Set<string>) {
  const jobs = new Map<
    string,
    { projectId?: string; status?: string; updatedAt: string; hasResults: boolean; effects: string }
  >();
  for (const query of client.getQueryCache().findAll({ queryKey: ['api', workspaceId] })) {
    const path = queryPath(query.queryKey, workspaceId);
    if (!path || !taskPath(path, ids)) continue;
    const data = record(query.state.data);
    const candidates =
      Array.isArray(data?.items) && path.split('?')[0] === '/jobs' ? data.items : [data];
    for (const candidate of candidates) {
      const job = record(candidate);
      if (typeof job?.id !== 'string' || !ids.has(job.id)) continue;
      const updatedAt = typeof job.updatedAt === 'string' ? job.updatedAt : '';
      if ((jobs.get(job.id)?.updatedAt ?? '') > updatedAt) continue;
      const finishedItems = Array.isArray(job.items)
        ? job.items
            .map(record)
            .filter(
              (item) =>
                item &&
                ['succeeded', 'partial', 'failed', 'cancelled'].includes(String(item.status)),
            )
            .map((item) => [item!.id, item!.status])
        : [];
      jobs.set(job.id, {
        projectId: typeof job.projectId === 'string' ? job.projectId : undefined,
        status: typeof job.status === 'string' ? job.status : undefined,
        updatedAt,
        hasResults:
          (Array.isArray(job.outputAssets) && job.outputAssets.length > 0) ||
          finishedItems.length > 0,
        effects: JSON.stringify([
          job.status,
          job.settledCredits,
          Array.isArray(job.outputAssets) ? job.outputAssets.map((asset) => record(asset)?.id) : [],
          finishedItems,
        ]),
      });
    }
  }
  return jobs;
}

/** Progress never refetches configuration or the editor's project/document/message queries. */
async function refreshJobQueries(
  client: QueryClient,
  workspaceId: string,
  events: JobEvent[],
  active: () => boolean,
  observedEffects: Map<string, string>,
  observedLifecycle: Map<string, string>,
) {
  if (!active()) return;
  const ids = new Set(events.map((event) => event.jobId));
  const before = snapshots(client, workspaceId, ids);
  const progressOnly = events.every(
    (event) =>
      (event.type === 'started' || event.payload?.status === 'running') &&
      before.get(event.jobId)?.status === 'running',
  );
  await client.invalidateQueries(
    {
      predicate: (query) => {
        const path = queryPath(query.queryKey, workspaceId);
        if (!path || !taskPath(path, ids)) return false;
        const status = new URLSearchParams(path.split('?')[1]).get('status');
        return !progressOnly || !status || status === 'running';
      },
    },
    { cancelRefetch: false },
  );
  if (!active()) return;
  const after = snapshots(client, workspaceId, ids);
  // A batch may finish an item while the parent job remains running. Detect new outputs too.
  const effectsChanged = [...after].some(
    ([id, job]) =>
      (!observedEffects.has(id) && job.hasResults) ||
      (observedEffects.get(id) ?? before.get(id)?.effects) !== job.effects,
  );
  let lifecycle = false;
  for (const event of events) {
    if (
      event.type !== 'created' &&
      (event.type === 'started' || ['queued', 'running'].includes(event.payload?.status ?? ''))
    ) {
      observedLifecycle.delete(event.jobId);
      continue;
    }
    if (
      event.type === 'created' ||
      (event.payload?.status && !['queued', 'running'].includes(event.payload.status))
    ) {
      const marker = `event:${event.type}:${event.payload?.status ?? ''}`;
      if (observedLifecycle.get(event.jobId) !== marker) lifecycle = true;
      observedLifecycle.set(event.jobId, marker);
    }
  }
  for (const [id, job] of after) observedEffects.set(id, job.effects);
  while (observedEffects.size > 1000) observedEffects.delete(observedEffects.keys().next().value!);
  while (observedLifecycle.size > 1000)
    observedLifecycle.delete(observedLifecycle.keys().next().value!);
  if (!effectsChanged && !lifecycle) return;
  const projects = new Set(
    [...before.values(), ...after.values()].flatMap((job) =>
      job.projectId ? [job.projectId] : [],
    ),
  );
  const documents = new Set<string>();
  for (const query of client.getQueryCache().findAll({ queryKey: ['api', workspaceId] })) {
    const path = queryPath(query.queryKey, workspaceId)?.split('?')[0];
    const match = path?.match(/^\/projects\/([^/]+)\/document$/);
    const id = record(query.state.data)?.id;
    if (match && (!projects.size || projects.has(match[1]!)) && typeof id === 'string')
      documents.add(id);
  }
  await client.invalidateQueries(
    {
      predicate: (query) => {
        const path = queryPath(query.queryKey, workspaceId);
        if (!path) return false;
        const [pathname, search] = path.split('?');
        if (
          [
            '/credits',
            '/credits/ledger',
            '/credits/api',
            '/credits/api/ledger',
            '/assets',
            '/projects',
          ].includes(pathname!)
        )
          return true;
        const project = pathname!.match(/^\/projects\/([^/]+)(?:\/(?:messages|document))?$/);
        if (project) return !projects.size || projects.has(project[1]!);
        if (pathname === '/pending-applies') {
          const documentId = new URLSearchParams(search).get('documentId');
          return !documentId || !documents.size || documents.has(documentId);
        }
        const document = pathname!.match(/^\/documents\/([^/]+)\/versions$/);
        return !!document && (!documents.size || documents.has(document[1]!));
      },
    },
    { cancelRefetch: false },
  );
}

/** Keep worker event semantics intact; scope client reads to the affected task and its results. */
export function createWorkspaceJobRefresh(client: QueryClient, workspaceId: string) {
  let events: JobEvent[] = [];
  let disposed = false;
  const observedEffects = new Map<string, string>();
  const observedLifecycle = new Map<string, string>();
  const refresh = createJobEventRefresh(() => {
    const batch = events;
    events = [];
    void refreshJobQueries(
      client,
      workspaceId,
      batch,
      () => !disposed,
      observedEffects,
      observedLifecycle,
    );
  });
  return {
    schedule(data: unknown) {
      if (disposed) return;
      try {
        const value = record(typeof data === 'string' ? JSON.parse(data) : data);
        if (typeof value?.jobId !== 'string' || !value.jobId || typeof value.type !== 'string')
          return;
        const payload = record(value.payload);
        events.push({
          jobId: value.jobId,
          type: value.type,
          payload: {
            status: typeof payload?.status === 'string' ? payload.status : undefined,
          },
        });
        refresh.schedule();
      } catch {
        /* Invalid event data must not trigger a workspace-wide refresh. */
      }
    },
    dispose() {
      disposed = true;
      events = [];
      observedEffects.clear();
      observedLifecycle.clear();
      refresh.dispose();
    },
  };
}

/** Coalesce replayed events without postponing updates while a stream stays busy. */
export function createJobEventRefresh(refresh: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  return {
    schedule() {
      if (disposed || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!disposed) refresh();
      }, 500);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

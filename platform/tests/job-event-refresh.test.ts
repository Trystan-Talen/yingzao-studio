import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobEventRefresh, createWorkspaceJobRefresh } from '../src/web/lib/job-event-refresh';

afterEach(() => {
  vi.useRealTimers();
});

describe('job event refresh coalescing', () => {
  it('keeps four active tabs below the shared request budget without refreshing unrelated resources', async () => {
    vi.useFakeTimers();
    const clients: QueryClient[] = [];
    const cleanups: (() => void)[] = [];
    const refreshes: ReturnType<typeof createWorkspaceJobRefresh>[] = [];
    let reads = 0;
    let unrelatedReads = 0;
    const job = {
      id: 'video',
      projectId: 'project',
      status: 'running',
      stage: '处理中',
      outputAssets: [],
    };
    try {
      for (let tab = 0; tab < 4; tab++) {
        const client = new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        });
        clients.push(client);
        const paths = [
          '/jobs?status=queued',
          '/jobs?status=running',
          '/jobs?status=reconciliation_required',
          '/jobs?projectId=project',
          '/jobs/video',
          '/capabilities',
          '/brands',
          '/projects/project',
          '/projects/project/document',
          '/projects/project/messages',
          '/assets',
          '/export-policy',
          '/members',
          '/credits',
        ];
        for (const path of paths) {
          const task = path.startsWith('/jobs');
          const options = {
            queryKey: ['api', 'current', path],
            queryFn: async () => {
              reads++;
              if (!task) unrelatedReads++;
              return path === '/jobs/video'
                ? { ...job }
                : {
                    items:
                      task &&
                      !path.includes('status=queued') &&
                      !path.includes('reconciliation_required')
                        ? [{ ...job }]
                        : [],
                  };
            },
          };
          await client.fetchQuery(options);
          const observer = new QueryObserver(client, options);
          cleanups.push(observer.subscribe(() => undefined));
          if (task) {
            const interval = path === '/jobs/video' || path.includes('projectId') ? 3000 : 5000;
            const timer = setInterval(() => {
              void client.refetchQueries({ queryKey: options.queryKey, exact: true });
            }, interval);
            cleanups.push(() => clearInterval(timer));
          }
        }
        refreshes.push(createWorkspaceJobRefresh(client, 'current'));
      }
      reads = 0;
      unrelatedReads = 0;
      for (let tick = 0; tick < 15; tick++) {
        job.stage = `处理中 ${tick}`;
        refreshes.forEach((refresh) =>
          refresh.schedule(
            JSON.stringify({
              jobId: job.id,
              type: 'updated',
              payload: { status: 'running', stage: job.stage },
            }),
          ),
        );
        await vi.advanceTimersByTimeAsync(4000);
      }
      expect.soft(unrelatedReads).toBe(0);
      expect.soft(reads).toBeLessThan(600);
      console.info(
        'SSE request-budget fixture',
        JSON.stringify({
          tabs: 4,
          seconds: 60,
          requests: reads,
          unrelatedRequests: unrelatedReads,
        }),
      );
      expect(
        clients.every(
          (client) =>
            client.getQueryData<{ stage: string }>(['api', 'current', '/jobs/video'])?.stage ===
            job.stage,
        ),
      ).toBe(true);
    } finally {
      refreshes.forEach((refresh) => refresh.dispose());
      cleanups.forEach((cleanup) => cleanup());
      clients.forEach((client) => client.clear());
    }
  });

  it('replays 389 events with one refresh per active query and reads the latest state', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    let latest = {
      id: 'video',
      projectId: 'project',
      status: 'running',
      outputAssets: [] as { id: string }[],
    };
    const readJob = vi.fn(async () => latest);
    const readProject = vi.fn(async () => ({ cover: latest.outputAssets[0]?.id ?? null }));
    const readOtherWorkspace = vi.fn(async () => ({ status: 'unchanged' }));
    const options: { queryKey: string[]; queryFn: () => Promise<unknown> }[] = [
      { queryKey: ['api', 'current', '/jobs/video'], queryFn: readJob },
      { queryKey: ['api', 'current', '/projects/project'], queryFn: readProject },
      { queryKey: ['api', 'other', '/jobs/video'], queryFn: readOtherWorkspace },
    ];
    const unsubscribes: (() => void)[] = [];
    const refresh = createWorkspaceJobRefresh(client, 'current');
    try {
      for (const option of options) {
        await client.fetchQuery(option);
        const observer = new QueryObserver(client, option);
        unsubscribes.push(observer.subscribe(() => undefined));
      }
      latest = { ...latest, status: 'succeeded', outputAssets: [{ id: 'saved-video' }] };
      for (let index = 0; index < 389; index++)
        refresh.schedule({
          jobId: 'video',
          type: 'updated',
          payload: { status: 'succeeded' },
        });
      await vi.advanceTimersByTimeAsync(499);
      expect(readJob).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(readJob).toHaveBeenCalledTimes(2);
      expect(readProject).toHaveBeenCalledTimes(2);
      expect(readOtherWorkspace).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(options[0]!.queryKey)).toEqual(latest);
      expect(client.getQueryData(options[1]!.queryKey)).toEqual({ cover: 'saved-video' });
      // A reconnect can replay the same terminal state in later SSE batches.
      refresh.schedule({ jobId: 'video', type: 'updated', payload: { status: 'succeeded' } });
      await vi.advanceTimersByTimeAsync(2500);
      expect(readProject).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      refresh.dispose();
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      client.clear();
    }
  });

  it('keeps refreshing during a continuous event stream instead of waiting for silence', async () => {
    vi.useFakeTimers();
    let revision = 0;
    const observed: number[] = [];
    const refresh = createJobEventRefresh(() => observed.push(revision));
    for (let index = 1; index <= 15; index++) {
      revision = index;
      refresh.schedule();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(observed).toEqual([5, 10, 15]);
    expect(vi.getTimerCount()).toBe(0);
    refresh.dispose();
  });

  it.each(['running', 'succeeded'])(
    'refreshes related outputs and credits when a %s job gains an asset, without refreshing configuration',
    async (status) => {
      vi.useFakeTimers();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      });
      let job = {
        id: 'video',
        projectId: 'target',
        status: 'running',
        updatedAt: '2026-11-03T13:00:00.000Z',
        outputAssets: [] as { id: string }[],
      };
      const reads = new Map<string, ReturnType<typeof vi.fn>>();
      const cleanups: (() => void)[] = [];
      const related = [
        '/jobs/video',
        '/credits',
        '/credits/ledger?pageSize=30',
        '/credits/api',
        '/credits/api/ledger?pageSize=30',
        '/assets?pageSize=100',
        '/projects?pageSize=4',
        '/projects/target',
        '/projects/target/messages?pageSize=100',
        '/projects/target/document',
        '/pending-applies?documentId=target-doc',
        '/documents/target-doc/versions',
      ];
      const unrelated = [
        '/jobs/other',
        '/capabilities',
        '/brands',
        '/members',
        '/export-policy',
        '/projects/other',
        '/projects/other/document',
        '/projects/other/messages',
        '/pending-applies?documentId=other-doc',
        '/documents/other-doc/versions',
      ];
      const refresh = createWorkspaceJobRefresh(client, 'current');
      try {
        for (const path of [...related, ...unrelated]) {
          const queryFn = vi.fn(async () =>
            path === '/jobs/video'
              ? { ...job }
              : path.endsWith('/document')
                ? { id: path.includes('/target/') ? 'target-doc' : 'other-doc' }
                : {},
          );
          reads.set(path, queryFn);
          const options = { queryKey: ['api', 'current', path], queryFn };
          await client.fetchQuery(options);
          cleanups.push(new QueryObserver(client, options).subscribe(() => undefined));
        }
        // An inactive, older list must not mask a freshly read task detail.
        client.setQueryData(['api', 'current', '/jobs?archived=true'], { items: [{ ...job }] });
        job = {
          ...job,
          status,
          updatedAt: '2026-11-03T13:01:00.000Z',
          outputAssets: [{ id: 'new-output' }],
        };
        refresh.schedule({ jobId: 'video', type: 'updated', payload: { status } });
        await vi.advanceTimersByTimeAsync(500);
        for (const path of related) expect(reads.get(path), path).toHaveBeenCalledTimes(2);
        for (const path of unrelated) expect(reads.get(path), path).toHaveBeenCalledTimes(1);
      } finally {
        refresh.dispose();
        cleanups.forEach((cleanup) => cleanup());
        client.clear();
      }
    },
  );

  it('ignores malformed events and stops related-resource refresh after a workspace switch', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const initial = { id: 'video', projectId: 'project', status: 'running', outputAssets: [] };
    let release: (value: typeof initial) => void = () => undefined;
    let delayed = false;
    const readJob = vi.fn(() =>
      delayed
        ? new Promise<typeof initial>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(initial),
    );
    const readProject = vi.fn(async () => ({}));
    const job = { queryKey: ['api', 'old', '/jobs/video'], queryFn: readJob };
    const project = { queryKey: ['api', 'old', '/projects/project'], queryFn: readProject };
    await client.fetchQuery(job);
    await client.fetchQuery(project);
    const cleanups = [
      new QueryObserver(client, job).subscribe(() => undefined),
      new QueryObserver(client, project).subscribe(() => undefined),
    ];
    const refresh = createWorkspaceJobRefresh(client, 'old');
    try {
      refresh.schedule('invalid json');
      refresh.schedule({ type: 'updated' });
      await vi.advanceTimersByTimeAsync(500);
      expect(readJob).toHaveBeenCalledTimes(1);
      delayed = true;
      refresh.schedule({ jobId: 'video', type: 'updated', payload: { status: 'succeeded' } });
      await vi.advanceTimersByTimeAsync(500);
      expect(readJob).toHaveBeenCalledTimes(2);
      refresh.dispose();
      release({ ...initial, status: 'succeeded' });
      refresh.schedule({ jobId: 'video', type: 'created' });
      await vi.advanceTimersByTimeAsync(500);
      expect(readProject).toHaveBeenCalledTimes(1);
      expect(readJob).toHaveBeenCalledTimes(2);
    } finally {
      refresh.dispose();
      cleanups.forEach((cleanup) => cleanup());
      client.clear();
    }
  });

  it.each(['created', 'succeeded', 'partial-output'])(
    'refreshes the first %s lifecycle event even when polling already updated the job',
    async (state) => {
      vi.useFakeTimers();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      });
      let current = {
        id: 'video',
        projectId: 'project',
        status: 'running',
        outputAssets: [] as { id: string }[],
      };
      const readJob = vi.fn(async () => ({ ...current }));
      const readProject = vi.fn(async () => ({ cover: current.outputAssets[0]?.id ?? null }));
      const readCredits = vi.fn(async () => ({ status: current.status }));
      const options: { queryKey: string[]; queryFn: () => Promise<unknown> }[] = [
        { queryKey: ['api', 'current', '/jobs/video'], queryFn: readJob },
        { queryKey: ['api', 'current', '/projects/project'], queryFn: readProject },
        { queryKey: ['api', 'current', '/credits'], queryFn: readCredits },
      ];
      const cleanups: (() => void)[] = [];
      const refresh = createWorkspaceJobRefresh(client, 'current');
      try {
        for (const option of options) {
          await client.fetchQuery(option);
          cleanups.push(new QueryObserver(client, option).subscribe(() => undefined));
        }
        current = {
          ...current,
          status:
            state === 'created' ? 'queued' : state === 'partial-output' ? 'running' : 'succeeded',
          outputAssets: state === 'created' ? [] : [{ id: 'result' }],
        };
        await client.refetchQueries({ queryKey: options[0]!.queryKey, exact: true });
        const event = {
          jobId: 'video',
          type: state === 'created' ? 'created' : 'updated',
          payload: { status: current.status },
        };
        refresh.schedule(event);
        await vi.advanceTimersByTimeAsync(500);
        expect(readProject).toHaveBeenCalledTimes(2);
        expect(readCredits).toHaveBeenCalledTimes(2);
        refresh.schedule(event);
        await vi.advanceTimersByTimeAsync(500);
        expect(readProject).toHaveBeenCalledTimes(2);
        expect(readCredits).toHaveBeenCalledTimes(2);
      } finally {
        refresh.dispose();
        cleanups.forEach((cleanup) => cleanup());
        client.clear();
      }
    },
  );

  it('refreshes completed outputs when the active running list empties and an inactive stale list remains', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const job = { id: 'video', projectId: 'project', status: 'running', outputAssets: [] };
    let finished = false;
    const readList = vi.fn(async () => ({ items: finished ? [] : [job] }));
    const readProject = vi.fn(async () => ({ cover: finished ? 'result' : null }));
    const list = { queryKey: ['api', 'current', '/jobs?status=running'], queryFn: readList };
    const project = { queryKey: ['api', 'current', '/projects/project'], queryFn: readProject };
    await client.fetchQuery(list);
    await client.fetchQuery(project);
    client.setQueryData(['api', 'current', '/jobs?archived=false'], { items: [job] });
    const cleanups = [
      new QueryObserver(client, list).subscribe(() => undefined),
      new QueryObserver(client, project).subscribe(() => undefined),
    ];
    const refresh = createWorkspaceJobRefresh(client, 'current');
    try {
      finished = true;
      refresh.schedule({ jobId: 'video', type: 'updated', payload: { status: 'succeeded' } });
      await vi.advanceTimersByTimeAsync(500);
      expect(client.getQueryData(list.queryKey)).toEqual({ items: [] });
      expect(client.getQueryData(project.queryKey)).toEqual({ cover: 'result' });
      expect(readProject).toHaveBeenCalledTimes(2);
    } finally {
      refresh.dispose();
      cleanups.forEach((cleanup) => cleanup());
      client.clear();
    }
  });

  it.each([
    ['failed', false],
    ['cancelled', false],
    ['failed', true],
    ['cancelled', true],
  ] as const)(
    'refreshes batch refunds when an item becomes %s (poll first: %s)',
    async (status, pollFirst) => {
      vi.useFakeTimers();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      });
      let itemStatus = 'running';
      const readJob = vi.fn(async () => ({
        id: 'batch',
        projectId: 'project',
        status: 'running',
        settledCredits: 0,
        outputAssets: [],
        items: [
          { id: 'one', status: itemStatus },
          { id: 'two', status: 'running' },
        ],
      }));
      const readLedger = vi.fn(async () => ({ refunded: itemStatus !== 'running' }));
      const job = { queryKey: ['api', 'current', '/jobs/batch'], queryFn: readJob };
      const ledger = { queryKey: ['api', 'current', '/credits/ledger'], queryFn: readLedger };
      await client.fetchQuery(job);
      await client.fetchQuery(ledger);
      const cleanups = [
        new QueryObserver(client, job).subscribe(() => undefined),
        new QueryObserver(client, ledger).subscribe(() => undefined),
      ];
      const refresh = createWorkspaceJobRefresh(client, 'current');
      try {
        itemStatus = status;
        if (pollFirst) await client.refetchQueries({ queryKey: job.queryKey, exact: true });
        const event = { jobId: 'batch', type: 'updated', payload: { status: 'running' } };
        refresh.schedule(event);
        await vi.advanceTimersByTimeAsync(500);
        expect(client.getQueryData(ledger.queryKey)).toEqual({ refunded: true });
        expect(readLedger).toHaveBeenCalledTimes(2);
        refresh.schedule(event);
        await vi.advanceTimersByTimeAsync(500);
        expect(readLedger).toHaveBeenCalledTimes(2);
      } finally {
        refresh.dispose();
        cleanups.forEach((cleanup) => cleanup());
        client.clear();
      }
    },
  );

  it('cancels old workspace work and ignores late events after cleanup', async () => {
    vi.useFakeTimers();
    const oldWorkspace = vi.fn();
    const newWorkspace = vi.fn();
    const oldRefresh = createJobEventRefresh(oldWorkspace);
    const newRefresh = createJobEventRefresh(newWorkspace);
    oldRefresh.schedule();
    await vi.advanceTimersByTimeAsync(200);
    oldRefresh.dispose();
    oldRefresh.schedule();
    newRefresh.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(oldWorkspace).not.toHaveBeenCalled();
    expect(newWorkspace).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    newRefresh.dispose();
  });
});

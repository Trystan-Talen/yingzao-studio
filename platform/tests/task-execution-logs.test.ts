/** Isolated storage and synthetic responses; no external model calls. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../src/contracts/core';
import type { ExecutionAttemptEvent, TaskExecutionLogsDto } from '../src/contracts/task-execution';
import { jobInputSchema } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import {
  createExecutionLogSink,
  createBriefExecutionLogSink,
  getTaskExecutionLogs,
} from '../src/server/tasks/execution-logs';
import {
  emitExecutionAttempt,
  runWithExecutionAudit,
  sanitizeExecutionMetadata,
  withExecutionResource,
} from '../src/server/providers/execution-audit';

let folder: string,
  instance: Awaited<ReturnType<typeof createApp>>,
  actor: Actor,
  wid: string,
  cookie: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'task-log-test-'));
  instance = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(folder, 'test.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'task-log-session',
      encryptionKey: 'task-log-encryption',
      demoMode: false,
      isProduction: false,
      environmentSecrets: { openai: 'fixture-not-a-real-key' },
    },
    { serveWeb: false },
  );
  const registration = await instance.services.core.auth.register({
    email: 'logs@example.local',
    password: 'TaskLogTest2026!',
    displayName: '日志测试',
  });
  actor = {
    userId: registration.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registration.workspace.id;
  instance.services.credits.forChannel('web').grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'task-logs-fixture',
    amount: 500,
    source: 'manual',
    description: 'Isolated task log fixture',
  });
  cookie = `studio_session=${registration.sessionToken}`;
});
afterEach(async () => {
  await instance.app.close();
  await rm(folder, { recursive: true, force: true });
});
function createJob() {
  const input = jobInputSchema.parse({
    providerId: 'openai',
    operation: 'image.generate',
    prompt: 'synthetic product fixture',
  });
  const quote = instance.services.quote(actor, wid, input);
  return instance.services.submit(actor, wid, input, quote.id, randomUUID());
}
function read(jobId: string, query = '') {
  return instance.app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${jobId}/execution-logs${query}`,
    headers: { cookie, 'x-workspace-id': wid },
  });
}

describe('administrator task execution logs', () => {
  it('distinguishes an unclaimed local queue from waiting on an accepted upstream job', async () => {
    const job = createJob();
    const response = await read(job.id);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json().data).toMatchObject({
      diagnosis: expect.stringContaining('执行器尚未领取'),
      logs: [],
      total: 0,
      items: [{ attempts: 0, remoteId: null, leaseActive: false }],
    });
    instance.services.db.sqlite
      .prepare(
        "UPDATE job_items SET status='running',phase='polling',remote_id='upstream-123',attempts=1 WHERE job_id=?",
      )
      .run(job.id);
    const polling = getTaskExecutionLogs(instance.services, actor, wid, job.id);
    expect(polling.diagnosis).toContain('状态查询阶段');
    expect(polling.items[0]?.remoteId).toBe('upstream-123');
  });

  it('stores bounded useful metadata and redacts credentials even when upstream echoes them', async () => {
    const job = createJob();
    const secret = 'private-fixture-credential-9876';
    const sink = createExecutionLogSink(instance.services.db, {
      workspaceId: wid,
      jobId: job.id,
      itemId: job.items[0]!.id,
      providerId: 'native',
    });
    runWithExecutionAudit(sink, () =>
      withExecutionResource(
        {
          id: 'primary',
          name: '首选接口',
          baseUrl: 'https://example.test/v1?token=hidden',
          model: 'fixture-model',
        },
        () =>
          emitExecutionAttempt(
            {
              attemptId: 'attempt-1',
              action: 'submit',
              status: 'uncertain',
              httpStatus: 503,
              message: `upstream rejected ${secret}`,
              requestId: 'trace-123',
              metadata: {
                error: {
                  code: 'overloaded',
                  message: `${secret} Bearer secret-secret sk-fixture1234567890`,
                },
                request_id: 'trace-123',
                usage: { total_tokens: 8 },
                api_key: secret,
                data: [
                  {
                    b64_json: 'A'.repeat(50000),
                    url: 'https://private.test/image?token=secret',
                    id: 'result-id',
                  },
                ],
              },
            },
            [secret],
          ),
      ),
    );
    const raw = instance.services.db.sqlite
      .prepare('SELECT event_json FROM job_execution_logs')
      .get() as { event_json: string };
    expect(raw.event_json).not.toContain(secret);
    expect(raw.event_json).not.toContain('sk-fixture');
    expect(raw.event_json).not.toContain('token=');
    expect(raw.event_json).not.toContain('b64_json');
    expect(raw.event_json).not.toContain('private.test');
    const result = (await read(job.id)).json().data as TaskExecutionLogsDto;
    expect(result.logs[0]).toMatchObject({
      resource: { name: '首选接口', baseUrl: 'https://example.test/v1' },
      httpStatus: 503,
      requestId: 'trace-123',
      metadata: { error: { code: 'overloaded' }, usage: { total_tokens: 8 } },
    });
    expect(
      instance.services.db.sqlite
        .prepare('SELECT COUNT(*) n FROM job_events WHERE payload LIKE ?')
        .get('%trace-123%'),
    ).toEqual({ n: 0 });
  });

  it('rejects members and viewers, permits administrators, and keeps workspace boundaries', async () => {
    const job = createJob();
    for (const role of ['member', 'viewer']) {
      instance.services.db.sqlite
        .prepare('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?')
        .run(role, wid, actor.userId);
      expect((await read(job.id)).statusCode).toBe(403);
    }
    instance.services.db.sqlite
      .prepare("UPDATE memberships SET role='admin' WHERE workspace_id=? AND user_id=?")
      .run(wid, actor.userId);
    expect((await read(job.id)).statusCode).toBe(200);
    const other = instance.services.core.auth.createWorkspace(actor.userId, '另一空间', 'team');
    const oldWid = wid;
    wid = other.id;
    expect((await read(job.id)).statusCode).toBe(404);
    wid = oldWid;
    expect((await read(randomUUID())).statusCode).toBe(404);
    expect(
      (await instance.app.inject({ method: 'GET', url: `/api/v1/jobs/${job.id}/execution-logs` }))
        .statusCode,
    ).toBe(401);
  });

  it('paginates logs without silently dropping old attempts and validates bounds', async () => {
    const job = createJob();
    const sink = createExecutionLogSink(instance.services.db, {
      workspaceId: wid,
      jobId: job.id,
      itemId: job.items[0]!.id,
      providerId: 'openai',
    });
    for (let i = 0; i < 35; i++)
      sink({ action: 'poll', status: 'running', requestId: `request-${i}` });
    const first = (await read(job.id)).json().data as TaskExecutionLogsDto;
    const second = (await read(job.id, '?page=2')).json().data as TaskExecutionLogsDto;
    expect(first.total).toBe(35);
    expect(first.logs).toHaveLength(30);
    expect(second.logs).toHaveLength(5);
    expect(new Set([...first.logs, ...second.logs].map((row) => row.id)).size).toBe(35);
    expect((await read(job.id, '?pageSize=101')).statusCode).toBe(400);
    expect((await read(job.id, '?page=-1')).statusCode).toBe(400);
  });

  it('links the actual planning chain but never follows a previous brief into another workspace', () => {
    const job = createJob();
    const other = instance.services.core.auth.createWorkspace(actor.userId, '日志隔离空间', 'team');
    const sql = instance.services.db.sqlite;
    const makeBrief = (workspaceId: string, previous: string | null) => {
      const id = randomUUID();
      sql
        .prepare(
          'INSERT INTO creative_briefs(id,workspace_id,user_id,request_id,previous_id,input_fingerprint,input_json,request_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          workspaceId,
          actor.userId,
          randomUUID(),
          previous,
          'fixture-fingerprint',
          JSON.stringify(job.input),
          '{}',
          'ready',
          new Date().toISOString(),
          new Date().toISOString(),
        );
      createBriefExecutionLogSink(instance.services.db, {
        workspaceId,
        briefId: id,
        providerId: 'native',
      })({
        action: 'submit',
        status: 'succeeded',
        requestId: workspaceId === wid ? 'own-plan' : 'foreign-plan',
        resource: { id: 'text-backup', name: '备用文本资源', model: 'planner-fixture' },
      });
      return id;
    };
    const foreign = makeBrief(other.id, null);
    const previous = makeBrief(wid, foreign);
    const current = makeBrief(wid, previous);
    const snapshot = JSON.stringify({ ...job.input, creativeBriefId: current });
    sql.prepare('UPDATE jobs SET input_json=? WHERE id=?').run(snapshot, job.id);
    sql.prepare('UPDATE job_items SET input_json=? WHERE job_id=?').run(snapshot, job.id);
    const result = getTaskExecutionLogs(instance.services, actor, wid, job.id);
    expect(result.logs).toHaveLength(2);
    expect(
      result.logs.every((log) => log.origin === 'planning' && log.requestId === 'own-plan'),
    ).toBe(true);
    expect(result.logs.map((log) => log.briefId).sort()).toEqual([previous, current].sort());
    expect(JSON.stringify(result)).not.toContain('foreign-plan');
  });

  it('explains uncertain outcomes without claiming they are known failures or inventing past responses', () => {
    const job = createJob();
    instance.services.db.sqlite
      .prepare(
        "UPDATE job_items SET status='reconciliation_required',phase='uncertain',attempts=1,error_message=?,remote_json=? WHERE job_id=?",
      )
      .run(
        '服务商返回错误（503）。',
        JSON.stringify({
          id: 'remote',
          submittedAt: '2026-11-15T10:00:00Z',
          statusUrl: 'https://example.test?api_key=private',
          token: 'private',
        }),
        job.id,
      );
    const result = getTaskExecutionLogs(instance.services, actor, wid, job.id);
    expect(result.diagnosis).toContain('停止自动重发');
    expect(result.waitingForReconciliation).toBe(1);
    expect(result.logs).toEqual([]);
    expect(result.items[0]?.upstreamMetadata).toEqual({
      id: 'remote',
      submittedAt: '2026-11-15T10:00:00Z',
    });
  });

  it('isolates resource and sink context across overlapping asynchronous calls', async () => {
    const a: ExecutionAttemptEvent[] = [],
      b: ExecutionAttemptEvent[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runWithExecutionAudit(
      (event) => a.push(event),
      () =>
        withExecutionResource({ id: 'a', name: '资源甲' }, async () => {
          await gate;
          emitExecutionAttempt({ action: 'submit', status: 'succeeded' });
        }),
    );
    await runWithExecutionAudit(
      (event) => b.push(event),
      () =>
        withExecutionResource({ id: 'b', name: '资源乙' }, async () => {
          emitExecutionAttempt({ action: 'poll', status: 'running' });
          release();
        }),
    );
    await first;
    expect(a).toMatchObject([{ resource: { id: 'a' }, action: 'submit' }]);
    expect(b).toMatchObject([{ resource: { id: 'b' }, action: 'poll' }]);
    emitExecutionAttempt({ action: 'submit', status: 'started' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('caps recursive metadata and excludes arbitrary request bodies', () => {
    const value = {
      message: 'X'.repeat(50000),
      data: Array.from({ length: 500 }, () => ({
        message: 'Y'.repeat(10000),
        prompt: 'private prompt',
        image: 'private image',
      })),
      headers: { authorization: 'private' },
    };
    const result = JSON.stringify(sanitizeExecutionMetadata(value));
    expect(result.length).toBeLessThan(14000);
    expect(result).not.toContain('private');
    expect(result).toContain('已截断');
    let numeric: unknown = Array.from({ length: 12 }, (_, index) => index);
    for (let depth = 0; depth < 4; depth++) numeric = Array.from({ length: 12 }, () => numeric);
    expect(JSON.stringify(sanitizeExecutionMetadata(numeric)).length).toBeLessThanOrEqual(16000);
    expect(
      JSON.stringify(
        sanitizeExecutionMetadata({ error: { message: 'Invalid abc credential' } }, ['abc']),
      ),
    ).not.toContain('abc');
  });
});

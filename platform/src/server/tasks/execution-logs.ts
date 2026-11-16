import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Actor, Permission } from '../../contracts/core';
import { jobInputSchema } from '../../contracts/jobs';
import type { ExecutionAttemptEvent, TaskExecutionLogsDto } from '../../contracts/task-execution';
import type { DatabaseContext } from '../db/connection';
import { sanitizeExecutionEvent, sanitizeExecutionMetadata } from '../providers/execution-audit';
import type { TaskServices } from './service';
import { now, type ItemRow } from './types';

export function createExecutionLogSink(
  db: DatabaseContext,
  scope: { workspaceId: string; jobId: string; itemId: string; providerId: string },
) {
  return (event: ExecutionAttemptEvent) => {
    db.sqlite
      .prepare(
        'INSERT INTO job_execution_logs(workspace_id,job_id,item_id,provider_id,event_json,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(
        scope.workspaceId,
        scope.jobId,
        scope.itemId,
        scope.providerId,
        JSON.stringify(sanitizeExecutionEvent(event)),
        now(),
      );
  };
}

function parseMetadata(value: string | null) {
  if (!value) return null;
  try {
    return sanitizeExecutionMetadata(JSON.parse(value));
  } catch {
    return null;
  }
}
export function createBriefExecutionLogSink(
  db: DatabaseContext,
  scope: { workspaceId: string; briefId: string; providerId: string },
) {
  return (event: ExecutionAttemptEvent) => {
    db.sqlite
      .prepare(
        'INSERT INTO brief_execution_logs(workspace_id,brief_id,provider_id,event_json,created_at) VALUES(?,?,?,?,?)',
      )
      .run(
        scope.workspaceId,
        scope.briefId,
        scope.providerId,
        JSON.stringify(sanitizeExecutionEvent(event)),
        now(),
      );
  };
}

export function getTaskExecutionLogs(
  s: TaskServices,
  actor: Actor,
  wid: string,
  jobId: string,
  page = 1,
  pageSize = 30,
): TaskExecutionLogsDto {
  s.core.requireAccess(actor, wid, 'manage');
  const job = s.get(actor, wid, jobId);
  const sql = s.db.sqlite;
  const items = sql
    .prepare('SELECT * FROM job_items WHERE job_id=? AND workspace_id=? ORDER BY item_index')
    .all(jobId, wid) as ItemRow[];
  const briefIds = new Set<string>();
  const pending = [
    job.input.creativeBriefId,
    ...items.map((item) => jobInputSchema.parse(JSON.parse(item.input_json)).creativeBriefId),
  ].filter((id): id is string => !!id);
  // Follow only this workspace's immutable planning chain, never a client-supplied foreign ID.
  for (let cursor = 0; cursor < pending.length && cursor < 100; cursor++) {
    const id = pending[cursor]!;
    if (briefIds.has(id)) continue;
    const brief = sql
      .prepare('SELECT id,previous_id FROM creative_briefs WHERE workspace_id=? AND id=?')
      .get(wid, id) as { id: string; previous_id: string | null } | undefined;
    if (!brief) continue;
    briefIds.add(brief.id);
    if (brief.previous_id) pending.push(brief.previous_id);
  }
  const union = `SELECT 'execution' AS origin,id,item_id,NULL AS brief_id,provider_id,event_json,created_at FROM job_execution_logs WHERE workspace_id=? AND job_id=? UNION ALL SELECT 'planning' AS origin,id,NULL AS item_id,brief_id,provider_id,event_json,created_at FROM brief_execution_logs WHERE workspace_id=? AND brief_id IN (${[...briefIds].map(() => '?').join(',') || 'NULL'})`;
  const values = [wid, jobId, wid, ...briefIds];
  const count = sql.prepare(`SELECT COUNT(*) AS n FROM (${union})`).get(...values) as { n: number };
  const waiting = sql
    .prepare(
      "SELECT COUNT(*) AS n FROM job_items WHERE workspace_id=? AND status='reconciliation_required'",
    )
    .get(wid) as { n: number };
  const rows = sql
    .prepare(`SELECT * FROM (${union}) ORDER BY created_at DESC,origin,id DESC LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize) as {
    id: number;
    item_id: string | null;
    brief_id: string | null;
    origin: 'planning' | 'execution';
    provider_id: string;
    event_json: string;
    created_at: string;
  }[];
  const lifecycle = sql
    .prepare(
      'SELECT id,type,payload,created_at FROM job_events WHERE workspace_id=? AND job_id=? ORDER BY id DESC LIMIT 100',
    )
    .all(wid, jobId) as {
    id: number;
    type: string;
    payload: string;
    created_at: string;
  }[];
  const unclaimed = items.every((item) => item.status === 'queued' && item.attempts === 0);
  const hasUnknown = items.some((item) => item.status === 'reconciliation_required');
  const polling = items.some(
    (item) => item.status === 'running' && item.phase === 'polling' && item.remote_id,
  );
  const diagnosis = unclaimed
    ? '任务仍在本机队列，执行器尚未领取，尚未提交生成请求。此前需求规划见关联记录。请检查执行器运行状态与队列并发。'
    : hasUnknown
      ? '至少一项提交结果需要核对。系统保留该项额度并停止自动重发，避免重复生成；请根据上游请求编号与元数据核对。'
      : polling
        ? '上游已返回任务编号，当前处于状态查询阶段；轮询记录可核对请求时间与上游返回状态。'
        : job.status === 'running'
          ? '执行器已领取任务，正在处理。调用记录用于区分请求等待、上游处理与本机产物保存。'
          : ['failed', 'cancelled'].includes(job.status)
            ? '任务已结束，未成功的原因请查看条目说明及调用结果。'
            : job.status === 'succeeded'
              ? '任务已完成，结果已保存；调用记录说明实际使用的资源与上游响应。'
              : '请结合条目状态、阶段与调用记录核对本次任务。';
  return {
    jobId,
    providerId: job.providerId,
    status: job.status,
    stage: job.stage,
    diagnosis,
    waitingForReconciliation: waiting.n,
    items: items.map((item) => ({
      id: item.id,
      index: item.item_index,
      status: item.status,
      phase: item.phase,
      attempts: item.attempts,
      recoveryFailures: item.recovery_failures,
      remoteId: item.remote_id,
      errorMessage: item.error_message
        ? String(sanitizeExecutionMetadata(item.error_message))
        : null,
      nextAttemptAt: item.next_attempt_at,
      leaseUntil: item.lease_until,
      leaseActive:
        !!item.lease_owner && !!item.lease_until && Date.parse(item.lease_until) > Date.now(),
      upstreamMetadata: parseMetadata(item.remote_json),
    })),
    lifecycle: lifecycle.map((event) => ({
      id: event.id,
      type: event.type,
      createdAt: event.created_at,
      details: parseMetadata(event.payload),
    })),
    logs: rows.map((row) => ({
      ...sanitizeExecutionEvent(JSON.parse(row.event_json) as ExecutionAttemptEvent),
      id: row.id,
      itemId: row.item_id,
      briefId: row.brief_id,
      origin: row.origin,
      providerId: row.provider_id,
      createdAt: row.created_at,
    })),
    total: count.n,
    page,
    pageSize,
    generatedAt: now(),
  };
}

export function registerExecutionLogRoutes(
  app: FastifyInstance,
  s: TaskServices,
  access: (
    req: FastifyRequest,
    permission?: Permission,
    scope?: string,
  ) => Promise<{ actor: Actor; wid: string }>,
) {
  const params = z.object({ id: z.string().uuid() });
  const query = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
  });
  app.get(
    '/api/v1/jobs/:id/execution-logs',
    { schema: { params, querystring: query } },
    async (req, reply) => {
      const { actor, wid } = await access(req, 'manage', 'jobs:read');
      const paging = query.parse(req.query);
      reply.header('Cache-Control', 'private, no-store');
      return {
        data: getTaskExecutionLogs(
          s,
          actor,
          wid,
          params.parse(req.params).id,
          paging.page,
          paging.pageSize,
        ),
      };
    },
  );
}

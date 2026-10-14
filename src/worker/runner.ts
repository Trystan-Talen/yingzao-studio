import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jobInputSchema } from '../contracts/jobs';
import type { ProviderId } from '../contracts/catalog';
import type { TaskServices } from '../server/tasks/service';
import type { PreparedAsset } from '../server/core';
import {
  now,
  actorForJob,
  ProviderError,
  type ItemRow,
  type ProviderAdapter,
  type ProviderOutput,
  type ProviderResult,
  type RemoteTask,
} from '../server/tasks/types';
import { openaiProvider } from '../server/providers/openai';
import { falProvider } from '../server/providers/fal';
import { flyelepProvider } from '../server/providers/flyelep';
import { localProvider } from '../server/providers/local';
import { downloadPublicMedia } from '../server/providers/http';
import { AppError } from '../server/errors';
interface StoredResult {
  outputKind: 'single' | 'layers';
  outputs: StoredOutput[];
  billingDisposition?: 'no-visible-text';
}
function readStoredResult(raw: string): StoredResult {
  const value = JSON.parse(raw) as StoredResult | StoredOutput[];
  return Array.isArray(value) ? { outputKind: 'single', outputs: value } : value;
}
interface StoredOutput {
  path?: string;
  url?: string;
  mimeType: string;
  name: string;
  text?: string;
}
export function createWorker(
  services: TaskServices,
  overrides: Partial<Record<ProviderId, ProviderAdapter>> = {},
) {
  const { db, core, config } = services,
    sql = db.sqlite;
  const owner = randomUUID();
  const adapters: Record<ProviderId, ProviderAdapter> = {
    openai: openaiProvider,
    fal: falProvider,
    flyelep: flyelepProvider,
    local: localProvider,
    ...overrides,
  };
  let stopped = false;
  const running = new Set<Promise<void>>();
  const textChecks = new Map<string, Promise<boolean>>();
  function recover() {
    services.transaction(() => {
      const expired = sql
        .prepare("SELECT * FROM job_items WHERE status='running' AND lease_until<?")
        .all(now()) as ItemRow[];
      for (const i of expired) {
        const input = jobInputSchema.parse(JSON.parse(i.input_json));
        if (i.phase === 'submitting' && input.providerId !== 'local') {
          sql
            .prepare(
              "UPDATE job_items SET status='reconciliation_required',error_message=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?",
            )
            .run('请求可能已被服务商接受，重启后不能自动重复提交。请核对服务商结果。', now(), i.id);
        } else {
          const resume = i.phase === 'polling' || i.phase === 'downloading';
          sql
            .prepare(
              'UPDATE job_items SET status=?,phase=?,lease_owner=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=?',
            )
            .run(resume ? 'running' : 'queued', resume ? i.phase : 'queued', now(), now(), i.id);
        }
        services.refresh(i.job_id);
      }
    });
  }
  function authorizeUnsubmitted(i: ItemRow): void {
    const input = jobInputSchema.parse(JSON.parse(i.input_json));
    if (input.characterId) {
      const character = core.identity.assertCanReference(
        actorForJob(i),
        i.workspace_id,
        input.characterId,
      );
      if (character.referenceRevision !== input.characterRevision)
        throw new AppError(409, 'CHARACTER_REFERENCE_CHANGED', '人物参考素材或授权已改变');
    }
    const job = sql.prepare('SELECT api_key_id FROM jobs WHERE id=?').get(i.job_id) as
      { api_key_id: string | null } | undefined;
    if (job?.api_key_id) {
      const key = sql.prepare('SELECT scopes_json FROM api_keys WHERE id=?').get(job.api_key_id) as
        { scopes_json: string } | undefined;
      const actor = {
        ...actorForJob(i),
        authType: 'apiKey' as const,
        apiKeyId: job.api_key_id,
        workspaceId: i.workspace_id,
        scopes: key ? (JSON.parse(key.scopes_json) as string[]) : [],
      };
      core.requireAccess(actor, i.workspace_id, 'write');
      core.requireScope(actor, 'jobs:write');
    } else core.requireAccess(actorForJob(i), i.workspace_id, 'write');
  }
  function claim(): ItemRow | undefined {
    return services.transaction(() => {
      const candidates = sql
        .prepare(
          "SELECT * FROM job_items WHERE (status='queued' OR (status='running' AND phase IN('polling','downloading'))) AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY CASE WHEN status='running' THEN 0 ELSE 1 END,created_at,item_index LIMIT 100",
        )
        .all(now(), now()) as ItemRow[];
      for (const i of candidates) {
        const input = jobInputSchema.parse(JSON.parse(i.input_json));
        if (i.status === 'queued') {
          try {
            authorizeUnsubmitted(i);
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            sql
              .prepare(
                "UPDATE job_items SET status='cancelled',phase='done',error_message=?,updated_at=? WHERE id=?",
              )
              .run('提交者已失去创作权限，尚未执行的任务已取消。', now(), i.id);
            services.credits.finish(i.workspace_id, i.user_id, i.credits, i.job_id, i.id, false);
            services.refresh(i.job_id);
            continue;
          }
          const count = (
            sql
              .prepare(
                "SELECT COUNT(*) AS n FROM job_items WHERE workspace_id=? AND status IN('running','reconciliation_required')",
              )
              .get(i.workspace_id) as { n: number }
          ).n;
          const configuredLimit =
            (
              sql
                .prepare('SELECT concurrency_limit FROM workspace_billing WHERE workspace_id=?')
                .get(i.workspace_id) as { concurrency_limit: number } | undefined
            )?.concurrency_limit || 2;
          const limit = Math.min(
            configuredLimit,
            core.entitlements.effective(i.workspace_id).limits.concurrency,
          );
          const providerCount = (
            sql
              .prepare(
                "SELECT COUNT(*) AS n FROM job_items i JOIN jobs j ON j.id=i.job_id WHERE j.provider_id=? AND i.status IN('running','reconciliation_required')",
              )
              .get(input.providerId) as { n: number }
          ).n;
          if (count >= limit || providerCount >= 4) continue;
        }
        const until = new Date(Date.now() + 120000).toISOString();
        const changed = sql
          .prepare(
            "UPDATE job_items SET status='running',phase=CASE WHEN phase='queued' THEN 'claimed' ELSE phase END,lease_owner=?,lease_until=?,fence=fence+1,attempts=attempts+1,updated_at=? WHERE id=? AND fence=? AND (lease_until IS NULL OR lease_until<?)",
          )
          .run(owner, until, now(), i.id, i.fence, now());
        if (changed.changes) {
          sql
            .prepare("UPDATE jobs SET status='running',stage='准备素材',updated_at=? WHERE id=?")
            .run(now(), i.job_id);
          services.event(i.workspace_id, i.job_id, 'started', { itemId: i.id });
          return sql.prepare('SELECT * FROM job_items WHERE id=?').get(i.id) as ItemRow;
        }
      }
      return undefined;
    });
  }
  function owns(i: ItemRow) {
    return Boolean(
      sql
        .prepare(
          "SELECT 1 FROM job_items WHERE id=? AND lease_owner=? AND fence=? AND status='running' AND lease_until>?",
        )
        .get(i.id, owner, i.fence, now()),
    );
  }
  function stage(i: ItemRow, value: string) {
    if (owns(i))
      sql.prepare('UPDATE jobs SET stage=?,updated_at=? WHERE id=?').run(value, now(), i.job_id);
  }
  function fail(i: ItemRow, message: string, uncertain: boolean) {
    services.transaction(() => {
      if (!owns(i)) return;
      sql
        .prepare(
          'UPDATE job_items SET status=?,phase=?,error_message=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND fence=?',
        )
        .run(
          uncertain ? 'reconciliation_required' : 'failed',
          uncertain ? 'uncertain' : 'done',
          message,
          now(),
          i.id,
          i.fence,
        );
      if (!uncertain)
        services.credits.finish(i.workspace_id, i.user_id, i.credits, i.job_id, i.id, false);
      services.refresh(i.job_id);
    });
  }
  async function storeOutputs(i: ItemRow, outputs: ProviderOutput[]): Promise<StoredOutput[]> {
    const dir = join(config.storageDir, '.job-results');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stored: StoredOutput[] = [];
    for (const [n, o] of outputs.entries()) {
      if (o.buffer) {
        const path = join(dir, `${i.id}-${i.fence}-${n}.bin`);
        await writeFile(path, o.buffer, { mode: 0o600 });
        stored.push({ path, name: o.name, mimeType: o.mimeType, text: o.text });
      } else stored.push({ url: o.url, text: o.text, mimeType: o.mimeType, name: o.name });
    }
    return stored;
  }
  async function finish(i: ItemRow, result: StoredResult) {
    const outputs = result.outputs;
    const input = jobInputSchema.parse(JSON.parse(i.input_json));
    const waived = result.billingDisposition === 'no-visible-text';
    if (waived && (input.operation !== 'image-translate' || input.providerId !== 'openai'))
      throw new ProviderError('不支持此任务的免扣费结果，需核对服务商结果。', true);
    const projectId = input.projectId || null;
    const context = {
      workspaceId: i.workspace_id,
      createdBy: i.user_id,
      projectId,
      jobId: i.job_id,
    };
    if (!outputs.length)
      throw new ProviderError('服务没有返回任何产物。', input.providerId !== 'local');
    const layered =
      result.outputKind === 'layers' &&
      input.operation === 'image.layers' &&
      input.providerId === 'fal';
    if ((result.outputKind === 'layers' && !layered) || outputs.length > (layered ? 10 : 1))
      throw new ProviderError('单项任务返回了多个未关联产物，需要人工核对，未自动结算。', true);
    const prepared: PreparedAsset[] = [];
    for (const output of outputs) {
      if (output.path || output.url) {
        const buffer = output.path
          ? await readFile(output.path)
          : await downloadPublicMedia(output.url!);
        prepared.push(
          await core.assets.prepare({
            buffer,
            name: output.name,
            mimeType: output.mimeType,
            projectId: projectId || undefined,
            source: input.providerId === 'local' ? 'local-processing' : 'generation',
            sourceJobId: i.job_id,
          }),
        );
      }
    }
    if (layered && (prepared.length !== outputs.length || prepared.some((a) => a.kind !== 'image')))
      throw new ProviderError('图层结果必须全部为有效图片。', true);
    if (
      layered &&
      prepared.some((a) => a.width !== prepared[0]!.width || a.height !== prepared[0]!.height)
    )
      throw new ProviderError('分层图片画幅不一致，需核对供应商产物。', true);
    const resultText =
      outputs
        .map((o) => o.text ?? '')
        .filter(Boolean)
        .join('\n') || null;
    if (!prepared.length && !resultText)
      throw new ProviderError('服务返回了空产物。', input.providerId !== 'local');
    services.transaction(() => {
      if (!owns(i)) return;
      const assets = prepared.map((p) => core.assets.commitPreparedForJob(context, p)),
        asset = assets[0] ?? null;
      for (const [index, a] of assets.entries())
        sql.prepare('INSERT INTO job_item_assets VALUES (?,?,?)').run(i.id, a.id, index);
      sql
        .prepare('UPDATE job_items SET output_kind=? WHERE id=?')
        .run(layered ? 'layers' : 'single', i.id);
      sql
        .prepare(
          "UPDATE job_items SET status='succeeded',phase='done',asset_id=?,result_text=?,lease_owner=NULL,lease_until=NULL,error_message=NULL,updated_at=? WHERE id=? AND fence=?",
        )
        .run(asset?.id || null, resultText, now(), i.id, i.fence);
      services.credits.finish(
        i.workspace_id,
        i.user_id,
        i.credits,
        i.job_id,
        i.id,
        !waived,
        waived ? '未检测到文字，任务保留原图并释放预留' : undefined,
      );
      if (waived)
        core.context.audit(actorForJob(i), i.workspace_id, 'job.no_visible_text', 'job', i.job_id, {
          itemId: i.id,
          releasedCredits: i.credits,
        });
      if (asset && input.documentId && input.baseRevision) {
        sql
          .prepare(
            'INSERT OR IGNORE INTO pending_applies(id,workspace_id,document_id,job_id,item_id,asset_id,base_revision,target_layer_id,status,created_at,updated_at,asset_ids_json,output_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            randomUUID(),
            i.workspace_id,
            input.documentId,
            i.job_id,
            i.id,
            asset.id,
            input.baseRevision,
            input.targetLayerId || null,
            'pending',
            now(),
            now(),
            JSON.stringify(assets.map((a) => a.id)),
            layered ? 'layers' : 'single',
          );
      }
      if (projectId) {
        sql.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run(
          randomUUID(),
          i.workspace_id,
          projectId,
          i.user_id,
          'assistant',
          resultText ||
            (asset?.kind === 'video'
              ? '视频已完成，可预览并添加到画布。'
              : '图片已完成，可预览并添加到画布。'),
          i.job_id,
          JSON.stringify({
            assetId: asset?.id || null,
            assetIds: assets.map((a) => a.id),
            outputKind: layered ? 'layers' : 'single',
          }),
          now(),
        );
        if (asset)
          sql
            .prepare(
              'UPDATE projects SET cover_asset_id=COALESCE(cover_asset_id,?),updated_at=? WHERE id=?',
            )
            .run(asset.id, now(), projectId);
      }
      services.refresh(i.job_id);
    });
  }
  async function runItem(i: ItemRow) {
    if (!owns(i)) return;
    const input = jobInputSchema.parse(JSON.parse(i.input_json)),
      adapter = adapters[input.providerId];
    const timer = setInterval(() => {
      if (owns(i))
        sql
          .prepare('UPDATE job_items SET lease_until=? WHERE id=? AND lease_owner=? AND fence=?')
          .run(new Date(Date.now() + 120000).toISOString(), i.id, owner, i.fence);
    }, 20000);
    timer.unref();
    try {
      const secret = services.settings.secret(i.workspace_id, input.providerId);
      if (i.phase === 'downloading' && i.result_json) {
        stage(i, '保存原始产物');
        await finish(i, readStoredResult(i.result_json));
        return;
      }
      let result: ProviderResult;
      if (i.phase === 'polling' && i.remote_json) {
        if (!adapter.poll || !secret)
          throw new ProviderError('无法恢复任务，请检查服务配置。', true);
        const remote = JSON.parse(i.remote_json) as RemoteTask;
        if (i.cancel_requested && adapter.cancel) {
          try {
            await adapter.cancel(remote, secret);
            stage(i, '已申请取消，等待服务商确认');
          } catch {
            /* A cancellation signal does not prove a terminal outcome. */
          }
          sql
            .prepare('UPDATE job_items SET cancel_requested=0 WHERE id=? AND fence=?')
            .run(i.id, i.fence);
        }
        result = await adapter.poll(remote, secret);
      } else {
        try {
          authorizeUnsubmitted(i);
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          services.transaction(() => {
            if (!owns(i)) return;
            sql
              .prepare(
                "UPDATE job_items SET status='cancelled',phase='done',lease_owner=NULL,lease_until=NULL,error_message=?,updated_at=? WHERE id=?",
              )
              .run('执行前授权已撤销，任务已取消。', now(), i.id);
            services.credits.finish(i.workspace_id, i.user_id, i.credits, i.job_id, i.id, false);
            services.refresh(i.job_id);
          });
          return;
        }
        const jobContext = {
          workspaceId: i.workspace_id,
          createdBy: i.user_id,
          projectId: input.projectId || null,
          jobId: i.job_id,
        };
        const allowedIds = new Set([
          ...input.assetIds,
          ...input.referenceAssetIds,
          ...(input.maskAssetId ? [input.maskAssetId] : []),
        ]);
        const lease = sql
          .prepare(
            "UPDATE job_items SET phase='submitting',updated_at=? WHERE id=? AND lease_owner=? AND fence=? AND status='running' AND lease_until>?",
          )
          .run(now(), i.id, owner, i.fence, now());
        if (lease.changes !== 1) return;
        stage(i, input.providerId === 'local' ? '本机正在处理' : '请求模型服务');
        result = await adapter.execute(
          {
            actor: actorForJob(i),
            workspaceId: i.workspace_id,
            input,
            assetUrl: (id, variant = 'original') => {
              if (!allowedIds.has(id))
                throw new AppError(403, 'ASSET_REFERENCE', '素材未包含在本次任务中');
              if (variant === 'mask-white' && input.maskAssetId !== id)
                throw new AppError(403, 'MASK_REFERENCE', '此素材不是任务遮罩');
              return services.signedAssetUrl(i.workspace_id, i.user_id, i.job_id, id, variant);
            },
            readAsset: async (id) => {
              if (!allowedIds.has(id))
                throw new AppError(403, 'ASSET_REFERENCE', '素材未包含在本次任务中');
              return core.assets.readOriginalForJob(jobContext, id);
            },
            textPresence: async (id, detectorId, compute) => {
              if (input.operation !== 'image-translate' || !allowedIds.has(id))
                throw new AppError(403, 'TEXT_CHECK_REFERENCE', '文字预检素材不属于翻译任务');
              core.assets.get(actorForJob(i), i.workspace_id, id);
              const asset = sql
                .prepare('SELECT sha256 FROM assets WHERE id=? AND workspace_id=?')
                .get(id, i.workspace_id) as { sha256: string };
              const key = `${i.workspace_id}:${asset.sha256}:${detectorId}`;
              const cached = sql
                .prepare(
                  'SELECT has_text FROM translation_text_checks WHERE workspace_id=? AND asset_sha256=? AND detector_id=?',
                )
                .get(i.workspace_id, asset.sha256, detectorId) as { has_text: number } | undefined;
              if (cached) return cached.has_text === 1;
              const pending = textChecks.get(key);
              if (pending) return pending;
              const promise = compute()
                .then((hasText) => {
                  sql
                    .prepare('INSERT OR IGNORE INTO translation_text_checks VALUES(?,?,?,?,?)')
                    .run(i.workspace_id, asset.sha256, detectorId, hasText ? 1 : 0, now());
                  return hasText;
                })
                .finally(() => textChecks.delete(key));
              textChecks.set(key, promise);
              return promise;
            },
          },
          secret,
        );
      }
      if (!owns(i)) return;
      if (result.state === 'submitted') {
        stage(i, '模型已接受，等待结果');
        sql
          .prepare(
            "UPDATE job_items SET phase='polling',recovery_failures=0,remote_id=?,remote_json=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND fence=?",
          )
          .run(
            result.remote.id,
            JSON.stringify(result.remote),
            new Date(Date.now() + 5000).toISOString(),
            now(),
            i.id,
            i.fence,
          );
        return;
      }
      if (result.state === 'running') {
        sql
          .prepare(
            "UPDATE job_items SET phase='polling',recovery_failures=0,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND fence=?",
          )
          .run(new Date(Date.now() + 5000).toISOString(), now(), i.id, i.fence);
        sql
          .prepare('UPDATE jobs SET stage=?,updated_at=? WHERE id=?')
          .run(result.stage, now(), i.job_id);
        return;
      }
      if (result.state === 'failed') {
        fail(i, result.message, false);
        return;
      }
      const stored: StoredResult = {
        outputKind: result.outputKind ?? 'single',
        outputs: await storeOutputs(i, result.outputs),
        ...(result.billingDisposition ? { billingDisposition: result.billingDisposition } : {}),
      };
      sql
        .prepare(
          "UPDATE job_items SET phase='downloading',recovery_failures=0,result_json=?,updated_at=? WHERE id=? AND lease_owner=? AND fence=?",
        )
        .run(JSON.stringify(stored), now(), i.id, owner, i.fence);
      stage(i, '保存原始产物');
      await finish(i, stored);
    } catch (error) {
      const live = sql.prepare('SELECT * FROM job_items WHERE id=?').get(i.id) as
        ItemRow | undefined;
      if (!live || !owns(i)) return;
      if (
        (live.phase === 'polling' || live.phase === 'downloading') &&
        live.recovery_failures < 10
      ) {
        sql
          .prepare(
            'UPDATE job_items SET next_attempt_at=?,recovery_failures=recovery_failures+1,lease_owner=NULL,lease_until=NULL,error_message=?,updated_at=? WHERE id=? AND fence=?',
          )
          .run(
            new Date(
              Date.now() + Math.min(60000, 5000 * (live.recovery_failures + 1)),
            ).toISOString(),
            '暂时无法获取结果，稍后自动恢复',
            now(),
            i.id,
            i.fence,
          );
        return;
      }
      const uncertain =
        error instanceof ProviderError
          ? error.ambiguous
          : input.providerId !== 'local' && live.phase === 'submitting';
      fail(
        i,
        error instanceof ProviderError || error instanceof AppError
          ? error.message
          : '处理失败，请检查素材或服务配置。',
        uncertain ||
          (input.providerId !== 'local' && ['polling', 'downloading'].includes(live.phase)),
      );
    } finally {
      clearInterval(timer);
    }
  }
  async function tick() {
    recover();
    await core.assets.processPendingExtractions(2);
    while (!stopped && running.size < 2) {
      const item = claim();
      if (!item) break;
      const promise = runItem(item);
      running.add(promise);
      void promise.finally(() => running.delete(promise));
    }
  }
  async function drain() {
    await Promise.all([...running]);
  }
  return {
    tick,
    claim,
    runItem,
    recover,
    drain,
    stop: async () => {
      stopped = true;
      await drain();
    },
    owner,
  };
}

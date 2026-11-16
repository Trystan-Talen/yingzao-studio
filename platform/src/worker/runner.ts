import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { jobInputSchema, type JobInput } from '../contracts/jobs';
import {
  jobResultDataSchema,
  resultMatchesAssistantMode,
  type JobResultData,
} from '../contracts/job-result';
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
import { createOpenaiProvider } from '../server/providers/openai';
import { createDifyProvider } from '../server/providers/dify';
import { createSeedanceProvider } from '../server/providers/seedance';
import {
  createNativeProvider,
  readNativeFrame,
  validateNativeVideoArtifact,
} from '../server/providers/native';
import { validateNativeImageArtifact } from '../server/providers/native-image-spec';
import { renderNativeVideoTailHold } from '../server/providers/native-video-tail-hold';
import { inputHash } from '../server/tasks/validation';
import { falProvider } from '../server/providers/fal';
import { flyelepProvider } from '../server/providers/flyelep';
import { localProvider } from '../server/providers/local';
import { tikhubProvider } from '../server/providers/tikhub';
import { downloadPublicMedia } from '../server/providers/http';
import { composeErasureResult } from '../server/providers/erasure';
import { AppError } from '../server/errors';
import { runWithExecutionAudit, emitExecutionAttempt } from '../server/providers/execution-audit';
import { createExecutionLogSink } from '../server/tasks/execution-logs';
import { cleanupSucceededResults } from './result-cleanup';
import { currentJobStage, taskStage } from '../server/tasks/progress';
import {
  createNativeArtifacts,
  hasNativeProcessingCheckpoint,
  nativeArtifactFingerprint,
  validateNativeProcessing,
} from '../server/tasks/native-artifacts';

function recoveryError(phase: string, error: unknown): string {
  if (phase === 'processing')
    return '已有素材已保留，本机处理暂时中断。恢复只会处理已有素材，不会重新请求模型。';
  const saving = phase === 'downloading';
  const prefix = saving ? '结果已生成，但本机保存中断。' : '远程任务已保留，但查询暂时中断。';
  let reason = '连接或处理异常。';
  if (error instanceof ProviderError) {
    if (error.message.includes('DNS')) reason = '公共域名解析失败。';
    else if (error.message.includes('受保护网络')) reason = '下载地址未通过公网安全校验。';
    else if (error.message.includes('超时')) reason = '连接或传输超时。';
    else if (['PROVIDER_HTTP_401', 'PROVIDER_HTTP_403'].includes(error.code))
      reason = '服务凭据或权限需要检查。';
  }
  return `${prefix}${reason}恢复只会${saving ? '保存已有结果' : '查询同一任务'}，不会重新生成。`;
}
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
  resultData?: JobResultData;
  expectedImageSize?: ProviderOutput['expectedImageSize'];
  processing?: ProviderOutput['processing'];
}
export function createWorker(
  services: TaskServices,
  overrides: Partial<Record<ProviderId, ProviderAdapter>> = {},
) {
  const { db, core, config } = services,
    sql = db.sqlite;
  const owner = randomUUID();
  const adapters: Record<ProviderId, ProviderAdapter> = {
    tikhub: tikhubProvider,
    openai: createOpenaiProvider(config.imageGateway),
    dify: createDifyProvider(config.dify),
    seedance: createSeedanceProvider(config.seedance),
    native: createNativeProvider({}),
    fal: falProvider,
    flyelep: flyelepProvider,
    local: localProvider,
    ...overrides,
  };
  let stopped = false;
  let ticking: Promise<void> | undefined;
  const running = new Set<Promise<void>>();
  const textChecks = new Map<string, Promise<boolean>>();
  let nextResultCleanup = 0;
  let resultCleanupCursor: string | undefined;
  async function cleanupResults(itemId?: string) {
    try {
      const result = await cleanupSucceededResults(db, config.storageDir, {
        itemId,
        afterId: itemId ? undefined : resultCleanupCursor,
      });
      if (!itemId) resultCleanupCursor = result.nextCursor;
      if (result.deferred)
        console.warn(`Result cache cleanup deferred for ${result.deferred} item(s).`);
    } catch {
      console.warn('Result cache cleanup unavailable; completed task results remain valid.');
    }
  }
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
          const resume = ['polling', 'downloading', 'processing'].includes(i.phase);
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
  function* candidates(): Generator<ItemRow> {
    // Scan beyond a blocked first page without loading the entire queue. A stable
    // keyset also survives cancelling unauthorized items while this scan runs.
    let cursor: [number, string, number, string] = [-1, '', -1, ''];
    const time = now();
    const query = sql.prepare(
      "SELECT * FROM job_items WHERE (status='queued' OR (status='running' AND phase IN('polling','downloading','processing'))) AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<?) AND (CASE WHEN status='running' THEN 0 ELSE 1 END,created_at,item_index,id)>(?,?,?,?) ORDER BY CASE WHEN status='running' THEN 0 ELSE 1 END,created_at,item_index,id LIMIT 100",
    );
    for (;;) {
      const batch = query.all(time, time, ...cursor) as ItemRow[];
      if (!batch.length) return;
      yield* batch;
      const last = batch[batch.length - 1]!;
      cursor = [last.status === 'running' ? 0 : 1, last.created_at, last.item_index, last.id];
    }
  }
  function claim(): ItemRow | undefined {
    return services.transaction(() => {
      for (const i of candidates()) {
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
            services.credits
              .forChannel(i.billing_channel)
              .finish(i.workspace_id, i.user_id, i.credits, i.job_id, i.id, false);
            services.refresh(i.job_id);
            continue;
          }
          // Reconciliation keeps its credit reservation and cannot be resubmitted,
          // but has no active worker execution and must not deadlock the queue.
          const count = (
            sql
              .prepare(
                "SELECT COUNT(*) AS n FROM job_items WHERE workspace_id=? AND status='running'",
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
                "SELECT COUNT(*) AS n FROM job_items i JOIN jobs j ON j.id=i.job_id WHERE j.provider_id=? AND i.status='running'",
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
          const previous = sql.prepare('SELECT stage FROM jobs WHERE id=?').get(i.job_id) as {
            stage: string;
          };
          sql
            .prepare("UPDATE jobs SET status='running',stage=?,updated_at=? WHERE id=?")
            .run(
              currentJobStage([{ ...i, status: 'running', lease_owner: owner }], previous.stage),
              now(),
              i.job_id,
            );
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
    if (owns(i)) {
      const changed = sql
        .prepare('UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND stage<>?')
        .run(value, now(), i.job_id, value);
      if (changed.changes)
        services.event(i.workspace_id, i.job_id, 'updated', { status: 'running', stage: value });
    }
  }
  function fail(i: ItemRow, message: string, uncertain: boolean) {
    services.transaction(() => {
      if (!owns(i)) return;
      const live = sql.prepare('SELECT phase FROM job_items WHERE id=?').get(i.id) as {
        phase: string;
      };
      sql
        .prepare(
          'UPDATE job_items SET status=?,phase=?,error_message=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND fence=?',
        )
        .run(
          uncertain ? 'reconciliation_required' : 'failed',
          uncertain
            ? ['polling', 'downloading', 'processing'].includes(live.phase)
              ? live.phase
              : 'uncertain'
            : 'done',
          message,
          now(),
          i.id,
          i.fence,
        );
      if (!uncertain)
        services.credits
          .forChannel(i.billing_channel)
          .finish(i.workspace_id, i.user_id, i.credits, i.job_id, i.id, false);
      services.refresh(i.job_id);
    });
  }
  async function storeOutputs(
    i: ItemRow,
    outputs: ProviderOutput[],
    indexOffset = 0,
  ): Promise<StoredOutput[]> {
    const dir = join(config.storageDir, '.job-results');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stored: StoredOutput[] = [];
    const written: string[] = [];
    try {
      for (const [n, o] of outputs.entries()) {
        const resultData =
          o.resultData === undefined ? undefined : jobResultDataSchema.parse(o.resultData);
        if (o.buffer) {
          const path = join(dir, `${i.id}-${i.fence}-${n + indexOffset}.bin`);
          written.push(path);
          await writeFile(path, o.buffer, { mode: 0o600 });
          stored.push({
            path,
            name: o.name,
            mimeType: o.mimeType,
            text: o.text,
            resultData,
            expectedImageSize: o.expectedImageSize,
            processing: o.processing,
          });
        } else
          stored.push({
            url: o.url,
            text: o.text,
            mimeType: o.mimeType,
            name: o.name,
            resultData,
            expectedImageSize: o.expectedImageSize,
            processing: o.processing,
          });
      }
    } catch (error) {
      const removed = await Promise.allSettled(written.map((path) => rm(path, { force: true })));
      if (removed.some((result) => result.status === 'rejected'))
        console.warn('Uncommitted result cache cleanup incomplete; inspect private storage.');
      throw error;
    }
    return stored;
  }
  /** Called only after a replacement manifest is committed. Never scan storage or
   * remove the durable model asset; only retire explicitly superseded scratch paths. */
  async function discardReplacedCache(
    i: ItemRow,
    previous: StoredOutput[],
    current: StoredOutput[],
  ) {
    const cacheDir = join(config.storageDir, '.job-results');
    const prefix = join(cacheDir, `${i.id}-`);
    const retained = new Set(current.map((output) => output.path));
    const paths = previous
      .map((output) => output.path)
      .filter(
        (path): path is string =>
          !!path &&
          !retained.has(path) &&
          path.startsWith(prefix) &&
          /^\d+-\d+\.bin$/.test(path.slice(prefix.length)),
      );
    if (!paths.length) return;
    try {
      const directory = await lstat(cacheDir);
      if (!directory.isDirectory() || directory.isSymbolicLink()) return;
      await Promise.all(paths.map((path) => rm(path, { force: true })));
    } catch {
      console.warn('Superseded result cache cleanup incomplete; durable original is retained.');
    }
  }
  async function finish(i: ItemRow, result: StoredResult) {
    const outputs = result.outputs;
    const input = jobInputSchema.parse(JSON.parse(i.input_json));
    const structured = outputs.find((output) => output.resultData !== undefined)?.resultData;
    let resultData: JobResultData | undefined;
    if (structured !== undefined) {
      const parsed = jobResultDataSchema.safeParse(structured);
      if (
        !parsed.success ||
        input.operation !== 'text.assist' ||
        !resultMatchesAssistantMode(parsed.data, input.options.assistantMode)
      )
        throw new ProviderError('服务返回了不完整或不属于当前任务的方案结构，请核对结果。', true);
      resultData = parsed.data;
    }
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
    if (
      input.providerId === 'native' &&
      input.operation === 'video.generate' &&
      outputs.length !== 1
    )
      throw new ProviderError('视频模型没有返回单个可核对的产物。', true);
    const layered =
      result.outputKind === 'layers' &&
      input.operation === 'image.layers' &&
      input.providerId === 'fal';
    if ((result.outputKind === 'layers' && !layered) || outputs.length > (layered ? 10 : 1))
      throw new ProviderError('单项任务返回了多个未关联产物，需要人工核对，未自动结算。', true);
    const prepared: PreparedAsset[] = [];
    let committed = false;
    try {
      for (const output of outputs) {
        if (output.path || output.url) {
          let buffer = output.path
            ? await readFile(output.path)
            : await downloadPublicMedia(
                output.url!,
                input.operation === 'media.import' ? 100 * 1024 * 1024 : undefined,
                0,
                {
                  dnsMode: config.mediaDnsMode,
                  ...(config.mediaDownloadTimeoutMs
                    ? { timeoutMs: config.mediaDownloadTimeoutMs }
                    : {}),
                },
              );
          if (
            input.providerId === 'native' &&
            ['image.generate', 'video.generate'].includes(input.operation) &&
            !output.path
          ) {
            // Freeze downloaded bytes before inspection. A mismatched result remains available
            // locally even if its signed upstream URL expires; recovery never re-generates.
            const stored = await storeOutputs(i, [
              {
                buffer,
                mimeType: output.mimeType,
                name: output.name,
                expectedImageSize: output.expectedImageSize,
                processing: output.processing,
              },
            ]);
            output.path = stored[0]!.path;
            delete output.url;
            const saved = sql
              .prepare(
                'UPDATE job_items SET result_json=?,updated_at=? WHERE id=? AND lease_owner=? AND fence=?',
              )
              .run(JSON.stringify(result), now(), i.id, owner, i.fence);
            if (saved.changes !== 1)
              throw new ProviderError('任务执行权已转移，已停止保存产物。', true);
          }
          if (
            input.operation === 'media.import' &&
            !(await fileTypeFromBuffer(buffer))?.mime.startsWith('video/')
          )
            throw new ProviderError('解析返回的内容不是可验证的视频文件，请核对服务商结果。', true);
          const expectedMedia =
            input.operation === 'image.generate'
              ? 'image/'
              : input.operation === 'video.generate'
                ? 'video/'
                : null;
          if (expectedMedia && !(await fileTypeFromBuffer(buffer))?.mime.startsWith(expectedMedia))
            throw new ProviderError('服务返回的文件类型与生成任务不符，请核对服务商结果。', true);
          if (
            input.providerId === 'native' &&
            input.operation === 'video.generate' &&
            input.nativePlan?.videoPostprocess === 'model-video-tail-hold-v1' &&
            !output.processing
          ) {
            const artifacts = createNativeArtifacts({
              services,
              item: i,
              input,
              owns: () => owns(i),
            });
            const original = await artifacts.save('video-model-raw', {
              buffer,
              mimeType: output.mimeType,
              name: output.name,
            });
            stage(i, '模型原片已保存，正在本机处理尾段停稳');
            const processed = await renderNativeVideoTailHold(input, original);
            // Keep the original manifest/file valid until the processed manifest is committed.
            const previousPath = output.path;
            const [saved] = await storeOutputs(i, [processed], 1);
            Object.assign(output, saved);
            delete output.url;
            const updated = sql
              .prepare(
                "UPDATE job_items SET phase='downloading',result_json=?,updated_at=? WHERE id=? AND lease_owner=? AND fence=?",
              )
              .run(JSON.stringify(result), now(), i.id, owner, i.fence);
            if (updated.changes !== 1)
              throw new ProviderError('任务执行权已转移，已停止保存尾段处理结果。', true);
            buffer = processed.buffer!;
            await discardReplacedCache(
              i,
              [{ path: previousPath, mimeType: output.mimeType, name: output.name }],
              [output],
            );
          }
          validateNativeProcessing(db, i, input, output.processing);
          if (input.operation === 'image-erase') {
            const [source, mask] = await Promise.all([
              core.assets.readOriginalForJob(context, input.assetIds[0]!),
              core.assets.readOriginalForJob(context, input.maskAssetId!),
            ]);
            buffer = await composeErasureResult(source, mask, buffer);
          }
          prepared.push(
            await core.assets.prepare({
              buffer,
              name: output.name,
              mimeType: input.operation === 'image-erase' ? 'image/png' : output.mimeType,
              projectId: projectId || undefined,
              source:
                input.operation === 'media.import'
                  ? 'import'
                  : input.providerId === 'local' || output.processing
                    ? 'local-processing'
                    : 'generation',
              sourceJobId: i.job_id,
            }),
          );
        } else validateNativeProcessing(db, i, input, output.processing);
      }
      if (
        layered &&
        (prepared.length !== outputs.length || prepared.some((a) => a.kind !== 'image'))
      )
        throw new ProviderError('图层结果必须全部为有效图片。', true);
      if (
        layered &&
        prepared.some((a) => a.width !== prepared[0]!.width || a.height !== prepared[0]!.height)
      )
        throw new ProviderError('分层图片画幅不一致，需核对供应商产物。', true);
      if (['image.generate', 'video.generate'].includes(input.operation) && prepared.length !== 1)
        throw new ProviderError('生成任务没有返回可验证的媒体产物，请核对服务商结果。', true);
      if (input.providerId === 'native' && input.operation === 'video.generate')
        validateNativeVideoArtifact(input, prepared[0]!);
      if (input.providerId === 'native' && input.operation === 'image.generate')
        validateNativeImageArtifact(outputs[0]?.expectedImageSize, prepared[0]!);
      const resultText =
        outputs
          .map((o) => {
            if (!o.processing) return o.text ?? '';
            const notice =
              o.processing.method === 'exact-pan-v1'
                ? '此视频由参考图在本机执行精确二维平移生成，不是视频模型生成的动态场景。'
                : o.processing.method === 'model-video-tail-hold-v1'
                  ? '此结果来自视频模型完整原片，并由本机重采样时序及保持末帧；原始模型视频另行保留。'
                  : '此图片在本机按已保存蒙版合成指定背景色，主体保持范围以蒙版保护区为准。';
            return [notice, o.text].filter(Boolean).join('\n');
          })
          .filter(Boolean)
          .join('\n') || null;
      if (!prepared.length && !resultText)
        throw new ProviderError('服务返回了空产物。', input.providerId !== 'local');
      committed = services.transaction(() => {
        if (!owns(i)) return false;
        if (
          input.providerId === 'native' &&
          input.imageEdit?.mask.mode === 'generate' &&
          input.imageEdit.mask.calibration === 'local-matting-v2' &&
          (
            sql.prepare('SELECT cancel_requested FROM job_items WHERE id=?').get(i.id) as {
              cancel_requested: number;
            }
          ).cancel_requested
        )
          throw new ProviderError(
            '已停止本机抠图结果提交，已有原件保留；可恢复已有结果。',
            false,
            'LOCAL_MATTING_CANCELLED',
          );
        const assets = prepared.map((p) => core.assets.commitPreparedForJob(context, p)),
          asset = assets[0] ?? null;
        if (asset && outputs[0]?.processing)
          sql
            .prepare(
              'INSERT INTO native_generation_provenance(item_id,workspace_id,asset_id,input_fingerprint,processing_json,created_at) VALUES(?,?,?,?,?,?)',
            )
            .run(
              i.id,
              i.workspace_id,
              asset.id,
              nativeArtifactFingerprint(input),
              JSON.stringify(outputs[0].processing),
              now(),
            );
        for (const [index, a] of assets.entries())
          sql.prepare('INSERT INTO job_item_assets VALUES (?,?,?)').run(i.id, a.id, index);
        sql
          .prepare('UPDATE job_items SET output_kind=? WHERE id=?')
          .run(layered ? 'layers' : 'single', i.id);
        sql
          .prepare(
            "UPDATE job_items SET status='succeeded',phase='done',asset_id=?,result_text=?,result_data_json=?,lease_owner=NULL,lease_until=NULL,error_message=NULL,updated_at=? WHERE id=? AND fence=?",
          )
          .run(
            asset?.id || null,
            resultText,
            resultData ? JSON.stringify(resultData) : null,
            now(),
            i.id,
            i.fence,
          );
        services.credits
          .forChannel(i.billing_channel)
          .finish(
            i.workspace_id,
            i.user_id,
            i.credits,
            i.job_id,
            i.id,
            !waived,
            waived ? '未检测到文字，任务保留原图并释放预留' : undefined,
          );
        if (waived)
          core.context.audit(
            actorForJob(i),
            i.workspace_id,
            'job.no_visible_text',
            'job',
            i.job_id,
            {
              itemId: i.id,
              releasedCredits: i.credits,
            },
          );
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
              ...(resultData ? { resultData } : {}),
              ...(outputs[0]?.processing ? { processing: outputs[0].processing } : {}),
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
        return true;
      });
    } finally {
      if (!committed)
        await Promise.allSettled(prepared.map((asset) => core.assets.discardPrepared(asset)));
    }
    if (committed) await cleanupResults(i.id);
  }
  async function runItem(i: ItemRow) {
    let parsedInput: JobInput | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancellationTimer: ReturnType<typeof setInterval> | undefined;
    const localAbort = new AbortController();
    try {
      if (!owns(i)) return;
      const input = jobInputSchema.parse(JSON.parse(i.input_json));
      parsedInput = input;
      const localMatting =
        input.providerId === 'native' &&
        input.imageEdit?.mask.mode === 'generate' &&
        input.imageEdit.mask.calibration === 'local-matting-v2';
      cancellationTimer = localMatting
        ? setInterval(() => {
            try {
              const live = sql
                .prepare('SELECT cancel_requested FROM job_items WHERE id=?')
                .get(i.id) as { cancel_requested: number } | undefined;
              if (!owns(i) || live?.cancel_requested) localAbort.abort();
            } catch {
              // Stop expensive local work when its ownership cannot be checked.
              localAbort.abort();
              console.error('Worker cancellation check failed; local processing was stopped.');
            }
          }, 250)
        : undefined;
      cancellationTimer?.unref();
      timer = setInterval(() => {
        try {
          if (owns(i))
            sql
              .prepare(
                'UPDATE job_items SET lease_until=? WHERE id=? AND lease_owner=? AND fence=?',
              )
              .run(new Date(Date.now() + 120000).toISOString(), i.id, owner, i.fence);
        } catch {
          // Timer callbacks do not enter runItem's catch. Keep transient database
          // errors contained; every later side effect still checks the live lease.
          console.error('Worker lease heartbeat failed; durable state is retained for recovery.');
        }
      }, 20000);
      timer.unref();
      // Missing recovery metadata must never fall through to a new paid execute call.
      if (
        (i.phase === 'downloading' && !i.result_json) ||
        (i.phase === 'polling' && !i.remote_json)
      )
        throw new ProviderError('恢复所需的结果或远程任务记录缺失，请核对服务商记录。', true);
      if (i.phase === 'processing' && !hasNativeProcessingCheckpoint(db, i, input))
        throw new ProviderError(
          '恢复本机处理所需的中间产物缺失，不能重新请求模型。',
          true,
          'NATIVE_CHECKPOINT_INVALID',
        );
      if (i.phase === 'downloading' && i.result_json) {
        stage(i, taskStage(i));
        await finish(i, readStoredResult(i.result_json));
        return;
      }
      // Persisted results and local processing need no provider credentials. New
      // videos retain their image dependency; image jobs never read video secrets.
      const localNativeProcessing =
        input.providerId === 'native' &&
        (i.phase === 'processing' ||
          input.imageEdit?.mask.mode === 'asset' ||
          input.nativePlan?.motionRenderer === 'exact-pan-v1');
      const imageConnection =
        input.providerId === 'native' && !localNativeProcessing && i.phase !== 'polling'
          ? services.settings.connections.runtime(i.workspace_id, 'image')
          : undefined;
      const videoConnection =
        input.providerId === 'native' &&
        !localNativeProcessing &&
        input.operation === 'video.generate'
          ? services.settings.connections.runtime(i.workspace_id, 'video')
          : undefined;
      const adapter =
        input.providerId === 'native' && !overrides.native
          ? createNativeProvider({ image: imageConnection, video: videoConnection })
          : adapters[input.providerId];
      const secret =
        input.providerId === 'native'
          ? input.operation === 'video.generate'
            ? videoConnection?.secret
            : imageConnection?.secret
          : services.settings.secret(i.workspace_id, input.providerId);
      if (
        input.providerId === 'native' &&
        i.phase !== 'polling' &&
        !hasNativeProcessingCheckpoint(db, i, input) &&
        (!input.nativeRevision ||
          input.nativeRevision !==
            services.settings.connections.revision(
              i.workspace_id,
              input.operation,
              input.planningMode,
            ))
      )
        throw new ProviderError('模型连接已变更，已停止生成；请检查配置后重新规划。');
      let result: ProviderResult;
      if (i.phase === 'polling' && i.remote_json) {
        if (i.recovery_failures > 0) stage(i, taskStage(i));
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
            services.credits
              .forChannel(i.billing_channel)
              .finish(i.workspace_id, i.user_id, i.credits, i.job_id, i.id, false);
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
          ...(input.backgroundAssetId ? [input.backgroundAssetId] : []),
          ...(input.backgroundAudioAssetId ? [input.backgroundAudioAssetId] : []),
        ]);
        // Baselines are server-frozen local artifacts. Do not expose them as model URLs.
        const readableIds = new Set([
          ...allowedIds,
          ...(input.imageEdit?.mask.mode === 'asset' && input.imageEdit.mattingBaseline
            ? [
                input.imageEdit.mattingBaseline.resultAssetId,
                input.imageEdit.mattingBaseline.maskAssetId,
              ]
            : []),
        ]);
        const localProcessing = hasNativeProcessingCheckpoint(db, i, input);
        const lease = sql
          .prepare(
            "UPDATE job_items SET phase=?,updated_at=? WHERE id=? AND lease_owner=? AND fence=? AND status='running' AND lease_until>?",
          )
          .run(localProcessing ? 'processing' : 'submitting', now(), i.id, owner, i.fence, now());
        if (lease.changes !== 1) return;
        stage(i, input.providerId === 'local' || localProcessing ? '本机正在处理' : '请求模型服务');
        result = await adapter.execute(
          {
            actor: actorForJob(i),
            workspaceId: i.workspace_id,
            input,
            resumeLocalProcessing: localProcessing,
            ...(localMatting && config.localMatting
              ? {
                  localMatting: {
                    config: config.localMatting,
                    signal: localAbort.signal,
                    owns: () => owns(i),
                  },
                }
              : {}),
            ...(input.providerId === 'native' &&
            (input.imageEdit || input.nativePlan?.videoPostprocess === 'model-video-tail-hold-v1')
              ? {
                  nativeArtifacts: createNativeArtifacts({
                    services,
                    item: i,
                    input,
                    owns: () => owns(i),
                  }),
                }
              : {}),
            onStage: (value) => {
              if (owns(i)) stage(i, value);
            },
            beforeAdditionalSubmission: () => {
              if (!owns(i)) throw new ProviderError('任务执行权已转移，已停止后续生成。', true);
              if (localProcessing || hasNativeProcessingCheckpoint(db, i, input))
                throw new ProviderError(
                  '当前仅允许恢复本机处理，不能重新请求模型。',
                  true,
                  'NATIVE_CHECKPOINT_INVALID',
                );
              const live = sql
                .prepare('SELECT cancel_requested FROM job_items WHERE id=?')
                .get(i.id) as { cancel_requested: number };
              if (live.cancel_requested)
                throw new ProviderError(
                  input.operation === 'video.generate'
                    ? '已取消后续视频生成，已完成的首帧仍保留。'
                    : '已取消后续模型请求，不再尝试备用资源。',
                );
              if (
                input.providerId === 'native' &&
                input.nativeRevision !==
                  services.settings.connections.revision(
                    i.workspace_id,
                    input.operation,
                    input.planningMode,
                  )
              )
                throw new ProviderError(
                  input.operation === 'video.generate'
                    ? '模型连接已改变，已保留首帧并停止后续视频生成。'
                    : '模型连接已改变，已停止请求备用资源。',
                );
              authorizeUnsubmitted(i);
            },
            ...(input.providerId === 'native' &&
            input.operation === 'video.generate' &&
            input.nativePlan?.motionRenderer !== 'exact-pan-v1'
              ? {
                  nativeFrame: {
                    load: async () => {
                      const frame = sql
                        .prepare(
                          'SELECT f.asset_id FROM native_generation_frames f JOIN job_items j ON j.id=f.item_id WHERE j.workspace_id=? AND f.input_fingerprint=? AND (j.id=? OR j.id=? OR j.id=? OR j.retry_root_item_id=?) ORDER BY f.created_at DESC LIMIT 1',
                        )
                        .get(
                          i.workspace_id,
                          inputHash({ ...input, capabilityRevision: undefined }),
                          i.id,
                          i.retry_source_item_id,
                          i.retry_root_item_id || i.id,
                          i.retry_root_item_id || i.id,
                        ) as { asset_id: string } | undefined;
                      return frame
                        ? core.assets.readOriginalForJob(jobContext, frame.asset_id)
                        : undefined;
                    },
                    save: async (output: ProviderOutput) => {
                      const buffer = await readNativeFrame(output);
                      const prepared = await core.assets.prepare({
                        buffer,
                        name: '视频首帧.png',
                        mimeType: 'image/png',
                        projectId: input.projectId,
                        source: 'generation',
                        sourceJobId: i.job_id,
                      });
                      let committed = false;
                      try {
                        committed = services.transaction(() => {
                          if (!owns(i))
                            throw new ProviderError('任务执行权已转移，首帧已停止保存。', true);
                          if (prepared.kind !== 'image')
                            throw new ProviderError('首帧产物不是有效图片。', true);
                          const asset = core.assets.commitPreparedForJob(jobContext, prepared);
                          sql
                            .prepare('INSERT INTO native_generation_frames VALUES(?,?,?,?)')
                            .run(
                              i.id,
                              asset.id,
                              inputHash({ ...input, capabilityRevision: undefined }),
                              now(),
                            );
                          return true;
                        });
                      } finally {
                        if (!committed) await core.assets.discardPrepared(prepared);
                      }
                    },
                  },
                }
              : {}),
            onRemoteAccepted: (remote) => {
              services.transaction(() => {
                if (!owns(i))
                  throw new ProviderError('任务执行权已转移，不能覆盖远程任务记录。', true);
                const live = sql
                  .prepare('SELECT remote_id,remote_json FROM job_items WHERE id=?')
                  .get(i.id) as { remote_id: string | null; remote_json: string | null };
                if (
                  !remote.id ||
                  remote.id.length > 240 ||
                  (live.remote_id && live.remote_id !== remote.id)
                )
                  throw new ProviderError(
                    '服务返回的任务编号与已记录任务不一致，请核对服务商结果。',
                    true,
                  );
                const previous = live.remote_json
                  ? (JSON.parse(live.remote_json) as RemoteTask)
                  : null;
                sql
                  .prepare(
                    "UPDATE job_items SET phase='polling',remote_id=?,remote_json=?,error_message=NULL,updated_at=? WHERE id=? AND lease_owner=? AND fence=?",
                  )
                  .run(
                    remote.id,
                    JSON.stringify({ ...remote, submittedAt: previous?.submittedAt || now() }),
                    now(),
                    i.id,
                    owner,
                    i.fence,
                  );
                stage(i, '任务已受理，正在等待结果');
              });
            },
            assetUrl: (id, variant = 'original') => {
              if (!allowedIds.has(id))
                throw new AppError(403, 'ASSET_REFERENCE', '素材未包含在本次任务中');
              if (variant === 'mask-white' && input.maskAssetId !== id)
                throw new AppError(403, 'MASK_REFERENCE', '此素材不是任务遮罩');
              return services.signedAssetUrl(i.workspace_id, i.user_id, i.job_id, id, variant);
            },
            readAsset: async (id) => {
              if (!readableIds.has(id))
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
        const accepted = sql
          .prepare('SELECT remote_id,remote_json FROM job_items WHERE id=?')
          .get(i.id) as { remote_id: string | null; remote_json: string | null };
        if (accepted.remote_id && accepted.remote_id !== result.remote.id)
          throw new ProviderError('服务返回的任务编号与已记录任务不一致，请核对服务商结果。', true);
        const previous = accepted.remote_json
          ? (JSON.parse(accepted.remote_json) as RemoteTask)
          : null;
        stage(i, '模型已接受，等待结果');
        sql
          .prepare(
            "UPDATE job_items SET phase='polling',recovery_failures=0,error_message=NULL,remote_id=?,remote_json=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND fence=?",
          )
          .run(
            result.remote.id,
            JSON.stringify({ ...result.remote, submittedAt: previous?.submittedAt || now() }),
            new Date(Date.now() + 5000).toISOString(),
            now(),
            i.id,
            i.fence,
          );
        return;
      }
      if (result.state === 'running') {
        const remote = i.remote_json ? (JSON.parse(i.remote_json) as RemoteTask) : null;
        const acceptedAt = Date.parse(remote?.submittedAt || i.created_at);
        if (Number.isFinite(acceptedAt) && Date.now() - acceptedAt >= 30 * 60_000) {
          fail(i, '远程处理超过30分钟，自动查询已暂停；可恢复查询同一任务，不会重新生成。', true);
          return;
        }
        sql
          .prepare(
            "UPDATE job_items SET phase='polling',recovery_failures=0,error_message=NULL,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND fence=?",
          )
          .run(new Date(Date.now() + 5000).toISOString(), now(), i.id, i.fence);
        sql
          .prepare('UPDATE jobs SET stage=?,updated_at=? WHERE id=?')
          .run(result.stage, now(), i.job_id);
        services.event(i.workspace_id, i.job_id, 'updated', {
          status: 'running',
          stage: result.stage,
        });
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
      const committedResult = sql
        .prepare(
          "UPDATE job_items SET phase='downloading',recovery_failures=0,error_message=NULL,result_json=?,updated_at=? WHERE id=? AND lease_owner=? AND fence=?",
        )
        .run(JSON.stringify(stored), now(), i.id, owner, i.fence);
      if (committedResult.changes !== 1)
        throw new ProviderError('任务执行权已转移，已停止保存产物。', true);
      if (input.nativePlan?.videoPostprocess === 'model-video-tail-hold-v1' && i.result_json) {
        try {
          await discardReplacedCache(i, readStoredResult(i.result_json).outputs, stored.outputs);
        } catch {
          // A malformed older manifest does not invalidate the durable raw and final assets.
          console.warn('Previous result cache manifest is invalid; inspect private storage.');
        }
      }
      stage(i, '结果已生成，正在下载并保存');
      await finish(i, stored);
    } catch (error) {
      const input = parsedInput;
      const live = sql.prepare('SELECT * FROM job_items WHERE id=?').get(i.id) as
        ItemRow | undefined;
      if (!live || !owns(i)) return;
      if (error instanceof ProviderError && error.code.startsWith('LOCAL_MATTING_')) {
        // Resource/configuration/algorithm failures require an explicit local resume.
        // Retrying a 10 GiB process ten times cannot repair a missing installation.
        sql
          .prepare('UPDATE job_items SET cancel_requested=0 WHERE id=? AND fence=?')
          .run(i.id, i.fence);
        fail(i, error.message, !!input && hasNativeProcessingCheckpoint(db, i, input));
        return;
      }
      if (
        error instanceof ProviderError &&
        [
          'NATIVE_VIDEO_SPEC_MISMATCH',
          'NATIVE_IMAGE_SPEC_MISMATCH',
          'NATIVE_CHECKPOINT_INVALID',
          'BACKGROUND_MASK_SIZE',
          'BACKGROUND_MASK_INVALID',
          'NATIVE_TAIL_HOLD_INVALID',
        ].includes(error.code)
      ) {
        fail(i, error.message, true);
        return;
      }
      if (
        ['polling', 'downloading', 'processing'].includes(live.phase) &&
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
            recoveryError(live.phase, error),
            now(),
            i.id,
            i.fence,
          );
        services.refresh(i.job_id);
        return;
      }
      const uncertain =
        error instanceof ProviderError
          ? error.ambiguous
          : input?.providerId !== 'local' && live.phase === 'submitting';
      fail(
        i,
        ['polling', 'downloading', 'processing'].includes(live.phase)
          ? recoveryError(live.phase, error)
          : error instanceof ProviderError || error instanceof AppError
            ? error.message
            : '处理失败，请检查素材或服务配置。',
        uncertain ||
          (input?.providerId !== 'local' &&
            ['polling', 'downloading', 'processing'].includes(live.phase)),
      );
    } finally {
      if (timer) clearInterval(timer);
      if (cancellationTimer) clearInterval(cancellationTimer);
    }
  }
  async function tickOnce() {
    recover();
    if (Date.now() >= nextResultCleanup) {
      nextResultCleanup = Date.now() + 60_000;
      await cleanupResults();
    }
    if (stopped) return;
    await core.assets.processPendingExtractions(2);
    while (!stopped && running.size < 2) {
      const item = claim();
      if (!item) break;
      const input = jobInputSchema.parse(JSON.parse(item.input_json));
      const promise = runWithExecutionAudit(
        createExecutionLogSink(db, {
          workspaceId: item.workspace_id,
          jobId: item.job_id,
          itemId: item.id,
          providerId: input.providerId,
        }),
        async () => {
          const action = item.phase === 'polling' ? 'poll' : 'submit';
          const resource = { id: 'worker', name: '任务执行器' };
          emitExecutionAttempt({
            action,
            status: 'started',
            resource,
            stage: item.phase,
            message:
              item.phase === 'polling'
                ? '查询已保存的上游任务。'
                : '已领取任务，开始执行当前阶段。',
          });
          await runItem(item);
          const current = sql
            .prepare(
              'SELECT status,phase,error_message,remote_id,recovery_failures,next_attempt_at FROM job_items WHERE id=?',
            )
            .get(item.id) as Pick<
            ItemRow,
            | 'status'
            | 'phase'
            | 'error_message'
            | 'remote_id'
            | 'recovery_failures'
            | 'next_attempt_at'
          >;
          emitExecutionAttempt({
            action: current.status === 'cancelled' ? 'cancel' : action,
            status:
              current.status === 'reconciliation_required'
                ? 'uncertain'
                : current.status === 'succeeded'
                  ? 'succeeded'
                  : current.status === 'failed' || current.status === 'cancelled'
                    ? 'failed'
                    : 'running',
            resource,
            stage: current.phase,
            remoteId: current.remote_id ?? undefined,
            message:
              current.error_message ??
              (current.status === 'succeeded'
                ? '任务产物已保存。'
                : '当前执行阶段结束，任务状态已持久化。'),
            metadata: {
              recoveryFailures: current.recovery_failures,
              nextRetryAt: current.next_attempt_at,
            },
          });
        },
      );
      running.add(promise);
      void promise.then(
        () => running.delete(promise),
        () => {
          running.delete(promise);
          // Database failures can also prevent the normal error transaction. Keep
          // its lease and paid-state evidence for recovery without crashing peers.
          console.error('Worker item failed; durable state is retained for recovery.');
        },
      );
    }
  }
  function tick(): Promise<void> {
    if (stopped) return Promise.resolve();
    ticking ??= tickOnce().finally(() => {
      ticking = undefined;
    });
    return ticking;
  }
  async function drain() {
    await Promise.allSettled([...running]);
  }
  return {
    tick,
    claim,
    runItem,
    recover,
    drain,
    stop: async () => {
      stopped = true;
      if (ticking) await Promise.allSettled([ticking]);
      await drain();
    },
    owner,
  };
}

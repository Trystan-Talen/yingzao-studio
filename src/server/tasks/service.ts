import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { Actor } from '../../contracts/core';
import {
  jobInputSchema,
  type JobDto,
  type QuoteDto,
  type JobInput,
  type JobStatus,
  type CreditDto,
  type PendingApplyDto,
} from '../../contracts/jobs';
import type { SceneLayer, LayerBase } from '../../contracts/scene';
import type { DatabaseContext } from '../db/connection';
import type { CoreServices } from '../core';
import type { AppConfig } from '../config';
import { AppError } from '../errors';
import { extractAssetMentions } from '../../contracts/mentions';
import sharp from 'sharp';
import { canonicalImage } from '../providers/image-input';
import { createCreditService } from './credits';
import { createSettingsService } from './settings';
import { validateInput, splitItems, inputHash, checkScope } from './validation';
import { now, type JobRow, type ItemRow, type QuoteRow } from './types';
const PRICING = 'local-budget-v1';
export function createTaskServices(db: DatabaseContext, core: CoreServices, config: AppConfig) {
  const sql = db.sqlite,
    credits = createCreditService(db),
    settings = createSettingsService(db, config);
  const transaction = <T>(fn: () => T): T => sql.transaction(fn).immediate();
  function getRow(actor: Actor, wid: string, id: string) {
    core.requireAccess(actor, wid, 'read');
    checkScope(actor, 'jobs:read');
    const r = sql.prepare('SELECT * FROM jobs WHERE id=? AND workspace_id=?').get(id, wid) as
      JobRow | undefined;
    if (!r) throw new AppError(404, 'JOB_NOT_FOUND', '任务不存在');
    return r;
  }
  function itemAssetIds(item: ItemRow): string[] {
    const rows = sql
      .prepare('SELECT asset_id FROM job_item_assets WHERE item_id=? ORDER BY output_index')
      .all(item.id) as { asset_id: string }[];
    return rows.length ? rows.map((r) => r.asset_id) : item.asset_id ? [item.asset_id] : [];
  }
  function dto(actor: Actor, row: JobRow): JobDto {
    const items = sql
      .prepare('SELECT * FROM job_items WHERE job_id=? ORDER BY item_index')
      .all(row.id) as ItemRow[];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      createdBy: row.user_id,
      projectId: row.project_id,
      operation: row.operation,
      providerId: row.provider_id,
      prompt: row.prompt,
      status: row.status,
      stage: row.stage,
      requestedCredits: row.requested_credits,
      settledCredits: row.settled_credits,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      errorMessage: row.error_message,
      isArchived: !!sql
        .prepare('SELECT 1 FROM job_history_archives WHERE user_id=? AND job_id=?')
        .get(actor.userId, row.id),
      downloadedAt:
        (
          sql
            .prepare('SELECT downloaded_at FROM job_downloads WHERE user_id=? AND job_id=?')
            .get(actor.userId, row.id) as { downloaded_at: string } | undefined
        )?.downloaded_at ?? null,
      input: jobInputSchema.parse(JSON.parse(row.input_json)),
      items: items.map((i) => ({
        id: i.id,
        index: i.item_index,
        status: i.status,
        assetId: i.asset_id,
        assetIds: itemAssetIds(i),
        outputKind: i.output_kind,
        remoteId: i.remote_id,
        errorMessage: i.error_message,
        resultText: i.result_text,
      })),
      outputAssets: [...new Set(items.flatMap(itemAssetIds))].flatMap((id) => {
        try {
          return [core.assets.get(actor, row.workspace_id, id)];
        } catch (e) {
          if (e instanceof AppError && e.statusCode === 404) return [];
          throw e;
        }
      }),
    };
  }
  function event(wid: string, jobId: string, type: string, payload: unknown) {
    sql
      .prepare(
        'INSERT INTO job_events(workspace_id,job_id,type,payload,created_at) VALUES(?,?,?,?,?)',
      )
      .run(wid, jobId, type, JSON.stringify(payload), now());
  }
  function validate(actor: Actor, wid: string, raw: unknown) {
    const i = validateInput(core, settings, actor, wid, raw);
    if (i.characterId) {
      const character = core.identity.assertCanReference(actor, wid, i.characterId);
      if (i.characterRevision && i.characterRevision !== character.referenceRevision)
        throw new AppError(409, 'CHARACTER_REFERENCE_CHANGED', '人物素材版本已变更，请重新选择');
    }
    if (
      i.options.assistantMode === 'design-plan' &&
      (i.operation !== 'text.assist' || i.providerId !== 'openai')
    )
      throw new AppError(400, 'PLAN_UNSUPPORTED', '结构化设计方案目前需要OpenAI文字服务');
    if (
      i.providerId === 'openai' &&
      i.prompt.length + (i.referenceText?.length || 0) + (i.conversationContext?.length || 0) >
        30000
    )
      throw new AppError(
        400,
        'CONTEXT_TOO_LONG',
        '当前需求与文档、会话上下文过长，请精简内容或新建项目',
      );
    const mentionAssets = new Set([
      ...i.assetIds,
      ...i.referenceAssetIds,
      ...(i.options.designs?.flatMap((d) => d.assetIds) || []),
      ...(i.brandId ? core.brands.get(actor, wid, i.brandId).referenceAssetIds : []),
    ]);
    for (const mention of extractAssetMentions(
      [i.prompt, ...(i.options.designs?.map((d) => d.prompt) || [])].join('\n'),
    )) {
      if (!mentionAssets.has(mention.assetId))
        throw new AppError(
          400,
          'MENTION_NOT_ATTACHED',
          '被 @ 引用的素材已移除，请重新选择素材或移除对应引用',
        );
      core.assets.get(actor, wid, mention.assetId);
    }
    if (
      i.providerId === 'flyelep' &&
      (i.assetIds.length || i.referenceAssetIds.length || i.maskAssetId || i.brandId)
    ) {
      const origin = new URL(config.publicOrigin);
      if (
        origin.protocol !== 'https:' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      )
        throw new AppError(
          409,
          'PUBLIC_MEDIA_REQUIRED',
          'Flyelep 需要可从云端访问的素材地址；本机使用请先连接 OpenAI 或 fal 服务。',
        );
    }
    return i;
  }
  function snapshot(actor: Actor, wid: string, input: JobInput): JobInput[] {
    const frozen = structuredClone(input);
    delete frozen.conversationContext;
    if (
      input.projectId &&
      input.providerId === 'openai' &&
      ['image.generate', 'text.assist'].includes(input.operation)
    ) {
      const messages = sql
        .prepare(
          "SELECT role,content FROM messages WHERE project_id=? AND workspace_id=? AND role IN('user','assistant') ORDER BY created_at DESC,rowid DESC LIMIT 8",
        )
        .all(input.projectId, wid) as { role: string; content: string }[];
      const context: string[] = [];
      let length = 0;
      for (const msg of messages) {
        const part = `${msg.role === 'user' ? '用户' : '创作助手'}：${msg.content.slice(0, 1500)}`;
        if (length + part.length + 2 > 6000) break;
        context.unshift(part);
        length += part.length + 2;
      }
      if (context.length) frozen.conversationContext = context.join('\n\n');
    }
    if (input.characterId) {
      const character = core.identity.assertCanReference(actor, wid, input.characterId);
      frozen.characterRevision = character.referenceRevision;
      frozen.referenceAssetIds = [
        ...new Set([...frozen.referenceAssetIds, ...character.referenceAssetIds]),
      ];
    }
    if (
      input.providerId === 'openai' &&
      ['image.generate', 'text.assist'].includes(input.operation)
    ) {
      const ids = [
        ...new Set([
          ...input.assetIds,
          ...input.referenceAssetIds,
          ...(input.options.designs?.flatMap((d) => d.assetIds) || []),
        ]),
      ];
      const documents = ids.filter((id) => core.assets.get(actor, wid, id).kind === 'document');
      if (documents.length) {
        const labelDocuments = (text: string) =>
          extractAssetMentions(text).reduce(
            (result, mention) =>
              documents.includes(mention.assetId)
                ? result.replaceAll(
                    mention.token,
                    `【参考文档：${core.assets.get(actor, wid, mention.assetId).name}】`,
                  )
                : result,
            text,
          );
        frozen.prompt = labelDocuments(frozen.prompt);
        if (frozen.options.designs)
          frozen.options.designs = frozen.options.designs.map((d) => ({
            ...d,
            prompt: labelDocuments(d.prompt),
          }));
        const context = documents
          .map((id) => {
            const asset = core.assets.get(actor, wid, id),
              content = core.assets.text(actor, wid, id);
            if (!content.extractedText || content.extractionStatus !== 'ready')
              throw new AppError(409, 'DOCUMENT_NOT_READY', '文档文字尚未就绪');
            return `文档「${asset.name}」：\n${content.extractedText}`;
          })
          .join('\n\n');
        if (context.length > 20000)
          throw new AppError(
            400,
            'DOCUMENT_TOO_LONG',
            '本次引用文档超过20000字符，请上传精简内容后重试',
          );
        frozen.referenceText = context;
        const imageOnly = (id: string) => !documents.includes(id);
        frozen.assetIds = frozen.assetIds.filter(imageOnly);
        frozen.referenceAssetIds = frozen.referenceAssetIds.filter(imageOnly);
        if (frozen.options.designs)
          frozen.options.designs = frozen.options.designs.map((d) => ({
            ...d,
            assetIds: d.assetIds.filter(imageOnly),
          }));
      }
    }
    if (input.brandId) {
      const brand = core.brands.get(actor, wid, input.brandId);
      frozen.referenceAssetIds = [
        ...new Set([...frozen.referenceAssetIds, ...brand.referenceAssetIds]),
      ];
      frozen.prompt += `\n品牌风格：${brand.description}。配色：${brand.colors.join(',')}。字体：${brand.fonts.join(',')}`;
      delete frozen.brandId;
    }
    if (
      frozen.providerId === 'openai' &&
      frozen.assetIds.length + frozen.referenceAssetIds.length > 16
    )
      throw new AppError(400, 'INPUT_COUNT', '品牌与参考图片合计不能超过16张');
    // Brand references and generated style instructions must satisfy the same provider limits.
    validate(actor, wid, frozen);
    return splitItems(frozen).map((part) => {
      for (const mention of extractAssetMentions(part.prompt)) {
        if (
          !part.assetIds.includes(mention.assetId) &&
          !part.referenceAssetIds.includes(mention.assetId)
        )
          part.referenceAssetIds.push(mention.assetId);
        const references = [...new Set([...part.assetIds, ...part.referenceAssetIds])];
        const asset = core.assets.get(actor, wid, mention.assetId);
        part.prompt = part.prompt.replaceAll(
          mention.token,
          `【参考素材：${asset.name}；输入序号 ${references.indexOf(mention.assetId) + 1}】`,
        );
      }
      validate(actor, wid, part);
      return part;
    });
  }
  function billableUnits(actor: Actor, wid: string, item: JobInput, unit: string): number {
    if (unit !== 'second') return 1;
    if (
      [
        'video-replica',
        'video.edit',
        'video.upscale',
        'video.translate',
        'video.erase-subtitles',
      ].includes(item.operation)
    ) {
      const asset = core.assets.get(actor, wid, item.assetIds[0]!);
      if (asset.kind !== 'video' || !asset.durationMs)
        throw new AppError(400, 'VIDEO_DURATION_REQUIRED', '源视频缺少有效时长，无法计算额度');
      return Math.ceil(asset.durationMs / 1000);
    }
    return item.options.duration;
  }
  function writeQuote(
    actor: Actor,
    wid: string,
    input: JobInput,
    items: JobInput[],
    retryJobId: string | null = null,
  ): QuoteDto {
    const cap = settings.validateCapability(wid, input);
    const units = items.reduce(
      (total, item) => total + billableUnits(actor, wid, item, cap.unit),
      0,
    );
    const freeText =
      input.operation === 'text.assist' &&
      core.entitlements.get(actor, wid).freeTextAssist.remaining >= units;
    const maxCredits = freeText ? 0 : units * cap.priceCredits;
    const time = now(),
      id = randomUUID(),
      expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const hash = inputHash(input);
    sql
      .prepare(
        'INSERT INTO quotes(id,workspace_id,user_id,input_hash,input_json,pricing_version,max_credits,units,expires_at,created_at,items_json,retry_job_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        wid,
        actor.userId,
        hash,
        JSON.stringify(input),
        PRICING,
        maxCredits,
        units,
        expiresAt,
        time,
        JSON.stringify(items),
        retryJobId,
      );
    return {
      id,
      inputHash: hash,
      pricingVersion: PRICING,
      maxCredits,
      expiresAt,
      providerId: input.providerId,
      operation: input.operation,
      units,
    };
  }
  function quote(actor: Actor, wid: string, raw: unknown): QuoteDto {
    const input = validate(actor, wid, raw);
    return writeQuote(actor, wid, input, snapshot(actor, wid, input));
  }
  function retryQuote(actor: Actor, wid: string, id: string): QuoteDto {
    const job = getRow(actor, wid, id);
    const input = validate(actor, wid, JSON.parse(job.input_json));
    const rows = sql
      .prepare(
        "SELECT * FROM job_items WHERE job_id=? AND status IN('failed','cancelled') ORDER BY item_index",
      )
      .all(id) as ItemRow[];
    if (!rows.length)
      throw new AppError(
        409,
        'NO_RETRYABLE_ITEMS',
        '没有可重试的失败或取消项；待核对任务不能重复提交',
      );
    return writeQuote(
      actor,
      wid,
      input,
      rows.map((r) => jobInputSchema.parse(JSON.parse(r.input_json))),
      id,
    );
  }
  function submit(
    actor: Actor,
    wid: string,
    inputRaw: unknown,
    quoteId: string,
    requestId: string,
  ): JobDto {
    core.requireAccess(actor, wid, 'write');
    checkScope(actor, 'jobs:write');
    const input = jobInputSchema.parse(inputRaw),
      hash = inputHash(input);
    return transaction(() => {
      const previous = sql
        .prepare('SELECT * FROM jobs WHERE workspace_id=? AND user_id=? AND request_id=?')
        .get(wid, actor.userId, requestId) as JobRow | undefined;
      if (previous) {
        if (previous.input_hash !== hash)
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同参数');
        return dto(actor, previous);
      }
      validate(actor, wid, input);
      const q = sql
        .prepare('SELECT * FROM quotes WHERE id=? AND workspace_id=? AND user_id=?')
        .get(quoteId, wid, actor.userId) as QuoteRow | undefined;
      if (
        !q ||
        q.used_job_id ||
        q.expires_at < now() ||
        q.input_hash !== hash ||
        q.pricing_version !== PRICING
      )
        throw new AppError(409, 'QUOTE_EXPIRED', '参数已变更或报价已过期，请重新确认');
      if (actor.apiKeyId) {
        const key = sql
          .prepare('SELECT credit_limit FROM api_keys WHERE id=?')
          .get(actor.apiKeyId) as { credit_limit: number | null } | undefined;
        const used = sql
          .prepare(
            "SELECT COALESCE(SUM(i.credits),0) AS total FROM job_items i JOIN jobs j ON j.id=i.job_id WHERE j.api_key_id=? AND i.status IN ('queued','running','reconciliation_required','succeeded')",
          )
          .get(actor.apiKeyId) as { total: number };
        if (
          key?.credit_limit !== null &&
          key?.credit_limit !== undefined &&
          used.total + q.max_credits > key.credit_limit
        )
          throw new AppError(409, 'API_BUDGET_EXCEEDED', '本次任务超出密钥额度上限');
      }
      const id = randomUUID(),
        date = now(),
        parts: JobInput[] = q.items_json ? JSON.parse(q.items_json) : snapshot(actor, wid, input);
      for (const part of parts) validate(actor, wid, part);
      sql
        .prepare(
          'INSERT INTO jobs(id,workspace_id,user_id,project_id,api_key_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          wid,
          actor.userId,
          input.projectId || null,
          actor.apiKeyId,
          input.operation,
          input.providerId,
          input.prompt,
          JSON.stringify(input),
          hash,
          requestId,
          PRICING,
          'queued',
          '等待处理',
          q.max_credits,
          date,
          date,
        );
      sql.prepare('UPDATE quotes SET used_job_id=? WHERE id=?').run(id, q.id);
      const unit = settings.validateCapability(wid, input).unit;
      const partUnits = parts.map((part) => billableUnits(actor, wid, part, unit));
      if (partUnits.reduce((sum, value) => sum + value, 0) !== q.units)
        throw new AppError(409, 'QUOTE_EXPIRED', '素材计费参数发生变化，请重新获取报价');
      const freeItemIds: string[] = [];
      for (const [index, part] of parts.entries()) {
        const itemId = randomUUID(),
          amount = (q.max_credits / q.units) * partUnits[index]!;
        sql
          .prepare(
            'INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,credits,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            itemId,
            id,
            wid,
            actor.userId,
            index,
            JSON.stringify(part),
            'queued',
            amount,
            date,
            date,
            date,
          );
        credits.reserve(wid, actor.userId, amount, id, itemId);
        if (input.operation === 'text.assist' && q.max_credits === 0) freeItemIds.push(itemId);
      }
      if (freeItemIds.length) core.entitlements.claimFreeTextAssist(actor, wid, id, freeItemIds);
      if (input.projectId)
        sql
          .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            wid,
            input.projectId,
            actor.userId,
            'user',
            input.prompt,
            id,
            JSON.stringify({ draft: input }),
            date,
          );
      event(wid, id, 'created', { status: 'queued' });
      return dto(actor, sql.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow);
    });
  }
  function refresh(jobId: string) {
    const rows = sql.prepare('SELECT * FROM job_items WHERE job_id=?').all(jobId) as ItemRow[];
    if (!rows.length) return;
    let status: JobStatus;
    const has = (s: string) => rows.some((r) => r.status === s);
    if (has('reconciliation_required')) status = 'reconciliation_required';
    else if (has('running')) status = 'running';
    else if (has('queued')) status = has('succeeded') ? 'running' : 'queued';
    else if (rows.every((r) => r.status === 'succeeded')) status = 'succeeded';
    else if (has('succeeded')) status = 'partial';
    else if (rows.every((r) => r.status === 'cancelled')) status = 'cancelled';
    else status = 'failed';
    const stages: Record<JobStatus, string> = {
      queued: '等待处理',
      running: '正在处理',
      succeeded: '创作完成',
      partial: '部分完成',
      failed: '处理失败',
      cancelled: '已取消',
      reconciliation_required: '需要核对服务商结果',
    };
    const error = rows.find((r) => r.error_message)?.error_message || null;
    const settled = (
      sql
        .prepare(
          "SELECT COALESCE(SUM(amount),0) AS amount FROM credit_ledger WHERE job_id=? AND kind='settle'",
        )
        .get(jobId) as { amount: number }
    ).amount;
    sql
      .prepare(
        'UPDATE jobs SET status=?,stage=?,settled_credits=?,error_message=?,updated_at=? WHERE id=?',
      )
      .run(status, stages[status], settled, error, now(), jobId);
    event(rows[0]!.workspace_id, jobId, 'updated', { status, stage: stages[status] });
  }
  function cancel(actor: Actor, wid: string, id: string) {
    getRow(actor, wid, id);
    core.requireAccess(actor, wid, 'write');
    checkScope(actor, 'jobs:write');
    return transaction(() => {
      const items = sql.prepare('SELECT * FROM job_items WHERE job_id=?').all(id) as ItemRow[];
      for (const item of items) {
        if (item.status === 'queued') {
          sql
            .prepare("UPDATE job_items SET status='cancelled',phase='done',updated_at=? WHERE id=?")
            .run(now(), item.id);
          credits.finish(wid, item.user_id, item.credits, id, item.id, false);
        } else if (item.status === 'running') {
          sql.prepare('UPDATE job_items SET cancel_requested=1 WHERE id=?').run(item.id);
        }
      }
      refresh(id);
      return dto(actor, getRow(actor, wid, id));
    });
  }
  function removeMember(wid: string, uid: string) {
    const rows = sql
      .prepare("SELECT * FROM job_items WHERE workspace_id=? AND user_id=? AND status='queued'")
      .all(wid, uid) as ItemRow[];
    for (const r of rows) {
      sql
        .prepare("UPDATE job_items SET status='cancelled',phase='done',updated_at=? WHERE id=?")
        .run(now(), r.id);
      credits.finish(wid, uid, r.credits, r.job_id, r.id, false);
      refresh(r.job_id);
    }
    credits.releaseMemberBudget(wid, uid);
  }
  function balance(actor: Actor, wid: string): CreditDto {
    core.requireAccess(actor, wid, 'read');
    checkScope(actor, 'credits:read');
    const a = credits.account(wid);
    const spent = sql
      .prepare(
        "SELECT COALESCE(SUM(amount),0) AS total FROM credit_ledger WHERE workspace_id=? AND kind='settle'",
      )
      .get(wid) as { total: number };
    return {
      ...a,
      available: a.balance - a.reserved,
      spent: spent.total,
      isDemo: config.demoMode,
      unit: 'credits',
    };
  }
  function list(
    actor: Actor,
    wid: string,
    query: {
      page?: number;
      pageSize?: number;
      status?: string;
      projectId?: string;
      operation?: string;
      from?: string;
      to?: string;
      createdBy?: string;
      downloaded?: 'true' | 'false';
      archived?: 'true' | 'false';
      q?: string;
    } = {},
  ) {
    core.requireAccess(actor, wid, 'read');
    checkScope(actor, 'jobs:read');
    const page = Math.max(1, query.page || 1),
      pageSize = Math.min(100, query.pageSize || 24);
    const clauses = ['workspace_id=?'];
    const args: (string | number)[] = [wid];
    clauses.push(
      `${query.archived === 'true' ? '' : 'NOT '}EXISTS(SELECT 1 FROM job_history_archives h WHERE h.job_id=jobs.id AND h.user_id=?)`,
    );
    args.push(actor.userId);
    if (query.downloaded) {
      clauses.push(
        `${query.downloaded === 'true' ? '' : 'NOT '}EXISTS(SELECT 1 FROM job_downloads d WHERE d.job_id=jobs.id AND d.user_id=?)`,
      );
      args.push(actor.userId);
    }
    if (query.from) {
      clauses.push('created_at>=?');
      args.push(query.from);
    }
    if (query.to) {
      clauses.push('created_at<=?');
      args.push(query.to);
    }
    if (query.createdBy) {
      clauses.push('user_id=?');
      args.push(query.createdBy);
    }
    if (query.q) {
      clauses.push('prompt LIKE ?');
      args.push(`%${query.q}%`);
    }
    if (query.status) {
      clauses.push('status=?');
      args.push(query.status);
    }
    if (query.projectId) {
      clauses.push('project_id=?');
      args.push(query.projectId);
    }
    if (query.operation) {
      clauses.push('operation=?');
      args.push(query.operation);
    }
    const where = clauses.join(' AND ');
    const total = (
      sql.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`).get(...args) as { n: number }
    ).n;
    const rows = sql
      .prepare(`SELECT * FROM jobs WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as JobRow[];
    return { items: rows.map((r) => dto(actor, r)), total, page, pageSize };
  }
  function pending(actor: Actor, wid: string, documentId?: string) {
    core.requireAccess(actor, wid, 'read');
    const rows = sql
      .prepare(
        `SELECT * FROM pending_applies WHERE workspace_id=? AND status='pending' ${documentId ? 'AND document_id=?' : ''} ORDER BY created_at`,
      )
      .all(...(documentId ? [wid, documentId] : [wid])) as {
      id: string;
      document_id: string;
      job_id: string;
      asset_id: string;
      asset_ids_json: string | null;
      output_kind: 'single' | 'layers';
      base_revision: number;
      target_layer_id: string | null;
      status: 'pending';
      created_at: string;
    }[];
    return rows.map((r): PendingApplyDto => ({
      id: r.id,
      documentId: r.document_id,
      jobId: r.job_id,
      assetId: r.asset_id,
      assetIds: r.asset_ids_json ? (JSON.parse(r.asset_ids_json) as string[]) : [r.asset_id],
      outputKind: r.output_kind,
      baseRevision: r.base_revision,
      targetLayerId: r.target_layer_id,
      status: r.status,
      createdAt: r.created_at,
    }));
  }
  function apply(
    actor: Actor,
    wid: string,
    id: string,
    expectedRevision: number,
    mode: 'new-layer' | 'replace',
    layerId?: string,
  ) {
    return transaction(() => {
      core.requireAccess(actor, wid, 'write');
      const p = pending(actor, wid).find((v) => v.id === id);
      if (!p) throw new AppError(404, 'RESULT_NOT_FOUND', '待应用结果不存在');
      const doc = core.documents.get(actor, wid, p.documentId),
        assets = p.assetIds.map((id) => core.assets.get(actor, wid, id)),
        asset = assets[0]!;
      if (!asset) throw new AppError(409, 'RESULT_EMPTY', '结果没有可应用的素材');
      if (p.outputKind === 'layers' && assets.some((a) => a.kind !== 'image'))
        throw new AppError(409, 'LAYER_TYPE', '分层结果仅支持图片素材');
      if (doc.revision !== expectedRevision)
        throw new AppError(409, 'REVISION_CONFLICT', '画布已发生变化，请重新加载后应用');
      if (!['image', 'video'].includes(asset.kind))
        throw new AppError(400, 'LAYER_TYPE', '此产物不能直接放入画布');
      const target = layerId || p.targetLayerId;
      const factor = Math.min(
        1,
        Math.max(16, doc.scene.canvas.width - 80) / (asset.width || 512),
        Math.max(16, doc.scene.canvas.height - 80) / (asset.height || 512),
      );
      const base: LayerBase = {
        id: randomUUID(),
        name: asset.name,
        x: Math.min(40, doc.scene.canvas.width / 10),
        y: Math.min(40, doc.scene.canvas.height / 10),
        width: (asset.width || 512) * factor,
        height: (asset.height || 512) * factor,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        visible: true,
        locked: false,
      };
      const layer: SceneLayer =
        p.outputKind === 'layers'
          ? {
              ...base,
              name: '图片分层',
              type: 'group',
              children: assets.map((a, index) => ({
                ...base,
                id: randomUUID(),
                name: `图层 ${index + 1}`,
                x: 0,
                y: 0,
                type: 'image',
                assetId: a.id,
                crop: null,
              })),
            }
          : asset.kind === 'video'
            ? {
                ...base,
                type: 'video',
                assetId: asset.id,
                posterAssetId: null,
                durationMs: asset.durationMs || 1000,
                trimStartMs: 0,
                trimEndMs: asset.durationMs || 1000,
                muted: false,
                loop: false,
              }
            : { ...base, type: 'image', assetId: asset.id, crop: null };
      let layers = doc.scene.layers;
      if (mode === 'replace') {
        let found = false;
        const replace = (values: SceneLayer[]): SceneLayer[] =>
          values.map((existing) => {
            if (existing.id !== target)
              return existing.type === 'group'
                ? { ...existing, children: replace(existing.children) }
                : existing;
            found = true;
            const transformed: SceneLayer = {
              ...layer,
              id: existing.id,
              x: existing.x,
              y: existing.y,
              width: existing.width,
              height: existing.height,
              rotation: existing.rotation,
              scaleX: existing.scaleX,
              scaleY: existing.scaleY,
              opacity: existing.opacity,
              visible: existing.visible,
              locked: existing.locked,
              skewX: existing.skewX,
              skewY: existing.skewY,
              flipX: existing.flipX,
              flipY: existing.flipY,
            };
            if (transformed.type === 'group')
              transformed.children = transformed.children.map((child) => ({
                ...child,
                width: existing.width,
                height: existing.height,
              }));
            return transformed;
          });
        layers = replace(layers);
        if (!found) throw new AppError(409, 'LAYER_MISSING', '原图层已删除，请选择新图层应用');
      } else layers = [...layers, layer];
      const saved = core.documents.saveInTransaction(actor, wid, {
        documentId: doc.id,
        expectedRevision,
        scene: { ...doc.scene, layers },
        reason: 'job-apply',
        sourceJobId: p.jobId,
      });
      sql
        .prepare("UPDATE pending_applies SET status='applied',updated_at=? WHERE id=?")
        .run(now(), id);
      return saved;
    });
  }
  function signedAssetUrl(
    wid: string,
    uid: string,
    jobId: string,
    assetId: string,
    variant: 'original' | 'mask-white' = 'original',
  ) {
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    const payload = `${wid}:${uid}:${jobId}:${assetId}:${expires}:${variant}`;
    const sig = createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
    return `${config.publicOrigin}/api/v1/provider-media/${assetId}?workspace=${wid}&owner=${uid}&job=${jobId}&expires=${expires}&variant=${variant}&signature=${sig}`;
  }
  function verifyMedia(
    wid: string,
    uid: string,
    jobId: string,
    assetId: string,
    expires: string,
    sig: string,
    variant: 'original' | 'mask-white' = 'original',
  ) {
    if (
      !/^\d+$/.test(expires) ||
      Number(expires) < Date.now() / 1000 ||
      Number(expires) > Date.now() / 1000 + 3700
    )
      return false;
    const expected = createHmac('sha256', config.sessionSecret)
      .update(`${wid}:${uid}:${jobId}:${assetId}:${expires}:${variant}`)
      .digest('hex');
    return /^[a-f0-9]{64}$/.test(sig) && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }
  async function readProviderMedia(
    wid: string,
    uid: string,
    jobId: string,
    assetId: string,
    variant: 'original' | 'mask-white' = 'original',
  ) {
    const job = sql
      .prepare('SELECT * FROM jobs WHERE id=? AND workspace_id=? AND user_id=?')
      .get(jobId, wid, uid) as JobRow | undefined;
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', '任务不存在');
    const items = sql.prepare('SELECT input_json FROM job_items WHERE job_id=?').all(job.id) as {
      input_json: string;
    }[];
    const allowed = items.some((row) => {
      const input = jobInputSchema.parse(JSON.parse(row.input_json));
      if (variant === 'mask-white')
        return input.providerId === 'flyelep' && input.maskAssetId === assetId;
      return [
        ...input.assetIds,
        ...input.referenceAssetIds,
        ...(input.maskAssetId ? [input.maskAssetId] : []),
      ].includes(assetId);
    });
    if (!allowed) throw new AppError(403, 'ASSET_REFERENCE', '素材未包含在本次任务快照中');
    const file = await core.assets.readOriginalForJob(
      { workspaceId: wid, createdBy: uid, projectId: job.project_id, jobId },
      assetId,
    );
    if (variant === 'mask-white') {
      const meta = await sharp(file.buffer).metadata();
      if (!meta.hasAlpha) throw new AppError(400, 'INVALID_MASK', '遮罩必须包含透明编辑区域');
      const buffer = await sharp(file.buffer)
        .extractChannel('alpha')
        .negate()
        .toColourspace('srgb')
        .png()
        .toBuffer();
      return { ...file, buffer, mimeType: 'image/png' };
    }
    // Cloud providers receive the same display coordinates used by previews and masks.
    // The separate authenticated original-download endpoint keeps the uploaded bytes.
    if (file.mimeType.startsWith('image/')) {
      const normalized = await canonicalImage(file);
      return { ...file, buffer: normalized.buffer, mimeType: normalized.mimeType };
    }
    return file;
  }
  return {
    db,
    core,
    config,
    credits,
    settings,
    transaction,
    event,
    quote,
    retryQuote,
    submit,
    get: (a: Actor, w: string, id: string) => dto(a, getRow(a, w, id)),
    getRow,
    dto,
    list,
    cancel,
    removeMember,
    balance,
    refresh,
    pending,
    apply,
    signedAssetUrl,
    verifyMedia,
    readProviderMedia,
    validate,
  };
}
export type TaskServices = ReturnType<typeof createTaskServices>;

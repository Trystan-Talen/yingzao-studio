import { createHash } from 'node:crypto';
import { z } from 'zod';
import { providerJson } from './http';
import { CREATIVE_INTENT_SERVER_TIMEOUT_MS } from '../../contracts/creative-intent-timing';
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderResult,
  type RemoteTask,
  type ExecutionContext,
} from '../tasks/types';
import {
  detailPageBriefSchema,
  detailPagePlanResultSchema,
  formatDetailPagePlan,
  type DetailPageBrief,
  type DetailPagePlanResult,
} from '../../contracts/detail-page';
import {
  creativeIntentRequestSchema,
  creativeIntentResultSchema,
  validateCreativeIntent,
  type CreativeIntentRequest,
  type CreativeIntentResult,
} from '../../contracts/creative-intent';

const text = z.string().max(12000);
const nonemptyText = text.refine((value) => value.trim().length > 0);
const textList = z
  .array(
    z
      .string()
      .max(4000)
      .refine((value) => value.trim().length > 0),
  )
  .max(50);
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const difyPlanSchema = z
  .object({
    schema_version: z.literal('1.0'),
    status: z.literal('needs_confirmation'),
    delivery_type: z.enum(['image', 'video', 'both', 'unclear']),
    product_facts: textList,
    unknowns: textList,
    creative_direction: text,
    image_tasks: z
      .array(
        z
          .object({
            id: identifier,
            purpose: nonemptyText,
            prompt: nonemptyText,
            reference_required: z.boolean(),
          })
          .strict(),
      )
      .max(3),
    video_shots: z
      .array(
        z
          .object({
            id: identifier,
            source_image_id: identifier,
            prompt: nonemptyText,
            duration_seconds: z.number().finite().min(0).max(15),
          })
          .strict(),
      )
      .max(3),
    voiceover_text: text,
    questions: textList,
  })
  .strict()
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    const imageIds = new Set(plan.image_tasks.map((task) => task.id));
    for (const task of [...plan.image_tasks, ...plan.video_shots]) {
      if (ids.has(task.id)) ctx.addIssue({ code: 'custom', message: 'PLAN_ID_DUPLICATED' });
      ids.add(task.id);
    }
    for (const shot of plan.video_shots)
      if (!imageIds.has(shot.source_image_id))
        ctx.addIssue({ code: 'custom', message: 'PLAN_SOURCE_REFERENCE_INVALID' });
    if (
      (plan.delivery_type === 'image' &&
        (!plan.image_tasks.length || plan.video_shots.length > 0)) ||
      (['video', 'both'].includes(plan.delivery_type) &&
        (!plan.video_shots.length || !plan.image_tasks.length))
    )
      ctx.addIssue({ code: 'custom', message: 'PLAN_DELIVERY_TASKS_INVALID' });
    if (
      (plan.delivery_type === 'unclear' ||
        plan.video_shots.some((shot) => shot.duration_seconds === 0)) &&
      !plan.questions.length
    )
      ctx.addIssue({ code: 'custom', message: 'PLAN_CONFIRMATION_REQUIRED' });
  });

export type DifyPlan = z.infer<typeof difyPlanSchema>;

/** JSON.parse accepts duplicate keys; reject them before trusting the workflow contract. */
function parseUniqueJson(source: string): unknown {
  const parsed: unknown = JSON.parse(source);
  const stack: { keys?: Set<string>; keyExpected: boolean }[] = [];
  for (const [token] of source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g)) {
    const current = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), keyExpected: true });
    else if (token === '[') stack.push({ keyExpected: false });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ':' && current) current.keyExpected = false;
    else if (token === ',' && current?.keys) current.keyExpected = true;
    else if (token.startsWith('"') && current?.keys && current.keyExpected) {
      const key: string = JSON.parse(token);
      if (current.keys.has(key)) throw new Error('PLAN_DUPLICATE_KEY');
      current.keys.add(key);
    }
  }
  return parsed;
}

export function parseDifyPlanJson(value: unknown): DifyPlan {
  try {
    if (typeof value !== 'string' || !value.trim() || value.length > 65536)
      throw new Error('PLAN_JSON_INVALID');
    return difyPlanSchema.parse(parseUniqueJson(value));
  } catch {
    throw new ProviderError(
      'Dify（工作流编排平台）返回的策划结构不完整或不一致，请核对本次结果。',
      true,
      'DIFY_PLAN_INVALID',
    );
  }
}

/** Intent is a separate contract; it never changes the two existing planning modes. */
export function parseDifyIntentJson(
  value: unknown,
  request: CreativeIntentRequest,
): CreativeIntentResult {
  try {
    const input = creativeIntentRequestSchema.parse(request);
    if (typeof value !== 'string' || !value.trim() || value.length > 65536)
      throw new Error('INTENT_JSON_INVALID');
    const result = creativeIntentResultSchema.parse(parseUniqueJson(value));
    validateCreativeIntent(result, input);
    if (new Set(input.sourceTexts.map((source) => source.id)).size !== input.sourceTexts.length)
      throw new Error('INTENT_SOURCE_DUPLICATED');
    if (result.status === 'ready') {
      if (
        (!['', '通用电商'].includes(input.context.platform) &&
          result.brief.platform !== input.context.platform) ||
        (input.context.placement !== 'general' &&
          result.brief.placement !== input.context.placement) ||
        result.brief.market !== input.context.market
      )
        throw new Error('INTENT_CONTEXT_CHANGED');
    }
    return result;
  } catch {
    throw new ProviderError(
      '需求理解结果不完整或与本次输入不一致，请核对已有结果；不会自动重新调用模型。',
      true,
      'DIFY_INTENT_INVALID',
    );
  }
}

export async function analyzeDifyIntent(
  request: CreativeIntentRequest,
  secret: string,
  options: { baseUrl?: string; user: string },
): Promise<CreativeIntentResult> {
  let input: CreativeIntentRequest;
  let serialized: string;
  let endpoint: string;
  try {
    input = creativeIntentRequestSchema.parse(request);
    serialized = JSON.stringify(input);
    if (
      serialized.length > 120000 ||
      new Set(input.sourceTexts.map((source) => source.id)).size !== input.sourceTexts.length ||
      !secret?.trim() ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(options.user)
    )
      throw new Error('INTENT_REQUEST_INVALID');
    const base = new URL(options.baseUrl ?? 'https://api.dify.ai/v1');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
      throw new Error('INTENT_URL_INVALID');
    endpoint = `${base.href.replace(/\/+$/, '')}/workflows/run`;
  } catch {
    throw new ProviderError(
      '需求理解输入或服务配置不完整，请核对后再提交。',
      false,
      'DIFY_INTENT_REQUEST_INVALID',
    );
  }
  try {
    const response = workflowResponseSchema.parse(
      await providerJson(endpoint, {
        headers: { Authorization: `Bearer ${secret}` },
        body: {
          inputs: {
            brief: input.rawPrompt,
            planning_mode: 'intent',
            intent_request_json: serialized,
          },
          response_mode: 'blocking',
          user: options.user,
        },
        submission: true,
        timeoutMs: CREATIVE_INTENT_SERVER_TIMEOUT_MS,
      }),
    );
    if (response.data.status === 'failed' || response.data.status === 'stopped')
      throw new ProviderError(
        response.data.status === 'stopped'
          ? '需求理解工作流已停止，尚未提交媒体生成。重新检查可能再次计费，请明确发起；不会自动重新调用模型。'
          : '需求理解工作流已失败，尚未提交媒体生成。重新检查可能再次计费，请明确发起；不会自动重新调用模型。',
        false,
        'DIFY_INTENT_FAILED',
      );
    if (response.data.status !== 'succeeded') throw new Error('INTENT_WORKFLOW_INCOMPLETE');
    try {
      return parseDifyIntentJson(response.data.outputs?.plan_json, input);
    } catch (error) {
      // The run has explicitly finished; rejected output is a local terminal failure,
      // not an unknown submission. Keep transport/envelope failures ambiguous below.
      if (error instanceof ProviderError && error.code === 'DIFY_INTENT_INVALID')
        throw new ProviderError(
          '需求理解结果未通过校验，尚未提交媒体生成。重新检查可能再次计费，请明确发起；不会自动重新调用模型。',
          false,
          error.code,
        );
      throw error;
    }
  } catch (error) {
    if (
      error instanceof ProviderError &&
      ['DIFY_INTENT_INVALID', 'DIFY_INTENT_FAILED'].includes(error.code)
    )
      throw error;
    throw new ProviderError(
      '需求理解服务未返回完整结果，请核对本次工作流；不会自动重新调用模型。',
      true,
      'DIFY_INTENT_UNCERTAIN',
    );
  }
}

const detailPageInternalPlaceholders = [
  '品牌待确认',
  '容量待确认',
  '价格待补充',
  '售后待补充',
  '价格售后待补充',
  '价格/售后待补充',
  '参数待填',
  '参考图待确认',
  '待确认商品',
];

export function parseDifyDetailPageJson(
  value: unknown,
  expected: Pick<DetailPageBrief, 'screenCount' | 'ratio'>,
): DetailPagePlanResult {
  try {
    if (typeof value !== 'string' || !value.trim() || value.length > 65536)
      throw new Error('PLAN_JSON_INVALID');
    const result = detailPagePlanResultSchema.parse(parseUniqueJson(value));
    if (
      result.plan.screens.length !== expected.screenCount ||
      result.plan.screens.some((screen) => screen.ratio !== expected.ratio)
    )
      throw new Error('DETAIL_PAGE_REQUEST_MISMATCH');
    // Guard newly generated output only; existing saved drafts retain their historical schema.
    const finishedContent = [
      result.plan.visualStyle,
      result.plan.consistencyNotes,
      ...result.plan.screens.flatMap((screen) => [screen.title, ...screen.copy, screen.prompt]),
    ];
    if (
      finishedContent.some((value) =>
        detailPageInternalPlaceholders.some((placeholder) => value.includes(placeholder)),
      )
    )
      throw new Error('DETAIL_PAGE_INTERNAL_PLACEHOLDER');
    return result;
  } catch {
    throw new ProviderError(
      'Dify（工作流编排平台）返回的详情页方案不完整，或屏数、比例与请求不一致，请核对本次结果。',
      true,
      'DIFY_DETAIL_PAGE_INVALID',
    );
  }
}

export function formatDifyPlan(plan: DifyPlan): string {
  const list = (values: string[]) => values.map((value) => `- ${value}`).join('\n');
  const delivery = { image: '图片', video: '视频', both: '图片与视频', unclear: '待澄清' };
  return [
    '创作策划（待确认）\n本次仅生成计划，尚未执行图片、视频或配音生成。',
    `交付类型：${delivery[plan.delivery_type]}`,
    `商品事实：\n${list(plan.product_facts) || '用户尚未提供明确商品事实。'}`,
    `待补充信息：\n${list(plan.unknowns) || '计划未列出待补充信息。'}`,
    `创作方向：\n${plan.creative_direction || '尚未提供。'}`,
    `图片任务：\n${
      plan.image_tasks
        .map(
          (task, index) =>
            `${index + 1}. ${task.purpose}\n任务编号：${task.id}\n参考素材：${task.reference_required ? '需要提供，尚未核验' : '计划未要求'}\n提示词：${task.prompt}`,
        )
        .join('\n\n') || '未安排图片任务。'
    }`,
    `视频镜头：\n${
      plan.video_shots
        .map(
          (shot, index) =>
            `${index + 1}. 镜头编号：${shot.id}\n首帧图片任务：${shot.source_image_id}\n时长：${shot.duration_seconds === 0 ? '待确认' : `${shot.duration_seconds} 秒（计划值，需核对模型支持范围）`}\n提示词：${shot.prompt}`,
        )
        .join('\n\n') || '未安排视频镜头。'
    }`,
    `口播文案：\n${plan.voiceover_text || '未安排口播文案。'}`,
    `待确认问题：\n${list(plan.questions) || '请确认上述计划后再手动提交生成任务。'}`,
  ].join('\n\n');
}

const workflowResponseSchema = z.object({
  workflow_run_id: z.string().min(1),
  data: z.object({
    status: z.enum(['succeeded', 'failed', 'stopped', 'running']),
    outputs: z.record(z.string(), z.unknown()).nullable().optional(),
    error: z.unknown().optional(),
  }),
});

const runIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const remoteDetailSchema = z.object({
  id: runIdSchema,
  difyMode: z.literal('detail-page'),
  detailPageScreenCount: z.number().int().min(2).max(10),
  detailPageRatio: z.enum(['3:4', '2:3', '9:16']),
});
const runDetailSchema = z.object({
  id: runIdSchema,
  status: z.enum([
    'succeeded',
    'failed',
    'stopped',
    'running',
    'pending',
    'paused',
    'partial-succeeded',
  ]),
  outputs: z.record(z.string(), z.unknown()).nullish(),
  error: z.unknown().optional(),
});

const detailHttpFailureStages = {
  FACTS: '商品事实提取',
  VISUAL: '整套视觉规范',
  SCREENS: '逐屏策划',
};
const detailHttpFailureStatuses = {
  '400': '请求内容不符合模型接口要求',
  '401': '模型接口身份验证失败',
  '403': '模型接口访问权限不足',
  '404': '模型或接口地址不存在',
  '408': '模型请求超时',
  '409': '模型请求状态冲突',
  '422': '请求参数不被模型服务接受',
  '429': '模型服务限流，请求过于频繁',
  '500': '模型服务内部错误',
  '502': '模型网关响应异常',
  '503': '模型服务繁忙',
  '504': '模型网关响应超时',
  OTHER: '模型接口返回不支持的状态',
};
// Generate only this finite allowlist; no upstream stage, status, or body becomes display text.
const detailHttpFailureReasons = Object.fromEntries(
  Object.entries(detailHttpFailureStages).flatMap(([code, stage]) =>
    Object.entries(detailHttpFailureStatuses).map(([status, reason]) => [
      `DETAIL_PAGE_${code}_HTTP_${status}`,
      `${stage}：${reason}${status === 'OTHER' ? '' : `（${status}）`}`,
    ]),
  ),
);
const detailFailureReasons: Record<string, string> = {
  ...detailHttpFailureReasons,
  DETAIL_PAGE_FIELDS_INVALID: '方案缺少必填字段或包含不支持的字段',
  DETAIL_PAGE_JSON_INVALID: '模型没有返回完整、有效的结构化方案',
  DETAIL_PAGE_DUPLICATE_KEY: '方案中存在重复字段，无法安全确定采用哪个值',
  DETAIL_PAGE_TEXT_INVALID: '方案中有必填文本为空或文本长度超出限制',
  DETAIL_PAGE_LIST_INVALID: '方案中的列表条数或条目格式不符合要求',
  DETAIL_PAGE_RESPONSE_STATUS_INVALID: '模型接口返回了非成功状态',
  DETAIL_PAGE_RESPONSE_INVALID: '模型接口响应缺少有效的策划内容',
  DETAIL_PAGE_RESPONSE_INCOMPLETE: '模型输出未完整结束，可能达到长度限制或被中止',
  DETAIL_PAGE_FACT_NOT_IN_BRIEF: '商品事实未能逐字对应本次需求，已停止以避免加入未经提供的信息',
  DETAIL_PAGE_SCREEN_COUNT_MISMATCH: '方案屏数与本次请求不一致',
  DETAIL_PAGE_SCREEN_COUNT_INVALID: '请求屏数必须是 2–10 之间的整数',
  DETAIL_PAGE_SCREEN_ID_INVALID: '方案屏幕编号重复或格式不合法',
  DETAIL_PAGE_RATIO_INVALID: '请求的详情页比例不受支持',
  DETAIL_PAGE_RATIO_MISMATCH: '方案中的屏幕比例与本次请求不一致',
  DETAIL_PAGE_UNSOURCED_NUMBER: '展示文案包含需求中没有提供的数字',
  DETAIL_PAGE_UNSOURCED_CLAIM: '展示文案包含需求中没有提供的功效、认证或营销声明',
  DETAIL_PAGE_INTERNAL_PLACEHOLDER: '成品文案或画面要求混入了内部待确认占位内容',
  DETAIL_PAGE_RESULT_TOO_LARGE: '整套方案长度超过可安全保存的限制',
  DETAIL_PAGE_MODEL_UNSUPPORTED: '策划节点配置的模型与当前工作流合同不一致',
};

/** Only fixed, allowlisted codes select messages; upstream text is never returned to users. */
function workflowFailureMessage(status: string, error: unknown, detailPage = true): string {
  const name = detailPage ? '商品详情页策划' : '创作策划';
  const code =
    typeof error === 'string'
      ? error.slice(0, 16384).match(/\bDETAIL_PAGE_[A-Z0-9_]+\b/)?.[0]
      : undefined;
  const reason = code ? detailFailureReasons[code] : undefined;
  const summary =
    reason ||
    (status === 'stopped'
      ? `${name}工作流已停止`
      : status === 'partial-succeeded'
        ? `${name}工作流只有部分节点完成`
        : `${name}工作流执行失败，暂未取得完整方案`);
  return `${summary}。未提交图片生成；请核对同一次运行的已有结果，不会自动重新调用模型。`;
}

function detailResult(value: unknown, remote: RemoteTask): ProviderResult {
  const metadata = remoteDetailSchema.safeParse(remote);
  const result = runDetailSchema.safeParse(value);
  if (!metadata.success || !result.success || result.data.id !== remote.id)
    throw new ProviderError(
      '策划运行编号或返回结构不一致，需核对已有工作流。',
      true,
      'DIFY_RESULT_UNCERTAIN',
    );
  if (['running', 'pending'].includes(result.data.status))
    return { state: 'running', stage: '商品详情页策划进行中，正在查询同一工作流' };
  if (result.data.status === 'paused')
    throw new ProviderError(
      '商品详情页工作流已暂停，请在 Dify（工作流编排平台）核对同一运行记录。',
      true,
      'DIFY_WORKFLOW_PAUSED',
    );
  if (result.data.status !== 'succeeded')
    return {
      state: 'failed',
      message: workflowFailureMessage(result.data.status, result.data.error),
    };
  const data = parseDifyDetailPageJson(result.data.outputs?.plan_json, {
    screenCount: metadata.data.detailPageScreenCount,
    ratio: metadata.data.detailPageRatio,
  });
  return {
    state: 'complete',
    outputs: [
      {
        text: formatDetailPagePlan(data.plan),
        resultData: data,
        mimeType: 'text/plain',
        name: '商品详情页策划-待确认.txt',
      },
    ],
  };
}

/** Keep the original stream open; disconnecting a listener can stop some Dify versions. */
async function streamDetailPlan(
  endpoint: string,
  inputs: Record<string, string | number>,
  user: string,
  secret: string,
  detail: DetailPageBrief,
  onAccepted: ExecutionContext['onRemoteAccepted'],
): Promise<ProviderResult> {
  let remote: RemoteTask | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const controller = new AbortController();
  // Three sequential HTTP nodes each have a 120-second read bound, plus code/connection time.
  const timer = setTimeout(() => controller.abort(), 600000);
  timer.unref();
  let terminal = false;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ inputs, response_mode: 'streaming', user }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderError(
        [401, 403].includes(response.status)
          ? '策划服务密钥无效或权限不足。'
          : response.status === 429
            ? '策划服务当前请求过多，请稍后重新估价。'
            : `策划服务返回错误（${response.status}）。`,
        response.status >= 500,
        `PROVIDER_HTTP_${response.status}`,
      );
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
      throw new ProviderError(
        '策划服务未返回可恢复的事件流，请核对本次提交。',
        true,
        'DIFY_STREAM_INVALID',
      );
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '',
      size = 0;
    async function event(frame: string): Promise<ProviderResult | undefined> {
      const payload = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!payload || payload === '[DONE]') return;
      const value = z
        .object({
          event: z.string(),
          workflow_run_id: runIdSchema.optional(),
          data: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(parseUniqueJson(payload));
      if (value.event === 'workflow_started') {
        const id = runIdSchema.parse(value.workflow_run_id ?? value.data?.id);
        if ((value.data?.id && value.data.id !== id) || (remote && remote.id !== id))
          throw new Error('DIFY_ID_CHANGED');
        if (!remote) {
          remote = {
            id,
            difyMode: 'detail-page',
            detailPageScreenCount: detail.screenCount,
            detailPageRatio: detail.ratio,
          };
          // The worker fences this write and stores the remote ID before more stream data is read.
          await onAccepted?.(remote);
        }
      }
      if (value.event === 'workflow_finished') {
        const id = runIdSchema.parse(value.workflow_run_id ?? value.data?.id);
        if (!remote || remote.id !== id || (value.data?.id && value.data.id !== id))
          throw new Error('DIFY_ID_CHANGED');
        terminal = true;
        return detailResult({ ...value.data, id }, remote);
      }
      if (value.event === 'error') throw new Error('DIFY_STREAM_ERROR');
    }
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8 * 1024 * 1024) throw new Error('DIFY_STREAM_TOO_LARGE');
      buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
      if (buffer.length > 1024 * 1024) throw new Error('DIFY_EVENT_TOO_LARGE');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const result = await event(frame);
        if (result) return result;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const result = await event(buffer);
      if (result) return result;
    }
    if (remote) return { state: 'submitted', remote };
    throw new ProviderError(
      '策划事件流在返回运行编号前中断，请核对提交；不会自动重复生成。',
      true,
      'DIFY_RESULT_UNCERTAIN',
    );
  } catch (error) {
    // Once accepted, recovery is GET-only. Invalid completed output must stay ambiguous.
    if (remote && !terminal) return { state: 'submitted', remote };
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      '策划连接或事件流中断，请核对已有工作流；不会自动重复生成。',
      true,
      'DIFY_RESULT_UNCERTAIN',
    );
  } finally {
    clearTimeout(timer);
    // Never close at workflow_started. Only completion, EOF, or bounded failure reaches here.
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export function createDifyProvider(options: { baseUrl?: string } = {}): ProviderAdapter {
  let endpoint: string;
  try {
    const base = new URL(options.baseUrl ?? 'https://api.dify.ai/v1');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
      throw new Error('DIFY_URL_INVALID');
    endpoint = `${base.href.replace(/\/+$/, '')}/workflows/run`;
  } catch {
    throw new ProviderError(
      'Dify（工作流编排平台）接口基础地址必须是无凭据和查询参数的 HTTPS（加密网页协议）地址。',
    );
  }
  return {
    id: 'dify',
    async execute(context, secret) {
      if (!secret?.trim()) throw new ProviderError('请先配置 Dify（工作流编排平台）应用密钥。');
      const input = context.input;
      const detailPage = input.options.assistantMode === 'detail-page';
      if (
        input.operation !== 'text.assist' ||
        (!detailPage && input.options.assistantMode !== 'ideas')
      )
        throw new ProviderError('此工作流仅支持创作策划，请切换到创作策划入口。');
      if (input.options.count !== 1 || input.options.designs?.length)
        throw new ProviderError('当前工作流每次仅接受一份文字需求，不支持批量设计任务。');
      if (
        input.assetIds.length ||
        input.referenceAssetIds.length ||
        input.maskAssetId ||
        input.backgroundAssetId ||
        input.backgroundAudioAssetId ||
        input.characterId ||
        input.brandId ||
        input.linkUrl
      )
        throw new ProviderError('当前工作流仅接收文字需求，不支持图片、人物或品牌素材。');
      if (input.referenceText?.trim() || input.conversationContext?.trim())
        throw new ProviderError('当前工作流仅分析本次文字需求，请将需要的资料明确写入需求。');
      const brief = input.prompt.trim();
      if (!brief || brief.length > 8000) throw new ProviderError('创作策划需求须为 1–8000 字符。');
      const detail = detailPage
        ? detailPageBriefSchema.safeParse({
            brief,
            screenCount: input.options.detailPageScreenCount,
            ratio: input.options.ratio,
          })
        : undefined;
      if (detail && !detail.success)
        throw new ProviderError('详情页需求须为 1–5000 字符、2–10 屏，比例为 3:4、2:3 或 9:16。');
      const detailBrief = detail?.success ? detail.data : undefined;
      const user = `yingzao_${createHash('sha256')
        .update(JSON.stringify([context.workspaceId, context.actor.userId]))
        .digest('hex')
        .slice(0, 48)}`;
      if (detailBrief)
        return streamDetailPlan(
          endpoint,
          {
            brief,
            planning_mode: 'detail-page',
            screen_count: detailBrief.screenCount,
            ratio: detailBrief.ratio,
          },
          user,
          secret,
          detailBrief,
          context.onRemoteAccepted,
        );
      const response = await providerJson(endpoint, {
        headers: { Authorization: `Bearer ${secret}` },
        body: {
          inputs: { brief },
          response_mode: 'blocking',
          user,
        },
        submission: true,
        timeoutMs: 120000,
      });
      const result = workflowResponseSchema.safeParse(response);
      if (!result.success || result.data.data.status === 'running')
        throw new ProviderError(
          '工作流未返回明确的完成状态，请核对本次执行结果。',
          true,
          'DIFY_RESULT_UNCERTAIN',
        );
      if (result.data.data.status !== 'succeeded')
        return {
          state: 'failed',
          message: workflowFailureMessage(result.data.data.status, result.data.data.error, false),
        };
      const plan = parseDifyPlanJson(result.data.data.outputs?.plan_json);
      return {
        state: 'complete',
        outputs: [
          { text: formatDifyPlan(plan), mimeType: 'text/plain', name: '创作策划-待确认.txt' },
        ],
      };
    },
    async poll(remote, secret) {
      if (!secret?.trim() || !remoteDetailSchema.safeParse(remote).success)
        throw new ProviderError(
          '详情页工作流恢复信息或应用密钥缺失，请核对原任务。',
          true,
          'DIFY_RECOVERY_INVALID',
        );
      const response = await providerJson(`${endpoint}/${encodeURIComponent(remote.id)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
        timeoutMs: 30000,
      });
      return detailResult(response, remote);
    },
  };
}

import { seedanceModel } from './documented-models';
import { z } from 'zod';
import type { JobInput } from '../../contracts/jobs';
import { providerJson } from './http';
import { ProviderError, type ProviderAdapter } from '../tasks/types';

// New API's official Doubao task plugin exposes this native route outside /v1.
// https://github.com/QuantumNous/new-api-plugins/blob/main/plugins/tasks/doubao/1.0.0/plugin.js
const nativeTaskPath = '/doubao/api/v3/contents/generations/tasks';
const defaultTaskBaseUrl = `https://xingyunyinli.com${nativeTaskPath}`;
const defaultModel = 'doubao-seedance-2.0';
const taskId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const submissionSchema = z.object({ id: taskId });
const statusSchema = z.object({
  id: taskId,
  status: z.string(),
  content: z.object({ video_url: z.string().optional() }).nullish(),
});

export interface SeedanceProviderOptions {
  /** Native query collection on the same New API gateway used for /v1/videos submissions. */
  taskBaseUrl?: string;
  baseUrl?: string;
  model?: string;
}

function configuredUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('视频任务服务地址无效。');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new ProviderError('视频任务服务必须使用不含凭据、查询参数的 HTTPS 地址。');
  return url;
}

function resolveTaskBaseUrl(options: SeedanceProviderOptions): string {
  if (options.taskBaseUrl) {
    const url = configuredUrl(options.taskBaseUrl);
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (!url.pathname.endsWith('/api/v3/contents/generations/tasks'))
      throw new ProviderError('请配置完整的视频原生任务地址。');
    return url.href;
  }
  if (!options.baseUrl) return defaultTaskBaseUrl;
  const url = configuredUrl(options.baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '' && path !== '/v1')
    throw new ProviderError('基础地址仅支持站点根目录或 /v1；其他路径请使用完整任务地址。');
  return `${url.origin}${nativeTaskPath}`;
}

/** Only the bounded text-to-video contract is enabled; validate before quoting, too. */
export function validateSeedanceInput(input: JobInput, options: { model?: string } = {}): void {
  const o = input.options;
  const spec = seedanceModel(options.model || o.model || defaultModel);
  if (input.operation !== 'video.generate')
    throw new ProviderError('此视频服务当前仅支持文字生成视频。');
  if (!input.prompt.trim()) throw new ProviderError('请填写视频描述。');
  // Legacy prompt flags can also configure native output. Keep paid parameters explicit.
  if (/--(?:rs|rt|dur|fps|frames|resolution|ratio|duration)\b/i.test(input.prompt))
    throw new ProviderError('请通过视频选项设置时长和画幅，描述中不能包含模型参数指令。');
  if (o.count !== 1 || !spec.durations.includes(o.duration))
    throw new ProviderError('请选择当前模型支持的时长，每次生成一条视频。');
  if (!spec.resolutions.some((value) => value.toLowerCase() === o.resolution.toLowerCase()))
    throw new ProviderError('所选分辨率不受当前视频模型支持。');
  if (!spec.ratios.includes(o.ratio)) throw new ProviderError('所选画面比例不受当前视频模型支持。');
  if (o.generateAudio === true && spec.audio?.mode !== 'generated')
    throw new ProviderError('当前视频模型未接入生成音频。');
  if (o.needText) throw new ProviderError('此视频服务当前不支持视频字幕，请关闭字幕选项。');
  if (
    input.assetIds.length ||
    input.referenceAssetIds.length ||
    input.maskAssetId ||
    input.backgroundAssetId ||
    input.backgroundAudioAssetId ||
    input.characterId ||
    input.brandId ||
    input.referenceText?.trim() ||
    input.conversationContext?.trim() ||
    input.linkUrl?.trim() ||
    o.referenceMode === 'first-last' ||
    o.designs?.length
  )
    throw new ProviderError('此视频服务当前仅接受文字描述，不支持参考素材或附加上下文。');
  if (o.width !== undefined || o.height !== undefined)
    throw new ProviderError('此视频服务请使用分辨率与画幅选项，不支持自定义宽高。');
  if (options.model && o.model && o.model !== options.model)
    throw new ProviderError('所选视频模型与已连接的服务配置不符。');
}

function outputUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value || '');
  } catch {
    throw new ProviderError('视频任务完成但未返回有效视频地址，需要核对。', true);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new ProviderError('视频任务返回了不受支持的视频地址，需要核对。', true);
  // The worker downloads this public/signed media URL without the provider's credentials.
  return url.href;
}

export function createSeedanceProvider(options: SeedanceProviderOptions = {}): ProviderAdapter {
  const taskBaseUrl = resolveTaskBaseUrl(options);
  // The host video protocol resolves channel model_mapping aliases; native POST checks the
  // plugin's canonical model list before channel mapping. Keep the site's configured alias.
  // https://github.com/QuantumNous/new-api/blob/main/middleware/task_plugin.go
  // https://github.com/QuantumNous/new-api/blob/main/pkg/jsplugin/routing.go
  const submitUrl = new URL('/v1/videos', taskBaseUrl).href;
  const model = options.model ?? defaultModel;
  if (!model.trim() || model !== model.trim() || model.length > 120)
    throw new ProviderError('视频模型配置无效。');
  return {
    id: 'seedance',
    async execute(context, secret) {
      if (!secret) throw new ProviderError('请先连接视频生成服务。');
      validateSeedanceInput(context.input, { model });
      const input = context.input;
      const parsed = submissionSchema.safeParse(
        await providerJson(submitUrl, {
          headers: { Authorization: `Bearer ${secret}` },
          body: {
            model,
            prompt: input.prompt.trim(),
            seconds: input.options.duration,
            // The Doubao host decoder forwards native generation options from metadata.
            metadata: {
              resolution: input.options.resolution.toLowerCase(),
              ratio: input.options.ratio,
              generate_audio: input.options.generateAudio ?? false,
            },
          },
          submission: true,
          timeoutMs: 120000,
        }),
      );
      if (!parsed.success)
        throw new ProviderError('视频服务未返回有效任务编号，需要核对本次提交。', true);
      // Persist only the task identifier and our configured endpoint, never returned auth URLs.
      return { state: 'submitted', remote: { id: parsed.data.id, endpoint: taskBaseUrl } };
    },
    async poll(remote, secret) {
      if (!secret) throw new ProviderError('视频任务查询凭据缺失。', true);
      if (!taskId.safeParse(remote.id).success || remote.endpoint !== taskBaseUrl)
        throw new ProviderError('视频任务编号或服务地址不匹配，需要核对。', true);
      const parsed = statusSchema.safeParse(
        await providerJson(`${taskBaseUrl}/${encodeURIComponent(remote.id)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${secret}` },
          timeoutMs: 30000,
        }),
      );
      if (!parsed.success || parsed.data.id !== remote.id)
        throw new ProviderError('视频任务查询响应不完整或编号不匹配，需要核对。', true);
      const result = parsed.data;
      switch (result.status) {
        case 'pending':
        case 'queued':
          return { state: 'running', stage: '视频服务排队中' };
        case 'processing':
        case 'running':
          return { state: 'running', stage: '视频生成中' };
        case 'succeeded':
          return {
            state: 'complete',
            outputs: [
              {
                url: outputUrl(result.content?.video_url),
                mimeType: 'video/mp4',
                name: '生成视频.mp4',
              },
            ],
          };
        case 'failed':
        case 'expired':
        case 'cancelled':
          return { state: 'failed', message: '视频服务未能完成该任务，请核对服务商任务记录。' };
        default:
          throw new ProviderError('视频服务返回了未知任务状态，需要核对。', true);
      }
    },
  };
}

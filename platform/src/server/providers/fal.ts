import { buildVideoAudioRequest, validateVideoAudioInput } from './video-audio';
import { z } from 'zod';
import { providerJson } from './http';
import { buildFalReferenceRequest, isFalReferenceModel } from './fal-reference';
import { falExtraProvider, isFalExtraOperation, isFalExtraEndpoint } from './fal-extra';
import { buildWanPrompt } from './wan-options';
import { buildFalErasureRequest } from './erasure';
import { canonicalImage } from './image-input';
import { buildFalMotionRequest } from './fal-motion';
import {
  ProviderError,
  type ProviderAdapter,
  type ExecutionContext,
  type RemoteTask,
} from '../tasks/types';
const remoteSchema = z.object({
  request_id: z.string(),
  status_url: z.string().url(),
  response_url: z.string().url(),
  cancel_url: z.string().url().optional(),
});
const media = z.object({ url: z.string().url(), content_type: z.string().nullish() });
function queueUrl(s: string) {
  const u = new URL(s);
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'queue.fal.run' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443') ||
    u.hash
  )
    throw new ProviderError('服务返回了不受信任的队列地址。', true);
  return u.href;
}
async function inputMedia(c: ExecutionContext, id: string) {
  const a = await c.readAsset(id);
  if (!/^image\/(png|jpeg|webp)$/.test(a.mimeType))
    throw new ProviderError('此输入需要PNG/JPEG/WebP图片，不能将音频、视频或文档作为图片提交。');
  return `data:${a.mimeType};base64,${a.buffer.toString('base64')}`;
}
export const falProvider: ProviderAdapter = {
  id: 'fal',
  async execute(c, secret) {
    validateVideoAudioInput(c.input);
    const motion = c.input.operation === 'video.motion-replica';
    if (!motion && isFalExtraOperation(c.input.operation))
      return falExtraProvider.execute(c, secret);
    if (!secret) throw new ProviderError('请先连接 fal 服务。');
    const i = c.input,
      o = i.options;
    let endpoint = '';
    let body: Record<string, unknown> = {};
    if (motion) {
      ({ endpoint, body } = await buildFalMotionRequest(c));
    } else if (i.operation === 'video.generate' && isFalReferenceModel(o.model)) {
      ({ endpoint, body } = await buildFalReferenceRequest(c));
    } else if (i.operation === 'video.generate') {
      if (o.model && o.model !== 'wan-2.6') throw new ProviderError('视频模型不受支持。');
      if (
        i.assetIds.length > 1 ||
        i.referenceAssetIds.length ||
        o.referenceMode === 'first-last' ||
        i.maskAssetId ||
        i.referenceText
      )
        throw new ProviderError('Wan 2.6仅接受文本或一张首帧图片。');
      endpoint = i.assetIds.length ? 'wan/v2.6/image-to-video' : 'wan/v2.6/text-to-video';
      body = {
        prompt: buildWanPrompt(i),
        duration: String(o.duration),
        resolution: o.resolution.toLowerCase(),
        enable_prompt_expansion: true,
        enable_safety_checker: true,
        multi_shots: o.kind === 'brand',
      };
      if (i.assetIds[0]) body.image_url = await inputMedia(c, i.assetIds[0]);
      else body.aspect_ratio = o.ratio === 'auto' ? '16:9' : o.ratio;
      Object.assign(body, await buildVideoAudioRequest(c));
    } else if (i.operation === 'image-erase') {
      endpoint = 'fal-ai/bria/eraser';
      body = await buildFalErasureRequest(c);
    } else if (i.operation === 'model-replace') {
      if (i.assetIds.length !== 1 || i.referenceAssetIds.length !== 1)
        throw new ProviderError('模特替换需要一张服装原图和一张目标模特图。');
      if (i.backgroundAssetId)
        throw new ProviderError('此试衣模型不支持背景参考，请使用OpenAI服务。');
      if (i.prompt.trim()) throw new ProviderError('此试衣模型不支持补充说明，请使用OpenAI服务。');
      const [clothing, person] = await Promise.all([
        c.readAsset(i.assetIds[0]!).then(canonicalImage),
        c.readAsset(i.referenceAssetIds[0]!).then(canonicalImage),
      ]);
      endpoint = 'fal-ai/image-apps-v2/virtual-try-on';
      body = {
        clothing_image_url: `data:${clothing.mimeType};base64,${clothing.buffer.toString('base64')}`,
        person_image_url: `data:${person.mimeType};base64,${person.buffer.toString('base64')}`,
        preserve_pose: true,
        aspect_ratio: { ratio: o.ratio },
      };
    } else if (i.operation === 'image-cutout') {
      endpoint = 'fal-ai/birefnet';
      body = {
        image_url: await inputMedia(c, i.assetIds[0]!),
        output_format: 'png',
        refine_foreground: true,
      };
    } else if (i.operation === 'image-upscale') {
      endpoint = 'fal-ai/aura-sr';
      body = {
        image_url: await inputMedia(c, i.assetIds[0]!),
        upscale_factor: 4,
        checkpoint: 'v2',
        overlapping_tiles: true,
      };
    } else throw new ProviderError('fal 暂未提供该操作的已核对适配器。');
    const result = remoteSchema.safeParse(
      await providerJson(`https://queue.fal.run/${endpoint}`, {
        headers: { Authorization: `Key ${secret}`, 'X-Fal-No-Retry': '1' },
        body,
        submission: true,
        timeoutMs: 120000,
      }),
    );
    if (!result.success) throw new ProviderError('队列未返回有效任务ID，需核对本次提交。', true);
    return {
      state: 'submitted',
      remote: {
        id: result.data.request_id,
        statusUrl: queueUrl(result.data.status_url),
        responseUrl: queueUrl(result.data.response_url),
        cancelUrl: result.data.cancel_url ? queueUrl(result.data.cancel_url) : undefined,
        endpoint,
      },
    };
  },
  async poll(remote, secret) {
    if (isFalExtraEndpoint(remote.endpoint)) return falExtraProvider.poll!(remote, secret);
    if (!remote.statusUrl || !remote.responseUrl) throw new ProviderError('任务查询地址缺失。');
    const status = z
      .object({
        status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']),
        error: z.string().optional(),
      })
      .parse(
        await providerJson(queueUrl(remote.statusUrl), {
          method: 'GET',
          headers: { Authorization: `Key ${secret}` },
          timeoutMs: 30000,
        }),
      );
    if (status.status !== 'COMPLETED')
      return {
        state: 'running',
        stage: status.status === 'IN_QUEUE' ? '服务商排队中' : '视频与图像模型正在处理',
      };
    if (status.error) return { state: 'failed', message: '服务商未能完成该任务。' };
    const result = z
      .object({
        video: media.optional(),
        image: media.optional(),
        images: z.array(media).min(1).max(1).optional(),
      })
      .parse(
        await providerJson(queueUrl(remote.responseUrl), {
          method: 'GET',
          headers: { Authorization: `Key ${secret}` },
          timeoutMs: 30000,
        }),
      );
    const m = result.video || result.image || result.images?.[0];
    if (!m) throw new ProviderError('模型任务没有返回可下载产物。');
    return {
      state: 'complete',
      outputs: [
        {
          url: m.url,
          mimeType: m.content_type || (result.video ? 'video/mp4' : 'image/png'),
          name: result.video ? '映造视频.mp4' : '映造图片.png',
        },
      ],
    };
  },
  async cancel(remote: RemoteTask, secret: string) {
    if (isFalExtraEndpoint(remote.endpoint)) return falExtraProvider.cancel!(remote, secret);
    if (!remote.cancelUrl) throw new ProviderError('服务不支持取消该任务。');
    await providerJson(queueUrl(remote.cancelUrl), {
      method: 'PUT',
      headers: { Authorization: `Key ${secret}` },
      timeoutMs: 30000,
    });
  },
};

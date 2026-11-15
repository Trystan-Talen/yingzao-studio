import { z } from 'zod';
import sharp from 'sharp';
import type { JobInput, ModelCapability } from '../../contracts/jobs';
import { isKnownSeedreamModel } from '../../contracts/model-connections';
import {
  nativeReferenceFrameIssue,
  NATIVE_FRAME_LIMITS,
  supportsNativeMotionEndpoints,
} from '../../contracts/native-plan';
import type { RuntimeModelConnection } from '../tasks/model-connections';
import {
  ProviderError,
  type ProviderAdapter,
  type ExecutionContext,
  type ProviderOutput,
} from '../tasks/types';
import { downloadPublicMedia } from './http';
import { nativeProviderJson } from './native-http';
import { nativeEndpoint } from './native-planner';
import { nativeVideoSubmission } from './native-video-route';
import { nativeMotionEndFrame } from './native-motion-frame';
import { canonicalImage } from './image-input';
import { nativeReplicaImages } from './native-replica';
import { executeNativeBackground } from './native-background';
import { renderExactPan } from './native-exact-pan';
import { renderNativeVideoTailHold } from './native-video-tail-hold';
import { expectedNativeVideoSize, NATIVE_VIDEO_720P_DIMENSIONS } from './native-video-spec';
import { SEEDREAM_SIZE_PRESETS } from './documented-models';
import {
  nativeImageSpecification,
  validateNativeImageArtifact,
  NATIVE_OPENAI_IMAGE_RATIOS,
} from './native-image-spec';

export interface NativeResources {
  image?: RuntimeModelConnection;
  video?: RuntimeModelConnection;
}
const videoRatios = Object.keys(NATIVE_VIDEO_720P_DIMENSIONS);

/** Adapter presets are a supported subset, never inferred from a model-list response.
 * https://developers.openai.com/api/reference/resources/images/methods/generate
 * https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh
 * https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh
 * Gateway-specific aliases must use one of these explicitly selected wire protocols.
 */
export function nativeImageModel(model: string, protocol = 'openai-images'): ModelCapability {
  return {
    id: model,
    name: model,
    ratios:
      protocol === 'seedream-images'
        ? Object.keys(SEEDREAM_SIZE_PRESETS['2K']!)
        : NATIVE_OPENAI_IMAGE_RATIOS,
    resolutions: protocol === 'seedream-images' ? ['2K', '3K'] : ['1K', '2K'],
    durations: [],
  };
}
export function nativeVideoModel(model: string): ModelCapability {
  return {
    id: model,
    name: model,
    ratios: [...videoRatios],
    resolutions: ['720p'],
    durations: [5, 10],
    textOverlay: { mode: 'unsupported', note: '首帧引导视频，暂不叠加字幕。' },
  };
}

/** Only measured metadata may satisfy the confirmed delivery dimensions and duration. */
export function validateNativeVideoArtifact(
  input: JobInput,
  artifact: { width: number | null; height: number | null; durationMs: number | null },
): void {
  const expected = expectedNativeVideoSize(input);
  if (!expected)
    throw new ProviderError(
      '视频画幅或清晰度缺少已核实的像素规格，原始结果已保留，请检查本次已确认参数。',
      true,
      'NATIVE_VIDEO_SPEC_MISMATCH',
    );
  const [width, height] = expected;
  const durationMs = input.options.duration * 1000;
  if (
    !Number.isFinite(artifact.width) ||
    !Number.isFinite(artifact.height) ||
    !Number.isFinite(artifact.durationMs) ||
    !artifact.width ||
    !artifact.height ||
    !artifact.durationMs ||
    Math.abs(artifact.width - width) > 2 ||
    Math.abs(artifact.height - height) > 2 ||
    Math.abs(artifact.durationMs - durationMs) > 500
  )
    throw new ProviderError(
      `视频实际规格与已确认参数不符：应为${width}×${height}像素、${input.options.duration}秒，实际为${artifact.width ?? '未知'}×${artifact.height ?? '未知'}像素、${artifact.durationMs === null ? '未知' : artifact.durationMs / 1000}秒。原始结果已保留，未标记生成成功，请核对服务商结果。`,
      true,
      'NATIVE_VIDEO_SPEC_MISMATCH',
    );
}

/** Structural validation only. The service must separately establish the server-frozen
 * approved edit and workspace ownership; a client object is not authorization. */
export function isNativeLocalBackgroundInput(input: JobInput): boolean {
  const edit = input.imageEdit;
  return (
    input.providerId === 'native' &&
    input.operation === 'image.generate' &&
    edit?.mask.mode === 'asset' &&
    input.maskAssetId === edit.mask.assetId &&
    [...input.assetIds, ...input.referenceAssetIds].includes(edit.sourceAssetId) &&
    !!input.prompt.trim() &&
    input.options.count === 1 &&
    !input.options.designs?.length &&
    !input.nativePlan &&
    !input.replica &&
    !input.nativeReplica &&
    !input.backgroundAssetId &&
    !input.backgroundAudioAssetId &&
    input.options.referenceMode !== 'first-last' &&
    input.options.generateAudio !== true &&
    input.options.width === undefined &&
    input.options.height === undefined
  );
}

export function validateNativeInput(input: JobInput, resources: NativeResources): void {
  if (
    input.replica &&
    (input.imageEdit ||
      input.maskAssetId ||
      input.nativePlan?.firstFrame?.mode === 'reference' ||
      input.nativePlan?.cameraControl ||
      input.nativePlan?.motionRenderer ||
      input.nativePlan?.videoPostprocess)
  )
    throw new ProviderError('复刻使用独立主体与参考分析，不能同时启用背景蒙版或原图精确运镜。');
  if (input.imageEdit?.mask.mode === 'asset') {
    if (!isNativeLocalBackgroundInput(input))
      throw new ProviderError('已确认背景合成的原图、蒙版或交付参数不一致，请重新确认。');
    return;
  }
  if (!['image.generate', 'video.generate'].includes(input.operation))
    throw new ProviderError('原生创作当前支持图片与视频生成。');
  if (!resources.image || !['openai-images', 'seedream-images'].includes(resources.image.protocol))
    throw new ProviderError('请先配置图片模型连接。');
  if (isKnownSeedreamModel(resources.image.model) && resources.image.protocol !== 'seedream-images')
    throw new ProviderError(
      '当前模型属于 Seedream（豆包图像模型），请在模型配置中选择豆包图像协议后再整理需求。',
    );
  if (!input.prompt.trim() || input.options.count !== 1 || input.options.designs?.length)
    throw new ProviderError('原生创作每次处理一个明确需求，生成一张图片或一段视频。');
  if (
    (input.maskAssetId && input.operation !== 'image.generate') ||
    input.backgroundAssetId ||
    input.backgroundAudioAssetId ||
    input.options.referenceMode === 'first-last' ||
    input.options.generateAudio === true ||
    input.options.width !== undefined ||
    input.options.height !== undefined
  )
    throw new ProviderError(
      '当前原生流程支持图片参考与单首帧视频，请移除遮罩、尾帧、音轨和自定义尺寸。',
    );
  if (new Set([...input.assetIds, ...input.referenceAssetIds]).size > 4)
    throw new ProviderError('当前原生流程最多使用四张图片参考。');
  const image = nativeImageModel(resources.image.model, resources.image.protocol);
  if (!image.ratios.includes(input.options.ratio))
    throw new ProviderError('所选画幅不在当前图片模型接入范围内。');
  if (input.operation === 'image.generate') {
    if (!image.resolutions.includes(input.options.resolution))
      throw new ProviderError('所选图片清晰度不在当前接入范围内。');
  } else {
    if (!resources.video || resources.video.protocol !== 'seedance-native')
      throw new ProviderError('请先配置支持首帧图片的视频模型连接。');
    const video = nativeVideoModel(resources.video.model);
    if (
      !video.ratios.includes(input.options.ratio) ||
      !video.resolutions.includes(input.options.resolution) ||
      !video.durations.includes(input.options.duration)
    )
      throw new ProviderError('当前视频流程支持五秒或十秒、720p（高清）及已列出的画幅。');
    if (input.options.needText) throw new ProviderError('当前视频流程不叠加字幕，请关闭画面文字。');
    if (/--(?:rs|rt|dur|fps|frames|resolution|ratio|duration)\b/i.test(input.prompt))
      throw new ProviderError('视频参数请使用界面选项，提示词不能包含模型参数命令。');
  }
}

const imageResponse = z.object({
  data: z
    .array(
      z
        .object({
          b64_json: z.string().min(16).optional(),
          url: z.string().url().optional(),
        })
        .refine((value) => Boolean(value.b64_json) !== Boolean(value.url)),
    )
    .length(1),
});
function nativeMediaUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('INVALID_MEDIA_URL');
    return url.href;
  } catch {
    throw new ProviderError('模型返回的媒体地址无效，请核对已有产物。', true);
  }
}

async function generateImage(
  context: ExecutionContext,
  connection: RuntimeModelConnection,
  prompt: string,
  forVideo: boolean,
): Promise<ProviderOutput> {
  const references: string[] = [];
  const files = context.input.replica
    ? await nativeReplicaImages(context)
    : await Promise.all(
        [...new Set([...context.input.assetIds, ...context.input.referenceAssetIds])].map((id) =>
          context.readAsset(id),
        ),
      );
  for (const file of files) {
    const image = await canonicalImage(file);
    if (image.buffer.length > 10 * 1024 * 1024 || image.width * image.height > 36_000_000)
      throw new ProviderError('参考图片须小于10MB（兆字节）且不超过3600万像素。');
    references.push(`data:${image.mimeType};base64,${image.buffer.toString('base64')}`);
  }
  const seedream = connection.protocol === 'seedream-images';
  const { size, width, height } = nativeImageSpecification(
    context.input,
    connection.protocol,
    forVideo,
  );
  const expectedImageSize = { width, height };
  const body = {
    model: connection.model,
    prompt,
    size,
    ...(seedream
      ? {
          sequential_image_generation: 'disabled',
          response_format: 'url',
          output_format: 'png',
          watermark: false,
          stream: false,
          ...(references.length ? { image: references } : {}),
        }
      : {
          n: 1,
          quality: 'high',
          output_format: 'png',
          ...(references.length ? { images: references.map((image_url) => ({ image_url })) } : {}),
        }),
  };
  const response = imageResponse.safeParse(
    await nativeProviderJson(
      nativeEndpoint(
        connection.baseUrl,
        !seedream && references.length ? '/images/edits' : '/images/generations',
      ),
      {
        headers: { Authorization: `Bearer ${connection.secret}` },
        body,
        submission: true,
        timeoutMs: 900000,
      },
    ),
  );
  if (!response.success)
    throw new ProviderError('图片模型没有返回单张有效图片，请核对本次生成。', true);
  const data = response.data.data[0]!;
  if (data.b64_json) {
    const buffer = Buffer.from(data.b64_json, 'base64');
    if (
      !buffer.length ||
      buffer.toString('base64').replace(/=+$/, '') !== data.b64_json.replace(/=+$/, '')
    )
      throw new ProviderError('图片编码无法校验，请核对本次生成。', true);
    return {
      buffer,
      mimeType: 'image/png',
      name: forVideo ? '视频首帧.png' : '生成图片.png',
      expectedImageSize,
    };
  }
  const url = nativeMediaUrl(data.url!);
  return {
    url,
    mimeType: 'image/png',
    name: forVideo ? '视频首帧.png' : '生成图片.png',
    expectedImageSize,
  };
}

const taskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const submissionSchema = z.object({ id: taskIdSchema });
const statusSchema = z.object({
  id: taskIdSchema,
  status: z.enum([
    'pending',
    'queued',
    'processing',
    'running',
    'cancelled',
    'succeeded',
    'failed',
    'expired',
  ]),
  content: z.object({ video_url: z.string().url().optional() }).nullish(),
});

/** The worker owns durable frame storage, immutable input, leases, and remote-task recovery. */
export function createNativeProvider(resources: NativeResources): ProviderAdapter {
  return {
    id: 'native',
    async execute(context) {
      if (
        context.resumeLocalProcessing &&
        context.input.imageEdit?.mask.mode === 'generate' &&
        context.input.imageEdit.mask.calibration === 'local-matting-v2'
      ) {
        const source = await canonicalImage(
          await context.readAsset(context.input.imageEdit.sourceAssetId),
        );
        return executeNativeBackground(
          context,
          async () => {
            throw new ProviderError(
              '恢复本机抠图不能重新请求图片模型。',
              true,
              'NATIVE_CHECKPOINT_INVALID',
            );
          },
          { width: source.width, height: source.height },
        );
      }
      if (context.input.imageEdit?.mask.mode === 'asset') {
        validateNativeInput(context.input, resources);
        const source = await canonicalImage(
          await context.readAsset(context.input.imageEdit.sourceAssetId),
        );
        const [rw, rh] = context.input.options.ratio.split(':').map(Number);
        if (!rw || !rh || Math.abs(source.width * rh - source.height * rw) > 2 * Math.max(rw, rh))
          throw new ProviderError('已确认背景合成的画幅与原图不一致，不会缩放或裁切原图。');
        context.onStage?.('正在使用已确认区域本机合成背景');
        return executeNativeBackground(
          context,
          async () => {
            throw new ProviderError(
              '已确认蒙版仅允许本机合成，不能再次调用模型。',
              true,
              'NATIVE_CHECKPOINT_INVALID',
            );
          },
          { width: source.width, height: source.height },
        );
      }
      if (
        context.input.nativePlan?.videoPostprocess === 'model-video-tail-hold-v1' &&
        context.resumeLocalProcessing
      ) {
        const original = await context.nativeArtifacts?.load('video-model-raw');
        if (!original)
          throw new ProviderError(
            '恢复尾段停稳缺少已保存模型原片，不能重新调用模型。',
            true,
            'NATIVE_CHECKPOINT_INVALID',
          );
        context.onStage?.('正在本机恢复模型视频尾段停稳');
        return {
          state: 'complete',
          outputs: [await renderNativeVideoTailHold(context.input, original)],
        };
      }
      if (context.input.nativePlan?.motionRenderer === 'exact-pan-v1') {
        const input = context.input;
        // A frozen local route must retain its input restrictions without
        // depending on credentials for models it will never call.
        if (
          input.operation !== 'video.generate' ||
          !input.prompt.trim() ||
          input.options.count !== 1 ||
          input.options.designs?.length ||
          input.replica ||
          input.nativeReplica ||
          input.imageEdit ||
          input.maskAssetId ||
          input.backgroundAssetId ||
          input.backgroundAudioAssetId ||
          input.options.referenceMode === 'first-last' ||
          input.options.generateAudio === true ||
          input.options.needText ||
          input.options.width !== undefined ||
          input.options.height !== undefined ||
          new Set([...input.assetIds, ...input.referenceAssetIds]).size > 4 ||
          /--(?:rs|rt|dur|fps|frames|resolution|ratio|duration)\b/i.test(input.prompt)
        )
          throw new ProviderError('精确平移的输入或交付参数不符合已确认的本机处理范围。');
        const size = expectedNativeVideoSize(input);
        if (!size) throw new ProviderError('精确平移缺少已核实的输出尺寸。');
        // The renderer checks the owned reference, direction, displacement,
        // duration and source dimensions before performing local work.
        return renderExactPan(context, size);
      }
      validateNativeInput(context.input, resources);
      if (context.input.operation === 'image.generate') {
        if (context.input.imageEdit) {
          if (
            context.input.imageEdit.mask.mode === 'generate' &&
            (resources.image!.protocol !== 'seedream-images' ||
              !isKnownSeedreamModel(resources.image!.model))
          )
            throw new ProviderError(
              '当前模型未核实可生成背景候选蒙版，请使用已支持的豆包图像模型或提供蒙版。',
            );
          const specification = nativeImageSpecification(context.input, resources.image!.protocol);
          context.onStage?.('正在识别背景区域并精确合成');
          return executeNativeBackground(
            context,
            (prompt) =>
              generateImage(
                {
                  ...context,
                  input: {
                    ...context.input,
                    assetIds: [context.input.imageEdit!.sourceAssetId],
                    referenceAssetIds: [],
                    maskAssetId: undefined,
                  },
                },
                resources.image!,
                prompt,
                false,
              ),
            specification,
          );
        }
        if (context.input.maskAssetId)
          throw new ProviderError('已有蒙版缺少已确认的局部背景方案，已停止生成。');
        context.onStage?.('正在生成图片');
        return {
          state: 'complete',
          outputs: [await generateImage(context, resources.image!, context.input.prompt, false)],
        };
      }
      const plan = context.input.nativePlan;
      if (!plan) throw new ProviderError('视频生成缺少已确认的首帧与运镜方案，请重新整理需求。');
      const firstFrame = plan.firstFrame;
      if (
        plan.cameraControl &&
        (firstFrame?.mode !== 'reference' || !supportsNativeMotionEndpoints(resources.video!.model))
      )
        throw new ProviderError('当前视频模型或首帧方案不支持受控运镜，请重新整理需求。');
      if (
        firstFrame?.mode === 'reference' &&
        ![...context.input.assetIds, ...context.input.referenceAssetIds].includes(
          firstFrame.assetId,
        )
      )
        throw new ProviderError('首帧不属于本次已确认参考素材，请重新整理需求。');
      if (!context.nativeFrame) throw new ProviderError('视频生成缺少首帧持久化能力。');
      let frame = await context.nativeFrame.load();
      if (!frame) {
        let output: ProviderOutput;
        if (firstFrame?.mode === 'reference') {
          context.onStage?.('正在保留参考图作为首帧');
          const source = await canonicalImage(await context.readAsset(firstFrame.assetId));
          const issue = nativeReferenceFrameIssue(
            { ...source, byteSize: source.buffer.length },
            context.input.options.ratio,
          );
          if (issue === 'FIRST_FRAME_RATIO_MISMATCH')
            throw new ProviderError('参考图与已确认的视频画幅不一致；已停止，未裁切或重绘主体。');
          if (issue)
            throw new ProviderError('参考首帧须小于30MB（兆字节），宽高在300至6000像素之间。');
          const decoded = sharp(source.buffer, { limitInputPixels: NATIVE_FRAME_LIMITS.maxPixels });
          await decoded.clone().stats();
          // PNG originals keep their exact bytes. Other formats are decoded losslessly to PNG;
          // no generative redraw, crop, stretch, sharpen or color adjustment is performed.
          output = {
            buffer:
              source.mimeType === 'image/png' ? source.buffer : await decoded.png().toBuffer(),
            mimeType: 'image/png',
            name: '参考首帧.png',
          };
        } else {
          context.onStage?.('正在生成视频首帧');
          output = await generateImage(context, resources.image!, plan.imagePrompt, true);
        }
        // Persist before any video submission; failed videos can reuse this exact frame.
        await context.nativeFrame.save(output);
        frame = await context.nativeFrame.load();
      }
      if (!frame) throw new ProviderError('视频首帧未能保存，已停止提交视频。', true);
      const normalized = await canonicalImage(frame);
      const frameIssue = nativeReferenceFrameIssue(
        { ...normalized, byteSize: normalized.buffer.length },
        context.input.options.ratio,
      );
      if (frameIssue === 'FIRST_FRAME_LIMIT')
        throw new ProviderError('视频首帧须小于30MB（兆字节），宽高在300至6000像素之间。', true);
      if (firstFrame?.mode === 'reference') {
        if (frameIssue)
          throw new ProviderError(
            '首帧的实际比例与视频画幅不一致，已停止视频生成；请先检查首帧。',
            true,
          );
      } else {
        // Check the actual requested preset, including its documented encoder rounding.
        // Recheck saved frames on retry so a low-resolution result cannot reach the video API.
        validateNativeImageArtifact(
          nativeImageSpecification(context.input, resources.image!.protocol, true),
          normalized,
        );
      }
      // Force a complete decode without allocating a full raw-pixel Buffer.
      await sharp(normalized.buffer, { limitInputPixels: NATIVE_FRAME_LIMITS.maxPixels }).stats();
      const endFrame = plan.cameraControl
        ? await nativeMotionEndFrame(normalized.buffer, plan.cameraControl)
        : undefined;
      if (endFrame && endFrame.length >= NATIVE_FRAME_LIMITS.maxBytesExclusive)
        throw new ProviderError('运镜尾帧超过30MB（兆字节）；已保留首帧，未提交视频。');
      context.beforeAdditionalSubmission?.();
      context.onStage?.('首帧已保存，正在提交视频');
      const video = resources.video!;
      const endpoint = nativeEndpoint(video.baseUrl);
      const submission = nativeVideoSubmission(endpoint, {
        model: video.model,
        prompt: plan.videoPrompt,
        frameUrl: `data:${normalized.mimeType};base64,${normalized.buffer.toString('base64')}`,
        ...(endFrame
          ? { lastFrameUrl: `data:image/png;base64,${endFrame.toString('base64')}` }
          : {}),
        resolution: context.input.options.resolution,
        ratio: context.input.options.ratio,
        duration: context.input.options.duration,
      });
      const response = submissionSchema.safeParse(
        await nativeProviderJson(submission.url, {
          headers: { Authorization: `Bearer ${video.secret}` },
          body: submission.body,
          submission: true,
          timeoutMs: 120000,
        }),
      );
      if (!response.success)
        throw new ProviderError('视频模型没有返回任务编号，请核对提交；首帧已保存。', true);
      const remote = { id: response.data.id, endpoint, nativeModel: video.model };
      await context.onRemoteAccepted?.(remote);
      return { state: 'submitted', remote };
    },
    async poll(remote) {
      const video = resources.video;
      if (
        !video ||
        video.protocol !== 'seedance-native' ||
        !taskIdSchema.safeParse(remote.id).success ||
        remote.endpoint !== nativeEndpoint(video.baseUrl) ||
        remote.nativeModel !== video.model
      )
        throw new ProviderError('视频任务与当前配置不匹配，已停止查询，请核对原模型连接。', true);
      const response = statusSchema.safeParse(
        await nativeProviderJson(`${remote.endpoint}/${encodeURIComponent(remote.id)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${video.secret}` },
          timeoutMs: 30000,
        }),
      );
      if (!response.success || response.data.id !== remote.id)
        throw new ProviderError('视频查询结果与已保存任务不一致，请核对服务商记录。', true);
      if (['pending', 'queued', 'processing', 'running'].includes(response.data.status))
        return {
          state: 'running',
          stage: ['pending', 'queued'].includes(response.data.status)
            ? '视频任务排队中'
            : '正在生成视频',
        };
      if (response.data.status !== 'succeeded')
        return { state: 'failed', message: '视频模型未能完成任务；已保存首帧，可检查后重试。' };
      if (!response.data.content?.video_url)
        throw new ProviderError('视频任务已完成，但没有返回有效视频文件，请核对结果。', true);
      return {
        state: 'complete',
        outputs: [
          {
            url: nativeMediaUrl(response.data.content.video_url),
            mimeType: 'video/mp4',
            name: '生成视频.mp4',
          },
        ],
      };
    },
  };
}

/** Download a first frame without ever forwarding provider credentials to an output host. */
export async function readNativeFrame(output: ProviderOutput): Promise<Buffer> {
  if (output.buffer) return output.buffer;
  if (output.url) return downloadPublicMedia(output.url, NATIVE_FRAME_LIMITS.maxBytesExclusive);
  throw new ProviderError('图片模型没有返回可保存的首帧。', true);
}

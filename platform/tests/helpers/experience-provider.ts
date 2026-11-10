/** Deterministic local media fixtures shared by the preview and browser acceptance tests. */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { detailPagePlanSchema, formatDetailPagePlan } from '../../src/contracts/detail-page';
import { designPlanSchema, formatDesignPlan } from '../../src/contracts/design-plan';
import { originalInspirations } from '../../src/contracts/inspirations';
import type { ProviderId } from '../../src/contracts/catalog';
import type {
  ExecutionContext,
  ProviderAdapter,
  ProviderResult,
} from '../../src/server/tasks/types';

export function createLoopbackFetch(
  fetchImplementation: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      return Promise.reject(new Error('隔离体验禁止外网调用；请勿配置真实凭据。'));
    return fetchImplementation(input, { ...init, redirect: 'error' });
  };
}

/** In-memory metadata protocol fixtures; no request reaches an external socket. */
export type ExperienceMetadataTransform = (url: string, body: unknown) => unknown;
export function createExperienceFetch(
  fetchImplementation: typeof fetch = globalThis.fetch,
  onMetadata?: (url: string) => void,
  transform?: ExperienceMetadataTransform,
): typeof fetch {
  const loopback = createLoopbackFetch(fetchImplementation);
  const modelListUrls = new Set([
    'https://api.openai.com/v1/models',
    'https://preview.invalid/v1/models',
    'https://xingyunyinli.com/v1/models',
  ]);
  const models = [
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst',
    'gpt-image-2',
    'gpt-4.1-mini',
    'doubao-seedream-5.0-lite',
    'doubao-seedance-2.0',
  ];
  const falEndpoints = new Set([
    'wan/v2.6/text-to-video',
    'wan/v2.6/image-to-video',
    'fal-ai/kling-video/o1/image-to-video',
    'fal-ai/kling-video/o1/reference-to-video',
    'fal-ai/kling-video/o3/4k/reference-to-video',
    'fal-ai/kling-video/v2.6/standard/motion-control',
    'fal-ai/kling-video/v2.6/pro/motion-control',
    'fal-ai/kling-video/o1/video-to-video/edit',
    'fal-ai/qwen-image-layered',
    'fal-ai/ltx-2.3-22b/extend-video',
    'fal-ai/video-upscaler',
    'fal-ai/heygen/v2/translate/precision',
    'bria/video/erase/prompt',
    'fal-ai/birefnet',
    'fal-ai/bria/eraser',
    'fal-ai/image-apps-v2/virtual-try-on',
    'fal-ai/aura-sr',
  ]);
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) return Promise.reject(signal.reason);
    const response = (body: unknown) => {
      onMetadata?.(url.href);
      return Promise.resolve(
        Response.json(transform ? transform(url.href, body) : body, {
          headers: { 'x-experience-fixture': 'local-metadata-simulation' },
        }),
      );
    };
    if (method === 'GET' && modelListUrls.has(url.href))
      return response({ data: models.map((id) => ({ id })) });
    if (method === 'GET' && url.href === 'https://xingyunyinli.com/api/pricing')
      return response({ success: true, data: models.map((model_name) => ({ model_name })) });
    const endpoint = url.searchParams.get('endpoint_id');
    if (
      method === 'GET' &&
      url.origin === 'https://api.fal.ai' &&
      url.pathname === '/v1/models' &&
      url.searchParams.size === 2 &&
      url.searchParams.get('expand') === 'openapi-3.0' &&
      endpoint &&
      falEndpoints.has(endpoint)
    ) {
      // A small explicit schema exercises real intersection logic for Wan. Other
      // endpoints intentionally expose only membership, preserving limited status.
      const openapi = endpoint.startsWith('wan/v2.6/')
        ? {
            paths: {
              '/submit': {
                post: {
                  requestBody: {
                    content: {
                      'application/json': { schema: { $ref: '#/components/schemas/Input' } },
                    },
                  },
                },
              },
            },
            components: {
              schemas: {
                Input: {
                  type: 'object',
                  properties: {
                    aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
                    resolution: { type: 'string', enum: ['720p', '1080p'] },
                    duration: { type: 'string', enum: ['5', '10', '15'] },
                  },
                },
              },
            },
          }
        : undefined;
      return response({
        models: [{ endpoint_id: endpoint, metadata: { status: 'active' }, openapi }],
      });
    }
    return loopback(input, init);
  };
}

export async function createExperienceProviders({
  folder,
  delayMs = 2400,
}: {
  folder: string;
  delayMs?: number;
}) {
  const samples = new Map<string, Buffer>();
  for (const sample of originalInspirations)
    samples.set(sample.id, await readFile(resolve('public/gallery', `${sample.id}.webp`)));
  const delay = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));
  function sampleFor(prompt: string) {
    if (/香水|香氛|琥珀/.test(prompt)) return 'amber-perfume';
    if (/耳机|数码|科技/.test(prompt)) return 'studio-headphones';
    if (/鞋|运动|户外/.test(prompt)) return 'trail-sneaker';
    if (/茶|抹茶/.test(prompt)) return 'matcha-ritual';
    if (/饮|柑橘|气泡/.test(prompt)) return 'citrus-drink';
    if (/灯|家居/.test(prompt)) return 'sculptural-lamp';
    if (/包|皮革/.test(prompt)) return 'leather-bag';
    return 'botanical-serum';
  }
  async function renderImage(context: ExecutionContext) {
    const { input } = context;
    const [rw, rh] = input.options.ratio.split(':').map(Number);
    const width = 960;
    const height = Math.round(width * ((rh || 1) / (rw || 1)));
    let source = samples.get(sampleFor(input.prompt))!;
    const referenceId = input.referenceAssetIds[0] ?? input.assetIds[0];
    if (referenceId) {
      const reference = await context.readAsset(referenceId);
      if (reference.mimeType.startsWith('image/')) source = reference.buffer;
    }
    const screenIndex = input.options.detailPagePlan?.screens.findIndex(
      (screen) => screen.id === input.options.detailPageScreenId,
    );
    const label = `本机模拟 · 非模型生成${screenIndex !== undefined && screenIndex >= 0 ? ` · 第 ${screenIndex + 1} 屏` : ''}`;
    const mark = Buffer.from(
      `<svg width="${width}" height="${height}"><rect x="20" y="20" width="410" height="48" rx="24" fill="#1b302d" fill-opacity=".88"/><text x="42" y="51" font-family="Arial, sans-serif" font-size="20" fill="white">${label}</text></svg>`,
    );
    return sharp(source)
      .resize(width, height, { fit: 'cover' })
      .composite([{ input: mark }])
      .png()
      .toBuffer();
  }
  const videos = new Map<string, Buffer>();
  async function renderVideo(context: ExecutionContext) {
    const key = JSON.stringify({
      ratio: context.input.options.ratio,
      duration: context.input.options.duration,
      sample: sampleFor(context.input.prompt),
      references: context.input.referenceAssetIds,
      assets: context.input.assetIds,
    });
    const cached = videos.get(key);
    if (cached) return cached;
    const fileId = randomUUID();
    const picture = join(folder, `${fileId}-video-source.png`);
    const output = join(folder, `${fileId}-video.mp4`);
    const [rw, rh] = context.input.options.ratio.split(':').map(Number);
    const width = 720;
    const height = Math.round((width * ((rh || 1) / (rw || 1))) / 2) * 2;
    await writeFile(picture, await renderImage(context));
    await new Promise<void>((done, reject) => {
      const child = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-loop',
          '1',
          '-i',
          picture,
          '-t',
          String(context.input.options.duration),
          '-vf',
          `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
          '-r',
          '24',
          '-c:v',
          'libx264',
          '-movflags',
          '+faststart',
          output,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let error = '';
      child.stderr.on('data', (chunk: Buffer) => (error += chunk.toString()));
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? done() : reject(new Error(`本机模拟视频生成失败：${error}`)),
      );
    });
    const video = await readFile(output);
    videos.set(key, video);
    return video;
  }
  const failedPrompts = new Set<string>();
  async function simulate(context: ExecutionContext): Promise<ProviderResult> {
    const { input } = context;
    await delay(input.operation === 'text.assist' ? Math.round(delayMs * 0.75) : delayMs);
    if (/模拟首次失败/.test(input.prompt) && !failedPrompts.has(input.prompt)) {
      failedPrompts.add(input.prompt);
      return { state: 'failed', message: '本机模拟首次失败：请重新估价并确认重试。' };
    }
    if (/模拟持续失败/.test(input.prompt))
      return { state: 'failed', message: '本机模拟持续失败：用于检查失败提示与记录保留。' };
    if (input.operation === 'text.assist') {
      if (input.options.assistantMode === 'design-plan') {
        const plan = designPlanSchema.parse({
          analysis: '本机固定模拟，供方案展示与采用流程验收，不是模型分析结果。',
          objective: input.prompt.slice(0, 1800),
          style: '简洁自然的商品摄影',
          palette: ['浅绿', '暖白', '墨绿'],
          composition: '突出商品，保留标题与正文的留白空间',
          copy: ['让细节，表达质感'],
          scene: '自然晨光中的商品静物',
          technical: { ratio: input.options.ratio, resolution: '2K', language: '简体中文' },
          directions: ['自然晨光', '质感特写', '日常场景'].map((title) => ({
            title,
            prompt: `为商品创作${title}画面，保持主体一致，使用浅绿背景与简洁构图。`,
          })),
        });
        return {
          state: 'complete',
          outputs: [
            {
              mimeType: 'text/plain',
              name: '本机模拟设计方案.txt',
              text: formatDesignPlan(plan),
              resultData: { type: 'design-plan', version: 1, plan },
            },
          ],
        };
      }
      if (input.options.assistantMode === 'detail-page') {
        const names = ['商品首屏', '核心卖点', '质感细节', '使用场景', '商品信息', '品牌收尾'];
        const plan = detailPagePlanSchema.parse({
          productName: '植物精华 · 模拟方案',
          productFacts: ['本机体验示例，不代表真实商品功效。', input.prompt.slice(0, 480)],
          audience: '正在测试商品详情页创作流程的用户',
          visualStyle: '自然光、低饱和浅绿背景与干净留白',
          palette: ['浅绿', '暖白', '深墨绿'],
          consistencyNotes: '参考图中的瓶型、瓶盖和标签保持一致。此方案为本机固定模拟。',
          unknowns: ['容量、功效与使用方法需由商品资料确认。'],
          screens: Array.from({ length: input.options.detailPageScreenCount ?? 6 }, (_, index) => ({
            id: `screen_${index + 1}`,
            title: names[index] ?? `延展画面 ${index + 1}`,
            purpose: `呈现${names[index] ?? '商品细节'}，供逐屏编辑和确认流程体验。`,
            copy: [index === 0 ? '把清晨，装进一滴精华' : '让细节，表达质感'],
            prompt: '使用同一植物精华参考商品，自然柔光与浅绿背景，保留上方文案空间。',
            ratio: input.options.ratio,
          })),
        });
        return {
          state: 'complete',
          outputs: [
            {
              mimeType: 'text/plain',
              name: '本机模拟方案.txt',
              text: formatDetailPagePlan(plan),
              resultData: { type: 'detail-page-plan', version: 1, plan },
            },
          ],
        };
      }
      return {
        state: 'complete',
        outputs: [
          {
            mimeType: 'text/plain',
            name: '本机模拟文案.txt',
            text: `本机模拟建议：${input.prompt}\n以商品为主体，明确光线、背景、构图与使用场景，保留适当排版留白。`,
          },
        ],
      };
    }
    if (input.operation.startsWith('video'))
      return {
        state: 'complete',
        outputs: [
          { buffer: await renderVideo(context), mimeType: 'video/mp4', name: '本机模拟视频.mp4' },
        ],
      };
    return {
      state: 'complete',
      outputs: [
        { buffer: await renderImage(context), mimeType: 'image/png', name: '本机模拟作品.png' },
      ],
    };
  }
  const overrides: Partial<Record<ProviderId, ProviderAdapter>> = {};
  for (const id of ['openai', 'dify', 'seedance', 'fal', 'flyelep', 'tikhub'] as const)
    overrides[id] = { id, execute: simulate };
  return overrides;
}

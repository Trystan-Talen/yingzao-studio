import { z } from 'zod';
import sharp from 'sharp';
import { canonicalImage } from './image-input';
import { providerJson } from './http';
import {
  ProviderError,
  type ProviderAdapter,
  type ExecutionContext,
  type ProviderOutput,
} from '../tasks/types';
const base = 'https://www.flyelep.cn/prod-api/poster-design/api/v1/';
const languages: Record<string, string> = {
  'zh-CN': '中文简体',
  'zh-TW': '中文繁体',
  en: '英文',
  ru: '俄语',
  ja: '日语',
  ko: '韩语',
  ar: '阿拉伯语',
  de: '德语',
  es: '西班牙语',
  fr: '法语',
  th: '泰语',
  ms: '马来语',
  vi: '越南语',
  pt: '葡萄牙语',
  fil: '菲律宾语',
  id: '印尼语',
  it: '意大利语',
  nl: '荷兰语',
  pl: '波兰语',
  ro: '罗马尼亚语',
  hu: '匈牙利',
  bg: '保加利亚语',
};
const envelope = z.object({
  code: z.number(),
  data: z.unknown().optional(),
  result: z.unknown().optional(),
  msg: z.string().optional(),
});
async function api(path: string, secret: string, body: unknown, submission = false) {
  const p = envelope.safeParse(
    await providerJson(base + path, {
      headers: { secretKey: secret },
      body,
      submission,
      timeoutMs: submission ? 900000 : 30000,
    }),
  );
  if (!p.success) throw new ProviderError('Flyelep 响应协议不符。', submission);
  if (p.data.code !== 200)
    throw new ProviderError('Flyelep 未接受本次请求，请核对服务权限与参数。', false);
  return p.data;
}
function url(c: ExecutionContext, id: string, variant: 'original' | 'mask-white' = 'original') {
  if (!c.assetUrl)
    throw new ProviderError(
      '此服务需要云端可访问的参考图。请配置公开站点地址或使用支持本地上传的服务。',
    );
  return c.assetUrl(id, variant);
}
const paths: Record<string, string> = {
  'image-extend': 'poster/aiTool/intelligentExtension',
  'image-upscale': 'poster/aiTool/enlarge',
  'image-inpaint': 'poster/aiTool/partialRedrawing',
  'image-cutout': 'poster/aiTool/aiImageMatting',
  'product-replace': 'poster/aiTool/productReplace',
  'scene-replace': 'poster/aiTool/sceneReplace',
  'product-recolor': 'poster/aiTool/productColorChange',
  'image-enhance': 'poster/aiTool/imageClarityEnhance',
  'image-fusion': 'aiTool/longImageFusion',
  'product-tagging': 'aiTool/mainImageTagging',
  'image.ocr': 'aiTool/recognizeImageText',
  'image.text-edit': 'aiTool/textEdit',
  'image.layers': 'aiTool/imageLayerDecompose',
  'text.assist': 'aiTool/assistedGeneration',
};
export const flyelepProvider: ProviderAdapter = {
  id: 'flyelep',
  async execute(c, secret) {
    if (!secret) throw new ProviderError('请先连接 Flyelep 官方 API。');
    const i = c.input,
      o = i.options;
    if (i.operation === 'image.layers')
      throw new ProviderError('图层返回需要坐标与费用核对，此能力当前未启用。');
    const language = o.needText ? (languages[o.language] ?? o.language) : '无文本';
    if (i.operation === 'image-inpaint') {
      if (!i.maskAssetId || !i.assetIds[0]) throw new ProviderError('局部重绘需要原图和遮罩。');
      const [source, mask] = await Promise.all([
        c.readAsset(i.assetIds[0]),
        c.readAsset(i.maskAssetId),
      ]);
      const original = await canonicalImage(source);
      const meta = await sharp(mask.buffer).metadata();
      if (!meta.hasAlpha) throw new ProviderError('重绘遮罩必须包含透明编辑区域。');
      if (meta.width !== original.width || meta.height !== original.height)
        throw new ProviderError('重绘遮罩尺寸必须与原图显示尺寸一致。');
      const stats = await sharp(mask.buffer).stats();
      if (stats.channels[stats.channels.length - 1]!.min === 255)
        throw new ProviderError('遮罩没有透明编辑区域，请先涂抹需要修改的位置。');
    }
    const images = i.assetIds.map((id) => url(c, id)),
      refs = i.referenceAssetIds.map((id) => url(c, id));
    if (i.operation === 'text.assist' && new Set([...images, ...refs]).size > 10)
      throw new ProviderError('Flyelep 帮写最多接受10张参考图片。');
    const src = images[0];
    if (i.operation === 'image.generate' || i.operation === 'image-replica') {
      const types: Record<string, number> = {
        single: 100,
        'white-background': 101,
        'main-secondary': 102,
        'product-set': 103,
        detail: 200,
        marketing: 300,
        free: 100,
      };
      const body =
        i.operation === 'image-replica'
          ? {
              sourceUrl: images.join(','),
              replaceUrl: refs.join(','),
              prompt: i.prompt,
              ratio: o.ratio,
              language,
              modelType: '9',
            }
          : {
              generateType: types[o.kind] || 100,
              query: i.prompt,
              detailPictureNumber: 1,
              posterType: ['淘宝', '京东', '拼多多'].includes(o.platform) ? 6 : 5,
              platformType: o.platform === 'Amazon' ? 'amazon' : o.platform.toLowerCase(),
              languageType: language,
              modelEdition: 9,
              needText: o.needText,
              aspectRatio: o.ratio === 'auto' ? '1:1' : o.ratio,
              fileUrlList: [...images, ...refs],
              channel: o.channel,
            };
      const res = await api(
        i.operation === 'image-replica' ? 'aiTool/generateHotImage' : 'poster/generateAsync',
        secret,
        body,
        true,
      );
      const id =
        typeof res.data === 'string'
          ? res.data
          : z.object({ agentGenerateTaskId: z.string() }).safeParse(res.data).data
              ?.agentGenerateTaskId;
      if (!id) throw new ProviderError('Flyelep 未返回有效任务ID，需核对本次请求。', true);
      return { state: 'submitted', remote: { id, endpoint: 'image' } };
    }
    const path = paths[i.operation];
    if (!path) throw new ProviderError('此操作尚无完整官方协议，暂不可执行。');
    let body: Record<string, unknown> = {};
    switch (i.operation) {
      case 'image-extend':
        body = { imgUrlList: images, ratio: o.ratio };
        break;
      case 'image-upscale':
        body = { imageUrlList: images, scalingRatio: o.scale };
        break;
      case 'image-inpaint':
        body = {
          sourceUrl: src,
          textPrompt: i.prompt,
          maskDataUrl: i.maskAssetId ? url(c, i.maskAssetId, 'mask-white') : undefined,
          replaceImageUrl: refs[0],
          modelType: 9,
        };
        break;
      case 'image-cutout':
        body = { imageUrlList: images };
        break;
      case 'image-enhance':
        body = { imageUrlList: images, enhanceStrength: o.strength };
        break;
      case 'product-replace':
        body = { sourceUrl: src, replaceImageUrl: refs[0], textPrompt: i.prompt, modelType: 9 };
        break;
      case 'scene-replace':
        body = { sourceUrl: src, replaceImageUrl: refs[0], textPrompt: i.prompt, modelType: 9 };
        break;
      case 'product-recolor':
        body = {
          sourceUrl: src,
          textPrompt: `${i.prompt}\n将商品改为${o.colors?.join(',')}`,
          modelType: 9,
        };
        break;
      case 'image-fusion':
        body = { imageUrlList: images };
        break;
      case 'product-tagging':
        body = {
          sourceUrlList: images,
          referenceImageUrl: refs[0],
          sellingPoints: o.sellingPoints,
          price: o.price,
          modelType: 9,
        };
        break;
      case 'image.ocr':
        body = { imageUrl: src };
        break;
      case 'image.text-edit':
        body = {
          sourceUrl: src,
          textReplaceList: o.textReplacements?.map((r, index) => ({
            ...r,
            index,
            rect: r.rect.map(Math.round),
          })),
          modelType: '9',
        };
        break;
      case 'text.assist':
        body = {
          query: i.prompt,
          generateType: o.kind === 'video' ? 'video' : '',
          platformType: o.platform,
          languageType: languages[o.language] ?? o.language,
          fileUrlList: [...new Set([...images, ...refs])],
        };
        break;
    }
    const res = await api(path, secret, body, true);
    if (i.operation === 'text.assist') {
      const r = z.object({ options: z.array(z.string()) }).safeParse(res.data);
      if (!r.success || !r.data.options.length) throw new ProviderError('帮写响应格式不符。', true);
      return {
        state: 'complete',
        outputs: [
          { text: r.data.options.join('\n\n'), mimeType: 'text/plain', name: '创作建议.txt' },
        ],
      };
    }
    if (i.operation === 'image.ocr') {
      const r = z.object({ textList: z.array(z.object({ text: z.string() })) }).safeParse(res.data);
      if (!r.success) throw new ProviderError('文字识别响应格式不符。', true);
      return {
        state: 'complete',
        outputs: [
          {
            text: r.data.textList.map((t) => t.text).join('\n'),
            mimeType: 'text/plain',
            name: '识别文字.txt',
          },
        ],
      };
    }
    const parsed = z
      .object({ fileUrlList: z.array(z.string().url()).min(1) })
      .safeParse(res.result);
    if (!parsed.success)
      throw new ProviderError('工具没有返回可确认的成功产物，需核对请求。', true);
    const outputs: ProviderOutput[] = parsed.data.fileUrlList.map((u, j) => ({
      url: u,
      mimeType: 'image/png',
      name: `工具结果-${j + 1}.png`,
    }));
    return { state: 'complete', outputs };
  },
  async poll(remote, secret) {
    const result = await api('poster/queryTaskResult', secret, { agentGenerateTaskId: remote.id });
    const parsed = z
      .object({
        status: z.number(),
        taskList: z
          .array(
            z.object({ taskStatus: z.number(), executeResult: z.string().nullable().optional() }),
          )
          .optional(),
      })
      .safeParse(result.data);
    if (!parsed.success) throw new ProviderError('任务查询响应不符合官方协议。');
    const d = parsed.data;
    if (d.status === 1) return { state: 'running', stage: '模型正在生成' };
    if (d.status === 3) return { state: 'failed', message: '服务商未能生成这张图片。' };
    if (d.status === 4) throw new ProviderError('服务商返回部分成功，需要逐项核对结果。', true);
    if (d.status !== 2) throw new ProviderError('任务状态未知，需核对服务商记录。', true);
    const successful = (d.taskList || []).filter((t) => t.taskStatus === 2 && t.executeResult);
    if (!successful.length) throw new ProviderError('任务标为结束但没有可确认的产物。');
    return {
      state: 'complete',
      outputs: successful.map((t) => ({
        url: t.executeResult!,
        mimeType: 'image/png',
        name: 'Flyelep生成图片.png',
      })),
    };
  },
};

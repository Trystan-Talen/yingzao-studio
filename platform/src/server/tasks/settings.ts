import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PROVIDERS, TOOLS, IMAGE_RATIOS, type ProviderId } from '../../contracts/catalog';
import type {
  CapabilitiesDto,
  ProviderSettingDto,
  OperationCapability,
  JobInput,
} from '../../contracts/jobs';
import type { AppConfig } from '../config';
import type { DatabaseContext } from '../db/connection';
import { AppError } from '../errors';
import { hasFfmpeg } from '../providers/local';
import { FAL_REFERENCE_MODELS } from '../providers/fal-reference';
import { FAL_MOTION_MODELS } from '../providers/fal-motion';
interface Setting {
  provider_id: ProviderId;
  encrypted_secret: string | null;
  key_hint: string | null;
  enabled: number;
  updated_at: string;
}
const imageModels = [
  {
    id: 'gpt-image-2.5-flare',
    name: 'GPT Image 2.5 Flare',
    ratios: [...IMAGE_RATIOS],
    resolutions: ['1K', '2K'],
    durations: [],
  },
  {
    id: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    ratios: [...IMAGE_RATIOS],
    resolutions: ['1K', '2K'],
    durations: [],
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    ratios: [...IMAGE_RATIOS],
    resolutions: ['1K', '2K'],
    durations: [],
  },
];
export const OPENAI_OPERATIONS = [
  'image-erase',
  'model-replace',
  'image.generate',
  'image-replica',
  'image-naturalize',
  'product-tagging',
  'image-inpaint',
  'product-replace',
  'scene-replace',
  'image-translate',
  'image-extend',
  'product-recolor',
  'image-fusion',
  'image.text-edit',
  'image.ocr',
  'text.assist',
];
export const FLYELEP_OPERATIONS = [
  'image.generate',
  'image-replica',
  'image-fusion',
  'product-tagging',
  'image-inpaint',
  'product-replace',
  'scene-replace',
  'image-cutout',
  'image-upscale',
  'image-extend',
  'product-recolor',
  'image-enhance',
  'image.text-edit',
  'image.ocr',
  'text.assist',
];
export function createSettingsService(db: DatabaseContext, config: AppConfig) {
  const key = createHash('sha256').update(config.encryptionKey).digest();
  const ffmpeg = hasFfmpeg();
  const encrypt = (value: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join('.');
  };
  const decrypt = (value: string) => {
    const [iv, tag, data] = value.split('.');
    if (!iv || !tag || !data) throw new AppError(500, 'CONFIGURATION_INVALID', '服务配置无法解密');
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString(
      'utf8',
    );
  };
  function get(wid: string, id: string) {
    return db.sqlite
      .prepare('SELECT * FROM provider_settings WHERE workspace_id=? AND provider_id=?')
      .get(wid, id) as Setting | undefined;
  }
  function secret(wid: string, id: ProviderId): string | undefined {
    if (id === 'local') return undefined;
    const row = get(wid, id);
    if (row?.enabled === 0) return undefined;
    return row?.encrypted_secret
      ? decrypt(row.encrypted_secret)
      : config.environmentSecrets[id] || undefined;
  }
  function list(wid: string): ProviderSettingDto[] {
    return PROVIDERS.filter((p) => p.id !== 'local').map((p) => {
      const row = get(wid, p.id);
      const value = secret(wid, p.id);
      return {
        providerId: p.id,
        name: p.name,
        configured: Boolean(value),
        enabled: row?.enabled !== 0,
        keyHint: row?.key_hint || (value ? `…${value.slice(-4)}` : null),
        source: row?.encrypted_secret
          ? 'workspace'
          : config.environmentSecrets[p.id]
            ? 'environment'
            : 'none',
        updatedAt: row?.updated_at || null,
        liveVerified: false,
      };
    });
  }
  function update(
    wid: string,
    input: {
      providerId: Exclude<ProviderId, 'local'>;
      secret?: string;
      enabled: boolean;
      removeSecret?: boolean;
    },
  ) {
    const old = get(wid, input.providerId);
    const encrypted = input.removeSecret
      ? null
      : input.secret
        ? encrypt(input.secret)
        : old?.encrypted_secret || null;
    db.sqlite
      .prepare(
        'INSERT INTO provider_settings VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,provider_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,key_hint=excluded.key_hint,enabled=excluded.enabled,updated_at=excluded.updated_at',
      )
      .run(
        wid,
        input.providerId,
        encrypted,
        input.secret
          ? `…${input.secret.slice(-4)}`
          : input.removeSecret
            ? null
            : old?.key_hint || null,
        input.enabled ? 1 : 0,
        new Date().toISOString(),
      );
    return list(wid).find((p) => p.providerId === input.providerId)!;
  }
  function capabilities(wid: string): CapabilitiesDto {
    const providers = PROVIDERS.map((p) => ({
      ...p,
      configured: p.id === 'local' || Boolean(secret(wid, p.id)),
    }));
    const operations: OperationCapability[] = [];
    const add = (
      id: string,
      providerId: ProviderId,
      models: OperationCapability['models'],
      price = 8,
      unit: OperationCapability['unit'] = 'image',
      reason: string | null = null,
    ) => {
      const connected = providers.find((p) => p.id === providerId)!.configured;
      operations.push({
        id,
        providerId,
        name:
          TOOLS.find((t) => t.id === id)?.name ||
          {
            'image.generate': '图片创作',
            'media.import': '分享链接导入视频',
            'video.generate': '视频创作',
            'text.assist': 'AI 帮写',
            'image.ocr': '文字识别',
            'image.text-edit': '图片改字',
            'image.layers': '图片分层',
            'video.edit': '视频编辑',
            'video.extend': '视频延长',
            'video.upscale': '视频超清',
            'video.translate': '视频口播翻译',
            'video.erase-subtitles': '视频去字幕',
            'local.resize': '调整尺寸',
            'local.convert': '格式转换',
            'local.stitch': '长图拼接',
            'local.video-trim': '视频裁剪',
          }[id] ||
          id,
        available: connected && !reason,
        reason: reason || (!connected ? '请在设置中连接服务' : null),
        models,
        priceCredits: price,
        unit,
        liveVerified: providerId === 'local',
      });
    };
    add(
      'media.import',
      'tikhub',
      [],
      0,
      'request',
      ffmpeg ? null : '本机未检测到 FFmpeg（媒体处理工具）',
    );
    for (const id of OPENAI_OPERATIONS)
      add(
        id,
        'openai',
        id === 'text.assist' || id === 'image.ocr'
          ? [
              {
                id: 'gpt-4.1-mini',
                name: 'GPT-4.1 mini',
                ratios: [],
                resolutions: [],
                durations: [],
              },
            ]
          : imageModels,
        id === 'text.assist' ? 2 : 8,
        id === 'text.assist' ? 'request' : 'image',
      );
    for (const id of FLYELEP_OPERATIONS)
      add(id, 'flyelep', [
        {
          id: '9',
          name: 'Flyelep Image 2',
          ratios: [...IMAGE_RATIOS].filter((r) => r !== 'auto'),
          resolutions: ['1K'],
          durations: [],
        },
      ]);
    add(
      'video.generate',
      'fal',
      [
        {
          id: 'wan-2.6',
          audio: {
            mode: 'background-music',
            note: 'MP3/WAV、3–30秒、不超过15MB；长于视频只使用前段，短于视频剩余静音。不是声音克隆或逐拍同步。',
          },
          name: 'Wan 2.6',
          ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          resolutions: ['720p', '1080p'],
          durations: [5, 10, 15],
          textOverlay: {
            mode: 'prompt-guidance',
            note: '画面文案与语言仅作为提示词指引，不能保证文字、语言或排版准确；当前没有逐字字幕合成能力。',
          },
        },
        ...FAL_REFERENCE_MODELS,
      ],
      5,
      'second',
    );
    add(
      'image-cutout',
      'fal',
      [{ id: 'birefnet', name: 'BiRefNet', ratios: [], resolutions: [], durations: [] }],
      4,
    );
    add(
      'image-erase',
      'fal',
      [{ id: 'bria-eraser', name: 'Bria · 蒙版消除', ratios: [], resolutions: [], durations: [] }],
      4,
    );
    add(
      'model-replace',
      'fal',
      [
        {
          id: 'virtual-try-on',
          name: '虚拟试衣 · 服装与目标人物',
          ratios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          resolutions: [],
          durations: [],
        },
      ],
      8,
    );
    add(
      'image-upscale',
      'fal',
      [{ id: 'aura-sr', name: 'AuraSR · 4倍', ratios: [], resolutions: [], durations: [] }],
      6,
    );
    for (const id of ['local.resize', 'local.convert', 'local.stitch'])
      add(
        id,
        'local',
        [{ id: 'sharp', name: '本机处理', ratios: [], resolutions: [], durations: [] }],
        0,
        'request',
      );
    add(
      'local.video-trim',
      'local',
      [{ id: 'ffmpeg', name: 'FFmpeg', ratios: [], resolutions: [], durations: [] }],
      0,
      'request',
      ffmpeg ? null : '本机未检测到 FFmpeg',
    );
    add(
      'video.motion-replica',
      'fal',
      FAL_MOTION_MODELS,
      5,
      'second',
      ffmpeg ? null : '本机未检测到 FFmpeg',
    );
    for (const id of ['video-replica', 'video.edit'])
      add(
        id,
        'fal',
        [
          {
            id: 'kling-o1-edit',
            name: 'Kling O1 · 参考视频编辑',
            ratios: [],
            resolutions: [],
            durations: [],
          },
        ],
        5,
        'second',
        ffmpeg ? null : '本机未检测到 FFmpeg',
      );
    add(
      'image.layers',
      'fal',
      [{ id: 'qwen-layered', name: 'Qwen · 4层拆分', ratios: [], resolutions: [], durations: [] }],
      12,
      'request',
    );
    add(
      'video.extend',
      'fal',
      [
        {
          id: 'ltx-2.3-extend',
          name: 'LTX 2.3 · 视频延长',
          ratios: [],
          resolutions: [],
          durations: Array.from({ length: 19 }, (_, n) => n + 2),
        },
      ],
      5,
      'second',
      ffmpeg ? null : '本机未检测到 FFmpeg',
    );
    add(
      'video.upscale',
      'fal',
      [
        {
          id: 'realesrgan-video',
          name: 'RealESRGAN · 视频超清',
          ratios: [],
          resolutions: [],
          durations: [],
        },
      ],
      2,
      'second',
      ffmpeg ? null : '本机未检测到 FFmpeg',
    );
    add(
      'video.translate',
      'fal',
      [
        {
          id: 'heygen-v2',
          name: 'HeyGen v2 · 口播翻译',
          ratios: [],
          resolutions: [],
          durations: [],
        },
      ],
      4,
      'second',
      ffmpeg ? null : '本机未检测到 FFmpeg',
    );
    add(
      'video.erase-subtitles',
      'fal',
      [
        {
          id: 'bria-short-text-erase',
          name: 'Bria · 短片文字区域擦除',
          ratios: [],
          resolutions: [],
          durations: [],
        },
      ],
      4,
      'second',
      ffmpeg ? null : '本机未检测到 FFmpeg',
    );
    return { providers, operations };
  }
  function validateCapability(wid: string, input: JobInput) {
    const c = capabilities(wid).operations.find(
      (v) => v.id === input.operation && v.providerId === input.providerId,
    );
    if (!c || !c.available)
      throw new AppError(503, 'CAPABILITY_UNAVAILABLE', c?.reason || '此服务不支持所选操作');
    if (input.options.model && !c.models.some((m) => m.id === input.options.model))
      throw new AppError(400, 'MODEL_UNSUPPORTED', '所选模型不支持此操作');
    const model = c.models.find((m) => m.id === input.options.model) || c.models[0];
    if (model?.ratios.length && !model.ratios.includes(input.options.ratio))
      throw new AppError(400, 'RATIO_UNSUPPORTED', '所选模型不支持此画面比例');
    if (
      model?.resolutions.length &&
      !model.resolutions.some((v) => v.toLowerCase() === input.options.resolution.toLowerCase())
    )
      throw new AppError(400, 'RESOLUTION_UNSUPPORTED', '所选模型不支持此清晰度');
    if (model?.durations.length && !model.durations.includes(input.options.duration))
      throw new AppError(400, 'DURATION_UNSUPPORTED', '所选模型不支持此时长');
    return c;
  }
  return { secret, list, update, capabilities, validateCapability, ffmpeg };
}
export type SettingsService = ReturnType<typeof createSettingsService>;

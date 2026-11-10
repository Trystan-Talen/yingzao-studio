import type { ModelCapability } from '../../contracts/jobs';

/** Audited request contracts, not a claim of a live schema or a paid generation test.
 * Keep exact model IDs: aliases for another version must not inherit these limits.
 * Source documents were read on 2026-11-02 (UTC). */
export const GENERATION_DOCUMENTS = {
  seedream: 'https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh',
  seedance: 'https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api',
  gateway:
    'https://github.com/QuantumNous/new-api-plugins/blob/main/plugins/tasks/doubao/1.0.0/plugin.js',
} as const;
export const DOCUMENT_REVIEWED_AT = '2026-11-02';

export const SEEDREAM_SIZE_PRESETS: Record<string, Record<string, string>> = {
  '2K': {
    '1:1': '2048x2048',
    '4:3': '2304x1728',
    '3:4': '1728x2304',
    '16:9': '2848x1600',
    '9:16': '1600x2848',
    '3:2': '2496x1664',
    '2:3': '1664x2496',
    '21:9': '3136x1344',
  },
  '3K': {
    '1:1': '3072x3072',
    '4:3': '3456x2592',
    '3:4': '2592x3456',
    '16:9': '4096x2304',
    '9:16': '2304x4096',
    '3:2': '3744x2496',
    '2:3': '2496x3744',
    '21:9': '4704x2016',
  },
  '4K': {
    '1:1': '4096x4096',
    '4:3': '4704x3520',
    '3:4': '3520x4704',
    '16:9': '5504x3040',
    '9:16': '3040x5504',
    '3:2': '4992x3328',
    '2:3': '3328x4992',
    '21:9': '6240x2656',
  },
};
export function seedreamSize(ratio: string, resolution: string): string | undefined {
  const sizes = SEEDREAM_SIZE_PRESETS[resolution.toUpperCase()];
  return sizes && Object.hasOwn(sizes, ratio) ? sizes[ratio] : undefined;
}
export function seedanceModel(model = 'doubao-seedance-2.0'): ModelCapability {
  const documented = model === 'doubao-seedance-2.0';
  return {
    id: model,
    name: documented ? 'Seedance 2.0' : model,
    ratios: documented
      ? ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']
      : ['16:9', '9:16', '1:1'],
    resolutions: documented ? ['480p', '720p', '1080p', '4K'] : ['480p', '720p'],
    durations: documented ? Array.from({ length: 12 }, (_, n) => n + 4) : [5],
    ...(documented
      ? { audio: { mode: 'generated' as const, note: '可生成与画面同步的声音，也可关闭声音。' } }
      : {}),
    textOverlay: {
      mode: 'unsupported',
      note: '当前接入支持文字生成视频；参考素材和字幕暂未开放。',
    },
  };
}

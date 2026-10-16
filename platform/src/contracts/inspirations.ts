import { z } from 'zod';
import { jobOptionsSchema, type JobInput } from './jobs';
import type { ProjectDto } from './core';
export const videoInspirationCategorySchema = z.enum([
  'talking-head',
  'recommendation',
  'brand',
  'story',
]);
export const VIDEO_INSPIRATION_LABELS: Record<
  z.infer<typeof videoInspirationCategorySchema>,
  string
> = {
  'talking-head': '口播',
  recommendation: '种草',
  brand: '品牌',
  story: '剧情',
};
export const reuseInspirationSchema = z
  .object({
    requestId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(12000),
    language: z.string().min(1).max(80).default('zh-CN'),
    intent: z.enum(['create', 'replicate']).default('create'),
  })
  .strict();
export interface InspirationReuseDto {
  project: ProjectDto;
  draft: JobInput;
}
export const inspirationInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(60),
    kind: z.enum(['image', 'video']),
    videoCategory: videoInspirationCategorySchema.nullable().optional(),
    tag: z.string().max(100),
    platform: z.string().max(80).default('通用电商'),
    ratio: z.string().regex(/^\d{1,2}:\d{1,2}$/),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#eaf1ec'),
    prompt: z.string().min(1).max(12000),
    source: z.string().min(1).max(300),
    assetId: z.string().uuid(),
    options: jobOptionsSchema.optional(),
  })
  .strict()
  .refine((value) => value.kind === 'video' || !value.videoCategory, {
    path: ['videoCategory'],
    message: '只有视频灵感可以设置视频内容分类',
  });
export type InspirationInput = z.infer<typeof inspirationInputSchema>;
export interface InspirationDto extends Omit<InspirationInput, 'assetId'> {
  id: string;
  workspaceId: string | null;
  assetId: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  isFavorite: boolean;
  archived: boolean;
  mediaUnavailable: boolean;
  createdAt: string;
}
export const originalInspirations = [
  {
    id: 'botanical-serum',
    title: '把清晨，装进一滴精华',
    category: '美妆护肤',
    ratio: '2:3',
    color: '#dce7dd',
    prompt:
      '为植物修护精华创作一张清新自然的商业摄影。透明玻璃瓶置于浅色石台，柔和晨光穿过绿色叶片，在瓶身留下精致水珠。清晰展现产品质感，空间简洁，保留适量排版留白。',
    tag: '自然 · 护肤',
  },
  {
    id: 'amber-perfume',
    title: '一抹琥珀色的安静',
    category: '美妆护肤',
    ratio: '3:4',
    color: '#d6b793',
    prompt:
      '为琥珀香水创作静物广告摄影。温暖斜光穿过透明香水瓶，橙棕色玻璃与细腻石材形成柔和对比，简洁构图突出产品轮廓与液体色泽。',
    tag: '光影 · 香氛',
  },
  {
    id: 'studio-headphones',
    title: '听见，另一种可能',
    category: '数码科技',
    ratio: '1:1',
    color: '#d7dce0',
    prompt:
      '为一副高级头戴耳机设计极简产品广告。冷灰色背景与干净几何台面，柔和侧光表现耳罩的织物与金属细节，构图自信而克制。',
    tag: '极简 · 数码',
  },
  {
    id: 'citrus-drink',
    title: '让夏天多一点气泡',
    category: '食品饮料',
    ratio: '4:5',
    color: '#d9e8b1',
    prompt:
      '创作一张清爽的柑橘气泡饮料广告。玻璃杯中的细小气泡与冰块晶莹清晰，切开的柑橘和叶片围绕产品，充满午后阳光的明快绿色背景。',
    tag: '鲜活 · 果饮',
  },
  {
    id: 'sculptural-lamp',
    title: '光，也是一件雕塑',
    category: '家居生活',
    ratio: '3:4',
    color: '#e7dfd1',
    prompt:
      '一盏具有雕塑感的现代台灯，置于温暖极简的家居角落。光晕柔和地洒在墙面，材质细腻，留白宽裕，用建筑感构图呈现生活美学。',
    tag: '空间 · 家居',
  },
  {
    id: 'trail-sneaker',
    title: '下一步，走向旷野',
    category: '服饰运动',
    ratio: '4:5',
    color: '#d8dbce',
    prompt:
      '为户外越野鞋创作专业广告摄影。产品放在粗粝岩石表面，以自然侧光突出鞋面织物与鞋底结构，背景融入低饱和荒野色调，体现轻盈与坚实。',
    tag: '探索 · 运动',
  },
  {
    id: 'matcha-ritual',
    title: '给生活，留一刻缓慢',
    category: '食品饮料',
    ratio: '1:1',
    color: '#d8decd',
    prompt:
      '一杯细腻抹茶与竹制茶筅构成安静的日常仪式。自然窗光落在陶瓷和亚麻上，绿色层次真实清晰，画面克制温暖，有手工质感。',
    tag: '日常 · 茶饮',
  },
  {
    id: 'leather-bag',
    title: '质感，藏在每个细节',
    category: '服饰运动',
    ratio: '2:3',
    color: '#d8c1aa',
    prompt:
      '为一只棕色皮革手袋拍摄精致商品照片。真实皮纹、金属五金与缝线细节清晰，柔和暖光投射在简洁石灰色背景，经典而从容的构图。',
    tag: '细节 · 配饰',
  },
].map((i) => ({
  ...i,
  kind: 'image' as const,
  platform: '通用电商',
  source: '原创 AI 视觉示例 · imagegen，2026-10-13',
}));

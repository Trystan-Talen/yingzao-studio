import { z } from 'zod';

export const modelConnectionKindSchema = z.enum(['text', 'image', 'video']);
export type ModelConnectionKind = z.infer<typeof modelConnectionKindSchema>;
export const modelConnectionProtocolSchema = z.enum([
  'openai-chat',
  'openai-images',
  'seedream-images',
  'seedance-native',
]);
export type ModelConnectionProtocol = z.infer<typeof modelConnectionProtocolSchema>;
/** Only explicit family identifiers; custom gateway aliases remain a manual protocol choice. */
export function isKnownSeedreamModel(model: string): boolean {
  return /^(?:doubao-)?seedream(?:[-_.]|$)/i.test(model.trim());
}
export const MODEL_CONNECTION_PROTOCOLS = {
  text: 'openai-chat',
  image: 'openai-images',
  video: 'seedance-native',
} as const;
export const modelFallbackResourceInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .refine((id) => !['primary', 'text', 'image', 'video'].includes(id)),
    name: z.string().trim().min(1).max(80),
    protocol: modelConnectionProtocolSchema,
    baseUrl: z.string().trim().url().max(1000),
    modelsUrl: z.string().trim().max(1000).default(''),
    model: z
      .string()
      .trim()
      .max(120)
      .regex(/^[^\s\u0000-\u001f\u007f]*$/),
    visionModel: z
      .string()
      .trim()
      .max(120)
      .regex(/^[^\s\u0000-\u001f\u007f]*$/)
      .optional(),
    enabled: z.boolean(),
    secret: z.string().trim().min(1).max(4096).optional(),
    removeSecret: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.enabled || Boolean(value.model), {
    message: '启用备用资源前请选择模型',
    path: ['model'],
  })
  .refine((value) => !(value.secret && value.removeSecret), {
    message: '不能同时替换和移除密钥',
    path: ['secret'],
  });
export type ModelFallbackResourceInput = z.infer<typeof modelFallbackResourceInputSchema>;
export const modelConnectionInputSchema = z
  .object({
    kind: modelConnectionKindSchema,
    fallbackResources: z.array(modelFallbackResourceInputSchema).max(2).optional(),
    protocol: modelConnectionProtocolSchema,
    baseUrl: z.string().trim().url().max(1000),
    modelsUrl: z.string().trim().max(1000).default(''),
    model: z
      .string()
      .trim()
      .max(120)
      .regex(/^[^\s\u0000-\u001f\u007f]*$/),
    enabled: z.boolean(),
    visionModel: z
      .string()
      .trim()
      .max(120)
      .regex(/^[^\s\u0000-\u001f\u007f]*$/)
      .optional(),
    secret: z.string().trim().min(1).max(4096).optional(),
    removeSecret: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.enabled || Boolean(value.model), {
    message: '启用服务前请选择模型',
    path: ['model'],
  })
  .refine(
    (value) =>
      value.protocol === MODEL_CONNECTION_PROTOCOLS[value.kind] ||
      (value.kind === 'image' && value.protocol === 'seedream-images'),
    {
      message: '服务类型与接口协议不匹配',
      path: ['protocol'],
    },
  )
  .refine((value) => !(value.secret && value.removeSecret), {
    message: '不能同时替换和移除密钥',
    path: ['secret'],
  })
  .refine(
    (value) =>
      new Set(value.fallbackResources?.map((item) => item.id)).size ===
      (value.fallbackResources?.length ?? 0),
    {
      message: '备用资源标识不能重复',
      path: ['fallbackResources'],
    },
  )
  .refine(
    (value) =>
      (value.fallbackResources ?? []).every(
        (item) =>
          item.protocol === MODEL_CONNECTION_PROTOCOLS[value.kind] ||
          (value.kind === 'image' && item.protocol === 'seedream-images'),
      ),
    {
      message: '备用资源协议与服务类型不匹配',
      path: ['fallbackResources'],
    },
  );
export type ModelConnectionInput = z.infer<typeof modelConnectionInputSchema>;
export const modelDiscoveryInputSchema = z
  .object({
    kind: modelConnectionKindSchema,
    resourceId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    baseUrl: z.string().trim().url().max(1000),
    modelsUrl: z.string().trim().max(1000).default(''),
    secret: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();
export type ModelDiscoveryInput = z.infer<typeof modelDiscoveryInputSchema>;
export type ModelDiscoveryStatus =
  'never' | 'connected' | 'unavailable' | 'unauthorized' | 'invalid';
export interface ModelFallbackResourceDto extends Omit<ModelConnectionDto, 'fallbackResources'> {
  id: string;
  name: string;
}
export interface ModelConnectionDto {
  fallbackResources?: ModelFallbackResourceDto[];
  kind: ModelConnectionKind;
  protocol: ModelConnectionProtocol;
  baseUrl: string;
  modelsUrl: string;
  model: string;
  visionModel?: string;
  enabled: boolean;
  configured: boolean;
  keyHint: string | null;
  revision: string | null;
  updatedAt: string | null;
  models: string[];
  modelsCheckedAt: string | null;
  discoveryStatus: ModelDiscoveryStatus;
  discoveryMessage: string;
}
export type ModelDirectoryDto = Pick<
  ModelConnectionDto,
  'models' | 'modelsCheckedAt' | 'discoveryStatus' | 'discoveryMessage'
>;

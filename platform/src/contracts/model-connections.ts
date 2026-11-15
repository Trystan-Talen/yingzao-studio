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
export const modelConnectionInputSchema = z
  .object({
    kind: modelConnectionKindSchema,
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
  });
export type ModelConnectionInput = z.infer<typeof modelConnectionInputSchema>;
export type ModelDiscoveryStatus =
  'never' | 'connected' | 'unavailable' | 'unauthorized' | 'invalid';
export interface ModelConnectionDto {
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

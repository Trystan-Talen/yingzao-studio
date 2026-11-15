import { z } from 'zod';
import { IdSchema, IsoDateSchema, NameSchema } from './core';

const memoryFields = z
  .object({
    topic: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(2000),
    kind: z.enum(['profile', 'preference', 'temporary']),
    mediaType: z.enum(['all', 'image', 'video']).default('all'),
    expiresAt: IsoDateSchema.nullable().default(null),
    halfLifeDays: z.number().int().min(1).max(3650).nullable().default(null),
    status: z.enum(['active', 'paused']).default('active'),
  })
  .strict();
function validateMemory(value: z.infer<typeof memoryFields>, ctx: z.RefinementCtx) {
  if (value.kind === 'temporary' && !value.expiresAt)
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: '临时记忆必须设置到期时间' });
  if (value.kind !== 'preference' && value.halfLifeDays !== null)
    ctx.addIssue({ code: 'custom', path: ['halfLifeDays'], message: '只有创作偏好使用时间衰减' });
}
export const MemoryInputSchema = memoryFields.superRefine(validateMemory);
export const MemoryPatchSchema = z
  .object({
    topic: memoryFields.shape.topic.optional(),
    content: memoryFields.shape.content.optional(),
    kind: memoryFields.shape.kind.optional(),
    mediaType: memoryFields.shape.mediaType.removeDefault().optional(),
    expiresAt: memoryFields.shape.expiresAt.removeDefault().optional(),
    halfLifeDays: memoryFields.shape.halfLifeDays.removeDefault().optional(),
    status: memoryFields.shape.status.removeDefault().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const MemorySchema = memoryFields.extend({
  id: IdSchema,
  workspaceId: IdSchema,
  userId: IdSchema,
  version: z.number().int().positive(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  confirmedAt: IsoDateSchema,
  effectiveWeight: z.number().min(0).max(1),
  eligible: z.boolean(),
});
export type MemoryInput = z.infer<typeof MemoryInputSchema>;
export type MemoryDto = z.infer<typeof MemorySchema>;

export const ProductInputSchema = z
  .object({
    name: NameSchema,
    description: z.string().trim().max(4000).default(''),
    facts: z.array(z.string().trim().min(1).max(500)).max(16).default([]),
    cautions: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    brandId: IdSchema.nullable().default(null),
    referenceAssetIds: z
      .array(IdSchema)
      .max(4)
      .refine((ids) => new Set(ids).size === ids.length, '参考图片不能重复')
      .default([]),
    visibility: z.enum(['private', 'workspace']).default('private'),
    validUntil: IsoDateSchema.nullable().default(null),
  })
  .strict();
export const ProductPatchSchema = z
  .object({
    name: ProductInputSchema.shape.name.optional(),
    description: ProductInputSchema.shape.description.removeDefault().optional(),
    facts: ProductInputSchema.shape.facts.removeDefault().optional(),
    cautions: ProductInputSchema.shape.cautions.removeDefault().optional(),
    brandId: ProductInputSchema.shape.brandId.removeDefault().optional(),
    referenceAssetIds: ProductInputSchema.shape.referenceAssetIds.removeDefault().optional(),
    visibility: ProductInputSchema.shape.visibility.removeDefault().optional(),
    validUntil: ProductInputSchema.shape.validUntil.removeDefault().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const ProductSchema = ProductInputSchema.extend({
  id: IdSchema,
  workspaceId: IdSchema,
  version: z.number().int().positive(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  deletedAt: IsoDateSchema.nullable(),
});
export type ProductInput = z.infer<typeof ProductInputSchema>;
export type ProductDto = z.infer<typeof ProductSchema>;

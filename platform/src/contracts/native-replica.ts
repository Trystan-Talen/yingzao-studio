import { z } from 'zod';
import { referenceStudySchema, referenceStudyEvidenceSchema } from './reference-study';

export const replicaAspectSchema = z.enum([
  'composition',
  'lighting',
  'palette',
  'camera',
  'pacing',
]);
/** User intent: the reference supplies presentation; only the subject supplies identity. */
export const replicaInputSchema = z
  .object({
    referenceAssetId: z.string().uuid(),
    subjectAssetId: z.string().uuid(),
    aspects: z
      .array(replicaAspectSchema)
      .min(1)
      .max(5)
      .refine((values) => new Set(values).size === values.length),
    trimStart: z.number().finite().min(0).max(3600).default(0),
    trimDuration: z.number().finite().min(2).max(15).optional(),
  })
  .strict()
  .refine((value) => value.referenceAssetId !== value.subjectAssetId, {
    message: '参考作品与自己的主体须选择不同素材',
  });
export type ReplicaInput = z.infer<typeof replicaInputSchema>;

/** Compiled only from an owned ready brief; never trust a client-supplied study. */
export const nativeReplicaSchema = z
  .object({
    version: z.literal(1),
    renderStrategy: z.literal('subject-edit-v1').optional(),
    intent: replicaInputSchema,
    study: referenceStudySchema,
    evidence: referenceStudyEvidenceSchema,
  })
  .strict();
export type NativeReplica = z.infer<typeof nativeReplicaSchema>;

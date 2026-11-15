import { z } from 'zod';

const statement = z.string().trim().min(1).max(800);
export const referenceStudySchema = z
  .object({
    version: z.literal(1),
    referenceKind: z.enum(['image', 'video']),
    visualStatus: z.enum(['readable', 'unreadable']),
    observations: z.array(statement).min(1).max(6),
    motion: z
      .object({ description: statement, uncertainties: z.array(statement).min(1).max(4) })
      .strict()
      .nullable(),
    timeline: z
      .array(
        z
          .object({ timestampSeconds: z.number().finite().min(0).max(15), description: statement })
          .strict(),
      )
      .max(8),
    anchorFrameIndex: z.number().int().min(0).max(7),
    transferGuidance: z.string().trim().min(1).max(2000),
    limitations: z.array(statement).min(1).max(6),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.referenceKind === 'image' &&
      (value.motion !== null || value.timeline.length !== 0 || value.anchorFrameIndex !== 0)
    )
      ctx.addIssue({ code: 'custom', message: '图片参考不能携带视频时间轴或运动分析' });
    if (value.referenceKind === 'video' && (value.motion === null || value.timeline.length < 5))
      ctx.addIssue({ code: 'custom', message: '视频参考需要采样时间轴及运动不确定性说明' });
  });
export type ReferenceStudy = z.infer<typeof referenceStudySchema>;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
/** Written from local bytes and the explicitly selected connection, never model output. */
export const referenceStudyEvidenceSchema = z
  .object({
    version: z.literal(1),
    referenceKind: z.enum(['image', 'video']),
    referenceSha256: digest,
    subjectSha256: digest,
    subjectImageSha256: digest,
    model: z.string().trim().min(1).max(120),
    sampledAt: z.string().datetime(),
    analyzedAt: z.string().datetime(),
    timestampBasis: z.literal('relative-to-selected-clip'),
    clipStartSeconds: z.number().finite().min(0),
    clipDurationSeconds: z.number().finite().min(0).max(15),
    sourceDurationSeconds: z.number().finite().positive().optional(),
    audioAnalyzed: z.literal(false),
    frames: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(7),
            timestampSeconds: z.number().finite().min(0).max(15),
            sourceTimestampSeconds: z.number().finite().min(0),
            sha256: digest,
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export type ReferenceStudyEvidence = z.infer<typeof referenceStudyEvidenceSchema>;

export interface ReferenceStudyResult {
  study: ReferenceStudy;
  evidence: ReferenceStudyEvidence;
}

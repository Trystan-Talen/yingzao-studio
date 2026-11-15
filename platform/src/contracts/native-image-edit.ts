import { z } from 'zod';

/** A server-frozen local edit. The image model proposes a mask, never replacement product pixels. */
export const nativeImageEditSchema = z
  .object({
    type: z.literal('solid-background'),
    sourceAssetId: z.string().uuid(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((color) => color.toLowerCase()),
    regionDescription: z.string().trim().min(1).max(400),
    preserveDescription: z.string().trim().min(1).max(800),
    mattingBaseline: z
      .object({
        version: z.literal(1),
        sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        resultAssetId: z.string().uuid(),
        resultSha256: z.string().regex(/^[a-f0-9]{64}$/),
        maskAssetId: z.string().uuid(),
        maskSha256: z.string().regex(/^[a-f0-9]{64}$/),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .transform((color) => color.toLowerCase()),
      })
      .strict()
      .optional(),
    visualGuidance: z
      .object({
        boundaryNotes: z.string().trim().min(1).max(1200),
        sceneBoundary: z.literal('continuous-soft-exterior-v1').optional(),
        uncertainties: z.array(z.string().trim().min(1).max(300)).max(3),
        evidence: z
          .object({
            sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
            model: z.string().trim().min(1).max(120),
            analyzedAt: z.string().datetime(),
          })
          .strict(),
      })
      .strict()
      .optional(),
    mask: z.discriminatedUnion('mode', [
      z
        .object({
          mode: z.literal('generate'),
          calibration: z.enum(['source-guided-v1', 'local-matting-v2']).optional(),
        })
        .strict(),
      z.object({ mode: z.literal('asset'), assetId: z.string().uuid() }).strict(),
    ]),
  })
  .strict()
  .superRefine((edit, context) => {
    if (
      edit.mattingBaseline &&
      (edit.mask.mode !== 'asset' || edit.mattingBaseline.color !== edit.color)
    )
      context.addIssue({
        code: 'custom',
        path: ['mattingBaseline'],
        message: 'Matting baseline requires a confirmed asset mask and the same background color.',
      });
  });

export type NativeImageEdit = z.infer<typeof nativeImageEditSchema>;

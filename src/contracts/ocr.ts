import { z } from 'zod';
export const ocrResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['regions'],
  properties: {
    regions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'rect'],
        properties: {
          text: { type: 'string' },
          rect: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        },
      },
    },
  },
};
export const ocrRegionsSchema = z
  .object({
    regions: z.array(
      z
        .object({
          text: z.string(),
          rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        })
        .strict(),
    ),
  })
  .strict();
export const ocrResultSchema = ocrRegionsSchema.extend({
  imageAssetId: z.string().uuid(),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  coordinateSource: z.literal('model-estimate'),
});
export type OcrResult = z.infer<typeof ocrResultSchema>;

import { z } from 'zod';
import type { AssetDto } from './core';

export const backgroundRefinePrepareSchema = z
  .object({
    requestId: z.string().uuid(),
    maskAssetId: z.string().uuid(),
  })
  .strict();

export interface BackgroundReview {
  itemId: string;
  sourceAssetId: string;
  maskAssetId: string;
  color: string;
  state: 'candidate' | 'confirmed';
}

export interface BackgroundReviewDetail extends BackgroundReview {
  jobId: string;
  source: AssetDto;
  mask: AssetDto;
}

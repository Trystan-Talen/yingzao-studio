import { z } from 'zod';
import { designPlanResultSchema } from './design-plan';
import { detailPagePlanResultSchema } from './detail-page';

export const jobResultDataSchema = z.union([designPlanResultSchema, detailPagePlanResultSchema]);
export type JobResultData = z.infer<typeof jobResultDataSchema>;

export function resultMatchesAssistantMode(result: JobResultData, mode: string): boolean {
  return (
    (result.type === 'design-plan' && mode === 'design-plan') ||
    (result.type === 'detail-page-plan' && mode === 'detail-page')
  );
}

import { z } from 'zod';
const section = z.string().trim().min(1).max(2000);
export const designPlanSchema = z
  .object({
    analysis: section,
    objective: section,
    style: section,
    palette: z.array(z.string().trim().min(1).max(100)).min(1).max(12),
    composition: section,
    copy: z.array(z.string().trim().min(1).max(500)).max(12),
    scene: section,
    technical: z
      .object({
        ratio: z.string().trim().min(1).max(40),
        resolution: z.string().trim().min(1).max(40),
        language: z.string().trim().min(1).max(80),
      })
      .strict(),
    directions: z
      .array(z.object({ title: z.string().trim().min(1).max(80), prompt: section }).strict())
      .length(3),
  })
  .strict();
export type DesignPlan = z.infer<typeof designPlanSchema>;
export const designPlanResultSchema = z
  .object({
    type: z.literal('design-plan'),
    version: z.literal(1),
    plan: designPlanSchema,
  })
  .strict();
export type DesignPlanResult = z.infer<typeof designPlanResultSchema>;
export function formatDesignPlan(p: DesignPlan) {
  return [
    `素材分析：${p.analysis}`,
    `创作目标：${p.objective}`,
    `视觉风格：${p.style}`,
    `配色：${p.palette.join(' / ')}`,
    `构图与版式：${p.composition}`,
    `建议文案：\n${p.copy.map((x) => `- ${x}`).join('\n')}`,
    `场景：${p.scene}`,
    `技术规范：${p.technical.ratio} · ${p.technical.resolution} · ${p.technical.language}`,
    `可执行方向：\n${p.directions.map((d, i) => `${i + 1}. ${d.title}\n${d.prompt}`).join('\n\n')}`,
  ].join('\n\n');
}

import { z } from 'zod';
export const designPlanSchema = z
  .object({
    analysis: z.string(),
    objective: z.string(),
    style: z.string(),
    palette: z.array(z.string()),
    composition: z.string(),
    copy: z.array(z.string()),
    scene: z.string(),
    technical: z
      .object({ ratio: z.string(), resolution: z.string(), language: z.string() })
      .strict(),
    directions: z.array(z.object({ title: z.string(), prompt: z.string() }).strict()),
  })
  .strict();
export type DesignPlan = z.infer<typeof designPlanSchema>;
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

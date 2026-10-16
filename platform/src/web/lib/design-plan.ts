import { designPlanSchema, type DesignPlan } from '../../contracts/design-plan';

export interface PlanCapabilities {
  ratios: readonly string[];
  resolutions: readonly string[];
  languages: readonly string[];
  maxPromptLength?: number;
}
export interface PlanApplication {
  prompt: string;
  ratio?: string;
  resolution?: string;
  language?: string;
  needText: boolean;
  warnings: string[];
}

/** Applies one alternative, retaining unsupported specifications as visible warnings. */
export function buildPlanApplication(
  input: DesignPlan,
  directionIndex: number,
  capabilities: PlanCapabilities,
): PlanApplication {
  const plan = designPlanSchema.parse(input);
  const direction = plan.directions[directionIndex];
  if (!direction) throw new Error('请选择方案中的一个创作方向。');
  const result: PlanApplication = {
    prompt: [
      `创作目标：${plan.objective}`,
      `视觉风格：${plan.style}`,
      `配色：${plan.palette.join(' / ')}`,
      `构图：${plan.composition}`,
      `场景：${plan.scene}`,
      plan.copy.length ? `需要呈现的文案：${plan.copy.join('；')}` : '不添加文字。',
      `采用方向：${direction.title}\n${direction.prompt}`,
    ].join('\n\n'),
    warnings: [],
    needText: plan.copy.length > 0,
  };
  for (const [key, values, label] of [
    ['ratio', capabilities.ratios, '比例'],
    ['resolution', capabilities.resolutions, '分辨率'],
    ['language', capabilities.languages, '语言'],
  ] as const) {
    const value = plan.technical[key];
    if (values.includes(value)) result[key] = value;
    else
      result.warnings.push(
        `方案${label}“${value}”不在当前模型支持范围内；保留当前设置，请手动确认。`,
      );
  }
  if (result.prompt.length > (capabilities.maxPromptLength ?? 12000))
    throw new Error('方案内容超过创作需求长度上限，请精简后应用。');
  return result;
}

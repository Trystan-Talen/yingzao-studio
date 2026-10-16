import { expect, it } from 'vitest';
import { designPlanSchema, type DesignPlan } from '../src/contracts/design-plan';
import { buildPlanApplication } from '../src/web/lib/design-plan';

const plan: DesignPlan = {
  analysis: '尚未提供图片，仅依据用户需求',
  objective: '展示玻璃瓶外观',
  style: '自然摄影',
  palette: ['米白', '深绿'],
  composition: '主体居中',
  copy: [],
  scene: '柔和窗光',
  technical: { ratio: '3:4', resolution: '1K', language: 'zh-CN' },
  directions: [1, 2, 3].map((n) => ({ title: `方向${n}`, prompt: `构图${n}` })),
};

it('applies exactly one direction and supported specifications without silently coercing values', () => {
  const applied = buildPlanApplication(plan, 1, {
    ratios: ['1:1', '3:4'],
    resolutions: ['1K'],
    languages: ['zh-CN'],
  });
  expect(applied).toMatchObject({
    ratio: '3:4',
    resolution: '1K',
    language: 'zh-CN',
    warnings: [],
  });
  expect(applied.prompt).toContain('方向2');
  expect(applied.prompt).not.toContain('方向1');
  expect(applied.prompt).toContain('不添加文字');
  expect(applied.needText).toBe(false);
  expect(() =>
    buildPlanApplication(plan, 0, {
      ratios: [],
      resolutions: [],
      languages: [],
      maxPromptLength: 20,
    }),
  ).toThrow('长度');
  const partial = buildPlanApplication(plan, 0, {
    ratios: ['1:1'],
    resolutions: [],
    languages: ['en'],
  });
  expect(partial.ratio).toBeUndefined();
  expect(partial.resolution).toBeUndefined();
  expect(partial.language).toBeUndefined();
  expect(partial.warnings).toHaveLength(3);
  expect(() =>
    buildPlanApplication(plan, 3, { ratios: [], resolutions: [], languages: [] }),
  ).toThrow('选择');
});

it('rejects three empty directions and whitespace-only required design sections', () => {
  expect(
    designPlanSchema.safeParse({
      ...plan,
      directions: [1, 2, 3].map(() => ({ title: '', prompt: '   ' })),
    }).success,
  ).toBe(false);
  expect(designPlanSchema.safeParse({ ...plan, analysis: '  ' }).success).toBe(false);
});

it('requires three bounded executable alternatives while allowing explicitly no copy', () => {
  expect(designPlanSchema.safeParse(plan).success).toBe(true);
  expect(designPlanSchema.safeParse({ ...plan, directions: [] }).success).toBe(false);
  expect(
    designPlanSchema.safeParse({
      ...plan,
      directions: [...plan.directions, plan.directions[0]],
    }).success,
  ).toBe(false);
});

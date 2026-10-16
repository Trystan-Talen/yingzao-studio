import { t } from './i18n';

/** Display known product warnings without modifying persisted warnings or their parameter values. */
const templates: readonly { pattern: RegExp; text: string; parameters: readonly string[] }[] = [
  {
    pattern: /^原模型当前不可选，已切换为 (.+)，请确认参数。$/u,
    text: '原模型当前不可选，已切换为 {value}，请确认参数。',
    parameters: ['value'],
  },
  {
    pattern: /^当前模型不支持比例 (.+)，已调整为 (.+)。$/u,
    text: '当前模型不支持比例 {value}，已调整为 {next}。',
    parameters: ['value', 'next'],
  },
  {
    pattern: /^当前模型不支持清晰度 (.+)，已调整为 (.+)。$/u,
    text: '当前模型不支持清晰度 {value}，已调整为 {next}。',
    parameters: ['value', 'next'],
  },
  {
    pattern: /^当前模型不支持 (.+) 秒，已调整为 (.+) 秒。$/u,
    text: '当前模型不支持 {value} 秒，已调整为 {next} 秒。',
    parameters: ['value', 'next'],
  },
  {
    pattern: /^保存的服务“(.+)”当前不可用，请明确重新选择。$/u,
    text: '保存的服务“{value}”当前不可用，请明确重新选择。',
    parameters: ['value'],
  },
  {
    pattern: /^保存的模型“(.+)”当前不受支持，请明确重新选择。$/u,
    text: '保存的模型“{value}”当前不受支持，请明确重新选择。',
    parameters: ['value'],
  },
  {
    pattern: /^保存的时长“(.+)秒”不受当前模型支持，原值已保留。$/u,
    text: '保存的时长“{value}秒”不受当前模型支持，原值已保留。',
    parameters: ['value'],
  },
  {
    pattern: /^保存的分辨率“(.+)”不受当前模型支持，原值已保留。$/u,
    text: '保存的分辨率“{value}”不受当前模型支持，原值已保留。',
    parameters: ['value'],
  },
  {
    pattern: /^保存的目标语言“(.+)”当前不受支持，原值已保留。$/u,
    text: '保存的目标语言“{value}”当前不受支持，原值已保留。',
    parameters: ['value'],
  },
  {
    pattern: /^保存的放大倍数“(.+)”当前不受支持，原值已保留。$/u,
    text: '保存的放大倍数“{value}”当前不受支持，原值已保留。',
    parameters: ['value'],
  },
  ...(['比例', '分辨率', '语言'] as const).map((label) => ({
    pattern: new RegExp(
      `^方案${label}“(.+)”不在当前模型支持范围内；保留当前设置，请手动确认。$`,
      'u',
    ),
    text: `方案${label}“{value}”不在当前模型支持范围内；保留当前设置，请手动确认。`,
    parameters: ['value'],
  })),
];

const fixedWarnings = new Set([
  '已继承参考视频；请补充主体图片、检查动作片段，再确认人物与视频使用授权及外部费用。当前仅支持人物动作参考，不支持服装、人脸或商品精准替换。',
  '参考视频超过30秒，当前预选前30秒；请在提交前检查并调整动作片段。',
]);

export function productWarning(message: string): string {
  if (fixedWarnings.has(message)) return t(message);
  for (const template of templates) {
    const match = template.pattern.exec(message);
    if (!match) continue;
    const parameters = Object.fromEntries(
      template.parameters.map((name, index) => [name, match[index + 1]!]),
    );
    // One replacement pass prevents parameter text such as "{next}" from being reinterpreted.
    return t(template.text).replace(
      /\{(\w+)\}/g,
      (placeholder: string, name: string) => parameters[name] ?? placeholder,
    );
  }
  return message;
}

import type { CreativeIntentRequest, CreativeIntentResult } from '../../contracts/creative-intent';
import type { CreativeStrategy } from '../../contracts/creative-strategy';

/** capture-v1: execution directions only; full strategy/source evidence stays in the brief. */
export function compileCapturePrompt(
  result: CreativeIntentResult,
  request: CreativeIntentRequest,
  strategy: CreativeStrategy,
  needText: boolean,
): string | null {
  if (result.status !== 'ready') return null;
  const product = result.brief.scope === 'product';
  const reference =
    product &&
    result.brief.productMode === 'reference' &&
    request.materials.some(
      (material) => material.kind === 'image' && ['reference', 'input'].includes(material.role),
    );
  const directions = [
    result.prompt,
    // Quotations may omit negation or corrections. Keep them for audit, never as new claims.
    product
      ? '只呈现已整理并明确允许的商品信息。未提供或未确认的参数、功效、材质、认证、销量与价格，不得自行添加；不得把否定、疑问或未证实表述改写为肯定声明。'
      : '',
    ...result.brief.constraints,
    reference
      ? '实际商品参考图片随请求提供；素材名称不代表已观察到的图像事实。除用户明确要求改动的部分外，商品的轮廓、各部分相对比例、颜色、既有标识与数量均以参考图为准；未要求换视角时沿用原视角。画幅变化通过背景和留白适配，商品仅等比缩放，不随画幅拉伸。用户明确要求的改形、改色、换视角、局部特写或裁切优先。'
      : '',
    // Do not send provenance, version labels or audit unknowns as visual instructions.
    ...(product ? strategy.requirements.map((item) => `适用要求：${item.text}`) : []),
    product && strategy.recommendations.length
      ? `可调整的创作建议（用户明确的主体、风格和限制优先）：${strategy.recommendations.map((item) => item.text).join('；')}`
      : '',
    needText && request.context.supportsText
      ? `画面文字使用${request.context.language}，只呈现用户要求且有依据的文字。`
      : '画面不添加文字、字幕或水印。',
  ];
  // Remove only identical whole directions; never shorten or rewrite user constraints.
  return [...new Set(directions.filter(Boolean))].join('\n\n');
}

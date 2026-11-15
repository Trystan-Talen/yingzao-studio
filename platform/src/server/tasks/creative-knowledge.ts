import type { Actor } from '../../contracts/core';
import type { CreativeIntentRequest } from '../../contracts/creative-intent';
import type { JobInput } from '../../contracts/jobs';
import type { CoreServices } from '../core';
import { AppError } from '../errors';

export function validateCreativeKnowledgeInput(actor: Actor, input: JobInput) {
  // Grouped legacy designs append their own module prose after planning. Until each
  // module has an approved plan, never claim new knowledge governs those prompts.
  if (
    input.options.designs?.length &&
    (input.productId || input.useMemory === true || input.includeProductImages === true)
  )
    throw new AppError(
      400,
      'KNOWLEDGE_GROUP_UNSUPPORTED',
      '分组物料暂不支持关联产品与个人记忆，请切换单张创作或取消关联。',
    );
  if (
    (input.productId !== undefined ||
      input.useMemory !== undefined ||
      input.includeProductImages !== undefined) &&
    (!['image.generate', 'video.generate'].includes(input.operation) ||
      input.options.detailPagePlan ||
      input.options.assistantMode !== 'ideas')
  )
    throw new AppError(
      400,
      'KNOWLEDGE_CONTEXT_UNSUPPORTED',
      '品牌产品与个人记忆关联仅用于图片、视频创作入口；当前工具不支持该上下文。',
    );
  if (input.includeProductImages && !input.productId)
    throw new AppError(400, 'PRODUCT_REQUIRED', '使用产品图片前请先选择产品。');
  if (input.useMemory === true && actor.authType !== 'session')
    throw new AppError(
      403,
      'MEMORY_SESSION_REQUIRED',
      '个人记忆只能由本人登录会话使用，开放接口不可读取。',
    );
}

/** Reading history is allowed; a new quote or follow-up must not revive expired context. */
export function assertCreativeKnowledgeFresh(request: CreativeIntentRequest, at = Date.now()) {
  const expired = request.contextSources?.some(
    (source) => source.expiresAt && Date.parse(source.expiresAt) <= at,
  );
  const staleMemory = request.memoryContext?.items.some(
    (item) =>
      (item.expiresAt && Date.parse(item.expiresAt) <= at) ||
      (item.halfLifeDays &&
        item.confirmedAt &&
        Math.pow(
          0.5,
          Math.max(0, at - Date.parse(item.confirmedAt)) / (item.halfLifeDays * 86_400_000),
        ) < 0.25),
  );
  if (expired || staleMemory)
    throw new AppError(
      409,
      'KNOWLEDGE_CONTEXT_EXPIRED',
      '已保存方案引用的资料或偏好已过期，请重新整理需求；历史方案与已报价任务不会被改写。',
    );
}

/** Resolve only explicitly selected records. Personal context is never a product fact source. */
export function resolveCreativeKnowledge(
  core: CoreServices,
  actor: Actor,
  wid: string,
  input: JobInput,
) {
  const sourceTexts: CreativeIntentRequest['sourceTexts'] = [];
  const contextSources: NonNullable<CreativeIntentRequest['contextSources']> = [];
  const referenceAssetIds: string[] = [];
  const product = input.productId
    ? core.knowledge.getProduct(actor, wid, input.productId)
    : undefined;
  if (product?.validUntil && Date.parse(product.validUntil) <= Date.now())
    throw new AppError(
      409,
      'PRODUCT_CONTEXT_EXPIRED',
      '产品资料已到期，请先更新并确认资料，再整理新方案。',
    );
  if (product?.brandId && input.brandId && product.brandId !== input.brandId)
    throw new AppError(
      400,
      'PRODUCT_BRAND_CONFLICT',
      '所选品牌与产品所属品牌不同，请核对后重新选择。',
    );
  if (input.includeProductImages && !product)
    throw new AppError(400, 'PRODUCT_REQUIRED', '使用产品图片前请先选择产品。');
  const brandId = input.brandId || product?.brandId;
  if (brandId) {
    const brand = core.brands.get(actor, wid, brandId);
    const content = `${brand.name}\n${brand.description}\n品牌配色：${brand.colors.join('、')}\n品牌字体：${brand.fonts.join('、')}`;
    sourceTexts.push({ id: 'brand', text: content });
    contextSources.push({
      kind: 'brand',
      id: brand.id,
      label: brand.name,
      updatedAt: brand.updatedAt,
      content,
    });
    // A product association supplies brand guidance. Images remain an explicit choice:
    // the existing brand picker keeps its established reference-image behavior.
    if (input.brandId) referenceAssetIds.push(...brand.referenceAssetIds);
  }
  if (product) {
    const content = [
      `产品：${product.name}`,
      product.description,
      `产品事实（用户提供）：\n${product.facts.join('\n')}`,
      `使用限制与禁用表述：\n${product.cautions.join('\n')}`,
    ].join('\n');
    sourceTexts.push({ id: `product:${product.id}:v${product.version}`, text: content });
    contextSources.push({
      kind: 'product',
      id: product.id,
      label: product.name,
      version: product.version,
      updatedAt: product.updatedAt,
      expiresAt: product.validUntil,
      content,
    });
    if (input.includeProductImages) referenceAssetIds.push(...product.referenceAssetIds);
  }
  let memoryContext: CreativeIntentRequest['memoryContext'];
  if (input.useMemory === true) {
    const resolved = core.knowledge.resolveMemories(
      actor,
      wid,
      input.operation === 'video.generate' ? 'video' : 'image',
    );
    memoryContext = {
      items: resolved.items.map((item) => ({
        id: item.id,
        topic: item.topic,
        kind: item.kind,
        content: item.content,
        version: item.version,
        updatedAt: item.updatedAt,
        weight: item.effectiveWeight,
        confirmedAt: item.confirmedAt,
        expiresAt: item.expiresAt,
        halfLifeDays: item.halfLifeDays,
      })),
      omitted: resolved.omitted,
    };
    contextSources.push(
      ...resolved.items.map((item) => ({
        kind: 'memory' as const,
        id: item.id,
        label: item.topic,
        version: item.version,
        updatedAt: item.updatedAt,
        expiresAt: item.expiresAt,
        content: item.content,
      })),
    );
  }
  return {
    sourceTexts,
    contextSources,
    referenceAssetIds: [...new Set(referenceAssetIds)],
    memoryContext,
  };
}

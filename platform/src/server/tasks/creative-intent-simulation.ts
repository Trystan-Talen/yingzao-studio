import type { CreativeIntentRequest, CreativeIntentResult } from '../../contracts/creative-intent';

/** Deterministic fixture for explicit DEMO_MODE only; never a production model fallback. */
export function simulateCreativeIntent(request: CreativeIntentRequest): CreativeIntentResult {
  const missing =
    /^(帮我)?(做|生成)?(个|一张|一个)?(高级一点|好看点|好看的图|图片|视频)[。！!\s]*$/.test(
      request.rawPrompt,
    ) &&
    !request.materials.length &&
    !request.answers.length;
  const subject = request.answers.at(-1)?.answer || request.rawPrompt;
  const product = ['main-image', 'secondary-image', 'detail-image', 'product-video'].includes(
    request.context.placement,
  );
  const reference =
    product &&
    request.context.supportsReference &&
    request.materials.some(
      (material) => material.kind === 'image' && ['reference', 'input'].includes(material.role),
    );
  // Quote the supplied text instead of pretending this deterministic fixture understood it.
  // Reserve room for every answer within the existing 800-character summary contract.
  const excerptLimit = Math.floor(720 / (request.answers.length + 1));
  const excerpt = (value: string) =>
    value.length <= excerptLimit
      ? value
      : `${value.slice(0, excerptLimit - 1).replace(/[\uD800-\uDBFF]$/u, '')}…`;
  const summary = [
    `【本机模拟】原话：${excerpt(request.rawPrompt)}`,
    ...request.answers.map((answer, index) => `补充${index + 1}：${excerpt(answer.answer)}`),
  ].join('\n');
  return {
    type: 'intent-plan',
    version: 1,
    requestId: request.requestId,
    status: missing ? 'needs_clarification' : 'ready',
    brief: {
      scope: product ? 'product' : 'general',
      subject: missing ? '' : subject.slice(0, 300),
      goal: '按用户描述创作',
      mediaType: request.context.mediaType,
      platform: request.context.platform,
      market: request.context.market,
      placement: request.context.placement,
      productMode: product ? (reference ? 'reference' : 'concept') : 'not-applicable',
      facts: [],
      constraints: [],
    },
    summary: missing ? '还需要确定画面主体。' : summary,
    assumptions: [],
    questions: missing
      ? [
          {
            id: 'subject',
            field: 'subject',
            question: '画面里主要展示什么？',
            reason: '主体决定实际画面内容。',
            options: [],
          },
        ]
      : [],
    prompt: missing
      ? ''
      : [request.rawPrompt, ...request.answers.map((a) => a.answer)].join('\n').slice(0, 5000),
    reviewChecklist: ['检查画面主体与需求一致', '检查画面清晰且没有意外裁切'],
  };
}

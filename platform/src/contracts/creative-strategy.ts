import type { CreativePlacement } from './creative-intent';

export const CREATIVE_STRATEGY_VERSION = '2026-11-03.2';
export type CreativePlatform =
  'generic' | 'amazon' | 'tiktok' | 'taobao' | 'xiaohongshu' | 'douyin';
type MediaType = 'image' | 'video';

export interface CreativeSource {
  title: string;
  url: string;
  checkedAt: string;
  scope: {
    markets: readonly string[];
    placements: readonly CreativePlacement[];
    note: string;
  };
}

export type ArtifactConstraint =
  | { kind: 'aspect-ratios'; values: readonly (readonly [number, number])[] }
  | { kind: 'duration-ms'; min: number; max: number }
  | { kind: 'short-edge'; min: number }
  | { kind: 'long-edge'; min: number; max: number }
  | { kind: 'mime-types'; values: readonly string[] };

export interface CreativeRequirement {
  id: string;
  text: string;
  source: CreativeSource;
  /** No constraint means visual/content review is required, not an automatic pass. */
  constraint?: ArtifactConstraint;
}
export interface CreativeRecommendation {
  id: string;
  text: string;
  /** Omitted for our own creative suggestions, which are never platform requirements. */
  source?: CreativeSource;
}
export interface CreativeStrategy {
  id: string;
  version: string;
  platform: CreativePlatform;
  placement: CreativePlacement;
  market?: string;
  mediaType?: MediaType;
  requirements: CreativeRequirement[];
  recommendations: CreativeRecommendation[];
  unknowns: string[];
}
export interface CreativeStrategyContext {
  platform: string;
  placement: CreativePlacement;
  market?: string;
  mediaType?: MediaType;
}

const platformNames: Record<CreativePlatform, string> = {
  generic: '通用',
  amazon: 'Amazon（亚马逊）',
  tiktok: 'TikTok（海外短视频平台）',
  taobao: '淘宝',
  xiaohongshu: '小红书',
  douyin: '抖音',
};
const placementNames: Record<CreativePlacement, string> = {
  general: '通用创意',
  'main-image': '商品首图',
  'secondary-image': '商品副图',
  'detail-image': '商品详情图',
  'product-video': '商品主图视频',
  'social-image': '内容图片或笔记',
  'social-video': '内容短视频',
  'ad-image': '付费图片广告',
  'ad-video': '付费视频广告',
};
const aliases: Record<string, CreativePlatform> = {
  generic: 'generic',
  通用: 'generic',
  通用电商: 'generic',
  amazon: 'amazon',
  亚马逊: 'amazon',
  tiktok: 'tiktok',
  'tiktok shop': 'tiktok',
  国际版抖音: 'tiktok',
  海外短视频平台: 'tiktok',
  taobao: 'taobao',
  淘宝: 'taobao',
  xiaohongshu: 'xiaohongshu',
  小红书: 'xiaohongshu',
  douyin: 'douyin',
  抖音: 'douyin',
  抖店: 'douyin',
};
const productImages: CreativePlacement[] = ['main-image', 'secondary-image'];
const productPlacements: CreativePlacement[] = [...productImages, 'detail-image', 'product-video'];
const sources = {
  amazonImages: {
    title: '亚马逊官方管理员：商品图片要求',
    url: 'https://sellercentral.amazon.com/seller-forums/discussions/t/4b3c4c39-6f8c-4312-aa0e-99982eb8f5e1',
    checkedAt: '2026-11-03',
    scope: {
      markets: ['US'],
      placements: productImages,
      note: '美国站商品图片；不含品牌详情模块和广告版位。',
    },
  },
  amazonMain: {
    title: '亚马逊商品图片要求',
    url: 'https://sellercentral.amazon.com/gp/help/external/G1881?language=en_US',
    checkedAt: '2026-11-03',
    scope: {
      markets: ['US'],
      placements: ['main-image'],
      note: '美国站主图通则，具体品类例外需另核。',
    },
  },
  tiktokShop: {
    title: 'TikTok Shop（海外短视频平台商城）美国商品发布政策，2026-09-01',
    url: 'https://seller-us.tiktok.com/university/essay?knowledge_id=3196690250417921&role=1',
    checkedAt: '2026-11-03',
    scope: {
      markets: ['US'],
      placements: productImages,
      note: '仅美国商城商品图片，不能套用于内容短视频或付费广告。',
    },
  },
  tiktokAds: {
    title: 'TikTok（海外短视频平台）效果广告创作建议，2025-06',
    url: 'https://ads.tiktok.com/resources/help/article/creative-best-practices',
    checkedAt: '2026-11-03',
    scope: {
      markets: [],
      placements: ['ad-video'],
      note: '跨市场的创作建议；不提供具体广告版位的上传限制。',
    },
  },
  douyinVideo: {
    title: '抖店商品主图视频创建指南，2025-12-19',
    url: 'https://school.jinritemai.com/doudian/web/articlev0/113410',
    checkedAt: '2026-11-03',
    scope: {
      markets: ['CN'],
      placements: ['product-video'],
      note: '中国站商品详情页主图视频，不是信息流广告或内容短视频。',
    },
  },
  xiaohongshuNotes: {
    title: '小红书电商学习中心：优质商品笔记条件',
    url: 'https://school.xiaohongshu.com/lesson/normal/af0fe7e97bb0433fac9da5d1df52b07f',
    checkedAt: '2026-11-03',
    scope: {
      markets: ['CN'],
      placements: ['social-image', 'social-video'],
      note: '商品笔记教学建议；不是店铺主图规则，不能强制用于非商品创意。',
    },
  },
  xiaohongshuQuality: {
    title: '小红书商品描述及质量管理总则修订公告，2026-01-03 生效',
    url: 'https://school.xiaohongshu.com/rule/detail/10130',
    checkedAt: '2026-11-03',
    scope: {
      markets: ['CN'],
      placements: productPlacements,
      note: '中国站商品描述与实际交付一致性；具体品类另有规定。',
    },
  },
  taobaoUpload: {
    title: '淘宝商品素材上传规则调整公告，2025-06-03',
    url: 'https://developer.alibaba.com/support/announcementDetail.htm?id=25787&source=search',
    checkedAt: '2026-11-03',
    scope: {
      markets: ['CN'],
      placements: [...productImages, 'detail-image'],
      note: '素材上传层建议，不能替代主图、详情图、类目或广告位规范。',
    },
  },
} satisfies Record<string, CreativeSource>;

const placementAdvice: Record<CreativePlacement, string> = {
  general: '保留用户明确的主体、场景、媒介和风格；未提出营销目标时不添加营销内容。',
  'main-image': '优先让买家识别完整商品及实际售卖内容；背景、叠字和道具按对应平台与品类要求决定。',
  'secondary-image': '补充不同角度、材质、尺寸和使用细节；每张承担不同信息任务，保留同一商品身份。',
  'detail-image':
    '按用户已提供的事实组织说明顺序，每屏回答一个购买问题；未提供的参数、功效和认证不补写。',
  'product-video': '用商品全貌、细节与使用演示辅助购买决策；镜头顺序和节奏随商品特点调整。',
  'social-image': '让封面主题清楚，组图顺序连贯；视觉风格随主题、人群和用户偏好调整。',
  'social-video': '让开头便于理解主题，再展开场景、过程或故事；不固定套用夸张节奏或营销结构。',
  'ad-image':
    '围绕一个明确传播目标组织主体和信息层级；风格、文案密度与行动提示随受众和广告版位调整。',
  'ad-video':
    '围绕一个传播目标安排开头、核心信息和结尾；演示、讲解或故事结构均可，随受众测试调整。',
};

// Application-authored creative options, not claimed platform rules or ranking advice.
// Keep these useful before a placement is selected, without borrowing ad/listing restrictions.
const platformAdvice: Record<
  Exclude<CreativePlatform, 'generic'>,
  Record<MediaType, readonly string[]>
> = {
  amazon: {
    image: [
      '可采用克制的布局与一致光线，让主体轮廓和细节易于辨认。',
      '多图可让各张承担不同观察重点，减少重复构图；单幅按用户主题组织。',
    ],
    video: [
      '可用稳定景别逐步展示重点，镜头之间保持主体尺度与光线连贯。',
      '内容可从整体观察推进到局部，先让重要动作和细节看得清楚，再调整镜头变化。',
    ],
  },
  tiktok: {
    image: [
      '可用鲜明的视觉焦点和有连续感的图组顺序表达一个主题。',
      '适合叙事时可让首张点明场景，后续承接过程；单图保留清楚的主体关系。',
    ],
    video: [
      '可从一个易理解的场景或动作进入，采用贴近观察者视角的连贯镜头。',
      '表现可自然、轻快或安静，按用户情绪目标调整；动作和变化要便于跟随。',
    ],
  },
  taobao: {
    image: [
      '可用清楚主次区分全貌与细节，图组之间保持一致色调和尺度。',
      '需要说明时可按观看顺序组织信息；单幅创意以主体完整与画面层级为先。',
    ],
    video: [
      '可按全貌、重点细节和场景动作组织一段连贯展示。',
      '镜头切换围绕同一主题，给需要辨认的细节足够停留时间。',
    ],
  },
  xiaohongshu: {
    image: [
      '可从有氛围的场景与具体细节展开主题，让封面与内页在色调上呼应。',
      '适合图文时可安排一张总览配细节画面；无文字需求时用构图表达。',
    ],
    video: [
      '可按观察、过程或体验组织连贯镜头，保留自然光线与可读细节。',
      '可用统一场景和色调建立日常叙事；幻想、纪实或其他已选风格按用户方向表现。',
    ],
  },
  douyin: {
    image: [
      '可让主体和一个视觉焦点先被看清，再用配景补充情境。',
      '多图可用起始画面、过程细节与收束画面形成短序列；单图保持信息集中。',
    ],
    video: [
      '可用清楚动作或变化开启画面，再展开一个易理解的小情节。',
      '节奏随主题调整：演示保留关键动作，宁静题材可用连续慢镜头。',
    ],
  },
};

function placementMedia(placement: CreativePlacement): MediaType | undefined {
  if (placement.endsWith('-image')) return 'image';
  if (placement.endsWith('-video')) return 'video';
  return undefined;
}

/** Unknown legacy platform labels remain usable; no market-specific policy leaks into fallback. */
export function resolveCreativeStrategy(context: CreativeStrategyContext): CreativeStrategy {
  const rawPlatform = context.platform.trim();
  const platform = Object.hasOwn(aliases, rawPlatform.toLowerCase())
    ? aliases[rawPlatform.toLowerCase()]!
    : 'generic';
  const domestic = ['taobao', 'xiaohongshu', 'douyin'].includes(platform);
  const market = context.market?.trim().toUpperCase() || (domestic ? 'CN' : undefined);
  const strategy: CreativeStrategy = {
    id: `creative:${platform}:${context.placement}:${encodeURIComponent(market ?? 'unspecified')}:${context.mediaType ?? 'unspecified'}`,
    version: CREATIVE_STRATEGY_VERSION,
    platform,
    placement: context.placement,
    ...(market ? { market } : {}),
    ...(context.mediaType ? { mediaType: context.mediaType } : {}),
    requirements: [],
    recommendations: [{ id: 'placement-direction', text: placementAdvice[context.placement] }],
    unknowns: [],
  };
  const expectedMedia = placementMedia(context.placement);
  const mediaType = context.mediaType ?? expectedMedia;
  if (platform !== 'generic' && mediaType)
    strategy.recommendations.push(
      ...platformAdvice[platform][mediaType].map((text, index) => ({
        id: `platform-${platform}-${mediaType}-${index + 1}`,
        text,
      })),
    );
  if (expectedMedia && context.mediaType && expectedMedia !== context.mediaType)
    strategy.unknowns.push('当前图片或视频入口与所选用途不一致，请先核对交付类型。');
  if (!Object.hasOwn(aliases, rawPlatform.toLowerCase()) && rawPlatform)
    strategy.unknowns.push(
      `尚未核验平台 ${JSON.stringify(rawPlatform)} 的专属规则，保留原选择并使用通用用途建议。`,
    );

  // Base creative options remain; free creativity never inherits product or upload restrictions.
  if (context.placement === 'general') return strategy;

  const applies = (source: CreativeSource) =>
    source.scope.placements.includes(context.placement) &&
    (!source.scope.markets.length || (!!market && source.scope.markets.includes(market)));
  const require = (
    id: string,
    text: string,
    source: CreativeSource,
    constraint?: ArtifactConstraint,
  ) => {
    if (applies(source))
      strategy.requirements.push({ id, text, source, ...(constraint ? { constraint } : {}) });
  };
  const recommend = (id: string, text: string, source?: CreativeSource) => {
    if (!source || applies(source))
      strategy.recommendations.push({ id, text, ...(source ? { source } : {}) });
  };
  if (platform === 'amazon') {
    require('amazon-image-long-edge', '商品图片最长边须为 500–10,000 像素。', sources.amazonImages, {
      kind: 'long-edge',
      min: 500,
      max: 10000,
    });
    require('amazon-main-presentation', '主图通则要求纯白背景、完整真实商品，不添加叠字或水印；商品占图约 85%，具体品类例外仍需核对。', sources.amazonMain);
    recommend(
      'amazon-image-clarity',
      '可优先使用最长边超过 1,000 像素的清晰图片，便于放大查看；这是建议，不替代上传限制。',
      sources.amazonImages,
    );
    if (market !== 'US')
      strategy.unknowns.push('尚未核验所选亚马逊市场的规则；未自动应用美国站要求。');
    strategy.unknowns.push(
      '具体品类、品牌详情模块及广告版位规则尚未核实；商品视频时长与大小也不从旧资料推定。',
    );
  } else if (platform === 'tiktok') {
    require('tiktok-shop-square', '美国商城商品图片须为方图。', sources.tiktokShop, {
      kind: 'aspect-ratios',
      values: [[1, 1]],
    });
    require('tiktok-shop-min-size', '美国商城商品图片每边至少 600 像素。', sources.tiktokShop, {
      kind: 'short-edge',
      min: 600,
    });
    require('tiktok-shop-real-product', '图片须准确展示买家收到的实物与颜色；不能用占位图或商品数字渲染冒充实物，生成或编辑内容的可用性须人工核验。', sources.tiktokShop);
    require('tiktok-shop-no-overlays', '商品图片不可添加文字、标志、水印、边框或覆盖商品及背景的图形；保留实物自身标识。', sources.tiktokShop);
    if (context.placement === 'main-image')
      require('tiktok-shop-main', '首图须呈现商品实物正面，使用纯白背景。', sources.tiktokShop);
    recommend(
      'tiktok-ad-structure',
      '视频广告可从 9:16 竖屏、自然演示与清晰的开头尝试；前三秒说明内容价值，再展开要点与行动提示。它们是可调整的创作建议。',
      sources.tiktokAds,
    );
    if (productPlacements.includes(context.placement) && market !== 'US')
      strategy.unknowns.push('尚未核验所选商城市场的商品素材规则；未自动应用美国站要求。');
    strategy.unknowns.push(
      '内容发布、商品详情模块和不同付费广告版位的完整上传规格未核实；商城图片规则不适用于这些位置。',
    );
  } else if (platform === 'douyin') {
    require('douyin-product-video-duration', '商品主图视频时长须为 5–60 秒。', sources.douyinVideo, {
      kind: 'duration-ms',
      min: 5000,
      max: 60000,
    });
    require('douyin-product-video-format', '商品主图视频仅支持 MP4（视频文件格式）。', sources.douyinVideo, {
      kind: 'mime-types',
      values: ['video/mp4'],
    });
    require('douyin-product-video-ratio', '商品主图视频支持 1:1、3:4 或 9:16。', sources.douyinVideo, {
      kind: 'aspect-ratios',
      values: [
        [1, 1],
        [3, 4],
        [9, 16],
      ],
    });
    require('douyin-product-video-resolution', '商品主图视频清晰度至少为 720p（高清分辨率）。', sources.douyinVideo, {
      kind: 'short-edge',
      min: 720,
    });
    require('douyin-product-video-size', '商品主图视频大小须在官方所述 100M（大小单位沿用原文）以内；单位边界以发布后台为准。', sources.douyinVideo);
    require('douyin-product-video-content', '核对商品与详情页一致、全貌可见、人物与商品无畸变、字幕无遮挡截断，且无第三方软件水印或二维码。', sources.douyinVideo);
    recommend(
      'douyin-product-video-direction',
      '建议控制在 30 秒内，尽早展示商品，以全貌、关键细节和演示帮助购买决策；封面取商品第一张主图。',
      sources.douyinVideo,
    );
    if (context.placement !== 'product-video')
      strategy.unknowns.push(
        '所选用途的现行完整规格未核实；不套用商品主图视频的时长、格式与画幅规则。',
      );
    else
      strategy.unknowns.push(
        '官方大小单位未说明字节换算，暂不自动判定文件大小通过；具体品类内容要求仍需核对。',
      );
  } else if (platform === 'xiaohongshu') {
    require('xiaohongshu-product-truth', '商品图片、文案及视频描述须与实际交付一致，不能遗漏或误导关键商品信息。', sources.xiaohongshuQuality);
    recommend(
      'xiaohongshu-product-note',
      '若制作商品笔记，可尝试真实使用场景和多角度展示；不把生活场景当作全部主题的唯一风格。',
      sources.xiaohongshuNotes,
    );
    if (context.placement === 'social-image')
      recommend(
        'xiaohongshu-note-ratio',
        '商品图文笔记可优先尝试 3:4、同组一致画幅与清晰封面；属于教学建议，不是统一上传硬规则。',
        sources.xiaohongshuNotes,
      );
    strategy.unknowns.push(
      '当前完整上传尺寸、时长与主图数量尚未核实；已失效的旧商品发布规范不用于校验。',
    );
  } else if (platform === 'taobao') {
    recommend(
      'taobao-upload-quality',
      '保留高质量原图；素材上传公告建议宽度 1,440 像素，但具体主图和详情位置仍按对应要求制作。',
      sources.taobaoUpload,
    );
    strategy.unknowns.push(
      '已核验的素材上传公告不是具体位置的完整规则；现行主图、详情图及视频规格仍需核对，未将旧视频数值写为限制。',
    );
  } else {
    strategy.unknowns.push('通用策略不提供平台审核结论；发布位置的硬性规格尚未选择或未核实。');
  }
  if (domestic && market !== 'CN')
    strategy.unknowns.push('当前来源仅适用于中国市场，未应用到所选其他市场。');
  // Return an isolated snapshot so callers cannot mutate source evidence for later requests.
  return structuredClone(strategy);
}

export function compileCreativeGuidance(
  strategy: CreativeStrategy,
  options: { includeSources?: boolean } = {},
): string {
  // The audit snapshot retains citations; execution prompts need only actionable guidance.
  const citation = (source?: CreativeSource) =>
    source && options.includeSources !== false
      ? `〔${source.title}；核查 ${source.checkedAt}；${source.url}〕`
      : '';
  const market =
    strategy.market === 'CN'
      ? 'CN（中国）'
      : strategy.market === 'US'
        ? 'US（美国）'
        : (strategy.market ?? '未指定');
  const lines = [
    `创作用途：${platformNames[strategy.platform]}；${placementNames[strategy.placement]}；适用市场：${market}。`,
    `策略版本：${strategy.version}。`,
  ];
  if (strategy.recommendations.some((item) => item.id.startsWith('platform-')))
    lines.push(
      '平台基础建议由本应用提供，可调整；用户明确的风格、主体和限制优先，不增加营销目标或追问。',
    );
  if (strategy.placement === 'general') {
    lines.push(...strategy.recommendations.map((item) => `本应用创作建议（可调整）：${item.text}`));
  } else {
    lines.push('以下建议可调整；不得据此改写用户已确认事实或擅自更改风格。');
    lines.push(
      ...strategy.requirements.map(
        (item) =>
          `适用要求${item.constraint ? '（可检查文件规格）' : '（需人工核对）'}：${item.text}${citation(item.source)}`,
      ),
    );
    lines.push(
      ...strategy.recommendations.map(
        (item) =>
          `${item.source ? '官方创作建议' : '本应用创作建议（可调整）'}：${item.text}${citation(item.source)}`,
      ),
    );
    lines.push('文件规格检查不能证明实物外观、文案真实性、画面内容或平台审核已通过。');
  }
  lines.push(...strategy.unknowns.map((item) => `尚未核实：${item}`));
  return lines.join('\n');
}

/** Supply decoded final-file metadata, never requested generation settings. Compatible with AssetDto. */
export interface CreativeArtifact {
  kind?: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  byteSize?: number | null;
}
export interface CreativeArtifactCheck {
  id: string;
  status: 'pass' | 'fail' | 'unknown';
  method: 'metadata' | 'manual';
  message: string;
  source?: CreativeSource;
}
export interface CreativeCheckResult {
  strategyId: string;
  strategyVersion: string;
  /** "checked" means only the listed checks passed; it is never platform approval. */
  status: 'checked' | 'failed' | 'incomplete' | 'not-assessed';
  checks: CreativeArtifactCheck[];
  unknowns: string[];
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function evaluateConstraint(
  constraint: ArtifactConstraint,
  artifact: CreativeArtifact,
): boolean | undefined {
  if (constraint.kind === 'mime-types') {
    const mime = artifact.mimeType?.split(';')[0]?.trim().toLowerCase();
    return mime ? constraint.values.includes(mime) : undefined;
  }
  if (constraint.kind === 'duration-ms') {
    if (
      typeof artifact.durationMs !== 'number' ||
      !Number.isFinite(artifact.durationMs) ||
      artifact.durationMs < 0
    )
      return undefined;
    return artifact.durationMs >= constraint.min && artifact.durationMs <= constraint.max;
  }
  if (
    !positive(artifact.width) ||
    !positive(artifact.height) ||
    !Number.isInteger(artifact.width) ||
    !Number.isInteger(artifact.height)
  )
    return undefined;
  if (constraint.kind === 'short-edge')
    return Math.min(artifact.width, artifact.height) >= constraint.min;
  if (constraint.kind === 'long-edge') {
    const edge = Math.max(artifact.width, artifact.height);
    return edge >= constraint.min && edge <= constraint.max;
  }
  const { width, height } = artifact;
  // Permit at most one raster pixel of aspect-ratio rounding, not a percentage crop tolerance.
  return constraint.values.some(([w, h]) =>
    w === h ? width === height : Math.abs(width * h - height * w) <= Math.max(w, h),
  );
}

export function evaluateCreativeArtifact(
  strategy: CreativeStrategy,
  artifact: CreativeArtifact,
): CreativeCheckResult {
  const expectedMedia = placementMedia(strategy.placement) ?? strategy.mediaType;
  const checks: CreativeArtifactCheck[] = [];
  const mediaMatches = expectedMedia ? artifact.kind === expectedMedia : true;
  if (expectedMedia)
    checks.push({
      id: 'artifact-media-type',
      status: !artifact.kind ? 'unknown' : mediaMatches ? 'pass' : 'fail',
      method: 'metadata',
      message: `成品类型应为${expectedMedia === 'image' ? '图片' : '视频'}。`,
    });
  for (const requirement of strategy.requirements) {
    const matches =
      requirement.constraint && mediaMatches
        ? evaluateConstraint(requirement.constraint, artifact)
        : undefined;
    checks.push({
      id: requirement.id,
      status: matches === undefined ? 'unknown' : matches ? 'pass' : 'fail',
      method: requirement.constraint ? 'metadata' : 'manual',
      message: `${requirement.text}${matches === undefined ? (requirement.constraint ? ' 未取得适用的有效成品元数据。' : ' 需要人工核对成品，尚未验证。') : ''}`,
      source: structuredClone(requirement.source),
    });
  }
  return {
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    status: checks.some((item) => item.status === 'fail')
      ? 'failed'
      : !strategy.requirements.length
        ? 'not-assessed'
        : checks.some((item) => item.status === 'unknown') || strategy.unknowns.length
          ? 'incomplete'
          : 'checked',
    checks,
    unknowns: [...strategy.unknowns],
  };
}

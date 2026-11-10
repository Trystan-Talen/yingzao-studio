import { describe, expect, it } from 'vitest';
import { CREATIVE_PLACEMENTS } from '../src/contracts/creative-intent';
import {
  compileCreativeGuidance,
  evaluateCreativeArtifact,
  resolveCreativeStrategy,
  type CreativeArtifact,
  type CreativeStrategy,
} from '../src/contracts/creative-strategy';

const video: CreativeArtifact = {
  kind: 'video',
  mimeType: 'video/mp4',
  width: 720,
  height: 1280,
  durationMs: 5000,
  byteSize: 12_000_000,
};
const image: CreativeArtifact = {
  kind: 'image',
  mimeType: 'image/png',
  width: 800,
  height: 800,
  byteSize: 80_000,
};
const douyin = () =>
  resolveCreativeStrategy({ platform: '抖音', placement: 'product-video', mediaType: 'video' });
const check = (strategy: CreativeStrategy, artifact: CreativeArtifact, id: string) =>
  evaluateCreativeArtifact(strategy, artifact).checks.find((item) => item.id === id);

describe('platform strategies and scoped evidence', () => {
  it.each([
    ['Amazon', 'image', '克制的布局'],
    ['Amazon', 'video', '稳定景别'],
    ['TikTok', 'image', '连续感的图组'],
    ['TikTok', 'video', '贴近观察者视角'],
    ['淘宝', 'image', '区分全貌与细节'],
    ['淘宝', 'video', '场景动作'],
    ['小红书', 'image', '封面与内页'],
    ['小红书', 'video', '观察、过程或体验'],
    ['抖音', 'image', '一个视觉焦点'],
    ['抖音', 'video', '宁静题材'],
  ] as const)(
    'provides adjustable %s/%s guidance without a selected placement',
    (platform, mediaType, expected) => {
      const strategy = resolveCreativeStrategy({
        platform,
        mediaType,
        placement: 'general',
        market: 'US',
      });
      const guidance = compileCreativeGuidance(strategy);
      expect(strategy.version).toBe('2026-11-03.2');
      expect(strategy.recommendations).toHaveLength(3);
      expect(strategy.recommendations.every((item) => !item.source)).toBe(true);
      expect(guidance).toContain(expected);
      expect(guidance).toContain('本应用创作建议（可调整）');
      expect(guidance).toContain('用户明确的风格、主体和限制优先');
      expect(guidance).toContain('不增加营销目标或追问');
      expect(guidance).not.toMatch(
        /官方创作建议|适用要求|白底|纯白|商品|实物|购买|促销|认证|行动提示|CTA|9:16|600|720|10000/,
      );
      expect(strategy.requirements).toEqual([]);
      expect(evaluateCreativeArtifact(strategy, mediaType === 'image' ? image : video).status).toBe(
        'not-assessed',
      );
    },
  );

  it('keeps an unselected platform generic and preserves an older frozen version', () => {
    const generic = resolveCreativeStrategy({
      platform: '通用电商',
      placement: 'general',
      mediaType: 'image',
    });
    expect(generic.recommendations).toHaveLength(1);
    const frozen = { ...generic, version: '2026-11-03.1' };
    expect(compileCreativeGuidance(frozen)).toContain('2026-11-03.1');
    expect(evaluateCreativeArtifact(frozen, image).strategyVersion).toBe('2026-11-03.1');
  });

  it.each([
    ['通用电商', 'generic'],
    ['AMAZON', 'amazon'],
    ['TikTok', 'tiktok'],
    ['淘宝', 'taobao'],
    ['小红书', 'xiaohongshu'],
    ['抖音', 'douyin'],
  ])('resolves the supported label %s', (platform, expected) => {
    expect(resolveCreativeStrategy({ platform, placement: 'general' }).platform).toBe(expected);
  });

  it.each(['Shopify', '京东', 'constructor', '__proto__'])(
    'keeps legacy platform %s usable without borrowed requirements',
    (platform) => {
      const strategy = resolveCreativeStrategy({ platform, placement: 'main-image' });
      expect(strategy.platform).toBe('generic');
      expect(strategy.requirements).toEqual([]);
      expect(strategy.unknowns.join()).toContain(platform);
      expect(evaluateCreativeArtifact(strategy, image).status).toBe('not-assessed');
    },
  );

  it.each(['通用电商', 'Amazon', 'TikTok', '淘宝', '小红书', '抖音'])(
    'does not turn free creativity on %s into product marketing',
    (platform) => {
      const strategy = resolveCreativeStrategy({ platform, placement: 'general', market: 'US' });
      const guidance = compileCreativeGuidance(strategy);
      expect(strategy.requirements).toEqual([]);
      expect(guidance).not.toMatch(/白底|商品|购买|促销|实物|85%|600/);
      expect(guidance).toContain('保留用户明确的主体');
      expect(evaluateCreativeArtifact(strategy, image).status).toBe('not-assessed');
    },
  );

  it('defaults domestic sites explicitly to CN but never silently selects US', () => {
    for (const platform of ['淘宝', '小红书', '抖音']) {
      const strategy = resolveCreativeStrategy({ platform, placement: 'main-image' });
      expect(strategy.market).toBe('CN');
      expect(compileCreativeGuidance(strategy)).toContain('CN（中国）');
    }
    for (const platform of ['Amazon', 'TikTok']) {
      const strategy = resolveCreativeStrategy({ platform, placement: 'main-image' });
      expect(strategy.market).toBeUndefined();
      expect(strategy.requirements).toEqual([]);
      expect(strategy.unknowns.join()).toContain('未自动应用美国站');
    }
  });

  it('applies US listing rules only to listing images in that market', () => {
    for (const platform of ['Amazon', 'TikTok']) {
      const us = resolveCreativeStrategy({ platform, placement: 'main-image', market: ' us ' });
      expect(us.requirements.length).toBeGreaterThan(0);
      for (const placement of [
        'detail-image',
        'social-image',
        'social-video',
        'ad-image',
        'ad-video',
      ] as const)
        expect(resolveCreativeStrategy({ platform, placement, market: 'US' }).requirements).toEqual(
          [],
        );
      expect(
        resolveCreativeStrategy({ platform, placement: 'main-image', market: 'GB' }).requirements,
      ).toEqual([]);
    }
    expect(
      resolveCreativeStrategy({ platform: '抖音', placement: 'product-video', market: 'US' })
        .requirements,
    ).toEqual([]);
  });

  it('does not propagate a main-image white background rule to secondary images', () => {
    for (const platform of ['Amazon', 'TikTok']) {
      const secondary = resolveCreativeStrategy({
        platform,
        placement: 'secondary-image',
        market: 'US',
      });
      expect(secondary.requirements.map((item) => item.text).join()).not.toContain('纯白');
    }
  });

  it('keeps creative ratios and upload-layer recommendations out of hard rules', () => {
    const note = resolveCreativeStrategy({ platform: '小红书', placement: 'social-image' });
    expect(note.recommendations.map((item) => item.text).join()).toContain('3:4');
    expect(evaluateCreativeArtifact(note, { ...image, width: 900, height: 1600 }).status).toBe(
      'not-assessed',
    );
    const taobao = resolveCreativeStrategy({ platform: '淘宝', placement: 'main-image' });
    expect(taobao.recommendations.map((item) => item.text).join()).toContain('1,440');
    expect(taobao.requirements).toEqual([]);
    const ad = resolveCreativeStrategy({ platform: 'TikTok', placement: 'ad-video' });
    expect(ad.recommendations.map((item) => item.text).join()).toContain('9:16');
    expect(evaluateCreativeArtifact(ad, { ...video, width: 1280, height: 720 }).status).toBe(
      'not-assessed',
    );
  });

  it('retains official sources, dates and matching scope for every active requirement', () => {
    for (const platform of ['Amazon', 'TikTok', '淘宝', '小红书', '抖音']) {
      for (const placement of CREATIVE_PLACEMENTS) {
        const market = ['Amazon', 'TikTok'].includes(platform) ? 'US' : 'CN';
        const strategy = resolveCreativeStrategy({ platform, placement, market });
        for (const requirement of strategy.requirements) {
          expect(requirement.source.url).toMatch(/^https:\/\//);
          expect(requirement.source.checkedAt).toBe('2026-11-03');
          expect(requirement.source.scope.markets).toContain(market);
          expect(requirement.source.scope.placements).toContain(placement);
          expect(requirement.source.url).not.toContain('/1327');
        }
      }
    }
  });

  it('returns independent evidence snapshots and stable guidance', () => {
    const first = douyin();
    const original = compileCreativeGuidance(first);
    first.requirements[0]!.source.url = 'https://invalid.example/';
    first.requirements[0]!.text = 'changed';
    expect(compileCreativeGuidance(douyin())).toBe(original);
    expect(original).toContain('可检查文件规格');
    expect(original).toContain('需人工核对');
    expect(original).toContain('官方创作建议');
    expect(original).toContain('尚未核实');
    expect(original).toContain('不得据此改写用户已确认事实');
  });
});

describe('checks of decoded final artifacts', () => {
  it.each([
    [0, 'fail'],
    [4999, 'fail'],
    [5000, 'pass'],
    [60000, 'pass'],
    [60001, 'fail'],
    [null, 'unknown'],
    [Number.NaN, 'unknown'],
    [Number.POSITIVE_INFINITY, 'unknown'],
  ])('checks the product-video duration %s at its documented boundary', (durationMs, expected) => {
    expect(check(douyin(), { ...video, durationMs }, 'douyin-product-video-duration')?.status).toBe(
      expected,
    );
  });

  it('checks the real frame geometry, container and resolution independently', () => {
    const strategy = douyin();
    expect(
      check(strategy, { ...video, width: 1280, height: 720 }, 'douyin-product-video-ratio')?.status,
    ).toBe('fail');
    expect(
      check(strategy, { ...video, width: 540, height: 960 }, 'douyin-product-video-resolution')
        ?.status,
    ).toBe('fail');
    expect(
      check(strategy, { ...video, mimeType: 'video/webm' }, 'douyin-product-video-format')?.status,
    ).toBe('fail');
    expect(
      check(
        strategy,
        { ...video, mimeType: 'VIDEO/MP4; codecs=avc1' },
        'douyin-product-video-format',
      )?.status,
    ).toBe('pass');
    expect(check(strategy, { ...video, width: 721 }, 'douyin-product-video-ratio')?.status).toBe(
      'pass',
    );
    expect(check(strategy, { ...video, width: 730 }, 'douyin-product-video-ratio')?.status).toBe(
      'fail',
    );
  });

  it('does not use video limits for social or advertising videos', () => {
    for (const placement of ['social-video', 'ad-video'] as const) {
      const strategy = resolveCreativeStrategy({ platform: '抖音', placement });
      expect(strategy.requirements).toEqual([]);
      expect(evaluateCreativeArtifact(strategy, { ...video, durationMs: 90_000 }).status).toBe(
        'not-assessed',
      );
    }
  });

  it('keeps unknown or invalid metadata and visual review unresolved even when requested settings look correct', () => {
    const strategy = douyin();
    for (const width of [null, undefined, Number.NaN, -1, 720.5])
      expect(check(strategy, { ...video, width }, 'douyin-product-video-ratio')?.status).toBe(
        'unknown',
      );
    expect(evaluateCreativeArtifact(strategy, {}).status).toBe('incomplete');
    const finished = evaluateCreativeArtifact(strategy, video);
    expect(finished.status).toBe('incomplete');
    expect(
      finished.checks
        .filter((item) => item.method === 'manual')
        .every((item) => item.status === 'unknown'),
    ).toBe(true);
    expect(check(strategy, video, 'douyin-product-video-size')?.status).toBe('unknown');
  });

  it('rejects the wrong final media type and does not pass image geometry as video evidence', () => {
    const result = evaluateCreativeArtifact(douyin(), { ...image, durationMs: 5000 });
    expect(result.status).toBe('failed');
    expect(result.checks.find((item) => item.id === 'artifact-media-type')?.status).toBe('fail');
    expect(result.checks.find((item) => item.id === 'douyin-product-video-duration')?.status).toBe(
      'unknown',
    );
  });

  it('checks US listing dimensions without claiming that the photographed product is authentic', () => {
    const tiktok = resolveCreativeStrategy({
      platform: 'TikTok',
      placement: 'main-image',
      market: 'US',
    });
    expect(
      check(tiktok, { ...image, width: 599, height: 599 }, 'tiktok-shop-min-size')?.status,
    ).toBe('fail');
    expect(
      check(tiktok, { ...image, width: 600, height: 600 }, 'tiktok-shop-min-size')?.status,
    ).toBe('pass');
    expect(check(tiktok, image, 'tiktok-shop-real-product')?.status).toBe('unknown');
    expect(check(tiktok, { ...image, width: 800, height: 801 }, 'tiktok-shop-square')?.status).toBe(
      'fail',
    );
    expect(evaluateCreativeArtifact(tiktok, image).status).toBe('incomplete');
    const amazon = resolveCreativeStrategy({
      platform: 'Amazon',
      placement: 'secondary-image',
      market: 'US',
    });
    for (const [width, status] of [
      [499, 'fail'],
      [500, 'pass'],
      [10000, 'pass'],
      [10001, 'fail'],
    ] as const)
      expect(
        check(amazon, { ...image, width, height: 400 }, 'amazon-image-long-edge')?.status,
      ).toBe(status);
  });

  it('reports a conflicting media entry point without silently changing placement', () => {
    const strategy = resolveCreativeStrategy({
      platform: '抖音',
      placement: 'product-video',
      mediaType: 'image',
    });
    expect(strategy.placement).toBe('product-video');
    expect(strategy.unknowns.join()).toContain('入口与所选用途不一致');
    expect(evaluateCreativeArtifact(strategy, image).status).toBe('failed');
  });
});

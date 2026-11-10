import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CreativeQuality } from '../src/web/components/CreativeQuality';
import type { JobDto } from '../src/contracts/jobs';
import {
  evaluateCreativeArtifact,
  resolveCreativeStrategy,
  type CreativeCheckResult,
} from '../src/contracts/creative-strategy';

function render(result?: CreativeCheckResult) {
  const review: NonNullable<JobDto['creativeReview']> = {
    summary: '本次创作说明',
    assumptions: [],
    strategyId: 'strategy',
    strategyVersion: '1',
    artifacts: result ? [{ assetId: 'asset', name: '成品视频.mp4', result }] : [],
    visualChecks: [],
  };
  return renderToStaticMarkup(createElement(CreativeQuality, { review }));
}

it('does not announce a specification assessment when only the media type is known', () => {
  const strategy = resolveCreativeStrategy({
    platform: '通用电商',
    placement: 'general',
    mediaType: 'image',
  });
  const result = evaluateCreativeArtifact(strategy, { kind: 'image' });
  expect(result.status).toBe('not-assessed');
  const html = render(result);
  expect(html).toContain('<summary>创作依据与成品核对</summary>');
  expect(html).not.toContain('已核对所列成品规格');
});

it('shows unresolved file metadata, manual review and unknown rule scope next to known checks', () => {
  const strategy = resolveCreativeStrategy({ platform: '抖音', placement: 'product-video' });
  const result = evaluateCreativeArtifact(strategy, { kind: 'video', mimeType: 'video/mp4' });
  const html = render(result);
  expect(html).toContain('<summary>成品规格尚未完整核对</summary>');
  expect(html).toContain('尚未取得有效成品信息');
  expect(html).toContain('5–60 秒');
  expect(html).toContain('未取得适用的有效成品元数据');
  expect(html).toContain('适用规则尚未核实');
  expect(html).toContain('官方大小单位未说明字节换算');
  expect(html).toContain('画面内容尚需核对');
  expect(html).toContain('成品视频.mp4');
});

it('identifies the failed artifact and only reports checked status for an explicitly complete assessment', () => {
  const base: CreativeCheckResult = {
    strategyId: 'strategy',
    strategyVersion: '1',
    status: 'failed',
    unknowns: [],
    checks: [{ id: 'duration', status: 'fail', method: 'metadata', message: '时长超限' }],
  };
  expect(render(base)).toContain('需要调整 成品视频.mp4：时长超限');
  expect(render(base)).toContain('有 1 项规格需要调整');
  expect(
    render({ ...base, status: 'checked', checks: [{ ...base.checks[0]!, status: 'pass' }] }),
  ).toContain('<summary>已核对所列成品规格</summary>');
  expect(render()).toContain('<summary>创作依据与成品核对</summary>');
});

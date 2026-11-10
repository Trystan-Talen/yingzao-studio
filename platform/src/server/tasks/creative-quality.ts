import type { AssetDto } from '../../contracts/core';
import type { JobInput, JobDto } from '../../contracts/jobs';
import { creativeIntentResultSchema } from '../../contracts/creative-intent';
import { evaluateCreativeArtifact, type CreativeStrategy } from '../../contracts/creative-strategy';
import type { DatabaseContext } from '../db/connection';

/** Only examines persisted artifacts; requested settings never count as output evidence. */
export function creativeQuality(
  db: DatabaseContext,
  wid: string,
  input: JobInput,
  assets: AssetDto[],
): JobDto['creativeReview'] {
  if (!input.creativeBriefId) return undefined;
  const row = db.sqlite
    .prepare(
      'SELECT result_json,strategy_json FROM creative_briefs WHERE id=? AND workspace_id=? AND state=?',
    )
    .get(input.creativeBriefId, wid, 'ready') as
    { result_json: string; strategy_json: string } | undefined;
  if (!row?.result_json || !row.strategy_json) return undefined;
  const result = creativeIntentResultSchema.parse(JSON.parse(row.result_json));
  const strategy = JSON.parse(row.strategy_json) as CreativeStrategy;
  return {
    summary: result.summary,
    assumptions: result.assumptions,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    artifacts: assets.map((asset) => ({
      assetId: asset.id,
      name: asset.name,
      result: evaluateCreativeArtifact(strategy, asset),
    })),
    visualChecks: result.reviewChecklist,
  };
}

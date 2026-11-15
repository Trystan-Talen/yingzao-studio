import type { ModelCapability, OperationCapability } from '../../contracts/jobs';

/** Defaults are for untouched new drafts only; callers retain restored and edited values. */
export function newModelDefaults(
  model: ModelCapability,
  maxCount: number,
  kind: 'image' | 'video' = 'image',
) {
  const preferredRatio = kind === 'video' ? '16:9' : '1:1';
  const preferredResolution = kind === 'video' ? '720p' : '2K';
  return {
    ratio: model.ratios.includes(preferredRatio) ? preferredRatio : model.ratios[0],
    resolution: model.resolutions.includes(preferredResolution)
      ? preferredResolution
      : model.resolutions[0],
    duration: model.durations.includes(5) ? 5 : model.durations[0],
    count: Math.min(1, maxCount),
    referenceMode: model.id === 'kling-o1-first-last' ? 'first-last' : 'all',
    needText: model.textOverlay?.mode !== 'unsupported',
  };
}

export function resolveModelSelection(
  operations: OperationCapability[],
  operationKey: string,
  modelId: string,
) {
  const operation = operationKey
    ? operations.find((item) => `${item.id}:${item.providerId}` === operationKey)
    : (operations.find((item) => item.available) ?? operations[0]);
  const model = modelId
    ? operation?.models.find((item) => item.id === modelId)
    : operation?.models[0];
  return { operation, model };
}

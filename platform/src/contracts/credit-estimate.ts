import type { JobInput, OperationCapability } from './jobs';

export type CreditEstimate =
  | {
      status: 'ready';
      credits: number;
      units: number;
      outputs: number;
      unit: OperationCapability['unit'];
    }
  | { status: 'unknown'; reason: 'unavailable' | 'unsupported' | 'invalid-selection' };

/** Informational generation estimate only. Rates always come from server capabilities.
 * A payable quote still validates references, permissions, the frozen brief and current pricing.
 * Non-generation operations can depend on probed source duration or account entitlements;
 * do not approximate their price from the generation controls.
 */
export function estimateCreationCredits(
  input: JobInput,
  capability: OperationCapability | undefined,
): CreditEstimate {
  if (!capability?.available) return { status: 'unknown', reason: 'unavailable' };
  if (!['image.generate', 'video.generate'].includes(input.operation))
    return { status: 'unknown', reason: 'unsupported' };
  const invalid = (): CreditEstimate => ({ status: 'unknown', reason: 'invalid-selection' });
  if (
    capability.id !== input.operation ||
    capability.providerId !== input.providerId ||
    !Number.isSafeInteger(capability.priceCredits) ||
    capability.priceCredits < 0 ||
    !Number.isSafeInteger(capability.fixedCredits ?? 0) ||
    (capability.fixedCredits ?? 0) < 0 ||
    !['image', 'second', 'request'].includes(capability.unit)
  )
    return invalid();
  const { count, duration, designs, model: modelId, ratio, resolution } = input.options;
  const model = modelId
    ? capability.models.find((candidate) => candidate.id === modelId)
    : capability.models[0];
  if (
    !model ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > Math.min(20, capability.maxCount ?? 20) ||
    typeof ratio !== 'string' ||
    typeof resolution !== 'string' ||
    (model.ratios.length > 0 && !model.ratios.includes(ratio)) ||
    (model.resolutions.length > 0 &&
      !model.resolutions.some((allowed) => allowed.toLowerCase() === resolution.toLowerCase())) ||
    ((input.operation === 'video.generate' || capability.unit === 'second') &&
      (!Number.isSafeInteger(duration) ||
        duration < 2 ||
        duration > 60 ||
        (model.durations.length > 0 && !model.durations.includes(duration))))
  )
    return invalid();
  if (designs !== undefined && !Array.isArray(designs)) return invalid();
  if (
    designs?.length &&
    (input.operation !== 'image.generate' ||
      designs.length > 20 ||
      designs.some((design) => model.ratios.length > 0 && !model.ratios.includes(design.ratio)))
  )
    return invalid();
  // Each design produces count images. References guide one result; they are not extra outputs.
  const outputs =
    count * (input.operation === 'image.generate' ? Math.max(1, designs?.length ?? 0) : 1);
  const units = outputs * (capability.unit === 'second' ? duration : 1);
  const credits = units * capability.priceCredits + outputs * (capability.fixedCredits ?? 0);
  if (!Number.isSafeInteger(units) || units <= 0 || !Number.isSafeInteger(credits))
    return invalid();
  return { status: 'ready', credits, units, outputs, unit: capability.unit };
}

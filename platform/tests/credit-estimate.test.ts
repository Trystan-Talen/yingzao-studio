import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { estimateCreationCredits } from '../src/contracts/credit-estimate';
import { jobInputSchema, type JobInput, type OperationCapability } from '../src/contracts/jobs';
import { splitItems } from '../src/server/tasks/validation';

function fixture(operation = 'image.generate') {
  const input = jobInputSchema.parse({
    operation,
    providerId: 'openai',
    prompt: '',
    options: { model: 'fixture', ratio: '1:1', resolution: '2K', duration: 5, count: 1 },
  });
  const capability: OperationCapability = {
    id: operation,
    name: 'Fixture',
    providerId: 'openai',
    available: true,
    reason: null,
    models: [
      {
        id: 'fixture',
        name: 'Fixture',
        ratios: ['1:1', '9:16'],
        resolutions: ['2K', '4K'],
        durations: [5, 10],
      },
    ],
    priceCredits: 13,
    unit: operation === 'video.generate' ? 'second' : 'image',
    liveVerified: false,
  };
  return { input, capability };
}

describe('informational creation credit estimates', () => {
  it('shows a server-priced estimate before any prompt, without treating references as outputs', () => {
    const { input, capability } = fixture();
    input.assetIds = [randomUUID(), randomUUID()];
    input.referenceAssetIds = [randomUUID()];
    expect(estimateCreationCredits(input, capability)).toEqual({
      status: 'ready',
      credits: 13,
      units: 1,
      outputs: 1,
      unit: 'image',
    });
    expect(input.prompt).toBe('');
    capability.priceCredits = 17;
    expect(estimateCreationCredits(input, capability)).toMatchObject({ credits: 17 });
  });

  it('counts each design times requested copies, matching actual server item splitting', () => {
    const { input, capability } = fixture();
    input.options.count = 3;
    input.options.designs = ['主图', '场景'].map((name) => ({
      id: randomUUID(),
      name,
      kind: 'free',
      ratio: '1:1',
      prompt: '',
      assetIds: [],
    }));
    const split = splitItems(input);
    expect(split).toHaveLength(6);
    expect(estimateCreationCredits(input, capability)).toEqual({
      status: 'ready',
      credits: 78,
      units: split.length,
      outputs: 6,
      unit: 'image',
    });
  });

  it('counts all video outputs and their requested seconds, matching quote billing units', () => {
    const { input, capability } = fixture('video.generate');
    input.options.count = 2;
    input.options.duration = 10;
    const quotedUnits = splitItems(input).reduce((sum, item) => sum + item.options.duration, 0);
    expect(quotedUnits).toBe(20);
    expect(estimateCreationCredits(input, capability)).toEqual({
      status: 'ready',
      credits: 260,
      units: quotedUnits,
      outputs: 2,
      unit: 'second',
    });
    input.options.duration = 5;
    expect(estimateCreationCredits(input, capability)).toMatchObject({ credits: 130, units: 10 });
  });

  it('uses the server unit and rate without inventing resolution, ratio or audio multipliers', () => {
    const { input, capability } = fixture('video.generate');
    input.options.ratio = '9:16';
    input.options.resolution = '4K';
    input.options.generateAudio = true;
    expect(estimateCreationCredits(input, capability)).toMatchObject({ credits: 65 });
    capability.unit = 'request';
    expect(estimateCreationCredits(input, capability)).toMatchObject({
      credits: 13,
      units: 1,
      unit: 'request',
    });
    capability.priceCredits = 0;
    expect(estimateCreationCredits(input, capability)).toMatchObject({
      status: 'ready',
      credits: 0,
    });
  });

  it('includes the server-provided first-frame cost in video pipeline estimates', () => {
    const { input, capability } = fixture('video.generate');
    capability.priceCredits = 5;
    capability.fixedCredits = 8;
    expect(estimateCreationCredits(input, capability)).toMatchObject({ credits: 33, units: 5 });
    input.options.duration = 10;
    expect(estimateCreationCredits(input, capability)).toMatchObject({ credits: 58, units: 10 });
    capability.fixedCredits = 12;
    expect(estimateCreationCredits(input, capability)).toMatchObject({ credits: 62 });
  });

  it.each([
    ['missing', undefined],
    ['disconnected', { available: false }],
    ['wrong provider', { providerId: 'fal' }],
    ['wrong operation', { id: 'video.generate' }],
    ['invalid rate', { priceCredits: Number.NaN }],
    ['negative rate', { priceCredits: -1 }],
    ['invalid fixed cost', { fixedCredits: Number.NaN }],
    ['negative fixed cost', { fixedCredits: -1 }],
    ['overflow', { priceCredits: Number.MAX_SAFE_INTEGER }],
  ] as const)('does not turn %s pricing into zero credits', (_name, override) => {
    const { input, capability } = fixture();
    input.options.count = 2;
    expect(
      estimateCreationCredits(input, override ? { ...capability, ...override } : undefined).status,
    ).toBe('unknown');
  });

  it.each([
    { count: 0 },
    { count: Number.NaN },
    { count: 21 },
    { model: 'removed' },
    { resolution: '8K' },
    { ratio: '3:4' },
    { duration: 8 },
    { resolution: undefined },
  ])('rejects incompatible or incomplete generation settings: %j', (options) => {
    const { input, capability } = fixture('video.generate');
    input.options = { ...input.options, ...options } as JobInput['options'];
    expect(estimateCreationCredits(input, capability).status).toBe('unknown');
  });

  it('respects model count limits and does not claim to estimate source-duration or entitlement billing', () => {
    const { input, capability } = fixture();
    capability.maxCount = 1;
    input.options.count = 2;
    expect(estimateCreationCredits(input, capability).status).toBe('unknown');
    for (const operation of ['video.edit', 'video.motion-replica', 'text.assist']) {
      const other = fixture(operation);
      expect(estimateCreationCredits(other.input, other.capability)).toEqual({
        status: 'unknown',
        reason: 'unsupported',
      });
    }
  });
});

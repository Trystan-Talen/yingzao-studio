import { z } from 'zod';
import { OPERATION_IDS } from './catalog';
import { providerIdSchema, type ModelCapability } from './jobs';

export const modelCapabilityQuerySchema = z
  .object({
    providerId: providerIdSchema,
    operation: z.enum(OPERATION_IDS),
    modelId: z.string().trim().min(1).max(120),
    // Wan routes text and image input to different upstream schemas.
    inputMode: z.enum(['text', 'image']).default('text'),
    refresh: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export type ModelCapabilityQuery = z.infer<typeof modelCapabilityQuerySchema>;
export type CapabilityParameterKey =
  'ratio' | 'resolution' | 'duration' | 'quality' | 'size' | 'count' | 'format' | 'generateAudio';
export interface CapabilityParameter {
  key: CapabilityParameterKey;
  values: (string | number | boolean)[];
  source: 'upstream-schema' | 'provider-documentation' | 'local-adapter';
  /** A fixed adapter value is displayed as information, never as a selectable control. */
  adjustable: boolean;
}
export interface ModelCapabilitiesDto {
  providerId: ModelCapabilityQuery['providerId'];
  operation: ModelCapabilityQuery['operation'];
  modelId: string;
  inputMode: ModelCapabilityQuery['inputMode'];
  status: 'ready' | 'limited' | 'unavailable';
  canGenerate: boolean;
  source:
    'upstream-schema' | 'upstream-model-list' | 'provider-documentation' | 'local-adapter' | 'none';
  documentation?: { url: string; reviewedAt: string }[];
  /** Public catalog is supplementary, never an inference schema or authorization proof. */
  catalog?: { status: 'available' | 'unavailable'; checkedAt: string; url: string };
  sizePresets?: { ratio: string; resolution: string; size: string }[];
  /** Model membership is not a claim that inference or output quality was tested. */
  modelVerified: boolean;
  parametersVerified: boolean;
  model: ModelCapability;
  parameters: CapabilityParameter[];
  maxCount: number;
  /** Opaque, workspace/credential/input-mode bound proof for quote and submit validation. */
  revision: string;
  checkedAt: string;
  fetchedAt: string | null;
  expiresAt: string;
  cache: 'miss' | 'hit';
  reasonCode:
    | 'SCHEMA_VERIFIED'
    | 'DOCUMENTED_PARAMETERS'
    | 'MODEL_LIST_ONLY'
    | 'LOCAL_ONLY'
    | 'SCHEMA_PARTIAL'
    | 'NOT_CONFIGURED'
    | 'MODEL_NOT_AVAILABLE'
    | 'NO_COMPATIBLE_OPTIONS'
    | 'UPSTREAM_UNAVAILABLE'
    | 'UPSTREAM_UNAUTHORIZED'
    | 'UPSTREAM_INVALID'
    | 'CONFIGURATION_INVALID'
    | 'CONFIGURATION_CHANGED';
  reason: string;
}

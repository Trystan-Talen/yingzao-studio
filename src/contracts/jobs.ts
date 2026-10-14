import { z } from 'zod';
import { OPERATION_IDS } from './catalog';
import type { AssetDto } from './core';
export const providerIdSchema = z.enum(['local', 'openai', 'fal', 'flyelep']);
export const jobOptionsSchema = z
  .object({
    model: z.string().max(120).optional(),
    kind: z.string().max(40).default('free'),
    assistantMode: z.enum(['ideas', 'design-plan']).default('ideas'),
    designs: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().min(1).max(80),
            kind: z.string().max(40),
            ratio: z.string().max(20),
            prompt: z.string().max(2000).default(''),
            assetIds: z.array(z.string().uuid()).max(16).default([]),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    ratio: z.string().max(20).default('1:1'),
    count: z.number().int().min(1).max(20).default(1),
    resolution: z.string().max(20).default('1K'),
    duration: z.number().int().min(2).max(60).default(5),
    language: z.string().max(30).default('zh-CN'),
    languages: z.array(z.string().max(30)).max(18).optional(),
    forceTranslation: z.boolean().default(false),
    platform: z.string().max(80).default('通用电商'),
    channel: z.enum(['promotion', 'premium']).default('premium'),
    needText: z.boolean().default(true),
    referenceMode: z.enum(['all', 'first-last']).default('all'),
    scale: z.union([z.literal(2), z.literal(4), z.literal(8)]).default(2),
    strength: z.enum(['light', 'standard', 'strong']).default('standard'),
    colors: z.array(z.string().max(40)).max(20).optional(),
    background: z.string().max(30).default('#ffffff'),
    width: z.number().int().min(16).max(8192).optional(),
    height: z.number().int().min(16).max(8192).optional(),
    format: z.enum(['png', 'jpeg', 'webp']).default('png'),
    trimStart: z.number().min(0).max(3600).default(0),
    trimEnd: z.number().min(0.1).max(3600).optional(),
    sellingPoints: z.string().max(300).optional(),
    price: z.string().max(40).optional(),
    replacementType: z.enum(['model', 'clothing', 'face', 'product']).default('product'),
    keepMusicRhythm: z.boolean().default(true),
    mode: z.enum(['creative', 'exact', 'ai', 'stitch']).default('creative'),
    textReplacements: z
      .array(
        z.object({
          originalText: z.string().max(1000),
          replaceText: z.string().max(1000),
          rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        }),
      )
      .max(100)
      .optional(),
  })
  .strict();
export const jobInputSchema = z
  .object({
    operation: z.enum(OPERATION_IDS),
    providerId: providerIdSchema,
    projectId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
    baseRevision: z.number().int().positive().optional(),
    targetLayerId: z.string().uuid().optional(),
    prompt: z.string().max(12000).default(''),
    referenceText: z.string().max(20000).optional(),
    conversationContext: z.string().max(6000).optional(),
    assetIds: z.array(z.string().uuid()).max(20).default([]),
    referenceAssetIds: z.array(z.string().uuid()).max(20).default([]),
    maskAssetId: z.string().uuid().optional(),
    brandId: z.string().uuid().optional(),
    characterId: z.string().uuid().optional(),
    characterRevision: z.number().int().positive().optional(),
    options: jobOptionsSchema.default(() => jobOptionsSchema.parse({})),
  })
  .strict();
export type JobInput = z.infer<typeof jobInputSchema>;
export type JobOptions = z.infer<typeof jobOptionsSchema>;
export const jobSubmitSchema = z
  .object({ input: jobInputSchema, quoteId: z.string().uuid(), clientRequestId: z.string().uuid() })
  .strict();
export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'reconciliation_required',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export interface QuoteDto {
  id: string;
  inputHash: string;
  pricingVersion: string;
  maxCredits: number;
  expiresAt: string;
  providerId: string;
  operation: string;
  units: number;
}
export interface JobItemDto {
  id: string;
  index: number;
  status: JobStatus;
  assetId: string | null;
  assetIds: string[];
  outputKind: 'single' | 'layers';
  remoteId: string | null;
  errorMessage: string | null;
  resultText: string | null;
}
export interface JobDto {
  createdBy: string;
  isArchived: boolean;
  downloadedAt: string | null;
  id: string;
  workspaceId: string;
  projectId: string | null;
  operation: string;
  providerId: string;
  prompt: string;
  status: JobStatus;
  stage: string;
  requestedCredits: number;
  settledCredits: number;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  items: JobItemDto[];
  outputAssets: AssetDto[];
  input: JobInput;
}
export interface ModelCapability {
  id: string;
  name: string;
  ratios: string[];
  resolutions: string[];
  durations: number[];
}
export interface OperationCapability {
  id: string;
  name: string;
  providerId: string;
  available: boolean;
  reason: string | null;
  models: ModelCapability[];
  priceCredits: number;
  unit: 'image' | 'second' | 'request';
  liveVerified: boolean;
}
export interface CapabilitiesDto {
  providers: { id: string; name: string; configured: boolean }[];
  operations: OperationCapability[];
}
export interface CreditDto {
  balance: number;
  reserved: number;
  available: number;
  spent: number;
  isDemo: boolean;
  unit: 'credits';
}
export interface ProviderSettingDto {
  providerId: string;
  name: string;
  configured: boolean;
  enabled: boolean;
  keyHint: string | null;
  source: 'workspace' | 'environment' | 'none';
  updatedAt: string | null;
  liveVerified: boolean;
}
export const providerSettingsInputSchema = z
  .object({
    providerId: z.enum(['openai', 'fal', 'flyelep']),
    secret: z.string().min(10).max(500).optional(),
    enabled: z.boolean().default(true),
    removeSecret: z.boolean().optional(),
  })
  .strict();
export interface PendingApplyDto {
  id: string;
  documentId: string;
  jobId: string;
  assetId: string;
  assetIds: string[];
  outputKind: 'single' | 'layers';
  baseRevision: number;
  targetLayerId: string | null;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: string;
}

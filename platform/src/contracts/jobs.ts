import type { BillingChannel } from './billing-channel';
import { z } from 'zod';
import { OPERATION_IDS } from './catalog';
import type { AssetDto } from './core';
import type { JobResultData } from './job-result';
import { detailPagePlanSchema, detailPageScreenSchema } from './detail-page';
import { creativePlacementSchema } from './creative-intent';
function normalizeColor(value: string): string {
  const color = value.trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(color)
    ? `#${[...color.slice(1)].map((digit) => digit + digit).join('')}`
    : color;
}
export const providerIdSchema = z.enum([
  'local',
  'openai',
  'fal',
  'flyelep',
  'tikhub',
  'dify',
  'seedance',
]);
export const jobOptionsSchema = z
  .object({
    model: z.string().max(120).optional(),
    kind: z.string().max(40).default('free'),
    assistantMode: z.enum(['ideas', 'design-plan', 'detail-page']).default('ideas'),
    detailPageScreenCount: z.number().int().min(2).max(10).optional(),
    detailPagePlan: detailPagePlanSchema.optional(),
    detailPageScreenId: detailPageScreenSchema.shape.id.optional(),
    detailPagePlanningJobId: z.string().uuid().optional(),
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
    creativePlacement: creativePlacementSchema.optional(),
    creativeMarket: z.string().max(20).optional(),
    channel: z.enum(['promotion', 'premium']).default('premium'),
    needText: z.boolean().default(true),
    referenceMode: z.enum(['all', 'first-last']).default('all'),
    motionOrientation: z.enum(['video', 'image']).default('video'),
    referenceAuthorized: z.boolean().default(false),
    externalCostAccepted: z.boolean().default(false),
    scale: z.union([z.literal(2), z.literal(4), z.literal(8)]).default(2),
    strength: z.enum(['light', 'standard', 'strong']).default('standard'),
    colors: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .transform((values) => [...new Set(values.map(normalizeColor))])
      .optional(),
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
    generateAudio: z.boolean().optional(),
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
    capabilityRevision: z.string().uuid().optional(),
    creativeBriefId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
    baseRevision: z.number().int().positive().optional(),
    targetLayerId: z.string().uuid().optional(),
    prompt: z.string().max(12000).default(''),
    referenceText: z.string().max(20000).optional(),
    linkUrl: z.string().max(4096).optional(),
    conversationContext: z.string().max(6000).optional(),
    creationWarnings: z.array(z.string().max(1000)).max(30).optional(),
    assetIds: z.array(z.string().uuid()).max(20).default([]),
    referenceAssetIds: z.array(z.string().uuid()).max(20).default([]),
    maskAssetId: z.string().uuid().optional(),
    backgroundAssetId: z.string().uuid().optional(),
    backgroundAudioAssetId: z.string().uuid().optional(),
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
  creativeSummary?: { summary: string; assumptions: string[] };
  /** Retry quotations may refresh the model capability proof; submit this exact input. */
  input?: JobInput;
  billingChannel?: BillingChannel;
  id: string;
  inputHash: string;
  pricingVersion: string;
  maxCredits: number;
  expiresAt: string;
  providerId: string;
  operation: string;
  units: number;
  items?: QuoteItemSummary[];
}
export interface QuoteItemSummary {
  index: number;
  assetIds: string[];
  referenceAssetIds: string[];
  backgroundAssetId?: string;
  backgroundAudioAssetId?: string;
  color?: string;
  language?: string;
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
  resultData?: JobResultData | null;
  detailPageScreenId?: string;
  sourceAssetIds?: string[];
  referenceAssetIds?: string[];
  backgroundAssetId?: string;
  backgroundAudioAssetId?: string;
  retrySourceItemId?: string | null;
  retryRootItemId?: string | null;
  retryable?: boolean;
  retryJobId?: string | null;
  phase?: string;
  recoveryAttempts?: number;
  nextRetryAt?: string | null;
  canResume?: boolean;
}
export interface JobDto {
  creativeReview?: {
    summary: string;
    assumptions: string[];
    strategyId: string;
    strategyVersion: string;
    artifacts: {
      assetId: string;
      name: string;
      result: import('./creative-strategy').CreativeCheckResult;
    }[];
    visualChecks: string[];
  };
  billingChannel?: BillingChannel;
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
  audio?: {
    mode: 'background-music' | 'generated';
    note: string;
  };
  textOverlay?: {
    mode: 'prompt-guidance' | 'unsupported' | 'native';
    note: string;
  };
}
export interface OperationCapability {
  inputMode?: 'text-only';
  maxCount?: number;
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
  billingChannel?: BillingChannel;
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
    providerId: z.enum(['openai', 'fal', 'flyelep', 'tikhub', 'dify', 'seedance']),
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

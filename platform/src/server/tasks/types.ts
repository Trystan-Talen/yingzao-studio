import type { BillingChannel } from '../../contracts/billing-channel';
import type { JobStatus, JobInput } from '../../contracts/jobs';
import type { Actor } from '../../contracts/core';
import type { JobResultData } from '../../contracts/job-result';
export interface JobRow {
  billing_channel: BillingChannel;
  id: string;
  workspace_id: string;
  user_id: string;
  project_id: string | null;
  operation: string;
  provider_id: string;
  prompt: string;
  input_json: string;
  input_hash: string;
  request_id: string;
  pricing_version: string;
  status: JobStatus;
  stage: string;
  requested_credits: number;
  settled_credits: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
export interface ItemRow {
  billing_channel: BillingChannel;
  id: string;
  job_id: string;
  workspace_id: string;
  user_id: string;
  item_index: number;
  input_json: string;
  status: JobStatus;
  phase: string;
  credits: number;
  asset_id: string | null;
  output_kind: 'single' | 'layers';
  remote_id: string | null;
  remote_json: string | null;
  result_json: string | null;
  result_text: string | null;
  retry_source_item_id: string | null;
  retry_root_item_id: string | null;
  result_data_json: string | null;
  error_message: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  fence: number;
  attempts: number;
  recovery_failures: number;
  next_attempt_at: string;
  cancel_requested: number;
  created_at: string;
  updated_at: string;
}
export interface QuoteRow {
  billing_channel: BillingChannel;
  id: string;
  workspace_id: string;
  user_id: string;
  input_hash: string;
  input_json: string;
  pricing_version: string;
  max_credits: number;
  units: number;
  expires_at: string;
  created_at: string;
  items_json: string | null;
  used_job_id: string | null;
  retry_job_id: string | null;
  retry_item_ids_json: string | null;
}
export interface ProviderOutput {
  buffer?: Buffer;
  url?: string;
  mimeType: string;
  name: string;
  text?: string;
  resultData?: JobResultData;
  /** Trusted adapter's actual request size; never populated from provider JSON or client input. */
  expectedImageSize?: { width: number; height: number };
  /** Internal processing provenance, validated against the server-frozen input by the worker. */
  processing?: NativeProcessing;
}
type ProcessingParameters = Record<string, string | number | boolean | null>;
export type NativeProcessing =
  | {
      method: 'model-video-tail-hold-v1';
      sourceAssetId: string;
      params?: ProcessingParameters;
    }
  | {
      method: 'exact-pan-v1';
      sourceAssetId: string;
      params?: ProcessingParameters;
    }
  | {
      method: 'exact-background-v1';
      sourceAssetId: string;
      maskAssetIds: { raw?: string; baseline?: string; normalized: string };
      color: string;
      params?: ProcessingParameters;
    };
export type NativeArtifactRole =
  | 'background-mask-raw'
  | 'background-mask-baseline'
  | 'background-mask'
  | 'background-matting-composite'
  | 'video-model-raw';
export interface NativeArtifact {
  assetId: string;
  buffer: Buffer;
  mimeType: string;
  name: string;
}
export interface RemoteTask {
  id: string;
  difyMode?: 'ideas' | 'detail-page';
  detailPageScreenCount?: number;
  detailPageRatio?: '3:4' | '2:3' | '9:16';
  submittedAt?: string;
  statusUrl?: string;
  responseUrl?: string;
  cancelUrl?: string;
  endpoint?: string;
  nativeModel?: string;
}
export type ProviderResult =
  | {
      state: 'complete';
      outputs: ProviderOutput[];
      outputKind?: 'layers';
      billingDisposition?: 'no-visible-text';
    }
  | { state: 'submitted'; remote: RemoteTask }
  | { state: 'running'; stage: string }
  | { state: 'failed'; message: string };
export interface ExecutionContext {
  actor: Actor;
  workspaceId: string;
  input: JobInput;
  assetUrl?: (id: string, variant?: 'original' | 'mask-white') => string;
  readAsset: (id: string) => Promise<{ buffer: Buffer; mimeType: string; name: string }>;
  onRemoteAccepted?: (remote: RemoteTask) => void | Promise<void>;
  onStage?: (stage: string) => void;
  beforeAdditionalSubmission?: () => void;
  /** A durable local-processing checkpoint exists; a missing artifact must not trigger a model call. */
  resumeLocalProcessing?: boolean;
  localMatting?: {
    config: import('../providers/local-matting-installation').LocalMattingConfig;
    signal?: AbortSignal;
    owns: () => boolean;
  };
  nativeArtifacts?: {
    load: (role: NativeArtifactRole) => Promise<NativeArtifact | undefined>;
    save: (role: NativeArtifactRole, output: ProviderOutput) => Promise<NativeArtifact>;
    saveMattingPair?: (
      mask: Buffer,
      composite: Buffer,
    ) => Promise<{ mask: NativeArtifact; composite: NativeArtifact }>;
  };
  nativeFrame?: {
    load: () => Promise<{ buffer: Buffer; mimeType: string; name: string } | undefined>;
    save: (output: ProviderOutput) => Promise<void>;
  };
  textPresence?: (
    assetId: string,
    detectorId: string,
    compute: () => Promise<boolean>,
  ) => Promise<boolean>;
}
export interface ProviderAdapter {
  id: string;
  execute: (context: ExecutionContext, secret?: string) => Promise<ProviderResult>;
  poll?: (remote: RemoteTask, secret: string) => Promise<ProviderResult>;
  cancel?: (remote: RemoteTask, secret: string) => Promise<void>;
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public ambiguous = false,
    public code = 'PROVIDER_ERROR',
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
export function actorForJob(item: ItemRow): Actor {
  return {
    userId: item.user_id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
}

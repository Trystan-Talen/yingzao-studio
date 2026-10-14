import { z } from 'zod';
import { sceneDocumentSchema, sceneDocumentOutputSchema } from './scene';
import { ExportPolicySchema } from './export-policy';

export const IdSchema = z.string().uuid();
export const IsoDateSchema = z.string().datetime();
export const RoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;
export type Permission = 'read' | 'write' | 'manage' | 'owner';
export interface Actor {
  userId: string;
  authType: 'session' | 'apiKey';
  apiKeyId: string | null;
  workspaceId: string | null;
  scopes: readonly string[];
}
export interface WorkspaceAccess {
  workspaceId: string;
  userId: string;
  membershipId: string;
  role: Role;
}
export const PreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  locale: z.enum(['zh-CN', 'en', 'ar']).default('zh-CN'),
  confirmGeneration: z.boolean().default(true),
  onboardingCompleted: z.boolean().default(false),
  defaultPlatform: z.string().min(1).max(80).default('通用电商'),
  defaultCreationLanguage: z
    .enum([
      'zh-CN',
      'en',
      'ja',
      'ko',
      'de',
      'fr',
      'es',
      'it',
      'pt',
      'ru',
      'ar',
      'th',
      'vi',
      'id',
      'ms',
      'tr',
      'pl',
      'nl',
    ])
    .default('zh-CN'),
});
export const UserSchema = z.object({
  id: IdSchema,
  email: z.email(),
  displayName: z.string(),
  avatarAssetId: IdSchema.nullable(),
  preferences: PreferencesSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type UserDto = z.infer<typeof UserSchema>;
export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: z.enum(['personal', 'team']),
  role: RoleSchema,
  isDemo: z.boolean(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type WorkspaceDto = z.infer<typeof WorkspaceSchema>;
export const ProjectSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string(),
  description: z.string(),
  kind: z.enum(['image', 'video', 'mixed']),
  coverAssetId: IdSchema.nullable(),
  documentId: IdSchema,
  tags: z.array(z.string()),
  isFavorite: z.boolean(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  deletedAt: IsoDateSchema.nullable(),
});
export type ProjectDto = z.infer<typeof ProjectSchema>;
export const AssetSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema.nullable(),
  name: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'document']),
  extractionStatus: z.enum(['not-applicable', 'pending', 'ready', 'failed']),
  mimeType: z.string(),
  byteSize: z.number().int(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationMs: z.number().nullable(),
  source: z.enum(['upload', 'generation', 'local-processing', 'import']),
  sourceJobId: IdSchema.nullable(),
  tags: z.array(z.string()),
  isFavorite: z.boolean(),
  originalUrl: z.string(),
  previewUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  deletedAt: IsoDateSchema.nullable(),
});
export type AssetDto = z.infer<typeof AssetSchema>;
export const BrandSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string(),
  description: z.string(),
  colors: z.array(z.string()),
  fonts: z.array(z.string()),
  referenceAssetIds: z.array(IdSchema),
  coverAssetId: IdSchema.nullable(),
  visibility: z.enum(['private', 'workspace']),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  deletedAt: IsoDateSchema.nullable(),
});
export type BrandDto = z.infer<typeof BrandSchema>;
export const CharacterSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string(),
  description: z.string(),
  referenceAssetIds: z.array(IdSchema),
  coverAssetId: IdSchema.nullable(),
  authorization: z.object({
    status: z.enum(['not-declared', 'active', 'withdrawn', 'stale']),
    referenceRevision: z.number().int().positive(),
    statementVersion: z.literal('reference-use-v1'),
    authorizedAt: IsoDateSchema.nullable(),
    withdrawnAt: IsoDateSchema.nullable(),
    subjectRelationship: z.enum(['self', 'authorized-representative']).nullable(),
  }),
  verification: z.object({
    status: z.enum(['unverified', 'pending', 'verified', 'rejected', 'expired']),
    providerId: z.string().nullable(),
    expiresAt: IsoDateSchema.nullable(),
  }),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  deletedAt: IsoDateSchema.nullable(),
});
export type CharacterDto = z.infer<typeof CharacterSchema>;
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export const NameSchema = z.string().trim().min(1).max(120);
export const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(30);
export const RegisterInputSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(12).max(128),
    displayName: NameSchema,
    inviteToken: z.string().min(24).max(200).optional(),
    referralCode: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  })
  .strict();
export const LoginInputSchema = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
  .strict();
export const UpdateMeInputSchema = z
  .object({
    displayName: NameSchema.optional(),
    avatarAssetId: IdSchema.nullable().optional(),
    preferences: z
      .object({
        theme: PreferencesSchema.shape.theme.removeDefault().optional(),
        locale: PreferencesSchema.shape.locale.removeDefault().optional(),
        confirmGeneration: PreferencesSchema.shape.confirmGeneration.removeDefault().optional(),
        onboardingCompleted: PreferencesSchema.shape.onboardingCompleted.removeDefault().optional(),
        defaultPlatform: PreferencesSchema.shape.defaultPlatform.removeDefault().optional(),
        defaultCreationLanguage: PreferencesSchema.shape.defaultCreationLanguage
          .removeDefault()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const ProjectInputSchema = z
  .object({
    name: NameSchema,
    kind: z.enum(['image', 'video', 'mixed']).default('image'),
    description: z.string().max(4000).default(''),
  })
  .strict();
export const ProjectPatchSchema = z
  .object({
    name: NameSchema.optional(),
    description: z.string().max(4000).optional(),
    tags: TagsSchema.optional(),
    coverAssetId: IdSchema.nullable().optional(),
  })
  .strict();
export const AssetPatchSchema = z
  .object({
    name: NameSchema.optional(),
    tags: TagsSchema.optional(),
    projectId: IdSchema.nullable().optional(),
  })
  .strict();
export const BrandInputSchema = z
  .object({
    name: NameSchema,
    description: z.string().max(4000).default(''),
    colors: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
      .max(16)
      .default([]),
    fonts: z.array(z.string().max(80)).max(12).default([]),
    referenceAssetIds: z.array(IdSchema).max(20).default([]),
    coverAssetId: IdSchema.nullable().optional(),
    visibility: z.enum(['private', 'workspace']).default('workspace'),
  })
  .strict();
export const BrandPatchSchema = BrandInputSchema.partial();
export const CharacterInputSchema = z
  .object({
    name: NameSchema,
    description: z.string().max(4000).default(''),
    referenceAssetIds: z.array(IdSchema).max(20).default([]),
    coverAssetId: IdSchema.nullable().optional(),
  })
  .strict();
export const CharacterPatchSchema = CharacterInputSchema.partial();
export const InvitationInputSchema = z
  .object({
    email: z.email().max(254),
    role: z.enum(['admin', 'member', 'viewer']).default('member'),
    expiresInDays: z.number().int().min(1).max(7).default(7),
    creditLimit: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export const MemberPatchSchema = z
  .object({
    role: z.enum(['admin', 'member', 'viewer']).optional(),
    creditLimit: z.number().int().nonnegative().nullable().optional(),
    nickname: z.string().max(100).optional(),
  })
  .strict();
export const API_SCOPES = [
  'projects:read',
  'projects:write',
  'assets:read',
  'assets:write',
  'jobs:read',
  'jobs:write',
  'credits:read',
] as const;
export const ApiKeyInputSchema = z
  .object({
    name: NameSchema,
    scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
    expiresAt: IsoDateSchema.nullable().optional(),
    creditLimit: z.number().int().positive().nullable().optional(),
  })
  .strict();
export const InvoiceTitleInputSchema = z
  .object({
    type: z.enum(['personal', 'company']),
    name: NameSchema,
    taxId: z.string().trim().max(40).nullable().default(null),
    email: z.email().nullable().default(null),
  })
  .strict()
  .refine((v) => v.type !== 'company' || !!v.taxId, {
    message: '公司抬头需要税号',
    path: ['taxId'],
  });
export const TicketInputSchema = z
  .object({
    subject: NameSchema,
    category: z.enum(['feedback', 'appeal', 'support']),
    message: z.string().trim().min(1).max(10000),
    jobId: IdSchema.optional(),
    assetIds: z.array(IdSchema).max(20).default([]),
  })
  .strict();
export const AssetTextSchema = z.object({
  assetId: IdSchema,
  extractionStatus: z.enum(['not-applicable', 'pending', 'ready', 'failed']),
  extractedText: z.string().nullable(),
  extractionError: z.object({ code: z.string(), message: z.string() }).nullable(),
  truncated: z.boolean(),
});
export type AssetTextDto = z.infer<typeof AssetTextSchema>;

export const WorkspaceInputSchema = z.object({ name: NameSchema }).strict();
export const WorkspacePatchSchema = WorkspaceInputSchema.extend({
  description: z.string().max(4000).optional(),
});
export const ConfirmInputSchema = z.object({ confirm: z.literal(true) }).strict();
export const TransferWorkspaceInputSchema = ConfirmInputSchema.extend({ userId: IdSchema });
export const FavoriteInputSchema = z.object({ favorite: z.boolean() }).strict();
export const AcceptInvitationInputSchema = z
  .object({ token: z.string().min(24).max(200) })
  .strict();
export const SetCollectionAssetsInputSchema = z
  .object({ assetIds: z.array(IdSchema).max(500) })
  .strict();
export const CreateOrderInputSchema = z.object({ planId: z.string().min(1).max(100) }).strict();
export const CreateInvoiceInputSchema = z
  .object({ orderIds: z.array(IdSchema).min(1).max(100), titleId: IdSchema })
  .strict();
export const TicketReplyInputSchema = z
  .object({ message: z.string().trim().min(1).max(10000) })
  .strict();
export const ShareInputSchema = z
  .object({
    projectId: IdSchema,
    expiresInDays: z.number().int().min(1).max(30).default(7),
    allowOriginalDownload: z.boolean().default(false),
  })
  .strict();
export const ReadShareInputSchema = AcceptInvitationInputSchema;
export const ShareMediaInputSchema = ReadShareInputSchema.extend({
  assetId: IdSchema,
  variant: z.enum(['original', 'preview', 'thumbnail']).default('preview'),
});
export const ShareSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  revokedAt: IsoDateSchema.nullable(),
  allowOriginalDownload: z.boolean(),
});
export const CreatedShareSchema = ShareSchema.omit({ revokedAt: true }).extend({
  shareUrl: z.string().url(),
});
export const PublicShareAssetSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'document']),
  width: z.number().nullable(),
  height: z.number().nullable(),
  previewVariant: z.enum(['preview', 'thumbnail']).nullable(),
  previewMimeType: z.string().nullable(),
  originalAvailable: z.boolean(),
});
export const PublicShareSchema = z.object({
  project: z.object({ name: z.string(), description: z.string() }),
  document: z.object({
    name: z.string(),
    scene: sceneDocumentOutputSchema,
    revision: z.number().int(),
  }),
  assetIds: z.array(IdSchema),
  allowOriginalDownload: z.boolean(),
  assets: z.array(PublicShareAssetSchema),
  exportPolicy: ExportPolicySchema,
});
export type PublicShareDto = z.infer<typeof PublicShareSchema>;
export const MemberImportRowSchema = z
  .object({
    email: z.email().max(254),
    role: z.enum(['admin', 'member', 'viewer']).default('member'),
    nickname: z.string().max(100).default(''),
    creditLimit: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export const MemberImportInputSchema = z
  .object({ rows: z.array(z.unknown()).min(1).max(500), confirm: z.literal(true) })
  .strict();
export const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export const CreateProjectInputSchema = ProjectInputSchema.extend({
  scene: sceneDocumentSchema.optional(),
});
export const UpdateDocumentInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    scene: sceneDocumentSchema,
    name: NameSchema.optional(),
  })
  .strict();
export const RestoreDocumentInputSchema = z
  .object({
    targetRevision: z.number().int().positive(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const DocumentSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  name: z.string(),
  revision: z.number().int().positive(),
  schemaVersion: z.literal(1),
  scene: sceneDocumentOutputSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export const DocumentVersionSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  revision: z.number().int().positive(),
  reason: z.enum(['create', 'save', 'restore', 'job-apply']),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  sourceJobId: IdSchema.nullable(),
  restoredFromRevision: z.number().int().nullable(),
});

export const InvoiceWithdrawInputSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const CharacterAuthorizationSchema = CharacterSchema.shape.authorization;
export const CharacterAuthorizationInputSchema = z
  .object({
    acknowledged: z.literal(true),
    statementVersion: z.literal('reference-use-v1'),
    subjectRelationship: z.enum(['self', 'authorized-representative']),
  })
  .strict();
export const ReasonInputSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

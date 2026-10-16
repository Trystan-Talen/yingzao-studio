import { z } from 'zod';
import { jobInputSchema, type JobInput } from '../../contracts/jobs';

export type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const draftSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  input: jobInputSchema,
  drafts: z.object({ image: jobInputSchema.optional(), video: jobInputSchema.optional() }),
  warnings: z
    .object({
      image: z.array(z.string().max(1000)).max(30).optional(),
      video: z.array(z.string().max(1000)).max(30).optional(),
    })
    .optional(),
});
export type CreationDraft = z.infer<typeof draftSchema>;
export const draftStorageKey = (userId: string, workspaceId: string, projectId?: string) =>
  `yingzao:creation:v1:${userId}:${workspaceId}:${projectId ?? 'new'}`;

export function readDraft(storage: RecoveryStorage, key: string) {
  try {
    const raw = storage.getItem(key);
    return { value: raw ? draftSchema.parse(JSON.parse(raw)) : null, error: null };
  } catch {
    return { value: null, error: '无法恢复本机草稿。请检查浏览器存储，或使用已保存到项目的草稿。' };
  }
}
export function writeDraft(
  storage: RecoveryStorage,
  key: string,
  draft: Pick<CreationDraft, 'input' | 'drafts' | 'warnings'>,
) {
  const record = draftSchema.parse({ ...draft, version: 1, updatedAt: new Date().toISOString() });
  storage.setItem(key, JSON.stringify(record));
}
export function latestMediaDraft(
  messages: { createdAt: string; metadata?: { draft?: JobInput } }[],
) {
  return latestMediaDraftRecord(messages)?.metadata?.draft;
}
export function latestMediaDraftRecord<
  T extends { createdAt: string; metadata?: { draft?: JobInput; creationWarnings?: string[] } },
>(messages: T[]) {
  const candidates = messages
    .filter((message) =>
      ['image.generate', 'video.generate'].includes(message.metadata?.draft?.operation ?? ''),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = candidates[0];
  if (!latest || latest.metadata?.creationWarnings !== undefined) return latest;
  const warnings =
    latest.metadata?.draft?.creationWarnings ??
    candidates.find(
      (message) =>
        message.metadata?.draft?.operation === latest.metadata?.draft?.operation &&
        message.metadata?.creationWarnings !== undefined,
    )?.metadata?.creationWarnings;
  return warnings === undefined
    ? latest
    : { ...latest, metadata: { ...latest.metadata, creationWarnings: warnings } };
}
export async function restoreAssets<T extends { id: string }>(
  ids: string[],
  load: (id: string) => Promise<T>,
) {
  const unique = [...new Set(ids)];
  const results = await Promise.allSettled(unique.map(load));
  const resolved = new Map<string, T>();
  const failures: { id: string; message: string }[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') resolved.set(unique[index]!, result.value);
    else
      failures.push({
        id: unique[index]!,
        message: result.reason instanceof Error ? result.reason.message : '素材读取失败',
      });
  });
  return {
    assets: ids.flatMap((id) => (resolved.has(id) ? [resolved.get(id)!] : [])),
    failures,
    ready: failures.length === 0,
  };
}

const pendingSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  requestId: z.string().uuid(),
  input: jobInputSchema,
  confirmedAt: z.string(),
  quote: z.object({
    id: z.string().uuid(),
    inputHash: z.string(),
    pricingVersion: z.string(),
    maxCredits: z.number(),
    expiresAt: z.string(),
    providerId: z.string(),
    operation: z.string(),
    units: z.number(),
    items: z
      .array(
        z.object({
          index: z.number(),
          assetIds: z.array(z.string()),
          referenceAssetIds: z.array(z.string()),
          color: z.string().optional(),
          language: z.string().optional(),
        }),
      )
      .optional(),
  }),
});
export type PendingSubmission = z.infer<typeof pendingSchema>;
// Submission checks the existing request before validating content, and writes in one
// transaction. These responses therefore mean no new job was accepted. Authentication,
// generic transport failures and identity conflicts do not establish that fact.
export function submissionWasRejected(error: { status: number; code: string }) {
  return (
    error.status === 400 ||
    error.status === 422 ||
    (error.status === 409 && error.code !== 'IDEMPOTENCY_CONFLICT') ||
    (error.status === 404 && ['NOT_FOUND', 'QUOTE_NOT_FOUND'].includes(error.code)) ||
    (error.status === 503 && error.code === 'CAPABILITY_UNAVAILABLE')
  );
}
const submissionKey = (userId: string, workspaceId: string) =>
  `yingzao:submissions:v1:${userId}:${workspaceId}`;
export function readPendingSubmissions(
  storage: RecoveryStorage,
  userId: string,
  workspaceId: string,
): { value: PendingSubmission[]; error: string | null } {
  try {
    const raw = storage.getItem(submissionKey(userId, workspaceId));
    return { value: raw ? z.array(pendingSchema).parse(JSON.parse(raw)) : [], error: null };
  } catch {
    return { value: [], error: '无法读取待核对的提交记录。请先到任务中心检查，避免重复提交。' };
  }
}
export function writePendingSubmission(
  storage: RecoveryStorage,
  userId: string,
  workspaceId: string,
  pending: PendingSubmission,
) {
  const existing = readPendingSubmissions(storage, userId, workspaceId);
  if (existing.error) throw new Error(existing.error);
  const parsed = pendingSchema.parse(pending);
  const previous = existing.value.find((entry) => entry.requestId === pending.requestId);
  if (previous && JSON.stringify(previous) !== JSON.stringify(parsed))
    throw new Error('同一请求编号不能用于不同参数。');
  storage.setItem(
    submissionKey(userId, workspaceId),
    JSON.stringify([
      ...existing.value.filter((entry) => entry.requestId !== pending.requestId),
      parsed,
    ]),
  );
}
export function removePendingSubmission(
  storage: RecoveryStorage,
  userId: string,
  workspaceId: string,
  requestId: string,
) {
  const existing = readPendingSubmissions(storage, userId, workspaceId);
  if (existing.error) throw new Error(existing.error);
  const next = existing.value.filter((entry) => entry.requestId !== requestId);
  if (next.length) storage.setItem(submissionKey(userId, workspaceId), JSON.stringify(next));
  else storage.removeItem(submissionKey(userId, workspaceId));
}

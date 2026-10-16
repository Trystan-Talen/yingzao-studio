import { jobInputSchema, type JobInput, type OperationCapability } from '../../contracts/jobs';
import { LANGUAGES } from '../../contracts/catalog';
import { draftStorageKey, type CreationDraft } from './creation-recovery';
export interface OcrDraftSource {
  jobId: string;
  itemId: string;
  region: string;
}
export function advancedDraftStorageKey(
  userId: string,
  workspaceId: string,
  operation: string,
  projectId?: string,
  source?: OcrDraftSource,
) {
  const base = `${draftStorageKey(userId, workspaceId, projectId)}:advanced:${operation}`;
  return source
    ? `${base}:ocr:${encodeURIComponent(source.jobId)}:${encodeURIComponent(source.itemId)}:${encodeURIComponent(source.region)}`
    : base;
}
export function matchingAdvancedDraft(local: CreationDraft | null, operation: string) {
  return local?.input.operation === operation ? local.input : undefined;
}
interface DraftMessage {
  createdAt: string;
  metadata?: { draft?: JobInput };
}
export interface ToolDraftPage {
  items: DraftMessage[];
  total: number;
  page: number;
  pageSize: number;
}
export async function findAdvancedDraftBatch(
  operation: string,
  readPage: (page: number, signal: AbortSignal) => Promise<ToolDraftPage>,
  signal: AbortSignal,
  startPage = 1,
  maxPages = 4,
) {
  let nextPage = startPage;
  for (let read = 0; read < maxPages; read++) {
    if (signal.aborted) throw new DOMException('已取消恢复', 'AbortError');
    const data = await readPage(nextPage, signal);
    if (signal.aborted) throw new DOMException('已取消恢复', 'AbortError');
    const message = [...data.items]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .find((m) => m.metadata?.draft?.operation === operation);
    nextPage++;
    if (message)
      return {
        status: 'ready' as const,
        nextPage,
        draft: jobInputSchema.parse(message.metadata!.draft),
      };
    if (data.pageSize <= 0 || nextPage > Math.ceil(data.total / data.pageSize))
      return { status: 'ready' as const, nextPage, draft: undefined };
  }
  return { status: 'limited' as const, nextPage, draft: undefined };
}
export function advancedParameterSelection(
  input: {
    operation?: string;
    providerId: string;
    modelId: string;
    duration: number;
    resolution: string;
    language?: string;
    scale?: number;
  },
  operations: OperationCapability[],
) {
  const operation = input.providerId
    ? operations.find((o) => o.providerId === input.providerId)
    : (operations.find((o) => o.available) ?? operations[0]);
  const model = input.modelId
    ? operation?.models.find((m) => m.id === input.modelId)
    : operation?.models[0];
  const warnings: string[] = [];
  if (input.providerId && !operation)
    warnings.push(`保存的服务“${input.providerId}”当前不可用，请明确重新选择。`);
  if (operation && input.modelId && !model)
    warnings.push(`保存的模型“${input.modelId}”当前不受支持，请明确重新选择。`);
  if (model?.durations.length && !model.durations.includes(input.duration))
    warnings.push(`保存的时长“${input.duration}秒”不受当前模型支持，原值已保留。`);
  if (model?.resolutions.length && !model.resolutions.includes(input.resolution))
    warnings.push(`保存的分辨率“${input.resolution}”不受当前模型支持，原值已保留。`);
  if (
    input.operation === 'video.translate' &&
    !LANGUAGES.some((item) => item.id === input.language)
  )
    warnings.push(`保存的目标语言“${input.language}”当前不受支持，原值已保留。`);
  if (input.operation === 'video.upscale' && ![2, 4, 8].includes(input.scale ?? 0))
    warnings.push(`保存的放大倍数“${input.scale}”当前不受支持，原值已保留。`);
  return {
    operation,
    model,
    warnings,
    providerId: input.providerId || operation?.providerId || '',
    modelId: input.modelId || model?.id || '',
  };
}
export async function saveAdvancedDraft(
  input: JobInput,
  context: { workspaceId: string; projectId: string | null; name: string; kind: 'image' | 'video' },
  dependencies: {
    request<T>(path: string, init: RequestInit, workspaceId: string): Promise<T>;
    persist(input: JobInput): void;
    isActive(): boolean;
  },
) {
  if (!dependencies.isActive()) return { projectId: context.projectId, saved: false };
  const project = context.projectId
    ? await dependencies.request<{ id: string }>(
        `/projects/${context.projectId}`,
        {},
        context.workspaceId,
      )
    : await dependencies.request<{ id: string }>(
        '/projects',
        {
          method: 'POST',
          body: JSON.stringify({
            name: context.name,
            kind: context.kind,
            description: input.prompt,
          }),
        },
        context.workspaceId,
      );
  const savedInput = { ...input, projectId: project.id };
  // Persist the original scope even if the user leaves while project creation is completing.
  dependencies.persist(savedInput);
  if (!dependencies.isActive()) return { projectId: project.id, saved: false };
  await dependencies.request(
    `/projects/${project.id}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        role: 'user',
        content: input.prompt || context.name,
        metadata: { draft: savedInput },
      }),
    },
    context.workspaceId,
  );
  return { projectId: project.id, saved: true };
}

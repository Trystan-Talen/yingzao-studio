import { useEffect, useState } from 'react';
import type {
  ModelConnectionDto,
  ModelDirectoryDto,
  ModelDiscoveryInput,
} from '../../contracts/model-connections';
import { api, ApiError, errorMessage } from './api';

type DirectoryDraft = Pick<ModelDiscoveryInput, 'baseUrl' | 'modelsUrl'> & {
  secret: string;
  removeSecret: boolean;
};
type Preview = { key: string; result?: ModelDirectoryDto; error?: string };

export function useModelDirectory(
  workspaceId: string,
  connection: ModelConnectionDto | undefined,
  draft: DirectoryDraft | undefined,
  busy: boolean,
  resourceId = 'primary',
) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState(0);
  const isDraft = !!(
    connection &&
    draft &&
    (draft.secret.trim() ||
      draft.removeSecret ||
      draft.baseUrl.trim() !== connection.baseUrl ||
      draft.modelsUrl.trim() !== connection.modelsUrl)
  );
  let input: ModelDiscoveryInput | null = null;
  if (isDraft && draft && connection && !draft.removeSecret) {
    try {
      const baseUrl = new URL(draft.baseUrl.trim());
      const hasKey =
        draft.secret.trim() ||
        (connection.configured && new URL(connection.baseUrl).origin === baseUrl.origin);
      if (baseUrl.protocol === 'https:' && baseUrl.hostname.includes('.') && hasKey)
        input = {
          kind: connection.kind,
          ...(resourceId !== 'primary' ? { resourceId } : {}),
          baseUrl: draft.baseUrl.trim(),
          modelsUrl: draft.modelsUrl.trim(),
          ...(draft.secret.trim() ? { secret: draft.secret.trim() } : {}),
        };
    } catch {
      // Incomplete URL input is expected while typing; do not send a request yet.
    }
  }
  // This key lives only in component memory; credentials never enter query caches or URLs.
  const body = input ? JSON.stringify(input) : null;
  const key = body
    ? JSON.stringify([workspaceId, resourceId, connection?.revision, body, attempt])
    : null;
  useEffect(() => {
    if (!body || !key || busy) return;
    const controller = new AbortController();
    setPreview({ key });
    const timer = setTimeout(() => {
      void api<ModelDirectoryDto>(
        '/model-connections/discover',
        { method: 'POST', body, signal: controller.signal, timeoutMs: 12_000 },
        workspaceId,
      )
        .then((result) => {
          if (!controller.signal.aborted) setPreview({ key, result });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setPreview({
              key,
              error:
                error instanceof ApiError && error.code === 'REQUEST_TIMEOUT'
                  ? '获取模型列表超时，请重试或手动填写模型。'
                  : errorMessage(error),
            });
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body, key, workspaceId, busy]);

  const current = key && preview?.key === key ? preview : null;
  return {
    isDraft,
    canDiscover: !!key,
    loading: !!key && !current?.result && !current?.error && !busy,
    result: current?.result,
    error: current?.error,
    retry: () => setAttempt((value) => value + 1),
  };
}

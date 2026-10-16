import { getLocale, t } from './i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
let activeWorkspace: string | null = null;
export function setApiWorkspace(id: string | null) {
  activeWorkspace = id;
}
export async function api<T>(
  path: string,
  init: RequestInit = {},
  workspaceOverride: string | null = activeWorkspace,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (workspaceOverride && !headers.has('x-workspace-id'))
    headers.set('x-workspace-id', workspaceOverride);
  if (init.body && !(init.body instanceof FormData))
    headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'NETWORK_ERROR',
      '网络连接中断，请恢复网络；已确认的任务请先核对提交结果。',
      0,
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  } | null;
  if (!response.ok)
    throw new ApiError(
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? `请求未完成（${response.status}），请稍后重试。`,
      response.status,
      payload?.error?.details,
    );
  if (!payload || !('data' in payload))
    throw new ApiError('INVALID_RESPONSE', '服务返回了无法识别的内容。', response.status);
  return payload.data as T;
}
export function post<T>(path: string, body?: unknown) {
  return api<T>(path, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
export function patch<T>(path: string, body: unknown) {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}
export function put<T>(path: string, body: unknown) {
  return api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}
export function remove<T>(path: string) {
  return api<T>(path, { method: 'DELETE' });
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export function qs(values: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  return params.size ? `?${params}` : '';
}
export function useApi<T>(path: string, enabled = true, interval?: number) {
  const workspaceId = activeWorkspace;
  return useQuery({
    queryKey: ['api', workspaceId, path],
    queryFn: ({ signal }) => api<T>(path, { signal }, workspaceId),
    enabled,
    retry: 1,
    ...(interval ? { refetchInterval: interval } : {}),
  });
}
export function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['api'] });
}
const brandErrorCopy: Readonly<Record<string, string>> = {
  ENTITLEMENT_LIMIT: '已达到对应合同的品牌数量上限',
  BRAND_QUOTA_INVALID: '品牌配额合同无效，请核对套餐配置',
};
export const errorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return '操作未完成，请重试。';
  // Only exact, known application errors are localized. Provider messages and
  // user-authored text, including lookalikes with a different code, stay intact.
  return error instanceof ApiError && brandErrorCopy[error.code] === error.message
    ? t(error.message)
    : error.message;
};
export const dateTime = (date: string | null | undefined) =>
  date
    ? new Intl.DateTimeFormat(getLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(date))
    : '—';
export const money = (minor: number, currency = 'CNY') =>
  new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(minor / 100);
export const bytes = (size: number) =>
  size < 1024 * 1024 ? `${(size / 1024).toFixed(0)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
export interface UploadOptions {
  uploadId?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  workspaceId?: string | null;
}
export function uploadAsset<T>(
  file: File,
  projectId?: string,
  options: UploadOptions = {},
): Promise<T> {
  const workspaceId = options.workspaceId === undefined ? activeWorkspace : options.workspaceId;
  const uploadId = options.uploadId ?? crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/v1/assets/upload');
    request.withCredentials = true;
    if (workspaceId) request.setRequestHeader('x-workspace-id', workspaceId);
    request.setRequestHeader('x-upload-id', uploadId);
    const abort = () => request.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    options.signal?.addEventListener('abort', abort, { once: true });
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      cleanup();
      let payload: {
        data?: T;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      } | null = null;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        /* Invalid responses are reported below. */
      }
      if (request.status < 200 || request.status >= 300) {
        reject(
          new ApiError(
            payload?.error?.code ?? 'UPLOAD_FAILED',
            payload?.error?.message ?? '素材上传未完成，请重试。',
            request.status,
            payload?.error?.details,
          ),
        );
      } else if (!payload || !('data' in payload))
        reject(new ApiError('INVALID_RESPONSE', '服务返回了无法识别的内容。', request.status));
      else {
        options.onProgress?.(100);
        resolve(payload.data as T);
      }
    };
    request.onerror = () => {
      cleanup();
      reject(new Error('上传连接中断，请重试。'));
    };
    request.onabort = () => {
      cleanup();
      reject(new DOMException('上传已取消。', 'AbortError'));
    };
    request.ontimeout = () => {
      cleanup();
      reject(new Error('素材上传超时，请重试。'));
    };
    request.timeout = 300000;
    const data = new FormData();
    data.set('file', file);
    if (projectId) data.set('projectId', projectId);
    if (options.signal?.aborted) {
      reject(new DOMException('上传已取消。', 'AbortError'));
      return;
    }
    request.send(data);
  });
}
export async function downloadFile(url: string, name: string) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers:
      activeWorkspace && new URL(url, location.origin).origin === location.origin
        ? { 'x-workspace-id': activeWorkspace }
        : {},
  });
  if (!response.ok) throw new Error('文件下载失败，请检查权限后重试。');
  const blob = await response.blob();
  if (!blob.size) throw new Error('文件内容为空。');
  const src = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = src;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(src), 1000);
}

export async function downloadPost(path: string, body: unknown, name: string) {
  const workspaceId = activeWorkspace;
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message ?? '文件下载失败，请稍后重试。');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('文件内容为空。');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

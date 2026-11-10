import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ModelCapability, OperationCapability } from '../../contracts/jobs';
import type {
  CapabilityParameterKey,
  ModelCapabilitiesDto,
} from '../../contracts/model-capabilities';
import { useStudio } from '../context';
import { api, qs } from './api';
import { t } from './i18n';

export interface ModelCapabilitySelection {
  operation?: OperationCapability;
  model?: ModelCapability;
  inputMode?: 'text' | 'image';
  enabled?: boolean;
}
export const capabilityParameterLabels: Record<CapabilityParameterKey, string> = {
  ratio: '画面比例',
  resolution: '清晰度',
  duration: '时长',
  quality: '质量',
  size: '尺寸',
  count: '数量',
  format: '格式',
  generateAudio: '生成音频',
};

export function capabilitySelectionIssue(
  data: ModelCapabilitiesDto | undefined,
  options: Partial<Record<CapabilityParameterKey, unknown>>,
): string | null {
  if (!data) return null;
  for (const parameter of data.parameters) {
    const value =
      parameter.key === 'generateAudio' ? (options.generateAudio ?? false) : options[parameter.key];
    if (value === undefined || parameter.key === 'quality' || parameter.key === 'size') continue;
    if (
      !parameter.values.some((allowed) =>
        typeof value === 'string' && typeof allowed === 'string'
          ? value.toLowerCase() === allowed.toLowerCase()
          : value === allowed,
      )
    )
      return t('“{parameter}”的当前值不受此模型支持。原值已保留，请重新选择。').replace(
        '{parameter}',
        t(capabilityParameterLabels[parameter.key]),
      );
  }
  if (typeof options.count === 'number' && options.count > data.maxCount)
    return t('当前模型最多支持 {count} 个结果。原数量已保留，请重新选择。').replace(
      '{count}',
      String(data.maxCount),
    );
  return null;
}

export function fixedCapabilityOptions(data: ModelCapabilitiesDto | undefined) {
  return Object.fromEntries(
    (data?.parameters ?? [])
      .filter(
        (parameter) =>
          !parameter.adjustable &&
          parameter.values.length === 1 &&
          parameter.key !== 'quality' &&
          parameter.key !== 'size',
      )
      .map((parameter) => [parameter.key, parameter.values[0]]),
  ) as Partial<Record<CapabilityParameterKey, string | number | boolean>>;
}

export function capabilityCanGenerate(
  data: ModelCapabilitiesDto | undefined,
  fetching: boolean,
  error: unknown,
  now = Date.now(),
) {
  return (
    !!data?.canGenerate &&
    Date.parse(data.expiresAt) > now &&
    !fetching &&
    !error &&
    data.parameters.every((parameter) => parameter.values.length > 0)
  );
}

export function capabilityMatchesSelection(
  data: ModelCapabilitiesDto | undefined,
  selection: ModelCapabilitySelection,
) {
  return (
    !!data &&
    data.providerId === selection.operation?.providerId &&
    data.operation === selection.operation?.id &&
    data.modelId === selection.model?.id &&
    data.inputMode === (selection.inputMode ?? 'text')
  );
}

export function modelCapabilityQueryOptions(
  selection: ModelCapabilitySelection,
  workspaceId: string | undefined,
) {
  const { operation, model: selectedModel, inputMode = 'text', enabled = true } = selection;
  return {
    queryKey: [
      'model-capability',
      workspaceId,
      operation?.providerId,
      operation?.id,
      selectedModel?.id,
      inputMode,
    ],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<ModelCapabilitiesDto>(
        `/capabilities/model${qs({
          providerId: operation!.providerId,
          operation: operation!.id,
          modelId: selectedModel!.id,
          inputMode,
          refresh: true,
        })}`,
        { signal, timeoutMs: 20000 },
        workspaceId!,
      ),
    enabled: !!workspaceId && !!operation && !!selectedModel && enabled,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
  };
}

/** One request scope per workspace and selection; consuming signal cancels abandoned fetches. */
export function useModelCapability(selection: ModelCapabilitySelection) {
  const { workspace } = useStudio();
  const { operation, model: selectedModel } = selection;
  const queryOptions = modelCapabilityQueryOptions(selection, workspace?.id);
  const active = queryOptions.enabled;
  const query = useQuery(queryOptions);
  const data = active && capabilityMatchesSelection(query.data, selection) ? query.data : undefined;
  const [, setExpirationTick] = useState(0);
  useEffect(() => {
    if (!data) return;
    const remaining = Date.parse(data.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(() => setExpirationTick((tick) => tick + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [data?.expiresAt]);
  const isExpired = !!data && !(Date.parse(data.expiresAt) > Date.now());
  return {
    data,
    model: data?.model ?? selectedModel,
    parameters: data?.parameters ?? [],
    maxCount: data?.maxCount ?? operation?.maxCount ?? 1,
    canGenerate:
      capabilityCanGenerate(data, query.isFetching, query.error) && operation?.available !== false,
    revision: data?.revision,
    isLoading: active && query.isPending,
    isFetching: active && query.isFetching,
    isExpired,
    error: query.error,
    canRefresh: active,
    refresh: () => (active ? query.refetch() : Promise.resolve(undefined)),
    fixedOptions: fixedCapabilityOptions(data),
    adjustable: (key: CapabilityParameterKey) =>
      data?.parameters.find((item) => item.key === key)?.adjustable !== false,
    selectionIssue: (options: Partial<Record<CapabilityParameterKey, unknown>>) =>
      capabilitySelectionIssue(data, options),
    supports: (key: CapabilityParameterKey, value: string | number | boolean) => {
      const parameter = data?.parameters.find((item) => item.key === key);
      return !!data && (!parameter || parameter.values.includes(value));
    },
  };
}
export type ModelCapabilityState = ReturnType<typeof useModelCapability>;

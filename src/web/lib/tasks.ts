import { TOOLS } from '../../contracts/catalog';
import { t } from './i18n';
import {
  jobInputSchema,
  jobOptionsSchema,
  type JobInput,
  type JobDto,
  type ModelCapability,
} from '../../contracts/jobs';
export type { JobInput };
export type {
  OperationCapability as Operation,
  CapabilitiesDto as Capabilities,
  QuoteDto as Quote,
} from '../../contracts/jobs';
export const statusLabels: Record<string, string> = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  partial: '部分完成',
  failed: '未完成',
  cancelled: '已取消',
  reconciliation_required: '等待核对',
};
export const modelValue = (model: ModelCapability) => model.id;
export const modelName = (model: ModelCapability) => model.name;
export const finished = (status: string) =>
  ['succeeded', 'failed', 'partial', 'cancelled'].includes(status);
export function jobInput(value: Record<string, unknown>): JobInput {
  // Forms must preserve incomplete numeric/text input without throwing during render.
  // Validation happens at JobSubmit and again at the server before any charge.
  const result = jobInputSchema.safeParse(value);
  if (result.success) return result.data;
  return {
    operation: value.operation as JobInput['operation'],
    providerId: value.providerId as JobInput['providerId'],
    prompt: '',
    assetIds: [],
    referenceAssetIds: [],
    ...value,
    options: {
      ...jobOptionsSchema.parse({}),
      ...((value.options as Record<string, unknown>) ?? {}),
    },
  } as JobInput;
}
export type Job = JobDto;

export function operationName(id: string): string {
  return t(
    TOOLS.find((tool) => tool.id === id)?.name ??
      (
        {
          'image.generate': '图片创作',
          'video.generate': '视频创作',
          'text.assist': 'AI 创作助手',
          'image.ocr': '图片文字识别',
          'image.text-edit': '图片改字',
          'image.layers': '图层拆分',
          'video.extend': '视频延长',
          'video.edit': '视频编辑',
          'video.upscale': '视频超分',
          'video.erase-subtitles': '视频去字幕',
          'video.translate': '视频翻译',
          'local.resize': '图片缩放',
          'local.convert': '格式转换',
          'local.stitch': '长图拼接',
          'local.video-trim': '视频裁剪',
        } as Record<string, string>
      )[id] ??
      id,
  );
}

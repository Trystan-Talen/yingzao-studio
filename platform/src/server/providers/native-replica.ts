import { createHash } from 'node:crypto';
import type { NativeReplica } from '../../contracts/native-replica';
import type { ExecutionContext } from '../tasks/types';
import { ProviderError } from '../tasks/types';
import { prepareNativeReferenceMedia } from './native-reference-media';

const aspectNames = {
  composition: '构图与留白',
  lighting: '布光与材质表现',
  palette: '背景配色',
  camera: '镜头运动',
  pacing: '动作节奏',
};
export function replicaImagePrompt(prompt: string, replica: NativeReplica): string {
  const aspects = replica.intent.aspects
    .filter((value) => value !== 'camera' && value !== 'pacing')
    .map((value) => aspectNames[value]);
  if (replica.renderStrategy === 'subject-edit-v1')
    return [
      '这是基于所附主体原图的编辑任务。只提供一张图，它是主体身份与几何结构的唯一依据；风格参考已经在前序视觉分析中转化为下面的场景说明，不存在图2。',
      '最高优先保留原商品：沿用原图视角和透视，完整保持轮廓、各部件接缝位置及部件之间的长宽比例，不重绘成相似商品，不局部拉长、压短或加粗。若构图需要移动或缩放，只能对整个主体进行同一比例的整体调整，不能分别改变部件尺寸。保留本色、已有标识和细节；背景、光照与构图变化不得改变商品结构。',
      `已确认的参考维度：${aspects.join('、') || '整体画面组织'}。仅按下面方案调整这些画面表现；用户明确要求优先。不要引入参考作品里的其他商品、人物、品牌或文案。`,
      prompt,
      '完成前对照原图检查各部件相对长度、宽度和连接位置。只输出一张完成画面，不输出对比图、拼图或说明文字。',
    ].join('\n\n');
  return [
    prompt,
    '素材职责：图1是自己的主体，是主体身份的唯一依据；图2是参考作品，仅用于画面表现。完整保留图1主体的轮廓比例、结构、部件、材质、本色和已有标识，不复制图2的商品、人物身份、品牌标识或文案。不得混合两图的主体。',
    `参考图2仅借鉴已选择的：${aspects.join('、') || '整体画面组织'}。用户明确的背景色和主体要求优先。按输出比例调整场景与留白，不拉伸主体；只输出单张完成画面。`,
  ].join('\n\n');
}

/** Read only owned job assets; verify frozen provenance before any paid image call. */
export async function nativeReplicaImages(context: ExecutionContext) {
  const replica = context.input.nativeReplica;
  if (
    !context.input.replica ||
    !replica ||
    JSON.stringify(replica.intent) !== JSON.stringify(context.input.replica)
  )
    throw new ProviderError('复刻任务缺少已确认且匹配的视觉分析，请重新整理。');
  const [subject, reference] = await Promise.all([
    context.readAsset(replica.intent.subjectAssetId),
    context.readAsset(replica.intent.referenceAssetId),
  ]);
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  if (
    hash(subject.buffer) !== replica.evidence.subjectSha256 ||
    hash(reference.buffer) !== replica.evidence.referenceSha256
  )
    throw new ProviderError('复刻原件与确认分析时不同，已停止生成，请重新选择素材并整理。');
  if (replica.renderStrategy === 'subject-edit-v1') return [subject];
  if (replica.study.referenceKind === 'image') return [subject, reference];
  const media = await prepareNativeReferenceMedia({
    referenceKind: 'video',
    subject,
    reference,
    sampleCount: replica.evidence.frames.length,
    trimStartSeconds: replica.evidence.clipStartSeconds,
    trimDurationSeconds: replica.evidence.clipDurationSeconds,
  });
  const index = replica.study.anchorFrameIndex;
  const anchor = media.frames[index];
  const original = replica.evidence.frames[index];
  if (
    !anchor ||
    !original ||
    anchor.sha256 !== original.sha256 ||
    anchor.sourceTimestampSeconds !== original.sourceTimestampSeconds
  )
    throw new ProviderError('视频参考采样与确认时不一致，已停止生成；不会静默换用其他帧。');
  return [subject, anchor];
}

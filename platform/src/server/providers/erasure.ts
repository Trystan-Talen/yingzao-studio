import sharp from 'sharp';
import { canonicalImage } from './image-input';
import { ProviderError, type ExecutionContext } from '../tasks/types';

type ImageFile = { buffer: Buffer; mimeType: string; name?: string };
async function eraseInputs(source: ImageFile, mask: ImageFile) {
  const image = await canonicalImage(source);
  const metadata = await sharp(mask.buffer, { limitInputPixels: 64_000_000 }).metadata();
  if (!metadata.hasAlpha || metadata.width !== image.width || metadata.height !== image.height)
    throw new ProviderError('消除蒙版必须包含透明编辑区域，并与原图显示尺寸一致。');
  const stats = await sharp(mask.buffer).stats();
  if (stats.channels.at(-1)?.min === 255)
    throw new ProviderError('消除蒙版没有有效透明区域，请先涂画需要移除的物体。');
  const editAlpha = await sharp(mask.buffer).extractChannel('alpha').negate().toBuffer();
  return { image, editAlpha };
}

export async function buildFalErasureRequest(context: ExecutionContext) {
  const input = context.input;
  if (input.assetIds.length !== 1 || !input.maskAssetId || input.referenceAssetIds.length)
    throw new ProviderError('消除需要一张原图和一张蒙版，不接受替换参考。');
  if (input.prompt.trim()) throw new ProviderError('Bria消除不支持补充说明，请选择OpenAI服务。');
  const source = await context.readAsset(input.assetIds[0]!);
  const mask = await context.readAsset(input.maskAssetId);
  const { image, editAlpha } = await eraseInputs(source, mask);
  if (image.width * image.height > 25_000_000)
    throw new ProviderError('此消除模型最多2500万像素，请先缩小图片。');
  const whiteMask = await sharp(editAlpha).threshold(127).png().toBuffer();
  return {
    image_url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
    mask_url: `data:image/png;base64,${whiteMask.toString('base64')}`,
    mask_type: 'manual',
    preserve_alpha: true,
  };
}

/** Imported eraser results can change only the user's painted region. */
export async function composeErasureResult(source: ImageFile, mask: ImageFile, generated: Buffer) {
  const { image, editAlpha } = await eraseInputs(source, mask);
  const resized = await sharp(generated, { limitInputPixels: 64_000_000 })
    .rotate()
    .resize(image.width, image.height, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const overlay = await sharp(resized.data, { raw: resized.info })
    .joinChannel(editAlpha)
    .png()
    .toBuffer();
  return sharp(image.buffer, { limitInputPixels: 64_000_000 })
    .composite([{ input: overlay, blend: 'over' }])
    .png()
    .toBuffer();
}

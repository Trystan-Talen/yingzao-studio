import sharp from 'sharp';
import { ProviderError } from '../tasks/types';

/** Provider coordinates use the same upright pixels as browser previews; stored originals stay unchanged. */
export async function canonicalImage(file: { buffer: Buffer; mimeType: string }) {
  if (!file.mimeType.startsWith('image/')) throw new ProviderError('模型参考素材必须是图片。');
  const metadata = await sharp(file.buffer, { limitInputPixels: 64_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new ProviderError('图片尺寸无效。');
  if (metadata.orientation && metadata.orientation !== 1) {
    const result = await sharp(file.buffer, { limitInputPixels: 64_000_000 })
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: result.data,
      mimeType: 'image/png',
      width: result.info.width,
      height: result.info.height,
    };
  }
  return { ...file, width: metadata.width, height: metadata.height };
}

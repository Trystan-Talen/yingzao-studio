import sharp from 'sharp';
import type JSZip from 'jszip';
import type { Actor } from '../../contracts/core';
import { AppError } from '../errors';
import type { TaskServices } from './service';
import type { createDetailPageServices } from './detail-pages';

type DetailPageView = ReturnType<ReturnType<typeof createDetailPageServices>['get']>;
export async function addDetailPageToArchive(
  archive: JSZip,
  tasks: TaskServices,
  actor: Actor,
  wid: string,
  view: DetailPageView,
): Promise<number> {
  if (!view.complete)
    throw new AppError(
      409,
      'DETAIL_PAGE_INCOMPLETE',
      '整套详情页尚有未完成屏幕；请先恢复已有结果或重新估价失败项，单屏可独立下载',
    );
  const pieces: { input: Buffer; left: number; top: number }[] = [];
  let height = 0;
  const manifest = [];
  for (const screen of view.screens) {
    const asset = screen.outputAssets[0]!;
    const file = await tasks.core.assets.readOriginal(actor, wid, asset.id);
    const title = view.plan.screens[screen.index]!.title.replace(/[\\/\u0000-\u001f]/g, '_');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[
      asset.mimeType
    ];
    if (!extension)
      throw new AppError(409, 'DETAIL_PAGE_MEDIA_INVALID', '详情页包含无法导出的图片格式');
    const filename = `${String(screen.index + 1).padStart(2, '0')}-${title}.${extension}`;
    archive.file(`${view.job.id}/screens/${filename}`, file.buffer);
    const piece = await sharp(file.buffer, { limitInputPixels: 64_000_000 })
      .rotate()
      .resize({ width: 750, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (height + piece.info.height > 16000)
      throw new AppError(
        413,
        'DETAIL_PAGE_EXPORT_SIZE',
        '整套长图超过16000像素高度，请调整屏幕比例后重试',
      );
    pieces.push({ input: piece.data, top: height, left: 0 });
    height += piece.info.height;
    manifest.push({
      screenId: screen.screenId,
      index: screen.index,
      title: view.plan.screens[screen.index]!.title,
      file: `screens/${filename}`,
      jobId: screen.jobId,
      itemId: screen.item!.id,
      assetId: asset.id,
      width: asset.width,
      height: asset.height,
    });
  }
  const longImage = await sharp({
    create: { width: 750, height, channels: 3, background: '#ffffff' },
  })
    .composite(pieces)
    .jpeg({ quality: 92 })
    .toBuffer();
  archive.file(`${view.job.id}/detail-page-750w.jpg`, longImage);
  archive.file(
    `${view.job.id}/detail-page-manifest.json`,
    JSON.stringify(
      {
        formatVersion: 1,
        plan: view.plan,
        complete: true,
        screens: manifest,
        longImage: { file: 'detail-page-750w.jpg', width: 750, height },
      },
      null,
      2,
    ),
  );
  return view.screens.length;
}

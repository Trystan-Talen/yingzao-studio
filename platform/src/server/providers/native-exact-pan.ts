import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { nativeReferenceFrameIssue } from '../../contracts/native-plan';
import { canonicalImage } from './image-input';
import { ProviderError, type ExecutionContext, type ProviderResult } from '../tasks/types';

const exec = promisify(execFile);
const FPS = 24;
const OVERSAMPLE = 4;

/** A disclosed cropped-photo animation, not a generated three-dimensional camera move.
 * The viewport follows one easing curve over one immutable image. Oversampling bounds
 * FFmpeg's integer crop increments to a quarter output pixel, avoiding visible stepping.
 */
export async function renderExactPan(
  context: ExecutionContext,
  outputSize: readonly [number, number],
): Promise<ProviderResult> {
  const input = context.input;
  const plan = input.nativePlan;
  const frame = plan?.firstFrame;
  const control = plan?.cameraControl;
  const [width, height] = outputSize;
  if (
    plan?.motionRenderer !== 'exact-pan-v1' ||
    frame?.mode !== 'reference' ||
    control?.type !== 'translate' ||
    ![...input.assetIds, ...input.referenceAssetIds].includes(frame.assetId) ||
    !Number.isFinite(control.displacementPercent) ||
    control.displacementPercent < 1 ||
    control.displacementPercent > 3 ||
    !['left', 'right'].includes(control.direction) ||
    ![5, 10].includes(input.options.duration) ||
    ![width, height].every((value) => Number.isSafeInteger(value) && value >= 64 && value <= 1920)
  )
    throw new ProviderError('精确平移缺少已确认的原图、方向、幅度或交付规格。');

  const source = await canonicalImage(await context.readAsset(frame.assetId));
  if (nativeReferenceFrameIssue({ ...source, byteSize: source.buffer.length }, input.options.ratio))
    throw new ProviderError('精确平移原图尺寸或比例不符合已确认参数，已停止处理。');

  const viewportWidth = width * OVERSAMPLE;
  const viewportHeight = height * OVERSAMPLE;
  const travel = Math.round((viewportWidth * control.displacementPercent) / 100);
  // Enlarge once, uniformly. The original image supplies all pixels, including the
  // travel margin; no mirrored strip, repeated edge, or invented background is used.
  const canvas = await sharp(source.buffer, { limitInputPixels: 36_000_000 })
    .rotate()
    .resize({ width: viewportWidth + travel })
    .png()
    .toBuffer({ resolveWithObject: true });
  if (canvas.info.height < viewportHeight)
    throw new ProviderError('原图没有足够的取景余量，未拉伸或补画画面。');
  const y = Math.floor((canvas.info.height - viewportHeight) / 2);
  const movingFrames = Math.round((input.options.duration - 0.5) * FPS);
  const progress = `min(n/${movingFrames},1)`;
  // The confirmed static-pan timeline decelerates throughout the moving portion.
  // Smoothstep would first accelerate, contradicting that instruction despite
  // reaching the correct endpoint and holding the final half second.
  const eased = `1-(1-(${progress}))*(1-(${progress}))*(1-(${progress}))`;
  const x =
    control.direction === 'right'
      ? `round(${travel}*(${eased}))`
      : `${travel}-round(${travel}*(${eased}))`;
  const filter =
    `crop=w=${viewportWidth}:h=${viewportHeight}:x='${x}':y=${y}:exact=1,` +
    `scale=${width}:${height}:flags=lanczos:out_color_matrix=bt709:out_range=tv,setsar=1`;
  const directory = await mkdtemp(join(tmpdir(), 'yingzao-exact-pan-'));
  try {
    context.onStage?.('正在本机合成静态图精确平移');
    const sourcePath = join(directory, 'source.png');
    const outputPath = join(directory, 'result.mp4');
    await writeFile(sourcePath, canvas.data);
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-loop',
        '1',
        '-framerate',
        String(FPS),
        '-i',
        sourcePath,
        '-vf',
        filter,
        '-frames:v',
        String(input.options.duration * FPS),
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '12',
        '-pix_fmt',
        'yuv420p',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-color_range',
        'tv',
        '-threads',
        '2',
        '-movflags',
        '+faststart',
        '-y',
        outputPath,
      ],
      { timeout: 180000, maxBuffer: 1024 * 1024 },
    );
    return {
      state: 'complete',
      outputs: [
        {
          buffer: await readFile(outputPath),
          mimeType: 'video/mp4',
          name: '静态图精确平移.mp4',
          text: `静态图精确平移，由本机合成，未调用视频模型。为预留横移取景余量，原图先等比放大约${control.displacementPercent}%，仅裁切边缘背景；主体没有重新生成。移动段持续平滑减速，最后0.5秒停稳。`,
          processing: {
            method: 'exact-pan-v1',
            sourceAssetId: frame.assetId,
            params: {
              cameraDirection: control.direction,
              displacementPercent: (travel / viewportWidth) * 100,
              initialScalePercent: (canvas.info.width / viewportWidth) * 100,
              duration: input.options.duration,
              fps: FPS,
              stopSeconds: 0.5,
              easing: 'ease-out-cubic-v2',
              edgeFill: 'none',
            },
          },
        },
      ],
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('本机精确平移处理失败，请检查媒体工具后恢复处理；未提交视频模型。');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

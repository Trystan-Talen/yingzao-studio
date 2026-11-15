import sharp from 'sharp';
import { nativeCameraControlSchema } from '../../contracts/native-plan';
import type { JobInput } from '../../contracts/jobs';

/** A deterministic endpoint for a confirmed tiny pan or centered zoom. Pans copy source
 * pixels, mirroring only the newly exposed strip; zooms resample uniformly and crop centrally.
 * This is an endpoint guide for a generative video, not proof of its intermediate frames.
 */
export async function nativeMotionEndFrame(
  source: Buffer,
  control: NonNullable<NonNullable<JobInput['nativePlan']>['cameraControl']>,
): Promise<Buffer> {
  const motion = nativeCameraControlSchema.parse(control);
  const pipeline = sharp(source, { limitInputPixels: 36_000_000 }).rotate();
  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
  if (motion.type === 'zoom') {
    // Set only the width so Sharp preserves the source aspect ratio. Materialize
    // before cropping: the endpoint keeps its original dimensions and fixed center.
    const enlarged = await sharp(data)
      .resize({ width: Math.round((info.width * motion.scalePercent) / 100) })
      .png()
      .toBuffer({ resolveWithObject: true });
    return sharp(enlarged.data)
      .extract({
        left: Math.floor((enlarged.info.width - info.width) / 2),
        top: Math.floor((enlarged.info.height - info.height) / 2),
        width: info.width,
        height: info.height,
      })
      .png()
      .toBuffer();
  }
  const shift = Math.max(1, Math.round((info.width * motion.displacementPercent) / 100));
  // Moving the camera right shifts the scene left. The subject never rotates or scales.
  const extended = await sharp(data)
    .extend({
      top: 0,
      bottom: 0,
      left: motion.direction === 'left' ? shift : 0,
      right: motion.direction === 'right' ? shift : 0,
      extendWith: 'mirror',
    })
    .png()
    .toBuffer();
  // Sharp schedules extraction before extension in one pipeline. Materialize the
  // extension so both directions extract from the actual enlarged canvas.
  return sharp(extended)
    .extract({
      left: motion.direction === 'right' ? shift : 0,
      top: 0,
      width: info.width,
      height: info.height,
    })
    .png()
    .toBuffer();
}

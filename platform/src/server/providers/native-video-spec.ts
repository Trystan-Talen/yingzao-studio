import type { JobInput } from '../../contracts/jobs';
import { isKnownSeedance2Model } from '../../contracts/native-plan';

/** Verified Seedance 2.0 720p tier dimensions, shared by planning and artifact checks.
 * https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh
 */
export const NATIVE_VIDEO_720P_DIMENSIONS: Record<string, readonly [number, number]> = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [960, 960],
  '4:3': [1112, 834],
  '3:4': [834, 1112],
  '21:9': [1470, 630],
};

export function expectedNativeVideoSize(input: JobInput): readonly [number, number] | undefined {
  if (
    input.options.resolution !== '720p' ||
    !Object.hasOwn(NATIVE_VIDEO_720P_DIMENSIONS, input.options.ratio)
  )
    return undefined;
  if (isKnownSeedance2Model(input.options.model ?? ''))
    return NATIVE_VIDEO_720P_DIMENSIONS[input.options.ratio];
  // Unknown aliases retain their existing gateway contract; a wire protocol alone
  // does not establish that the underlying model belongs to the Seedance family.
  const [rw, rh] = input.options.ratio.split(':').map(Number);
  const scale = 720 / Math.min(rw!, rh!);
  return [Math.round((rw! * scale) / 2) * 2, Math.round((rh! * scale) / 2) * 2];
}

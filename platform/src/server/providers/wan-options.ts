import type { JobInput } from '../../contracts/jobs';
import { ProviderError } from '../tasks/types';

// Standard Wan 2.6 endpoints have no subtitle/language fields. These are prompt
// directions, not a promise of exact text rendering or a post-production track.
// https://fal.ai/models/wan/v2.6/text-to-video/api
// https://fal.ai/models/wan/v2.6/image-to-video/api
export function buildWanPrompt(input: JobInput): string {
  const instruction = input.options.needText
    ? `On-screen text direction: use ${input.options.language} for any requested visible copy or captions. Preserve user-provided product facts. This is visual text guidance, not a precise subtitle track.`
    : 'Do not add on-screen text, lettering, captions or subtitles. Preserve any text already present in the source image.';
  const prompt = `${input.prompt.trim()}\n\n${instruction}`;
  if (prompt.length > 1500)
    throw new ProviderError('包含画面文字指引后的Wan需求超过1500字符，请精简创作说明。');
  return prompt;
}

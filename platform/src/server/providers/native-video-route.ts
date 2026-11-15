/** A known gateway uses its OpenAI-video host route for model aliases. Keep this
 * exception scoped to the exact configured collection and retain native polling.
 * Its Doubao task plugin forwards metadata.content, including first_frame roles:
 * https://github.com/QuantumNous/new-api-plugins/blob/main/plugins/tasks/doubao/1.0.0/plugin.js
 */
const xingyunTaskCollection = 'https://xingyunyinli.com/doubao/api/v3/contents/generations/tasks';

export function nativeVideoSubmission(
  endpoint: string,
  input: {
    model: string;
    prompt: string;
    frameUrl: string;
    lastFrameUrl?: string;
    resolution: string;
    ratio: string;
    duration: number;
  },
): { url: string; body: Record<string, unknown> } {
  const frame = {
    type: 'image_url',
    image_url: { url: input.frameUrl },
    role: 'first_frame',
  };
  const frames = [
    frame,
    ...(input.lastFrameUrl
      ? [
          {
            type: 'image_url',
            image_url: { url: input.lastFrameUrl },
            role: 'last_frame',
          },
        ]
      : []),
  ];
  const options = {
    resolution: input.resolution.toLowerCase(),
    ratio: input.ratio,
    generate_audio: false,
    watermark: false,
  };
  if (endpoint === xingyunTaskCollection) {
    return {
      url: new URL('/v1/videos', endpoint).href,
      body: {
        model: input.model,
        prompt: input.prompt,
        seconds: input.duration,
        metadata: { ...options, content: frames },
      },
    };
  }
  return {
    url: endpoint,
    body: {
      model: input.model,
      content: [{ type: 'text', text: input.prompt }, ...frames],
      ...options,
      duration: input.duration,
    },
  };
}

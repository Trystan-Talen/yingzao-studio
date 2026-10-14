/** Deterministic protocol fixtures; these tests do not call paid services or verify model quality. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import { providerJson } from '../src/server/providers/http';
import {
  buildFalExtraRequest,
  FAL_EXTRA_ENDPOINTS,
  FAL_TRANSLATION_LANGUAGES,
  falExtraProvider,
  isFalExtraEndpoint,
  isFalExtraOperation,
  validateFalExtraOptions,
  validateFalExtraVideo,
} from '../src/server/providers/fal-extra';
import { type ExecutionContext, ProviderError, type RemoteTask } from '../src/server/tasks/types';
vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const http = vi.mocked(providerJson);
const sourceId = randomUUID(),
  referenceId = randomUUID();
function input(
  operation: JobInput['operation'],
  options: Record<string, unknown> = {},
  changes: Partial<JobInput> = {},
) {
  return jobInputSchema.parse({
    operation,
    providerId: 'fal',
    assetIds: [sourceId],
    prompt: 'Replace the product with the reference product.',
    options,
    ...changes,
  });
}
function context(i: JobInput, reference?: Buffer): ExecutionContext {
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: i,
    readAsset: async (id) =>
      id === referenceId
        ? {
            buffer: reference || Buffer.from('fixture'),
            mimeType: 'image/png',
            name: 'reference.png',
          }
        : {
            buffer: Buffer.from('fixture'),
            mimeType: i.operation === 'image.layers' ? 'image/png' : 'video/mp4',
            name: 'source',
          },
  };
}
const metadata = { width: 1280, height: 720, duration: 5, fps: 30 };
const probe = vi.fn(async () => metadata);
function remote(endpoint: string = FAL_EXTRA_ENDPOINTS['video.edit']): RemoteTask {
  return {
    id: 'fixture-request',
    endpoint,
    statusUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/fixture-request/status',
    responseUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/fixture-request',
    cancelUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/fixture-request/cancel',
  };
}
function response(r = remote()) {
  return {
    request_id: r.id,
    status_url: r.statusUrl,
    response_url: r.responseUrl,
    cancel_url: r.cancelUrl,
  };
}
function schema(endpoint: string) {
  const path = resolve('../research/fal-extra-schemas', endpoint.replaceAll('/', '--') + '.json');
  return JSON.parse(readFileSync(path, 'utf8')) as {
    components: {
      schemas: Record<
        string,
        { required?: string[]; properties?: Record<string, { enum?: string[] }> }
      >;
    };
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
describe('official fal extra request contracts', () => {
  it('builds seven operations with only documented input keys and all required keys', async () => {
    for (const operation of Object.keys(
      FAL_EXTRA_ENDPOINTS,
    ) as (keyof typeof FAL_EXTRA_ENDPOINTS)[]) {
      const { endpoint, body } = await buildFalExtraRequest(
        context(input(operation)),
        operation === 'video.erase-subtitles' ? async () => ({ ...metadata, duration: 4 }) : probe,
      );
      const definition = Object.entries(schema(endpoint).components.schemas).find(
        ([name]) => name.endsWith('Input') && !name.includes('Element'),
      )?.[1];
      expect(definition).toBeDefined();
      for (const key of Object.keys(body)) expect(definition?.properties).toHaveProperty(key);
      for (const key of definition?.required || []) expect(body).toHaveProperty(key);
    }
  });
  it('uses image references in order and preserves original audio without claiming exact reproduction', async () => {
    const png = await sharp({
      create: { width: 300, height: 300, channels: 4, background: '#246fff' },
    })
      .png()
      .toBuffer();
    const { body } = await buildFalExtraRequest(
      context(
        input(
          'video-replica',
          { mode: 'exact', keepMusicRhythm: true },
          { referenceAssetIds: [referenceId] },
        ),
        png,
      ),
      probe,
    );
    expect(body).toMatchObject({ keep_audio: true, enable_safety_checker: true });
    expect(body.prompt).toContain('@Image1');
    expect(body).not.toHaveProperty('mode');
    expect(body).not.toHaveProperty('duration');
    expect(body.image_urls).toEqual([`data:image/png;base64,${png.toString('base64')}`]);
  });
  it('refuses undersized Kling references before submission', async () => {
    const png = await sharp({
      create: { width: 128, height: 300, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(
      buildFalExtraRequest(
        context(input('video.edit', {}, { referenceAssetIds: [referenceId] }), png),
        probe,
      ),
    ).rejects.toThrow('至少 300');
    expect(http).not.toHaveBeenCalled();
  });
  it('keeps batch count distinct from four semantic layers and never requests data URI outputs', async () => {
    const { body } = await buildFalExtraRequest(
      context(input('image.layers', { count: 8 })),
      probe,
    );
    expect(body).toMatchObject({
      num_layers: 4,
      output_format: 'png',
      sync_mode: false,
      enable_safety_checker: true,
    });
    expect(probe).not.toHaveBeenCalled();
  });
  it('extends a fixed 24fps interval with an optional ending reference', async () => {
    const { body } = await buildFalExtraRequest(
      context(input('video.extend', { duration: 20 }, { referenceAssetIds: [referenceId] })),
      probe,
    );
    expect(body).toMatchObject({
      num_frames: 481,
      fps: 24,
      match_input_fps: false,
      extend_direction: 'forward',
      generate_audio: true,
    });
    expect(body.end_image_url).toMatch(/^data:image\/png;base64,/);
    expect(() => validateFalExtraOptions(input('video.extend', { duration: 21 }))).toThrow('2–20');
  });
  it('maps all 18 UI languages to exact HeyGen enums; unknown language is rejected', async () => {
    const d = schema(FAL_EXTRA_ENDPOINTS['video.translate']);
    const languages =
      d.components.schemas.HeygenV2TranslatePrecisionInput?.properties?.output_language?.enum;
    expect(Object.keys(FAL_TRANSLATION_LANGUAGES)).toHaveLength(18);
    for (const [language, value] of Object.entries(FAL_TRANSLATION_LANGUAGES)) {
      expect(languages).toContain(value);
      const { body } = await buildFalExtraRequest(
        context(input('video.translate', { language })),
        probe,
      );
      expect(body.output_language).toBe(value);
    }
    expect(() =>
      validateFalExtraOptions(input('video.translate', { language: 'unknown' })),
    ).toThrow('目标语言');
  });
  it('rejects unsupported source counts, masks, references, and excessive edit prompts', () => {
    expect(() =>
      validateFalExtraOptions(input('video.edit', {}, { assetIds: [sourceId, referenceId] })),
    ).toThrow('一份');
    expect(() =>
      validateFalExtraOptions(input('image.layers', {}, { maskAssetId: referenceId })),
    ).toThrow('遮罩');
    expect(() =>
      validateFalExtraOptions(input('video.upscale', {}, { referenceAssetIds: [referenceId] })),
    ).toThrow('0 张');
    expect(() =>
      validateFalExtraOptions(input('video.edit', {}, { prompt: 'x'.repeat(2101) })),
    ).toThrow('2100');
  });
  it('enforces actual source duration, dimensions, fps and translation duration limits', () => {
    for (const change of [
      { duration: 2.9 },
      { duration: 10.06 },
      { width: 640 },
      { height: 2161 },
      { fps: 23 },
      { fps: 61 },
    ])
      expect(() => validateFalExtraVideo('video.edit', { ...metadata, ...change })).toThrow(
        'Kling',
      );
    expect(() =>
      validateFalExtraVideo('video.edit', { ...metadata, duration: 10.05 }),
    ).not.toThrow();
    expect(() =>
      validateFalExtraVideo('video.translate', { ...metadata, duration: 480.1 }),
    ).toThrow('8 分钟');
  });
  it('rejects corrupted video using actual ffprobe before a paid API request', async () => {
    await expect(
      falExtraProvider.execute(context(input('video.edit')), 'fixture-not-a-key'),
    ).rejects.toThrow('无法验证视频');
    expect(http).not.toHaveBeenCalled();
  });
});
describe('durable extra queue protocol', () => {
  it('requires credentials and only recognizes declared operations/endpoints', async () => {
    await expect(falExtraProvider.execute(context(input('image.layers')))).rejects.toThrow('连接');
    expect(isFalExtraOperation('toString')).toBe(false);
    expect(isFalExtraOperation('video.erase-subtitles')).toBe(true);
    expect(isFalExtraOperation('video.unknown')).toBe(false);
    expect(isFalExtraEndpoint('https://queue.fal.run/other')).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });
  it('stores returned queue addresses and endpoint so recovery does not re-submit', async () => {
    const r = remote(FAL_EXTRA_ENDPOINTS['image.layers']);
    http.mockResolvedValueOnce(response(r));
    await expect(
      falExtraProvider.execute(context(input('image.layers')), 'fixture-not-a-key'),
    ).resolves.toEqual({ state: 'submitted', remote: r });
    expect(http).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledWith(
      'https://queue.fal.run/fal-ai/qwen-image-layered',
      expect.objectContaining({
        submission: true,
        headers: { Authorization: 'Key fixture-not-a-key', 'X-Fal-No-Retry': '1' },
      }),
    );
  });
  it('marks malformed or untrusted submission responses ambiguous and never retries POST', async () => {
    for (const invalid of [
      {},
      { ...response(), status_url: 'https://evil.invalid/status' },
      { ...response(), response_url: 'https://user:pass@queue.fal.run/task' },
    ]) {
      http.mockResolvedValueOnce(invalid);
      await expect(
        falExtraProvider.execute(context(input('image.layers')), 'fixture-not-a-key'),
      ).rejects.toMatchObject({ ambiguous: true });
    }
    expect(http).toHaveBeenCalledTimes(3);
  });
  it('preserves ambiguous network failures without retrying', async () => {
    http.mockRejectedValueOnce(new ProviderError('connection lost', true));
    await expect(
      falExtraProvider.execute(context(input('image.layers')), 'fixture-not-a-key'),
    ).rejects.toMatchObject({ ambiguous: true });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('does not fetch results while queued', async () => {
    http.mockResolvedValueOnce({ status: 'IN_QUEUE' });
    await expect(falExtraProvider.poll!(remote(), 'fixture')).resolves.toMatchObject({
      state: 'running',
    });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('returns every RGBA layer in original stable response order under explicit layer semantics', async () => {
    http.mockResolvedValueOnce({ status: 'COMPLETED' }).mockResolvedValueOnce({
      images: [
        { url: 'https://media.example/layer-a.png', content_type: 'image/png' },
        { url: 'https://media.example/layer-b.png', content_type: null },
      ],
      has_nsfw_concepts: [false, false],
    });
    const result = await falExtraProvider.poll!(
      remote(FAL_EXTRA_ENDPOINTS['image.layers']),
      'fixture',
    );
    expect(result).toMatchObject({
      state: 'complete',
      outputKind: 'layers',
      outputs: [
        { url: 'https://media.example/layer-a.png', name: '语义分层-1.png' },
        { url: 'https://media.example/layer-b.png', name: '语义分层-2.png' },
      ],
    });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('refuses safety-flagged layers instead of passing black placeholder images as success', async () => {
    http.mockResolvedValueOnce({ status: 'COMPLETED' }).mockResolvedValueOnce({
      images: [{ url: 'https://media.example/black.png' }],
      has_nsfw_concepts: [true],
    });
    await expect(
      falExtraProvider.poll!(remote(FAL_EXTRA_ENDPOINTS['image.layers']), 'fixture'),
    ).resolves.toMatchObject({ state: 'failed' });
  });
  it('rejects empty layers, undocumented oversized output batches, and wrong media type', async () => {
    for (const images of [
      [],
      Array.from({ length: 11 }, () => ({ url: 'https://media.example/x.png' })),
      [{ url: 'https://media.example/x.mp4', content_type: 'video/mp4' }],
    ]) {
      http
        .mockResolvedValueOnce({ status: 'COMPLETED' })
        .mockResolvedValueOnce({ images, has_nsfw_concepts: [] });
      await expect(
        falExtraProvider.poll!(remote(FAL_EXTRA_ENDPOINTS['image.layers']), 'fixture'),
      ).rejects.toThrow();
    }
  });
  it('accepts nullable video MIME but rejects an unsafe output URL', async () => {
    http
      .mockResolvedValueOnce({ status: 'COMPLETED' })
      .mockResolvedValueOnce({ video: { url: 'https://media.example/x.mp4', content_type: null } });
    await expect(falExtraProvider.poll!(remote(), 'fixture')).resolves.toMatchObject({
      state: 'complete',
      outputs: [{ mimeType: 'video/mp4' }],
    });
    http
      .mockResolvedValueOnce({ status: 'COMPLETED' })
      .mockResolvedValueOnce({ video: { url: 'http://127.0.0.1/x.mp4' } });
    await expect(falExtraProvider.poll!(remote(), 'fixture')).rejects.toThrow('HTTPS');
  });
  it('maps short subtitle removal to generic Bria prompt erasure without auto trimming or claiming OCR', async () => {
    const { endpoint, body } = await buildFalExtraRequest(
      context(input('video.erase-subtitles', {}, { prompt: 'Only the captions at the bottom.' })),
      async () => ({ ...metadata, duration: 4.999 }),
    );
    expect(endpoint).toBe('bria/video/erase/prompt');
    expect(body).toMatchObject({
      auto_trim: false,
      preserve_audio: true,
      output_container_and_codec: 'mp4_h264',
    });
    expect(body.prompt).toContain('overlaid subtitles');
    expect(body.prompt).toContain('Only the captions at the bottom.');
    expect(body).not.toHaveProperty('enable_safety_checker');
    for (const duration of [5, 5.001, 30, NaN])
      expect(() =>
        validateFalExtraVideo('video.erase-subtitles', { ...metadata, duration }),
      ).toThrow();
    await expect(
      buildFalExtraRequest(context(input('video.erase-subtitles')), async () => ({
        ...metadata,
        duration: 5,
      })),
    ).rejects.toThrow('短于5秒');
    expect(http).not.toHaveBeenCalled();
  });
  it('rejects Bria masks, extra references and oversized text before any submission', () => {
    expect(() =>
      validateFalExtraOptions(input('video.erase-subtitles', {}, { maskAssetId: referenceId })),
    ).toThrow('遮罩');
    expect(() =>
      validateFalExtraOptions(
        input('video.erase-subtitles', {}, { referenceAssetIds: [referenceId] }),
      ),
    ).toThrow('0 张');
    expect(() =>
      validateFalExtraOptions(input('video.erase-subtitles', {}, { prompt: 'x'.repeat(1001) })),
    ).toThrow('1000');
  });
  it('sends cancellation using the documented PUT without reporting a terminal result', async () => {
    http.mockResolvedValueOnce({ status: 'CANCELLATION_REQUESTED' });
    await expect(falExtraProvider.cancel!(remote(), 'fixture')).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledWith(
      remote().cancelUrl,
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});

/** Protocol tests use local images and mocked transport; no model accounts are contacted. */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { jobInputSchema } from '../src/contracts/jobs';
import {
  creativeIntentRequestSchema,
  type CreativeIntentRequest,
} from '../src/contracts/creative-intent';
import { simulateCreativeIntent } from '../src/server/tasks/creative-intent-simulation';
import {
  analyzeNativeIntent,
  NativePlanValidationError,
  parseNativeIntentResponse,
} from '../src/server/providers/native-planner';
import { createNativeProvider, validateNativeVideoArtifact } from '../src/server/providers/native';
import { nativeProviderJson } from '../src/server/providers/native-http';
import type { RuntimeModelConnection } from '../src/server/tasks/model-connections';
import { ProviderError, type ExecutionContext } from '../src/server/tasks/types';

vi.mock('../src/server/providers/native-http', () => ({ nativeProviderJson: vi.fn() }));
const call = vi.mocked(nativeProviderJson);
const image: RuntimeModelConnection = {
  id: 'image',
  kind: 'image',
  protocol: 'seedream-images',
  baseUrl: 'https://fixture.example/v1',
  model: 'configured-image-alias',
  secret: 'fixture-image-key',
  revision: randomUUID(),
};
const video: RuntimeModelConnection = {
  id: 'video',
  kind: 'video',
  protocol: 'seedance-native',
  baseUrl: 'https://fixture.example/doubao/api/v3/contents/generations/tasks',
  model: 'configured-video-alias',
  secret: 'fixture-video-key',
  revision: randomUUID(),
};
const provider = createNativeProvider({ image, video });
let png: Buffer;
beforeEach(async () => {
  vi.clearAllMocks();
  call.mockRejectedValue(new Error('Unexpected model call'));
  png = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#abc' } })
    .png()
    .toBuffer();
});
function request(video = false): CreativeIntentRequest {
  return creativeIntentRequestSchema.parse({
    version: 1,
    requestId: randomUUID(),
    rawPrompt: '柔光中的白色陶瓷杯',
    sourceTexts: [{ id: 'request', text: '柔光中的白色陶瓷杯' }],
    answers: [],
    materials: [],
    context: {
      mediaType: video ? 'video' : 'image',
      platform: '通用电商',
      placement: 'general',
      language: 'zh-CN',
      count: 1,
      ratio: '1:1',
      resolution: video ? '720p' : '2K',
      supportsReference: true,
      supportsAudio: false,
      supportsText: false,
    },
    strategy: { id: 'fixture', guidance: '' },
  });
}
function response(plan: unknown, finishReason = 'stop') {
  return { choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(plan) } }] };
}
function context(kind: 'image' | 'video' = 'video'): ExecutionContext {
  let saved: { buffer: Buffer; mimeType: string; name: string } | undefined;
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse({
      providerId: 'native',
      operation: `${kind}.generate`,
      prompt: '已确认的主体与镜头方案',
      nativePlan: {
        imagePrompt: '柔光中的陶瓷杯初始定格画面',
        videoPrompt: '镜头缓慢靠近，保持整杯入画',
      },
      options: {
        model: kind === 'video' ? video.model : image.model,
        ratio: '1:1',
        resolution: kind === 'video' ? '720p' : '2K',
        needText: false,
        duration: 5,
      },
    }),
    readAsset: vi.fn(async () => ({ buffer: png, mimeType: 'image/png', name: '参考图.png' })),
    nativeFrame: {
      load: vi.fn(async () => saved),
      save: vi.fn(async (output) => {
        if (!output.buffer) throw new Error('Expected a local first-frame fixture');
        saved = { buffer: output.buffer, mimeType: output.mimeType, name: output.name };
      }),
    },
  };
}

describe('native planning', () => {
  it('stops a text fallback when the caller revokes its authorization between attempts', async () => {
    call.mockRejectedValue(new ProviderError('拒绝', false, 'PROVIDER_HTTP_403'));
    const primary = {
      ...image,
      protocol: 'openai-chat',
      fallbackResources: [{ ...image, id: 'backup-text', protocol: 'openai-chat' }],
    };
    await expect(
      analyzeNativeIntent(request(), primary, {
        beforeFallback: () => {
          throw new ProviderError('配置或权限已改变');
        },
      }),
    ).rejects.toThrow('配置或权限已改变');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('uses the configured text fallback only after a definite refusal', async () => {
    const input = request();
    const expected = simulateCreativeIntent(input);
    call
      .mockRejectedValueOnce(new ProviderError('拒绝', false, 'PROVIDER_HTTP_403'))
      .mockResolvedValueOnce(response(expected));
    const primary = {
      ...image,
      protocol: 'openai-chat',
      fallbackResources: [
        {
          ...image,
          id: 'backup-text',
          protocol: 'openai-chat',
          baseUrl: 'https://backup.example/v1',
          model: 'backup-text-model',
          secret: 'synthetic-text-backup',
        },
      ],
    };
    await expect(analyzeNativeIntent(input, primary)).resolves.toEqual(expected);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]).toEqual([
      'https://backup.example/v1/chat/completions',
      expect.objectContaining({
        headers: { Authorization: 'Bearer synthetic-text-backup' },
        body: expect.objectContaining({ model: 'backup-text-model' }),
      }),
    ]);
  });
  it('accepts a null optional market only as an omitted market when none was requested', async () => {
    const input = request();
    const expected = simulateCreativeIntent(input);
    const raw = response({ ...expected, brief: { ...expected.brief, market: null } });
    call.mockResolvedValue(raw);
    const parsed = await analyzeNativeIntent(input, { ...image, protocol: 'openai-chat' });
    expect(parsed).toEqual(expected);
    expect(parsed.brief).not.toHaveProperty('market');
    expect(JSON.parse(raw.choices[0]!.message.content).brief.market).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('normalizes only an unspecified market while preserving a clarification plan', () => {
    const input = request();
    input.rawPrompt = '好看点';
    const expected = simulateCreativeIntent(input);
    expect(expected.status).toBe('needs_clarification');
    expect(
      parseNativeIntentResponse(
        response({ ...expected, brief: { ...expected.brief, market: null } }),
        input,
      ),
    ).toEqual(expected);
  });
  it('still requires the exact explicitly requested market and rejects an invented market', () => {
    const input = request();
    input.context.market = 'US';
    const expected = simulateCreativeIntent(input);
    expect(parseNativeIntentResponse(response(expected), input).brief.market).toBe('US');
    for (const market of [null, undefined, '', 'GB', 1])
      expect(() =>
        parseNativeIntentResponse(
          response({ ...expected, brief: { ...expected.brief, market } }),
          input,
        ),
      ).toThrow(NativePlanValidationError);
    delete input.context.market;
    expect(() => parseNativeIntentResponse(response(expected), input)).toThrow('MARKET_CHANGED');
  });
  it('does not let optional-market normalization hide required-field, fact or truncation failures', () => {
    const input = request();
    const plan = simulateCreativeIntent(input);
    const brief = { ...plan.brief, market: null };
    const cases = [
      {
        value: { ...plan, brief: { ...brief, subject: null } },
        path: 'brief.subject',
        code: 'invalid_type',
      },
      { value: { ...plan, brief, prompt: null }, path: 'prompt', code: 'invalid_type' },
      {
        value: {
          ...plan,
          brief: { ...brief, facts: [{ sourceId: 'request', quote: '未经提供的功效' }] },
        },
        path: 'brief.facts',
        code: 'SOURCE_MISMATCH',
      },
    ];
    for (const { value, path, code } of cases) {
      try {
        parseNativeIntentResponse(response(value), input);
        throw new Error('Expected strict plan rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(NativePlanValidationError);
        expect((error as NativePlanValidationError).diagnostics).toContainEqual(
          expect.objectContaining({ path, code }),
        );
      }
    }
    expect(() => parseNativeIntentResponse(response({ ...plan, brief }, 'length'), input)).toThrow(
      'finish_reason',
    );
  });
  it('reports safe field paths for received invalid output and does not classify it as an unknown submission', () => {
    const input = request();
    const result = simulateCreativeIntent(input);
    result.brief.facts = Array.from({ length: 17 }, () => ({
      sourceId: 'request',
      quote: input.rawPrompt,
    }));
    let failure: unknown;
    try {
      parseNativeIntentResponse(response(result), input);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(NativePlanValidationError);
    expect(failure).toMatchObject({
      ambiguous: false,
      code: 'NATIVE_PLAN_INVALID',
      diagnostics: [{ stage: 'schema', path: 'brief.facts', code: 'too_big' }],
    });
    expect((failure as Error).message).toContain('重新整理');
    expect((failure as Error).message).not.toContain(input.rawPrompt);
    result.brief.facts.pop();
    expect(() => parseNativeIntentResponse(response(result), input)).not.toThrow();
  });
  it('never exposes unknown response field names or values in schema diagnostics', () => {
    const input = request();
    const result = {
      ...simulateCreativeIntent(input),
      'synthetic-secret-field': 'synthetic-private-value',
    };
    try {
      parseNativeIntentResponse(response(result), input);
    } catch (error) {
      expect(error).toMatchObject({
        ambiguous: false,
        diagnostics: [{ path: '$', code: 'unrecognized_keys' }],
      });
      expect(JSON.stringify(error)).not.toContain('synthetic');
      expect((error as Error).message).not.toContain('synthetic');
      return;
    }
    throw new Error('Expected strict contract failure');
  });
  it('captures one raw received response for an explicit trusted observer before rejecting it', async () => {
    const input = request();
    const raw = response({ secretLookingField: 'synthetic-response-body' });
    call.mockResolvedValue(raw);
    const observer = vi.fn(async () => {});
    await expect(
      analyzeNativeIntent(input, { ...image, protocol: 'openai-chat' }, { onResponse: observer }),
    ).rejects.toMatchObject({ code: 'NATIVE_PLAN_INVALID', ambiguous: false });
    expect(observer).toHaveBeenCalledExactlyOnceWith(raw);
    expect(call).toHaveBeenCalledTimes(1);
    const body = call.mock.calls[0]![1]!.body as { messages: { content: string }[] };
    expect(body.messages[0]!.content).toContain('facts 最多16条');
    expect(body.messages[0]!.content).toContain('options 最多3项');
    expect(body.messages[0]!.content).toContain('最多60字符');
  });
  it('preserves transport uncertainty and does not call the observer or replay a missing response', async () => {
    const observer = vi.fn();
    call.mockRejectedValue(
      new ProviderError('synthetic transport timeout', true, 'PROVIDER_CONNECTION'),
    );
    await expect(
      analyzeNativeIntent(
        request(),
        { ...image, protocol: 'openai-chat' },
        { onResponse: observer },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_CONNECTION', ambiguous: true });
    expect(observer).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('sanitizes observer failures and requires reconciliation without replaying a received response', async () => {
    const input = request();
    call.mockResolvedValue(response(simulateCreativeIntent(input)));
    await expect(
      analyzeNativeIntent(
        input,
        { ...image, protocol: 'openai-chat' },
        {
          onResponse: () => {
            throw new Error('synthetic-sensitive-path');
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'NATIVE_PLAN_OBSERVER_FAILED',
      ambiguous: true,
      message: expect.not.stringContaining('synthetic-sensitive-path'),
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('calls the configured text model once and validates a structured evidence-backed plan', async () => {
    const input = request();
    const result = simulateCreativeIntent(input);
    call.mockResolvedValue(response(result));
    expect(
      await analyzeNativeIntent(input, {
        ...image,
        protocol: 'openai-chat',
        model: 'configured-text-alias',
      }),
    ).toEqual(result);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![0]).toBe('https://fixture.example/v1/chat/completions');
    expect(call.mock.calls[0]![1]?.body).toMatchObject({
      model: 'configured-text-alias',
      response_format: { type: 'json_object' },
      stream: false,
    });
  });
  it.each(['length', 'content_filter', 'tool_calls'])(
    'does not accept incomplete or redirected planning output (%s)',
    (finish) => {
      const input = request();
      expect(() =>
        parseNativeIntentResponse(response(simulateCreativeIntent(input), finish), input),
      ).toThrow('被截断');
    },
  );
  it('rejects invented source quotations and mismatched request IDs', () => {
    const input = request();
    const plan = simulateCreativeIntent(input);
    plan.brief.facts = [{ sourceId: 'request', quote: '抗菌率99%' }];
    expect(() => parseNativeIntentResponse(response(plan), input)).toThrow('事实依据');
    plan.brief.facts = [];
    plan.requestId = randomUUID();
    expect(() => parseNativeIntentResponse(response(plan), input)).toThrow('事实依据');
  });
  it('requires separate first-frame and motion prompts for a ready video plan', () => {
    const input = request(true);
    const plan = simulateCreativeIntent(input);
    expect(() => parseNativeIntentResponse(response(plan), input)).toThrow('不完整');
    plan.generationPlan = {
      imagePrompt: '完整陶瓷杯，柔光',
      videoPrompt: '缓慢推进，保持完整入画',
    };
    expect(parseNativeIntentResponse(response(plan), input).generationPlan).toEqual(
      plan.generationPlan,
    );
  });
});

describe('native image-to-video orchestration', () => {
  it('checks measured 720p dimensions with even-pixel rounding and a half-second duration tolerance', () => {
    const input = context().input;
    input.options.ratio = '16:9';
    expect(() =>
      validateNativeVideoArtifact(input, { width: 1280, height: 720, durationMs: 5500 }),
    ).not.toThrow();
    expect(() =>
      validateNativeVideoArtifact(input, { width: 1278, height: 722, durationMs: 4500 }),
    ).not.toThrow();
    expect(() =>
      validateNativeVideoArtifact(input, { width: 1280, height: 720, durationMs: 5501 }),
    ).toThrow('实际规格');
    expect(() =>
      validateNativeVideoArtifact(input, { width: 640, height: 360, durationMs: 5000 }),
    ).toThrow('实际规格');
    expect(() =>
      validateNativeVideoArtifact(input, { width: 720, height: 1280, durationMs: 5000 }),
    ).toThrow('实际规格');
  });
  it('uses configured image aliases and accepts signed artifact URLs without forwarding credentials', async () => {
    const url = 'https://media.example/frame.png?signature=fixture';
    call.mockResolvedValue({ data: [{ url }] });
    const result = await provider.execute(context('image'));
    expect(result).toMatchObject({ state: 'complete', outputs: [{ url }] });
    expect(call.mock.calls[0]![1]?.body).toMatchObject({
      model: image.model,
      size: '2048x2048',
      sequential_image_generation: 'disabled',
    });
  });
  it('saves a fully decodable first frame before submitting one video with that exact frame', async () => {
    const ctx = context();
    const accepted = vi.fn();
    ctx.onRemoteAccepted = accepted;
    call.mockResolvedValueOnce({ data: [{ b64_json: png.toString('base64') }] });
    call.mockImplementationOnce(async (_url, options) => {
      expect(ctx.nativeFrame!.save).toHaveBeenCalledTimes(1);
      expect(options?.body).toMatchObject({
        model: video.model,
        duration: 5,
        ratio: '1:1',
        resolution: '720p',
        generate_audio: false,
        content: [
          { type: 'text', text: ctx.input.nativePlan!.videoPrompt },
          {
            type: 'image_url',
            role: 'first_frame',
            image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
          },
        ],
      });
      return { id: 'video-123', status_url: 'https://untrusted.example/credential-trap' };
    });
    const result = await provider.execute(ctx);
    expect(result).toEqual({
      state: 'submitted',
      remote: {
        id: 'video-123',
        endpoint: video.baseUrl,
        nativeModel: video.model,
        nativeResourceId: video.id,
        nativeResourceRevision: video.revision,
      },
    });
    expect(accepted).toHaveBeenCalledExactlyOnceWith({
      id: 'video-123',
      endpoint: video.baseUrl,
      nativeModel: video.model,
      nativeResourceId: video.id,
      nativeResourceRevision: video.revision,
    });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('does not repeat first-frame generation when a persisted frame is available', async () => {
    const ctx = context();
    ctx.nativeFrame!.load = vi.fn(async () => ({
      buffer: png,
      mimeType: 'image/png',
      name: '原首帧.png',
    }));
    call.mockResolvedValue({ id: 'retry-video' });
    await provider.execute(ctx);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![0]).toBe(video.baseUrl);
    expect(ctx.nativeFrame!.save).not.toHaveBeenCalled();
  });
  it('submits the exact Xingyun collection through its same-origin host route and polls the native task', async () => {
    const connection = {
      ...video,
      baseUrl: 'https://xingyunyinli.com/doubao/api/v3/contents/generations/tasks',
      model: 'doubao-seedance-2.0',
    };
    const adapter = createNativeProvider({ image, video: connection });
    const ctx = context();
    ctx.input.options.model = connection.model;
    ctx.nativeFrame!.load = vi.fn(async () => ({
      buffer: png,
      mimeType: 'image/png',
      name: '首帧.png',
    }));
    call.mockResolvedValueOnce({ id: 'xingyun-task' });
    const result = await adapter.execute(ctx);
    expect(call).toHaveBeenCalledExactlyOnceWith('https://xingyunyinli.com/v1/videos', {
      headers: { Authorization: `Bearer ${connection.secret}` },
      body: {
        model: 'doubao-seedance-2.0',
        prompt: ctx.input.nativePlan!.videoPrompt,
        seconds: 5,
        metadata: {
          resolution: '720p',
          ratio: '1:1',
          generate_audio: false,
          watermark: false,
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
              role: 'first_frame',
            },
          ],
        },
      },
      submission: true,
      timeoutMs: 120000,
    });
    expect(result).toEqual({
      state: 'submitted',
      remote: {
        id: 'xingyun-task',
        endpoint: connection.baseUrl,
        nativeModel: connection.model,
        nativeResourceId: connection.id,
        nativeResourceRevision: connection.revision,
      },
    });
    call.mockResolvedValueOnce({ id: 'xingyun-task', status: 'pending' });
    expect(
      await adapter.poll!(
        { id: 'xingyun-task', endpoint: connection.baseUrl, nativeModel: connection.model },
        'ignored',
      ),
    ).toEqual({ state: 'running', stage: '视频任务排队中' });
    expect(call.mock.calls[1]![0]).toBe(`${connection.baseUrl}/xingyun-task`);
    expect(call.mock.calls[1]![1]?.method).toBe('GET');
  });
  it.each([
    'https://xingyunyinli.com.attacker.example/doubao/api/v3/contents/generations/tasks',
    'https://xingyunyinli.com/api/v3/contents/generations/tasks',
    'https://xingyunyinli.com:8443/doubao/api/v3/contents/generations/tasks',
    'https://other.example/doubao/api/v3/contents/generations/tasks',
  ])(
    'retains the native protocol without applying the gateway exception to %s',
    async (endpoint) => {
      const adapter = createNativeProvider({ image, video: { ...video, baseUrl: endpoint } });
      const ctx = context();
      ctx.nativeFrame!.load = vi.fn(async () => ({
        buffer: png,
        mimeType: 'image/png',
        name: '首帧.png',
      }));
      call.mockResolvedValueOnce({ id: 'native-task' });
      await adapter.execute(ctx);
      expect(call.mock.calls[0]![0]).toBe(endpoint);
      expect(call.mock.calls[0]![1]?.body).toMatchObject({
        model: video.model,
        duration: 5,
        content: [{ type: 'text' }, { type: 'image_url', role: 'first_frame' }],
      });
      expect(call.mock.calls[0]![1]?.body).not.toHaveProperty('metadata');
    },
  );
  it.each(['pending', 'queued', 'processing', 'running'])(
    'continues polling documented active task status %s',
    async (status) => {
      const remote = { id: 'still-working', endpoint: video.baseUrl, nativeModel: video.model };
      call.mockResolvedValue({ id: remote.id, status });
      expect(await provider.poll!(remote, 'ignored')).toMatchObject({ state: 'running' });
    },
  );
  it('does not submit a video when frame storage fails or cancellation occurs after saving', async () => {
    const ctx = context();
    ctx.nativeFrame!.save = vi.fn(async () => {
      throw new Error('disk failed');
    });
    call.mockResolvedValue({ data: [{ b64_json: png.toString('base64') }] });
    await expect(provider.execute(ctx)).rejects.toThrow('disk failed');
    expect(call).toHaveBeenCalledTimes(1);
    call.mockClear();
    const cancelled = context();
    cancelled.beforeAdditionalSubmission = () => {
      throw new Error('cancelled');
    };
    await expect(provider.execute(cancelled)).rejects.toThrow('cancelled');
    expect(cancelled.nativeFrame!.save).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('retains a low-resolution generated frame but blocks video spending, including on retry', async () => {
    const small = await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#abc' },
    })
      .png()
      .toBuffer();
    call.mockResolvedValue({ data: [{ b64_json: small.toString('base64') }] });
    const ctx = context();
    ctx.beforeAdditionalSubmission = vi.fn();
    await expect(provider.execute(ctx)).rejects.toMatchObject({
      code: 'NATIVE_IMAGE_SPEC_MISMATCH',
      ambiguous: true,
    });
    expect(ctx.nativeFrame!.save).toHaveBeenCalledTimes(1);
    expect(ctx.beforeAdditionalSubmission).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
    call.mockClear();
    await expect(provider.execute(ctx)).rejects.toMatchObject({
      code: 'NATIVE_IMAGE_SPEC_MISMATCH',
    });
    expect(call).not.toHaveBeenCalled();
    expect(ctx.nativeFrame!.save).toHaveBeenCalledTimes(1);
  });
  it('stops on invalid first-frame bytes without a paid video submission', async () => {
    call.mockResolvedValue({
      data: [{ b64_json: Buffer.from('not an image, at all').toString('base64') }],
    });
    await expect(provider.execute(context())).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('polls only the persisted task and rejects a changed route or model before sending credentials', async () => {
    const remote = { id: 'video-123', endpoint: video.baseUrl, nativeModel: video.model };
    call.mockResolvedValue({
      id: remote.id,
      status: 'succeeded',
      content: { video_url: 'https://media.example/video.mp4?token=fixture' },
    });
    expect(await provider.poll!(remote, 'ignored')).toMatchObject({
      state: 'complete',
      outputs: [{ url: 'https://media.example/video.mp4?token=fixture' }],
    });
    expect(call.mock.calls[0]![1]?.method).toBe('GET');
    call.mockClear();
    await expect(
      provider.poll!({ ...remote, endpoint: 'https://evil.example/tasks' }, 'ignored'),
    ).rejects.toThrow('不匹配');
    await expect(
      provider.poll!({ ...remote, nativeModel: 'another-model' }, 'ignored'),
    ).rejects.toThrow('不匹配');
    expect(call).not.toHaveBeenCalled();
  });
});

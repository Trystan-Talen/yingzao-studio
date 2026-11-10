/** Host submission and native querying from the official New API Doubao plugin; no live calls. */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jobInputSchema } from '../src/contracts/jobs';
import { createSeedanceProvider, validateSeedanceInput } from '../src/server/providers/seedance';
import { providerJson } from '../src/server/providers/http';
import { ProviderError, type ExecutionContext } from '../src/server/tasks/types';

vi.mock('../src/server/providers/http', () => ({ providerJson: vi.fn() }));
const call = vi.mocked(providerJson);
const taskBaseUrl = 'https://gateway.example.com/doubao/api/v3/contents/generations/tasks';
const submitUrl = 'https://gateway.example.com/v1/videos';
const model = 'doubao-seedance-2.0';
const secret = 'fixture-NOT-A-REAL-KEY';
const id = 'task_0123456789';
const remote = { id, endpoint: taskBaseUrl };
const output = 'https://media.example.com/video.mp4?signature=fixture';
const provider = createSeedanceProvider({ taskBaseUrl, model });

function context(raw: Record<string, unknown> = {}): ExecutionContext {
  return {
    actor: {
      userId: randomUUID(),
      authType: 'session',
      workspaceId: null,
      apiKeyId: null,
      scopes: [],
    },
    workspaceId: randomUUID(),
    input: jobInputSchema.parse({
      providerId: 'seedance',
      operation: 'video.generate',
      prompt: '镜头缓慢靠近桌上的陶瓷杯。',
      ...raw,
      options: {
        model,
        count: 1,
        duration: 5,
        resolution: '480p',
        ratio: '16:9',
        needText: false,
        ...(raw.options as Record<string, unknown> | undefined),
      },
    }),
    readAsset: vi.fn(async () => {
      throw new Error('Text-to-video must not read assets');
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  call.mockResolvedValue({ id });
});

describe('Seedance host text-to-video submission with model aliases', () => {
  it('submits one bounded silent video and persists only the task ID and configured endpoint', async () => {
    call.mockResolvedValue({
      id,
      object: 'video',
      status: 'queued',
      model,
      status_url: 'https://untrusted.example.com/auth-query',
    });
    expect(provider.id).toBe('seedance');
    expect(await provider.execute(context(), secret)).toEqual({ state: 'submitted', remote });
    expect(call).toHaveBeenCalledExactlyOnceWith(submitUrl, {
      headers: { Authorization: `Bearer ${secret}` },
      body: {
        model,
        prompt: '镜头缓慢靠近桌上的陶瓷杯。',
        seconds: 5,
        metadata: { resolution: '480p', ratio: '16:9', generate_audio: false },
      },
      submission: true,
      timeoutMs: 120000,
    });
  });

  it.each(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'])(
    'accepts documented ratio %s at 720p',
    async (ratio) => {
      await provider.execute(
        context({ options: { ratio, resolution: '720P', generateAudio: false } }),
        secret,
      );
      expect(call.mock.calls[0]![1]!.body).toMatchObject({
        metadata: { ratio, resolution: '720p', generate_audio: false },
      });
    },
  );

  it.each([
    ['1080p', 4],
    ['4K', 15],
  ] as const)(
    'transmits documented %s / %i seconds and generated audio without a prompt override',
    async (resolution, duration) => {
      await provider.execute(
        context({ options: { resolution, duration, generateAudio: true } }),
        secret,
      );
      expect(call.mock.calls[0]![1]!.body).toMatchObject({
        seconds: duration,
        metadata: { resolution: resolution.toLowerCase(), generate_audio: true },
      });
    },
  );

  it.each([
    'https://gateway.example.com',
    'https://gateway.example.com/',
    'https://gateway.example.com/v1',
    'https://gateway.example.com/v1/',
  ])('resolves same-origin host submission and native querying from %s', async (baseUrl) => {
    const result = await createSeedanceProvider({ baseUrl, model }).execute(context(), secret);
    expect(call.mock.calls[0]![0]).toBe(submitUrl);
    expect(result).toEqual({ state: 'submitted', remote });
  });

  it('keeps host submission on the configured native query origin and preserves the model alias', async () => {
    const explicit = 'https://configured.example.com/api/v3/contents/generations/tasks';
    const customModel = 'configured-model-alias';
    const result = await createSeedanceProvider({
      taskBaseUrl: `${explicit}/`,
      baseUrl: 'https://ignored.example.com/v1',
      model: customModel,
    }).execute(context({ options: { model: customModel } }), secret);
    expect(call.mock.calls[0]![0]).toBe('https://configured.example.com/v1/videos');
    expect(call.mock.calls[0]![1]!.body).toMatchObject({ model: customModel });
    expect(result).toEqual({ state: 'submitted', remote: { id, endpoint: explicit } });
  });

  it('has a default configuration but never submits without credentials', async () => {
    await expect(createSeedanceProvider().execute(context())).rejects.toBeInstanceOf(ProviderError);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    { taskBaseUrl: 'http://gateway.example.com/api/v3/contents/generations/tasks' },
    { taskBaseUrl: 'https://user:password@gateway.example.com/api/v3/contents/generations/tasks' },
    { taskBaseUrl: `${taskBaseUrl}?token=hidden` },
    { taskBaseUrl: `${taskBaseUrl}#hidden` },
    { taskBaseUrl: 'https://gateway.example.com/v1/videos' },
    { baseUrl: 'https://gateway.example.com/custom/v1' },
  ])('rejects an ambiguous or credential-bearing configuration %#', (options) => {
    expect(() => createSeedanceProvider(options)).toThrow(ProviderError);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    { operation: 'image.generate' },
    { prompt: '  ' },
    { prompt: '杯子特写 --dur 15' },
    { prompt: '杯子特写 --rs 1080p' },
    { options: { count: 2 } },
    { options: { duration: 16 } },
    { options: { resolution: '8K' } },
    { options: { ratio: '2:3' } },
    { options: { needText: true } },
    { options: { width: 1280 } },
    { options: { referenceMode: 'first-last' } },
    { assetIds: [randomUUID()] },
    { referenceAssetIds: [randomUUID()] },
    { maskAssetId: randomUUID() },
    { backgroundAssetId: randomUUID() },
    { backgroundAudioAssetId: randomUUID() },
    { characterId: randomUUID() },
    { brandId: randomUUID() },
    { referenceText: '附加内容' },
    { conversationContext: '附加上下文' },
    { linkUrl: 'https://reference.example.com/item' },
  ])('rejects unsupported input before quoting or sending any request %#', async (raw) => {
    const c = context(raw);
    expect(() => validateSeedanceInput(c.input)).toThrow(ProviderError);
    await expect(provider.execute(c, secret)).rejects.toMatchObject({ ambiguous: false });
    expect(call).not.toHaveBeenCalled();
    expect(c.readAsset).not.toHaveBeenCalled();
  });

  it('validates the configured model without restricting configurable aliases in the quote helper', async () => {
    const c = context({ options: { model: 'different-model' } });
    expect(() => validateSeedanceInput(c.input)).not.toThrow();
    expect(() => validateSeedanceInput(c.input, { model })).toThrow(ProviderError);
    await expect(provider.execute(c, secret)).rejects.toMatchObject({ ambiguous: false });
    expect(call).not.toHaveBeenCalled();
  });

  it.each([{}, { id: 123 }, { id: '' }, { id: '../task' }, { id: 'id?key=secret' }])(
    'marks a malformed submission response %# as ambiguous without resubmitting',
    async (response) => {
      call.mockResolvedValue(response);
      await expect(provider.execute(context(), secret)).rejects.toMatchObject({ ambiguous: true });
      expect(call).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates ambiguous submission timeouts without retrying the paid POST', async () => {
    const error = new ProviderError(
      '服务连接中断，提交结果需要核对。',
      true,
      'PROVIDER_CONNECTION',
    );
    call.mockRejectedValue(error);
    await expect(provider.execute(context(), secret)).rejects.toBe(error);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('Seedance persisted task polling', () => {
  it.each(['pending', 'queued', 'processing', 'running'])(
    'waits for %s even when a URL is present',
    async (status) => {
      call.mockResolvedValue({ id, status, content: { video_url: output } });
      expect(await provider.poll!(remote, secret)).toMatchObject({ state: 'running' });
      expect(call).toHaveBeenCalledExactlyOnceWith(`${taskBaseUrl}/${id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
        timeoutMs: 30000,
      });
    },
  );

  it('returns a successful public media URL without following or authenticating to it', async () => {
    call.mockResolvedValue({ id, status: 'succeeded', content: { video_url: output } });
    const result = await provider.poll!(
      {
        ...remote,
        statusUrl: 'https://untrusted.example.com/task',
        responseUrl: 'https://untrusted.example.com/result',
      },
      secret,
    );
    expect(result).toEqual({
      state: 'complete',
      outputs: [{ url: output, mimeType: 'video/mp4', name: '生成视频.mp4' }],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![0]).toBe(`${taskBaseUrl}/${id}`);
  });

  it.each(['failed', 'expired', 'cancelled'])(
    'recognizes %s without leaking upstream errors',
    async (status) => {
      call.mockResolvedValue({ id, status, error: { message: `private ${secret}` } });
      const result = await provider.poll!(remote, secret);
      expect(result.state).toBe('failed');
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.each([
    { id, status: 'unknown', content: { video_url: output } },
    { id, status: 'completed', content: { video_url: output } },
    { id, status: 'succeeded' },
    { id, status: 'succeeded', content: { video_url: 'not a URL' } },
    { id, status: 'succeeded', content: { video_url: 'http://media.example.com/result.mp4' } },
    {
      id,
      status: 'succeeded',
      content: { video_url: 'https://user:password@media.example.com/result.mp4' },
    },
    { id: 'another-task', status: 'succeeded', content: { video_url: output } },
    { status: 'succeeded', content: { video_url: output } },
  ])('does not complete unknown, malformed, or mismatched response %#', async (response) => {
    call.mockResolvedValue(response);
    await expect(provider.poll!(remote, secret)).rejects.toMatchObject({ ambiguous: true });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each([
    { id, endpoint: 'https://other.example.com/api/v3/contents/generations/tasks' },
    { id },
    { id: '../other-task', endpoint: taskBaseUrl },
  ])('refuses unsafe or unbound persisted task metadata %# before network access', async (task) => {
    await expect(provider.poll!(task, secret)).rejects.toMatchObject({ ambiguous: true });
    expect(call).not.toHaveBeenCalled();
  });
});

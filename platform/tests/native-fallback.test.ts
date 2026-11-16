/** Synthetic endpoints and transport only; this suite never consumes provider credits. */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { jobInputSchema } from '../src/contracts/jobs';
import type { ExecutionAttemptEvent } from '../src/contracts/task-execution';
import { createNativeProvider } from '../src/server/providers/native';
import { nativeProviderJson } from '../src/server/providers/native-http';
import { runWithExecutionAudit } from '../src/server/providers/execution-audit';
import { withModelFallback } from '../src/server/providers/native-fallback';
import type { RuntimeModelConnection } from '../src/server/tasks/model-connections';
import { ProviderError, type ExecutionContext } from '../src/server/tasks/types';
vi.mock('../src/server/providers/native-http', () => ({ nativeProviderJson: vi.fn() }));
const call = vi.mocked(nativeProviderJson);
const image: RuntimeModelConnection = {
  id: 'image',
  kind: 'image',
  protocol: 'openai-images',
  baseUrl: 'https://primary.example/v1',
  model: 'gpt-image-2',
  secret: 'synthetic-primary',
  revision: 'primary-image',
};
const backupImage: RuntimeModelConnection = {
  ...image,
  id: 'backup-image',
  name: '备用图片',
  baseUrl: 'https://backup.example/v1',
  secret: 'synthetic-backup',
  revision: 'backup-image-rev',
};
const video: RuntimeModelConnection = {
  id: 'video',
  kind: 'video',
  protocol: 'seedance-native',
  baseUrl: 'https://primary.example/api/v3/contents/generations/tasks',
  model: 'doubao-seedance-2.0',
  secret: 'synthetic-primary-video',
  revision: 'primary-video',
};
const backupVideo: RuntimeModelConnection = {
  ...video,
  id: 'backup-video',
  name: '备用视频',
  baseUrl: 'https://backup.example/api/v3/contents/generations/tasks',
  secret: 'synthetic-backup-video',
  revision: 'backup-video-rev',
};
let png: Buffer;
beforeEach(async () => {
  call.mockReset();
  png = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#abc' } })
    .png()
    .toBuffer();
});
function context(kind: 'image' | 'video' = 'image'): ExecutionContext {
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
      prompt: '陶瓷杯商品图',
      nativePlan:
        kind === 'video'
          ? { imagePrompt: '陶瓷杯初始画面', videoPrompt: '环绕拍摄陶瓷杯' }
          : undefined,
      options: {
        model: kind === 'image' ? image.model : video.model,
        ratio: '1:1',
        resolution: kind === 'image' ? '2K' : '720p',
        duration: 5,
        count: 1,
        needText: false,
      },
    }),
    readAsset: vi.fn(),
    nativeFrame: {
      load: vi.fn(async () => ({ buffer: png, mimeType: 'image/png', name: '首帧.png' })),
      save: vi.fn(),
    },
    beforeAdditionalSubmission: vi.fn(),
  };
}
describe('native fallback resources', () => {
  it('uses a separate image credential after definite rejection and retains the confirmed request', async () => {
    call
      .mockRejectedValueOnce(new ProviderError('无权限', false, 'PROVIDER_HTTP_403'))
      .mockResolvedValueOnce({ data: [{ b64_json: png.toString('base64') }] });
    const ctx = context();
    const result = await createNativeProvider({
      image: { ...image, fallbackResources: [backupImage] },
    }).execute(ctx);
    expect(result.state).toBe('complete');
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]).toEqual([
      'https://backup.example/v1/images/generations',
      expect.objectContaining({
        headers: { Authorization: 'Bearer synthetic-backup' },
        body: expect.objectContaining({ model: 'gpt-image-2', prompt: '陶瓷杯商品图' }),
      }),
    ]);
    expect(ctx.beforeAdditionalSubmission).toHaveBeenCalledTimes(1);
  });
  it.each([
    new ProviderError('未知', true, 'PROVIDER_HTTP_503'),
    new ProviderError('断开', true, 'PROVIDER_CONNECTION'),
    new Error('unexpected'),
  ])('never switches when the first submission has an unknown result: %s', async (error) => {
    call.mockRejectedValue(error);
    await expect(
      createNativeProvider({ image: { ...image, fallbackResources: [backupImage] } }).execute(
        context(),
      ),
    ).rejects.toBe(error);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('does not generate again after an invalid successful response', async () => {
    call.mockResolvedValue({ data: [] });
    await expect(
      createNativeProvider({ image: { ...image, fallbackResources: [backupImage] } }).execute(
        context(),
      ),
    ).rejects.toMatchObject({ ambiguous: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('skips a fallback whose confirmed output dimensions are incompatible', async () => {
    const events: ExecutionAttemptEvent[] = [];
    const ctx = context();
    ctx.input.options.resolution = '1K';
    call.mockRejectedValue(new ProviderError('拒绝', false, 'PROVIDER_HTTP_401'));
    await expect(
      runWithExecutionAudit(
        (e) => events.push(e),
        () =>
          createNativeProvider({
            image: {
              ...image,
              fallbackResources: [
                { ...backupImage, protocol: 'seedream-images', model: 'doubao-seedream-5.0-lite' },
              ],
            },
          }).execute(ctx),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_HTTP_401' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        errorCode: 'FALLBACK_RESOURCE_INCOMPATIBLE',
        resource: expect.objectContaining({ id: 'backup-image' }),
      }),
    );
  });
  it('submits fallback video once and polls only its accepted resource after restart', async () => {
    const ctx = context('video');
    const frame = await sharp(png).resize(1024, 1024).png().toBuffer();
    ctx.nativeFrame!.load = vi.fn(async () => ({
      buffer: frame,
      mimeType: 'image/png',
      name: '首帧.png',
    }));
    const accepted = vi.fn();
    ctx.onRemoteAccepted = accepted;
    const resources = { image, video: { ...video, fallbackResources: [backupVideo] } };
    call
      .mockRejectedValueOnce(new ProviderError('限流', false, 'PROVIDER_HTTP_429'))
      .mockResolvedValueOnce({ id: 'remote-backup' });
    const result = await createNativeProvider(resources).execute(ctx);
    expect(result.state).toBe('submitted');
    if (result.state !== 'submitted') throw new Error('missing remote');
    expect(result.remote).toMatchObject({
      id: 'remote-backup',
      endpoint: backupVideo.baseUrl,
      nativeResourceId: backupVideo.id,
      nativeResourceRevision: backupVideo.revision,
    });
    expect(accepted).toHaveBeenCalledExactlyOnceWith(result.remote);
    call.mockReset();
    call.mockResolvedValue({ id: 'remote-backup', status: 'running' });
    await expect(
      createNativeProvider(resources).poll!(result.remote, 'ignored-primary-key'),
    ).resolves.toMatchObject({ state: 'running' });
    expect(call).toHaveBeenCalledExactlyOnceWith(
      `${backupVideo.baseUrl}/remote-backup`,
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer synthetic-backup-video' },
      }),
    );
    await expect(
      createNativeProvider({
        image,
        video: { ...video, fallbackResources: [{ ...backupVideo, revision: 'changed' }] },
      }).poll!(result.remote, 'ignored'),
    ).rejects.toMatchObject({ ambiguous: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('rechecks ownership before a fallback and stops when permission is revoked', async () => {
    const ctx = context();
    ctx.beforeAdditionalSubmission = () => {
      throw new ProviderError('已取消');
    };
    call.mockRejectedValue(new ProviderError('拒绝', false, 'PROVIDER_HTTP_401'));
    await expect(
      createNativeProvider({ image: { ...image, fallbackResources: [backupImage] } }).execute(ctx),
    ).rejects.toThrow('已取消');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('continues polling an accepted resource after unrelated configuration revisions change', async () => {
    call.mockResolvedValue({ id: 'existing-task', status: 'running' });
    const identity = 'stable-execution-identity';
    const remote = {
      id: 'existing-task',
      endpoint: backupVideo.baseUrl,
      nativeModel: backupVideo.model,
      nativeResourceId: backupVideo.id,
      nativeResourceRevision: identity,
    };
    await expect(
      createNativeProvider({
        video: {
          ...video,
          fallbackResources: [
            { ...backupVideo, revision: 'new-label-revision', executionRevision: identity },
          ],
        },
      }).poll!(remote, 'ignored'),
    ).resolves.toMatchObject({ state: 'running' });
    expect(call).toHaveBeenCalledTimes(1);
    await expect(
      createNativeProvider({
        video: {
          ...video,
          fallbackResources: [{ ...backupVideo, executionRevision: 'changed-key-or-endpoint' }],
        },
      }).poll!(remote, 'ignored'),
    ).rejects.toMatchObject({ ambiguous: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('makes at most one request per configured resource and stops on the first success', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('未发送', false, 'PROVIDER_CONNECTION'))
      .mockResolvedValue('ok');
    await expect(
      withModelFallback(
        { ...image, fallbackResources: [backupImage, { ...backupImage, id: 'last' }] },
        execute,
      ),
    ).resolves.toBe('ok');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

/** Official protocol fixtures and real local media; no external parsing calls or fees. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSocialVideoLink } from '../src/contracts/social-import';
import { jobInputSchema } from '../src/contracts/jobs';
import { decodeSocialVideo, tikhubProvider } from '../src/server/providers/tikhub';
import { providerJson, downloadPublicMedia } from '../src/server/providers/http';
import { ProviderError } from '../src/server/tasks/types';
import { createApp } from '../src/server/app';
import { createWorker } from '../src/worker/runner';
import type { Actor } from '../src/contracts/core';
vi.mock('../src/server/providers/http', async (load) => ({
  ...(await load<typeof import('../src/server/providers/http')>()),
  providerJson: vi.fn(),
  downloadPublicMedia: vi.fn(),
}));
const input = () =>
  jobInputSchema.parse({
    operation: 'media.import',
    providerId: 'tikhub',
    linkUrl: 'https://v.douyin.com/fixture/',
    options: { referenceAuthorized: true, externalCostAccepted: true },
  });
const payload = {
  code: 200,
  data: {
    aweme_detail: {
      aweme_type: 0,
      video: { play_addr: { url_list: ['https://cdn.example.com/video.mp4'] } },
    },
  },
};
beforeEach(() => vi.resetAllMocks());
describe('public link boundaries and documented response fields', () => {
  it('extracts one share link and rejects arbitrary hosts, credentials, ports, multiple links and unsupported formats before charging', () => {
    expect(parseSocialVideoLink('这是视频 https://v.douyin.com/abc/。 打开查看')).toEqual({
      platform: 'douyin',
      url: 'https://v.douyin.com/abc/',
    });
    expect(parseSocialVideoLink('https://www.tiktok.com/@user/video/123').platform).toBe('tiktok');
    for (const value of [
      'https://localhost/video',
      'https://v.douyin.com.evil.com/a',
      'https://name@v.douyin.com/a',
      'https://v.douyin.com:8443/a',
      'http://v.douyin.com/a',
      'https://v.douyin.com/a https://vt.tiktok.com/b',
      'https://xhslink.com/a',
    ])
      expect(() => parseSocialVideoLink(value), value).toThrow();
  });
  it('decodes Douyin detail and TikTok single-item details and only returns secure media addresses', () => {
    expect(decodeSocialVideo(payload, 'douyin')).toBe('https://cdn.example.com/video.mp4');
    expect(
      decodeSocialVideo(
        {
          code: 200,
          data: {
            aweme_details: [
              {
                video: {
                  play_addr_h264: {
                    url_list: ['http://cdn.example.com/no', 'https://cdn.example.com/ok'],
                  },
                },
              },
            ],
          },
        },
        'tiktok',
      ),
    ).toBe('https://cdn.example.com/ok');
    expect(() =>
      decodeSocialVideo(
        {
          code: 200,
          data: { aweme_detail: { aweme_type: 68, video: payload.data.aweme_detail.video } },
        },
        'douyin',
      ),
    ).toThrow('不是可导入');
    expect(() =>
      decodeSocialVideo({ code: 200, data: { unexpected: 'schema' } }, 'douyin'),
    ).toThrow(expect.objectContaining({ ambiguous: true }));
  });
  it('uses exactly one fixed provider GET and treats lost responses as uncertain', async () => {
    vi.mocked(providerJson)
      .mockResolvedValueOnce(payload)
      .mockRejectedValueOnce(new ProviderError('connection lost', true));
    const context = {
      actor: {} as Actor,
      workspaceId: randomUUID(),
      input: input(),
      readAsset: vi.fn(),
    };
    await expect(tikhubProvider.execute(context, 'fixture-secret')).resolves.toMatchObject({
      state: 'complete',
      outputs: [{ mimeType: 'video/mp4' }],
    });
    const [url, options] = vi.mocked(providerJson).mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/api/v1/douyin/app/v3/fetch_one_video_by_share_url');
    expect(options).toMatchObject({
      method: 'GET',
      submission: true,
      headers: { Authorization: 'Bearer fixture-secret' },
    });
    await expect(tikhubProvider.execute(context, 'fixture-secret')).rejects.toMatchObject({
      ambiguous: true,
    });
    expect(providerJson).toHaveBeenCalledTimes(2);
  });
});
describe('persistent import workflow', () => {
  let folder: string,
    instance: Awaited<ReturnType<typeof createApp>>,
    worker: ReturnType<typeof createWorker> | undefined,
    actor: Actor,
    wid: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'yingzao-social-'));
    instance = await createApp(
      {
        host: '127.0.0.1',
        port: 4310,
        publicOrigin: 'http://127.0.0.1:5174',
        databasePath: join(folder, 'test.sqlite'),
        storageDir: join(folder, 'media'),
        sessionSecret: 'fixture-only',
        encryptionKey: 'fixture-only',
        isProduction: false,
        demoMode: true,
        environmentSecrets: { tikhub: 'fixture-only' },
      },
      { serveWeb: false },
    );
    const registered = await instance.services.core.auth.register({
      email: 'import@example.local',
      password: 'ImportFixture2026!',
      displayName: 'Import fixture',
    });
    wid = registered.workspace.id;
    actor = {
      userId: registered.user.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
  });
  afterEach(async () => {
    await worker?.stop();
    worker = undefined;
    await instance.app.close();
    await rm(folder, { recursive: true, force: true });
  });
  it('rejects missing consent, batching and keys lacking asset-write scope before reserving credits', () => {
    for (const bad of [
      { ...input(), options: { ...input().options, referenceAuthorized: false } },
      { ...input(), options: { ...input().options, externalCostAccepted: false } },
      { ...input(), options: { ...input().options, count: 2 } },
      { ...input(), linkUrl: 'https://127.0.0.1/secret' },
    ])
      expect(() => instance.services.quote(actor, wid, bad)).toThrow();
    const key = instance.services.core.business.createKey(actor, wid, {
      name: 'job only',
      scopes: ['jobs:write'],
    });
    expect(() =>
      instance.services.quote(
        {
          ...actor,
          authType: 'apiKey',
          apiKeyId: key.key.id,
          workspaceId: wid,
          scopes: key.key.scopes,
        },
        wid,
        input(),
      ),
    ).toThrow('assets:write');
    expect(instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toMatchObject({
      n: 0,
    });
    expect(providerJson).not.toHaveBeenCalled();
  });
  it('replays a submission once and resumes the saved URL after a failed download without calling the paid parser again', async () => {
    const file = join(folder, 'video.mp4');
    await promisify(execFile)('ffmpeg', [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x240:r=12:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
    const video = await readFile(file);
    vi.mocked(providerJson).mockResolvedValue(payload);
    vi.mocked(downloadPublicMedia)
      .mockRejectedValueOnce(new Error('interrupted download'))
      .mockResolvedValue(video);
    const quote = instance.services.quote(actor, wid, input());
    const request = { input: input(), quoteId: quote.id, clientRequestId: randomUUID() };
    const job = instance.services.submit(
      actor,
      wid,
      request.input,
      request.quoteId,
      request.clientRequestId,
    );
    expect(
      instance.services.submit(actor, wid, request.input, request.quoteId, request.clientRequestId)
        .id,
    ).toBe(job.id);
    worker = createWorker(instance.services);
    await worker.tick();
    await worker.drain();
    expect(instance.services.get(actor, wid, job.id).status).toBe('running');
    instance.services.db.sqlite
      .prepare("UPDATE job_items SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE job_id=?")
      .run(job.id);
    await worker.tick();
    await worker.drain();
    const result = instance.services.get(actor, wid, job.id);
    expect(result.status).toBe('succeeded');
    expect(result.outputAssets).toHaveLength(1);
    expect(result.outputAssets[0]).toMatchObject({
      source: 'import',
      kind: 'video',
      width: 160,
      height: 240,
    });
    expect(providerJson).toHaveBeenCalledTimes(1);
    expect(downloadPublicMedia).toHaveBeenLastCalledWith(
      'https://cdn.example.com/video.mp4',
      100 * 1024 * 1024,
    );
  });
});

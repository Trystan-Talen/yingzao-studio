/** Real local media fixtures and isolated databases; never calls a model or remote download. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema } from '../src/contracts/jobs';
import type { AppConfig } from '../src/server/config';
import { createCoreServices, type CoreServices } from '../src/server/core';
import {
  closeDatabase,
  createDatabaseContext,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { downloadPublicMedia, providerJson } from '../src/server/providers/http';
import { createCreditService } from '../src/server/tasks/credits';
import { createTaskServices, type TaskServices } from '../src/server/tasks/service';
import type {
  ItemRow,
  ProviderAdapter,
  ProviderOutput,
  ProviderResult,
} from '../src/server/tasks/types';
import { createWorker } from '../src/worker/runner';

vi.mock('../src/server/providers/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/providers/http')>()),
  providerJson: vi.fn(),
  downloadPublicMedia: vi.fn(),
}));
const download = vi.mocked(downloadPublicMedia);
const http = vi.mocked(providerJson);
const externalFetch = vi.fn(async () => {
  throw new Error('Network access is forbidden in media-kind contract tests');
});
const workers: ReturnType<typeof createWorker>[] = [];
let fixtureDir: string, temp: string, png: Buffer, mp4: Buffer, audioOnlyMp4: Buffer;
let db: DatabaseContext, core: CoreServices, tasks: TaskServices, actor: Actor, wid: string;
type Kind = 'image' | 'video';

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'yingzao-media-kind-fixtures-'));
  png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#f4efe8' } })
    .png()
    .toBuffer();
  const path = join(fixtureDir, 'local-video.mp4');
  await promisify(execFile)('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=white:s=32x32:r=8',
    '-t',
    '0.25',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
  mp4 = await readFile(path);
  const audioPath = join(fixtureDir, 'audio-only.mp4');
  await promisify(execFile)('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100',
    '-t',
    '0.25',
    '-c:a',
    'aac',
    '-f',
    'mp4',
    audioPath,
  ]);
  audioOnlyMp4 = await readFile(audioPath);
});
afterAll(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.clearAllMocks();
  http.mockRejectedValue(new Error('Unexpected model request'));
  download.mockRejectedValue(new Error('Unexpected media download'));
  vi.stubGlobal('fetch', externalFetch);
  temp = await mkdtemp(join(tmpdir(), 'yingzao-media-kind-'));
  db = createDatabaseContext(join(temp, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5173',
    databasePath: join(temp, 'test.sqlite'),
    storageDir: join(temp, 'media'),
    sessionSecret: 'media-kind-fixture-session',
    encryptionKey: 'media-kind-fixture-encryption',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {
      openai: 'fixture-image-not-a-real-key',
      seedance: 'fixture-video-not-a-real-key',
    },
    imageGateway: {
      baseUrl: 'https://image.example.test/v1',
      model: 'gpt-image-2',
      quality: 'low',
      size: '1024x1024',
    },
    seedance: {
      taskBaseUrl: 'https://video.example.test/api/v3/contents/generations/tasks',
      model: 'doubao-seedance-2.0',
    },
  };
  const credits = createCreditService(db);
  core = createCoreServices(db, config, {
    onWorkspaceCreated: (workspaceId, userId) => credits.initialize(workspaceId, userId, 500),
    onMemberBudgetChanged: (workspaceId, userId, limit) =>
      credits.budget(workspaceId, userId, limit),
    onMemberRemoved: (workspaceId, userId) => tasks.removeMember(workspaceId, userId),
  });
  tasks = createTaskServices(db, core, config);
  const registration = await core.auth.register({
    email: 'media-kind@example.local',
    password: 'MediaKindPassword2026!',
    displayName: '媒体类型隔离验收',
  });
  actor = {
    userId: registration.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registration.workspace.id;
});
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  closeDatabase(db);
  if (temp) await rm(temp, { recursive: true, force: true });
  expect(http).not.toHaveBeenCalled();
  expect(externalFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function submit(kind: Kind) {
  const input = jobInputSchema.parse({
    operation: `${kind}.generate`,
    providerId: kind === 'image' ? 'openai' : 'seedance',
    prompt: '白色陶瓷杯置于浅灰背景。',
    options:
      kind === 'image'
        ? { model: 'gpt-image-2' }
        : {
            model: 'doubao-seedance-2.0',
            duration: 5,
            resolution: '480p',
            ratio: '16:9',
            needText: false,
          },
  });
  const quote = tasks.quote(actor, wid, input);
  return { quote, job: tasks.submit(actor, wid, input, quote.id, randomUUID()) };
}
function worker(adapter: ProviderAdapter) {
  const created = createWorker(tasks, { [adapter.id]: adapter });
  workers.push(created);
  return created;
}
function item(jobId: string) {
  return db.sqlite.prepare('SELECT * FROM job_items WHERE job_id=?').get(jobId) as ItemRow;
}
function resume(jobId: string, exhaustRetries = false) {
  db.sqlite
    .prepare('UPDATE job_items SET next_attempt_at=?,recovery_failures=? WHERE job_id=?')
    .run('2000-01-01T00:00:00.000Z', exhaustRetries ? 10 : 0, jobId);
}
function assertUnsettled(jobId: string, reservation: number) {
  expect(tasks.get(actor, wid, jobId)).toMatchObject({ outputAssets: [] });
  expect(tasks.get(actor, wid, jobId).status).not.toBe('succeeded');
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM assets').get()).toEqual({ n: 0 });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM job_item_assets').get()).toEqual({ n: 0 });
  expect(tasks.balance(actor, wid)).toMatchObject({
    balance: 500,
    reserved: reservation,
    spent: 0,
  });
}
async function rejectCachedResult(kind: Kind, output: ProviderOutput) {
  const { job, quote } = submit(kind);
  const execute = vi.fn(async (): Promise<ProviderResult> => ({
    state: 'complete',
    outputs: [output],
  }));
  const adapter: ProviderAdapter = { id: kind === 'image' ? 'openai' : 'seedance', execute };
  const first = worker(adapter);
  await first.runItem(first.claim()!);
  assertUnsettled(job.id, quote.maxCredits);
  const cached = item(job.id);
  expect(cached).toMatchObject({ status: 'running', phase: 'downloading', recovery_failures: 1 });
  expect(cached.result_json).toBeTruthy();
  await first.stop();
  resume(job.id, true);
  const restarted = worker(adapter);
  await restarted.runItem(restarted.claim()!);
  expect(item(job.id)).toMatchObject({
    status: 'reconciliation_required',
    result_json: cached.result_json,
  });
  assertUnsettled(job.id, quote.maxCredits);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(restarted.claim()).toBeUndefined();
}

describe('generation output media-kind enforcement and durable recovery', () => {
  it('rejects actual video bytes from an image task despite image MIME and filename', async () => {
    await rejectCachedResult('image', {
      buffer: mp4,
      mimeType: 'image/png',
      name: 'pretend-image.png',
    });
    expect(download).not.toHaveBeenCalled();
  });
  it('rejects actual image bytes from a video task despite video MIME and filename', async () => {
    await rejectCachedResult('video', {
      buffer: png,
      mimeType: 'video/mp4',
      name: 'pretend-video.mp4',
    });
    expect(download).not.toHaveBeenCalled();
  });
  it('rejects an audio-only MP4 whose container signature claims video', async () => {
    // The MP4 brand alone cannot prove a visual stream; this fixture has only AAC audio.
    expect(await fileTypeFromBuffer(audioOnlyMp4)).toMatchObject({ mime: 'video/mp4' });
    await rejectCachedResult('video', {
      buffer: audioOnlyMp4,
      mimeType: 'video/mp4',
      name: 'audio-only.mp4',
    });
    const files = await readdir(join(temp, 'media'), { recursive: true });
    expect(files.filter((path) => path.endsWith('.mp4'))).toEqual([]);
    expect(download).not.toHaveBeenCalled();
  });
  it('rejects an HTML error payload labeled as a generated image without settling credits', async () => {
    await rejectCachedResult('image', {
      buffer: Buffer.from('<!doctype html><html><body>Upstream unavailable</body></html>'),
      mimeType: 'image/png',
      name: 'upstream-error.png',
    });
  });
  it.each<Kind>(['image', 'video'])('rejects text-only %s generation results', async (kind) => {
    await rejectCachedResult(kind, {
      text: 'Generation complete',
      mimeType: 'text/plain',
      name: 'message.txt',
    });
  });
  it('preserves the remote task and downloads its saved URL again without resubmitting or repolling', async () => {
    const { job, quote } = submit('video');
    const remote = {
      id: 'fixture-remote-video',
      endpoint: 'https://video.example.test/api/v3/contents/generations/tasks',
    };
    const url = 'https://media.example.test/generated.mp4';
    const execute = vi.fn(async (): Promise<ProviderResult> => ({ state: 'submitted', remote }));
    const poll = vi.fn(async (): Promise<ProviderResult> => ({
      state: 'complete',
      outputs: [{ url, mimeType: 'video/mp4', name: 'generated.mp4' }],
    }));
    const adapter: ProviderAdapter = { id: 'seedance', execute, poll };
    download.mockResolvedValue(png);
    const first = worker(adapter);
    await first.runItem(first.claim()!);
    expect(item(job.id)).toMatchObject({
      phase: 'polling',
      remote_id: remote.id,
    });
    const savedRemote = JSON.parse(item(job.id).remote_json!);
    expect(savedRemote).toEqual({ ...remote, submittedAt: expect.any(String) });
    expect(new Date(savedRemote.submittedAt).toISOString()).toBe(savedRemote.submittedAt);
    await first.stop();
    resume(job.id);
    const second = worker(adapter);
    await second.runItem(second.claim()!);
    assertUnsettled(job.id, quote.maxCredits);
    const cached = item(job.id);
    expect(cached).toMatchObject({ phase: 'downloading', remote_id: remote.id });
    expect(cached.result_json).toContain(url);
    await second.stop();
    resume(job.id, true);
    const third = worker(adapter);
    await third.runItem(third.claim()!);
    assertUnsettled(job.id, quote.maxCredits);
    expect(item(job.id)).toMatchObject({
      status: 'reconciliation_required',
      remote_id: remote.id,
      result_json: cached.result_json,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith(savedRemote, 'fixture-video-not-a-real-key');
    expect(download).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenNthCalledWith(1, url, undefined, 0, { dnsMode: undefined });
    expect(download).toHaveBeenNthCalledWith(2, url, undefined, 0, { dnsMode: undefined });
  });
  it.each<Kind>(['image', 'video'])(
    'commits one verified %s artifact and settles its reservation once',
    async (kind) => {
      const { job, quote } = submit(kind);
      const bytes = kind === 'image' ? png : mp4;
      const execute = vi.fn(async (): Promise<ProviderResult> => ({
        state: 'complete',
        outputs: [
          {
            buffer: bytes,
            mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
            name: kind === 'image' ? 'real.png' : 'real.mp4',
          },
        ],
      }));
      const run = worker({ id: kind === 'image' ? 'openai' : 'seedance', execute });
      await run.runItem(run.claim()!);
      const done = tasks.get(actor, wid, job.id);
      expect(done.status).toBe('succeeded');
      expect(done.outputAssets).toHaveLength(1);
      expect(done.outputAssets[0]!.kind).toBe(kind);
      const saved = await core.assets.readOriginal(actor, wid, done.outputAssets[0]!.id);
      expect(saved.buffer.equals(bytes)).toBe(true);
      expect(tasks.balance(actor, wid)).toMatchObject({
        balance: 500 - quote.maxCredits,
        reserved: 0,
        spent: quote.maxCredits,
      });
      expect(item(job.id).result_json).toBeNull();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(run.claim()).toBeUndefined();
      expect(download).not.toHaveBeenCalled();
    },
  );
});

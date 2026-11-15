/** Isolated persistence/recovery fixtures. No model request or production data is used. */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import type { AppConfig } from '../src/server/config';
import { createCoreServices } from '../src/server/core';
import {
  closeDatabase,
  createDatabaseContext,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCreditService } from '../src/server/tasks/credits';
import { createTaskServices, type TaskServices } from '../src/server/tasks/service';
import {
  createNativeArtifacts,
  findNativeArtifactCheckpoint,
  hasNativeProcessingCheckpoint,
  nativeArtifactFingerprint,
  validateNativeProcessing,
} from '../src/server/tasks/native-artifacts';
import {
  ProviderError,
  type ItemRow,
  type NativeProcessing,
  type ProviderAdapter,
} from '../src/server/tasks/types';
import { createWorker } from '../src/worker/runner';
import { downloadPublicMedia } from '../src/server/providers/http';
import { renderExactPan } from '../src/server/providers/native-exact-pan';
import {
  createNativeProvider,
  isNativeLocalBackgroundInput,
  validateNativeInput,
} from '../src/server/providers/native';
import * as tailHold from '../src/server/providers/native-video-tail-hold';

vi.mock('../src/server/providers/http', async (original) => ({
  ...(await original<typeof import('../src/server/providers/http')>()),
  downloadPublicMedia: vi.fn(),
}));
const download = vi.mocked(downloadPublicMedia);
let directory: string, db: DatabaseContext, tasks: TaskServices, actor: Actor, wid: string;
let png: Buffer, referenceId: string;
const workers: ReturnType<typeof createWorker>[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'yingzao-native-artifacts-'));
  db = createDatabaseContext(join(directory, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5173',
    databasePath: join(directory, 'test.sqlite'),
    storageDir: join(directory, 'media'),
    sessionSecret: 'checkpoint-fixture-session',
    encryptionKey: 'checkpoint-fixture-encryption',
    isProduction: false,
    demoMode: false,
    environmentSecrets: { openai: 'fixture-not-real' },
  };
  const credits = createCreditService(db);
  const core = createCoreServices(db, config, {
    onWorkspaceCreated: (workspaceId, userId) => credits.initialize(workspaceId, userId, 500),
  });
  tasks = createTaskServices(db, core, config);
  const account = await core.auth.register({
    email: 'checkpoint@example.local',
    password: 'CheckpointFixture2026!',
    displayName: 'Fixture',
  });
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = account.workspace.id;
  tasks.settings.connections.update(wid, {
    kind: 'image',
    protocol: 'seedream-images',
    baseUrl: 'https://fixture.example/v1',
    modelsUrl: '',
    model: 'fixture-image',
    enabled: true,
    secret: 'fixture-not-real',
  });
  png = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#888888' } })
    .png()
    .toBuffer();
  referenceId = (
    await core.assets.ingest(actor, wid, { buffer: png, mimeType: 'image/png', name: 'source.png' })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const worker of workers.splice(0)) await worker.stop();
  closeDatabase(db);
  await rm(directory, { recursive: true, force: true });
});

let videoFixture: Buffer | undefined;
async function videoBytes() {
  if (!videoFixture) {
    const path = join(directory, 'raw-video.mp4');
    await promisify(execFile)('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=960x960:r=24',
      '-frames:v',
      '121',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '2',
      '-y',
      path,
    ]);
    videoFixture = await readFile(path);
  }
  return videoFixture;
}
function videoInput() {
  tasks.settings.connections.update(wid, {
    kind: 'video',
    protocol: 'seedance-native',
    baseUrl: 'https://fixture.example/api/v3/contents/generations/tasks',
    modelsUrl: '',
    model: 'doubao-seedance-2.0',
    enabled: true,
    secret: 'fixture-not-real',
  });
  return jobInputSchema.parse({
    ...input(),
    operation: 'video.generate',
    imageEdit: undefined,
    nativeRevision: tasks.settings.connections.revision(wid, 'video.generate'),
    nativePlan: {
      imagePrompt: '原图',
      videoPrompt: '静物中心变焦，最后半秒停稳',
      firstFrame: { mode: 'reference', assetId: referenceId },
      cameraControl: { type: 'zoom', scalePercent: 103 },
      videoPostprocess: 'model-video-tail-hold-v1',
    },
    options: { model: 'doubao-seedance-2.0', ratio: '1:1', resolution: '720p', duration: 5 },
  });
}
const videoOutput = (buffer: Buffer) => ({ buffer, mimeType: 'video/mp4', name: 'raw.mp4' });

function input(): JobInput {
  return jobInputSchema.parse({
    providerId: 'native',
    operation: 'image.generate',
    prompt: '只更改背景颜色',
    assetIds: [referenceId],
    nativeRevision: tasks.settings.connections.revision(wid, 'image.generate'),
    imageEdit: {
      type: 'solid-background',
      sourceAssetId: referenceId,
      color: '#E6E8EB',
      regionDescription: '背景',
      preserveDescription: '主体',
      mask: { mode: 'generate' },
    },
  });
}

/** Seed a trusted server input directly; approval/quote freezing has separate service tests. */
function seed(value = input(), workspaceId = wid): ItemRow {
  const quoted = jobInputSchema.parse({
    providerId: 'openai',
    operation: 'image.generate',
    prompt: 'Fixture',
  });
  const quote = tasks.quote(actor, workspaceId, quoted);
  const job = tasks.submit(actor, workspaceId, quoted, quote.id, randomUUID());
  db.sqlite
    .prepare('UPDATE jobs SET provider_id=?,operation=?,input_json=? WHERE id=?')
    .run(value.providerId, value.operation, JSON.stringify(value), job.id);
  db.sqlite
    .prepare('UPDATE job_items SET input_json=? WHERE job_id=?')
    .run(JSON.stringify(value), job.id);
  return db.sqlite.prepare('SELECT * FROM job_items WHERE job_id=?').get(job.id) as ItemRow;
}
function running(item: ItemRow): ItemRow {
  db.sqlite.prepare("UPDATE jobs SET status='running' WHERE id=?").run(item.job_id);
  db.sqlite
    .prepare("UPDATE job_items SET status='running',phase='submitting' WHERE id=?")
    .run(item.id);
  return db.sqlite.prepare('SELECT * FROM job_items WHERE id=?').get(item.id) as ItemRow;
}
function store(item: ItemRow, value = input(), owns = () => true) {
  return createNativeArtifacts({ services: tasks, item, input: value, owns });
}
const output = (buffer: Buffer) => ({ buffer, mimeType: 'image/png', name: 'untrusted-name.png' });
function runner(execute: ProviderAdapter['execute']) {
  const worker = createWorker(tasks, { native: { id: 'native', execute } });
  workers.push(worker);
  return worker;
}

describe('local matting worker controls', () => {
  function configuredInput() {
    tasks.config.localMatting = {
      installationDir: join(directory, 'installed'),
      workDir: join(directory, 'work'),
    };
    const value = input();
    value.imageEdit!.mask = { mode: 'generate', calibration: 'local-matting-v2' };
    return value;
  }

  it.each(['cancel-request', 'database-error'] as const)(
    'stops local work on %s and preserves its paid raw checkpoint for explicit local-only recovery',
    async (reason) => {
      const value = configuredInput();
      const item = seed(value);
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      let calls = 0;
      const worker = runner(async (context) => {
        calls++;
        expect(context.localMatting?.config).toEqual(tasks.config.localMatting);
        expect(context.localMatting?.owns()).toBe(true);
        if (calls === 1) {
          await context.nativeArtifacts!.save('background-mask-raw', output(png));
          started();
          await new Promise<void>((_resolve, reject) =>
            context.localMatting!.signal!.addEventListener(
              'abort',
              () =>
                reject(
                  new ProviderError('本机抠图已取消，原件保留。', false, 'LOCAL_MATTING_CANCELLED'),
                ),
              { once: true },
            ),
          );
        }
        expect(context.resumeLocalProcessing).toBe(true);
        expect(
          (await context.nativeArtifacts!.load('background-mask-raw'))?.buffer.equals(png),
        ).toBe(true);
        throw new ProviderError('本机安装仍需修复。', false, 'LOCAL_MATTING_UNAVAILABLE');
      });
      const intervals = vi.spyOn(globalThis, 'setInterval');
      const execution = worker.runItem(worker.claim()!);
      await entered;
      if (reason === 'cancel-request') {
        tasks.cancel(actor, wid, item.job_id);
        await execution;
      } else {
        const check = intervals.mock.calls.find(([, delay]) => delay === 250)![0];
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const originalPrepare = db.sqlite.prepare.bind(db.sqlite);
        let fail = true;
        const prepare = vi.spyOn(db.sqlite, 'prepare').mockImplementation((query) => {
          if (fail && query === 'SELECT cancel_requested FROM job_items WHERE id=?') {
            fail = false;
            throw new Error('SQLITE_BUSY synthetic cancellation check failure');
          }
          return originalPrepare(query);
        });
        try {
          expect(() => check()).not.toThrow();
          await execution;
          expect(log).toHaveBeenCalledWith(
            'Worker cancellation check failed; local processing was stopped.',
          );
        } finally {
          prepare.mockRestore();
        }
      }
      const saved = db.sqlite
        .prepare('SELECT status,phase,cancel_requested,recovery_failures FROM job_items WHERE id=?')
        .get(item.id);
      expect(saved).toEqual({
        status: 'reconciliation_required',
        phase: 'processing',
        cancel_requested: 0,
        recovery_failures: 0,
      });
      expect(worker.claim()).toBeUndefined();
      tasks.resumeResult(actor, wid, item.job_id);
      await worker.runItem(worker.claim()!);
      expect(calls).toBe(2);
      expect(tasks.get(actor, wid, item.job_id).status).toBe('reconciliation_required');
      expect(
        (
          db.sqlite
            .prepare('SELECT COUNT(*) n FROM native_generation_checkpoints WHERE item_id=?')
            .get(item.id) as { n: number }
        ).n,
      ).toBe(1);
    },
  );

  it('returns reserved credits on installation failure before any paid raw result exists', async () => {
    const item = seed(configuredInput());
    const worker = runner(async () => {
      throw new ProviderError('本机安装不可用，尚未请求模型。', false, 'LOCAL_MATTING_UNAVAILABLE');
    });
    await worker.runItem(worker.claim()!);
    expect(tasks.get(actor, wid, item.job_id).status).toBe('failed');
    expect(tasks.credits.account(wid).reserved).toBe(0);
    expect(
      findNativeArtifactCheckpoint(
        db,
        item,
        jobInputSchema.parse(JSON.parse(item.input_json)),
        'background-mask-raw',
      ),
    ).toBeUndefined();
  });

  it('aborts local processing when ownership changes without overwriting the new lease', async () => {
    const item = seed(configuredInput());
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const worker = runner(async (context) => {
      await context.nativeArtifacts!.save('background-mask-raw', output(png));
      started();
      await new Promise<void>((_resolve, reject) =>
        context.localMatting!.signal!.addEventListener(
          'abort',
          () => reject(new ProviderError('执行权转移。', false, 'LOCAL_MATTING_LEASE_LOST')),
          { once: true },
        ),
      );
      throw Error('Abort must reject');
    });
    const execution = worker.runItem(worker.claim()!);
    await entered;
    db.sqlite
      .prepare("UPDATE job_items SET lease_owner='replacement-worker' WHERE id=?")
      .run(item.id);
    await execution;
    expect(
      db.sqlite
        .prepare('SELECT status,lease_owner,error_message FROM job_items WHERE id=?')
        .get(item.id),
    ).toEqual({ status: 'running', lease_owner: 'replacement-worker', error_message: null });
  });

  it.each(['pair', 'final'])(
    'honors cancellation inside asynchronous %s asset preparation before any success or settlement',
    async (at) => {
      const value = configuredInput();
      const item = seed(value);
      const originalPrepare = tasks.core.assets.prepare.bind(tasks.core.assets);
      let cancelled = false;
      vi.spyOn(tasks.core.assets, 'prepare').mockImplementation(async (request) => {
        const prepared = await originalPrepare(request);
        const target = at === 'pair' ? '背景本机抠图原始合成.png' : 'final-matting.png';
        if (!cancelled && request.name === target) {
          cancelled = true;
          tasks.cancel(actor, wid, item.job_id);
        }
        return prepared;
      });
      let executions = 0;
      const worker = runner(async (context) => {
        executions++;
        const raw =
          (await context.nativeArtifacts!.load('background-mask-raw')) ??
          (await context.nativeArtifacts!.save('background-mask-raw', output(png)));
        const baseline = await context.nativeArtifacts!.save(
          'background-mask-baseline',
          output(png),
        );
        const pair = await context.nativeArtifacts!.saveMattingPair!(png, png);
        return {
          state: 'complete',
          outputs: [
            {
              ...output(png),
              name: 'final-matting.png',
              expectedImageSize: { width: 512, height: 512 },
              processing: {
                method: 'exact-background-v1',
                sourceAssetId: referenceId,
                color: value.imageEdit!.color,
                maskAssetIds: {
                  raw: raw.assetId,
                  baseline: baseline.assetId,
                  normalized: pair.mask.assetId,
                },
                params: { mattingCompositeAssetId: pair.composite.assetId },
              },
            },
          ],
        };
      });
      await worker.runItem(worker.claim()!);
      expect(cancelled).toBe(true);
      expect(tasks.get(actor, wid, item.job_id).status).toBe('reconciliation_required');
      expect(tasks.get(actor, wid, item.job_id).items[0]!.errorMessage).toMatch(/取消|停止/);
      expect(tasks.get(actor, wid, item.job_id).outputAssets).toHaveLength(0);
      expect(
        (
          db.sqlite
            .prepare("SELECT COUNT(*) n FROM credit_ledger WHERE job_id=? AND kind='settle'")
            .get(item.job_id) as { n: number }
        ).n,
      ).toBe(0);
      expect(
        (
          db.sqlite
            .prepare('SELECT COUNT(*) n FROM native_generation_checkpoints WHERE item_id=?')
            .get(item.id) as { n: number }
        ).n,
      ).toBe(at === 'pair' ? 2 : 4);
      expect(worker.claim()).toBeUndefined();
      tasks.resumeResult(actor, wid, item.job_id);
      await worker.runItem(worker.claim()!);
      const resumed = tasks.get(actor, wid, item.job_id);
      expect(resumed.status, JSON.stringify(resumed.items)).toBe('succeeded');
      expect(executions).toBe(at === 'pair' ? 2 : 1);
    },
  );
});

describe('native intermediate persistence', () => {
  it('preserves raw bytes, separates roles/source, and saves idempotently without a video frame', async () => {
    const item = running(seed());
    const artifacts = store(item);
    const raw = await artifacts.save('background-mask-raw', output(png));
    const normalized = await artifacts.save('background-mask', output(png));
    expect(raw.assetId).not.toBe(normalized.assetId);
    expect((await artifacts.load('background-mask-raw'))?.buffer.equals(png)).toBe(true);
    expect((await artifacts.save('background-mask-raw', output(png))).assetId).toBe(raw.assetId);
    expect(
      db.sqlite.prepare('SELECT source,name FROM assets WHERE id=?').get(raw.assetId),
    ).toMatchObject({ source: 'generation', name: '背景模型原始蒙版.png' });
    expect(
      db.sqlite.prepare('SELECT source FROM assets WHERE id=?').get(normalized.assetId),
    ).toEqual({ source: 'local-processing' });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_checkpoints').get(),
    ).toEqual({ n: 2 });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_frames').get()).toEqual({
      n: 0,
    });
    expect(db.sqlite.prepare('SELECT phase FROM job_items WHERE id=?').get(item.id)).toEqual({
      phase: 'processing',
    });
  });

  it('downloads an original URL once and subsequently reads its durable asset', async () => {
    const item = running(seed());
    download.mockResolvedValue(png);
    const saved = await store(item).save('background-mask-raw', {
      url: 'https://fixture.example/mask.png',
      mimeType: 'image/png',
      name: 'mask',
    });
    download.mockRejectedValue(new Error('URL expired'));
    expect((await store(item).load('background-mask-raw'))?.assetId).toBe(saved.assetId);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite an existing role with different bytes', async () => {
    const item = running(seed());
    await store(item).save('background-mask-raw', output(png));
    const changed = await sharp(png).negate().png().toBuffer();
    await expect(store(item).save('background-mask-raw', output(changed))).rejects.toMatchObject({
      code: 'NATIVE_CHECKPOINT_INVALID',
    });
    expect((await store(item).load('background-mask-raw'))?.buffer.equals(png)).toBe(true);
  });

  it('discards uncommitted media when the lease is lost', async () => {
    const item = running(seed());
    await expect(
      store(item, input(), () => false).save('background-mask-raw', output(png)),
    ).rejects.toMatchObject({ code: 'NATIVE_CHECKPOINT_INVALID' });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_checkpoints').get(),
    ).toEqual({ n: 0 });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 });
  });

  it('reuses only the real ancestor chain and exact input, never unrelated or sibling tasks', async () => {
    const value = input();
    const parent = running(seed(value));
    const saved = await store(parent, value).save('background-mask-raw', output(png));
    const unrelated = running(seed(value));
    expect(await store(unrelated, value).load('background-mask-raw')).toBeUndefined();
    const child = running(seed(value));
    db.sqlite
      .prepare('UPDATE job_items SET retry_source_item_id=?,retry_root_item_id=? WHERE id=?')
      .run(parent.id, parent.id, child.id);
    expect((await store(child, value).load('background-mask-raw'))?.assetId).toBe(saved.assetId);
    const changed = { ...value, prompt: 'Different requested edit' };
    const other = running(seed(changed));
    db.sqlite
      .prepare('UPDATE job_items SET retry_source_item_id=?,retry_root_item_id=? WHERE id=?')
      .run(parent.id, parent.id, other.id);
    expect(await store(other, changed).load('background-mask-raw')).toBeUndefined();
    const siblingParent = running(seed(value));
    const sibling = running(seed(value));
    db.sqlite
      .prepare('UPDATE job_items SET retry_source_item_id=?,retry_root_item_id=? WHERE id=?')
      .run(siblingParent.id, parent.id, sibling.id);
    expect(await store(sibling, value).load('background-mask-raw')).toBeUndefined();
  });

  it('rejects cross-workspace and cyclic retry ancestry', async () => {
    const parent = running(seed());
    await store(parent).save('background-mask-raw', output(png));
    const other = tasks.core.auth.createWorkspace(actor.userId, 'Other fixture', 'personal');
    const child = running(seed(input(), other.id));
    db.sqlite
      .prepare('UPDATE job_items SET retry_source_item_id=? WHERE id=?')
      .run(parent.id, child.id);
    await expect(store(child).load('background-mask-raw')).rejects.toMatchObject({
      code: 'NATIVE_CHECKPOINT_INVALID',
    });
    const loop = running(seed());
    db.sqlite
      .prepare('UPDATE job_items SET retry_source_item_id=? WHERE id=?')
      .run(loop.id, loop.id);
    await expect(store(loop).load('background-mask-raw')).rejects.toMatchObject({
      code: 'NATIVE_CHECKPOINT_INVALID',
    });
  });

  it('rejects checkpoint input tampering and missing/corrupt originals instead of returning a miss', async () => {
    const item = running(seed());
    const saved = await store(item).save('background-mask-raw', output(png));
    db.sqlite
      .prepare('UPDATE native_generation_checkpoints SET input_fingerprint=? WHERE item_id=?')
      .run('wrong', item.id);
    expect(() => findNativeArtifactCheckpoint(db, item, input(), 'background-mask-raw')).toThrow(
      '输入不一致',
    );
    db.sqlite
      .prepare('UPDATE native_generation_checkpoints SET input_fingerprint=? WHERE item_id=?')
      .run(nativeArtifactFingerprint(input()), item.id);
    const variant = db.sqlite
      .prepare("SELECT storage_key FROM asset_variants WHERE asset_id=? AND variant='original'")
      .get(saved.assetId) as { storage_key: string };
    const path = join(tasks.config.storageDir, variant.storage_key);
    expect((await readFile(path)).equals(png)).toBe(true);
    await writeFile(path, Buffer.from('corrupted'));
    await expect(store(item).load('background-mask-raw')).rejects.toMatchObject({
      code: 'NATIVE_CHECKPOINT_INVALID',
    });
    await rm(path);
    await expect(store(item).load('background-mask-raw')).rejects.toMatchObject({
      code: 'NATIVE_CHECKPOINT_INVALID',
    });
  });

  it('enforces checkpoint workspace relationships in the database', async () => {
    const item = running(seed());
    const other = tasks.core.auth.createWorkspace(actor.userId, 'Other fixture', 'personal');
    expect(() =>
      db.sqlite
        .prepare('INSERT INTO native_generation_checkpoints VALUES(?,?,?,?,?,?)')
        .run(
          item.id,
          other.id,
          'background-mask-raw',
          referenceId,
          nativeArtifactFingerprint(input()),
          new Date().toISOString(),
        ),
    ).toThrow();
  });
});

it('supports a provided mask without inventing a raw model artifact', async () => {
  const value = input();
  value.maskAssetId = referenceId;
  value.imageEdit!.mask = { mode: 'asset', assetId: referenceId };
  const item = running(seed(value));
  const artifacts = store(item, value);
  expect(await artifacts.load('background-mask-raw')).toBeUndefined();
  await expect(artifacts.save('background-mask-raw', output(png))).rejects.toMatchObject({
    code: 'NATIVE_CHECKPOINT_INVALID',
  });
  const mask = await artifacts.save('background-mask', output(png));
  expect(() =>
    validateNativeProcessing(db, item, value, {
      method: 'exact-background-v1',
      sourceAssetId: referenceId,
      color: '#e6e8eb',
      maskAssetIds: { normalized: mask.assetId },
    }),
  ).not.toThrow();
  expect(
    db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_checkpoints').get(),
  ).toEqual({ n: 1 });
});

describe('worker local recovery and durable provenance', () => {
  it('composes an approved asset mask at original size after all model credentials are removed', async () => {
    const pixels = Buffer.alloc(512 * 512 * 4, 0);
    for (let y = 0; y < 512; y++)
      for (let x = 256; x < 512; x++) pixels[(y * 512 + x) * 4 + 3] = 255;
    const mask = await tasks.core.assets.ingest(actor, wid, {
      buffer: await sharp(pixels, { raw: { width: 512, height: 512, channels: 4 } })
        .png()
        .toBuffer(),
      mimeType: 'image/png',
      name: 'confirmed-mask.png',
    });
    const value = input();
    value.maskAssetId = mask.id;
    value.imageEdit!.mask = { mode: 'asset', assetId: mask.id };
    const item = seed(value);
    tasks.settings.connections.update(wid, {
      kind: 'image',
      protocol: 'seedream-images',
      baseUrl: 'https://fixture.example/v1',
      modelsUrl: '',
      model: 'fixture-image',
      enabled: false,
      removeSecret: true,
    });
    expect(isNativeLocalBackgroundInput(value)).toBe(true);
    expect(() => validateNativeInput(value, {})).not.toThrow();
    const execute = vi.fn(createNativeProvider({}).execute);
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    const result = tasks.get(actor, wid, item.job_id);
    expect(result.status).toBe('succeeded');
    expect(download).not.toHaveBeenCalled();
    const asset = await tasks.core.assets.readOriginalForJob(
      { workspaceId: wid, createdBy: actor.userId, projectId: null, jobId: item.job_id },
      result.items[0]!.assetId!,
    );
    const decoded = await sharp(asset.buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 512, height: 512 });
    expect([...decoded.data.subarray(0, 3)]).toEqual([230, 232, 235]);
    expect([...decoded.data.subarray(300 * 3, 300 * 3 + 3)]).toEqual([136, 136, 136]);
    expect(
      db.sqlite
        .prepare('SELECT role FROM native_generation_checkpoints WHERE item_id=?')
        .all(item.id),
    ).toEqual([{ role: 'background-mask' }]);
    expect(() => validateNativeInput({ ...value, maskAssetId: referenceId }, {})).toThrow('不一致');
    expect(() =>
      validateNativeInput({ ...value, options: { ...value.options, width: 1024 } }, {}),
    ).toThrow('不一致');
  });

  it('retains the exact model video and records the separately processed result without a duplicate first frame', async () => {
    const value = videoInput();
    const item = seed(value);
    const bytes = await videoBytes();
    download.mockResolvedValue(bytes);
    const execute = vi.fn<ProviderAdapter['execute']>(async () => ({
      state: 'complete',
      outputs: [{ url: 'https://fixture.example/raw.mp4', mimeType: 'video/mp4', name: 'raw.mp4' }],
    }));
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
    const result = tasks.get(actor, wid, item.job_id);
    expect(result.status).toBe('succeeded');
    expect(result.items[0]!.resultText).toContain('视频模型完整原片');
    const original = await store(item, value).load('video-model-raw');
    expect(original!.buffer.equals(bytes)).toBe(true);
    expect(
      db.sqlite.prepare('SELECT source,name FROM assets WHERE id=?').get(original!.assetId),
    ).toEqual({ source: 'generation', name: '视频模型完整原片.mp4' });
    expect(
      db.sqlite.prepare('SELECT source FROM assets WHERE id=?').get(result.items[0]!.assetId),
    ).toEqual({ source: 'local-processing' });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_frames').get()).toEqual({
      n: 0,
    });
    const row = db.sqlite
      .prepare('SELECT processing_json FROM native_generation_provenance WHERE item_id=?')
      .get(item.id) as { processing_json: string };
    expect(JSON.parse(row.processing_json)).toMatchObject({
      method: 'model-video-tail-hold-v1',
      sourceAssetId: original!.assetId,
      params: { holdFrames: 12, spatialProcessing: 'none' },
    });
    expect(await readdir(join(directory, 'media', '.job-results'))).toEqual([]);
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 492, reserved: 0 });
  }, 30000);

  it('recovers only local processing after interruption, without credentials or another model submission', async () => {
    const value = videoInput();
    const item = seed(value);
    const bytes = await videoBytes();
    const processing = vi
      .spyOn(tailHold, 'renderNativeVideoTailHold')
      .mockRejectedValueOnce(
        new ProviderError('Local codec interrupted', true, 'NATIVE_TAIL_HOLD_PROCESSING'),
      );
    const execute = vi.fn<ProviderAdapter['execute']>(async () => ({
      state: 'complete',
      outputs: [videoOutput(bytes)],
    }));
    const first = runner(execute);
    await first.runItem(first.claim()!);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(hasNativeProcessingCheckpoint(db, item, value)).toBe(true);
    expect(
      db.sqlite.prepare('SELECT phase,recovery_failures FROM job_items WHERE id=?').get(item.id),
    ).toEqual({ phase: 'processing', recovery_failures: 1 });
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 8 });
    processing.mockRestore();
    await first.stop();
    // Recovery must use the frozen input and durable raw bytes even after configuration changes.
    tasks.settings.connections.update(wid, {
      kind: 'video',
      protocol: 'seedance-native',
      baseUrl: 'https://changed.example/api/v3/contents/generations/tasks',
      modelsUrl: '',
      model: 'changed',
      enabled: false,
      removeSecret: true,
    });
    db.sqlite
      .prepare("UPDATE job_items SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?")
      .run(item.id);
    const resume = vi.fn(createNativeProvider({}).execute);
    const worker = runner(resume);
    await worker.runItem(worker.claim()!);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(tasks.get(actor, wid, item.job_id).status).toBe('succeeded');
    expect(
      db.sqlite
        .prepare('SELECT COUNT(*) AS n FROM native_generation_checkpoints WHERE role=?')
        .get('video-model-raw'),
    ).toEqual({ n: 1 });
    expect((await store(item, value).load('video-model-raw'))!.buffer.equals(bytes)).toBe(true);
    expect(await readdir(join(directory, 'media', '.job-results'))).toEqual([]);
  }, 30000);

  it('rejects a malformed model video once, retaining its original and the reserved charge', async () => {
    const value = videoInput();
    value.options.ratio = '16:9';
    const item = seed(value);
    const bytes = await videoBytes();
    const execute = vi.fn<ProviderAdapter['execute']>(async () => ({
      state: 'complete',
      outputs: [videoOutput(bytes)],
    }));
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      db.sqlite
        .prepare('SELECT status,phase,recovery_failures FROM job_items WHERE id=?')
        .get(item.id),
    ).toEqual({ status: 'reconciliation_required', phase: 'processing', recovery_failures: 0 });
    expect((await store(item, value).load('video-model-raw'))!.buffer.equals(bytes)).toBe(true);
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 8 });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_provenance').get(),
    ).toEqual({ n: 0 });
  }, 30000);

  it('keeps a legacy frozen video untouched, without inventing local provenance or a raw checkpoint', async () => {
    const value = videoInput();
    delete value.nativePlan!.videoPostprocess;
    const item = seed(value);
    const bytes = await videoBytes();
    const execute = vi.fn<ProviderAdapter['execute']>(async () => ({
      state: 'complete',
      outputs: [videoOutput(bytes)],
    }));
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    const result = tasks.get(actor, wid, item.job_id);
    expect(result.status).toBe('succeeded');
    const output = await tasks.core.assets.readOriginalForJob(
      { workspaceId: wid, createdBy: actor.userId, projectId: null, jobId: item.job_id },
      result.items[0]!.assetId!,
    );
    expect(output.buffer.equals(bytes)).toBe(true);
    expect(
      db.sqlite.prepare('SELECT source FROM assets WHERE id=?').get(result.items[0]!.assetId),
    ).toEqual({ source: 'generation' });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_checkpoints').get(),
    ).toEqual({ n: 0 });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_provenance').get(),
    ).toEqual({ n: 0 });
  }, 30000);

  it('preserves existing masks when the video checkpoint migration is appended', async () => {
    const item = running(seed());
    const saved = await store(item).save('background-mask-raw', output(png));
    db.sqlite
      .prepare('DELETE FROM schema_migrations WHERE name=?')
      .run('0035-native-video-raw-checkpoints.sql');
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    expect((await store(item).load('background-mask-raw'))!.assetId).toBe(saved.assetId);
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_checkpoints').get(),
    ).toEqual({ n: 1 });
  });

  it('resumes from raw after a local interruption with one model invocation, retaining reservation until success', async () => {
    const value = input();
    const item = seed(value);
    let modelInvocations = 0;
    let interrupt = true;
    const execute = vi.fn<ProviderAdapter['execute']>(async (context) => {
      let raw = await context.nativeArtifacts!.load('background-mask-raw');
      if (!raw) {
        expect(context.resumeLocalProcessing).toBe(false);
        context.beforeAdditionalSubmission!();
        modelInvocations++;
        raw = await context.nativeArtifacts!.save('background-mask-raw', output(png));
      }
      if (interrupt) {
        interrupt = false;
        throw new Error('Local compositor interrupted');
      }
      expect(context.resumeLocalProcessing).toBe(true);
      const mask = await context.nativeArtifacts!.save('background-mask', output(png));
      return {
        state: 'complete',
        outputs: [
          {
            ...output(png),
            expectedImageSize: { width: 512, height: 512 },
            processing: {
              method: 'exact-background-v1',
              sourceAssetId: referenceId,
              maskAssetIds: { raw: raw.assetId, normalized: mask.assetId },
              color: value.imageEdit!.color,
              params: { maskAlgorithm: 'fixture-v1' },
            },
          },
        ],
      };
    });
    const first = runner(execute);
    await first.runItem(first.claim()!);
    expect(tasks.get(actor, wid, item.job_id).status).toBe('running');
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 500, reserved: 8 });
    expect(
      db.sqlite.prepare('SELECT phase,recovery_failures FROM job_items WHERE id=?').get(item.id),
    ).toEqual({ phase: 'processing', recovery_failures: 1 });
    await first.stop();
    db.sqlite
      .prepare("UPDATE job_items SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?")
      .run(item.id);
    const restarted = runner(execute);
    await restarted.runItem(restarted.claim()!);
    expect(modelInvocations).toBe(1);
    const result = tasks.get(actor, wid, item.job_id);
    expect(result.status).toBe('succeeded');
    expect(result.items[0]!.resultText).toContain('本机');
    expect(tasks.balance(actor, wid)).toMatchObject({ balance: 492, reserved: 0 });
    expect(
      db.sqlite.prepare('SELECT source FROM assets WHERE id=?').get(result.items[0]!.assetId),
    ).toEqual({ source: 'local-processing' });
    expect(db.sqlite.prepare('SELECT result_json FROM job_items WHERE id=?').get(item.id)).toEqual({
      result_json: null,
    });
    const provenance = db.sqlite
      .prepare('SELECT processing_json FROM native_generation_provenance WHERE item_id=?')
      .get(item.id) as { processing_json: string };
    expect(JSON.parse(provenance.processing_json)).toMatchObject({
      method: 'exact-background-v1',
      sourceAssetId: referenceId,
      color: '#e6e8eb',
    });
  });

  it('does not execute a forged processing phase without its raw checkpoint', async () => {
    const item = seed();
    db.sqlite.prepare("UPDATE jobs SET status='running' WHERE id=?").run(item.job_id);
    db.sqlite
      .prepare("UPDATE job_items SET status='running',phase='processing' WHERE id=?")
      .run(item.id);
    const execute = vi.fn<ProviderAdapter['execute']>();
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    expect(execute).not.toHaveBeenCalled();
    expect(tasks.get(actor, wid, item.job_id).status).toBe('reconciliation_required');
    expect(tasks.get(actor, wid, item.job_id).items[0]!.canResume).toBe(false);
    expect(() => tasks.resumeResult(actor, wid, item.job_id)).toThrow('没有可安全恢复');
    expect(tasks.balance(actor, wid).reserved).toBe(8);
  });

  it('keeps an ambiguous submission without a durable raw mask in reconciliation', async () => {
    const item = seed();
    const execute = vi.fn<ProviderAdapter['execute']>(async () => {
      throw new ProviderError('Response lost before mask persistence', true);
    });
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    worker.recover();
    await worker.tick();
    await worker.drain();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(tasks.get(actor, wid, item.job_id).status).toBe('reconciliation_required');
    expect(hasNativeProcessingCheckpoint(db, item, input())).toBe(false);
  });

  it('treats raw URL download failure as paid-response uncertainty, never a safe re-generation', async () => {
    const item = seed();
    download.mockRejectedValue(new ProviderError('Download rejected by network policy', false));
    const execute = vi.fn<ProviderAdapter['execute']>(async (context) => {
      await context.nativeArtifacts!.save('background-mask-raw', {
        url: 'https://fixture.example/mask.png',
        mimeType: 'image/png',
        name: 'mask',
      });
      throw new Error('unreachable');
    });
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    await worker.tick();
    await worker.drain();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(tasks.get(actor, wid, item.job_id).status).toBe('reconciliation_required');
    expect(tasks.balance(actor, wid).reserved).toBe(8);
  });

  it('retains invalid model mask evidence without ten retries or another model call', async () => {
    const item = seed();
    const execute = vi.fn<ProviderAdapter['execute']>(async (context) => {
      await context.nativeArtifacts!.save('background-mask-raw', output(png));
      throw new ProviderError('候选蒙版范围无效，原件已保留。', true, 'BACKGROUND_MASK_INVALID');
    });
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      db.sqlite
        .prepare('SELECT status,phase,recovery_failures,error_message FROM job_items WHERE id=?')
        .get(item.id),
    ).toEqual({
      status: 'reconciliation_required',
      phase: 'processing',
      recovery_failures: 0,
      error_message: '候选蒙版范围无效，原件已保留。',
    });
    expect(hasNativeProcessingCheckpoint(db, item, input())).toBe(true);
    expect(tasks.balance(actor, wid).reserved).toBe(8);
    expect(tasks.get(actor, wid, item.job_id).items[0]!.canResume).toBe(true);
    expect(tasks.resumeResult(actor, wid, item.job_id).status).toBe('running');
    expect(tasks.resumeResult(actor, wid, item.job_id).status).toBe('running');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('recovers an expired processing lease and forbids any further model submission', async () => {
    const item = running(seed());
    await store(item).save('background-mask-raw', output(png));
    db.sqlite
      .prepare(
        "UPDATE job_items SET lease_owner='crashed-worker',lease_until='2000-01-01T00:00:00Z' WHERE id=?",
      )
      .run(item.id);
    const execute = vi.fn<ProviderAdapter['execute']>(async (context) => {
      expect(context.resumeLocalProcessing).toBe(true);
      expect((await context.nativeArtifacts!.load('background-mask-raw'))?.buffer.equals(png)).toBe(
        true,
      );
      context.beforeAdditionalSubmission!();
      throw new Error('unreachable');
    });
    const worker = runner(execute);
    worker.recover();
    await worker.runItem(worker.claim()!);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(tasks.get(actor, wid, item.job_id).status).toBe('reconciliation_required');
    expect(tasks.get(actor, wid, item.job_id).errorMessage).toContain('不能重新请求模型');
  });

  it('records exact pan as local processing without creating a duplicate reference first frame', async () => {
    const value = jobInputSchema.parse({
      ...input(),
      operation: 'video.generate',
      imageEdit: undefined,
      nativePlan: {
        imagePrompt: '保留原图',
        videoPrompt: '静态图二维平移',
        firstFrame: { mode: 'reference', assetId: referenceId },
        cameraControl: { type: 'translate', direction: 'right', displacementPercent: 2 },
        motionRenderer: 'exact-pan-v1',
      },
      options: { model: 'doubao-seedance-2.0', ratio: '1:1', resolution: '720p', duration: 5 },
    });
    const item = seed(value);
    const execute = vi.fn<ProviderAdapter['execute']>(async (context) => {
      expect(context.resumeLocalProcessing).toBe(true);
      expect(context.nativeFrame).toBeUndefined();
      return renderExactPan(context, [960, 960]);
    });
    const worker = runner(execute);
    await worker.runItem(worker.claim()!);
    const result = tasks.get(actor, wid, item.job_id);
    expect(result.status).toBe('succeeded');
    expect(result.items[0]!.resultText).toContain('不是视频模型');
    expect(
      db.sqlite.prepare('SELECT source FROM assets WHERE id=?').get(result.items[0]!.assetId),
    ).toEqual({ source: 'local-processing' });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_frames').get()).toEqual({
      n: 0,
    });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM native_generation_checkpoints').get(),
    ).toEqual({ n: 0 });
    const provenance = db.sqlite
      .prepare('SELECT processing_json FROM native_generation_provenance WHERE item_id=?')
      .get(item.id) as { processing_json: string };
    expect(JSON.parse(provenance.processing_json)).toMatchObject({
      method: 'exact-pan-v1',
      sourceAssetId: referenceId,
    });
  }, 30000);

  it('rejects local provenance without matching frozen operation and bound mask roles', async () => {
    const value = input();
    const item = running(seed(value));
    const raw = await store(item, value).save('background-mask-raw', output(png));
    const mask = await store(item, value).save('background-mask', output(png));
    const processing: NativeProcessing = {
      method: 'exact-background-v1',
      sourceAssetId: referenceId,
      color: '#e6e8eb',
      maskAssetIds: { raw: raw.assetId, normalized: mask.assetId },
    };
    expect(() => validateNativeProcessing(db, item, value, processing)).not.toThrow();
    expect(() => validateNativeProcessing(db, item, value, undefined)).toThrow('来源记录');
    expect(() =>
      validateNativeProcessing(db, item, value, { ...processing, color: '#ffffff' }),
    ).toThrow('任务不一致');
    expect(() =>
      validateNativeProcessing(db, item, value, {
        ...processing,
        maskAssetIds: { raw: mask.assetId, normalized: raw.assetId },
      }),
    ).toThrow('标准化蒙版');
    expect(() =>
      validateNativeProcessing(db, item, { ...value, imageEdit: undefined }, processing),
    ).toThrow('任务不一致');
  });
});

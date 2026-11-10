import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
  access,
  readdir,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { rebaseRestoredCaches } from '../scripts/restored-cache';
import { backup } from '../scripts/backup';
import { restore } from '../scripts/restore';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import { createWorker } from '../src/worker/runner';
import type { ProviderAdapter } from '../src/server/tasks/types';

let root: string,
  app: Awaited<ReturnType<typeof createApp>>,
  actor: Actor,
  wid: string,
  png: Buffer;
const workers: ReturnType<typeof createWorker>[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yingzao-restored-cache-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:4310',
      databasePath: join(root, 'database.sqlite'),
      storageDir: join(root, 'media'),
      sessionSecret: 'local-cache-session',
      encryptionKey: 'local-cache-encryption',
      isProduction: false,
      demoMode: false,
      environmentSecrets: { openai: 'fixture-NOT-A-REAL-API-KEY' },
    },
    { serveWeb: false },
  );
  const registered = await app.services.core.auth.register({
    email: 'cache@example.local',
    password: 'LocalCache2026!',
    displayName: 'Cache fixture',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
  app.services.credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'cache-fixture',
    amount: 100,
    source: 'manual',
    description: 'Local restore fixture',
  });
  png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#548ad4' } })
    .png()
    .toBuffer();
});
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  await app.app.close();
  await rm(root, { recursive: true, force: true });
});
async function cache(legacy = false) {
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'Cached output fixture',
  });
  const quote = app.services.quote(actor, wid, input);
  const job = app.services.submit(actor, wid, input, quote.id, randomUUID());
  const itemId = job.items[0]!.id;
  const filename = `${itemId}-1-0.bin`;
  const localPath = join(root, 'media', '.job-results', filename);
  const oldPath = join(
    root,
    'unavailable-original-installation',
    'media',
    '.job-results',
    filename,
  );
  await mkdir(join(root, 'media', '.job-results'), { recursive: true });
  await writeFile(localPath, png);
  const outputs = [{ path: oldPath, mimeType: 'image/png', name: 'fixture.png' }];
  const manifest = JSON.stringify(legacy ? outputs : { outputKind: 'single', outputs });
  app.services.db.sqlite.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);
  app.services.db.sqlite
    .prepare(
      "UPDATE job_items SET status='running',phase='downloading',fence=1,result_json=? WHERE id=?",
    )
    .run(manifest, itemId);
  return { job, itemId, filename, localPath, oldPath, manifest };
}
it('does not publish a backup whose copied in-flight cache has disappeared', async () => {
  const item = await cache();
  await rm(item.localPath);
  await expect(backup(app.services.config, join(root, 'incomplete-backup'))).rejects.toMatchObject({
    code: 'RESTORE_CACHE_MISSING',
    itemId: item.itemId,
  });
  await expect(access(join(root, 'incomplete-backup'))).rejects.toThrow();
  expect((await readdir(root)).some((name) => name.includes('.staging-'))).toBe(false);
  expect(saved(item.itemId).result_json).toBe(item.manifest);
});

function saved(itemId: string) {
  return app.services.db.sqlite
    .prepare('SELECT result_json,status,phase,recovery_failures FROM job_items WHERE id=?')
    .get(itemId) as {
    result_json: string;
    status: string;
    phase: string;
    recovery_failures: number;
  };
}

it('restores a complete online backup into a new installation and completes cached work without touching its source', async () => {
  const item = await cache();
  const bundle = await backup(app.services.config, join(root, 'backup'));
  const before = await readFile(join(bundle, 'database.sqlite'));
  const destination = await restore(bundle, join(root, 'restored'));
  expect(await readFile(join(bundle, 'database.sqlite'))).toEqual(before);
  expect(saved(item.itemId).result_json).toBe(item.manifest);
  const restored = await createApp(
    {
      ...app.services.config,
      databasePath: join(destination, 'database.sqlite'),
      storageDir: join(destination, 'media'),
    },
    { serveWeb: false },
  );
  const execute = vi.fn<ProviderAdapter['execute']>(async () => {
    throw new Error('Unexpected paid submission');
  });
  const worker = createWorker(restored.services, { openai: { id: 'openai', execute } });
  try {
    await worker.runItem(worker.claim()!);
    const completed = restored.services.get(actor, wid, item.job.id);
    expect(completed.status).toBe('succeeded');
    expect(
      (await restored.services.core.assets.readOriginal(actor, wid, completed.outputAssets[0]!.id))
        .buffer,
    ).toEqual(png);
    expect(execute).not.toHaveBeenCalled();
    expect(restored.services.balance(actor, wid)).toMatchObject({ balance: 92, reserved: 0 });
    expect(saved(item.itemId).result_json).toBe(item.manifest);
    expect(await readFile(item.localPath)).toEqual(png);
  } finally {
    await worker.stop();
    await restored.app.close();
  }
});

it('reproduces a stalled restored cache, then recovers its copied bytes without any new provider submission', async () => {
  const item = await cache();
  const execute = vi.fn<ProviderAdapter['execute']>(async () => {
    throw new Error('Provider must never be called');
  });
  const worker = createWorker(app.services, { openai: { id: 'openai', execute } });
  workers.push(worker);
  await worker.runItem(worker.claim()!);
  expect(saved(item.itemId)).toMatchObject({
    status: 'running',
    phase: 'downloading',
    recovery_failures: 1,
    result_json: item.manifest,
  });
  expect(app.services.get(actor, wid, item.job.id).outputAssets).toHaveLength(0);
  const result = await rebaseRestoredCaches(root, join(root, 'media'));
  expect(result).toMatchObject({
    rebasedItems: 1,
    verifiedFiles: [{ itemId: item.itemId, byteSize: png.length }],
  });
  expect(saved(item.itemId).result_json).not.toContain('unavailable-original-installation');
  app.services.db.sqlite
    .prepare('UPDATE job_items SET next_attempt_at=? WHERE id=?')
    .run(new Date().toISOString(), item.itemId);
  await worker.runItem(worker.claim()!);
  const completed = app.services.get(actor, wid, item.job.id);
  expect(completed.status).toBe('succeeded');
  expect(
    (await app.services.core.assets.readOriginal(actor, wid, completed.outputAssets[0]!.id)).buffer,
  ).toEqual(png);
  expect(execute).not.toHaveBeenCalled();
  expect(app.services.balance(actor, wid)).toMatchObject({ balance: 92, reserved: 0 });
});

it('rebases legacy array manifests to the final destination while preserving status and source metadata', async () => {
  const item = await cache(true);
  const before = saved(item.itemId);
  const final = join(root, 'published', 'media');
  await rebaseRestoredCaches(root, final);
  expect(saved(item.itemId)).toMatchObject({ ...before, result_json: expect.any(String) });
  expect(JSON.parse(saved(item.itemId).result_json)).toEqual([
    {
      path: join(final, '.job-results', item.filename),
      mimeType: 'image/png',
      name: 'fixture.png',
    },
  ]);
  expect(await readFile(item.localPath)).toEqual(png);
});

it('never falls back to an existing original-installation file if the copied cache is missing', async () => {
  const item = await cache();
  await mkdir(join(item.oldPath, '..'), { recursive: true });
  await writeFile(item.oldPath, png);
  await rm(item.localPath);
  await expect(rebaseRestoredCaches(root, join(root, 'media'))).rejects.toMatchObject({
    code: 'RESTORE_CACHE_MISSING',
    itemId: item.itemId,
  });
  expect(saved(item.itemId).result_json).toBe(item.manifest);
  expect(await readFile(item.oldPath)).toEqual(png);
});

it.each(['ownership', 'symlink', 'bytes', 'state', 'format'] as const)(
  'rejects invalid %s before updating any cache references',
  async (problem) => {
    const first = await cache();
    const second = await cache();
    if (problem === 'ownership') {
      const value = JSON.parse(second.manifest);
      value.outputs[0].path = first.oldPath;
      app.services.db.sqlite
        .prepare('UPDATE job_items SET result_json=? WHERE id=?')
        .run(JSON.stringify(value), second.itemId);
    } else if (problem === 'symlink') {
      await rm(second.localPath);
      await symlink(first.localPath, second.localPath);
    } else if (problem === 'bytes') await writeFile(second.localPath, 'not media');
    else if (problem === 'state')
      app.services.db.sqlite
        .prepare("UPDATE job_items SET status='queued',phase='queued' WHERE id=?")
        .run(second.itemId);
    else
      app.services.db.sqlite
        .prepare("UPDATE job_items SET result_json='{}' WHERE id=?")
        .run(second.itemId);
    const expectedCode = {
      ownership: 'RESTORE_CACHE_OWNERSHIP',
      symlink: 'RESTORE_CACHE_MISSING',
      bytes: 'RESTORE_CACHE_CONTENT',
      state: 'RESTORE_CACHE_STATE',
      format: 'RESTORE_CACHE_MANIFEST',
    }[problem];
    await expect(rebaseRestoredCaches(root, join(root, 'media'))).rejects.toMatchObject({
      code: expectedCode,
      itemId: second.itemId,
    });
    expect(saved(first.itemId).result_json).toBe(first.manifest);
  },
);

it('leaves cleared successful tasks and pathless text results unchanged', async () => {
  const item = await cache();
  app.services.db.sqlite
    .prepare("UPDATE job_items SET status='succeeded',phase='done',result_json=NULL WHERE id=?")
    .run(item.itemId);
  expect(await rebaseRestoredCaches(root, join(root, 'media'))).toEqual({
    rebasedItems: 0,
    verifiedFiles: [],
  });
  const manifest = JSON.stringify({
    outputKind: 'single',
    outputs: [{ mimeType: 'text/plain', name: 'result.txt', text: 'Saved text' }],
  });
  app.services.db.sqlite
    .prepare('UPDATE job_items SET result_json=? WHERE id=?')
    .run(manifest, item.itemId);
  expect(await rebaseRestoredCaches(root, join(root, 'media'))).toEqual({
    rebasedItems: 0,
    verifiedFiles: [],
  });
  expect(saved(item.itemId).result_json).toBe(manifest);
});

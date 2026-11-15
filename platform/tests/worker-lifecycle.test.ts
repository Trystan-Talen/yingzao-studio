import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServices } from '../src/server/app';
import { closeDatabase } from '../src/server/db/connection';
import { createWorker } from '../src/worker/runner';

let folder: string;
let services: ReturnType<typeof createServices>;
let worker: ReturnType<typeof createWorker>;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-worker-lifecycle-'));
  services = createServices({
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(folder, 'database.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'worker-lifecycle-session-fixture',
    encryptionKey: 'worker-lifecycle-encryption-fixture',
    demoMode: false,
    isProduction: false,
    environmentSecrets: {},
  });
  worker = createWorker(services);
});
afterEach(async () => {
  await worker.stop();
  vi.restoreAllMocks();
  closeDatabase(services.db);
  await rm(folder, { recursive: true, force: true });
});
function extractionGate() {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const entered = new Promise<void>((done) => (started = done));
  const extract = vi
    .spyOn(services.core.assets, 'processPendingExtractions')
    .mockImplementation(async () => {
      started();
      await gate;
      services.db.sqlite.prepare('SELECT 1').get();
      return 0;
    });
  return { release, entered, extract };
}

it('shares overlapping ticks while document extraction is pending', async () => {
  const { release, entered, extract } = extractionGate();
  const first = worker.tick();
  await entered;
  const second = worker.tick();
  try {
    await setImmediate();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  } finally {
    release();
    await Promise.all([first, second]);
  }
});

it('waits for a pending extraction before stop allows the database to close', async () => {
  const { release, entered } = extractionGate();
  const tick = worker.tick();
  await entered;
  let stopped = false;
  const stop = worker.stop().then(() => (stopped = true));
  try {
    await setImmediate();
    expect(stopped).toBe(false);
  } finally {
    release();
    await Promise.all([tick, stop]);
  }
  expect(stopped).toBe(true);
});

it('does not start extraction or queue maintenance after stopping', async () => {
  const extract = vi.spyOn(services.core.assets, 'processPendingExtractions');
  await worker.stop();
  const prepare = vi.spyOn(services.db.sqlite, 'prepare');
  await worker.tick();
  expect(extract).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

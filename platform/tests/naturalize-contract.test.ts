/** F22 verifies the existing tool contract and saved bytes, never model visual quality. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema } from '../src/contracts/jobs';
import { providerJson } from '../src/server/providers/http';
import { createWorker } from '../src/worker/runner';

vi.mock('../src/server/providers/http', async (original) => ({
  ...(await original<typeof import('../src/server/providers/http')>()),
  providerJson: vi.fn(),
}));
const call = vi.mocked(providerJson);
let app: Awaited<ReturnType<typeof createApp>>, directory: string, actor: Actor, wid: string;
let source: Buffer, result: Buffer;
beforeEach(async () => {
  vi.clearAllMocks();
  call.mockRejectedValue(new Error('Unexpected provider request in offline F22 contract'));
  directory = await mkdtemp(join(tmpdir(), 'yingzao-naturalize-contract-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(directory, 'isolated.sqlite'),
      storageDir: join(directory, 'media'),
      sessionSecret: 'naturalize-test',
      encryptionKey: 'naturalize-test',
      demoMode: false,
      isProduction: false,
      environmentSecrets: { openai: 'offline-fixture' },
    },
    { serveWeb: false },
  );
  const account = await app.services.core.auth.register({
    email: 'naturalize@example.local',
    password: 'NaturalizeContract2026!',
    displayName: 'Naturalize contract',
  });
  wid = account.workspace.id;
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  app.services.credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    amount: 100,
    eventKey: 'offline-naturalize',
    source: 'manual',
    description: 'Offline test only',
  });
  source = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#305070' } })
    .png()
    .toBuffer();
  result = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: '#7090b0' },
  })
    .png()
    .toBuffer();
});
afterEach(async () => {
  await app?.app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function asset(owner = actor, workspaceId = wid) {
  return app.services.core.assets.ingest(owner, workspaceId, {
    buffer: source,
    mimeType: 'image/png',
    name: 'original.png',
  });
}
function input(ids: string[]) {
  return jobInputSchema.parse({
    operation: 'image-naturalize',
    providerId: 'openai',
    assetIds: ids,
    prompt: '保留瓶身与现有排版，改善表面光线',
    options: { model: 'gpt-image-2', ratio: '1:1', resolution: '1K' },
  });
}

it('sends the actual source and natural-light intent once, stores distinct result bytes and settles the quoted credits', async () => {
  const original = await asset(),
    value = input([original.id]);
  call.mockResolvedValue({ data: [{ b64_json: result.toString('base64') }] });
  const quote = app.services.quote(actor, wid, value);
  expect(quote.units).toBe(1);
  expect(quote.maxCredits).toBeGreaterThan(0);
  const before = app.services.credits.account(wid);
  const requestId = randomUUID();
  const job = app.services.submit(actor, wid, value, quote.id, requestId);
  const worker = createWorker(app.services);
  try {
    await worker.runItem(worker.claim()!);
  } finally {
    await worker.stop();
  }
  const done = app.services.get(actor, wid, job.id);
  expect(done.status).toBe('succeeded');
  expect(call).toHaveBeenCalledTimes(1);
  const [url, request] = call.mock.calls[0]!;
  expect(url).toBe('https://api.openai.com/v1/images/edits');
  const body = request!.body as {
    model: string;
    n: number;
    prompt: string;
    images: { image_url: string }[];
    mask?: unknown;
  };
  expect(body.model).toBe('gpt-image-2');
  expect(body.n).toBe(1);
  expect(body.mask).toBeUndefined();
  expect(body.prompt).toContain('natural texture and realistic lighting');
  expect(body.prompt).toContain('Preserve product identity and existing composition');
  expect(body.prompt).toContain(value.prompt);
  expect(body.images).toHaveLength(1);
  const sent = Buffer.from(body.images[0]!.image_url.split(',')[1]!, 'base64');
  expect(await sharp(sent).removeAlpha().raw().toBuffer()).toEqual(
    await sharp(source).raw().toBuffer(),
  );
  const output = await app.services.core.assets.readOriginal(actor, wid, done.outputAssets[0]!.id);
  expect(output.buffer).toEqual(result);
  expect(done.outputAssets[0]!.id).not.toBe(original.id);
  const kept = await app.services.core.assets.readOriginal(actor, wid, original.id);
  expect(createHash('sha256').update(kept.buffer).digest('hex')).toBe(
    createHash('sha256').update(source).digest('hex'),
  );
  expect(app.services.credits.account(wid)).toEqual({
    balance: before.balance - quote.maxCredits,
    reserved: 0,
  });
  expect(app.services.submit(actor, wid, value, quote.id, requestId).id).toBe(job.id);
  expect(call).toHaveBeenCalledTimes(1);
});

it('rejects zero, multiple and foreign sources before quoting or contacting a model', async () => {
  const own = await asset();
  const other = app.services.core.auth.createWorkspace(
    actor.userId,
    'Other isolated workspace',
    'personal',
  );
  const foreign = await asset(actor, other.id);
  for (const ids of [[], [own.id, own.id], [foreign.id]])
    expect(() => app.services.quote(actor, wid, input(ids))).toThrow();
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM quotes').get()).toEqual({ n: 0 });
  expect(app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 0 });
  expect(call).not.toHaveBeenCalled();
});

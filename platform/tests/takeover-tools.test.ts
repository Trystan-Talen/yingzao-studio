/** Offline contracts and actual local pixel checks, never real model inference. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import { falProvider } from '../src/server/providers/fal';
import { openaiProvider } from '../src/server/providers/openai';
import { createWorker } from '../src/worker/runner';
import type { ExecutionContext } from '../src/server/tasks/types';

let folder: string;
let instance: Awaited<ReturnType<typeof createApp>>;
let actor: Actor;
let wid: string;
let source: Buffer;
let mask: Buffer;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-new-tools-'));
  instance = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(folder, 'test.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'tool-fixture',
      encryptionKey: 'tool-fixture',
      isProduction: false,
      demoMode: true,
      environmentSecrets: { openai: 'fixture-not-a-key', fal: 'fixture-not-a-key' },
    },
    { serveWeb: false },
  );
  const registered = await instance.services.core.auth.register({
    email: 'tools@example.local',
    password: 'ToolFixture2026!',
    displayName: '工具测试',
  });
  actor = {
    userId: registered.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = registered.workspace.id;
  source = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#0000ff' } })
    .png()
    .toBuffer();
  const pixels = Buffer.alloc(8 * 4 * 4, 0);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 8; x++)
      pixels[(y * 8 + x) * 4 + 3] = x >= 2 && x < 5 && y >= 1 && y < 3 ? 0 : 255;
  mask = await sharp(pixels, { raw: { width: 8, height: 4, channels: 4 } })
    .png()
    .toBuffer();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await instance.app.close();
  await rm(folder, { recursive: true, force: true });
});
async function asset(buffer = source, name = 'source.png') {
  return instance.services.core.assets.ingest(actor, wid, { buffer, name, mimeType: 'image/png' });
}
function context(raw: Record<string, unknown>, files: Record<string, Buffer>): ExecutionContext {
  return {
    actor,
    workspaceId: wid,
    input: jobInputSchema.parse({ providerId: 'fal', ...raw }),
    readAsset: async (id) => ({ buffer: files[id]!, mimeType: 'image/png', name: 'fixture.png' }),
  };
}
function queue() {
  return new Response(
    JSON.stringify({
      request_id: 'fixture',
      status_url: 'https://queue.fal.run/status',
      response_url: 'https://queue.fal.run/result',
    }),
  );
}

it('advertises separate erase/model-replacement capabilities and rejects missing or foreign input roles', async () => {
  const image = await asset();
  const stencil = await asset(mask, 'mask.png');
  const caps = instance.services.settings.capabilities(wid);
  expect(caps.operations.some((op) => op.id === 'image-erase' && op.providerId === 'openai')).toBe(
    true,
  );
  expect(caps.operations.some((op) => op.id === 'image-erase' && op.providerId === 'fal')).toBe(
    true,
  );
  expect(caps.operations.some((op) => op.id === 'model-replace')).toBe(true);
  expect(() =>
    instance.services.quote(actor, wid, {
      operation: 'image-erase',
      providerId: 'openai',
      assetIds: [image.id],
    }),
  ).toThrow();
  expect(() =>
    instance.services.quote(actor, wid, {
      operation: 'model-replace',
      providerId: 'openai',
      assetIds: [image.id],
    }),
  ).toThrow();
  const erase = jobInputSchema.parse({
    operation: 'image-erase',
    providerId: 'openai',
    assetIds: [image.id],
    maskAssetId: stencil.id,
  });
  expect(instance.services.quote(actor, wid, erase).units).toBe(1);
  expect(() =>
    instance.services.quote(actor, wid, { ...erase, referenceAssetIds: [image.id] }),
  ).toThrow();
  const foreign = instance.services.core.auth.createWorkspace(actor.userId, '另一空间', 'team');
  const background = await instance.services.core.assets.ingest(actor, foreign.id, {
    buffer: source,
    name: 'foreign.png',
    mimeType: 'image/png',
  });
  expect(() =>
    instance.services.quote(actor, wid, {
      operation: 'model-replace',
      providerId: 'openai',
      assetIds: [image.id],
      referenceAssetIds: [image.id],
      backgroundAssetId: background.id,
    }),
  ).toThrow();
});

it('converts the eraser alpha mask into white-edit/black-keep pixels before fal submission', async () => {
  const id = randomUUID(),
    maskId = randomUUID();
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => queue());
  await falProvider.execute(
    context(
      { operation: 'image-erase', assetIds: [id], maskAssetId: maskId },
      { [id]: source, [maskId]: mask },
    ),
    'fixture-key',
  );
  expect(fetch.mock.calls[0]![0]).toBe('https://queue.fal.run/fal-ai/bria/eraser');
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(body.mask_type).toBe('manual');
  const whiteMask = Buffer.from(body.mask_url.split(',')[1], 'base64');
  const decoded = await sharp(whiteMask).greyscale().raw().toBuffer();
  expect(decoded[0]).toBe(0);
  expect(decoded[1 * 8 + 2]).toBe(255);
  const opaque = await sharp({
    create: { width: 8, height: 4, channels: 4, background: '#000000ff' },
  })
    .png()
    .toBuffer();
  await expect(
    falProvider.execute(
      context(
        { operation: 'image-erase', assetIds: [id], maskAssetId: maskId },
        { [id]: source, [maskId]: opaque },
      ),
      'fixture-key',
    ),
  ).rejects.toThrow(/透明|区域/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps every unmasked source pixel and original dimensions when importing an eraser result', async () => {
  const image = await asset();
  const stencil = await asset(mask, 'mask.png');
  const value = jobInputSchema.parse({
    operation: 'image-erase',
    providerId: 'openai',
    assetIds: [image.id],
    maskAssetId: stencil.id,
  });
  const quote = instance.services.quote(actor, wid, value);
  const job = instance.services.submit(actor, wid, value, quote.id, randomUUID());
  const generated = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  const worker = createWorker(instance.services, {
    openai: {
      id: 'openai',
      execute: async () => ({
        state: 'complete',
        outputs: [{ buffer: generated, mimeType: 'image/png', name: 'erased.png' }],
      }),
    },
  });
  try {
    await worker.runItem(worker.claim()!);
  } finally {
    await worker.stop();
  }
  const done = instance.services.get(actor, wid, job.id);
  expect(done.status).toBe('succeeded');
  const output = await instance.services.core.assets.readOriginal(
    actor,
    wid,
    done.outputAssets[0]!.id,
  );
  const actual = await sharp(output.buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([actual.info.width, actual.info.height]).toEqual([8, 4]);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 8; x++) {
      const edited = x >= 2 && x < 5 && y >= 1 && y < 3;
      expect([...actual.data.subarray((y * 8 + x) * 3, (y * 8 + x) * 3 + 3)]).toEqual(
        edited ? [255, 0, 0] : [0, 0, 255],
      );
    }
});

it('keeps clothing/person/background image roles distinct in OpenAI model replacement', async () => {
  const clothing = randomUUID(),
    person = randomUUID(),
    background = randomUUID();
  const target = await sharp({
    create: { width: 8, height: 4, channels: 3, background: '#00ff00' },
  })
    .png()
    .toBuffer();
  const scene = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify({ data: [{ b64_json: source.toString('base64') }] })),
    );
  await openaiProvider.execute(
    context(
      {
        operation: 'model-replace',
        providerId: 'openai',
        assetIds: [clothing],
        referenceAssetIds: [person],
        backgroundAssetId: background,
      },
      { [clothing]: source, [person]: target, [background]: scene },
    ),
    'fixture-key',
  );
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(body.images).toHaveLength(3);
  expect(body.prompt).toMatch(/garment|clothing/i);
  expect(body.prompt).toMatch(/target.*model|second image/i);
  const colors = await Promise.all(
    body.images.map(async (image: { image_url: string }) => [
      ...(
        await sharp(Buffer.from(image.image_url.split(',')[1]!, 'base64'))
          .removeAlpha()
          .raw()
          .toBuffer()
      ).subarray(0, 3),
    ]),
  );
  expect(colors).toEqual([
    [0, 0, 255],
    [0, 255, 0],
    [255, 255, 255],
  ]);
});

it('maps fal try-on to explicit clothing/person fields and refuses unsupported background or instructions', async () => {
  const clothing = randomUUID(),
    person = randomUUID();
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => queue());
  await falProvider.execute(
    context(
      { operation: 'model-replace', assetIds: [clothing], referenceAssetIds: [person] },
      { [clothing]: source, [person]: source },
    ),
    'fixture-key',
  );
  expect(fetch.mock.calls[0]![0]).toBe('https://queue.fal.run/fal-ai/image-apps-v2/virtual-try-on');
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(body).toHaveProperty('person_image_url');
  expect(body).toHaveProperty('clothing_image_url');
  expect(body.preserve_pose).toBe(true);
  await expect(
    falProvider.execute(
      context(
        {
          operation: 'model-replace',
          assetIds: [clothing],
          referenceAssetIds: [person],
          backgroundAssetId: randomUUID(),
        },
        { [clothing]: source, [person]: source },
      ),
      'fixture-key',
    ),
  ).rejects.toThrow(/背景/);
  await expect(
    falProvider.execute(
      context(
        {
          operation: 'model-replace',
          assetIds: [clothing],
          referenceAssetIds: [person],
          prompt: '指定背景',
        },
        { [clothing]: source, [person]: source },
      ),
      'fixture-key',
    ),
  ).rejects.toThrow(/说明|提示|描述/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

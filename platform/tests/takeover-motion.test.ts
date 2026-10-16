/** End-to-end local media/quote/worker test. Provider response is a fixture, with no network call. */
import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { createApp } from '../src/server/app';
import { createWorker } from '../src/worker/runner';
import { buildFalMotionRequest } from '../src/server/providers/fal-motion';
import { jobInputSchema } from '../src/contracts/jobs';
import type { Actor } from '../src/contracts/core';
it('quotes probed selected seconds and completes an actual local clip through the worker', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-motion-flow-')),
    exec = promisify(execFile);
  const instance = await createApp(
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
      environmentSecrets: { fal: 'fixture-only' },
    },
    { serveWeb: false },
  );
  let worker: ReturnType<typeof createWorker> | undefined;
  try {
    const user = await instance.services.core.auth.register({
      email: 'motion-flow@example.local',
      password: 'MotionFlowFixture2026!',
      displayName: 'Motion fixture',
    });
    const wid = user.workspace.id,
      actor: Actor = {
        userId: user.user.id,
        authType: 'session',
        apiKeyId: null,
        workspaceId: null,
        scopes: [],
      };
    const file = join(folder, 'reference.mp4');
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=360x360:r=24:d=8',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=330:duration=8',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        '-y',
        file,
      ],
      { timeout: 30000 },
    );
    const source = await instance.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({
        create: { width: 360, height: 360, channels: 3, background: '#446655' },
      })
        .png()
        .toBuffer(),
      name: 'person.png',
      mimeType: 'image/png',
    });
    const video = await instance.services.core.assets.ingest(actor, wid, {
      buffer: await readFile(file),
      name: 'reference.mp4',
      mimeType: 'video/mp4',
    });
    expect(video.durationMs).toBeCloseTo(8000, -2);
    const input = jobInputSchema.parse({
      operation: 'video.motion-replica',
      providerId: 'fal',
      assetIds: [source.id],
      referenceAssetIds: [video.id],
      prompt: '保持人物外观',
      options: {
        model: 'kling-2.6-motion-standard',
        mode: 'exact',
        replacementType: 'model',
        referenceAuthorized: true,
        needText: false,
        ratio: 'auto',
        resolution: 'auto',
        duration: 4,
        trimStart: 2,
        trimEnd: 6,
        keepMusicRhythm: true,
      },
    });
    expect(() =>
      instance.services.quote(actor, wid, {
        ...input,
        options: { ...input.options, referenceAuthorized: false },
      }),
    ).toThrow(/授权/);
    expect(() =>
      instance.services.quote(actor, wid, {
        ...input,
        options: { ...input.options, duration: 10 },
      }),
    ).toThrow(/时长/);
    expect(() =>
      instance.services.quote(actor, wid, { ...input, options: { ...input.options, trimEnd: 10 } }),
    ).toThrow(/参考视频/);
    const quote = instance.services.quote(actor, wid, input);
    expect(quote).toMatchObject({ units: 4, maxCredits: 20 });
    const job = instance.services.submit(actor, wid, input, quote.id, randomUUID());
    let calls = 0;
    worker = createWorker(instance.services, {
      fal: {
        id: 'fal',
        execute: async (context) => {
          calls++;
          const request = await buildFalMotionRequest(context);
          expect(request.body.keep_original_sound).toBe(true);
          return {
            state: 'complete',
            outputs: [
              {
                buffer: Buffer.from(String(request.body.video_url).split(',')[1]!, 'base64'),
                mimeType: 'video/mp4',
                name: 'fixture-motion.mp4',
              },
            ],
          };
        },
      },
    });
    await worker.runItem(worker.claim()!);
    const done = instance.services.get(actor, wid, job.id);
    expect(calls).toBe(1);
    expect(done).toMatchObject({ status: 'succeeded', settledCredits: 20 });
    expect(done.outputAssets[0]?.durationMs).toBeCloseTo(4000, -2);
    expect(instance.services.balance(actor, wid)).toMatchObject({
      balance: 980,
      reserved: 0,
      spent: 20,
    });
  } finally {
    await worker?.stop();
    await instance.app.close();
    await rm(folder, { recursive: true, force: true });
  }
});

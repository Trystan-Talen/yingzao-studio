import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema } from '../src/contracts/jobs';
import { nativeArtifactFingerprint } from '../src/server/tasks/native-artifacts';
import { createWorker } from '../src/worker/runner';

let app: Awaited<ReturnType<typeof createApp>>,
  dir: string,
  actor: Actor,
  wid: string,
  cookie: string;
let jobId: string, itemId: string, sourceId: string, originalMaskId: string;
let worker: ReturnType<typeof createWorker> | undefined;
const network = vi.fn(() => {
  throw Error('No model or external network permitted');
});
const origin = 'http://127.0.0.1:5174';
beforeEach(async () => {
  vi.stubGlobal('fetch', network);
  network.mockClear();
  dir = await mkdtemp(join(tmpdir(), 'background-review-'));
  app = await createApp(
    {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: origin,
      databasePath: join(dir, 'test.sqlite'),
      storageDir: join(dir, 'media'),
      sessionSecret: 'review-test',
      encryptionKey: 'review-test',
      isProduction: false,
      demoMode: false,
      environmentSecrets: {},
    },
    { serveWeb: false },
  );
  const account = await app.services.core.auth.register({
    email: 'review@example.local',
    password: 'BackgroundReview2026!',
    displayName: 'Review',
  });
  actor = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = app.services.core.auth.createWorkspace(actor.userId, 'Review team', 'team').id;
  cookie = `studio_session=${account.sessionToken}`;
  app.services.settings.connections.update(wid, {
    kind: 'image',
    protocol: 'seedream-images',
    baseUrl: 'https://review.invalid/v1',
    modelsUrl: '',
    model: 'doubao-seedream-5.0-lite',
    secret: 'not-used',
    enabled: true,
  });
  const source = await app.services.core.assets.ingest(actor, wid, {
    buffer: await sharp({
      create: { width: 2048, height: 2048, channels: 3, background: '#1e3c5a' },
    })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
    name: '原图.png',
  });
  sourceId = source.id;
  const pixels = Buffer.alloc(2048 * 2048);
  pixels.fill(255, 0, 2048 * 1024);
  const normalized = await app.services.core.assets.ingest(actor, wid, {
    buffer: await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 1 } })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
    name: '模型候选蒙版.png',
  });
  originalMaskId = normalized.id;
  const input = jobInputSchema.parse({
    providerId: 'native',
    operation: 'image.generate',
    prompt: '仅更改背景为#e6e8eb，保持主体不变。',
    nativeRevision: app.services.settings.connections.revision(wid, 'image.generate'),
    assetIds: [source.id],
    options: { model: 'doubao-seedream-5.0-lite', ratio: '1:1', resolution: '2K' },
    imageEdit: {
      type: 'solid-background',
      sourceAssetId: source.id,
      color: '#e6e8eb',
      regionDescription: '背景区域',
      preserveDescription: '主体和台面',
      mask: { mode: 'generate' },
    },
  });
  jobId = randomUUID();
  itemId = randomUUID();
  const at = new Date().toISOString(),
    fingerprint = nativeArtifactFingerprint(input),
    sql = app.services.db.sqlite;
  sql
    .prepare(
      `INSERT INTO jobs(id,workspace_id,user_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,settled_credits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'succeeded','complete',0,0,?,?)`,
    )
    .run(
      jobId,
      wid,
      actor.userId,
      input.operation,
      input.providerId,
      input.prompt,
      JSON.stringify(input),
      fingerprint,
      randomUUID(),
      'fixture',
      at,
      at,
    );
  sql
    .prepare(
      `INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,phase,credits,asset_id,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,0,?,'succeeded','complete',0,?,?,?,?)`,
    )
    .run(itemId, jobId, wid, actor.userId, JSON.stringify(input), source.id, at, at, at);
  sql
    .prepare('INSERT INTO native_generation_checkpoints VALUES(?,?,?,?,?,?)')
    .run(itemId, wid, 'background-mask', normalized.id, fingerprint, at);
  sql.prepare('INSERT INTO native_generation_provenance VALUES(?,?,?,?,?,?)').run(
    itemId,
    wid,
    source.id,
    fingerprint,
    JSON.stringify({
      method: 'exact-background-v1',
      sourceAssetId: source.id,
      maskAssetIds: { normalized: normalized.id },
      color: '#e6e8eb',
    }),
    at,
  );
});
afterEach(async () => {
  await worker?.stop();
  worker = undefined;
  await app?.app.close();
  await rm(dir, { recursive: true, force: true });
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
const base = () => `/api/v1/jobs/${jobId}/items/${itemId}/background-review`;
function call(
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  space = wid,
  session = cookie,
) {
  return app.app.inject({
    method,
    url,
    payload: payload as object,
    headers: { cookie: session, origin, 'x-workspace-id': space },
  });
}
async function mask(width = 2048, height = 2048, variant = 0, soft = false) {
  const alpha = Buffer.alloc(width * height, 255);
  alpha.fill(0, 0, width * Math.floor(height / 2) + variant);
  if (soft)
    [0, 63, 191, 255].forEach((value, index) =>
      alpha.fill(value, (width * height * index) / 4, (width * height * (index + 1)) / 4),
    );
  return app.services.core.assets.ingest(actor, wid, {
    buffer: await sharp({ create: { width, height, channels: 3, background: '#000' } })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
    name: '本人确认区域.png',
  });
}

it('freezes an idempotent trusted zero-credit local refinement and executes without any model', async () => {
  const detail = await call('GET', base());
  expect(detail.statusCode).toBe(200);
  expect(detail.json().data).toMatchObject({
    sourceAssetId: sourceId,
    maskAssetId: originalMaskId,
    state: 'candidate',
  });
  const edited = await mask(),
    requestId = randomUUID();
  const response = await call('POST', `${base()}/prepare`, { requestId, maskAssetId: edited.id });
  expect(response.statusCode, response.body).toBe(200);
  const prepared = response.json().data;
  expect(
    (await call('POST', `${base()}/prepare`, { requestId, maskAssetId: edited.id })).json().data.id,
  ).toBe(prepared.id);
  const changed = await mask(2048, 2048, 10);
  expect(
    (await call('POST', `${base()}/prepare`, { requestId, maskAssetId: changed.id })).statusCode,
  ).toBe(409);
  expect(prepared.input.imageEdit).toBeUndefined();
  const forged = {
    ...prepared.input,
    imageEdit: {
      ...prepared.result.imageEdit,
      sourceAssetId: changed.id,
      color: '#ff0000',
      mask: { mode: 'generate' },
    },
  };
  const before = app.services.credits.account(wid);
  const quote = app.services.quote(actor, wid, forged);
  expect(quote.maxCredits).toBe(0);
  expect(() =>
    app.services.quote(actor, wid, { ...prepared.input, maskAssetId: changed.id }),
  ).toThrow('需求或素材已修改');
  const request = randomUUID();
  const job = app.services.submit(actor, wid, forged, quote.id, request);
  expect(app.services.submit(actor, wid, forged, quote.id, request).id).toBe(job.id);
  const row = app.services.db.sqlite
    .prepare('SELECT input_json FROM job_items WHERE job_id=?')
    .get(job.id) as { input_json: string };
  expect(JSON.parse(row.input_json).imageEdit).toEqual({
    ...prepared.result.imageEdit,
    sourceAssetId: sourceId,
    color: '#e6e8eb',
    mask: { mode: 'asset', assetId: edited.id },
  });
  worker = createWorker(app.services);
  await worker.runItem(worker.claim()!);
  const done = app.services.get(actor, wid, job.id);
  expect(done.status, done.errorMessage ?? '').toBe('succeeded');
  expect(done.backgroundReview?.[0]?.state).toBe('confirmed');
  expect(done.requestedCredits).toBe(0);
  expect(app.services.credits.account(wid)).toEqual(before);
  const bytes = await app.services.core.assets.readOriginal(actor, wid, done.outputAssets[0]!.id);
  const data = await sharp(bytes.buffer).removeAlpha().raw().toBuffer();
  expect([...data.subarray(0, 3)]).toEqual([230, 232, 235]);
  expect([...data.subarray(2048 * 1800 * 3, 2048 * 1800 * 3 + 3)]).toEqual([30, 60, 90]);
  expect(app.services.get(actor, wid, jobId).backgroundReview?.[0]?.state).toBe('candidate');
});

it('accepts a broad confirmed soft gradient and preserves its exact opacity through zero-credit worker composition', async () => {
  const edited = await mask(2048, 2048, 0, true);
  const response = await call('POST', `${base()}/prepare`, {
    requestId: randomUUID(),
    maskAssetId: edited.id,
  });
  expect(response.statusCode, response.body).toBe(200);
  const input = response.json().data.input;
  const quote = app.services.quote(actor, wid, input);
  expect(quote.maxCredits).toBe(0);
  const job = app.services.submit(actor, wid, input, quote.id, randomUUID());
  worker = createWorker(app.services);
  await worker.runItem(worker.claim()!);
  const done = app.services.get(actor, wid, job.id);
  expect(done.status).toBe('succeeded');
  const output = await app.services.core.assets.readOriginal(actor, wid, done.outputAssets[0]!.id);
  const data = await sharp(output.buffer).removeAlpha().raw().toBuffer();
  for (const [index, alpha] of [0, 63, 191, 255].entries()) {
    const offset = (index * 512 + 256) * 2048 * 3;
    expect([...data.subarray(offset, offset + 3)]).toEqual(
      [30, 60, 90].map((channel, c) =>
        Math.round((channel * alpha + [230, 232, 235][c]! * (255 - alpha)) / 255),
      ),
    );
  }
});

it('keeps a frozen local refinement usable after the model connection is disabled', async () => {
  const edited = await mask();
  const response = await call('POST', `${base()}/prepare`, {
    requestId: randomUUID(),
    maskAssetId: edited.id,
  });
  expect(response.statusCode, response.body).toBe(200);
  const input = response.json().data.input;
  app.services.settings.connections.update(wid, {
    kind: 'image',
    protocol: 'seedream-images',
    baseUrl: 'https://review.invalid/v1',
    modelsUrl: '',
    model: 'doubao-seedream-5.0-lite',
    enabled: false,
    removeSecret: true,
  });
  expect(() =>
    app.services.quote(actor, wid, {
      ...input,
      creativeBriefId: undefined,
      imageEdit: response.json().data.result.imageEdit,
    }),
  ).toThrow();
  expect(() => app.services.quote(actor, wid, { ...input, maskAssetId: sourceId })).toThrow(
    '需求或素材已修改',
  );
  const quote = app.services.quote(actor, wid, input);
  expect(quote.maxCredits).toBe(0);
  const job = app.services.submit(actor, wid, input, quote.id, randomUUID());
  worker = createWorker(app.services);
  await worker.runItem(worker.claim()!);
  expect(app.services.get(actor, wid, job.id).status).toBe('succeeded');
});

it('retries a cancelled local refinement with the same confirmed mask and no model or credit reservation', async () => {
  const edited = await mask();
  const response = await call('POST', `${base()}/prepare`, {
    requestId: randomUUID(),
    maskAssetId: edited.id,
  });
  const input = response.json().data.input;
  const quote = app.services.quote(actor, wid, input);
  const original = app.services.submit(actor, wid, input, quote.id, randomUUID());
  app.services.cancel(actor, wid, original.id);
  app.services.settings.connections.update(wid, {
    kind: 'image',
    protocol: 'seedream-images',
    baseUrl: 'https://review.invalid/v1',
    modelsUrl: '',
    model: 'doubao-seedream-5.0-lite',
    enabled: false,
    removeSecret: true,
  });
  const retryQuote = app.services.retryQuote(actor, wid, original.id);
  expect(retryQuote.maxCredits).toBe(0);
  const retry = app.services.submit(actor, wid, input, retryQuote.id, randomUUID());
  expect(retry.items[0]!.retrySourceItemId).toBe(original.items[0]!.id);
  worker = createWorker(app.services);
  await worker.runItem(worker.claim()!);
  expect(app.services.get(actor, wid, retry.id).status).toBe('succeeded');
  expect(app.services.credits.account(wid).reserved).toBe(0);
  expect(app.services.get(actor, wid, original.id).status).toBe('cancelled');
});

it('rejects forged plans, wrong-size or opaque masks before freezing a refinement', async () => {
  const edited = await mask();
  for (const extra of [
    { color: '#ff0000' },
    { sourceAssetId: randomUUID() },
    { imageEdit: { mask: { mode: 'generate' } } },
  ])
    expect(
      (
        await call('POST', `${base()}/prepare`, {
          requestId: randomUUID(),
          maskAssetId: edited.id,
          ...extra,
        })
      ).statusCode,
    ).toBe(400);
  const wrong = await mask(512, 512);
  for (const maskAssetId of [wrong.id, originalMaskId])
    expect(
      (await call('POST', `${base()}/prepare`, { requestId: randomUUID(), maskAssetId }))
        .statusCode,
    ).toBe(400);
  expect(
    (
      app.services.db.sqlite.prepare('SELECT COUNT(*) n FROM creative_briefs').get() as {
        n: number;
      }
    ).n,
  ).toBe(0);
});

it('requires owned task provenance and rejects cross-workspace access or provenance drift', async () => {
  const other = app.services.core.auth.createWorkspace(actor.userId, 'Other workspace', 'personal');
  expect((await call('GET', base(), undefined, other.id, cookie)).statusCode).toBe(404);
  app.services.db.sqlite
    .prepare('UPDATE native_generation_provenance SET input_fingerprint=? WHERE item_id=?')
    .run('mismatch', itemId);
  expect((await call('GET', base())).statusCode).toBe(404);
  expect(app.services.get(actor, wid, jobId).backgroundReview).toEqual([]);
});

it('does not let another workspace editor review an owned job or supply their mask for it', async () => {
  const invite = app.services.core.team.invite(actor, wid, {
    email: 'colleague@example.local',
    role: 'member',
  });
  const colleague = await app.services.core.auth.register({
    email: 'colleague@example.local',
    password: 'ColleagueFixture2026!',
    displayName: '同事',
    inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
  });
  const colleagueActor: Actor = { ...actor, userId: colleague.user.id };
  const colleagueCookie = `studio_session=${colleague.sessionToken}`;
  expect((await call('GET', base(), undefined, wid, colleagueCookie)).statusCode).toBe(404);
  const ownMask = await mask();
  expect(
    (
      await call(
        'POST',
        `${base()}/prepare`,
        { requestId: randomUUID(), maskAssetId: ownMask.id },
        wid,
        colleagueCookie,
      )
    ).statusCode,
  ).toBe(404);
  const prepared = (
    await call('POST', `${base()}/prepare`, { requestId: randomUUID(), maskAssetId: ownMask.id })
  ).json().data;
  expect(() =>
    app.services.quote(colleagueActor, wid, {
      ...prepared.input,
      imageEdit: prepared.result.imageEdit,
    }),
  ).toThrow('未找到这次创作需求');
  const existing = await app.services.core.assets.readOriginal(actor, wid, ownMask.id);
  const otherMask = await app.services.core.assets.ingest(colleagueActor, wid, {
    buffer: existing.buffer,
    mimeType: 'image/png',
    name: '同事蒙版.png',
  });
  expect(
    (
      await call('POST', `${base()}/prepare`, {
        requestId: randomUUID(),
        maskAssetId: otherMask.id,
      })
    ).statusCode,
  ).toBe(400);
});

it('never treats a forged original request as a free compiled snapshot on retry', () => {
  app.services.settings.connections.update(wid, {
    kind: 'text',
    protocol: 'openai-chat',
    baseUrl: 'https://review.invalid/v1',
    modelsUrl: '',
    model: 'fixture-text',
    secret: 'not-used',
    enabled: true,
  });
  app.services.credits.grant({
    workspaceId: wid,
    userId: actor.userId,
    eventKey: 'retry-safety-budget',
    amount: 100,
    source: 'manual',
    description: '隔离安全回归积分',
  });
  const db = app.services.db.sqlite;
  const persisted = JSON.parse(
    (
      db.prepare('SELECT input_json FROM job_items WHERE id=?').get(itemId) as {
        input_json: string;
      }
    ).input_json,
  );
  persisted.nativeRevision = app.services.settings.connections.revision(wid, 'image.generate');
  const forgedOriginal = {
    ...persisted,
    maskAssetId: originalMaskId,
    imageEdit: { ...persisted.imageEdit, mask: { mode: 'asset', assetId: originalMaskId } },
  };
  // A legacy/imported failed-job fixture distinguishes the retained client request from its
  // compiled paid mask-generation item. No saved mask or paid-result recovery can waive cost.
  db.prepare('DELETE FROM native_generation_checkpoints WHERE item_id=?').run(itemId);
  db.prepare('DELETE FROM native_generation_provenance WHERE item_id=?').run(itemId);
  db.prepare("UPDATE jobs SET input_json=?,status='failed',requested_credits=8 WHERE id=?").run(
    JSON.stringify(forgedOriginal),
    jobId,
  );
  db.prepare(
    "UPDATE job_items SET input_json=?,status='failed',phase='queued',asset_id=NULL,credits=8 WHERE id=?",
  ).run(JSON.stringify(persisted), itemId);
  const quote = app.services.retryQuote(actor, wid, jobId);
  expect(quote.maxCredits).toBe(8);
  const saved = db.prepare('SELECT items_json FROM quotes WHERE id=?').get(quote.id) as {
    items_json: string;
  };
  expect(JSON.parse(saved.items_json)[0].imageEdit.mask.mode).toBe('generate');
  expect(app.services.credits.account(wid).reserved).toBe(0);
});

async function automaticRoot() {
  const sql = app.services.db.sqlite;
  const frozen = JSON.parse(
    (
      sql.prepare('SELECT input_json FROM job_items WHERE id=?').get(itemId) as {
        input_json: string;
      }
    ).input_json,
  );
  frozen.imageEdit.mask.calibration = 'local-matting-v2';
  const fingerprint = nativeArtifactFingerprint(jobInputSchema.parse(frozen));
  const pixels = Buffer.alloc(2048 * 2048 * 3);
  const maskPixels = Buffer.alloc(2048 * 2048);
  for (let y = 0; y < 2048; y++) {
    const level = y < 680 ? 255 : y < 1360 ? 127 : 0;
    const rgb = level === 255 ? [230, 232, 235] : level === 127 ? [120, 130, 140] : [30, 60, 90];
    for (let x = 0; x < 2048; x++) {
      const p = y * 2048 + x;
      maskPixels[p] = level;
      pixels.set(rgb, p * 3);
    }
  }
  const composite = await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 3 } })
    .png()
    .toBuffer();
  const rootResult = await app.services.core.assets.ingest(actor, wid, {
    buffer: composite,
    mimeType: 'image/png',
    name: '自动软边合成.png',
  });
  const rootMask = await app.services.core.assets.ingest(actor, wid, {
    buffer: await sharp(maskPixels, { raw: { width: 2048, height: 2048, channels: 1 } })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
    name: '自动编辑区.png',
  });
  sql
    .prepare('UPDATE jobs SET input_json=?,input_hash=? WHERE id=?')
    .run(JSON.stringify(frozen), fingerprint, jobId);
  sql
    .prepare('UPDATE job_items SET input_json=?,asset_id=? WHERE id=?')
    .run(JSON.stringify(frozen), rootResult.id, itemId);
  sql
    .prepare(
      'UPDATE native_generation_checkpoints SET input_fingerprint=?,asset_id=? WHERE item_id=?',
    )
    .run(fingerprint, rootMask.id, itemId);
  sql
    .prepare('INSERT INTO native_generation_checkpoints VALUES(?,?,?,?,?,?)')
    .run(
      itemId,
      wid,
      'background-matting-composite',
      rootResult.id,
      fingerprint,
      new Date().toISOString(),
    );
  sql
    .prepare(
      'UPDATE native_generation_provenance SET input_fingerprint=?,asset_id=?,processing_json=? WHERE item_id=?',
    )
    .run(
      fingerprint,
      rootResult.id,
      JSON.stringify({
        method: 'exact-background-v1',
        sourceAssetId: sourceId,
        color: '#e6e8eb',
        maskAssetIds: { normalized: rootMask.id },
      }),
      itemId,
    );
  async function confirmed(level: number) {
    const alpha = Buffer.from(maskPixels.map((value) => 255 - (value === 127 ? level : value)));
    return app.services.core.assets.ingest(actor, wid, {
      buffer: await sharp({
        create: { width: 2048, height: 2048, channels: 3, background: '#000' },
      })
        .joinChannel(alpha, { raw: { width: 2048, height: 2048, channels: 1 } })
        .png()
        .toBuffer(),
      mimeType: 'image/png',
      name: '已确认软边.png',
    });
  }
  return { rootResult, rootMask, composite, confirmed };
}

it('preserves the immutable automatic composition byte-for-byte for an unchanged mask', async () => {
  const root = await automaticRoot();
  const edited = await root.confirmed(127);
  const response = await call('POST', `${base()}/prepare`, {
    requestId: randomUUID(),
    maskAssetId: edited.id,
  });
  expect(response.statusCode, response.body).toBe(200);
  const prepared = response.json().data;
  expect(prepared.result.imageEdit.mattingBaseline).toMatchObject({
    resultAssetId: root.rootResult.id,
    maskAssetId: root.rootMask.id,
    resultSha256: createHash('sha256').update(root.composite).digest('hex'),
  });
  const quote = app.services.quote(actor, wid, prepared.input);
  expect(quote.maxCredits).toBe(0);
  const job = app.services.submit(actor, wid, prepared.input, quote.id, randomUUID());
  worker = createWorker(app.services);
  await worker.runItem(worker.claim()!);
  const done = app.services.get(actor, wid, job.id);
  expect(done.status, done.errorMessage ?? '').toBe('succeeded');
  const output = await app.services.core.assets.readOriginal(actor, wid, done.outputAssets[0]!.id);
  expect(output.buffer.equals(root.composite)).toBe(true);
});

it('keeps the same automatic root across multiple manual edits and restores it without cumulative drift', async () => {
  const root = await automaticRoot();
  worker = createWorker(app.services);
  let endpoint = base();
  for (const level of [70, 190, 127]) {
    const edited = await root.confirmed(level);
    const response = await call('POST', `${endpoint}/prepare`, {
      requestId: randomUUID(),
      maskAssetId: edited.id,
    });
    expect(response.statusCode, response.body).toBe(200);
    const prepared = response.json().data;
    expect(prepared.result.imageEdit.mattingBaseline.resultAssetId).toBe(root.rootResult.id);
    expect(prepared.result.imageEdit.mattingBaseline.maskAssetId).toBe(root.rootMask.id);
    const quote = app.services.quote(actor, wid, prepared.input);
    const job = app.services.submit(actor, wid, prepared.input, quote.id, randomUUID());
    await worker.runItem(worker.claim()!);
    const done = app.services.get(actor, wid, job.id);
    expect(done.status, done.errorMessage ?? '').toBe('succeeded');
    endpoint = `/api/v1/jobs/${job.id}/items/${done.items[0]!.id}/background-review`;
    const output = await app.services.core.assets.readOriginal(
      actor,
      wid,
      done.outputAssets[0]!.id,
    );
    if (level === 127) expect(output.buffer.equals(root.composite)).toBe(true);
    else expect(output.buffer.equals(root.composite)).toBe(false);
  }
});

it.each(['missing-pair', 'fingerprint', 'foreign-owner', 'damaged-bytes'])(
  'refuses an unsafe automatic baseline (%s) before freezing or calling models',
  async (failure) => {
    const root = await automaticRoot();
    const edited = await root.confirmed(127);
    const sql = app.services.db.sqlite;
    if (failure === 'missing-pair')
      sql
        .prepare(
          "DELETE FROM native_generation_checkpoints WHERE item_id=? AND role='background-matting-composite'",
        )
        .run(itemId);
    if (failure === 'fingerprint')
      sql
        .prepare(
          "UPDATE native_generation_checkpoints SET input_fingerprint='wrong' WHERE item_id=? AND role='background-matting-composite'",
        )
        .run(itemId);
    if (failure === 'foreign-owner') {
      const invite = app.services.core.team.invite(actor, wid, {
        email: 'baseline@example.local',
        role: 'member',
      });
      const other = await app.services.core.auth.register({
        email: 'baseline@example.local',
        password: 'BaselineOwner2026!',
        displayName: 'Other',
        inviteToken: new URL(invite.inviteUrl).hash.slice('#token='.length),
      });
      sql
        .prepare('UPDATE assets SET created_by=? WHERE id=?')
        .run(other.user.id, root.rootResult.id);
    }
    if (failure === 'damaged-bytes') {
      const variant = sql
        .prepare("SELECT storage_key FROM asset_variants WHERE asset_id=? AND variant='original'")
        .get(root.rootResult.id) as { storage_key: string };
      await writeFile(join(dir, 'media', variant.storage_key), Buffer.from('damaged checkpoint'));
    }
    const response = await call('POST', `${base()}/prepare`, {
      requestId: randomUUID(),
      maskAssetId: edited.id,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('BACKGROUND_REVIEW_BASELINE_INVALID');
    expect((sql.prepare('SELECT COUNT(*) n FROM creative_briefs').get() as { n: number }).n).toBe(
      0,
    );
  },
);

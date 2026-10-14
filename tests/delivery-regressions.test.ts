/** Delivery regressions exercise real SQLite, HTTP and media bytes; providers are deterministic fixtures. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import JSZip from 'jszip';
import type { Actor } from '../src/contracts/core';
import { jobInputSchema, type JobInput } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { createBillingAdmin } from '../src/server/billing/admin';
import { createWorker } from '../src/worker/runner';
import { ProviderError, type ProviderAdapter } from '../src/server/tasks/types';
let folder: string,
  config: AppConfig,
  instance: Awaited<ReturnType<typeof createApp>>,
  actor: Actor,
  wid: string,
  cookie: string,
  png: Buffer;
const workers: ReturnType<typeof createWorker>[] = [];
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-delivery-'));
  config = {
    host: '127.0.0.1',
    port: 4310,
    publicOrigin: 'http://127.0.0.1:5174',
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'test-session',
    encryptionKey: 'test-encryption',
    isProduction: false,
    demoMode: true,
    environmentSecrets: { openai: 'fixture-NOT-A-REAL-KEY' },
  };
  instance = await createApp(config, { serveWeb: false });
  const reg = await instance.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'delivery@example.local',
      password: 'DeliveryPassword2026!',
      displayName: 'Delivery',
    },
  });
  expect(reg.statusCode, reg.body).toBe(201);
  cookie = String(reg.headers['set-cookie']).split(';')[0]!;
  actor = {
    userId: reg.json().data.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = reg.json().data.workspace.id;
  png = await sharp({ create: { width: 48, height: 64, channels: 3, background: '#125647' } })
    .png()
    .toBuffer();
});
afterEach(async () => {
  for (const w of workers.splice(0)) await w.stop();
  await instance.app.close();
  await rm(folder, { recursive: true, force: true });
});
const headers = (space = wid, session = cookie) => ({
  cookie: session,
  origin: config.publicOrigin,
  'x-workspace-id': space,
});
const input = (partial: Partial<JobInput> = {}) =>
  jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    prompt: 'Synthetic provider output for delivery testing.',
    ...partial,
  });
function submit(i = input()) {
  const q = instance.services.quote(actor, wid, i);
  return instance.services.submit(actor, wid, i, q.id, randomUUID());
}
function worker(adapter: ProviderAdapter) {
  const w = createWorker(instance.services, { [adapter.id]: adapter });
  workers.push(w);
  return w;
}
async function completeJob(i = input()) {
  const job = submit(i),
    w = worker({
      id: 'openai',
      execute: async () => ({
        state: 'complete',
        outputs: [{ buffer: png, mimeType: 'image/png', name: '真实文件.png' }],
      }),
    });
  const claimed = w.claim();
  expect(claimed).not.toBeNull();
  await w.runItem(claimed!);
  return instance.services.get(actor, wid, job.id);
}
async function unknownJob(i = input()) {
  const job = submit(i),
    w = worker({
      id: 'openai',
      execute: async () => {
        throw new ProviderError('Fixture timeout after sending the request', true);
      },
    });
  await w.runItem(w.claim()!);
  const pending = instance.services.get(actor, wid, job.id);
  expect(pending.status).toBe('reconciliation_required');
  return pending;
}
async function storedPng(space = wid) {
  return instance.services.core.assets.ingest(actor, space, {
    buffer: png,
    name: 'stored.png',
    mimeType: 'image/png',
  });
}
describe('delivery regressions', () => {
  it('deduplicates concurrent upload IDs, rejects changed content and never crosses workspace boundaries', async () => {
    const { core, db } = instance.services,
      requestId = randomUUID(),
      upload = { buffer: png, name: 'concurrent.png', mimeType: 'image/png' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => core.assets.ingest(actor, wid, upload, requestId)),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM assets').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM upload_requests').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM asset_variants').get()).toEqual({ n: 3 });
    const files = await readdir(config.storageDir, { recursive: true, withFileTypes: true });
    expect(files.filter((f) => f.isFile())).toHaveLength(3);
    const aid = results[0]!.id;
    expect((await core.assets.readOriginal(actor, wid, aid)).buffer.equals(png)).toBe(true);
    const changed = await sharp({
      create: { width: 48, height: 64, channels: 3, background: '#dd6644' },
    })
      .png()
      .toBuffer();
    await expect(
      core.assets.ingest(actor, wid, { ...upload, buffer: changed }, requestId),
    ).rejects.toMatchObject({ statusCode: 409, code: 'UPLOAD_ID_CONFLICT' });
    await expect(
      core.assets.ingest(actor, wid, { ...upload, name: 'changed.png' }, requestId),
    ).rejects.toMatchObject({ code: 'UPLOAD_ID_CONFLICT' });
    const other = core.team.create(actor, { name: 'Other space' });
    expect(
      (await instance.app.inject({ url: `/api/v1/assets/${aid}`, headers: headers(other.id) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await instance.app.inject({
          url: `/api/v1/assets/${aid}/content`,
          headers: headers(other.id),
        })
      ).statusCode,
    ).toBe(403);
    await expect(core.assets.readOriginal(actor, other.id, aid)).rejects.toMatchObject({
      statusCode: 404,
    });
    // The same client request ID is namespaced by workspace, so a legitimate upload there is separate.
    const separate = await core.assets.ingest(actor, other.id, upload, requestId);
    expect(separate.id).not.toBe(aid);
  });
  it('archives and restores history per user while preserving completed artifacts and download markers', async () => {
    const team = instance.services.core.team.create(actor, { name: 'Shared team' });
    wid = team.id;
    const invitation = instance.services.core.team.invite(actor, wid, {
      email: 'member@example.local',
      role: 'member',
    });
    await instance.services.core.auth.register({
      email: 'member@example.local',
      password: 'MemberPassword2026!',
      displayName: 'Member',
      inviteToken: new URL(invitation.inviteUrl).hash.slice('#token='.length),
    });
    const login = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: headers(),
      payload: { email: 'member@example.local', password: 'MemberPassword2026!' },
    });
    expect(login.statusCode).toBe(200);
    const memberCookie = String(login.headers['set-cookie']).split(';')[0]!;
    const active = submit();
    expect(
      (
        await instance.app.inject({
          method: 'PATCH',
          url: `/api/v1/jobs/${active.id}/history`,
          headers: headers(),
          payload: { archived: true },
        })
      ).statusCode,
    ).toBe(409);
    const w = worker({
      id: 'openai',
      execute: async () => ({
        state: 'complete',
        outputs: [{ buffer: png, mimeType: 'image/png', name: 'history.png' }],
      }),
    });
    await w.runItem(w.claim()!);
    const archive = () =>
      instance.app.inject({
        method: 'PATCH',
        url: `/api/v1/jobs/${active.id}/history`,
        headers: headers(),
        payload: { archived: true },
      });
    expect((await archive()).statusCode).toBe(200);
    expect((await archive()).statusCode).toBe(200);
    expect(
      (await instance.app.inject({ url: '/api/v1/jobs', headers: headers() })).json().data.total,
    ).toBe(0);
    expect(
      (await instance.app.inject({ url: '/api/v1/jobs?archived=true', headers: headers() })).json()
        .data.items,
    ).toMatchObject([{ id: active.id, isArchived: true }]);
    expect(
      (
        await instance.app.inject({ url: '/api/v1/jobs', headers: headers(wid, memberCookie) })
      ).json().data.items,
    ).toMatchObject([{ id: active.id, isArchived: false, downloadedAt: null }]);
    expect(
      (
        await instance.app.inject({
          method: 'PATCH',
          url: `/api/v1/jobs/${active.id}/history`,
          headers: headers(),
          payload: { archived: false },
        })
      ).statusCode,
    ).toBe(200);
    const marked = await instance.app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${active.id}/downloaded`,
      headers: headers(),
    });
    expect(marked.statusCode).toBe(200);
    expect(
      (
        await instance.app.inject({ url: '/api/v1/jobs?downloaded=true', headers: headers() })
      ).json().data.total,
    ).toBe(1);
    expect(
      (
        await instance.app.inject({ url: '/api/v1/jobs?downloaded=false', headers: headers() })
      ).json().data.total,
    ).toBe(0);
    expect(
      (
        await instance.app.inject({
          url: '/api/v1/jobs?downloaded=true',
          headers: headers(wid, memberCookie),
        })
      ).json().data.total,
    ).toBe(0);
    const other = instance.services.core.team.create(actor, { name: 'Isolated' });
    for (const [method, url, payload] of [
      ['PATCH', `/api/v1/jobs/${active.id}/history`, { archived: true }],
      ['POST', `/api/v1/jobs/${active.id}/downloaded`, undefined],
    ] as const)
      expect(
        (await instance.app.inject({ method, url, headers: headers(other.id), payload }))
          .statusCode,
      ).toBe(404);
    expect(
      instance.services.db.sqlite.prepare('SELECT COUNT(*) n FROM job_history_archives').get(),
    ).toEqual({ n: 0 });
    const done = instance.services.get(actor, wid, active.id);
    expect(done.outputAssets).toHaveLength(1);
    expect(
      (
        await instance.services.core.assets.readOriginal(actor, wid, done.outputAssets[0]!.id)
      ).buffer.equals(png),
    ).toBe(true);
  });
  it('exports ZIPs containing original bytes and truthful manifests and denies mixed-space exports', async () => {
    const done = await completeJob(),
      asset = done.outputAssets[0]!;
    const exportJobs = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/jobs/download-zip',
      headers: headers(),
      payload: { jobIds: [done.id, done.id] },
    });
    expect(exportJobs.statusCode, exportJobs.body).toBe(200);
    expect(exportJobs.headers['content-type']).toContain('application/zip');
    const jobsZip = await JSZip.loadAsync(exportJobs.rawPayload),
      files = Object.values(jobsZip.files).filter((f) => !f.dir && f.name !== 'manifest.json');
    expect(files).toHaveLength(1);
    expect((await files[0]!.async('nodebuffer')).equals(png)).toBe(true);
    const manifest = JSON.parse(await jobsZip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({
      formatVersion: 1,
      jobs: [
        {
          id: done.id,
          operation: 'image.generate',
          providerId: 'openai',
          status: 'succeeded',
          items: [{ assetId: asset.id, status: 'succeeded' }],
        },
      ],
    });
    expect(JSON.stringify(manifest)).not.toContain(config.environmentSecrets.openai);
    const exportAssets = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/assets/download-zip',
      headers: headers(),
      payload: { assetIds: [asset.id, asset.id] },
    });
    expect(exportAssets.statusCode).toBe(200);
    const assetsZip = await JSZip.loadAsync(exportAssets.rawPayload);
    const imageFile = Object.values(assetsZip.files).find(
      (f) => !f.dir && f.name !== 'manifest.json',
    )!;
    expect((await imageFile.async('nodebuffer')).equals(png)).toBe(true);
    expect(JSON.parse(await assetsZip.file('manifest.json')!.async('string'))).toMatchObject({
      formatVersion: 1,
      assets: [
        { id: asset.id, mimeType: 'image/png', sourceJobId: done.id, width: 48, height: 64 },
      ],
    });
    const other = instance.services.core.team.create(actor, { name: 'Other' }),
      foreign = await storedPng(other.id);
    const mixed = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/assets/download-zip',
      headers: headers(),
      payload: { assetIds: [asset.id, foreign.id] },
    });
    expect(mixed.statusCode).toBe(404);
    expect(mixed.headers['content-type']).toContain('application/json');
    expect(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/v1/jobs/download-zip',
          headers: headers(other.id),
          payload: { jobIds: [done.id] },
        })
      ).statusCode,
    ).toBe(404);
    expect(instance.services.get(actor, wid, done.id).downloadedAt).toBeNull();
  });
  it('manually reconciles real media once, rejects wrong kind and scope, and leaves accounting unchanged on rejection', async () => {
    const pending = await unknownJob(),
      item = pending.items[0]!,
      { core, db } = instance.services;
    const document = await core.assets.ingest(actor, wid, {
      buffer: Buffer.from('This is actual text, not an image.'),
      name: 'wrong.txt',
      mimeType: 'text/plain',
    });
    const reconcile = (assetId: string, space = wid) =>
      instance.app.inject({
        method: 'POST',
        url: `/api/v1/jobs/${pending.id}/reconcile`,
        headers: headers(space),
        payload: {
          itemId: item.id,
          outcome: 'succeeded',
          assetId,
          evidence: 'A human reviewed this exact synthetic provider test result.',
        },
      });
    const wrong = await reconcile(document.id);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('RESULT_KIND');
    expect(instance.services.balance(actor, wid)).toMatchObject({ balance: 1000, reserved: 8 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='settle'").get(),
    ).toEqual({ n: 0 });
    expect(instance.services.get(actor, wid, pending.id).status).toBe('reconciliation_required');
    const other = core.team.create(actor, { name: 'Other' }),
      foreign = await storedPng(other.id);
    expect((await reconcile(foreign.id)).statusCode).toBe(404);
    expect((await reconcile(foreign.id, other.id)).statusCode).toBe(404);
    const result = await storedPng(),
      done = await reconcile(result.id);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().data).toMatchObject({
      status: 'succeeded',
      settledCredits: 8,
      outputAssets: [{ id: result.id }],
    });
    expect((await reconcile(result.id)).statusCode).toBe(409);
    expect(instance.services.balance(actor, wid)).toMatchObject({ balance: 992, reserved: 0 });
    expect(
      db.sqlite
        .prepare('SELECT COUNT(*) n FROM credit_ledger WHERE event_key=?')
        .get(`final:${item.id}`),
    ).toEqual({ n: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='job.reconcile'").get(),
    ).toEqual({ n: 1 });
    expect((await core.assets.readOriginal(actor, wid, result.id)).buffer.equals(png)).toBe(true);
  });
  it('reconciles definitive failure only without a success output and releases the original reservation once', async () => {
    const pending = await unknownJob(),
      item = pending.items[0]!,
      result = await storedPng();
    const request = {
      method: 'POST' as const,
      url: `/api/v1/jobs/${pending.id}/reconcile`,
      headers: headers(),
      payload: {
        itemId: item.id,
        outcome: 'failed',
        evidence: 'Human reviewed provider report that no result was produced.',
      },
    };
    expect(
      (
        await instance.app.inject({
          ...request,
          payload: { ...request.payload, assetId: result.id },
        })
      ).statusCode,
    ).toBe(400);
    expect((await instance.app.inject(request)).statusCode).toBe(200);
    expect((await instance.app.inject(request)).statusCode).toBe(409);
    expect(instance.services.balance(actor, wid)).toMatchObject({ balance: 1000, reserved: 0 });
    expect(instance.services.get(actor, wid, pending.id).status).toBe('failed');
    expect(
      instance.services.db.sqlite
        .prepare('SELECT kind,amount FROM credit_ledger WHERE event_key=?')
        .get(`final:${item.id}`),
    ).toEqual({ kind: 'release', amount: 8 });
  });
  it('allows only one of two free quotes to submit and rolls back the losing job and reservation', async () => {
    const { core, db } = instance.services;
    createBillingAdmin(db).configureEntitlements({
      actorUserId: actor.userId,
      reason: 'Deployment administrator approved one free text attempt for this isolated test.',
      mode: 'demo',
      limits: { ...core.entitlements.effective(wid).limits, textAssistDailyFreeUnits: 1 },
    });
    const i = input({ operation: 'text.assist' }),
      q1 = instance.services.quote(actor, wid, i),
      q2 = instance.services.quote(actor, wid, i);
    expect(q1.maxCredits).toBe(0);
    expect(q2.maxCredits).toBe(0);
    const calls = [q1, q2].map((q) => ({
      method: 'POST' as const,
      url: '/api/v1/jobs',
      headers: headers(),
      payload: { input: i, quoteId: q.id, clientRequestId: randomUUID() },
    }));
    const responses = await Promise.all(calls.map((c) => instance.app.inject(c)));
    expect(responses.map((r) => r.statusCode).sort()).toEqual([202, 409]);
    const winner = responses.findIndex((r) => r.statusCode === 202),
      loser = 1 - winner;
    expect(responses[loser]!.json().error.code).toBe('FREE_QUOTA_EXHAUSTED');
    expect((await instance.app.inject(calls[winner]!)).json().data.id).toBe(
      responses[winner]!.json().data.id,
    );
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM job_items').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM free_text_claims').get()).toEqual({ n: 1 });
    expect(
      db.sqlite.prepare('SELECT used_job_id FROM quotes WHERE id=?').get([q1, q2][loser]!.id),
    ).toEqual({ used_job_id: null });
    expect(instance.services.balance(actor, wid)).toMatchObject({ balance: 1000, reserved: 0 });
    expect(core.entitlements.get(actor, wid).freeTextAssist).toMatchObject({
      used: 1,
      remaining: 0,
    });
    expect(instance.services.quote(actor, wid, i).maxCredits).toBeGreaterThan(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import JSZip from 'jszip';
import { ZodError } from 'zod';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, registerCoreRoutes, type CoreServices } from '../src/server/core';
import type { Actor } from '../src/contracts/core';
import { AppError } from '../src/server/errors';
import { blankScene } from '../src/contracts/scene';
let temp: string,
  db: DatabaseContext,
  core: CoreServices,
  app: FastifyInstance,
  owner: Actor,
  wid: string,
  cookieHeader: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'yingzao-core-'));
  db = createDatabaseContext(join(temp, 'test.sqlite'));
  migrateDatabase(db, { migrationsDir: resolve('migrations') });
  core = createCoreServices(db, {
    storageDir: join(temp, 'media'),
    sessionSecret: 'test-secret',
    publicOrigin: 'http://127.0.0.1:5173',
    isProduction: false,
    demoMode: false,
  });
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  await app.register(multipart);
  await app.register(swagger, {
    openapi: { info: { title: 'Core test', version: '1.0.0' } },
    transform: jsonSchemaTransform,
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError)
      reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    else if (error instanceof ZodError)
      reply.code(400).send({ error: { code: 'VALIDATION', message: error.message } });
    else
      reply.code(500).send({
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      });
  });
  await registerCoreRoutes(app, core);
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'owner@example.local', password: 'OwnerPassword2026!', displayName: 'Owner' },
  });
  expect(result.statusCode, result.body).toBe(201);
  const data = result.json().data as { user: { id: string }; workspace: { id: string } };
  owner = {
    userId: data.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = data.workspace.id;
  cookieHeader = String(result.headers['set-cookie']).split(';')[0]!;
});
afterEach(async () => {
  await app.close();
  closeDatabase(db);
  await rm(temp, { recursive: true, force: true });
});
async function invited(email: string, role: 'member' | 'viewer' = 'member') {
  const team = core.auth.createWorkspace(owner.userId, 'Studio Team', 'team');
  const invite = core.team.invite(owner, team.id, { email, role });
  const secret = new URL(invite.inviteUrl).hash.slice('#token='.length);
  const user = await core.auth.register({
    email,
    password: 'InvitedPassword2026!',
    displayName: email.split('@')[0],
    inviteToken: secret,
  });
  const actor: Actor = {
    userId: user.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  return { actor, team, user, secret };
}
describe('core persistence and boundaries', () => {
  it('uses real login sessions, closed registration and logout revocation', async () => {
    expect(core.auth.status()).toEqual({ setupRequired: false, registrationEnabled: false });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: 'other@example.local',
            password: 'OtherPassword2026!',
            displayName: 'Other',
          },
        })
      ).statusCode,
    ).toBe(403);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.local', password: 'OwnerPassword2026!' },
    });
    expect(login.statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/auth/me', headers: { cookie: cookieHeader } })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: { cookie: cookieHeader },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/auth/me', headers: { cookie: cookieHeader } })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'owner@example.local', password: 'bad' },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('invited new users register atomically and viewers cannot write', async () => {
    const { actor, team, secret } = await invited('viewer@example.local', 'viewer');
    expect(core.auth.listWorkspaces(actor)).toHaveLength(2);
    expect(() => core.projects.create(actor, team.id, { name: 'No' })).toThrow(AppError);
    expect(() => core.projects.list(actor, wid, {})).toThrow(AppError);
    expect(() => core.team.accept(owner, { token: secret })).toThrow(AppError);
    await expect(
      core.auth.register({
        email: 'attacker@example.local',
        password: 'SecurePassword2026!',
        displayName: 'Attacker',
        inviteToken: secret,
      }),
    ).rejects.toThrow(AppError);
    const member = core.team
      .members(owner, team.id, {})
      .items.find((m) => m.user.id === actor.userId)!;
    core.team.removeMember(owner, team.id, member.id);
    expect(() => core.requireAccess(actor, team.id, 'read')).toThrow(AppError);
  });
  it('creates projects with documents, detects conflicts, restores as new revision', () => {
    const project = core.projects.create(owner, wid, { name: 'Canvas' });
    const doc = core.documents.get(owner, wid, project.documentId);
    expect(doc.revision).toBe(1);
    const saved = core.documents.save(owner, wid, doc.id, {
      expectedRevision: 1,
      scene: blankScene(1000, 800),
    });
    expect(saved.revision).toBe(2);
    expect(() =>
      core.documents.save(owner, wid, doc.id, { expectedRevision: 1, scene: blankScene() }),
    ).toThrow(AppError);
    expect(
      core.documents.restore(owner, wid, doc.id, { expectedRevision: 2, targetRevision: 1 })
        .revision,
    ).toBe(3);
    expect(core.documents.versions(owner, wid, doc.id, {}).total).toBe(3);
    core.projects.remove(owner, wid, project.id);
    expect(() => core.documents.get(owner, wid, doc.id)).toThrow(AppError);
    core.projects.restore(owner, wid, project.id);
    expect(core.projects.get(owner, wid, project.id).id).toBe(project.id);
  });
  it('stores real original and variants and authenticates headerless media', async () => {
    const buffer = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#c87544' },
    })
      .png()
      .toBuffer();
    const asset = await core.assets.ingest(owner, wid, {
      buffer,
      name: 'sample.png',
      mimeType: 'image/png',
    });
    expect(asset.width).toBe(1200);
    expect(asset.thumbnailUrl).not.toBe(asset.originalUrl);
    expect((await core.assets.readOriginal(owner, wid, asset.id)).buffer.equals(buffer)).toBe(true);
    expect((await app.inject({ url: asset.originalUrl })).statusCode).toBe(401);
    const response = await app.inject({
      url: asset.originalUrl,
      headers: { cookie: cookieHeader },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.rawPayload.equals(buffer)).toBe(true);
    const range = await app.inject({
      url: asset.originalUrl,
      headers: { cookie: cookieHeader, range: 'bytes=0-9' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.length).toBe(10);
    const other = core.auth.createWorkspace(owner.userId, 'Other', 'team');
    expect(() => core.assets.get(owner, other.id, asset.id)).toThrow(AppError);
    const brand = core.references.createBrand(owner, wid, {
      name: 'Brand',
      referenceAssetIds: [asset.id],
    });
    expect(brand.coverAssetId).toBe(asset.id);
    expect(core.references.updateBrand(owner, wid, brand.id, { name: 'Renamed' }).name).toBe(
      'Renamed',
    );
    const char = core.references.createCharacter(owner, wid, {
      name: 'Reference',
      referenceAssetIds: [asset.id],
    });
    expect(char.verification.status).toBe('unverified');
    const collection = core.references.createCollection(owner, wid, { name: 'Favorite' });
    core.references.setCollectionAssets(owner, wid, collection.id, { assetIds: [asset.id] });
    expect(core.assets.list(owner, wid, { collectionId: collection.id }).total).toBe(1);
  });
  it('extracts actual TXT/Markdown/DOCX content with durable state', async () => {
    const text = await core.assets.ingest(owner, wid, {
      buffer: Buffer.from('商品文案\n纯文本 <script>不执行</script>'),
      name: 'brief.md',
      mimeType: 'text/markdown',
    });
    expect(text.extractionStatus).toBe('pending');
    await core.assets.processPendingExtractions();
    expect(core.assets.text(owner, wid, text.id).extractedText).toContain('商品文案');
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Real DOCX text</w:t></w:r></w:p></w:body></w:document>',
    );
    const docx = await core.assets.ingest(owner, wid, {
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
      name: 'brief.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await core.assets.processPendingExtractions();
    expect(core.assets.text(owner, wid, docx.id).extractedText).toContain('Real DOCX text');
    await expect(
      core.assets.ingest(owner, wid, {
        buffer: Buffer.from('<script>alert(1)</script>'),
        name: 'x.html',
        mimeType: 'text/html',
      }),
    ).rejects.toThrow(AppError);
  });
  it('API keys only show secrets once and enforce scope/tenant/revocation', async () => {
    const project = core.projects.create(owner, wid, { name: 'Readable' }),
      created = core.business.createKey(owner, wid, { name: 'Read', scopes: ['projects:read'] });
    expect(JSON.stringify(core.business.keys(owner, wid, {}))).not.toContain(created.secret);
    const headers = { authorization: `Bearer ${created.secret}`, 'x-workspace-id': wid };
    expect((await app.inject({ url: `/api/v1/projects/${project.id}`, headers })).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers,
          payload: { name: 'Denied' },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: '/api/v1/api-keys', headers })).statusCode).toBe(403);
    core.business.revokeKey(owner, wid, created.key.id);
    expect((await app.inject({ url: `/api/v1/projects/${project.id}`, headers })).statusCode).toBe(
      401,
    );
  });
  it('preserves truthful orders, invoice drafts and support records', () => {
    db.sqlite
      .prepare(
        'INSERT INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,active) VALUES (?,?,?,?,?,?,?,?,1)',
      )
      .run('plan-test', 'Plan', 'credits', 1000, 'CNY', null, 100, '{}');
    const order = core.business.createOrder(owner, wid, { planId: 'plan-test' });
    expect(order.status).toBe('draft');
    expect(() => core.business.checkout(owner, wid, order.id)).toThrow(AppError);
    const title = core.business.createTitle(owner, wid, {
      type: 'company',
      name: 'Company',
      taxId: 'TAX123',
      email: 'billing@example.local',
    });
    expect(() =>
      core.business.createInvoice(owner, wid, { orderIds: [order.id], titleId: title.id }),
    ).toThrow(AppError);
    db.sqlite.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.id);
    const invoice = core.business.createInvoice(owner, wid, {
      orderIds: [order.id],
      titleId: title.id,
    });
    expect(invoice.status).toBe('draft');
    expect(() =>
      core.business.createInvoice(owner, wid, { orderIds: [order.id], titleId: title.id }),
    ).toThrow(AppError);
    const ticket = core.business.createTicket(owner, wid, {
      subject: 'Feedback',
      category: 'feedback',
      message: 'Please review',
    });
    core.business.reply(owner, wid, ticket.id, { message: 'Additional detail' });
    expect(core.business.ticket(owner, wid, ticket.id).replies).toHaveLength(1);
    expect(core.business.withdraw(owner, wid, ticket.id).status).toBe('withdrawn');
  });
  it('share tokens only expose project fields and revoke immediately', () => {
    const project = core.projects.create(owner, wid, { name: 'Shared' });
    const share = core.shares.create(owner, wid, { projectId: project.id });
    const token = new URL(share.shareUrl).hash.slice('#token='.length);
    expect(core.shares.read({ token }).project.name).toBe('Shared');
    expect(JSON.stringify(core.shares.read({ token }))).not.toContain('owner@example.local');
    core.shares.revoke(owner, wid, share.id);
    expect(() => core.shares.read({ token })).toThrow(AppError);
  });
  it('serves previews while rejecting original requests for new restricted shares', async () => {
    const image = await core.assets.ingest(owner, wid, {
      buffer: await sharp({ create: { width: 32, height: 32, channels: 3, background: '#8899aa' } })
        .png()
        .toBuffer(),
      name: 'shared.png',
      mimeType: 'image/png',
    });
    const scene = blankScene();
    scene.layers.push({
      id: randomUUID(),
      type: 'image',
      assetId: image.id,
      crop: null,
      name: 'Image',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      visible: true,
      locked: false,
    });
    const project = core.projects.create(owner, wid, { name: 'Restricted', scene });
    const share = core.shares.create(owner, wid, { projectId: project.id });
    const token = new URL(share.shareUrl).hash.slice('#token='.length);
    const read = await app.inject({
      method: 'POST',
      url: '/api/v1/public/shares/read',
      payload: { token },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().data).toMatchObject({
      allowOriginalDownload: false,
      assets: [{ id: image.id, previewVariant: 'preview', originalAvailable: false }],
    });
    expect(JSON.stringify(read.json().data)).not.toContain('storageKey');
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/public/shares/asset',
      payload: { token, assetId: image.id, variant: 'original' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('ORIGINAL_DOWNLOAD_DISABLED');
    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/public/shares/asset',
      payload: { token, assetId: image.id, variant: 'preview' },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('image/webp');
    const allowed = core.shares.create(owner, wid, {
      projectId: project.id,
      allowOriginalDownload: true,
    });
    const otherToken = new URL(allowed.shareUrl).hash.slice('#token='.length);
    expect(
      core.shares.media({ token: otherToken, assetId: image.id, variant: 'original' }).mimeType,
    ).toBe('image/png');
    expect(() =>
      core.shares.media({ token: otherToken, assetId: randomUUID(), variant: 'original' }),
    ).toThrow(AppError);
    db.sqlite
      .prepare("UPDATE shares SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .run(allowed.id);
    expect(() =>
      core.shares.media({ token: otherToken, assetId: image.id, variant: 'original' }),
    ).toThrow(AppError);
  });
  it('retains legacy share download grants when applying the permission migration', () => {
    const project = core.projects.create(owner, wid, { name: 'Legacy' });
    const share = core.shares.create(owner, wid, { projectId: project.id });
    const token = new URL(share.shareUrl).hash.slice('#token='.length);
    db.sqlite.exec('ALTER TABLE shares DROP COLUMN allow_original_download');
    db.sqlite.exec(readFileSync(resolve('migrations/0010-share-download-permission.sql'), 'utf8'));
    expect(core.shares.read({ token }).allowOriginalDownload).toBe(true);
    expect(core.shares.create(owner, wid, { projectId: project.id }).allowOriginalDownload).toBe(
      false,
    );
  });
  it('does not expose original media when a restricted video has no preview variant', async () => {
    // Synthetic media metadata isolates access control from the separately tested ffprobe ingestion.
    const asset = await core.assets.ingest(owner, wid, {
      buffer: await sharp({ create: { width: 32, height: 32, channels: 3, background: '#223344' } })
        .png()
        .toBuffer(),
      name: 'fixture.png',
      mimeType: 'image/png',
    });
    db.sqlite
      .prepare("UPDATE assets SET kind='video',mime_type='video/mp4',duration_ms=1000 WHERE id=?")
      .run(asset.id);
    db.sqlite
      .prepare("DELETE FROM asset_variants WHERE asset_id=? AND variant!='original'")
      .run(asset.id);
    const scene = blankScene();
    scene.layers.push({
      id: randomUUID(),
      type: 'video',
      assetId: asset.id,
      posterAssetId: null,
      durationMs: 1000,
      trimStartMs: 0,
      trimEndMs: 1000,
      muted: true,
      loop: false,
      name: 'Video',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      visible: true,
      locked: false,
    });
    const project = core.projects.create(owner, wid, { name: 'Video', scene });
    const share = core.shares.create(owner, wid, { projectId: project.id });
    const token = new URL(share.shareUrl).hash.slice('#token='.length);
    expect(core.shares.read({ token }).assets).toMatchObject([
      { kind: 'video', previewVariant: null, originalAvailable: false },
    ]);
    expect(() => core.shares.media({ token, assetId: asset.id, variant: 'original' })).toThrow(
      AppError,
    );
    expect(() => core.shares.media({ token, assetId: asset.id, variant: 'preview' })).toThrow(
      AppError,
    );
  });
  it('retains writes after connection restart and validates migration checksums', () => {
    const project = core.projects.create(owner, wid, { name: 'Persistent' });
    closeDatabase(db);
    db = createDatabaseContext(join(temp, 'test.sqlite'));
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    const next = createCoreServices(db, {
      storageDir: join(temp, 'media'),
      sessionSecret: 'test',
      publicOrigin: 'http://127.0.0.1:5173',
      isProduction: false,
      demoMode: false,
    });
    expect(next.projects.get(owner, wid, project.id).name).toBe('Persistent');
  });
  it('parses real PDFs, fails empty PDFs, and caps extracted text', async () => {
    function pdf(text: string): Buffer {
      const stream = text ? `BT /F1 14 Tf 30 100 Td (${text}) Tj ET` : '';
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
      ];
      let data = '%PDF-1.4\n';
      const offsets = [0];
      objects.forEach((obj, i) => {
        offsets.push(Buffer.byteLength(data));
        data += `${i + 1} 0 obj\n${obj}\nendobj\n`;
      });
      const offset = Buffer.byteLength(data);
      data += `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
        .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
      return Buffer.from(data);
    }
    const asset = await core.assets.ingest(owner, wid, {
      buffer: pdf('Real PDF brief'),
      name: 'brief.pdf',
      mimeType: 'application/pdf',
    });
    const empty = await core.assets.ingest(owner, wid, {
      buffer: pdf(''),
      name: 'scan.pdf',
      mimeType: 'application/pdf',
    });
    await core.assets.processPendingExtractions();
    expect(core.assets.text(owner, wid, asset.id).extractedText).toContain('Real PDF brief');
    expect(core.assets.text(owner, wid, empty.id).extractionStatus).toBe('failed');
    const long = await core.assets.ingest(owner, wid, {
      buffer: Buffer.from('x'.repeat(100050)),
      name: 'long.txt',
      mimeType: 'text/plain',
    });
    await core.assets.processPendingExtractions();
    expect(core.assets.text(owner, wid, long.id).truncated).toBe(true);
    expect(core.assets.text(owner, wid, long.id).extractedText).toHaveLength(100000);
  });
  it('imports CSV and XLSX with row errors, deduplication and persistent invitations', async () => {
    const team = core.auth.createWorkspace(owner.userId, 'Import Team', 'team');
    const preview = await core.memberImport.preview(
      owner,
      team.id,
      Buffer.from(
        'email,role,nickname,creditLimit\r\nnew@example.local,member,New,50\r\nbad,viewer,,\r\nnew@example.local,member,Duplicate,50',
      ),
      'team.csv',
    );
    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(2);
    const result = core.memberImport.apply(owner, team.id, {
      rows: [preview.rows[0]!.values],
      confirm: true,
    });
    expect(result.items[0]!.status).toBe('invited');
    expect(
      core.memberImport.apply(owner, team.id, { rows: [preview.rows[0]!.values], confirm: true })
        .items[0]!.status,
    ).toBe('skipped');
    const template = await core.memberImport.template('xlsx');
    expect(
      (await core.memberImport.preview(owner, team.id, template.buffer, template.name)).rows,
    ).toHaveLength(0);
    const exported = await core.memberImport.export(owner, team.id, 'xlsx');
    expect(exported.buffer.subarray(0, 2).toString()).toBe('PK');
  });
  it('rolls back invited registration on budget failure and rejects expired invitations', async () => {
    const team = core.auth.createWorkspace(owner.userId, 'Atomic Team', 'team'),
      invite = core.team.invite(owner, team.id, {
        email: 'new@example.local',
        role: 'member',
        creditLimit: 10,
      }),
      secret = new URL(invite.inviteUrl).hash.slice(7);
    core.context.hooks.onMemberBudgetChanged = () => {
      throw new AppError(409, 'BUDGET_ERROR', 'Budget unavailable');
    };
    await expect(
      core.auth.register({
        email: 'new@example.local',
        password: 'StrongPassword2026!',
        displayName: 'New',
        inviteToken: secret,
      }),
    ).rejects.toThrow('Budget unavailable');
    expect(
      db.sqlite.prepare('SELECT id FROM users WHERE email=?').get('new@example.local'),
    ).toBeUndefined();
    expect(
      db.sqlite.prepare('SELECT consumed_at FROM invitations WHERE id=?').get(invite.id),
    ).toEqual({ consumed_at: null });
    core.context.hooks.onMemberBudgetChanged = undefined;
    db.sqlite
      .prepare('UPDATE invitations SET expires_at=? WHERE id=?')
      .run('2000-01-01T00:00:00.000Z', invite.id);
    await expect(
      core.auth.register({
        email: 'new@example.local',
        password: 'StrongPassword2026!',
        displayName: 'New',
        inviteToken: secret,
      }),
    ).rejects.toThrow(AppError);
  });
  it('enforces owner protection, private brands and user-specific favorites', async () => {
    const { actor, team } = await invited('member@example.local');
    const ownerMember = core.team
      .members(owner, team.id, {})
      .items.find((m) => m.user.id === owner.userId)!;
    expect(() => core.team.removeMember(owner, team.id, ownerMember.id)).toThrow(AppError);
    const project = core.projects.create(owner, team.id, { name: 'Team project' });
    core.context.favorite(owner, team.id, 'project', project.id, true);
    expect(core.projects.get(actor, team.id, project.id).isFavorite).toBe(false);
    const brand = core.references.createBrand(owner, team.id, {
      name: 'Private',
      visibility: 'private',
    });
    expect(() => core.references.getBrand(actor, team.id, brand.id)).toThrow(AppError);
    expect(core.references.brands(actor, team.id, {}).total).toBe(0);
    core.team.transfer(owner, team.id, { userId: actor.userId, confirm: true });
    expect(core.auth.listWorkspaces(actor).find((w) => w.id === team.id)?.role).toBe('owner');
    expect(() => core.team.archive(owner, team.id, { confirm: true })).toThrow(AppError);
  });
  it('publishes schemas and serves validated version routes', async () => {
    const project = core.projects.create(owner, wid, { name: 'API schema' });
    const response = await app.inject({
      url: `/api/v1/documents/${project.documentId}/versions/1`,
      headers: { cookie: cookieHeader, 'x-workspace-id': wid },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.version.revision).toBe(1);
    const openapi = app.swagger();
    expect(openapi.paths?.['/api/v1/projects']).toBeDefined();
    expect(JSON.stringify(openapi.paths?.['/api/v1/auth/register'])).toContain('inviteToken');
  });
});

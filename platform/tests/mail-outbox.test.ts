import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../src/server/errors';
import { createServices } from '../src/server/app';
import { registerMailRoutes } from '../src/server/notifications';
import { mkdtemp, rm, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createDatabaseContext,
  closeDatabase,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices, type CoreServices } from '../src/server/core';
import type { Actor } from '../src/contracts/core';
import {
  createMailOutbox,
  createMailWorker,
  readSmtpConfig,
  validateSmtpConfig,
  type SmtpConfig,
} from '../src/server/notifications';
import { classifySmtpError } from '../src/server/notifications/worker';
import { mailRetryDelay, type EnqueueMailResult } from '../src/server/notifications/outbox';

async function fakeSmtp(
  options: {
    rcptCodes?: number[];
    dataCode?: number;
    dropAfterData?: boolean;
    authFail?: boolean;
  } = {},
) {
  const sockets = new Set<Socket>(),
    messages: string[] = [],
    recipients: string[] = [];
  let connections = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    const index = connections++;
    let buffer = '',
      dataMode = false,
      body = '';
    socket.write('220 localhost fake SMTP only\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const newline = buffer.indexOf('\r\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (dataMode) {
          if (line === '.') {
            messages.push(body);
            dataMode = false;
            if (options.dropAfterData) {
              socket.destroy();
              return;
            }
            socket.write(`${options.dataCode ?? 250} fake result\r\n`);
          } else body += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
          continue;
        }
        if (line.startsWith('EHLO') || line.startsWith('HELO'))
          socket.write(
            options.authFail
              ? '250-localhost\r\n250 AUTH PLAIN LOGIN\r\n'
              : '250-localhost\r\n250 SIZE 1000000\r\n',
          );
        else if (line.startsWith('AUTH')) socket.write('535 credential-detail-DO-NOT-LOG\r\n');
        else if (line.startsWith('MAIL FROM')) socket.write('250 sender ok\r\n');
        else if (line.startsWith('RCPT TO')) {
          recipients.push(line);
          socket.write(`${options.rcptCodes?.[index] ?? 250} recipient-detail-DO-NOT-LOG\r\n`);
        } else if (line === 'DATA') {
          dataMode = true;
          socket.write('354 enter message\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 goodbye\r\n');
        } else socket.write('500 unsupported command\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fake SMTP port');
  return {
    port: address.port,
    messages,
    recipients,
    connections: () => connections,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
let temp: string, db: DatabaseContext, core: CoreServices, owner: Actor, wid: string, time: number;
let servers: Awaited<ReturnType<typeof fakeSmtp>>[] = [];
const key = 'test-mail-encryption-key-not-an-account-secret';
const origin = 'http://127.0.0.1:5174';
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'yingzao-mail-'));
  db = createDatabaseContext(join(temp, 'test.sqlite'));
  const migrations = join(temp, 'migrations');
  await import('node:fs/promises').then((fs) => fs.mkdir(migrations));
  for (const file of await readdir(resolve('migrations')))
    if (file.endsWith('.sql')) await copyFile(resolve('migrations', file), join(migrations, file));
  if (!existsSync(resolve('migrations/0017-mail-outbox.sql')))
    await copyFile(
      resolve('migrations/0017-mail-outbox.sql.draft'),
      join(migrations, '0017-mail-outbox.sql'),
    );
  migrateDatabase(db, { migrationsDir: migrations });
  core = createCoreServices(db, {
    storageDir: join(temp, 'media'),
    sessionSecret: 'test-only-session',
    publicOrigin: origin,
    isProduction: false,
    demoMode: false,
  });
  const account = await core.auth.register({
    email: 'owner@example.test',
    password: 'MailTesting2026!',
    displayName: 'Test owner',
  });
  owner = {
    userId: account.user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  wid = core.team.create(owner, { name: 'QA <script>escaped</script>' }).id;
  time = Date.now();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers) await server.close();
  servers = [];
  closeDatabase(db);
  await rm(temp, { recursive: true, force: true });
});
async function smtp(options: Parameters<typeof fakeSmtp>[0] = {}) {
  const server = await fakeSmtp(options);
  servers.push(server);
  return server;
}
function config(port: number): Extract<SmtpConfig, { enabled: true }> {
  return {
    enabled: true,
    host: '127.0.0.1',
    port,
    tlsMode: 'local-test',
    from: 'studio@example.test',
    fromName: 'QA Studio',
  };
}
function outbox(smtp?: SmtpConfig) {
  return createMailOutbox(
    db,
    { smtp, encryptionKey: key, publicOrigin: origin },
    { now: () => new Date(time) },
  );
}
function invite(email = 'guest@example.test') {
  return core.team.invite(owner, wid, { email, role: 'member', expiresInDays: 7 });
}
function queue(box: ReturnType<typeof outbox>, i = invite()) {
  return {
    i,
    result: box.enqueueInvitation({ workspaceId: wid, invitationId: i.id, inviteUrl: i.inviteUrl }),
  };
}
function idOf(result: EnqueueMailResult) {
  if (!('id' in result)) throw new Error('Expected enqueued mail');
  return result.id;
}
function stored(id: string) {
  return db.sqlite.prepare('SELECT * FROM mail_outbox WHERE id=?').get(id) as Record<
    string,
    unknown
  >;
}

describe('SMTP durable outbox using actual loopback TCP', () => {
  it('is disabled by default and never backfills old invitation events', async () => {
    const i = invite(),
      box = outbox();
    expect(
      box.enqueueInvitation({ workspaceId: wid, invitationId: i.id, inviteUrl: i.inviteUrl }),
    ).toEqual({ status: 'disabled' });
    await createMailWorker(box).tick();
    expect(db.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get()).toEqual({ n: 0 });
    expect(readSmtpConfig({}, { isProduction: true })).toEqual({ enabled: false });
  });
  it('requires complete explicit config, TLS, no header injection; local plaintext is test-only', () => {
    expect(() => readSmtpConfig({ SMTP_ENABLED: 'true' }, { isProduction: true })).toThrow(
      'SMTP configuration',
    );
    expect(() => validateSmtpConfig(config(1025), true)).toThrow('loopback');
    expect(() => validateSmtpConfig({ ...config(1025), host: 'smtp.example.test' })).toThrow(
      'loopback',
    );
    expect(() =>
      validateSmtpConfig({ ...config(1025), from: 'a@example.test\r\nBcc: b@example.test' }),
    ).toThrow('configuration');
    expect(() =>
      readSmtpConfig(
        { SMTP_ENABLED: 'true', SMTP_TLS_MODE: 'local-test' },
        { isProduction: false },
      ),
    ).toThrow('SMTP_TLS_MODE');
  });
  it('requires canonical application origins for links and HTTPS in production', () => {
    for (const publicOrigin of [
      'javascript:alert(1)',
      'https://user:password@example.test',
      'https://example.test/prefix',
      'https://example.test?token=secret',
    ])
      expect(() =>
        createMailOutbox(db, { smtp: config(1025), encryptionKey: key, publicOrigin }),
      ).toThrow('canonical');
    expect(() =>
      createMailOutbox(db, {
        smtp: { ...config(1025), tlsMode: 'starttls' },
        encryptionKey: key,
        publicOrigin: 'http://example.test',
        isProduction: true,
      }),
    ).toThrow('HTTPS');
  });
  it('submits exactly one envelope, freezes Message-ID, encrypts secret link, clears accepted payload', async () => {
    const server = await smtp(),
      box = outbox(config(server.port)),
      { i, result } = queue(box),
      id = idOf(result);
    const raw = JSON.stringify(stored(id));
    expect(raw).not.toContain('guest@example.test');
    expect(raw).not.toContain(i.inviteUrl);
    expect(raw).not.toContain(key);
    await createMailWorker(box).tick();
    expect(box.getStatus(id)).toMatchObject({ status: 'accepted', attempts: 1 });
    expect(server.recipients).toEqual(['RCPT TO:<guest@example.test>']);
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain(`Message-ID: <${id}@example.test>`);
    expect(stored(id).payload_ciphertext).toBeNull();
    const worker = createMailWorker(box);
    await worker.tick();
    await worker.stop();
    expect(server.messages).toHaveLength(1);
  });
  it('deduplicates enqueue and rolls back both source and queue with the business transaction', () => {
    const box = outbox(config(1025)),
      { i, result } = queue(box);
    expect(
      box.enqueueInvitation({ workspaceId: wid, invitationId: i.id, inviteUrl: i.inviteUrl }),
    ).toEqual({ status: 'existing', id: idOf(result) });
    expect(() =>
      db.sqlite
        .transaction(() => {
          queue(box, invite('rollback@example.test'));
          throw new Error('business failed');
        })
        .immediate(),
    ).toThrow('business failed');
    expect(db.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get()).toEqual({ n: 1 });
    expect(
      db.sqlite.prepare('SELECT id FROM invitations WHERE email=?').get('rollback@example.test'),
    ).toBeUndefined();
  });
  it('rejects cross-workspace IDs and forged or external invitation links', () => {
    const box = outbox(config(1025)),
      i = invite();
    expect(
      box.enqueueInvitation({
        workspaceId: randomUUID(),
        invitationId: i.id,
        inviteUrl: i.inviteUrl,
      }),
    ).toEqual({ status: 'not-applicable' });
    expect(() =>
      box.enqueueInvitation({
        workspaceId: wid,
        invitationId: i.id,
        inviteUrl: i.inviteUrl.replace(origin, 'https://attacker.example'),
      }),
    ).toThrow('matching');
    expect(() =>
      box.enqueueInvitation({
        workspaceId: wid,
        invitationId: i.id,
        inviteUrl: `${origin}/invite#token=wrong`,
      }),
    ).toThrow('matching');
  });
  it.each(['revoked_at', 'consumed_at', 'expires_at'] as const)(
    'cancels %s invitation before SMTP without submitting',
    async (field) => {
      const server = await smtp(),
        box = outbox(config(server.port)),
        { i, result } = queue(box);
      db.sqlite
        .prepare(`UPDATE invitations SET ${field}=? WHERE id=?`)
        .run(new Date(time - 1000).toISOString(), i.id);
      await createMailWorker(box).tick();
      expect(box.getStatus(idOf(result))).toMatchObject({
        status: 'cancelled',
        errorCode: 'SOURCE_NO_LONGER_VALID',
      });
      expect(server.connections()).toBe(0);
    },
  );
  it('retries 451 with bounded persisted exponential backoff and never before due time', async () => {
    const server = await smtp({ rcptCodes: [451, 250] }),
      box = outbox(config(server.port)),
      { result } = queue(box),
      id = idOf(result),
      worker = createMailWorker(box);
    await worker.tick();
    expect(box.getStatus(id)).toMatchObject({
      status: 'retry',
      attempts: 1,
      smtpResponseCode: 451,
    });
    const due = Date.parse(box.getStatus(id)!.nextAttemptAt!);
    expect(due - time).toBeGreaterThanOrEqual(60000);
    expect(due - time).toBeLessThanOrEqual(72000);
    await worker.tick();
    expect(server.connections()).toBe(1);
    time = due;
    const restarted = createMailWorker(outbox(config(server.port)));
    await restarted.tick();
    expect(box.getStatus(id)).toMatchObject({ status: 'accepted', attempts: 2 });
    expect(server.messages).toHaveLength(1);
  });
  it('marks 550 permanently failed without response text, body or credentials in status/logs', async () => {
    const server = await smtp({ rcptCodes: [550] }),
      box = outbox(config(server.port)),
      { result } = queue(box),
      id = idOf(result);
    const log = vi.spyOn(console, 'log'),
      error = vi.spyOn(console, 'error'),
      warn = vi.spyOn(console, 'warn');
    await createMailWorker(box).tick();
    const resultText = JSON.stringify(box.getStatus(id));
    expect(box.getStatus(id)).toMatchObject({
      status: 'failed',
      smtpResponseCode: 550,
      errorCode: 'SMTP_PERMANENT_REJECTION',
    });
    expect(resultText).not.toContain('recipient-detail');
    expect(resultText).not.toContain('guest@example.test');
    expect(resultText).not.toContain('token');
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    time += 86400_000;
    await createMailWorker(box).tick();
    expect(server.connections()).toBe(1);
  });
  it('treats explicit DATA 451 as safe rejection and retries, but stops after 5 attempts', async () => {
    const server = await smtp({ dataCode: 451 }),
      box = outbox(config(server.port)),
      id = idOf(queue(box).result),
      worker = createMailWorker(box);
    for (let n = 0; n < 5; n++) {
      await worker.tick();
      time += 4_000_000;
    }
    expect(box.getStatus(id)).toMatchObject({
      status: 'failed',
      attempts: 5,
      errorCode: 'RETRY_EXHAUSTED',
    });
    await worker.tick();
    expect(server.messages).toHaveLength(5);
  });
  it('never blindly retries DATA acceptance ambiguity and requires audited operator evidence', async () => {
    const server = await smtp({ dropAfterData: true }),
      box = outbox(config(server.port)),
      id = idOf(queue(box).result),
      worker = createMailWorker(box);
    await worker.tick();
    expect(box.getStatus(id)).toMatchObject({
      status: 'reconciliation_required',
      errorCode: 'SMTP_ACCEPTANCE_UNKNOWN',
    });
    expect(server.messages).toHaveLength(1);
    time += 86400_000;
    await worker.tick();
    expect(server.messages).toHaveLength(1);
    const reconciled = box.reconcile({
      id,
      operatorId: owner.userId,
      action: 'confirm-accepted',
      evidenceReference: 'fake-smtp-log-1',
    });
    expect(reconciled.status).toBe('accepted');
    expect(stored(id).payload_ciphertext).toBeNull();
    expect(
      db.sqlite.prepare('SELECT count(*) n FROM mail_outbox_actions WHERE outbox_id=?').get(id),
    ).toEqual({ n: 1 });
  });
  it('crashed sending lease becomes ambiguous; stale worker cannot overwrite operator result', () => {
    const box = outbox(config(1025)),
      id = idOf(queue(box).result),
      claimed = box.claim('first-worker')!;
    expect(claimed.id).toBe(id);
    expect(box.claim('second-worker')).toBeUndefined();
    time += 121000;
    expect(box.recover()).toBe(1);
    expect(box.getStatus(id)?.status).toBe('reconciliation_required');
    expect(box.finish(claimed, { status: 'accepted' })).toBe(false);
    box.reconcile({
      id,
      operatorId: owner.userId,
      action: 'retry-confirmed-not-accepted',
      evidenceReference: 'operator-reviewed-transport-log',
    });
    const retry = box.claim('second-worker')!;
    expect(retry.attempts).toBe(2);
    expect(retry.messageId).toBe(claimed.messageId);
  });
  it('multiple worker instances atomically claim only once and concurrent ticks coalesce', async () => {
    const server = await smtp(),
      box = outbox(config(server.port)),
      id = idOf(queue(box).result),
      a = createMailWorker(box),
      b = createMailWorker(box);
    await Promise.all([a.tick(), a.tick(), b.tick()]);
    expect(server.messages).toHaveLength(1);
    expect(box.getStatus(id)?.attempts).toBe(1);
  });
  it('disabling an existing queue prevents new claims and preserves queued data', async () => {
    const server = await smtp(),
      box = outbox(config(server.port)),
      id = idOf(queue(box).result);
    await createMailWorker(outbox()).tick();
    expect(server.connections()).toBe(0);
    expect(box.getStatus(id)?.status).toBe('queued');
  });
  it('refuses TLS downgrade and sanitizes actual SMTP auth rejection', async () => {
    const server = await smtp({ authFail: true });
    const box = outbox({
        ...config(server.port),
        username: 'fake-test-user',
        password: 'fake-test-password',
      }),
      id = idOf(queue(box).result);
    await createMailWorker(box).tick();
    expect(box.getStatus(id)).toMatchObject({ status: 'failed', smtpResponseCode: 535 });
    expect(JSON.stringify(stored(id))).not.toContain('fake-test-password');
    const i = invite('tls@example.test'),
      secure = outbox({ ...config(server.port), tlsMode: 'starttls' }),
      result = secure.enqueueInvitation({
        workspaceId: wid,
        invitationId: i.id,
        inviteUrl: i.inviteUrl,
      });
    await createMailWorker(secure).tick();
    expect(secure.getStatus(idOf(result))?.status).toBe('failed');
    expect(server.messages).toHaveLength(0);
  });
  it('fails closed when encryption key changed; status contains no cipher or Zod payload', () => {
    const box = outbox(config(1025)),
      id = idOf(queue(box).result);
    const wrong = createMailOutbox(db, {
      smtp: config(1025),
      encryptionKey: 'wrong',
      publicOrigin: origin,
    });
    expect(wrong.claim('wrong-key-worker')).toBeUndefined();
    expect(box.getStatus(id)).toMatchObject({ status: 'failed', errorCode: 'PAYLOAD_UNREADABLE' });
    expect(JSON.stringify(box.getStatus(id))).not.toContain('cipher');
  });
  it('queues actual notifications without confidential bodies and cancels removed memberships', async () => {
    const server = await smtp(),
      box = outbox(config(server.port)),
      nid = randomUUID();
    db.sqlite
      .prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,NULL,?)')
      .run(
        nid,
        wid,
        owner.userId,
        'Private subject',
        'SECRET_APPEAL_REASON',
        `event:${nid}`,
        new Date(time).toISOString(),
      );
    const result = box.enqueueNotification({ workspaceId: wid, notificationId: nid });
    expect(result.status).toBe('queued');
    const claim = box.claim('inspect')!;
    expect(claim.message.text).not.toContain('SECRET_APPEAL_REASON');
    expect(claim.message.html).toContain('&lt;script&gt;');
    expect(claim.message.html).not.toContain('<script>');
    box.finish(claim, { status: 'retry', errorCode: 'TEST_RETRY' });
    time += 120000;
    db.sqlite
      .prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=?')
      .run(wid, owner.userId);
    await createMailWorker(box).tick();
    expect(box.getStatus(idOf(result))?.status).toBe('cancelled');
    expect(server.connections()).toBe(0);
  });
  it('queues only another actor reply to a real ticket, never a self reply or arbitrary recipient', () => {
    const box = outbox(config(1025)),
      i = invite('member@example.test');
    const member = core.auth.registerVerifiedProfile({
      email: 'member@example.test',
      displayName: 'Member',
      passwordHash: 'test-hash',
      inviteToken: new URLSearchParams(new URL(i.inviteUrl).hash.slice(1)).get('token')!,
    });
    const actor = { ...owner, userId: member.user.id },
      ticket = core.business.createTicket(actor, wid, {
        subject: 'Testing ticket',
        category: 'support',
        message: 'PRIVATE_TICKET_BODY',
        assetIds: [],
      });
    const first = core.business.reply(actor, wid, ticket.id, { message: 'PRIVATE_SELF_REPLY' })
      .replies[0]!;
    expect(
      box.enqueueSupportReply({ workspaceId: wid, ticketId: ticket.id, messageId: first.id }),
    ).toEqual({ status: 'not-applicable' });
    const second = core.business
      .reply(owner, wid, ticket.id, { message: 'PRIVATE_OWNER_REPLY' })
      .replies.find((r) => r.userId === owner.userId)!;
    expect(
      box.enqueueSupportReply({ workspaceId: wid, ticketId: ticket.id, messageId: second.id })
        .status,
    ).toBe('queued');
    const claimed = box.claim('inspect')!;
    expect(claimed.message.to).toBe('member@example.test');
    expect(claimed.message.text).not.toContain('PRIVATE');
    box.finish(claimed, { status: 'failed', errorCode: 'TEST_FAILURE' });
    expect(() =>
      box.reconcile({
        id: claimed.id,
        operatorId: member.user.id,
        action: 'cancel',
        evidenceReference: 'invalid-operator-test',
      }),
    ).toThrow('installation administrator');
  });
  it('exposes only safe tenant statuses to session administrators, not members or API keys', async () => {
    const box = outbox(config(1025));
    const id = idOf(queue(box).result);
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(cookie);
    app.setErrorHandler((error, _req, reply) => {
      reply.code(error instanceof AppError ? error.statusCode : 500).send({ error: 'rejected' });
    });
    await registerMailRoutes(app, box, core);
    try {
      expect((await app.inject({ url: '/api/v1/mail-deliveries' })).statusCode).toBe(401);
      const auth = vi.spyOn(core, 'authenticate').mockResolvedValue(owner);
      expect((await app.inject({ url: '/api/v1/mail-deliveries' })).statusCode).toBe(400);
      const result = await app.inject({
        url: '/api/v1/mail-deliveries',
        headers: { 'x-workspace-id': wid },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().data.items[0]).toMatchObject({ id, status: 'queued' });
      expect(result.body).not.toMatch(/ciphertext|guest@example|token=|password/);
      const other = core.team.create(owner, { name: 'Other' }).id;
      expect(
        (
          await app.inject({ url: '/api/v1/mail-deliveries', headers: { 'x-workspace-id': other } })
        ).json().data.items,
      ).toEqual([]);
      auth.mockResolvedValue({ ...owner, authType: 'apiKey' });
      expect(
        (await app.inject({ url: '/api/v1/mail-deliveries', headers: { 'x-workspace-id': wid } }))
          .statusCode,
      ).toBe(403);
      auth.mockResolvedValue(owner);
      db.sqlite
        .prepare("UPDATE memberships SET role='member' WHERE workspace_id=? AND user_id=?")
        .run(wid, owner.userId);
      expect(
        (await app.inject({ url: '/api/v1/mail-deliveries', headers: { 'x-workspace-id': wid } }))
          .statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
  it('integrated business hooks enqueue in the invitation/reply transaction without sending from the API', async () => {
    const server = await smtp();
    const services = createServices(
      {
        host: '127.0.0.1',
        port: 4310,
        publicOrigin: origin,
        databasePath: join(temp, 'test.sqlite'),
        storageDir: join(temp, 'media'),
        sessionSecret: 'test-only',
        encryptionKey: key,
        isProduction: false,
        demoMode: false,
        environmentSecrets: {},
        smtp: config(server.port),
      },
      db,
    );
    const invited = services.core.team.invite(owner, wid, {
      email: 'integration@example.test',
      role: 'member',
      expiresInDays: 7,
    });
    expect(invited.mailDelivery).toMatchObject({ status: 'queued' });
    expect(server.connections()).toBe(0);
    const member = services.core.auth.registerVerifiedProfile({
      email: 'integration@example.test',
      displayName: 'Integration member',
      passwordHash: 'test-only',
      inviteToken: new URLSearchParams(new URL(invited.inviteUrl).hash.slice(1)).get('token')!,
    });
    const ticket = services.core.business.createTicket({ ...owner, userId: member.user.id }, wid, {
      subject: 'Integrated support',
      category: 'support',
      message: 'PRIVATE',
      assetIds: [],
    });
    services.core.business.reply(owner, wid, ticket.id, { message: 'PRIVATE_REPLY' });
    expect(
      db.sqlite
        .prepare("SELECT count(*) n FROM mail_outbox WHERE event_type='support-reply'")
        .get(),
    ).toEqual({ n: 1 });
    db.sqlite.exec(
      "CREATE TRIGGER test_reject_mail BEFORE INSERT ON mail_outbox BEGIN SELECT RAISE(ABORT,'test transaction failure'); END",
    );
    expect(() =>
      services.core.team.invite(owner, wid, {
        email: 'rollback-hook@example.test',
        role: 'member',
        expiresInDays: 7,
      }),
    ).toThrow('test transaction failure');
    expect(
      db.sqlite
        .prepare('SELECT id FROM invitations WHERE email=?')
        .get('rollback-hook@example.test'),
    ).toBeUndefined();
    const before = db.sqlite
      .prepare('SELECT count(*) n FROM ticket_messages WHERE ticket_id=?')
      .get(ticket.id);
    expect(() =>
      services.core.business.reply(owner, wid, ticket.id, { message: 'rollback reply' }),
    ).toThrow('test transaction failure');
    expect(
      db.sqlite.prepare('SELECT count(*) n FROM ticket_messages WHERE ticket_id=?').get(ticket.id),
    ).toEqual(before);
    expect(server.connections()).toBe(0);
    db.sqlite.exec('DROP TRIGGER test_reject_mail');
    const disabled = createServices({ ...services.config, smtp: { enabled: false } }, db);
    const queuedBefore = db.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get();
    const disabledInvite = disabled.core.team.invite(owner, wid, {
      email: 'disabled-hooks@example.test',
      role: 'member',
      expiresInDays: 7,
    });
    expect(disabledInvite.mailDelivery).toEqual({ status: 'disabled' });
    disabled.core.business.reply(owner, wid, ticket.id, { message: 'reply while SMTP disabled' });
    expect(db.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get()).toEqual(queuedBefore);
  });
  it('classifies safe pre-connect failures separately from ambiguous socket disconnects', () => {
    expect(classifySmtpError({ code: 'ESOCKET', originalCode: 'ECONNREFUSED' }).status).toBe(
      'retry',
    );
    expect(classifySmtpError({ code: 'ECONNECTION', command: 'CONN' }).status).toBe(
      'reconciliation_required',
    );
    expect(classifySmtpError({ code: 'ETIMEDOUT', timeoutType: 'SOCKET_TIMEOUT' }).status).toBe(
      'reconciliation_required',
    );
    expect(classifySmtpError({ code: 'ETIMEDOUT', timeoutType: 'CONNECT_TIMEOUT' }).status).toBe(
      'retry',
    );
    expect(mailRetryDelay('stable', 2)).toBeGreaterThan(mailRetryDelay('stable', 1));
    expect(mailRetryDelay('stable', 100)).toBeLessThanOrEqual(4320000);
  });
});

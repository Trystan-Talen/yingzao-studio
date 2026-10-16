/** Real loopback HTTP streams and temporary SQLite; no provider, payment, or external requests. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  request,
  type ClientRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from 'node:http';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';

let folder: string, baseUrl: string, instance: Awaited<ReturnType<typeof createApp>>;
let wid: string, uid: string, cookie: string, jobId: string;
const origin = 'http://127.0.0.1:5174';
const credentials = { email: 'stream-auth@example.local', password: 'StreamAuthFixture2026!' };
const activeRequests = new Set<ClientRequest>();
interface LiveStream {
  body: string;
  ended: boolean;
  aborted: boolean;
  response: IncomingMessage;
  closed: Promise<void>;
}
function deadline<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
function http(method: string, path: string, headers: OutgoingHttpHeaders = {}, payload?: unknown) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>(
    (resolve, reject) => {
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const req = request(
        new URL(path, baseUrl),
        {
          method,
          agent: false,
          headers: {
            ...headers,
            ...(body
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
              : {}),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode!, headers: res.headers, body: data }),
          );
          res.on('error', reject);
        },
      );
      activeRequests.add(req);
      req.on('close', () => activeRequests.delete(req));
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Loopback HTTP request timed out')));
      req.end(body);
    },
  );
}
function authHeaders(sessionCookie = cookie) {
  return { cookie: sessionCookie, origin, 'x-workspace-id': wid };
}
async function openStream(headers: OutgoingHttpHeaders): Promise<LiveStream> {
  return deadline(
    new Promise<LiveStream>((resolve, reject) => {
      const req = request(
        new URL(`/api/v1/job-events?workspaceId=${wid}`, baseUrl),
        { headers, agent: false },
        (res) => {
          if (
            res.statusCode !== 200 ||
            !String(res.headers['content-type']).includes('text/event-stream')
          ) {
            res.resume();
            reject(new Error(`Unexpected stream response: ${res.statusCode}`));
            return;
          }
          let close!: () => void;
          const stream: LiveStream = {
            body: '',
            ended: false,
            aborted: false,
            response: res,
            closed: new Promise<void>((done) => {
              close = done;
            }),
          };
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            stream.body += chunk;
          });
          res.on('end', () => {
            stream.ended = true;
          });
          res.on('aborted', () => {
            stream.aborted = true;
          });
          res.on('error', () => {
            stream.aborted = true;
          });
          res.on('close', close);
          resolve(stream);
        },
      );
      activeRequests.add(req);
      req.on('close', () => activeRequests.delete(req));
      req.on('error', reject);
      req.setTimeout(8000, () => req.destroy(new Error('SSE fixture exceeded its lifetime')));
      req.end();
    }),
    5000,
    'SSE headers were not received',
  );
}
async function waitForText(stream: LiveStream, text: string) {
  const start = Date.now();
  while (!stream.body.includes(text)) {
    if (stream.ended || stream.aborted) throw new Error('Stream closed before its initial event');
    if (Date.now() - start > 3000) throw new Error('Initial SSE event was not received');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function emit(marker: string) {
  instance.services.event(wid, jobId, 'fixture-auth', { marker });
}
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'yingzao-stream-auth-'));
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    publicOrigin: origin,
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: 'isolated-stream-session',
    encryptionKey: 'isolated-stream-encryption',
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
  };
  instance = await createApp(config, { serveWeb: false });
  baseUrl = await instance.app.listen({ host: '127.0.0.1', port: 0 });
  const registered = await http(
    'POST',
    '/api/v1/auth/register',
    { origin },
    { ...credentials, displayName: 'Stream fixture' },
  );
  expect(registered.status, registered.body).toBe(201);
  cookie = String(registered.headers['set-cookie']?.[0]).split(';')[0]!;
  const data = JSON.parse(registered.body).data;
  wid = data.workspace.id;
  uid = data.user.id;
  jobId = randomUUID();
  const date = new Date().toISOString();
  instance.services.db.sqlite
    .prepare(
      "INSERT INTO jobs(id,workspace_id,user_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,settled_credits,created_at,updated_at) VALUES(?,?,?,'image.generate','fixture','','{}','fixture',?,'fixture','succeeded','complete',0,0,?,?)",
    )
    .run(jobId, wid, uid, randomUUID(), date, date);
});
afterEach(async () => {
  for (const req of activeRequests) req.destroy();
  activeRequests.clear();
  if (instance) {
    instance.app.server.closeAllConnections();
    await deadline(instance.app.close(), 5000, 'Temporary SSE server did not close');
  }
  if (folder) await rm(folder, { recursive: true, force: true });
});
describe('existing event streams revalidate authentication', () => {
  it('closes a revoked session stream at the next 2.5-second poll without sending later events', async () => {
    const login = await http('POST', '/api/v1/auth/login', { origin }, credentials);
    expect(login.status, login.body).toBe(200);
    const otherCookie = String(login.headers['set-cookie']?.[0]).split(';')[0]!;
    expect(otherCookie).not.toBe(cookie);
    emit('session-before-revoke');
    const stream = await openStream(authHeaders());
    await waitForText(stream, 'session-before-revoke');
    expect(stream.body).toContain('event: job');
    const revokedAt = Date.now();
    const revoked = await http('POST', '/api/v1/auth/logout-others', authHeaders(otherCookie));
    expect(revoked.status, revoked.body).toBe(200);
    emit('session-after-revoke');
    await deadline(stream.closed, 4500, 'Revoked session stream remained open after polling');
    expect(Date.now() - revokedAt).toBeLessThan(4500);
    expect(stream.ended).toBe(true);
    expect(stream.aborted).toBe(false);
    expect(stream.body).not.toContain('session-after-revoke');
    emit('session-after-close');
    expect(stream.body).not.toContain('session-after-close');
    expect((await http('GET', '/api/v1/auth/me', authHeaders())).status).toBe(401);
    expect((await http('GET', '/api/v1/auth/me', authHeaders(otherCookie))).status).toBe(200);
  });
  it('closes an existing API key stream after key revocation without sending queued later events', async () => {
    const created = await http('POST', '/api/v1/api-keys', authHeaders(), {
      name: 'SSE read fixture',
      scopes: ['jobs:read'],
    });
    expect(created.status, created.body).toBe(201);
    const key = JSON.parse(created.body).data;
    const keyHeaders = { authorization: `Bearer ${key.secret}`, 'x-workspace-id': wid };
    emit('key-before-revoke');
    const stream = await openStream(keyHeaders);
    await waitForText(stream, 'key-before-revoke');
    const revokedAt = Date.now();
    const revoked = await http('DELETE', `/api/v1/api-keys/${key.key.id}`, authHeaders());
    expect(revoked.status, revoked.body).toBe(200);
    emit('key-after-revoke');
    await deadline(stream.closed, 4500, 'Revoked key stream remained open after polling');
    expect(Date.now() - revokedAt).toBeLessThan(4500);
    expect(stream.ended).toBe(true);
    expect(stream.aborted).toBe(false);
    expect(stream.body).not.toContain('key-after-revoke');
    emit('key-after-close');
    expect(stream.body).not.toContain('key-after-close');
    expect((await http('GET', '/api/v1/jobs', keyHeaders)).status).toBe(401);
  });
});

/** Smoke the built production API and worker against a disposable, empty database. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const socket = createServer();
await new Promise<void>((done, reject) => {
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', done);
});
const address = socket.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((done, reject) =>
  socket.close((error) => (error ? reject(error) : done())),
);
const folder = await mkdtemp(join(tmpdir(), 'yingzao-production-smoke-'));
const origin = `http://127.0.0.1:${port}`;
const processes: ChildProcess[] = [];
const env = {
  ...process.env,
  NODE_ENV: 'production',
  DEMO_MODE: 'false',
  HOST: '127.0.0.1',
  PORT: String(port),
  PUBLIC_ORIGIN: origin,
  DATABASE_PATH: join(folder, 'database.sqlite'),
  STORAGE_DIR: join(folder, 'media'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  OPENAI_API_KEY: '',
  FAL_KEY: '',
  FLYELEP_SECRET_KEY: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  GOOGLE_OIDC_ENABLED: 'false',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  SMTP_ENABLED: 'false',
};
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  await ended;
  clearTimeout(timeout);
}
try {
  for (const entry of ['server', 'worker']) {
    const child = spawn(process.execPath, [resolve(`dist/runtime/${entry}/main.js`)], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.resume();
    child.stderr?.resume();
    processes.push(child);
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    assert(
      processes.every((p) => p.exitCode === null),
      'Production child exited before readiness',
    );
    try {
      const health = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Poll only this disposable process while it initializes migrations. */
    }
    await delay(150);
  }
  assert(ready, 'Production API did not become healthy');
  const html = await (await fetch(origin)).text();
  assert(html.includes('/assets/'), 'Built web entry was not served');
  const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
  assert(assetPath);
  assert.equal((await fetch(new URL(assetPath, origin))).status, 200);
  const initial = (await (await fetch(`${origin}/api/v1/auth/status`)).json()) as {
    data: { setupRequired: boolean };
  };
  assert.equal(initial.data.setupRequired, true);
  const registered = await fetch(`${origin}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      email: 'runtime@example.local',
      password: 'DisposableRuntime2026!',
      displayName: 'Production smoke',
    }),
  });
  assert.equal(registered.status, 201, await registered.text());
  const cookie = registered.headers.get('set-cookie');
  assert(cookie?.includes('HttpOnly') && cookie.includes('Secure'));
  const after = (await (await fetch(`${origin}/api/v1/auth/status`)).json()) as {
    data: { setupRequired: boolean };
  };
  assert.equal(after.data.setupRequired, false);
  assert(
    processes.every((p) => p.exitCode === null),
    'API or worker exited unexpectedly',
  );
  console.info(
    'Production runtime verified: built HTML/JS, healthy SQLite, empty-db registration, secure cookie, concurrent API/worker migrations.',
  );
} finally {
  await Promise.all(processes.map(stop));
  await rm(folder, { recursive: true, force: true });
}
await assert.rejects(fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1000) }));
console.info('Production runtime stopped cleanly; temporary data removed.');

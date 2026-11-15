import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { isolatedTestEnvironment } from '../scripts/test-environment';

const platform = resolve('.');
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'yingzao-operations-script-'));
  roots.push(root);
  return root;
}
async function run(
  root: string,
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  timeout = 8000,
) {
  const child = spawn(
    process.execPath,
    ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('scripts', script), ...args],
    {
      cwd: root,
      env: { ...isolatedTestEnvironment(platform), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '',
    stderr = '',
    timedOut = false;
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeout);
  try {
    const code = await new Promise<number | null>((done, reject) => {
      child.once('error', reject);
      child.once('close', done);
    });
    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}
async function healthServer(host = '127.0.0.1', hanging = false) {
  let calls = 0;
  const server = createServer((_request, response) => {
    calls++;
    if (!hanging) {
      response.setHeader('content-type', 'application/json');
      response.end('{"ok":true}');
    }
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, host, done);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing isolated health port');
  return { port: String(address.port), calls: () => calls };
}

it.each([undefined, '', '   '])(
  'requires an explicit nonempty database before creating a redemption (%j)',
  async (DATABASE_PATH) => {
    const root = await directory();
    await cp(resolve('migrations'), join(root, 'migrations'), { recursive: true });
    const outcome = await run(root, 'create-redemption.ts', ['100'], { DATABASE_PATH });
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('DATABASE_PATH');
    expect((await readdir(root)).sort()).toEqual(['migrations']);
  },
);

it('creates one redemption only in the explicitly selected disposable database', async () => {
  const root = await directory();
  await cp(resolve('migrations'), join(root, 'migrations'), { recursive: true });
  const database = join(root, 'selected.sqlite');
  const outcome = await run(root, 'create-redemption.ts', ['100'], {
    DATABASE_PATH: database,
    STORAGE_DIR: join(root, 'selected-media'),
    SESSION_SECRET: 'synthetic-operations-session',
    ENCRYPTION_KEY: 'synthetic-operations-encryption',
  });
  expect(outcome.code).toBe(0);
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    expect(db.prepare('SELECT credits FROM redemption_codes').all()).toEqual([{ credits: 100 }]);
  } finally {
    db.close();
  }
  expect(await readdir(root)).not.toContain('var');
});

it('checks health without creating installation keys or application data', async () => {
  const root = await directory();
  const server = await healthServer();
  const outcome = await run(root, 'health.ts', [], {
    HOST: '127.0.0.1',
    PORT: server.port,
    NODE_ENV: 'production',
    MEDIA_DNS_MODE: 'synthetic-unrelated-invalid-setting',
  });
  expect(outcome.code).toBe(0);
  expect(JSON.parse(outcome.stdout)).toEqual({ ok: true });
  expect(server.calls()).toBe(1);
  expect(await readdir(root)).toEqual([]);
});

it.each(['::1', '[::1]', '::', '[::]'])(
  'supports IPv6 and wildcard health listener %s',
  async (HOST) => {
    const root = await directory();
    const server = await healthServer('::1');
    const outcome = await run(root, 'health.ts', [], { HOST, PORT: server.port });
    expect(outcome.code).toBe(0);
    expect(server.calls()).toBe(1);
    expect(await readdir(root)).toEqual([]);
  },
);

it('reads configured IPv4 wildcard health settings without loading an installation', async () => {
  const root = await directory();
  const server = await healthServer();
  const path = join(root, 'health.env');
  await writeFile(path, `HOST=0.0.0.0\nPORT=${server.port}\n`);
  const outcome = await run(root, 'health.ts', [], { DOTENV_CONFIG_PATH: path });
  expect(outcome.code).toBe(0);
  expect(server.calls()).toBe(1);
  expect(await readdir(root)).toEqual(['health.env']);
});

it('fails a hanging health endpoint within its own bounded timeout', async () => {
  const root = await directory();
  const server = await healthServer('127.0.0.1', true);
  const outcome = await run(root, 'health.ts', [], { HOST: '127.0.0.1', PORT: server.port });
  expect(outcome.timedOut).toBe(false);
  expect(outcome.code).toBe(1);
  expect(server.calls()).toBe(1);
  expect(await readdir(root)).toEqual([]);
}, 12000);

it.each(['health.ts', 'create-redemption.ts'])(
  'shows %s help without application initialization',
  async (script) => {
    const root = await directory();
    // Even the old broken help path must never probe a real application's default port.
    const server = await healthServer();
    const outcome = await run(root, script, ['--help'], { HOST: '127.0.0.1', PORT: server.port });
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('用法');
    expect(server.calls()).toBe(0);
    expect(await readdir(root)).toEqual([]);
  },
);

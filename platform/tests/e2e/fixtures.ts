import { test as base, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { AppConfig } from '../../src/server/config';
import { createApp } from '../../src/server/app';
import { localSmtp, mailText } from '../helpers/local-smtp';
import { localSms } from '../helpers/local-sms';
import { identityCrypto } from '../../src/server/auth/identity/crypto';

async function harness(recovery: boolean, smsEnabled: boolean) {
  if (!process.env.E2E_RUN_ROOT) throw new Error('Missing isolated run root');
  const folder = await mkdtemp(join(process.env.E2E_RUN_ROOT, 'case-'));
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback port');
  const port = address.port;
  await new Promise<void>((done) => probe.close(() => done()));
  const smtp = await localSmtp();
  const sms = smsEnabled ? await localSms() : null;
  let identityTime = Date.now();
  const clockFile = join(folder, 'identity-clock.json');
  await writeFile(clockFile, JSON.stringify(identityTime));
  const origin = `http://127.0.0.1:${port}`;
  const config: AppConfig = {
    host: '127.0.0.1',
    port,
    publicOrigin: origin,
    databasePath: join(folder, 'test.sqlite'),
    storageDir: join(folder, 'media'),
    sessionSecret: randomBytes(32).toString('hex'),
    encryptionKey: randomBytes(32).toString('hex'),
    isProduction: false,
    demoMode: false,
    environmentSecrets: {},
    passwordRecoveryEnabled: recovery,
    google: { enabled: false },
    sms: sms
      ? {
          enabled: true,
          accessKeyId: 'IsolatedFixtureId',
          accessKeySecret: 'IsolatedFixtureSecret',
          signName: '隔离夹具',
          templateCode: 'SMS_fixture',
        }
      : { enabled: false },
    smtp: {
      enabled: true,
      host: '127.0.0.1',
      port: smtp.port,
      tlsMode: 'local-test',
      from: 'studio@example.test',
      fromName: 'Isolated test',
    },
  };
  const application = await createApp(config, { identity: { now: () => new Date(identityTime) } });
  await application.app.listen({ host: '127.0.0.1', port });
  const configFile = join(folder, 'config.json');
  await writeFile(
    configFile,
    JSON.stringify({
      ...config,
      clockFile,
      localSms: sms ? { port: sms.port, secret: sms.secret } : undefined,
    }),
    { mode: 0o600 },
  );
  const workerEnv = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    E2E_RUN_ROOT: process.env.E2E_RUN_ROOT,
    NODE_ENV: 'test',
    NO_COLOR: '1',
  };
  let child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve('tests/e2e/worker.ts'), configFile],
    { stdio: ['ignore', 'pipe', 'pipe'], env: workerEnv },
  );
  let workerOutput = '';
  const capture = () => {
    child.stdout?.on('data', (chunk: Buffer) => {
      workerOutput += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      workerOutput += chunk.toString();
    });
  };
  capture();
  async function stopWorker() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = new Promise<void>((done) => child.once('exit', () => done()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await ended;
    clearTimeout(timer);
  }
  try {
    await expect
      .poll(() => {
        if (child.exitCode !== null) throw new Error(workerOutput);
        return existsSync(`${configFile}.ready`);
      })
      .toBe(true);
  } catch {
    await writeFile(join(folder, 'worker.txt'), workerOutput);
    await stopWorker();
    await application.app.close();
    await smtp.close();
    await sms?.close();
    throw new Error(`Isolated worker did not start: ${workerOutput}`);
  }
  return {
    ...application,
    origin,
    folder,
    smtp,
    sms,
    async advanceIdentityClock(milliseconds: number) {
      identityTime += milliseconds;
      await writeFile(clockFile, JSON.stringify(identityTime));
    },
    async latestSmsCode() {
      if (!sms) throw new Error('SMS fixture disabled');
      await expect.poll(() => sms.messages.length).toBeGreaterThan(0);
      return sms.messages.at(-1)!.code;
    },
    async restartWorker() {
      await stopWorker();
      workerOutput = '';
      await rm(`${configFile}.ready`, { force: true });
      child = spawn(
        process.execPath,
        ['--import', 'tsx', resolve('tests/e2e/worker.ts'), configFile],
        { stdio: ['ignore', 'pipe', 'pipe'], env: workerEnv },
      );
      capture();
      await expect
        .poll(() => {
          if (child.exitCode !== null) throw new Error(workerOutput);
          return existsSync(`${configFile}.ready`);
        })
        .toBe(true);
    },
    async latestToken() {
      await expect
        .poll(() => smtp.messages.filter((message) => mailText(message).includes('#token=')).length)
        .toBeGreaterThan(0);
      return smtp.messages
        .map(mailText)
        .filter((message) => message.includes('#token='))
        .at(-1)!
        .match(/#token=([A-Za-z0-9_-]{43})/)![1]!;
    },
    async googleOnlySession() {
      const result = await application.services.core.auth.register({
        email: 'google-only@example.test',
        password: randomBytes(32).toString('hex'),
        displayName: 'Isolated Google account',
      });
      application.services.db.sqlite
        .prepare('UPDATE users SET local_password_enabled=0,preferences_json=? WHERE id=?')
        .run(
          JSON.stringify({ ...result.user.preferences, onboardingCompleted: true }),
          result.user.id,
        );
      application.services.db.sqlite
        .prepare(
          "INSERT INTO external_identities VALUES(?,'google','https://accounts.google.com',?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          'isolated-browser-subject',
          result.user.id,
          result.user.email,
          new Date().toISOString(),
          new Date().toISOString(),
        );
      return result;
    },
    async existingIdentitySession() {
      const password = 'ExistingIdentityPassword2026!';
      const result = await application.services.core.auth.register({
        email: 'existing-identities@example.test',
        password,
        displayName: 'Existing identity fixture',
      });
      const sql = application.services.db.sqlite,
        crypto = identityCrypto(config.encryptionKey),
        phone = '+8613800138000',
        digest = crypto.digest('phone', phone),
        date = new Date().toISOString();
      sql
        .prepare('UPDATE users SET preferences_json=? WHERE id=?')
        .run(
          JSON.stringify({ ...result.user.preferences, onboardingCompleted: true }),
          result.user.id,
        );
      sql
        .prepare('INSERT INTO phone_identities VALUES(?,?,?,?,?,?)')
        .run(
          result.user.id,
          digest,
          crypto.seal({ phone }, `phone-identity\0${result.user.id}\0${digest}`),
          '+86 138••••8000',
          date,
          date,
        );
      sql
        .prepare('INSERT INTO wechat_identities VALUES(?,?,?,?,?,?)')
        .run(result.user.id, 'wxFixture', 'existing-subject', null, date, date);
      return { ...result, password };
    },
    async close() {
      await stopWorker();
      await writeFile(join(folder, 'worker.txt'), workerOutput);
      // Authenticated browser tabs retain SSE connections until their context closes.
      // Only terminate this fixture's HTTP connections before closing its isolated database.
      application.app.server.closeAllConnections();
      await application.app.close();
      await smtp.close();
      await sms?.close();
    },
  };
}
export type Studio = Awaited<ReturnType<typeof harness>>;
type Fixtures = {
  recoveryEnabled: boolean;
  smsEnabled: boolean;
  studio: Studio;
  networkIsolation: void;
  browserDiagnostics: void;
};
export const test = base.extend<Fixtures>({
  recoveryEnabled: [true, { option: true }],
  smsEnabled: [false, { option: true }],
  studio: async ({ recoveryEnabled, smsEnabled }, use) => {
    const studio = await harness(recoveryEnabled, smsEnabled);
    try {
      await use(studio);
    } finally {
      await studio.close();
    }
  },
  networkIsolation: [
    async ({ context, studio }, use) => {
      const external: string[] = [];
      await context.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin === studio.origin) await route.continue();
        else {
          external.push(new URL(route.request().url()).origin);
          await route.abort('blockedbyclient');
        }
      });
      await use();
      expect(external, 'Browser fixtures must never call external services').toEqual([]);
    },
    { auto: true },
  ],
  browserDiagnostics: [
    async ({ context, studio }, use) => {
      const errors: string[] = [];
      const failedRequests: { path: string; error: string | null }[] = [];
      const responses: { path: string; status: number }[] = [];
      context.on('page', (page) =>
        page.on('pageerror', (error) => errors.push(error.name + ': ' + error.message)),
      );
      context.on('requestfailed', (request) =>
        failedRequests.push({
          path: new URL(request.url()).pathname,
          error: request.failure()?.errorText ?? null,
        }),
      );
      context.on('response', (response) => {
        if (response.status() >= 400)
          responses.push({ path: new URL(response.url()).pathname, status: response.status() });
      });
      await use();
      await writeFile(
        join(studio.folder, 'browser-diagnostics.json'),
        JSON.stringify({ errors, failedRequests, responses }, null, 2),
      );
      expect(errors, 'No uncaught browser exceptions').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

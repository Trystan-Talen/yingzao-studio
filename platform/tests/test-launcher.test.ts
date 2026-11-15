import { afterEach, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isolatedTestEnvironment } from '../scripts/test-environment';

const temporary: string[] = [];
const children: ChildProcess[] = [];
const platform = resolve('.');
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    child.kill('SIGTERM');
    await exited;
  }
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'yingzao-test-launcher-'));
  temporary.push(root);
  mkdirSync(join(root, 'tests'));
  writeFileSync(
    join(root, 'tests', 'selected.test.ts'),
    `import { expect, it } from ${JSON.stringify(resolve('node_modules/vitest/dist/index.js'))};\n${source}`,
  );
  const args = [
    '--import',
    resolve('node_modules/tsx/dist/loader.mjs'),
    resolve('scripts/test.ts'),
    '--config',
    resolve('vitest.config.ts'),
    '--root',
    root,
    '--maxWorkers',
    '1',
    'tests/selected.test.ts',
  ];
  return { root, args };
}

it('launches selected tests without inherited credentials, data paths, or build variables', () => {
  const { root, args } = fixture(`
    import ${JSON.stringify(resolve('src/server/config.ts'))};
    it('has only the isolated application environment', () => {
      for (const key of ['DIFY_API_KEY', 'DATABASE_PATH', 'STORAGE_DIR', 'VITE_ISOLATION_SENTINEL', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'STRIPE_SECRET_KEY'])
        expect(process.env[key], key).toBeUndefined();
      expect(process.env.DOTENV_CONFIG_PATH).toBe(${JSON.stringify(process.platform === 'win32' ? 'NUL' : '/dev/null')});
    });
  `);
  // Selecting one path must not accidentally run the whole suite or this unrelated failure.
  writeFileSync(
    join(root, 'tests', 'not-selected.test.ts'),
    `throw new Error('The test file filter was lost');`,
  );
  writeFileSync(join(root, '.env'), 'DIFY_API_KEY=synthetic-dotenv-sentinel\n');
  const child = spawnSync(process.execPath, args, {
    cwd: platform,
    env: {
      ...isolatedTestEnvironment(platform),
      DIFY_API_KEY: 'synthetic-provider-sentinel',
      DATABASE_PATH: join(root, 'must-not-open.sqlite'),
      STORAGE_DIR: join(root, 'must-not-create-media'),
      VITE_ISOLATION_SENTINEL: 'synthetic-build-sentinel',
      SESSION_SECRET: 'synthetic-session-sentinel',
      ENCRYPTION_KEY: 'synthetic-encryption-sentinel',
      STRIPE_SECRET_KEY: 'synthetic-payment-sentinel',
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  expect(child.status, child.error?.message || `${child.stdout}\n${child.stderr}`).toBe(0);
}, 25000);

it('preserves the nonzero exit status of failing tests', () => {
  const { args } = fixture(`it('synthetic failure', () => expect(1).toBe(2));`);
  const child = spawnSync(process.execPath, args, {
    cwd: platform,
    env: isolatedTestEnvironment(platform),
    encoding: 'utf8',
    timeout: 20000,
  });
  expect(child.status, child.error?.message || `${child.stdout}\n${child.stderr}`).toBe(1);
}, 25000);

it('forwards termination to the test process group and preserves the interruption result', async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'yingzao-test-launcher-pid-')), 'worker-pid');
  temporary.push(resolve(marker, '..'));
  const { args } = fixture(`
    import { writeFileSync } from 'node:fs';
    it('holds a synthetic worker until interrupted', async () => {
      writeFileSync(${JSON.stringify(marker)}, String(process.pid));
      await new Promise((done) => setTimeout(done, 60000));
    }, 65000);
  `);
  const child = spawn(process.execPath, args, {
    cwd: platform,
    env: isolatedTestEnvironment(platform),
    stdio: 'ignore',
  });
  children.push(child);
  let workerPid = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      workerPid = Number(readFileSync(marker, 'utf8'));
    } catch {
      /* Wait for the child test. */
    }
    if (workerPid) break;
    expect(child.exitCode).toBeNull();
    await delay(50);
  }
  expect(workerPid).toBeGreaterThan(0);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.once('exit', (code, signal) => done({ code, signal })),
  );
  child.kill('SIGTERM');
  expect(await exited).toEqual({ code: 143, signal: null });
  // A successful wrapper exit is insufficient if its actual test worker remains alive.
  expect(() => process.kill(workerPid, 0)).toThrow();
}, 25000);

it('keeps an interrupted tool nonzero even when it handles the signal with a clean exit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yingzao-isolated-tool-'));
  temporary.push(root);
  const marker = join(root, 'tool-ready.json');
  const nextStep = join(root, 'must-not-continue');
  const entry = join(root, 'tool.mjs');
  writeFileSync(
    entry,
    `import { writeFileSync } from 'node:fs';
     process.on('SIGTERM', () => process.exit(0));
     writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
       pid: process.pid,
       providerRemoved: process.env.DIFY_API_KEY === undefined,
       nodeInjectionRemoved: process.env.NODE_OPTIONS === undefined,
       explicitSetting: process.env.TOOL_EXPLICIT_SETTING,
       argument: process.argv[2],
     }));
     setInterval(() => {}, 1000);`,
  );
  const launcher = join(root, 'launcher.mts');
  writeFileSync(
    launcher,
    `import { writeFileSync } from 'node:fs';
     import { runIsolatedTool } from ${JSON.stringify(resolve('scripts/isolated-tool.ts'))};
     process.env.DIFY_API_KEY = 'synthetic-inherited-provider';
     process.env.NODE_OPTIONS = '--require=/synthetic/not-present';
     const code = await runIsolatedTool(${JSON.stringify(entry)}, ['literal argument with spaces'], {
       root: ${JSON.stringify(platform)}, env: { TOOL_EXPLICIT_SETTING: 'synthetic-explicit-setting' },
     });
     if (!code) writeFileSync(${JSON.stringify(nextStep)}, 'unexpected continuation');
     process.exitCode = code;`,
  );
  const child = spawn(
    process.execPath,
    ['--import', resolve('node_modules/tsx/dist/loader.mjs'), launcher],
    { cwd: platform, env: isolatedTestEnvironment(platform), stdio: 'ignore' },
  );
  children.push(child);
  let ready:
    | {
        pid: number;
        providerRemoved: boolean;
        nodeInjectionRemoved: boolean;
        explicitSetting: string;
        argument: string;
      }
    | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = JSON.parse(readFileSync(marker, 'utf8'));
    } catch {
      /* Wait for the synthetic tool, without opening any application data. */
    }
    if (ready) break;
    expect(child.exitCode).toBeNull();
    await delay(50);
  }
  expect(ready).toMatchObject({
    providerRemoved: true,
    nodeInjectionRemoved: true,
    explicitSetting: 'synthetic-explicit-setting',
    argument: 'literal argument with spaces',
  });
  const exited = new Promise<number | null>((done) => child.once('exit', done));
  child.kill('SIGTERM');
  expect(await exited).toBe(143);
  expect(() => readFileSync(nextStep)).toThrow();
  expect(() => process.kill(ready!.pid, 0)).toThrow();
}, 25000);

it.skipIf(process.platform === 'win32')(
  'cleans a stubborn descendant after its leader exits on interruption',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'yingzao-interrupted-group-'));
    temporary.push(root);
    const marker = join(root, 'group-ready.json');
    const nextStep = join(root, 'must-not-continue');
    const descendant = join(root, 'descendant.cjs');
    writeFileSync(
      descendant,
      `
    const {writeFileSync}=require('node:fs');
    process.on('SIGTERM',()=>{});
    writeFileSync(${JSON.stringify(marker)},JSON.stringify({leader:process.ppid,descendant:process.pid}));
    setInterval(()=>{},1000);
  `,
    );
    const entry = join(root, 'leader.cjs');
    writeFileSync(
      entry,
      `
    const {spawn}=require('node:child_process');
    process.on('SIGTERM',()=>process.exit(0));
    spawn(process.execPath,[${JSON.stringify(descendant)}],{stdio:'ignore'});
    setInterval(()=>{},1000);
  `,
    );
    const launcher = join(root, 'launcher.mts');
    writeFileSync(
      launcher,
      `
    import {writeFileSync} from 'node:fs';
    import {runIsolatedTool} from ${JSON.stringify(resolve('scripts/isolated-tool.ts'))};
    const code=await runIsolatedTool(${JSON.stringify(entry)},[],{root:${JSON.stringify(platform)}});
    if(!code)writeFileSync(${JSON.stringify(nextStep)},'unexpected continuation');
    process.exitCode=code;
  `,
    );
    const child = spawn(
      process.execPath,
      ['--import', resolve('node_modules/tsx/dist/loader.mjs'), launcher],
      {
        cwd: platform,
        env: isolatedTestEnvironment(platform),
        stdio: 'ignore',
      },
    );
    children.push(child);
    let ready: { leader: number; descendant: number } | undefined;
    try {
      await expect
        .poll(() => {
          try {
            ready = JSON.parse(readFileSync(marker, 'utf8'));
          } catch {
            /* Wait for both processes. */
          }
          return !!ready;
        })
        .toBe(true);
      const exited = new Promise<number | null>((done) => child.once('exit', done));
      child.kill('SIGTERM');
      expect(await exited).toBe(143);
      expect(() => readFileSync(nextStep)).toThrow();
      await expect
        .poll(() => {
          try {
            process.kill(ready!.descendant, 0);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
    } finally {
      // Always clean the intentionally stubborn fixture, including the red run.
      if (ready) {
        try {
          process.kill(-ready.leader, 'SIGKILL');
        } catch {
          /* Group already gone. */
        }
      }
    }
  },
  25000,
);

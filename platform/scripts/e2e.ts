import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join, delimiter } from 'node:path';
import { spawn } from 'node:child_process';

await mkdir(resolve('var/e2e'), { recursive: true, mode: 0o700 });
const root = await mkdtemp(resolve('var/e2e/run-'));
const env = {
  ...process.env,
  E2E_RUN_ROOT: root,
  PLAYWRIGHT_BROWSERS_PATH: resolve('var/tools/playwright'),
  NO_COLOR: '1',
  PATH: `${resolve('var/tools/ffmpeg-9.0.2-macos-arm64/bin')}${delimiter}${process.env.PATH ?? ''}`,
};
async function run(args: string[]) {
  const child = spawn('pnpm', args, {
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  const stop = () => {
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
      } catch {
        /* Already stopped. */
      }
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    return await new Promise<number>((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => done(code ?? 1));
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
const started = new Date().toISOString();
let code = await run(['build']);
if (!code) code = await run(['exec', 'playwright', 'test', ...process.argv.slice(2)]);
await writeFile(
  join(root, 'run.json'),
  JSON.stringify(
    {
      started,
      finished: new Date().toISOString(),
      exitCode: code,
      dataIsolation: 'fresh SQLite and media per test',
      externalServices: 'disabled; loopback SMTP/SMS fixtures and local media tools only',
    },
    null,
    2,
  ),
);
console.info(`浏览器验收证据：${root}`);
process.exitCode = code;

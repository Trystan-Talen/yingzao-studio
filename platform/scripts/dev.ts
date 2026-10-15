import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { seedDemo } from './seed-demo';
if (process.env.DEMO_MODE === 'true') {
  // A .env for the user's real installation must not redirect the demo launcher.
  process.env.DATABASE_PATH = resolve('var/demo.sqlite');
  process.env.STORAGE_DIR = resolve('var/demo-media');
  await seedDemo();
}
const processes: ChildProcess[] = [];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  const alive = processes.filter((p) => p.exitCode === null && p.signalCode === null);
  const signal = (p: ChildProcess, value: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && p.pid) process.kill(-p.pid, value);
      else p.kill(value);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
        console.error('停止子进程失败');
    }
  };
  for (const p of alive) signal(p, 'SIGTERM');
  const timeout = setTimeout(() => {
    for (const p of alive) signal(p, 'SIGKILL');
    process.exit(code);
  }, 10000);
  void Promise.all(
    alive.map(
      (p) =>
        new Promise<void>((done) => {
          if (p.exitCode !== null || p.signalCode !== null) done();
          else p.once('exit', () => done());
        }),
    ),
  ).then(() => {
    clearTimeout(timeout);
    process.exit(code);
  });
}
for (const args of [
  [resolve('node_modules/tsx/dist/cli.mjs'), 'watch', 'src/server/main.ts'],
  [resolve('node_modules/tsx/dist/cli.mjs'), 'src/worker/main.ts'],
  [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'],
]) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
    detached: process.platform !== 'win32',
  });
  processes.push(child);
  child.on('exit', (code) => {
    if (!closing) close(code ?? 1);
  });
  child.on('error', () => close(1));
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => close());

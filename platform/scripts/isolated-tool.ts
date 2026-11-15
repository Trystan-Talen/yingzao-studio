import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { isolatedTestEnvironment } from './test-environment';

const signalExitCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
type StopSignal = keyof typeof signalExitCodes;

/** Execute an installed local tool with an isolated environment and, on Unix, one process group. */
export async function runIsolatedTool(
  entry: string,
  args: string[],
  options: { root?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const root = resolve(options.root ?? process.cwd());
  const child = spawn(process.execPath, [resolve(root, entry), ...args], {
    cwd: root,
    env: { ...isolatedTestEnvironment(root), ...options.env },
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  let stopping: StopSignal | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const signalChild = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      } else process.kill(-child.pid, signal);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  };
  const stop = (signal: StopSignal) => {
    if (stopping) return;
    stopping = signal;
    signalChild(signal);
    escalation = setTimeout(() => signalChild('SIGKILL'), 10000);
    escalation.unref();
  };
  const handlers = {
    SIGHUP: () => stop('SIGHUP'),
    SIGINT: () => stop('SIGINT'),
    SIGTERM: () => stop('SIGTERM'),
  };
  for (const signal of Object.keys(handlers) as StopSignal[])
    process.once(signal, handlers[signal]);
  try {
    return await new Promise<number>((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        done(
          stopping
            ? signalExitCodes[stopping]
            : (code ??
                (signal && signal in signalExitCodes ? signalExitCodes[signal as StopSignal] : 1)),
        ),
      );
    });
  } finally {
    // A Unix group can outlive its leader. Once an interrupted leader exits,
    // kill any remaining descendants before cancelling the escalation timer.
    // Windows only supports the direct-child termination used above.
    if (stopping && process.platform !== 'win32') signalChild('SIGKILL');
    if (escalation) clearTimeout(escalation);
    for (const signal of Object.keys(handlers) as StopSignal[])
      process.removeListener(signal, handlers[signal]);
  }
}

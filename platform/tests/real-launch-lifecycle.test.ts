/** Real launcher entry, fake processes/network/timers: never opens the user's database. */
import { EventEmitter } from 'node:events';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareRealLaunch } from '../scripts/real-launch-environment';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:net', () => ({ createServer: vi.fn() }));
vi.mock('../scripts/real-launch-environment', () => ({ prepareRealLaunch: vi.fn() }));

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  ignoreTerm = false;
  constructor(public pid: number) {
    super();
  }
  kill(signal: NodeJS.Signals) {
    if (this.ignoreTerm && signal === 'SIGTERM') return true;
    this.signalCode = signal;
    this.emit('exit', null, signal);
    return true;
  }
  unref() {
    return this;
  }
}
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
let priorListeners: Map<NodeJS.Signals, Array<(signal: NodeJS.Signals) => void>>;
let originalArgv: string[];
let children: FakeChild[];
let requests: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  children = [];
  originalArgv = process.argv;
  process.argv = [process.execPath, 'scripts/start-real.ts', '--no-browser'];
  priorListeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
  vi.spyOn(process, 'chdir').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    const child = children.find((value) => value.pid === Math.abs(pid));
    if (!child) throw new Error('Attempted to signal an unrelated process');
    child.kill(signal as NodeJS.Signals);
    return true;
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(prepareRealLaunch).mockReturnValue({
    platformDir: '/synthetic-platform',
    runtimeDir: '/synthetic-platform/var/real-mode',
    keyFile: '/synthetic-platform/var/real-mode/local-config.json',
    databasePath: '/synthetic-platform/var/app.sqlite',
    storageDir: '/synthetic-platform/var/media',
    viteConfigFile: '/synthetic-platform/var/real-mode/vite.config.mts',
    env: {
      PATH: '/synthetic-bin',
      PUBLIC_ORIGIN: 'http://127.0.0.1:5176',
      SESSION_SECRET: 'synthetic-only',
    },
    webEnv: { PATH: '/synthetic-bin' },
  });
  vi.mocked(createServer).mockImplementation(
    () =>
      ({
        once: vi.fn(),
        listen: (_port: number, _host: string, callback: () => void) => callback(),
        close: (callback: (error?: Error) => void) => callback(),
      }) as unknown as ReturnType<typeof createServer>,
  );
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
  vi.mocked(spawn).mockImplementation(() => {
    const child = new FakeChild(800000 + children.length);
    children.push(child);
    return child as unknown as ChildProcess;
  });
  requests = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));
  vi.stubGlobal('fetch', requests);
});

afterEach(() => {
  for (const signal of signals)
    for (const listener of process.listeners(signal))
      if (!priorListeners.get(signal)!.includes(listener)) process.removeListener(signal, listener);
  process.argv = originalArgv;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('reports readiness timeout and terminates every process it started', async () => {
  await import('../scripts/start-real');
  await vi.advanceTimersByTimeAsync(60000);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('未就绪'));
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(children).toHaveLength(3);
  expect(children.every((child) => child.signalCode === 'SIGTERM')).toBe(true);
  const before = requests.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(requests).toHaveBeenCalledTimes(before);
});

it('bounds readiness by elapsed time even if a health request never completes', async () => {
  requests.mockImplementation(
    (_input, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      }),
  );
  await import('../scripts/start-real');
  await vi.advanceTimersByTimeAsync(60000);
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(children.every((child) => child.signalCode === 'SIGTERM')).toBe(true);
  expect(requests.mock.calls[0]![1]!.signal!.aborted).toBe(true);
});

it('forces a child that ignores graceful shutdown to stop after the cleanup deadline', async () => {
  await import('../scripts/start-real');
  children[1]!.ignoreTerm = true;
  await vi.advanceTimersByTimeAsync(70000);
  expect(children[1]!.signalCode).toBe('SIGKILL');
  expect(process.exit).toHaveBeenCalledWith(1);
});

it('stays running after both real-mode health checks pass and handles a later terminal close', async () => {
  requests.mockImplementation(async () =>
    Response.json({ data: { status: 'ok', database: 'sqlite', demoMode: false } }),
  );
  await import('../scripts/start-real');
  await vi.advanceTimersByTimeAsync(61000);
  expect(process.exit).not.toHaveBeenCalled();
  expect(requests).toHaveBeenCalledTimes(2);
  expect(console.info).toHaveBeenCalledWith(expect.stringContaining('真实模式已就绪'));
  process.emit('SIGHUP');
  await vi.advanceTimersByTimeAsync(0);
  expect(process.exit).toHaveBeenCalledWith(0);
  expect(children.every((child) => child.signalCode === 'SIGTERM')).toBe(true);
});

it('does not treat a healthy demo backend as the requested real service', async () => {
  requests.mockImplementation(async () =>
    Response.json({ data: { status: 'ok', database: 'sqlite', demoMode: true } }),
  );
  await import('../scripts/start-real');
  await vi.advanceTimersByTimeAsync(60000);
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('真实模式已就绪'));
});

it('cleans up sibling processes when one service exits or fails to spawn', async () => {
  await import('../scripts/start-real');
  children[1]!.emit('error', new Error('synthetic spawn failure'));
  await vi.advanceTimersByTimeAsync(0);
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(children.every((child) => child.signalCode === 'SIGTERM')).toBe(true);
  expect(requests).not.toHaveBeenCalled();
});

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { ProviderError } from '../tasks/types';

const execute = promisify(execFile);
export interface LocalProcessControl {
  signal?: AbortSignal;
  owns?: () => boolean;
}
export function assertLocalProcessActive(control: LocalProcessControl): void {
  if (control.signal?.aborted)
    throw new ProviderError(
      '本机抠图已取消；已有模型原件仍保留。',
      false,
      'LOCAL_MATTING_CANCELLED',
    );
  if (control.owns && !control.owns())
    throw new ProviderError(
      '任务执行权已转移，已停止本机抠图。',
      false,
      'LOCAL_MATTING_LEASE_LOST',
    );
}
export function localProcessEnvironment(directory: string): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TMPDIR: directory,
    XDG_CACHE_HOME: directory,
    NUMBA_CACHE_DIR: join(directory, 'numba-cache'),
    ORT_DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    OMP_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1',
    NUMBA_NUM_THREADS: '2',
  };
}

let queue: Promise<void> = Promise.resolve();
/** All local matting instances share the queue; flock additionally covers other OS processes. */
export function serialLocalMatting<T>(
  work: () => Promise<T>,
  control: LocalProcessControl,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let started = false,
      cancelled = false;
    const abort = () => {
      if (!started && !cancelled) {
        cancelled = true;
        reject(new ProviderError('已取消排队中的本机抠图。', false, 'LOCAL_MATTING_CANCELLED'));
      }
    };
    control.signal?.addEventListener('abort', abort, { once: true });
    if (control.signal?.aborted) abort();
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        started = true;
        try {
          assertLocalProcessActive(control);
          resolve(await work());
        } catch (error) {
          reject(error);
        } finally {
          control.signal?.removeEventListener('abort', abort);
        }
      });
  });
}

export async function runLocalMattingProcess(
  options: LocalProcessControl & {
    pythonPath: string;
    controllerPath: string;
    request: unknown;
    directory: string;
    timeoutMs: number;
    memoryLimitBytes: number;
  },
): Promise<unknown> {
  assertLocalProcessActive(options);
  if (process.platform !== 'darwin')
    throw new ProviderError(
      '当前系统尚未安装可验证的本机抠图隔离环境。',
      false,
      'LOCAL_MATTING_UNAVAILABLE',
    );
  const request = JSON.stringify(options.request);
  if (Buffer.byteLength(request) > 32768)
    throw new ProviderError('本机抠图参数过长。', false, 'LOCAL_MATTING_INPUT_INVALID');
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/sandbox-exec',
      [
        '-p',
        '(version 1)(allow default)(deny network*)',
        options.pythonPath,
        '-I',
        '-B',
        options.controllerPath,
      ],
      {
        env: localProcessEnvironment(options.directory),
        cwd: options.directory,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let failure: ProviderError | undefined,
      output = '',
      stderrBytes = 0,
      closed = false,
      checking = false,
      killTimer: NodeJS.Timeout | undefined;
    const stop = (message: string, code: string) => {
      if (closed || failure) return;
      failure = new ProviderError(message, false, code);
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* Already exited. */
        }
        killTimer = setTimeout(() => {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            /* Already exited. */
          }
        }, 500);
      }
    };
    const abort = () => stop('本机抠图已取消，已有模型原件仍保留。', 'LOCAL_MATTING_CANCELLED');
    options.signal?.addEventListener('abort', abort, { once: true });
    child.on('spawn', () => {
      if (options.signal?.aborted) abort();
    });
    const timeout = setTimeout(
      () =>
        stop('本机抠图超时，已有模型原件仍保留；重试只会继续本机处理。', 'LOCAL_MATTING_TIMEOUT'),
      options.timeoutMs,
    );
    const monitor = setInterval(() => {
      if (closed || failure || checking || !child.pid) return;
      if (options.owns && !options.owns()) {
        stop('任务执行权已转移，已停止本机抠图。', 'LOCAL_MATTING_LEASE_LOST');
        return;
      }
      checking = true;
      void execute('/bin/ps', ['-axo', 'pgid=,rss='], {
        env: { PATH: '/usr/bin:/bin' },
        timeout: 1000,
        maxBuffer: 2 * 1024 ** 2,
      })
        .then(({ stdout }) => {
          const bytes = stdout.split('\n').reduce((sum, line) => {
            const [pgid, kib] = line.trim().split(/\s+/).map(Number);
            return sum + (pgid === child.pid ? (kib || 0) * 1024 : 0);
          }, 0);
          if (bytes > options.memoryLimitBytes)
            stop('本机抠图超过内存阈值，已有模型原件仍保留。', 'LOCAL_MATTING_MEMORY_LIMIT');
        })
        .catch(() => stop('无法监测本机抠图资源，已停止处理。', 'LOCAL_MATTING_MONITOR_FAILED'))
        .finally(() => {
          checking = false;
        });
    }, 250);
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure || closed) return;
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > 32768)
        stop('本机辅助器返回结果过长，已停止。', 'LOCAL_MATTING_OUTPUT_INVALID');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 8192)
        stop('本机辅助器诊断输出异常，已停止。', 'LOCAL_MATTING_OUTPUT_INVALID');
    });
    child.stdin.on('error', () => {
      /* Close owns the terminal outcome. */
    });
    child.on('error', () => {
      failure ??= new ProviderError(
        '本机辅助器无法启动，请检查已安装环境。',
        false,
        'LOCAL_MATTING_UNAVAILABLE',
      );
    });
    child.on('exit', (code) => {
      if (code !== 0 && !failure)
        stop('本机辅助器执行失败，已停止全部本机计算。', 'LOCAL_MATTING_FAILED');
    });
    child.on('close', (code) => {
      closed = true;
      clearInterval(monitor);
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(
          new ProviderError(
            '本机抠图未完成；已有模型原件保留，不会重新付费生成。',
            false,
            'LOCAL_MATTING_FAILED',
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(
          new ProviderError('本机辅助器返回格式无效。', false, 'LOCAL_MATTING_OUTPUT_INVALID'),
        );
      }
    });
    child.stdin.end(request);
  });
}

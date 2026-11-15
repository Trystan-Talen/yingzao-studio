import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRealLaunch } from './real-launch-environment';

const argumentsSet = new Set(process.argv.slice(2));
if ([...argumentsSet].some((value) => !['--no-browser', '--check'].includes(value)))
  throw new Error('仅支持 --no-browser（不打开浏览器）或 --check（仅检查配置）。');
const platformDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(platformDir);
const configuration = prepareRealLaunch(platformDir);
if (argumentsSet.has('--check')) {
  console.info(
    JSON.stringify(
      {
        mode: 'real',
        demoMode: false,
        origin: configuration.env.PUBLIC_ORIGIN,
        apiPort: 4316,
        databasePath: configuration.databasePath,
        storageDir: configuration.storageDir,
        localConfig: configuration.keyFile,
      },
      null,
      2,
    ),
  );
} else {
  for (const port of [4316, 5176]) {
    await new Promise<void>((done, reject) => {
      const probe = createServer();
      probe.once('error', () =>
        reject(new Error(`端口 ${port} 已被占用，请先关闭该端口的旧服务后重试。`)),
      );
      probe.listen(port, '127.0.0.1', () =>
        probe.close((error) => (error ? reject(error) : done())),
      );
    });
  }
  const availableMedia = ['ffmpeg', 'ffprobe'].every(
    (command) =>
      spawnSync(command, ['-version'], { env: configuration.env, stdio: 'ignore' }).status === 0,
  );
  if (!availableMedia)
    console.info(
      '未找到 FFmpeg（媒体处理工具）或 ffprobe（媒体探测工具）；图片可用，视频产物保存需先补齐工具。',
    );
  console.info(`真实生成入口：http://127.0.0.1:5176\n数据库：${configuration.databasePath}`);
  console.info('首次使用请注册本地账户，再到“设置 → 模型配置”连接文本、图片与视频模型。');
  console.info(
    '真实空间积分与模型服务商余额需分别准备；本入口不会赠送积分、充值或自动提交生成任务。',
  );
  console.info('请保持窗口打开；按 Ctrl+C（停止快捷键）结束本次启动的服务。');
  const children: ChildProcess[] = [];
  let closing = false;
  const readinessTimers: {
    interval?: ReturnType<typeof setInterval>;
    deadline?: ReturnType<typeof setTimeout>;
  } = {};
  const readinessAbort = new AbortController();
  function stop(code = 0) {
    if (closing) return;
    closing = true;
    clearInterval(readinessTimers.interval);
    clearTimeout(readinessTimers.deadline);
    readinessAbort.abort();
    const active = children.filter((child) => child.exitCode === null && child.signalCode === null);
    const signal = (child: ChildProcess, value: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, value);
        else child.kill(value);
      } catch {
        /* A child may exit between inspection and signalling. */
      }
    };
    for (const child of active) signal(child, 'SIGTERM');
    const deadline = setTimeout(() => {
      for (const child of active) signal(child, 'SIGKILL');
      process.exit(code);
    }, 10000);
    void Promise.all(
      active.map(
        (child) =>
          new Promise<void>((done) => {
            if (child.exitCode !== null || child.signalCode !== null) done();
            else child.once('exit', () => done());
          }),
      ),
    ).then(() => {
      clearTimeout(deadline);
      process.exit(code);
    });
  }
  for (const [args, env] of [
    [['--import', 'tsx', 'src/server/main.ts'], configuration.env],
    [['--import', 'tsx', 'src/worker/main.ts'], configuration.env],
    [
      [
        join(platformDir, 'node_modules/vite/bin/vite.js'),
        '--config',
        configuration.viteConfigFile,
      ],
      configuration.webEnv,
    ],
  ] as const) {
    const child = spawn(process.execPath, [...args], {
      cwd: platformDir,
      env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    children.push(child);
    child.on('exit', (code) => {
      if (!closing) stop(code ?? 1);
    });
    child.on('error', () => stop(1));
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => stop());
  let checking = false;
  // Bound elapsed startup time even when a health request stalls; a silent half-start
  // must not leave detached API, worker or frontend processes holding the ports.
  readinessTimers.deadline = setTimeout(() => {
    console.error('真实模式在60秒内未就绪，正在停止本次启动的服务；请检查上方错误后重试。');
    stop(1);
  }, 60000);
  readinessTimers.interval = setInterval(() => {
    if (closing) return;
    if (checking) return;
    checking = true;
    void (async () => {
      for (const origin of ['http://127.0.0.1:4316', 'http://127.0.0.1:5176']) {
        const response = await fetch(`${origin}/api/v1/health`, {
          signal: AbortSignal.any([AbortSignal.timeout(2000), readinessAbort.signal]),
        });
        const body = (await response.json()) as {
          data?: { status?: string; database?: string; demoMode?: boolean };
        };
        if (
          !response.ok ||
          body.data?.status !== 'ok' ||
          body.data.database !== 'sqlite' ||
          body.data.demoMode !== false
        )
          return;
      }
      if (closing) return;
      clearInterval(readinessTimers.interval);
      clearTimeout(readinessTimers.deadline);
      console.info('真实模式已就绪：http://127.0.0.1:5176/settings?tab=models');
      if (!closing && !argumentsSet.has('--no-browser') && process.platform === 'darwin')
        spawn('/usr/bin/open', ['http://127.0.0.1:5176/settings?tab=models'], {
          stdio: 'ignore',
        }).unref();
    })()
      .catch(() => {
        /* Wait for both the API and its frontend proxy. */
      })
      .finally(() => {
        checking = false;
      });
  }, 1000);
}

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runIsolatedTool } from './isolated-tool';

interface Check {
  name: string;
  entry: string;
  args: string[];
}

/** One fail-fast, credential-free entry point for the existing local quality tools. */
export async function checkQuality(
  args: string[],
  root = fileURLToPath(new URL('..', import.meta.url)),
) {
  if (args.length === 1 && args[0] === '--help') {
    console.info(
      '用法：pnpm quality:check；pnpm quality:release\n默认检查类型、规范、格式和完整单元测试；发布检查另加隔离生产构建与启动验证。\n均不继承应用凭据，不读取本地环境文件；浏览器验收另用 pnpm test:e2e。',
    );
    return 0;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--release'))
    throw new Error('仅支持 --release（发布检查）或 --help（帮助）。');
  const release = args[0] === '--release';
  const checks: Check[] = [
    { name: '类型检查', entry: 'node_modules/typescript/bin/tsc', args: ['--noEmit'] },
    {
      name: '代码规范',
      entry: 'node_modules/eslint/bin/eslint.js',
      args: ['src', 'scripts', 'tests', 'eslint.config.js', '--max-warnings', '0'],
    },
    {
      name: '格式检查',
      entry: 'node_modules/prettier/bin/prettier.cjs',
      args: ['--check', 'src', 'scripts', 'tests', '*.ts', '*.js', '*.json'],
    },
    { name: '完整单元测试', entry: 'node_modules/vitest/vitest.mjs', args: ['run'] },
  ];
  await mkdir(join(root, 'var/quality'), { recursive: true, mode: 0o700 });
  const evidence = await mkdtemp(join(root, 'var/quality/run-'));
  if (release) {
    const config = join(evidence, 'vite.config.mts');
    await writeFile(
      config,
      `import base from ${JSON.stringify(join(root, 'vite.config.ts'))};\nexport default {...base, envDir: false};\n`,
    );
    checks.push(
      {
        name: '网页生产构建',
        entry: 'node_modules/vite/bin/vite.js',
        args: ['build', '--config', config],
      },
      {
        name: '服务生产构建',
        entry: 'node_modules/tsup/dist/cli-default.js',
        args: [
          'src/server/main.ts',
          'src/worker/main.ts',
          '--format',
          'esm',
          '--platform',
          'node',
          '--target',
          'node22',
          '--out-dir',
          'dist/runtime',
          '--sourcemap',
          '--clean',
        ],
      },
      {
        name: '本机处理依赖',
        entry: 'node_modules/tsx/dist/cli.mjs',
        args: ['scripts/copy-local-matting.ts'],
      },
      {
        name: '隔离生产启动',
        entry: 'node_modules/tsx/dist/cli.mjs',
        args: ['scripts/verify-runtime.ts'],
      },
    );
  }
  const results: { name: string; exitCode: number; durationMs: number }[] = [];
  const startedAt = new Date().toISOString();
  let exitCode = 1;
  try {
    for (const check of checks) {
      console.info(`\n质量检查：${check.name}`);
      const started = Date.now();
      exitCode = 1;
      exitCode = await runIsolatedTool(check.entry, check.args, { root });
      results.push({ name: check.name, exitCode, durationMs: Date.now() - started });
      if (exitCode !== 0) break;
    }
    return exitCode;
  } finally {
    await writeFile(
      join(evidence, 'run.json'),
      JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          release,
          exitCode,
          results,
          browserTestsIncluded: false,
          environment: 'OS allowlist; application credentials and dotenv excluded',
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    console.info(`质量检查记录：${evidence}`);
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    process.exitCode = await checkQuality(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : '质量检查未能启动。');
    process.exitCode = 1;
  }
}

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIsolatedTool } from './isolated-tool';

/** Keep inherited application credentials and paths out of the test process. */
export async function runTests(args: string[], root = process.cwd()): Promise<number> {
  return runIsolatedTool('node_modules/vitest/vitest.mjs', ['run', ...args], { root });
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    process.exitCode = await runTests(process.argv.slice(2));
  } catch {
    console.error('本地测试运行器未能启动；请先检查已安装依赖。');
    process.exitCode = 1;
  }
}

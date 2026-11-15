import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runIsolatedTool } from './isolated-tool';

await mkdir(resolve('var/e2e'), { recursive: true, mode: 0o700 });
const root = await mkdtemp(resolve('var/e2e/run-'));
// Vite normally searches the project for .env files. Keep even build-time
// configuration inside this run, and never forward inherited provider secrets.
const viteConfig = join(root, 'vite.config.mts');
await writeFile(
  viteConfig,
  `import base from ${JSON.stringify(resolve('vite.config.ts'))};\nexport default { ...base, envDir: ${JSON.stringify(root)} };\n`,
);
const env = {
  E2E_RUN_ROOT: root,
  PLAYWRIGHT_BROWSERS_PATH: resolve('var/tools/playwright'),
};
async function run(entry: string, args: string[]) {
  // Run installed tools directly: pnpm 11 exec may reinstall shared dependencies
  // during its preflight. Missing local tools must fail without changing them.
  return runIsolatedTool(entry, args, { env });
}
const started = new Date().toISOString();
let code = await run('node_modules/vite/bin/vite.js', [
  'build',
  '--config',
  viteConfig,
  '--outDir',
  join(root, 'web'),
  '--emptyOutDir',
]);
if (!code)
  code = await run('node_modules/@playwright/test/cli.js', ['test', ...process.argv.slice(2)]);
await writeFile(
  join(root, 'run.json'),
  JSON.stringify(
    {
      started,
      finished: new Date().toISOString(),
      exitCode: code,
      dataIsolation: 'fresh SQLite and media per test',
      webRoot: join(root, 'web'),
      environmentIsolation: 'fresh Vite envDir; subprocess environment allowlist',
      externalServices:
        'disabled; loopback SMTP/SMS, marked synthetic providers, local media tools only',
    },
    null,
    2,
  ),
);
console.info(`浏览器验收证据：${root}`);
process.exitCode = code;

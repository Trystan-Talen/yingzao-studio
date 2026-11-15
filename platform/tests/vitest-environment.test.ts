import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isolatedTestEnvironment } from '../scripts/test-environment';

const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('keeps both Vite environment loading and application dotenv imports away from local settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'yingzao-vitest-environment-'));
  temporary.push(root);
  mkdirSync(join(root, 'tests'));
  writeFileSync(
    join(root, '.env'),
    ['DIFY_API_KEY=synthetic-dotenv-only', 'VITE_TEST_ISOLATION_SENTINEL=synthetic-vite-only'].join(
      '\n',
    ),
    { mode: 0o600 },
  );
  // Run only a generated child test; never recursively run this parent suite.
  writeFileSync(
    join(root, 'tests', 'isolated-sentinel.test.ts'),
    `import { expect, it } from ${JSON.stringify(resolve('node_modules/vitest/dist/index.js'))};
     import ${JSON.stringify(resolve('src/server/config.ts'))};
     it('does not import either synthetic local setting', () => {
       expect.soft(process.env.DIFY_API_KEY).toBeUndefined();
       expect.soft(process.env.VITE_TEST_ISOLATION_SENTINEL).toBeUndefined();
       expect.soft(process.env.DOTENV_CONFIG_PATH).toBe(${JSON.stringify(process.platform === 'win32' ? 'NUL' : '/dev/null')});
     });`,
  );
  const env = isolatedTestEnvironment(resolve('.'));
  // The actual project test configuration must supply the guard, not this test launcher.
  delete env.DOTENV_CONFIG_PATH;
  const child = spawnSync(
    process.execPath,
    [
      resolve('node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      resolve('vitest.config.ts'),
      '--root',
      root,
      '--maxWorkers',
      '1',
      'tests/isolated-sentinel.test.ts',
    ],
    { cwd: root, env, encoding: 'utf8', timeout: 20000 },
  );
  expect(child.status, child.error?.message || `${child.stdout}\n${child.stderr}`).toBe(0);
}, 25000);

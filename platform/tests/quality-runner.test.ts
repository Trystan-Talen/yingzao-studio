import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkQuality } from '../scripts/quality';

const temporary: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});

it('records a failed stage and stops before later tools without inheriting application settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yingzao-quality-failure-'));
  temporary.push(root);
  const bin = join(root, 'node_modules/typescript/bin');
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, 'tsc'),
    `if (process.env.DATABASE_PATH || process.env.DIFY_API_KEY || process.env.VITE_QUALITY_SENTINEL) process.exit(90); process.exit(7);`,
  );
  vi.stubEnv('DATABASE_PATH', 'synthetic-path-must-not-open');
  vi.stubEnv('DIFY_API_KEY', 'synthetic-key-must-not-forward');
  vi.stubEnv('VITE_QUALITY_SENTINEL', 'synthetic-value-must-not-forward');
  expect(await checkQuality([], root)).toBe(7);
  const [run] = await readdir(join(root, 'var/quality'));
  const record = JSON.parse(await readFile(join(root, 'var/quality', run!, 'run.json'), 'utf8'));
  expect(record.exitCode).toBe(7);
  expect(record.results).toHaveLength(1);
  expect(record.results[0].exitCode).toBe(7);
  expect(record.browserTestsIncluded).toBe(false);
});

it('rejects unsupported options before creating artifacts or launching a tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yingzao-quality-arguments-'));
  temporary.push(root);
  await expect(checkQuality(['--unknown'], root)).rejects.toThrow('仅支持');
  await expect(access(join(root, 'var'))).rejects.toMatchObject({ code: 'ENOENT' });
});

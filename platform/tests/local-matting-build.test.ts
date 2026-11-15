import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { copyLocalMattingHelpers } from '../scripts/copy-local-matting';
import { LOCAL_MATTING_HELPER_SHA256 } from '../src/server/providers/local-matting-version';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it('deploys exact pinned helpers and refuses modified bytes before writing any runtime helper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yingzao-matting-build-'));
  directories.push(root);
  await mkdir(join(root, 'scripts/local-matting'), { recursive: true });
  for (const name of Object.keys(LOCAL_MATTING_HELPER_SHA256))
    await writeFile(
      join(root, 'scripts/local-matting', name),
      await readFile(resolve('scripts/local-matting', name)),
    );
  await copyLocalMattingHelpers(root);
  for (const name of Object.keys(LOCAL_MATTING_HELPER_SHA256))
    expect(await readFile(join(root, 'dist/runtime/local-matting', name))).toEqual(
      await readFile(resolve('scripts/local-matting', name)),
    );
  await rm(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'scripts/local-matting/seed.cjs'), 'tampered');
  await expect(copyLocalMattingHelpers(root)).rejects.toThrow('checksum mismatch');
  await expect(
    readFile(join(root, 'dist/runtime/local-matting/controller.py')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

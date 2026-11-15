import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCAL_MATTING_HELPER_SHA256 } from '../src/server/providers/local-matting-version';

/** The runtime bundle must ship the exact reviewed offline helper bytes. */
export async function copyLocalMattingHelpers(root = process.cwd()) {
  const source = resolve(root, 'scripts/local-matting'),
    destination = resolve(root, 'dist/runtime/local-matting');
  const files = await Promise.all(
    Object.entries(LOCAL_MATTING_HELPER_SHA256).map(async ([name, expected]) => {
      const bytes = await readFile(join(source, name));
      if (createHash('sha256').update(bytes).digest('hex') !== expected)
        throw new Error(`Local matting helper checksum mismatch: ${name}`);
      return { name, bytes };
    }),
  );
  await mkdir(destination, { recursive: true });
  for (const { name, bytes } of files)
    await writeFile(join(destination, name), bytes, { mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await copyLocalMattingHelpers();

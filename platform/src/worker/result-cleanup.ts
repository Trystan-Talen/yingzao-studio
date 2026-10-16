import { lstat, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { DatabaseContext } from '../server/db/connection';

interface CachedResult {
  id: string;
  result_json: string;
}

/** Delete only named scratch files after the durable asset transaction has succeeded. */
export async function cleanupSucceededResults(
  db: DatabaseContext,
  storageDir: string,
  options: { itemId?: string; afterId?: string } = {},
) {
  const rows = (
    options.itemId
      ? db.sqlite
          .prepare(
            "SELECT id,result_json FROM job_items WHERE id=? AND status='succeeded' AND result_json IS NOT NULL",
          )
          .all(options.itemId)
      : db.sqlite
          .prepare(
            "SELECT id,result_json FROM job_items WHERE id>? AND status='succeeded' AND result_json IS NOT NULL ORDER BY id LIMIT 100",
          )
          .all(options.afterId ?? '')
  ) as CachedResult[];
  const cacheDir = resolve(storageDir, '.job-results');
  let cleaned = 0;
  let deferred = 0;
  for (const row of rows) {
    try {
      const value: unknown = JSON.parse(row.result_json);
      const outputs: unknown = Array.isArray(value)
        ? value
        : value && typeof value === 'object' && 'outputs' in value
          ? value.outputs
          : undefined;
      if (!Array.isArray(outputs)) throw new Error('Invalid cached result');
      const paths = new Set<string>();
      for (const output of outputs) {
        if (!output || typeof output !== 'object' || Array.isArray(output))
          throw new Error('Invalid cached output');
        if (!('path' in output)) continue;
        if (typeof output.path !== 'string') throw new Error('Invalid cached path');
        const path = resolve(output.path);
        const filename = basename(path);
        const prefix = `${row.id}-`;
        if (
          dirname(path) !== cacheDir ||
          !filename.startsWith(prefix) ||
          !/^\d+-\d+\.bin$/.test(filename.slice(prefix.length))
        )
          throw new Error('Unowned cached path');
        paths.add(path);
      }
      // Validate the entire manifest before touching a file; never follow a replaced directory.
      if (paths.size) {
        const directory = await lstat(cacheDir).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
          throw new Error('Invalid cache directory');
        for (const path of paths) await rm(path, { force: true });
      }
      cleaned += db.sqlite
        .prepare(
          "UPDATE job_items SET result_json=NULL WHERE id=? AND status='succeeded' AND result_json=?",
        )
        .run(row.id, row.result_json).changes;
    } catch {
      // Keep the manifest for a later retry or inspection; a cleanup failure cannot undo success.
      deferred += 1;
    }
  }
  return {
    cleaned,
    deferred,
    nextCursor: !options.itemId && rows.length === 100 ? rows.at(-1)!.id : undefined,
  };
}

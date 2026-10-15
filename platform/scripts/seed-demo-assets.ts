import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../src/server/config';
import { createServices } from '../src/server/app';
import { closeDatabase } from '../src/server/db/connection';
import type { Actor } from '../src/contracts/core';
if (process.env.NODE_ENV === 'production')
  throw new Error('Demo imports are forbidden in production');
const config = loadConfig({
  ...process.env,
  DEMO_MODE: 'true',
  DATABASE_PATH: resolve('var/demo.sqlite'),
  STORAGE_DIR: resolve('var/demo-media'),
});
const s = createServices(config);
try {
  const user = s.db.sqlite
    .prepare("SELECT id FROM users WHERE email='demo@example.local'")
    .get() as { id: string } | undefined;
  if (!user) throw new Error('Run pnpm seed-demo first');
  const actor: Actor = {
    userId: user.id,
    authType: 'session',
    apiKeyId: null,
    workspaceId: null,
    scopes: [],
  };
  const workspace = s.core.auth
    .listWorkspaces(actor)
    .find((w) => w.isDemo && w.kind === 'personal');
  if (!workspace) throw new Error('Demo workspace missing');
  for (const [file, name] of [
    ['botanical-serum', '灵感示例 · 植物精华'],
    ['amber-perfume', '灵感示例 · 琥珀香氛'],
    ['studio-headphones', '灵感示例 · 蓝色耳机'],
    ['trail-sneaker', '灵感示例 · 旷野运动鞋'],
  ] as const) {
    if (
      s.db.sqlite
        .prepare('SELECT id FROM assets WHERE workspace_id=? AND name=? AND deleted_at IS NULL')
        .get(workspace.id, name)
    )
      continue;
    await s.core.assets.ingest(actor, workspace.id, {
      buffer: await readFile(resolve('public/gallery', `${file}.webp`)),
      name,
      mimeType: 'image/webp',
      source: 'import',
      tags: ['原创示例', '演示导入'],
    });
  }
  console.info('已导入4份原创灵感示例，用于素材与编辑器体验；未模拟AI任务结果。');
} finally {
  closeDatabase(s.db);
}

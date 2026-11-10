/**
 * Local, isolated product preview. Every external provider is replaced with a
 * deterministic local adapter; this entry point never calls loadConfig().
 * Usage: pnpm exec tsx scripts/preview-experience.ts [--port 53820] [--api-port 53821]
 *        [--root var/creative-refresh-20261031]
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, delimiter } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { createWorker } from '../src/worker/runner';
import { originalInspirations } from '../src/contracts/inspirations';
import {
  createExperienceProviders,
  createExperienceFetch,
} from '../tests/helpers/experience-provider';
import { jobInputSchema } from '../src/contracts/jobs';
import type { Actor } from '../src/contracts/core';

if (process.env.NODE_ENV === 'production') throw new Error('Preview cannot run in production.');
function argumentPort(flag: string, fallback: number) {
  const index = process.argv.indexOf(flag);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`Invalid ${flag}`);
  return value;
}
const webPort = argumentPort('--port', 53820);
const apiPort = argumentPort('--api-port', 53821);
if (webPort === apiPort) throw new Error('Preview and API need separate ports.');
const rootIndex = process.argv.indexOf('--root');
const rootArgument = rootIndex < 0 ? 'var/frontend-rebuild-20261030' : process.argv[rootIndex + 1];
if (!rootArgument || rootArgument.startsWith('--')) throw new Error('Missing preview root.');
const root = resolve(rootArgument);
const relativeRoot = relative(resolve('var'), root);
if (!relativeRoot || isAbsolute(relativeRoot) || relativeRoot.startsWith('..'))
  throw new Error('Preview root must be a dedicated directory inside platform/var.');
await mkdir(root, { recursive: true, mode: 0o700 });
const folder = await mkdtemp(join(root, 'preview-'));
const origin = `http://127.0.0.1:${webPort}`;
const ffmpegFolder = resolve('var/tools/ffmpeg-9.0.2-macos-arm64/bin');
if (existsSync(ffmpegFolder)) process.env.PATH = `${ffmpegFolder}${delimiter}${process.env.PATH}`;
const config: AppConfig = {
  host: '127.0.0.1',
  port: apiPort,
  publicOrigin: origin,
  databasePath: join(folder, 'preview.sqlite'),
  storageDir: join(folder, 'media'),
  sessionSecret: randomBytes(32).toString('hex'),
  encryptionKey: randomBytes(32).toString('hex'),
  isProduction: false,
  demoMode: true,
  // These are literal placeholders only. No environment or workspace secret is read.
  environmentSecrets: {
    openai: 'local-preview-placeholder',
    dify: 'local-preview-placeholder',
    seedance: 'local-preview-placeholder',
    fal: 'local-preview-placeholder',
    flyelep: 'local-preview-placeholder',
    tikhub: 'local-preview-placeholder',
  },
  imageGateway: {
    baseUrl: 'https://preview.invalid/v1',
    model: 'doubao-seedream-5.0-lite',
  },
  smtp: { enabled: false },
  google: { enabled: false },
  sms: { enabled: false },
  wechat: { enabled: false },
  passwordRecoveryEnabled: false,
};

// Defense in depth: all external adapters below are replaced, and fetch cannot
// leave loopback even if a later edit accidentally introduces a remote request.
globalThis.fetch = createExperienceFetch();

const { app, services } = await createApp(config, { serveWeb: false });
const databaseList = services.db.sqlite.pragma('database_list') as Array<{
  name: string;
  file: string;
}>;
if (databaseList.find((row) => row.name === 'main')?.file !== config.databasePath)
  throw new Error('Preview opened an unexpected database.');
const email = 'preview@example.local';
const password = 'PreviewStudio2026!';
const registration = await services.core.auth.register({
  email,
  password,
  displayName: '体验创作者',
});
const actor: Actor = {
  userId: registration.user.id,
  authType: 'session',
  apiKeyId: null,
  workspaceId: null,
  scopes: [],
};
const workspaceId = registration.workspace.id;
services.core.auth.update(actor, {
  preferences: { onboardingCompleted: true, theme: 'light', confirmGeneration: true },
});
services.db.sqlite
  .prepare('UPDATE workspaces SET name=? WHERE id=?')
  .run('本机体验 · 模拟生成', workspaceId);

const seedAssets: { id: string; file: string; name: string }[] = [];
for (const sample of originalInspirations) {
  const buffer = await readFile(resolve('public/gallery', `${sample.id}.webp`));
  const asset = await services.core.assets.ingest(actor, workspaceId, {
    buffer,
    name: `示例 · ${sample.title}.webp`,
    mimeType: 'image/webp',
    source: 'import',
    tags: ['原创示例', '体验素材'],
  });
  seedAssets.push({ id: asset.id, file: sample.id, name: sample.title });
}
const overrides = await createExperienceProviders({ folder });
const worker = createWorker(services, overrides);

const seedProjects: { id: string; name: string }[] = [];
for (const file of ['botanical-serum', 'amber-perfume', 'studio-headphones']) {
  const sample = originalInspirations.find((item) => item.id === file)!;
  const asset = seedAssets.find((item) => item.file === file)!;
  const project = services.core.projects.create(actor, workspaceId, {
    name: sample.title,
    description: '本机体验示例，生成记录由本机模拟器产生，不代表真实模型质量。',
    kind: 'image',
  });
  services.core.projects.update(actor, workspaceId, project.id, { coverAssetId: asset.id });
  const input = jobInputSchema.parse({
    operation: 'image.generate',
    providerId: 'openai',
    projectId: project.id,
    prompt: `【本机模拟】${sample.prompt}`,
    options: { model: 'doubao-seedream-5.0-lite', ratio: '1:1', resolution: '2K' },
  });
  const quote = services.quote(actor, workspaceId, input);
  services.submit(actor, workspaceId, input, quote.id, randomUUID());
  seedProjects.push({ id: project.id, name: project.name });
}
while (true) {
  const item = worker.claim();
  if (!item) break;
  await worker.runItem(item);
}

const manifest = {
  origin,
  apiOrigin: `http://127.0.0.1:${apiPort}`,
  folder,
  databasePath: config.databasePath,
  actualDatabasePath: databaseList.find((row) => row.name === 'main')!.file,
  storageDir: config.storageDir,
  email,
  password,
  workspaceId,
  projects: seedProjects,
  assets: seedAssets,
  simulated: true,
  externalCalls: 0,
  startedAt: new Date().toISOString(),
};
await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
await writeFile(join(root, 'latest-preview.json'), JSON.stringify(manifest, null, 2), {
  mode: 0o600,
});
app.get('/api/preview-info', async () => ({
  simulated: true,
  metadataSimulated: true,
  message: '本机隔离体验，模型能力信息与生成结果均为本机模拟。',
}));
await app.listen({ host: '127.0.0.1', port: apiPort });
const web = await createServer({
  configFile: false,
  envDir: folder,
  root: resolve('.'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    watch: { ignored: ['**/var/**', '**/dist/**'] },
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
});
await web.listen();
let ticking = false;
const timer = setInterval(() => {
  if (ticking) return;
  ticking = true;
  void worker
    .tick()
    .catch((error: unknown) => console.error(error))
    .finally(() => {
      ticking = false;
    });
}, 250);
console.info(
  `本机隔离体验：${origin}\n账户：${email}\n密码：${password}\n数据库：${config.databasePath}\n所有模型结果为本机模拟，无外部费用。`,
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    clearInterval(timer);
    void (async () => {
      await worker.stop();
      await web.close();
      await app.close();
      process.exit(0);
    })();
  });

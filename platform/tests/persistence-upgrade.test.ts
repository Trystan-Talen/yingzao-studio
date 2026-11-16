import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { backup } from '../scripts/backup';
import { collectDigests } from '../scripts/backup-integrity';
import { restore } from '../scripts/restore';
import { isolatedTestEnvironment } from '../scripts/test-environment';
import type { Actor } from '../src/contracts/core';
import { creativeIntentRequestSchema } from '../src/contracts/creative-intent';
import { creativeInputFingerprint } from '../src/contracts/creative-fingerprint';
import { jobInputSchema } from '../src/contracts/jobs';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { createCoreServices } from '../src/server/core';
import {
  closeDatabase,
  createDatabaseContext,
  type DatabaseContext,
} from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { simulateCreativeIntent } from '../src/server/tasks/creative-intent-simulation';

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing isolated port');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

function snapshot(db: DatabaseContext) {
  const tables = db.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      db.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ]),
  );
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [code, signal] = await exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
  } finally {
    clearTimeout(timer);
  }
}

it('upgrades a populated 0039 backup with resource and execution-log tables while preserving data, credits and media through restore and real API/worker restarts', async () => {
  const port = await unusedPort();
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-persistence-upgrade-'));
  const config: AppConfig = {
    host: '127.0.0.1',
    port,
    publicOrigin: `http://127.0.0.1:${port}`,
    databasePath: join(folder, 'legacy', 'database.sqlite'),
    storageDir: join(folder, 'legacy', 'media'),
    sessionSecret: 'isolated-persistence-session-secret',
    encryptionKey: 'isolated-persistence-encryption-key',
    isProduction: false,
    demoMode: true,
    environmentSecrets: { openai: 'isolated-never-call-image-provider' },
  };
  const children: ChildProcess[] = [];
  let db: DatabaseContext | undefined;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const oldMigrations = join(folder, 'old-migrations');
    await mkdir(oldMigrations);
    for (const name of await readdir(resolve('migrations')))
      if (/^\d+.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 39)
        await copyFile(resolve('migrations', name), join(oldMigrations, name));
    db = createDatabaseContext(config.databasePath);
    migrateDatabase(db, { migrationsDir: oldMigrations });
    const core = createCoreServices(db, config);
    const account = await core.auth.register({
      email: 'persistence@example.test',
      password: 'PersistenceFixture2026!',
      displayName: '隔离持久化验收',
    });
    const actor: Actor = {
      userId: account.user.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    const wid = account.workspace.id;
    const png = await sharp({
      create: { width: 48, height: 64, channels: 3, background: '#4682b4' },
    })
      .png()
      .toBuffer();
    const asset = await core.assets.ingest(actor, wid, {
      buffer: png,
      mimeType: 'image/png',
      name: 'synthetic-product.png',
    });
    const brand = core.references.createBrand(actor, wid, {
      name: '隔离旧品牌',
      referenceAssetIds: [asset.id],
    });
    const project = core.projects.create(actor, wid, { name: '隔离旧项目' });
    const legacyBriefId = randomUUID();
    const input = jobInputSchema.parse({
      operation: 'image.generate',
      providerId: 'openai',
      prompt: '合成蓝色图片',
      options: { assistantMode: 'ideas' },
    });
    const request = creativeIntentRequestSchema.parse({
      version: 1,
      requestId: randomUUID(),
      rawPrompt: input.prompt,
      sourceTexts: [{ id: 'request', text: input.prompt }],
      answers: [],
      materials: [],
      context: {
        mediaType: 'image',
        platform: '通用',
        placement: 'general',
        language: '中文',
        count: 1,
        ratio: '1:1',
        resolution: '1K',
        supportsReference: true,
        supportsAudio: false,
        supportsText: true,
      },
      strategy: { id: 'isolated-legacy', guidance: '保留历史快照' },
    });
    const at = new Date().toISOString();
    db.sqlite
      .prepare(
        'INSERT INTO creative_briefs(id,workspace_id,user_id,request_id,input_fingerprint,input_json,request_json,result_json,compiled_prompt,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        legacyBriefId,
        wid,
        actor.userId,
        request.requestId,
        creativeInputFingerprint(input),
        JSON.stringify(input),
        JSON.stringify(request),
        JSON.stringify(simulateCreativeIntent(request)),
        '不可改写的旧提示词',
        'ready',
        at,
        at,
      );
    const before = snapshot(db);
    expect(before.schema_migrations).toHaveLength((await readdir(oldMigrations)).length);
    expect(before).not.toHaveProperty('creative_memories');
    for (const table of [
      'model_connection_resources',
      'job_execution_logs',
      'brief_execution_logs',
    ])
      expect(before).not.toHaveProperty(table);
    const legacyBundle = await backup(config, join(folder, 'backup-0039'));
    const legacyDigests = await collectDigests(legacyBundle);
    const upgradedRoot = await restore(legacyBundle, join(folder, 'upgraded'));
    closeDatabase(db);
    db = undefined;
    const upgradedConfig = {
      ...config,
      databasePath: join(upgradedRoot, 'database.sqlite'),
      storageDir: join(upgradedRoot, 'media'),
    };
    db = createDatabaseContext(upgradedConfig.databasePath);
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    const after = snapshot(db);
    for (const [table, rows] of Object.entries(before)) {
      if (table === 'schema_migrations')
        expect(
          (after[table] as { name: string }[]).filter((row) => Number(row.name.slice(0, 4)) <= 39),
        ).toEqual(rows);
      else if (table === 'creative_briefs')
        expect(after[table]).toEqual(
          (rows as object[]).map((row) => ({ ...row, planner_revision: null })),
        );
      else expect(after[table], table).toEqual(rows);
    }
    const currentMigrations = (await readdir(resolve('migrations')))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    expect((after.schema_migrations as { name: string }[]).map((row) => row.name).sort()).toEqual(
      currentMigrations,
    );
    expect(currentMigrations).toEqual(
      expect.arrayContaining(['0042-model-fallback-resources.sql', '0043-job-execution-logs.sql']),
    );
    for (const table of [
      'model_connection_resources',
      'job_execution_logs',
      'brief_execution_logs',
    ])
      expect(after[table], table).toEqual([]);
    expect(after.credit_accounts_channel).toEqual(before.credit_accounts_channel);
    expect(after.credit_lots).toEqual(before.credit_lots);
    expect(
      (await collectDigests(upgradedRoot)).filter((file) => file.path.startsWith('media/')),
    ).toEqual(legacyDigests.filter((file) => file.path.startsWith('media/')));
    expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(db.sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    closeDatabase(db);
    db = undefined;
    app = await createApp(upgradedConfig, { serveWeb: false });
    const memory = app.services.core.knowledge.createMemory(actor, wid, {
      topic: '职业背景',
      content: '合成测试职业',
      kind: 'profile',
    });
    const product = app.services.core.knowledge.createProduct(actor, wid, {
      name: '隔离产品',
      facts: ['合成资料'],
      brandId: brand.id,
      referenceAssetIds: [asset.id],
    });
    const recycled = app.services.core.knowledge.createProduct(actor, wid, {
      name: '回收资料',
      referenceAssetIds: [asset.id],
    });
    app.services.core.knowledge.removeProduct(actor, wid, recycled.id);
    const headers = {
      cookie: `studio_session=${account.sessionToken}`,
      'x-workspace-id': wid,
      origin: config.publicOrigin,
    };
    const prepared = await app.app.inject({
      method: 'POST',
      url: '/api/v1/creative-briefs/prepare',
      headers,
      payload: {
        requestId: randomUUID(),
        input: { ...input, productId: product.id, useMemory: true, includeProductImages: true },
      },
    });
    expect(prepared.statusCode, prepared.body).toBe(200);
    const briefId = prepared.json().data.id as string;
    app.services.settings.connections.update(wid, {
      kind: 'text',
      protocol: 'openai-chat',
      baseUrl: 'https://example.test/v1',
      modelsUrl: '',
      model: 'synthetic-only',
      enabled: true,
      secret: 'isolated-never-call-provider',
    });
    const briefRows = app.services.db.sqlite
      .prepare('SELECT * FROM creative_briefs ORDER BY id')
      .all();
    const freshBrief = app.services.db.sqlite
      .prepare('SELECT planner_revision,request_json FROM creative_briefs WHERE id=?')
      .get(briefId) as { planner_revision: string; request_json: string };
    expect(freshBrief.planner_revision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(freshBrief.request_json).memoryContext.items[0].id).toBe(memory.id);
    const bundle = await backup(upgradedConfig, join(folder, 'backup-0041'));
    const bundleDigests = await collectDigests(bundle);
    await app.app.close();
    app = undefined;
    const restoredRoot = await restore(bundle, join(folder, 'restored'));
    const keys = JSON.parse(await readFile(join(restoredRoot, 'keys.json'), 'utf8')) as {
      sessionSecret: string;
      encryptionKey: string;
    };
    const restoredConfig = {
      ...upgradedConfig,
      ...keys,
      databasePath: join(restoredRoot, 'database.sqlite'),
      storageDir: join(restoredRoot, 'media'),
    };
    // Remove both earlier installations: restored access must use only the copied database/media.
    await rm(join(folder, 'legacy'), { recursive: true });
    await rm(upgradedRoot, { recursive: true });
    app = await createApp(restoredConfig, { serveWeb: false });
    expect(app.services.db.sqlite.pragma('database_list')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'main',
          file: await realpath(restoredConfig.databasePath),
        }),
      ]),
    );
    expect(
      app.services.db.sqlite.prepare('SELECT * FROM creative_briefs ORDER BY id').all(),
    ).toEqual(briefRows);
    expect(app.services.settings.connections.runtime(wid, 'text')?.secret).toBe(
      'isolated-never-call-provider',
    );
    expect(app.services.core.knowledge.getMemory(actor, wid, memory.id)).toEqual(memory);
    expect(app.services.core.knowledge.getProduct(actor, wid, product.id)).toEqual(product);
    expect(app.services.core.knowledge.listProducts(actor, wid, { deleted: true }).items).toEqual([
      expect.objectContaining({ id: recycled.id }),
    ]);
    await app.app.close();
    app = undefined;
    const guard = join(folder, 'deny-external.mjs');
    await writeFile(
      guard,
      `
      import { createRequire } from 'node:module';
      const require = createRequire(${JSON.stringify(resolve('package.json'))});
      const Database = require('better-sqlite3');
      const pragma = Database.prototype.pragma;
      Database.prototype.pragma = function(sql, ...args) {
        const result = pragma.call(this, sql, ...args);
        if (sql === 'journal_mode = WAL')
          console.info('__validation_database__' + JSON.stringify(pragma.call(this, 'database_list')));
        return result;
      };
      globalThis.fetch = async () => { throw new Error('External network forbidden during persistence validation'); };
    `,
    );
    const env = {
      ...isolatedTestEnvironment(resolve('.')),
      NODE_ENV: 'test',
      DEMO_MODE: 'false',
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_ORIGIN: config.publicOrigin,
      DATABASE_PATH: restoredConfig.databasePath,
      STORAGE_DIR: restoredConfig.storageDir,
      SESSION_SECRET: keys.sessionSecret,
      ENCRYPTION_KEY: keys.encryptionKey,
    };
    for (let restart = 0; restart < 2; restart++) {
      const running = ['src/server/main.ts', 'src/worker/main.ts'].map((entry) => {
        const child = spawn(process.execPath, ['--import', guard, '--import', 'tsx', entry], {
          cwd: resolve('.'),
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.push(child);
        let output = '';
        child.stdout!.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.stderr!.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        return { child, output: () => output };
      });
      await expect
        .poll(
          async () => {
            for (const item of running)
              if (item.child.exitCode !== null) throw new Error(item.output());
            try {
              return (await fetch(`${config.publicOrigin}/api/v1/health`)).status;
            } catch {
              return 0;
            }
          },
          { timeout: 20000, interval: 100 },
        )
        .toBe(200);
      await expect
        .poll(() => running[1]!.output(), { timeout: 20000, interval: 100 })
        .toContain('映造任务执行器已启动');
      for (const item of running) {
        const opened = item
          .output()
          .split('\n')
          .find((line) => line.startsWith('__validation_database__'));
        expect(opened, 'Actual API/worker database handle').toBeDefined();
        expect(JSON.parse(opened!.slice('__validation_database__'.length))).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'main',
              file: await realpath(restoredConfig.databasePath),
            }),
          ]),
        );
      }
      for (const [path, id] of [
        [`/memories/${memory.id}`, memory.id],
        [`/products/${product.id}`, product.id],
        [`/brands/${brand.id}`, brand.id],
        [`/projects/${project.id}`, project.id],
        [`/creative-briefs/${legacyBriefId}`, legacyBriefId],
        [`/creative-briefs/${briefId}`, briefId],
      ]) {
        const response = await fetch(`${config.publicOrigin}/api/v1${path}`, { headers });
        expect(response.status, path).toBe(200);
        expect((await response.json()).data.id, path).toBe(id);
      }
      const original = await fetch(`${config.publicOrigin}/api/v1/assets/${asset.id}/content`, {
        headers,
      });
      expect(original.status).toBe(200);
      expect(Buffer.from(await original.arrayBuffer())).toEqual(png);
      for (const variant of ['preview', 'thumbnail']) {
        const response = await fetch(
          `${config.publicOrigin}/api/v1/assets/${asset.id}/content?variant=${variant}`,
          { headers },
        );
        expect(response.status, variant).toBe(200);
        expect(
          (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width,
        ).toBeGreaterThan(0);
      }
      for (const item of running) {
        expect(item.output()).not.toContain('External network forbidden');
        await stop(item.child);
      }
      children.splice(0);
    }
    db = createDatabaseContext(restoredConfig.databasePath);
    expect(db.sqlite.prepare('SELECT * FROM creative_briefs ORDER BY id').all()).toEqual(briefRows);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 0 });
    for (const table of ['model_connection_resources', 'job_execution_logs'])
      expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(
      (await collectDigests(restoredRoot)).filter((file) => file.path.startsWith('media/')),
    ).toEqual(legacyDigests.filter((file) => file.path.startsWith('media/')));
    expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(db.sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await collectDigests(legacyBundle)).toEqual(legacyDigests);
    expect(await collectDigests(bundle)).toEqual(bundleDigests);
  } finally {
    for (const child of children) await stop(child);
    if (app) await app.app.close();
    if (db) closeDatabase(db);
    await rm(folder, { recursive: true, force: true });
  }
}, 60000);

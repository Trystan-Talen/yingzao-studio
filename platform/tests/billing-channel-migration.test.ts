/** Pre-channel API tasks must retain the account that actually funded their reservation. */
import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createTaskServices } from '../src/server/tasks/service';
import { createCreditService } from '../src/server/tasks/credits';
import { jobInputSchema } from '../src/contracts/jobs';
import { inputHash } from '../src/server/tasks/validation';
import { createWorker } from '../src/worker/runner';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';
import { hash as hashSecret } from '../src/server/core/shared';
it('upgrades an API-key in-flight reservation as web and finishes it there exactly once', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-channel-upgrade-')),
    legacy = join(folder, 'legacy');
  await mkdir(legacy);
  for (const name of await readdir(resolve('migrations')))
    if (/^\d+.*\.sql$/.test(name) && Number(name.slice(0, 4)) < 22)
      await copyFile(resolve('migrations', name), join(legacy, name));
  const db = createDatabaseContext(join(folder, 'old.sqlite'));
  let worker: ReturnType<typeof createWorker> | undefined;
  try {
    migrateDatabase(db, { migrationsDir: legacy });
    const config: AppConfig = {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(folder, 'old.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'fixture-only',
      encryptionKey: 'fixture-only',
      isProduction: false,
      demoMode: true,
      environmentSecrets: { openai: 'fixture-only' },
    };
    const core = createCoreServices(db, config),
      registered = await core.auth.register({
        email: 'legacy-key@example.local',
        password: 'LegacyKeyFixture2026!',
        displayName: '历史密钥任务',
      });
    const uid = registered.user.id,
      wid = registered.workspace.id,
      time = new Date().toISOString();
    const actor: Actor = {
      userId: uid,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    // Build the persisted pre-0022 key shape, not a current service on an old schema.
    const keyId = randomUUID();
    db.sqlite
      .prepare(
        'INSERT INTO api_keys(id,workspace_id,created_by,name,prefix,token_hash,scopes_json,credit_limit,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        keyId,
        wid,
        uid,
        'legacy-key',
        'yz_fixture',
        hashSecret('yz_explicit_legacy_migration_fixture'),
        JSON.stringify(['jobs:read', 'jobs:write']),
        100,
        time,
      );
    const oldKey = db.sqlite.prepare('SELECT * FROM api_keys WHERE id=?').get(keyId);
    expect(
      db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='team_provisioning'").get(),
    ).toBeUndefined();
    expect(
      (db.sqlite.pragma('table_info(jobs)') as { name: string }[]).some(
        (column) => column.name === 'billing_channel',
      ),
    ).toBe(false);
    const jobId = randomUUID(),
      itemId = randomUUID(),
      lotId = randomUUID(),
      quoteId = randomUUID();
    const input = jobInputSchema.parse({
        operation: 'image.generate',
        providerId: 'openai',
        prompt: '历史接口预留',
      }),
      raw = JSON.stringify(input),
      hash = inputHash(input);
    db.sqlite.prepare('INSERT INTO credit_accounts VALUES(?,100,8,?)').run(wid, time);
    db.sqlite.prepare('INSERT INTO workspace_billing(workspace_id) VALUES(?)').run(wid);
    db.sqlite.prepare('INSERT INTO member_budgets VALUES(?,?,NULL,0,8)').run(wid, uid);
    db.sqlite
      .prepare(
        "INSERT INTO jobs(id,workspace_id,user_id,api_key_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,created_at,updated_at) VALUES(?,?,?,?,'image.generate','openai','历史接口预留',?,?,?,'local-budget-v1','queued','历史预留',8,?,?)",
      )
      .run(jobId, wid, uid, keyId, raw, hash, randomUUID(), time, time);
    db.sqlite
      .prepare(
        "INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,credits,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,0,?,'queued',8,?,?,?)",
      )
      .run(itemId, jobId, wid, uid, raw, time, time, time);
    db.sqlite
      .prepare(
        "INSERT INTO quotes(id,workspace_id,user_id,input_hash,input_json,pricing_version,max_credits,units,expires_at,created_at,used_job_id) VALUES(?,?,?,?,?,'local-budget-v1',8,1,?,?,?)",
      )
      .run(quoteId, wid, uid, hash, raw, time, time, jobId);
    db.sqlite
      .prepare(
        "INSERT INTO credit_lots(id,workspace_id,user_id,source,event_key,granted,remaining,reserved,status,created_at,updated_at) VALUES(?,?,?,'legacy',?,100,100,8,'active',?,?)",
      )
      .run(lotId, wid, uid, `legacy:${wid}`, time, time);
    db.sqlite
      .prepare("INSERT INTO credit_lot_allocations VALUES(?,?,?,?,?,8,'reserved',0,?,?)")
      .run(itemId, lotId, wid, jobId, uid, time, time);
    db.sqlite
      .prepare("INSERT INTO credit_ledger VALUES(?,?,?,?,?,?,'reserve',8,100,8,'旧接口预留',?)")
      .run(randomUUID(), wid, uid, jobId, itemId, `reserve:${itemId}`, time);
    const applied = db.sqlite.prepare('SELECT * FROM schema_migrations ORDER BY name').all();
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    expect(db.sqlite.prepare('SELECT * FROM api_keys WHERE id=?').get(keyId)).toEqual(oldKey);
    expect(
      db.sqlite.prepare('SELECT * FROM schema_migrations WHERE name<? ORDER BY name').all('0022'),
    ).toEqual(applied);
    for (const [table, id] of [
      ['quotes', quoteId],
      ['jobs', jobId],
      ['job_items', itemId],
    ])
      expect(db.sqlite.prepare(`SELECT billing_channel FROM ${table} WHERE id=?`).get(id)).toEqual({
        billing_channel: 'web',
      });
    const credits = createCreditService(db),
      tasks = createTaskServices(db, core, config);
    credits.initialize(wid, uid, 1000);
    expect(credits.account(wid)).toEqual({ balance: 100, reserved: 8 });
    expect(credits.forChannel('api').account(wid)).toEqual({ balance: 0, reserved: 0 });
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#225577' } })
      .png()
      .toBuffer();
    let calls = 0;
    worker = createWorker(tasks, {
      openai: {
        id: 'openai',
        execute: async () => {
          calls++;
          return {
            state: 'complete',
            outputs: [{ buffer: png, mimeType: 'image/png', name: 'legacy.png' }],
          };
        },
      },
    });
    const claimed = worker.claim()!;
    await worker.runItem(claimed);
    await worker.runItem(claimed);
    expect(calls).toBe(1);
    expect(tasks.get(actor, wid, jobId)).toMatchObject({
      status: 'succeeded',
      billingChannel: 'web',
      settledCredits: 8,
    });
    expect(credits.account(wid)).toEqual({ balance: 92, reserved: 0 });
    expect(credits.forChannel('api').account(wid)).toEqual({ balance: 0, reserved: 0 });
    expect(
      db.sqlite
        .prepare('SELECT billing_channel FROM credit_ledger WHERE event_key=?')
        .get(`final:${itemId}`),
    ).toEqual({ billing_channel: 'web' });
    expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    await worker?.stop();
    closeDatabase(db);
    await rm(folder, { recursive: true, force: true });
  }
});

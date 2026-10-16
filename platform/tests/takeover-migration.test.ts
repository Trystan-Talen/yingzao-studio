/** Legacy task records are fixtures. Upgrade must not rewrite outcomes or balances. */
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { createCreditService } from '../src/server/tasks/credits';
import { createTaskServices } from '../src/server/tasks/service';
import { jobInputSchema } from '../src/contracts/jobs';
import { inputHash } from '../src/server/tasks/validation';
import type { AppConfig } from '../src/server/config';
import type { Actor } from '../src/contracts/core';

it('upgrades legacy retry quotes with repeated inputs and duplicate live descendants without changing data', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'yingzao-takeover-upgrade-'));
  const legacy = join(folder, 'old-migrations');
  await mkdir(legacy);
  for (const name of await readdir(resolve('migrations')))
    if (/^\d+.*\.sql$/.test(name) && Number(name.slice(0, 4)) < 19)
      await copyFile(resolve('migrations', name), join(legacy, name));
  const db = createDatabaseContext(join(folder, 'upgrade.sqlite'));
  try {
    migrateDatabase(db, { migrationsDir: legacy });
    const config: AppConfig = {
      host: '127.0.0.1',
      port: 4310,
      publicOrigin: 'http://127.0.0.1:5174',
      databasePath: join(folder, 'upgrade.sqlite'),
      storageDir: join(folder, 'media'),
      sessionSecret: 'migration-fixture',
      encryptionKey: 'migration-fixture',
      isProduction: false,
      demoMode: true,
      environmentSecrets: { openai: 'fixture-not-a-key' },
    };
    const credits = createCreditService(db);
    const core = createCoreServices(db, config);
    const registered = await core.auth.register({
      email: 'upgrade@example.local',
      password: 'MigrationFixture2026!',
      displayName: '迁移测试',
    });
    const wid = registered.workspace.id;
    const uid = registered.user.id;
    db.sqlite
      .prepare('INSERT INTO credit_accounts VALUES(?,1000,0,?)')
      .run(wid, new Date().toISOString());
    db.sqlite.prepare('INSERT INTO workspace_billing(workspace_id) VALUES(?)').run(wid);
    db.sqlite
      .prepare(
        "INSERT INTO credit_lots(id,workspace_id,user_id,source,event_key,granted,remaining,reserved,status,created_at,updated_at) VALUES(?,?,?,'initial',?,1000,1000,0,'active',?,?)",
      )
      .run(
        randomUUID(),
        wid,
        uid,
        `initial:${wid}`,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    const actor: Actor = {
      userId: uid,
      authType: 'session',
      workspaceId: null,
      apiKeyId: null,
      scopes: [],
    };
    const input = jobInputSchema.parse({
      operation: 'image.generate',
      providerId: 'openai',
      prompt: '同一输入',
    });
    const raw = JSON.stringify(input);
    const time = '2026-10-14T01:00:00.000Z';
    function job(status: string, itemStatuses: string[]) {
      const id = randomUUID();
      db.sqlite
        .prepare(
          `INSERT INTO jobs(id,workspace_id,user_id,operation,provider_id,prompt,input_json,input_hash,request_id,pricing_version,status,stage,requested_credits,created_at,updated_at)
        VALUES(@id,@wid,@uid,'image.generate','openai','同一输入',@raw,@hash,@request,'local-budget-v1',@status,'历史夹具',@credits,@time,@time)`,
        )
        .run({
          id,
          wid,
          uid,
          raw,
          hash: inputHash(input),
          request: randomUUID(),
          status,
          credits: itemStatuses.length * 8,
          time,
        });
      const items = itemStatuses.map((itemStatus, index) => {
        const itemId = randomUUID();
        db.sqlite
          .prepare(
            `INSERT INTO job_items(id,job_id,workspace_id,user_id,item_index,input_json,status,credits,next_attempt_at,created_at,updated_at)
          VALUES(@itemId,@id,@wid,@uid,@index,@raw,@status,8,@time,@time,@time)`,
          )
          .run({ itemId, id, wid, uid, index, raw, status: itemStatus, time });
        return itemId;
      });
      return { id, items };
    }
    const original = job('failed', ['failed', 'failed']);
    const retry = job('running', ['succeeded', 'running']);
    const duplicate = job('running', ['running']);
    for (const target of [retry, duplicate])
      db.sqlite
        .prepare(
          `INSERT INTO quotes(id,workspace_id,user_id,input_hash,input_json,pricing_version,max_credits,units,expires_at,created_at,items_json,retry_job_id,used_job_id)
        VALUES(@id,@wid,@uid,@hash,@raw,'local-budget-v1',@credits,@units,@time,@time,@items,@source,@target)`,
        )
        .run({
          id: randomUUID(),
          wid,
          uid,
          hash: inputHash(input),
          raw,
          credits: target.items.length * 8,
          units: target.items.length,
          time,
          items: JSON.stringify(target.items.map(() => input)),
          source: original.id,
          target: target.id,
        });
    const previous = db.sqlite
      .prepare('SELECT name,checksum,applied_at FROM schema_migrations ORDER BY name')
      .all();
    const balance = db.sqlite
      .prepare('SELECT balance,reserved FROM credit_accounts WHERE workspace_id=?')
      .get(wid);
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    expect(
      db.sqlite
        .prepare(
          'SELECT name,checksum,applied_at FROM schema_migrations WHERE name<? ORDER BY name',
        )
        .all('0019'),
    ).toEqual(previous);
    expect(credits.account(wid)).toEqual(balance);
    expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(
      db.sqlite
        .prepare(
          'SELECT status,retry_source_item_id,retry_root_item_id,result_data_json FROM job_items WHERE id=?',
        )
        .get(retry.items[1]),
    ).toEqual({
      status: 'running',
      retry_source_item_id: original.items[1],
      retry_root_item_id: original.items[1],
      result_data_json: null,
    });
    expect(
      db.sqlite
        .prepare('SELECT retry_root_item_id FROM job_items WHERE id=?')
        .get(duplicate.items[0]),
    ).toEqual({ retry_root_item_id: original.items[0] });
    const tasks = createTaskServices(db, core, config);
    expect(() => tasks.retryQuote(actor, wid, original.id)).toThrow();
    expect(tasks.get(actor, wid, original.id).items.every((item) => item.retryable === false)).toBe(
      true,
    );
  } finally {
    closeDatabase(db);
    await rm(folder, { recursive: true, force: true });
  }
});

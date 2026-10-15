import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createCoreServices } from '../src/server/core';
import { hashPassword } from '../src/server/core/auth';
import { createCreditService } from '../src/server/tasks/credits';
import { id, now } from '../src/server/core/shared';
import type { Actor } from '../src/contracts/core';
export async function seedDemo(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Demo seed is forbidden in production');
  // Deliberately never read DATABASE_PATH: demo data cannot enter the user's real database.
  const db = createDatabaseContext(resolve('var/demo.sqlite'));
  try {
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    const credits = createCreditService(db);
    const core = createCoreServices(
      db,
      {
        storageDir: resolve('var/demo-media'),
        sessionSecret: 'explicit-local-demo-only',
        publicOrigin: 'http://127.0.0.1:5174',
        isProduction: false,
        demoMode: true,
      },
      { onWorkspaceCreated: (wid, uid) => credits.initialize(wid, uid, 1000) },
    );
    let user = db.sqlite.prepare('SELECT id FROM users WHERE email=?').get('demo@example.local') as
      { id: string } | undefined;
    if (!user) {
      const passwordHash = await hashPassword('DemoStudio2026!');
      db.sqlite
        .transaction(() => {
          const uid = id(),
            date = now();
          db.sqlite
            .prepare(
              'INSERT INTO users(id,email,password_hash,display_name,preferences_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
            )
            .run(
              uid,
              'demo@example.local',
              passwordHash,
              '演示创作者',
              JSON.stringify({ theme: 'system', locale: 'zh-CN', confirmGeneration: true }),
              date,
              date,
            );
          const space = core.auth.createWorkspace(uid, '演示工作空间', 'personal', true);
          db.sqlite.prepare('UPDATE users SET active_workspace_id=? WHERE id=?').run(space.id, uid);
          user = { id: uid };
        })
        .immediate();
    }
    const actor: Actor = {
      userId: user!.id,
      authType: 'session',
      apiKeyId: null,
      workspaceId: null,
      scopes: [],
    };
    const space = core.auth.listWorkspaces(actor).find((w) => w.isDemo);
    if (!space)
      throw new Error(
        'Existing demo account has no explicit demo workspace; refusing to alter unrelated data',
      );
    db.sqlite
      .transaction(() => {
        credits.initialize(space.id, actor.userId, 1000);
        if (!db.sqlite.prepare('SELECT id FROM projects WHERE workspace_id=?').get(space.id))
          core.projects.create(actor, space.id, {
            name: '我的第一个创作',
            description: '显式演示项目：空白画布，可编辑、保存和导出。未模拟任何AI结果。',
            kind: 'image',
          });
        const plans = [
          [
            'b92c1c4e-0679-42bc-9ad0-de369b2d8fb4',
            '个人创作（月付）',
            'subscription',
            5900,
            'month',
            3000,
            { brands: 10, seats: 1, concurrency: 2 },
          ],
          [
            'dc591d2a-b7ea-492c-a5da-2199b41378fb',
            '团队协作（月付）',
            'subscription',
            29900,
            'month',
            18000,
            { brands: 100, seats: 10, concurrency: 4 },
          ],
          ['8bd1a011-646c-4be2-aabc-feebdc00b52d', '算力补给包', 'credits', 9900, null, 5000, {}],
        ] as const;
        for (const [p, name, kind, price, interval, amount, limits] of plans)
          db.sqlite
            .prepare(
              "INSERT OR IGNORE INTO plans(id,name,kind,price_minor,currency,interval,credits,limits_json,active,catalog_mode) VALUES (?,?,?,?,?,?,?,?,1,'demo')",
            )
            .run(p, name, kind, price, 'CNY', interval, amount, JSON.stringify(limits));
      })
      .immediate();
    process.stdout.write(
      '演示数据已就绪：var/demo.sqlite；demo@example.local / DemoStudio2026!（仅本机演示，无真实支付或AI结果）\n',
    );
  } finally {
    closeDatabase(db);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await seedDemo();

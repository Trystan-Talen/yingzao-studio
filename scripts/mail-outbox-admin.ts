import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { loadConfig } from '../src/server/config';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { createMailOutbox } from '../src/server/notifications';
const common = { operatorId: z.string().uuid() };
const statusSchema = z.object({ ...common, workspaceId: z.string().uuid() }).strict();
const actionSchema = z
  .object({
    ...common,
    id: z.string().uuid(),
    action: z.enum(['retry-confirmed-not-accepted', 'confirm-accepted', 'cancel']),
    evidenceReference: z.string().min(3).max(200),
  })
  .strict();
const [command, path] = process.argv.slice(2);
if (!path || !['status', 'reconcile'].includes(command ?? '')) {
  console.error(
    'Usage: pnpm exec tsx scripts/mail-outbox-admin.ts status|reconcile /absolute/input.json',
  );
  process.exitCode = 1;
} else {
  let db: ReturnType<typeof createDatabaseContext> | undefined;
  try {
    const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const parsed = (command === 'status' ? statusSchema : actionSchema).safeParse(input);
    if (!parsed.success) throw new Error('Mail administration input is invalid.');
    const config = loadConfig();
    db = createDatabaseContext(config.databasePath);
    const first = db.sqlite.prepare('SELECT id FROM users ORDER BY created_at,id LIMIT 1').get() as
      { id: string } | undefined;
    if (first?.id !== parsed.data.operatorId)
      throw new Error('Installation administrator account is required.');
    const outbox = createMailOutbox(db, config);
    if ('workspaceId' in parsed.data)
      console.info(
        JSON.stringify(
          { enabled: outbox.smtp.enabled, items: outbox.listStatus(parsed.data.workspaceId) },
          null,
          2,
        ),
      );
    else console.info(JSON.stringify(outbox.reconcile(parsed.data), null, 2));
  } catch {
    // Never print configuration, payload, recipient, SQL params, or arbitrary parser/SMTP errors.
    console.error(
      'Mail administration failed. Check input, installation administrator, applied migrations, encryption key and current mail state.',
    );
    process.exitCode = 1;
  } finally {
    if (db) closeDatabase(db);
  }
}

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../src/server/config';
import { createDatabaseContext, closeDatabase } from '../src/server/db/connection';
import { migrateDatabase } from '../src/server/db/migrate';
import { createMailOutbox } from '../src/server/notifications';
import {
  createBillingAdmin,
  planImportSchema,
  riskResolutionSchema,
  referralProgramSchema,
  channelApprovalSchema,
  entitlementDefaultsSchema,
  supportResolutionSchema,
  creditGrantSchema,
  creditValiditySchema,
} from '../src/server/billing/admin';
const operations = {
  'import-plans': { schema: planImportSchema, method: 'importPlans' },
  'resolve-risks': { schema: riskResolutionSchema, method: 'resolveRisks' },
  'configure-referrals': { schema: referralProgramSchema, method: 'configureReferrals' },
  'approve-channel': { schema: channelApprovalSchema, method: 'approveChannel' },
  'configure-entitlements': { schema: entitlementDefaultsSchema, method: 'configureEntitlements' },
  'resolve-appeal': { schema: supportResolutionSchema, method: 'resolveAppeal' },
  'grant-credits': { schema: creditGrantSchema, method: 'grantCredits' },
  'extend-credits': { schema: creditValiditySchema, method: 'extendCredits' },
  'restore-credits': { schema: creditValiditySchema, method: 'restoreCredits' },
} as const;
type Command = keyof typeof operations;
const isCommand = (value: string | undefined): value is Command =>
  !!value && Object.hasOwn(operations, value);
const help = `离线商业管理（所有写操作必须显式指定 DATABASE_PATH）\n\npnpm exec tsx scripts/commerce-admin.ts <命令> <JSON文件>\npnpm exec tsx scripts/commerce-admin.ts --schema <命令>\n\n命令：${Object.keys(operations).join(', ')}\n\nactorUserId 必须是此安装首位管理员，reason 至少20字符；写入均审计。\nresolve-risks 不执行现金退款；resolve-appeal 仅退回已结算的应用额度。\n完整规则参见 OPERATIONS-COMMERCE.md。`;
async function main() {
  const [command, file, ...extra] = process.argv.slice(2);
  if (command === '--help' && !file) {
    console.info(help);
    return;
  }
  if (command === '--schema' && isCommand(file) && !extra.length) {
    console.info(JSON.stringify(z.toJSONSchema(operations[file].schema), null, 2));
    return;
  }
  if (!isCommand(command) || !file || extra.length) throw new Error(help);
  if (!process.env.DATABASE_PATH)
    throw new Error('写操作必须通过 DATABASE_PATH 显式指定目标数据库。');
  if ((await stat(file)).size > 1024 * 1024) throw new Error('管理员JSON文件不能超过1 MiB');
  const input: unknown = JSON.parse(await readFile(file, 'utf8'));
  // Validate before opening/migrating the chosen database. Refinements remain authoritative.
  operations[command].schema.parse(input);
  const config = loadConfig(),
    db = createDatabaseContext(config.databasePath);
  try {
    migrateDatabase(db, { migrationsDir: resolve('migrations') });
    const mail = createMailOutbox(db, config);
    const admin = createBillingAdmin(db, { onNotificationCreated: mail.enqueueNotification }),
      result = admin[operations[command].method](input);
    console.info(JSON.stringify({ database: config.databasePath, command, result }, null, 2));
  } finally {
    closeDatabase(db);
  }
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

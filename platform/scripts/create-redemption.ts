import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { loadConfig } from '../src/server/config';
import { createServices } from '../src/server/app';
import { closeDatabase } from '../src/server/db/connection';

const help =
  '用法：DATABASE_PATH=/明确选择的数据库 pnpm create-redemption <1–100000000额度>\n创建前请备份目标数据库；此命令只创建一次性平台额度兑换码。';

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.info(help);
    return;
  }
  const credits = Number(args[0]);
  if (args.length !== 1 || !Number.isSafeInteger(credits) || credits <= 0 || credits > 100000000)
    throw new Error(help);
  // Reject a missing target before config can create keys or services can migrate a database.
  if (!process.env.DATABASE_PATH?.trim())
    throw new Error('创建兑换码必须通过 DATABASE_PATH 显式指定非空目标数据库。');
  const services = createServices(loadConfig());
  try {
    const code = `YZ-${randomBytes(18).toString('base64url')}`;
    services.db.sqlite
      .prepare('INSERT INTO redemption_codes(id,code_hash,credits,created_at) VALUES(?,?,?,?)')
      .run(
        randomUUID(),
        createHash('sha256').update(code).digest('hex'),
        credits,
        new Date().toISOString(),
      );
    console.info(`已创建一次性额度兑换码（只显示一次，无现金价值）：${code}`);
  } finally {
    closeDatabase(services.db);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : '创建兑换码失败。');
  process.exitCode = 1;
}

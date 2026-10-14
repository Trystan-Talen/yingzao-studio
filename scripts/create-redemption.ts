import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { loadConfig } from '../src/server/config';
import { createServices } from '../src/server/app';
import { closeDatabase } from '../src/server/db/connection';
const credits = Number(process.argv[2]);
if (!Number.isSafeInteger(credits) || credits <= 0 || credits > 100000000)
  throw new Error('用法：pnpm create-redemption <1–100000000额度>');
const s = createServices(loadConfig());
try {
  const code = `YZ-${randomBytes(18).toString('base64url')}`;
  s.db.sqlite
    .prepare('INSERT INTO redemption_codes(id,code_hash,credits,created_at) VALUES(?,?,?,?)')
    .run(
      randomUUID(),
      createHash('sha256').update(code).digest('hex'),
      credits,
      new Date().toISOString(),
    );
  console.info(`已创建一次性额度兑换码（只显示一次，无现金价值）：${code}`);
} finally {
  closeDatabase(s.db);
}

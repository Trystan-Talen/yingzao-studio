import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type { AppConfig } from '../../src/server/config';
import { createServices } from '../../src/server/app';
import { createWorker } from '../../src/worker/runner';
import { createMailWorker } from '../../src/server/notifications';
import { closeDatabase } from '../../src/server/db/connection';
import type { SmsGateway } from '../../src/server/auth/identity/types';

const runRoot = process.env.E2E_RUN_ROOT;
if (!runRoot || !process.argv[2]) throw new Error('Isolated browser test configuration required.');
const config = JSON.parse(await readFile(process.argv[2], 'utf8')) as AppConfig & {
  clockFile?: string;
  localSms?: { port: number; secret: string };
};
const inside = (file: string) => {
  const path = relative(resolve(runRoot), resolve(file));
  return !isAbsolute(path) && !path.startsWith('..');
};
const path = relative(resolve(runRoot), resolve(config.databasePath));
if (
  isAbsolute(path) ||
  path.startsWith('..') ||
  new URL(config.publicOrigin).hostname !== '127.0.0.1' ||
  (config.smtp?.enabled &&
    (config.smtp.host !== '127.0.0.1' || config.smtp.tlsMode !== 'local-test')) ||
  Object.values(config.environmentSecrets).some(Boolean) ||
  config.billing?.stripeSecretKey ||
  config.google?.enabled ||
  !inside(config.storageDir) ||
  (config.clockFile && !inside(config.clockFile)) ||
  (config.sms?.enabled &&
    (!config.localSms ||
      !Number.isInteger(config.localSms.port) ||
      config.localSms.port < 1 ||
      config.localSms.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(config.localSms.secret))) ||
  config.wechat?.enabled
)
  throw new Error('Only isolated, local browser fixtures are allowed.');
const smsGateway: SmsGateway | undefined = config.localSms
  ? {
      async send(input) {
        const response = await fetch(`http://127.0.0.1:${config.localSms!.port}/sms`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.localSms!.secret}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
          redirect: 'error',
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return { status: 'failed', errorCode: 'TEST_GATEWAY_REJECTED' };
        return { status: 'accepted' };
      },
    }
  : undefined;
const services = createServices(config, undefined, {
  now: config.clockFile
    ? () => new Date(JSON.parse(readFileSync(config.clockFile!, 'utf8')) as number)
    : undefined,
  smsGateway,
});
const workers = [
  createWorker(services),
  createMailWorker(services.mail),
  createMailWorker(services.passwordRecovery.mail),
  services.identities.sms,
];
let stopped = false;
async function tick() {
  await Promise.all(workers.map((worker) => worker.tick()));
}
const timer = setInterval(() => {
  if (!stopped) void tick().catch(() => console.error('Isolated worker tick failed'));
}, 100);
await tick();
await writeFile(`${process.argv[2]}.ready`, 'ready', { mode: 0o600 });
console.info('isolated-worker-ready');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    stopped = true;
    clearInterval(timer);
    void Promise.all(workers.map((worker) => worker.stop())).then(() => {
      closeDatabase(services.db);
      process.exit(0);
    });
  });

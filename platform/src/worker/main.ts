import { loadConfig } from '../server/config';
import { createServices } from '../server/app';
import { closeDatabase } from '../server/db/connection';
import { createWorker } from './runner';
import { createMailWorker } from '../server/notifications';
const services = createServices(loadConfig());
const worker = createWorker(services);
const mailWorker = createMailWorker(services.mail);
let stopping = false;
const timer = setInterval(() => {
  if (!stopping) {
    void worker.tick().catch((error) => {
      console.error('Worker tick failed:', error instanceof Error ? error.message : 'unknown');
    });
    void mailWorker.tick().catch(() => {
      console.error('Mail worker tick failed; inspect protected outbox status.');
    });
  }
}, 1500);
await worker.tick();
await mailWorker.tick();
console.info('映造任务执行器已启动');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    stopping = true;
    clearInterval(timer);
    void Promise.all([worker.stop(), mailWorker.stop()]).then(() => {
      closeDatabase(services.db);
      process.exit(0);
    });
  });

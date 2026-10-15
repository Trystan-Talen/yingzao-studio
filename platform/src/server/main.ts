import { loadConfig } from './config';
import { createApp } from './app';
const config = loadConfig();
const { app } = await createApp(config, { logging: true });
await app.listen({ host: config.host, port: config.port });
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });

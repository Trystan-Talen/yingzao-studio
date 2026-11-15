import { defineConfig } from 'vitest/config';
import { isolatedTestEnvironment } from './scripts/test-environment';
const isolated = isolatedTestEnvironment(process.cwd());
export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    env: { PATH: isolated.PATH!, DOTENV_CONFIG_PATH: isolated.DOTENV_CONFIG_PATH! },
    include: ['tests/**/*.test.ts', 'src/web/editor/**/*.test.ts'],
    testTimeout: 15000,
    fileParallelism: false,
  },
});

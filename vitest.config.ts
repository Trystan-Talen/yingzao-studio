import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/web/editor/**/*.test.ts'],
    testTimeout: 15000,
    fileParallelism: false,
  },
});

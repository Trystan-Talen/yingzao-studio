import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
const root = process.env.E2E_RUN_ROOT;
if (!root)
  throw new Error('Run browser tests through pnpm test:e2e to isolate data and artifacts.');
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 45_000,
  outputDir: resolve(root, 'results'),
  reporter: [['list'], ['html', { outputFolder: resolve(root, 'report'), open: 'never' }]],
  use: {
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'notebook',
      testMatch: '**/canvas.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'tablet',
      testMatch: '**/canvas.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
  ],
});

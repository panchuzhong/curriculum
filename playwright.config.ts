import { defineConfig, devices } from '@playwright/test';

process.env.DB_PATH ??= './data/e2e.db';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    env: {
      ...process.env,
      DB_PATH: process.env.DB_PATH || './data/e2e.db',
    },
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 30000,
  },
});

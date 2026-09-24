import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.E2E_DATABASE_URL;
const storageState = process.env.E2E_STORAGE_STATE;

if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) {
  throw new Error('E2E_DATABASE_URL must point to a dedicated database whose name ends in _test');
}
if (!storageState) {
  throw new Error('E2E_STORAGE_STATE must point to an authenticated Playwright storage-state JSON file');
}

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3000',
    storageState,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, DATABASE_URL: databaseUrl }
  }
});

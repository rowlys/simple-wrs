import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Spec §9: E2E against the running Compose stack (`docker compose up --build -d`), through nginx like a user.
// The repository's .env gives WEB_PORT and the seeded users' passwords; variables already set win.
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  testDir: './e2e',
  // The specs share one stack and its database, so they run one at a time.
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${process.env.WEB_PORT || 8080}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

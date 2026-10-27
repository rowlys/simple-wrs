import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Loads backend/.env.test and refuses to continue unless DATABASE_URL points at a *_test database,
// because the tests truncate every table of that database (decision D-03 in docs/ai-workflow.md §6).
export function loadTestEnv(): void {
  const file = join(__dirname, '..', '.env.test');
  if (!existsSync(file)) throw new Error(`Missing ${file}: copy backend/.env.test.example to backend/.env.test`);
  process.loadEnvFile(file);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set for the test run');
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests: database "${dbName}" in DATABASE_URL does not end with "_test"`);
  }
}

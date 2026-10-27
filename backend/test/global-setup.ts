import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { loadTestEnv } from './env';

// Runs once per `npm test`: applies pending migrations to wrs_test; each test file truncates the
// tables in beforeEach (technical spec §3.3 step 7, decision D-11 in docs/ai-workflow.md §6).
export default function globalSetup(): void {
  loadTestEnv();
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });
}

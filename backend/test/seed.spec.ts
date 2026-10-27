import { PrismaClient } from '@prisma/client';
import { compare } from 'bcrypt';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { truncateAll } from './db';

// Runs the seed exactly as the container will (`npm run seed`), against wrs_test.
function runSeed(passwords: { SEED_SUPERVISOR_PASSWORD?: string; SEED_OPERATOR_PASSWORD?: string }) {
  const env = { ...process.env, ...passwords };
  if (!passwords.SEED_SUPERVISOR_PASSWORD) delete env.SEED_SUPERVISOR_PASSWORD;
  if (!passwords.SEED_OPERATOR_PASSWORD) delete env.SEED_OPERATOR_PASSWORD;
  return spawnSync('npm', ['run', 'seed'], { cwd: join(__dirname, '..'), env, shell: true, encoding: 'utf8' });
}

describe('seed (A-08, spec §3.3 step 6, §3.4)', () => {
  const prisma = new PrismaClient();
  const passwords = { SEED_SUPERVISOR_PASSWORD: 'sup-secret-1', SEED_OPERATOR_PASSWORD: 'op-secret-1' };

  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  it('A-08 FR-12 seeding twice leaves exactly 2 users, 5 products and 5 balances of 0', async () => {
    for (const run of [1, 2]) {
      const result = runSeed(passwords);
      expect({ run, status: result.status, stderr: result.stderr }).toEqual({ run, status: 0, stderr: expect.any(String) });
    }

    const users = await prisma.user.findMany({ orderBy: { username: 'asc' } });
    expect(users.map(({ username, fullName, role }) => ({ username, fullName, role }))).toEqual([
      { username: 'operator', fullName: 'Budi Operator', role: 'OPERATOR' },
      { username: 'supervisor', fullName: 'Siti Supervisor', role: 'SUPERVISOR' },
    ]);
    expect(await compare('sup-secret-1', users[1].passwordHash)).toBe(true);
    expect(await compare('op-secret-1', users[0].passwordHash)).toBe(true);
    expect(users[0].passwordHash).toMatch(/^\$2[aby]\$10\$/); // NFR-02 bcrypt cost 10

    const products = await prisma.product.findMany({ include: { balance: true }, orderBy: { sku: 'asc' } });
    expect(products.map((p) => p.sku)).toEqual(['CHL-DRY-003', 'CHL-MEA-005', 'FRZ-CHK-001', 'FRZ-FSH-002', 'FRZ-VEG-004']);
    expect(products.map((p) => p.balance?.quantityOnHand)).toEqual([0, 0, 0, 0, 0]);
    expect(await prisma.inventoryBalance.count()).toBe(5);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it('A-08 seeding fails and creates nothing when the seed passwords are unset', async () => {
    const noSupervisor = runSeed({ SEED_OPERATOR_PASSWORD: 'op-secret-1' });
    expect(noSupervisor.status).not.toBe(0);
    expect(noSupervisor.stderr).toContain('SEED_SUPERVISOR_PASSWORD');

    const noOperator = runSeed({ SEED_SUPERVISOR_PASSWORD: 'sup-secret-1' });
    expect(noOperator.status).not.toBe(0);
    expect(noOperator.stderr).toContain('SEED_OPERATOR_PASSWORD');

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.product.count()).toBe(0);
  });
});

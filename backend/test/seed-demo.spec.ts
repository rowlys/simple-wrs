import { INestApplication } from '@nestjs/common';
import { exec } from 'node:child_process';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';
import { assertInventoryConsistent, truncateAll } from './db';

// Async: the script calls the API served by this same process, which a blocking spawnSync would freeze.
const run = promisify(exec);

// Runs `npm run seed` then `npm run seed:demo` exactly as a person would, against a listening test app.
describe('demo seed (local try-out data, D-27)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let env: NodeJS.ProcessEnv;
  const npm = (script: string) => run(`npm run ${script}`, { cwd: join(__dirname, '..'), env });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    env = { ...process.env, API_URL: `http://127.0.0.1:${port}`, SEED_SUPERVISOR_PASSWORD: 'password', SEED_OPERATOR_PASSWORD: 'password' };
  });
  beforeEach(() => truncateAll(prisma));
  afterAll(() => app.close());

  it('A-08 creates documents in every status with receipts and a reversal through the API; a second run changes nothing', async () => {
    await npm('seed');
    const first = await npm('seed:demo');

    const documents = await prisma.receivingDocument.findMany({ orderBy: { documentNumber: 'asc' } });
    expect(documents.map((d) => d.status).sort()).toEqual(
      ['CANCELLED', 'CLOSED_SHORT', 'COMPLETED', 'DRAFT', 'IN_PROGRESS', 'IN_PROGRESS', 'OPEN'],
    );
    expect(await prisma.receiptReversal.count()).toBe(1);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'RECEIPT_REVERSAL' } })).toBe(1);
    await assertInventoryConsistent(prisma);
    expect(first.stdout).toContain('Demo data created');

    const again = await npm('seed:demo');
    expect(again.stdout).toContain('Demo data skipped');
    expect(await prisma.receivingDocument.count()).toBe(documents.length);
    expect(await prisma.receipt.count()).toBe(await prisma.inventoryTransaction.count({ where: { type: 'RECEIPT' } }));
  });

  it('A-08 fails with a clear message when the products were not seeded first', async () => {
    await npm('seed');
    await prisma.inventoryBalance.deleteMany();
    await prisma.product.deleteMany();

    await expect(npm('seed:demo')).rejects.toMatchObject({ stderr: expect.stringContaining('npm run seed') });
    expect(await prisma.receivingDocument.count()).toBe(0);
  });
});

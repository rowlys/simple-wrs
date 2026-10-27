// Seed (technical spec §3.3 step 6, §3.4). Run with `npm run seed`: Node 22 strips the types itself,
// so this file needs no build step and runs unchanged in the node:22-alpine image.
// Keep it to erasable TypeScript only (no enums, no parameter properties, no relative imports).
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

const PRODUCTS = [
  { sku: 'FRZ-CHK-001', name: 'Frozen Chicken Breast 1kg', unitOfMeasure: 'CTN' },
  { sku: 'FRZ-FSH-002', name: 'Frozen Tuna Loin', unitOfMeasure: 'CTN' },
  { sku: 'CHL-DRY-003', name: 'UHT Milk 1L', unitOfMeasure: 'CTN' },
  { sku: 'FRZ-VEG-004', name: 'Frozen Mixed Vegetables 500g', unitOfMeasure: 'PCS' },
  { sku: 'CHL-MEA-005', name: 'Beef Sirloin Chilled', unitOfMeasure: 'PCS' },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; the seed needs it for the demo user's password`);
  return value;
}

async function main(): Promise<void> {
  const users = [
    { username: 'supervisor', fullName: 'Siti Supervisor', role: 'SUPERVISOR', password: required('SEED_SUPERVISOR_PASSWORD') },
    { username: 'operator', fullName: 'Budi Operator', role: 'OPERATOR', password: required('SEED_OPERATOR_PASSWORD') },
  ] as const;

  const prisma = new PrismaClient();
  try {
    for (const { password, ...user } of users) {
      // The env var stays the source of truth for the demo password, so an existing user gets the current one.
      const passwordHash = await hash(password, 10); // NFR-02: bcrypt cost 10, as in the API
      await prisma.user.upsert({
        where: { username: user.username },
        create: { ...user, passwordHash },
        update: { fullName: user.fullName, role: user.role, passwordHash },
      });
    }
    for (const product of PRODUCTS) {
      // FR-12: a new product gets its balance of 0 in the same (nested-write) transaction; existing ones are untouched.
      await prisma.product.upsert({
        where: { sku: product.sku },
        create: { ...product, balance: { create: { quantityOnHand: 0 } } },
        update: {},
      });
    }
    console.log(`Seed complete: ${users.length} users, ${PRODUCTS.length} products`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'bcrypt';

const TABLES = [
  'inventory_transactions',
  'receipt_reversals',
  'receipts',
  'receiving_items',
  'receiving_documents',
  'inventory_balances',
  'products',
  'users',
];

// Call in beforeEach: empties every table and restarts the ledger identity and the document number sequence.
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe('ALTER SEQUENCE receiving_document_number_seq RESTART WITH 1');
}

export async function createUser(
  prisma: PrismaClient,
  { username, password, role, fullName = username }: { username: string; password: string; role: UserRole; fullName?: string },
) {
  return prisma.user.create({ data: { username, fullName, role, passwordHash: await hash(password, 10) } });
}

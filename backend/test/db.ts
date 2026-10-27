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

// BR-12 and BR-13 across the whole database (testing.md §1). Run after every receiving test.
export async function assertInventoryConsistent(prisma: PrismaClient): Promise<void> {
  const balances = await prisma.$queryRaw<unknown[]>`
    SELECT b.product_id, b.quantity_on_hand, COALESCE(SUM(t.quantity_change), 0)::int AS ledger
    FROM inventory_balances b LEFT JOIN inventory_transactions t ON t.product_id = b.product_id
    GROUP BY b.product_id, b.quantity_on_hand
    HAVING b.quantity_on_hand < 0 OR b.quantity_on_hand <> COALESCE(SUM(t.quantity_change), 0)`;
  const lines = await prisma.$queryRaw<unknown[]>`
    SELECT i.id, i.received_quantity, COALESCE(SUM(r.quantity) FILTER (WHERE v.id IS NULL), 0)::int AS receipts
    FROM receiving_items i
    LEFT JOIN receipts r ON r.receiving_item_id = i.id
    LEFT JOIN receipt_reversals v ON v.receipt_id = r.id
    GROUP BY i.id, i.received_quantity, i.expected_quantity
    HAVING i.received_quantity < 0 OR i.received_quantity > i.expected_quantity
        OR i.received_quantity <> COALESCE(SUM(r.quantity) FILTER (WHERE v.id IS NULL), 0)`;
  expect({ balances, lines }).toEqual({ balances: [], lines: [] });
}

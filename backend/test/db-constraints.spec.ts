import { PrismaClient } from '@prisma/client';
import { createUser, truncateAll } from './db';

// Raw SQL straight at wrs_test, bypassing the API: the database itself must reject these (NFR-01).
describe('database constraints', () => {
  const prisma = new PrismaClient();
  let userId: string;
  let productId: string;
  let documentId: string;
  let itemId: string;
  let receiptId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    userId = (await createUser(prisma, { username: 'sup', password: 'pw', role: 'SUPERVISOR' })).id;
    productId = (
      await prisma.product.create({
        data: { sku: 'FRZ-CHK-001', name: 'Chicken', unitOfMeasure: 'CTN', balance: { create: {} } },
      })
    ).id;
    documentId = (
      await prisma.receivingDocument.create({
        data: { documentNumber: 'RCV-2026-000001', supplierName: 'Supplier', status: 'IN_PROGRESS', createdById: userId },
      })
    ).id;
    itemId = (
      await prisma.receivingItem.create({
        data: { receivingDocumentId: documentId, productId, expectedQuantity: 100, receivedQuantity: 10 },
      })
    ).id;
    receiptId = (
      await prisma.receipt.create({
        data: { receivingItemId: itemId, quantity: 10, idempotencyKey: 'key-00000001', receivedById: userId },
      })
    ).id;
  });

  afterAll(() => prisma.$disconnect());

  const checkViolation = (constraint: string) =>
    expect.objectContaining({
      code: 'P2010',
      meta: expect.objectContaining({ code: '23514', message: expect.stringContaining(constraint) }),
    });

  it('BR-13 T-DB-01 rejects received_quantity above expected_quantity (ri_received_range_chk)', async () => {
    await expect(
      prisma.$executeRaw`UPDATE receiving_items SET received_quantity = 101 WHERE id = ${itemId}::uuid`,
    ).rejects.toEqual(checkViolation('ri_received_range_chk'));
    await expect(
      prisma.$executeRaw`UPDATE receiving_items SET received_quantity = -1 WHERE id = ${itemId}::uuid`,
    ).rejects.toEqual(checkViolation('ri_received_range_chk'));
    expect((await prisma.receivingItem.findUniqueOrThrow({ where: { id: itemId } })).receivedQuantity).toBe(10);
  });

  it('BR-12 T-DB-02 rejects a negative on-hand quantity (ib_non_negative_chk)', async () => {
    await expect(
      prisma.$executeRaw`UPDATE inventory_balances SET quantity_on_hand = -1 WHERE product_id = ${productId}::uuid`,
    ).rejects.toEqual(checkViolation('ib_non_negative_chk'));
    expect((await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId } })).quantityOnHand).toBe(0);
  });

  it('BR-19 T-DB-03 rejects a second reversal of the same receipt (unique receipt_reversals.receipt_id)', async () => {
    await prisma.$executeRaw`INSERT INTO receipt_reversals (receipt_id, reason, reversed_by_id) VALUES (${receiptId}::uuid, 'first', ${userId}::uuid)`;
    await expect(
      prisma.$executeRaw`INSERT INTO receipt_reversals (receipt_id, reason, reversed_by_id) VALUES (${receiptId}::uuid, 'second', ${userId}::uuid)`,
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'P2010',
        meta: expect.objectContaining({ code: '23505', message: expect.stringContaining('(receipt_id)') }),
      }),
    );
    expect(await prisma.receiptReversal.count({ where: { receiptId } })).toBe(1);
  });

  it('BR-01 NFR-01 rejects a lower-case SKU (products_sku_format_chk)', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO products (sku, name, unit_of_measure) VALUES ('frz-chk-002', 'Chicken', 'CTN')`,
    ).rejects.toEqual(checkViolation('products_sku_format_chk'));
    expect(await prisma.product.count()).toBe(1);
  });

  it('BR-12 NFR-01 rejects a RECEIPT ledger row without receipt_id (it_receipt_link_chk)', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO inventory_transactions (product_id, type, quantity_change, balance_after, receiving_document_id, created_by_id)
        VALUES (${productId}::uuid, 'RECEIPT', 10, 10, ${documentId}::uuid, ${userId}::uuid)`,
    ).rejects.toEqual(checkViolation('it_receipt_link_chk'));
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });
});

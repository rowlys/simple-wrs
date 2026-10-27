import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUsersAndLogin, TestUsers } from './app';
import { assertInventoryConsistent, truncateAll } from './db';
import { createProducts, openDocument, receive } from './fixtures';

describe('receipts (US-04)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TestUsers;
  let products: { id: string; sku: string }[];

  beforeAll(async () => ({ app, prisma } = await createTestApp()));
  beforeEach(async () => {
    await truncateAll(prisma);
    users = await createUsersAndLogin(app, prisma);
    products = await createProducts(prisma, ['AAA-001', 'BBB-002']);
  });
  afterEach(() => assertInventoryConsistent(prisma));
  afterAll(() => app.close());

  const op = (documentId: string, itemId: string, quantity: unknown, key?: string | null) =>
    receive(app, users.operator.token, documentId, itemId, quantity, key);
  const action = (documentId: string, name: string, body?: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/receiving-documents/${documentId}/${name}`)
      .set('Authorization', `Bearer ${users.supervisor.token}`)
      .send(body);
  const lines = (...expected: number[]) => expected.map((expectedQuantity, i) => ({ productId: products[i].id, expectedQuantity }));
  const open = (...expected: number[]) => openDocument(app, users.supervisor.token, lines(...expected));
  const fieldsOf = (res: request.Response) => res.body.error.details.fields.map((f: { field: string }) => f.field);

  // Everything a receipt may touch, to prove a rejected request changed nothing.
  const snapshot = async () => ({
    items: await prisma.receivingItem.findMany({ orderBy: { id: 'asc' } }),
    documents: await prisma.receivingDocument.findMany({ orderBy: { id: 'asc' } }),
    receipts: await prisma.receipt.findMany({ orderBy: { id: 'asc' } }),
    balances: await prisma.inventoryBalance.findMany({ orderBy: { productId: 'asc' } }),
    ledger: await prisma.inventoryTransaction.findMany({ orderBy: { id: 'asc' } }),
  });
  const onHand = async (productId: string) => (await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId } })).quantityOnHand;

  describe('recording (FR-30–FR-34)', () => {
    it('T-RCV-01 AC-04.1 FR-31 receiving 40 of 100 on an OPEN document updates line, stock, ledger and status', async () => {
      const doc = await open(100);
      const item = doc.items[0];

      const res = await op(doc.id, item.id, 40);

      expect(res.status).toBe(201);
      expect(res.headers['idempotent-replayed']).toBeUndefined();
      expect(res.body).toEqual({
        receipt: {
          id: expect.any(String),
          receivingItemId: item.id,
          productSku: 'AAA-001',
          quantity: 40,
          receivedAt: expect.any(String),
          receivedBy: { id: users.operator.id, fullName: 'operator' },
          reversal: null,
        },
        item: { ...item, receivedQuantity: 40, remainingQuantity: 60, isFullyReceived: false },
        document: { id: doc.id, documentNumber: doc.documentNumber, status: 'IN_PROGRESS', allItemsReceived: false },
        inventory: { productId: products[0].id, quantityOnHand: 40 },
      });
      expect(await onHand(products[0].id)).toBe(40);
      expect(await prisma.inventoryTransaction.findMany()).toEqual([
        expect.objectContaining({
          productId: products[0].id,
          type: 'RECEIPT',
          quantityChange: 40,
          balanceAfter: 40,
          receiptId: res.body.receipt.id,
          receiptReversalId: null,
          receivingDocumentId: doc.id,
          createdById: users.operator.id,
        }),
      ]);
      expect((await prisma.receivingDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('IN_PROGRESS');
    });

    it('T-RCV-02 AC-04.2 FR-32 FR-34 receiving the remaining 60 makes the line fully received', async () => {
      const doc = await open(100, 5);
      await op(doc.id, doc.items[0].id, 40);

      const res = await op(doc.id, doc.items[0].id, 60);

      expect(res.status).toBe(201);
      expect(res.body.item).toMatchObject({ receivedQuantity: 100, remainingQuantity: 0, isFullyReceived: true });
      expect(res.body.document).toMatchObject({ status: 'IN_PROGRESS', allItemsReceived: false });
      expect(res.body.inventory.quantityOnHand).toBe(100);
      expect((await prisma.inventoryTransaction.findMany({ orderBy: { id: 'asc' } })).map((t) => t.balanceAfter)).toEqual([40, 100]);

      const last = await op(doc.id, doc.items[1].id, 5);
      expect(last.body.document.allItemsReceived).toBe(true);
    });

    it('FR-30 a supervisor can record a receipt too', async () => {
      const doc = await open(10);

      const res = await receive(app, users.supervisor.token, doc.id, doc.items[0].id, 10);

      expect(res.status).toBe(201);
      expect(res.body.receipt.receivedBy.id).toBe(users.supervisor.id);
    });

    it('FR-02 recording a receipt without a token is 401 and nothing changes', async () => {
      const doc = await open(10);
      const before = await snapshot();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/receiving-documents/${doc.id}/items/${doc.items[0].id}/receipts`)
        .set('Idempotency-Key', 'key-00000001')
        .send({ quantity: 1 });

      expect(res.status).toBe(401);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('rejections (BR-07, BR-08, BR-09)', () => {
    it('T-RCV-03 AC-04.3 BR-07 receiving 61 with 60 remaining is 422 QUANTITY_EXCEEDS_REMAINING and nothing changes', async () => {
      const doc = await open(100);
      await op(doc.id, doc.items[0].id, 40);
      const before = await snapshot();

      const res = await op(doc.id, doc.items[0].id, 61);

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: 'QUANTITY_EXCEEDS_REMAINING',
        message: 'Cannot receive 61 units; only 60 remaining for AAA-001.',
        details: { remainingQuantity: 60, requestedQuantity: 61 },
      });
      expect(await snapshot()).toEqual(before);
    });

    it.each([[0], [-1], [1.5], ['ten'], ['4'], [null], [undefined], [1_000_001]])(
      'T-RCV-04 AC-04.4 BR-07 quantity %p is 400 VALIDATION_ERROR naming quantity and nothing changes',
      async (quantity) => {
        const doc = await open(100);
        const before = await snapshot();

        const res = await op(doc.id, doc.items[0].id, quantity);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(fieldsOf(res)).toContain('quantity');
        expect(await snapshot()).toEqual(before);
      },
    );

    const inState = async (status: 'DRAFT' | 'COMPLETED' | 'CLOSED_SHORT' | 'CANCELLED') => {
      if (status === 'DRAFT') {
        return (
          await request(app.getHttpServer())
            .post('/api/v1/receiving-documents')
            .set('Authorization', `Bearer ${users.supervisor.token}`)
            .send({ supplierName: 'PT Sumber Beku', items: lines(10) })
        ).body;
      }
      const doc = await open(10);
      if (status === 'CANCELLED') await action(doc.id, 'cancel', { reason: 'Supplier cancelled shipment' });
      if (status === 'COMPLETED') {
        await op(doc.id, doc.items[0].id, 10);
        await action(doc.id, 'complete');
      }
      if (status === 'CLOSED_SHORT') {
        await op(doc.id, doc.items[0].id, 4);
        await action(doc.id, 'close-short', { reason: 'Supplier out of stock' });
      }
      expect((await prisma.receivingDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe(status);
      return doc;
    };

    it.each(['DRAFT', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
      'T-RCV-05 AC-04.5 BR-08 receiving on a %s document is 409 INVALID_DOCUMENT_STATUS and nothing changes',
      async (status) => {
        const doc = await inState(status);
        const before = await snapshot();

        const res = await op(doc.id, doc.items[0].id, 1);

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_DOCUMENT_STATUS');
        expect(await snapshot()).toEqual(before);
      },
    );

    it.each([[null], ['short-7'], ['k'.repeat(101)], ['has space!'], ['key/with/slash']])(
      'T-RCV-06 BR-09 Idempotency-Key %p is 400 VALIDATION_ERROR naming the header and nothing changes',
      async (key) => {
        const doc = await open(100);
        const before = await snapshot();

        const res = await op(doc.id, doc.items[0].id, 1, key);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(fieldsOf(res)).toEqual(['Idempotency-Key']);
        expect(await snapshot()).toEqual(before);
      },
    );

    it('T-RCV-06 BR-09 keys of 8 and 100 characters from [A-Za-z0-9_-] are accepted', async () => {
      const doc = await open(100);

      expect((await op(doc.id, doc.items[0].id, 1, 'aB3_-xyz')).status).toBe(201);
      expect((await op(doc.id, doc.items[0].id, 1, 'k'.repeat(100))).status).toBe(201);
    });

    it('T-RCV-07 a line of another document is 404 NOT_FOUND; unknown and non-UUID ids are 404 and 400', async () => {
      const doc = await open(100);
      const other = await open(100);
      const before = await snapshot();

      expect((await op(doc.id, other.items[0].id, 1)).status).toBe(404);
      expect((await op('00000000-0000-4000-8000-000000000000', doc.items[0].id, 1)).status).toBe(404);
      expect((await op(doc.id, '00000000-0000-4000-8000-000000000000', 1)).status).toBe(404);
      expect((await op(doc.id, 'not-a-uuid', 1)).status).toBe(400);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('idempotency (BR-09)', () => {
    it('T-IDM-01 AC-04.6 the same request and key again is 200 with the same receipt and changes nothing', async () => {
      const doc = await open(100);
      const first = await op(doc.id, doc.items[0].id, 10, 'key-AC-04-6');
      const before = await snapshot();

      const replay = await op(doc.id, doc.items[0].id, 10, 'key-AC-04-6');

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await snapshot()).toEqual(before);
    });

    it('T-IDM-01 D-22 a replay after the document was completed is still 200 with the original receipt', async () => {
      const doc = await open(10);
      const first = await op(doc.id, doc.items[0].id, 10, 'key-completed');
      await action(doc.id, 'complete');

      const replay = await op(doc.id, doc.items[0].id, 10, 'key-completed');

      expect(replay.status).toBe(200);
      expect(replay.body.receipt.id).toBe(first.body.receipt.id);
      expect(replay.body.document.status).toBe('COMPLETED');
      expect(await prisma.receipt.count()).toBe(1);
    });

    it('T-IDM-02 AC-04.7 the key with another quantity or another line is 409 IDEMPOTENCY_KEY_REUSED and nothing changes', async () => {
      const doc = await open(100, 100);
      const other = await open(100);
      await op(doc.id, doc.items[0].id, 10, 'key-AC-04-7');
      const before = await snapshot();

      for (const res of [
        await op(doc.id, doc.items[0].id, 5, 'key-AC-04-7'),
        await op(doc.id, doc.items[1].id, 10, 'key-AC-04-7'),
        await op(other.id, other.items[0].id, 10, 'key-AC-04-7'),
        await op(other.id, doc.items[0].id, 10, 'key-AC-04-7'), // D-21: right line, wrong document
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      }
      expect(await snapshot()).toEqual(before);
    });
  });
});

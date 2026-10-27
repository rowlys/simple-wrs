import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUsersAndLogin, TestUsers } from './app';
import { assertInventoryConsistent, truncateAll } from './db';
import { createProducts, openDocument, receive } from './fixtures';

// Parallel HTTP requests against one listening server and the real wrs_test database (testing.md §4.4).
// The races are not forced into an order, so each test asserts what must hold for every interleaving.
describe('concurrency (BR-14)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TestUsers;
  let product: { id: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await app.listen(0);
  });
  beforeEach(async () => {
    await truncateAll(prisma);
    users = await createUsersAndLogin(app, prisma);
    [product] = await createProducts(prisma, ['AAA-001']);
  });
  afterEach(() => assertInventoryConsistent(prisma));
  afterAll(() => app.close());

  const ROUNDS = 5;
  const open = (expectedQuantity: number) => openDocument(app, users.supervisor.token, [{ productId: product.id, expectedQuantity }]);
  const op = (doc: { id: string; items: { id: string }[] }, quantity: number, key?: string) =>
    receive(app, users.operator.token, doc.id, doc.items[0].id, quantity, key);
  const action = (documentId: string, name: 'cancel' | 'complete', body?: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/receiving-documents/${documentId}/${name}`)
      .set('Authorization', `Bearer ${users.supervisor.token}`)
      .send(body);
  const onHand = async () => (await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId: product.id } })).quantityOnHand;
  const stored = (id: string) => prisma.receivingDocument.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const statuses = (results: request.Response[]) => results.map((r) => r.status).sort();

  it('T-IDM-03 BR-09 the same request and key sent twice in parallel records one receipt: one 201, one 200', async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const doc = await open(100);
      const key = randomUUID();

      const results = await Promise.all([op(doc, 7, key), op(doc, 7, key)]);

      expect(statuses(results)).toEqual([200, 201]);
      expect(results[0].body.receipt.id).toBe(results[1].body.receipt.id);
      expect(await prisma.receipt.count({ where: { idempotencyKey: key } })).toBe(1);
      expect(await onHand()).toBe(7 * round);
    }
  });

  // The second request waits on the document lock while the first records everything that was remaining; it must
  // still be answered as a replay, not as 422 QUANTITY_EXCEEDS_REMAINING (D-24).
  it('T-IDM-03 BR-09 FR-33 a double submit of the whole remaining quantity is one 201 and one 200 replay', async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const doc = await open(7);
      const key = randomUUID();

      const results = await Promise.all([op(doc, 7, key), op(doc, 7, key)]);

      expect(statuses(results)).toEqual([200, 201]);
      expect(results[0].body.receipt.id).toBe(results[1].body.receipt.id);
      expect(await onHand()).toBe(7 * round);
    }
  });

  it('T-CON-01 AC-04.8 BR-14 five parallel receipts of 4 against remaining 10: exactly 2 succeed, 3 get 422', async () => {
    const doc = await open(10);

    const results = await Promise.all(Array.from({ length: 5 }, () => op(doc, 4)));

    expect(statuses(results)).toEqual([201, 201, 422, 422, 422]);
    for (const res of results.filter((r) => r.status === 422)) {
      expect(res.body.error).toMatchObject({ code: 'QUANTITY_EXCEEDS_REMAINING', details: { remainingQuantity: 2, requestedQuantity: 4 } });
    }
    expect((await stored(doc.id)).items[0].receivedQuantity).toBe(8);
    expect(await onHand()).toBe(8);
    expect(await prisma.receipt.count()).toBe(2);
  });

  it('T-CON-02 BR-12 BR-14 twenty parallel receipts of 1 across two documents of one product: on-hand +20, ledger 1..20', async () => {
    const docs = [await open(10), await open(10)];

    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => op(docs[i % 2], 1)));

    expect(statuses(results)).toEqual(Array(20).fill(201));
    expect(await onHand()).toBe(20);
    const ledger = await prisma.inventoryTransaction.findMany({ orderBy: { id: 'asc' } });
    // Each receipt saw the balance left by the one before it: the balance row lock serialized them.
    expect(ledger.map((t) => t.balanceAfter)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('T-CON-03 BR-14 a receipt and a cancel in parallel on an OPEN document: exactly one wins, never cancelled with stock', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const doc = await open(10);
      const before = await onHand();

      const [receipt, cancel] = await Promise.all([op(doc, 3), action(doc.id, 'cancel', { reason: 'Supplier cancelled shipment' })]);
      const after = await stored(doc.id);

      if (cancel.status === 200) {
        expect(receipt.status).toBe(409);
        expect(receipt.body.error.code).toBe('INVALID_DOCUMENT_STATUS');
        expect(after).toMatchObject({ status: 'CANCELLED', items: [expect.objectContaining({ receivedQuantity: 0 })] });
        expect(await onHand()).toBe(before);
      } else {
        expect(receipt.status).toBe(201);
        expect(cancel.status).toBe(409);
        expect(cancel.body.error.code).toBe('INVALID_STATUS_TRANSITION');
        expect(after).toMatchObject({ status: 'IN_PROGRESS', items: [expect.objectContaining({ receivedQuantity: 3 })] });
        expect(await onHand()).toBe(before + 3);
      }
    }
  });

  it('T-CON-04 BR-14 the last receipt and complete in parallel: never completed while a line is short', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const doc = await open(10);
      await op(doc, 6);

      const [receipt, complete] = await Promise.all([op(doc, 4), action(doc.id, 'complete')]);
      const after = await stored(doc.id);

      expect(receipt.status).toBe(201);
      expect(after.items[0].receivedQuantity).toBe(10);
      if (complete.status === 200) {
        expect(after.status).toBe('COMPLETED');
      } else {
        expect(complete.status).toBe(422);
        expect(complete.body.error.code).toBe('ITEMS_NOT_FULLY_RECEIVED');
        expect(after.status).toBe('IN_PROGRESS');
      }
    }
  });
});

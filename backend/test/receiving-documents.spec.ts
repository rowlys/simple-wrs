import { INestApplication } from '@nestjs/common';
import { ReceivingStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, createUsersAndLogin, TestUsers } from './app';
import { assertInventoryConsistent, truncateAll } from './db';
import { receive } from './fixtures';
import { PrismaService } from '../src/prisma/prisma.service';

describe('receiving documents (US-03, US-05, US-07)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TestUsers;
  let products: { id: string; sku: string; name: string; unitOfMeasure: string }[];

  beforeAll(async () => ({ app, prisma } = await createTestApp()));
  beforeEach(async () => {
    await truncateAll(prisma);
    users = await createUsersAndLogin(app, prisma);
    products = [];
    for (const sku of ['AAA-001', 'BBB-002', 'CCC-003']) {
      const { id, name, unitOfMeasure } = await prisma.product.create({
        data: { sku, name: `Product ${sku}`, unitOfMeasure: 'CTN', balance: { create: { quantityOnHand: 0 } } },
      });
      products.push({ id, sku, name, unitOfMeasure });
    }
  });
  afterEach(() => assertInventoryConsistent(prisma));
  afterAll(() => app.close());

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path = '', as: keyof TestUsers = 'supervisor') =>
    request(app.getHttpServer())[method](`/api/v1/receiving-documents${path}`).set('Authorization', `Bearer ${users[as].token}`);
  const create = (body: object, as: keyof TestUsers = 'supervisor') => api('post', '', as).send(body);
  const action = (id: string, name: 'open' | 'complete' | 'close-short' | 'cancel', body?: object) =>
    api('post', `/${id}/${name}`).send(body);

  const year = new Date().getUTCFullYear();
  const uuid = expect.stringMatching(/^[0-9a-f-]{36}$/);
  const isoDate = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const fieldsOf = (res: request.Response) => res.body.error.details.fields.map((f: { field: string }) => f.field);
  const lines = (...expected: number[]) => expected.map((expectedQuantity, i) => ({ productId: products[i].id, expectedQuantity }));

  // A DRAFT document with one line per expected quantity (products in SKU order).
  const draft = async (...expected: number[]) => (await create({ supplierName: 'PT Sumber Beku', items: lines(...expected) })).body;

  // Drives a document to `status` through the API: open, receive each line up to `received` (lines in SKU order),
  // then complete / close short / cancel. COMPLETED receives everything; IN_PROGRESS and CLOSED_SHORT receive 1
  // on the first line when `received` is empty. Fails loudly if the state cannot be reached.
  const setState = async (documentId: string, status: ReceivingStatus, received: number[] = []) => {
    if (status === 'DRAFT') return;
    const doc = (await api('get', `/${documentId}`)).body;
    if (doc.status === 'DRAFT') expect((await action(documentId, 'open')).status).toBe(200);

    let targets = received;
    if (status === 'COMPLETED') targets = doc.items.map((i: { expectedQuantity: number }) => i.expectedQuantity);
    else if (!received.length && (status === 'IN_PROGRESS' || status === 'CLOSED_SHORT')) targets = [1];
    for (const [i, target] of targets.entries()) {
      const missing = target - doc.items[i].receivedQuantity;
      if (missing > 0) expect((await receive(app, users.operator.token, documentId, doc.items[i].id, missing)).status).toBe(201);
    }

    if (status === 'COMPLETED') await action(documentId, 'complete');
    if (status === 'CLOSED_SHORT') await action(documentId, 'close-short', { reason: 'fixture' });
    if (status === 'CANCELLED') await action(documentId, 'cancel', { reason: 'fixture' });
    expect((await snapshot(documentId)).status).toBe(status);
  };

  // The document and its lines as stored, to prove a rejected request changed nothing.
  const snapshot = (id: string) =>
    prisma.receivingDocument.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });

  describe('create (FR-21, FR-22, BR-04–BR-06, BR-16)', () => {
    it('T-DOC-01 AC-03.1 FR-21 FR-22 creates a DRAFT numbered RCV-YYYY-000001 with both lines received 0', async () => {
      const res = await create({ supplierName: 'PT Sumber Beku', items: [lines(0, 50)[1], lines(100)[0]] });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: uuid,
        documentNumber: `RCV-${year}-000001`,
        supplierName: 'PT Sumber Beku',
        referenceNumber: null,
        expectedDate: null,
        notes: null,
        status: 'DRAFT',
        itemCount: 2,
        totalExpectedQuantity: 150,
        totalReceivedQuantity: 0,
        allItemsReceived: false,
        // Lines created together are listed by SKU (D-16).
        items: [
          { id: uuid, product: products[0], expectedQuantity: 100, receivedQuantity: 0, remainingQuantity: 100, isFullyReceived: false },
          { id: uuid, product: products[1], expectedQuantity: 50, receivedQuantity: 0, remainingQuantity: 50, isFullyReceived: false },
        ],
        receipts: [],
        createdAt: isoDate,
        createdBy: { id: users.supervisor.id, fullName: 'supervisor' },
        openedAt: null,
        openedBy: null,
        completedAt: null,
        completedBy: null,
        closedShortAt: null,
        closedShortBy: null,
        closeShortReason: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        updatedAt: isoDate,
      });
      expect(await prisma.receivingItem.count()).toBe(2);
    });

    it('FR-22 document numbers follow the global sequence', async () => {
      const numbers = [];
      for (let i = 0; i < 3; i++) numbers.push((await create({ supplierName: 'S' })).body.documentNumber);

      expect(numbers).toEqual([`RCV-${year}-000001`, `RCV-${year}-000002`, `RCV-${year}-000003`]);
    });

    it('FR-21 BR-04 stores trimmed header fields; items default to none', async () => {
      const res = await create({
        supplierName: '  PT Sumber Beku  ',
        referenceNumber: ' SJ-2026-10-0042 ',
        expectedDate: '2026-10-28',
        notes: '  Frozen goods, dock 2  ',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        supplierName: 'PT Sumber Beku',
        referenceNumber: 'SJ-2026-10-0042',
        expectedDate: '2026-10-28',
        notes: 'Frozen goods, dock 2',
        itemCount: 0,
        totalExpectedQuantity: 0,
        allItemsReceived: false,
        items: [],
      });
    });

    it.each([[null], [''], ['   ']])('BR-04 a referenceNumber and notes of %p are stored as null', async (value) => {
      const res = await create({ supplierName: 'S', referenceNumber: value, notes: value, expectedDate: null });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ referenceNumber: null, notes: null, expectedDate: null });
    });

    it('BR-04 BR-05 upper bounds are accepted (supplier 200, reference 100, notes 1000, expected 1,000,000)', async () => {
      const res = await create({
        supplierName: 's'.repeat(200),
        referenceNumber: 'r'.repeat(100),
        notes: 'n'.repeat(1000),
        items: lines(1_000_000),
      });

      expect(res.status).toBe(201);
    });

    it('T-DOC-02 AC-03.2 BR-06 the same product twice is 409 DUPLICATE_PRODUCT_IN_DOCUMENT and nothing is created', async () => {
      const res = await create({ supplierName: 'S', items: [lines(10)[0], lines(20)[0]] });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'DUPLICATE_PRODUCT_IN_DOCUMENT', message: expect.any(String) } });
      expect(await prisma.receivingDocument.count()).toBe(0);
      expect(await prisma.receivingItem.count()).toBe(0);
    });

    it.each([[0], [-5], [2.5], [1_000_001], ['10'], [null], [undefined]])(
      'T-DOC-03 AC-03.3 BR-05 expectedQuantity %p is 400 VALIDATION_ERROR naming the line field',
      async (expectedQuantity) => {
        const res = await create({ supplierName: 'S', items: [{ productId: products[0].id, expectedQuantity }] });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(new Set(fieldsOf(res))).toEqual(new Set(['items.0.expectedQuantity']));
        expect(await prisma.receivingDocument.count()).toBe(0);
      },
    );

    it.each([
      ['supplierName', undefined, 'supplierName'],
      ['supplierName', '   ', 'supplierName'],
      ['supplierName', 's'.repeat(201), 'supplierName'],
      ['supplierName', 5, 'supplierName'],
      ['referenceNumber', 'r'.repeat(101), 'referenceNumber'],
      ['notes', 'n'.repeat(1001), 'notes'],
      ['expectedDate', '2026-02-30', 'expectedDate'],
      ['expectedDate', '0000-01-01', 'expectedDate'],
      ['expectedDate', '28-10-2026', 'expectedDate'],
      ['expectedDate', '2026-10-28T10:00:00Z', 'expectedDate'],
      ['items', 'none', 'items'],
      ['items', null, 'items'],
      ['items', [{ productId: 'not-a-uuid', expectedQuantity: 1 }], 'items.0.productId'],
      ['items', [{ expectedQuantity: 1 }], 'items.0.productId'],
      ['items', [{ productId: randomUUID(), expectedQuantity: 1, receivedQuantity: 5 }], 'items.0.receivedQuantity'],
      ['status', 'OPEN', 'status'],
    ])('T-DOC-04 BR-04 %s = %p is 400 VALIDATION_ERROR naming %s', async (field, value, named) => {
      const res = await create({ supplierName: 'S', [field]: value });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(new Set(fieldsOf(res))).toEqual(new Set([named]));
      expect(await prisma.receivingDocument.count()).toBe(0);
    });

    it('T-DOC-04 more than 200 lines is 400 VALIDATION_ERROR naming items', async () => {
      const items = Array.from({ length: 201 }, () => ({ productId: randomUUID(), expectedQuantity: 1 }));

      const res = await create({ supplierName: 'S', items });

      expect(res.status).toBe(400);
      expect(fieldsOf(res)).toEqual(['items']);
    });

    it('T-DOC-05 BR-16 an unknown productId is 422 PRODUCT_NOT_FOUND and nothing is created', async () => {
      const res = await create({ supplierName: 'S', items: [...lines(10), { productId: randomUUID(), expectedQuantity: 5 }] });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: { code: 'PRODUCT_NOT_FOUND', message: expect.any(String) } });
      expect(await prisma.receivingDocument.count()).toBe(0);
      expect(await prisma.receivingItem.count()).toBe(0);
    });
  });

  describe('detail (FR-23, FR-34)', () => {
    it('FR-23 returns the document as created; an operator can view it', async () => {
      const created = await draft(100, 50);

      const res = await api('get', `/${created.id}`, 'operator');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(created);
    });

    // The reversal shown on a receipt is tested with the reverse endpoint (T-REV-01), which does not exist yet.
    it('FR-23 FR-34 lists receipts oldest first with SKU and user; per-line and document received flags', async () => {
      const doc = await draft(10, 5);
      await setState(doc.id, 'IN_PROGRESS', [10, 3]);
      const [first, second] = doc.items.map((i: { id: string }) => i.id);
      const older = await prisma.receipt.findFirstOrThrow({ where: { receivingItemId: first } });
      const newer = await prisma.receipt.findFirstOrThrow({ where: { receivingItemId: second } });

      const res = await api('get', `/${doc.id}`, 'operator');

      expect(res.body.receipts).toEqual([
        { id: older.id, receivingItemId: first, productSku: 'AAA-001', quantity: 10, receivedAt: older.receivedAt.toISOString(), receivedBy: { id: users.operator.id, fullName: 'operator' }, reversal: null },
        {
          id: newer.id,
          receivingItemId: second,
          productSku: 'BBB-002',
          quantity: 3,
          receivedAt: newer.receivedAt.toISOString(),
          receivedBy: { id: users.operator.id, fullName: 'operator' },
          reversal: null,
        },
      ]);
      expect(res.body.items.map((i: { isFullyReceived: boolean; remainingQuantity: number }) => [i.isFullyReceived, i.remainingQuantity])).toEqual([
        [true, 0],
        [false, 2],
      ]);
      expect(res.body.allItemsReceived).toBe(false);
      expect(res.body.totalReceivedQuantity).toBe(13);

      await setState(doc.id, 'IN_PROGRESS', [10, 5]);
      expect((await api('get', `/${doc.id}`)).body.allItemsReceived).toBe(true);
    });

    it('FR-23 an unknown id is 404 NOT_FOUND; a non-UUID id is 400', async () => {
      expect((await api('get', `/${randomUUID()}`)).body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
      expect((await api('get', '/nope')).status).toBe(400);
    });
  });

  describe('list (FR-20)', () => {
    it('T-DOC-14 FR-20 lists newest first as summaries with totals and pagination meta', async () => {
      const older = await draft(100, 50);
      const newer = await draft(7);
      await setState(older.id, 'IN_PROGRESS', [30, 0]);

      const res = await api('get', '', 'operator').query({ pageSize: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          {
            id: newer.id,
            documentNumber: `RCV-${year}-000002`,
            supplierName: 'PT Sumber Beku',
            referenceNumber: null,
            expectedDate: null,
            status: 'DRAFT',
            itemCount: 1,
            totalExpectedQuantity: 7,
            totalReceivedQuantity: 0,
            createdAt: isoDate,
            createdBy: { id: users.supervisor.id, fullName: 'supervisor' },
          },
        ],
        meta: { page: 1, pageSize: 1, totalItems: 2, totalPages: 2 },
      });
      const second = (await api('get').query({ page: 2, pageSize: 1 })).body.data[0];
      expect(second).toMatchObject({ id: older.id, status: 'IN_PROGRESS', itemCount: 2, totalExpectedQuantity: 150, totalReceivedQuantity: 30 });
    });

    it('T-DOC-14 FR-20 filters by status and searches number, supplier and reference in any case, literally', async () => {
      const a = (await create({ supplierName: 'PT Sumber Beku', referenceNumber: 'SJ-2026-10-0042' })).body;
      const b = (await create({ supplierName: '100% Fresh Farms' })).body;
      const c = (await create({ supplierName: 'Ocean Catch', items: lines(1) })).body;
      await setState(c.id, 'OPEN');

      const ids = async (query: Record<string, string>) =>
        (await api('get').query(query)).body.data.map((d: { id: string }) => d.id);

      expect(await ids({ status: 'OPEN' })).toEqual([c.id]);
      expect(await ids({ status: 'DRAFT' })).toEqual([b.id, a.id]);
      expect(await ids({ search: 'sumber' })).toEqual([a.id]);
      expect(await ids({ search: 'sj-2026' })).toEqual([a.id]);
      expect(await ids({ search: `rcv-${year}-000002` })).toEqual([b.id]);
      expect(await ids({ search: '%' })).toEqual([b.id]);
      expect(await ids({ search: '   ' })).toEqual([c.id, b.id, a.id]);
      expect(await ids({ status: 'DRAFT', search: 'ocean' })).toEqual([]);
    });

    it.each([
      [{ status: 'DONE' }, 'status'],
      [{ search: 's'.repeat(101) }, 'search'],
      [{ pageSize: 101 }, 'pageSize'],
      [{ foo: 'bar' }, 'foo'],
    ])('T-DOC-14 query %p is 400 VALIDATION_ERROR naming %s', async (query, field) => {
      const res = await api('get').query(query);

      expect(res.status).toBe(400);
      expect(new Set(fieldsOf(res))).toEqual(new Set([field]));
    });
  });

  describe('lines (FR-24–FR-26, BR-05, BR-06, BR-10, BR-16)', () => {
    it('FR-24 adds a line to a DRAFT and returns the whole document', async () => {
      const doc = await draft(100);

      const res = await api('post', `/${doc.id}/items`).send({ productId: products[1].id, expectedQuantity: 25 });

      expect(res.status).toBe(201);
      expect(res.body.items.map((i: { product: { sku: string }; expectedQuantity: number }) => [i.product.sku, i.expectedQuantity])).toEqual([
        ['AAA-001', 100],
        ['BBB-002', 25],
      ]);
      expect(res.body).toMatchObject({ itemCount: 2, totalExpectedQuantity: 125 });
    });

    it('T-DOC-02 AC-03.2 BR-06 adding a product already on the document is 409 and nothing changes', async () => {
      const doc = await draft(100);
      const before = await snapshot(doc.id);

      const res = await api('post', `/${doc.id}/items`).send({ productId: products[0].id, expectedQuantity: 5 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_PRODUCT_IN_DOCUMENT');
      expect(await snapshot(doc.id)).toEqual(before);
    });

    it('T-DOC-05 BR-16 adding an unknown product is 422 PRODUCT_NOT_FOUND', async () => {
      const doc = await draft(100);

      const res = await api('post', `/${doc.id}/items`).send({ productId: randomUUID(), expectedQuantity: 5 });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
      expect(await prisma.receivingItem.count()).toBe(1);
    });

    it('FR-25 changes a line\'s expected quantity and returns the whole document', async () => {
      const doc = await draft(100, 50);

      const res = await api('patch', `/${doc.id}/items/${doc.items[1].id}`).send({ expectedQuantity: 75 });

      expect(res.status).toBe(200);
      expect(res.body.items[1]).toMatchObject({ id: doc.items[1].id, expectedQuantity: 75, remainingQuantity: 75 });
      expect(res.body.totalExpectedQuantity).toBe(175);
    });

    it.each([[0], [1_000_001], [2.5], [undefined]])('T-DOC-03 BR-05 changing expectedQuantity to %p is 400', async (expectedQuantity) => {
      const doc = await draft(100);

      const res = await api('patch', `/${doc.id}/items/${doc.items[0].id}`).send({ expectedQuantity });

      expect(res.status).toBe(400);
      expect(fieldsOf(res)).toEqual(expect.arrayContaining(['expectedQuantity']));
    });

    it('FR-26 removes a line: 204 and the line is gone', async () => {
      const doc = await draft(100, 50);

      const res = await api('delete', `/${doc.id}/items/${doc.items[0].id}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect((await api('get', `/${doc.id}`)).body.items.map((i: { id: string }) => i.id)).toEqual([doc.items[1].id]);
    });

    it('FR-25 FR-26 a line of another document is 404 NOT_FOUND on change and remove; nothing changes', async () => {
      const doc = await draft(100);
      const other = await draft(50);
      const before = await snapshot(other.id);

      const patch = await api('patch', `/${doc.id}/items/${other.items[0].id}`).send({ expectedQuantity: 1 });
      const remove = await api('delete', `/${doc.id}/items/${other.items[0].id}`);

      expect([patch.status, remove.status]).toEqual([404, 404]);
      expect(patch.body.error.code).toBe('NOT_FOUND');
      expect(await snapshot(other.id)).toEqual(before);
    });

    it('FR-24 adding a line to an unknown document is 404 NOT_FOUND', async () => {
      const res = await api('post', `/${randomUUID()}/items`).send({ productId: products[0].id, expectedQuantity: 1 });

      expect(res.status).toBe(404);
    });

    it.each(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
      'T-DOC-06 AC-03.5 BR-10 add, change and remove on %s are 409 INVALID_DOCUMENT_STATUS; nothing changes',
      async (status) => {
        const doc = await draft(100);
        await setState(doc.id, status);
        const before = await snapshot(doc.id);

        const results = [
          await api('post', `/${doc.id}/items`).send({ productId: products[1].id, expectedQuantity: 5 }),
          await api('patch', `/${doc.id}/items/${doc.items[0].id}`).send({ expectedQuantity: 5 }),
          await api('delete', `/${doc.id}/items/${doc.items[0].id}`),
        ];

        for (const res of results) {
          expect({ status: res.status, code: res.body.error.code }).toEqual({ status: 409, code: 'INVALID_DOCUMENT_STATUS' });
        }
        expect(await snapshot(doc.id)).toEqual(before);
      },
    );
  });

  describe('open (FR-27)', () => {
    it('T-DOC-07 AC-03.4 BR-11 opening a DRAFT without lines is 422 DOCUMENT_HAS_NO_ITEMS; it stays DRAFT', async () => {
      const doc = await draft();

      const res = await action(doc.id, 'open');

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('DOCUMENT_HAS_NO_ITEMS');
      expect((await snapshot(doc.id)).status).toBe('DRAFT');
    });

    it('T-DOC-08 AC-03.5 FR-27 opens a DRAFT with lines: OPEN with openedAt and openedBy', async () => {
      const doc = await draft(100);

      const res = await action(doc.id, 'open');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: doc.id, status: 'OPEN', openedAt: isoDate, openedBy: { id: users.supervisor.id, fullName: 'supervisor' } });
      expect(res.body.updatedAt >= doc.updatedAt).toBe(true);
    });

    it.each(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
      'BR-11 opening a %s document is 409 INVALID_STATUS_TRANSITION',
      async (status) => {
        const doc = await draft(100);
        await setState(doc.id, status);

        const res = await action(doc.id, 'open');

        expect(res.status).toBe(409);
        expect(res.body.error).toEqual({
          code: 'INVALID_STATUS_TRANSITION',
          message: expect.any(String),
          details: { currentStatus: status, action: 'OPEN' },
        });
      },
    );

    it('FR-27 opening an unknown document is 404 NOT_FOUND', async () => {
      expect((await action(randomUUID(), 'open')).status).toBe(404);
    });
  });

  describe('complete (FR-28)', () => {
    it('T-DOC-09 AC-05.1 FR-28 completes an IN_PROGRESS document whose lines are all fully received', async () => {
      const doc = await draft(100, 50);
      await setState(doc.id, 'IN_PROGRESS', [100, 50]);

      const res = await action(doc.id, 'complete');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'COMPLETED',
        allItemsReceived: true,
        completedAt: isoDate,
        completedBy: { id: users.supervisor.id, fullName: 'supervisor' },
      });
      const again = await receive(app, users.operator.token, doc.id, doc.items[0].id, 1);
      expect({ status: again.status, code: again.body.error.code }).toEqual({ status: 409, code: 'INVALID_DOCUMENT_STATUS' });
    });

    it('T-DOC-10 AC-05.2 BR-11 a line outstanding is 422 ITEMS_NOT_FULLY_RECEIVED listing it; status unchanged', async () => {
      const doc = await draft(100, 50);
      await setState(doc.id, 'IN_PROGRESS', [100, 49]);
      const before = await snapshot(doc.id);

      const res = await action(doc.id, 'complete');

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: 'ITEMS_NOT_FULLY_RECEIVED',
        message: '1 of 2 items are not fully received.',
        details: { incompleteItemIds: [doc.items[1].id] },
      });
      expect(await snapshot(doc.id)).toEqual(before);
    });

    it.each(['DRAFT', 'OPEN', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
      'T-DOC-11 AC-05.3 BR-11 completing a %s document is 409 INVALID_STATUS_TRANSITION',
      async (status) => {
        const doc = await draft(100);
        await setState(doc.id, status);

        const res = await action(doc.id, 'complete');

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      },
    );
  });

  describe('cancel (FR-29, BR-15)', () => {
    it.each(['DRAFT', 'OPEN'] as const)('T-DOC-12 AC-05.4 FR-29 cancels a %s document with its reason, time and user', async (status) => {
      const doc = await draft(100);
      await setState(doc.id, status);

      const res = await action(doc.id, 'cancel', { reason: '  Supplier cancelled shipment  ' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Supplier cancelled shipment',
        cancelledAt: isoDate,
        cancelledBy: { id: users.supervisor.id, fullName: 'supervisor' },
      });
    });

    it.each(['IN_PROGRESS', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
      'T-DOC-12 AC-05.5 BR-15 cancelling a %s document is 409 INVALID_STATUS_TRANSITION; nothing changes',
      async (status) => {
        const doc = await draft(100);
        await setState(doc.id, status, status === 'CANCELLED' ? [] : [40]);
        const before = await snapshot(doc.id);

        const res = await action(doc.id, 'cancel', { reason: 'Too late' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
        expect(await snapshot(doc.id)).toEqual(before);
      },
    );

    it.each([[{}], [{ reason: '' }], [{ reason: '   ' }], [{ reason: ' ab ' }], [{ reason: 'r'.repeat(501) }], [{ reason: 5 }]])(
      'T-DOC-13 AC-05.6 BR-15 cancel with %p is 400 VALIDATION_ERROR naming reason; nothing changes',
      async (body) => {
        const doc = await draft(100);

        const res = await action(doc.id, 'cancel', body);

        expect(res.status).toBe(400);
        expect(fieldsOf(res)).toEqual(expect.arrayContaining(['reason']));
        expect((await snapshot(doc.id)).status).toBe('DRAFT');
      },
    );

    it('BR-14 two parallel cancels of the same document: exactly one 200 and one 409', async () => {
      const doc = await draft(100);

      const results = await Promise.all([action(doc.id, 'cancel', { reason: 'first' }), action(doc.id, 'cancel', { reason: 'second' })]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = results.find((r) => r.status === 200)!.body.cancelReason;
      expect((await snapshot(doc.id)).cancelReason).toBe(winner);
    });
  });

  describe('close short (FR-35, BR-17)', () => {
    it('T-CLS-01 AC-07.1 FR-35 closes short with 70 of 100 received; shortage kept, stock untouched', async () => {
      const doc = await draft(100);
      await setState(doc.id, 'IN_PROGRESS', [70]);
      const stock = async () => ({ balances: await prisma.inventoryBalance.findMany(), ledger: await prisma.inventoryTransaction.findMany() });
      const stockBefore = await stock();

      const res = await action(doc.id, 'close-short', { reason: ' Supplier out of stock ' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'CLOSED_SHORT',
        closeShortReason: 'Supplier out of stock',
        closedShortAt: isoDate,
        closedShortBy: { id: users.supervisor.id, fullName: 'supervisor' },
        allItemsReceived: false,
      });
      expect(res.body.items[0]).toMatchObject({ expectedQuantity: 100, receivedQuantity: 70, remainingQuantity: 30 });
      expect(await stock()).toEqual(stockBefore);
      const again = await receive(app, users.operator.token, doc.id, doc.items[0].id, 1);
      expect({ status: again.status, code: again.body.error.code }).toEqual({ status: 409, code: 'INVALID_DOCUMENT_STATUS' });
    });

    it('T-CLS-02 AC-07.2 BR-11 closing short when every line is fully received is 422 NOTHING_SHORT', async () => {
      const doc = await draft(100);
      await setState(doc.id, 'IN_PROGRESS', [100]);

      const res = await action(doc.id, 'close-short', { reason: 'Nothing missing' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NOTHING_SHORT');
      expect((await snapshot(doc.id)).status).toBe('IN_PROGRESS');
    });

    it.each(['DRAFT', 'OPEN', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'] as const)(
      'T-CLS-03 AC-07.3 closing short a %s document is 409 INVALID_STATUS_TRANSITION',
      async (status) => {
        const doc = await draft(100);
        await setState(doc.id, status);

        const res = await action(doc.id, 'close-short', { reason: 'Supplier out of stock' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      },
    );

    it.each([[{ reason: '' }], [{ reason: 'ab' }], [{}]])('T-CLS-04 AC-07.4 BR-17 close short with %p is 400 naming reason', async (body) => {
      const doc = await draft(100);
      await setState(doc.id, 'IN_PROGRESS', [70]);

      const res = await action(doc.id, 'close-short', body);

      expect(res.status).toBe(400);
      expect(fieldsOf(res)).toEqual(expect.arrayContaining(['reason']));
      expect((await snapshot(doc.id)).status).toBe('IN_PROGRESS');
    });
  });

  describe('authorization (FR-03, spec §8)', () => {
    it('T-AUT-04 AC-01.4 FR-03 an operator gets 403 FORBIDDEN on every supervisor-only endpoint and nothing changes', async () => {
      const doc = await draft(100);
      const before = await snapshot(doc.id);
      const item = `/${doc.id}/items/${doc.items[0].id}`;

      const results = [
        await create({ supplierName: 'S' }, 'operator'),
        await api('post', `/${doc.id}/items`, 'operator').send({ productId: products[1].id, expectedQuantity: 5 }),
        await api('patch', item, 'operator').send({ expectedQuantity: 5 }),
        await api('delete', item, 'operator'),
        await api('post', `/${doc.id}/open`, 'operator'),
        await api('post', `/${doc.id}/complete`, 'operator'),
        await api('post', `/${doc.id}/close-short`, 'operator').send({ reason: 'Supplier out of stock' }),
        await api('post', `/${doc.id}/cancel`, 'operator').send({ reason: 'Supplier cancelled' }),
      ];

      expect(results.map((res) => [res.status, res.body.error?.code])).toEqual(results.map(() => [403, 'FORBIDDEN']));
      expect(await prisma.receivingDocument.count()).toBe(1);
      expect(await snapshot(doc.id)).toEqual(before);
    });

    it('FR-02 the list without a token is 401 UNAUTHENTICATED', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/receiving-documents');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });
});

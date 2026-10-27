import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUsersAndLogin, TestUsers } from './app';
import { assertInventoryConsistent, truncateAll } from './db';
import { createProducts, openDocument, receive, reverse } from './fixtures';

describe('inventory (US-06)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TestUsers;
  let products: { id: string; sku: string; name: string }[];

  beforeAll(async () => ({ app, prisma } = await createTestApp()));
  beforeEach(async () => {
    await truncateAll(prisma);
    users = await createUsersAndLogin(app, prisma);
    // Created out of SKU order, so the list's SKU sort is visible.
    products = await createProducts(prisma, ['CCC-003', 'AAA-001', 'BBB-002']);
  });
  afterEach(() => assertInventoryConsistent(prisma));
  afterAll(() => app.close());

  const get = (path: string, query: Record<string, string | number> = {}, as: keyof TestUsers = 'operator') =>
    request(app.getHttpServer()).get(`/api/v1/inventory${path}`).query(query).set('Authorization', `Bearer ${users[as].token}`);
  const fieldsOf = (res: request.Response) => res.body.error.details.fields.map((f: { field: string }) => f.field);
  const isoDate = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const product = (sku: string) => products.find((p) => p.sku === sku)!;

  // An opened document with one line of 100 for the product, and one receipt per quantity (by the operator).
  const receiveAll = async (sku: string, ...quantities: number[]) => {
    const doc = await openDocument(app, users.supervisor.token, [{ productId: product(sku).id, expectedQuantity: 100 }]);
    const receipts = [];
    for (const q of quantities) receipts.push((await receive(app, users.operator.token, doc.id, doc.items[0].id, q)).body.receipt);
    return { doc, receipts };
  };

  describe('balances (FR-40)', () => {
    it('T-INV-01 AC-06.1 FR-40 receipts of 40 and 60 show on-hand 100; products without stock show 0', async () => {
      await receiveAll('AAA-001', 40, 60);

      const res = await get('');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { productId: product('AAA-001').id, sku: 'AAA-001', name: 'Product AAA-001', unitOfMeasure: 'CTN', quantityOnHand: 100, updatedAt: isoDate },
        expect.objectContaining({ sku: 'BBB-002', quantityOnHand: 0 }),
        expect.objectContaining({ sku: 'CCC-003', quantityOnHand: 0 }),
      ]);
      const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { productId: product('AAA-001').id } });
      expect(res.body.data[0].updatedAt).toBe(balance.updatedAt.toISOString()); // "last updated" is the balance's
    });

    it('FR-40 is sorted by SKU and paginated', async () => {
      const first = await get('', { pageSize: 2 });
      const second = await get('', { pageSize: 2, page: 2 });

      expect(first.body.data.map((b: { sku: string }) => b.sku)).toEqual(['AAA-001', 'BBB-002']);
      expect(first.body.meta).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
      expect(second.body.data.map((b: { sku: string }) => b.sku)).toEqual(['CCC-003']);
    });

    it('FR-40 searches SKU or name in any case, with % and _ taken literally', async () => {
      await prisma.product.create({ data: { sku: 'JUI-100', name: '100% Juice', unitOfMeasure: 'PCS', balance: { create: {} } } });
      const skus = async (search: string) => (await get('', { search })).body.data.map((b: { sku: string }) => b.sku);

      expect(await skus('bbb')).toEqual(['BBB-002']);
      expect(await skus('juice')).toEqual(['JUI-100']);
      expect(await skus('%')).toEqual(['JUI-100']);
      expect(await skus('_')).toEqual([]);
      expect(await skus('  ')).toHaveLength(4);
    });
  });

  describe('transactions (FR-41)', () => {
    it('T-INV-02 AC-06.2 FR-41 filtered by product: two RECEIPT rows newest first with document number and user', async () => {
      const { doc, receipts } = await receiveAll('AAA-001', 40, 60);
      await receiveAll('BBB-002', 5); // another product, filtered out

      const res = await get('/transactions', { productId: product('AAA-001').id });

      expect(res.status).toBe(200);
      const row = (quantityChange: number, balanceAfter: number, receiptId: string) => ({
        id: expect.stringMatching(/^\d+$/),
        type: 'RECEIPT',
        product: { id: product('AAA-001').id, sku: 'AAA-001', name: 'Product AAA-001' },
        quantityChange,
        balanceAfter,
        receiptId,
        receiptReversalId: null,
        receivingDocument: { id: doc.id, documentNumber: doc.documentNumber },
        createdBy: { id: users.operator.id, fullName: 'operator' },
        createdAt: isoDate,
      });
      expect(res.body.data).toEqual([row(60, 100, receipts[1].id), row(40, 40, receipts[0].id)]);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 20, totalItems: 2, totalPages: 1 });
    });

    it('FR-41 FR-37 a reversal is a negative RECEIPT_REVERSAL row by the supervisor, newest first', async () => {
      const { doc, receipts } = await receiveAll('AAA-001', 40, 60);
      const detail = (await reverse(app, users.supervisor.token, doc.id, receipts[1].id)).body;

      const [latest] = (await get('/transactions')).body.data;

      expect(latest).toMatchObject({
        type: 'RECEIPT_REVERSAL',
        quantityChange: -60,
        balanceAfter: 40,
        receiptId: null,
        receiptReversalId: detail.receipts[1].reversal.id,
        createdBy: { id: users.supervisor.id, fullName: 'supervisor' },
      });
    });

    it('FR-41 filters by receiving document', async () => {
      await receiveAll('AAA-001', 10);
      const { doc } = await receiveAll('AAA-001', 20, 30);

      const res = await get('/transactions', { receivingDocumentId: doc.id });

      expect(res.body.data.map((t: { quantityChange: number }) => t.quantityChange)).toEqual([30, 20]);
    });

    it('FR-41 D-25 from is inclusive and to is exclusive', async () => {
      const { doc } = await receiveAll('AAA-001', 10);
      await new Promise((resolve) => setTimeout(resolve, 5)); // the bound below has ms precision: keep the rows apart
      await receive(app, users.operator.token, doc.id, doc.items[0].id, 20);
      const newer = await prisma.inventoryTransaction.findFirstOrThrow({ orderBy: { id: 'desc' } });
      const at = newer.createdAt.toISOString();
      const changes = async (query: Record<string, string>) =>
        (await get('/transactions', query)).body.data.map((t: { quantityChange: number }) => t.quantityChange);

      expect(await changes({ from: at })).toEqual([20]);
      expect(await changes({ to: at })).toEqual([10]);
      expect(await changes({ from: at, to: at })).toEqual([]);
      expect(await changes({ from: '2000-01-01T07:00:00+07:00' })).toEqual([20, 10]);
    });

    it('FR-41 D-25 an unknown product or document gives an empty page, not an error', async () => {
      await receiveAll('AAA-001', 10);

      const res = await get('/transactions', { productId: '00000000-0000-4000-8000-000000000000' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } });
    });

    it.each([
      ['productId', 'nope'],
      ['receivingDocumentId', 'nope'],
      ['from', '2026-10-27'],
      ['from', '2026-10-27T10:00:00'],
      ['to', 'yesterday'],
      ['to', '2026-02-30T00:00:00Z'],
      ['to', '2026-10-27T10:00:00.0005Z'],
    ])('FR-41 D-25 %s=%p is 400 VALIDATION_ERROR naming it', async (field, value) => {
      const res = await get('/transactions', { [field]: value });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(fieldsOf(res)).toEqual(expect.arrayContaining([field]));
    });
  });

  it('T-INV-03 AC-06.3 BR-12 for every product, on-hand equals the sum of its ledger changes', async () => {
    const { doc, receipts } = await receiveAll('AAA-001', 40, 60);
    await reverse(app, users.supervisor.token, doc.id, receipts[0].id);
    await receiveAll('BBB-002', 7, 3);

    const balances = (await get('')).body.data as { productId: string; quantityOnHand: number }[];

    for (const { productId, quantityOnHand } of balances) {
      const ledger = (await get('/transactions', { productId, pageSize: 100 })).body.data as { quantityChange: number }[];
      expect(ledger.reduce((sum, t) => sum + t.quantityChange, 0)).toBe(quantityOnHand);
    }
    expect(balances.map((b) => b.quantityOnHand)).toEqual([60, 10, 0]);
  });

  it('FR-02 both endpoints need a token', async () => {
    for (const path of ['/api/v1/inventory', '/api/v1/inventory/transactions']) {
      expect((await request(app.getHttpServer()).get(path)).status).toBe(401);
    }
  });
});

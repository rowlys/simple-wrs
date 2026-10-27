import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, createUsersAndLogin, TestUsers } from './app';
import { truncateAll } from './db';
import { PrismaService } from '../src/prisma/prisma.service';

describe('products (US-02)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TestUsers;

  beforeAll(async () => ({ app, prisma } = await createTestApp()));
  beforeEach(async () => {
    await truncateAll(prisma);
    users = await createUsersAndLogin(app, prisma);
  });
  afterAll(() => app.close());

  type As = keyof TestUsers;
  const create = (body: object, as: As = 'supervisor') =>
    request(app.getHttpServer()).post('/api/v1/products').set('Authorization', `Bearer ${users[as].token}`).send(body);
  const list = (query: Record<string, string | number> = {}, as: As = 'operator') =>
    request(app.getHttpServer()).get('/api/v1/products').query(query).set('Authorization', `Bearer ${users[as].token}`);
  const get = (id: string, as: As = 'operator') =>
    request(app.getHttpServer()).get(`/api/v1/products/${id}`).set('Authorization', `Bearer ${users[as].token}`);

  const valid = { sku: 'frz-chk-001', name: 'Frozen Chicken Breast 1kg', unitOfMeasure: 'CTN' };
  const isoDate = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const fieldsOf = (res: request.Response) => res.body.error.details.fields.map((f: { field: string }) => f.field);

  // Inserts products directly with an explicit created_at (and their 0 balance), to control the order.
  const seed = (rows: { sku: string; name: string; createdAt?: Date }[]) =>
    prisma.$transaction(
      rows.map((r) =>
        prisma.product.create({
          data: { ...r, unitOfMeasure: 'PCS', balance: { create: { quantityOnHand: 0 } } },
        }),
      ),
    );

  describe('create (FR-11, FR-12, BR-01–BR-03)', () => {
    it('T-PRD-01 AC-02.1 FR-12 creates frz-chk-001 as FRZ-CHK-001 with a balance of 0', async () => {
      const res = await create(valid);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        sku: 'FRZ-CHK-001',
        name: 'Frozen Chicken Breast 1kg',
        unitOfMeasure: 'CTN',
        description: null,
        quantityOnHand: 0,
        createdAt: isoDate,
        updatedAt: isoDate,
      });
      const row = await prisma.product.findUniqueOrThrow({ where: { id: res.body.id }, include: { balance: true } });
      expect(row.sku).toBe('FRZ-CHK-001');
      expect(row.balance?.quantityOnHand).toBe(0);
      expect(await prisma.inventoryTransaction.count()).toBe(0);
    });

    it('T-PRD-01 BR-03 trims name, unit and description and stores the description', async () => {
      const res = await create({ sku: '  frz-1  ', name: '  Chicken  ', unitOfMeasure: ' kg ', description: '  Frozen, 1kg  ' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ sku: 'FRZ-1', name: 'Chicken', unitOfMeasure: 'kg', description: 'Frozen, 1kg' });
    });

    it.each([[null], [''], ['   ']])('BR-03 a description of %p is stored as null', async (description) => {
      const res = await create({ ...valid, description });

      expect(res.status).toBe(201);
      expect(res.body.description).toBeNull();
      expect((await prisma.product.findUniqueOrThrow({ where: { id: res.body.id } })).description).toBeNull();
    });

    it('T-PRD-02 AC-02.2 BR-02 frz-chk-001 after FRZ-CHK-001 is 409 DUPLICATE_SKU and nothing is added', async () => {
      expect((await create({ ...valid, sku: 'FRZ-CHK-001' })).status).toBe(201);

      const res = await create({ ...valid, sku: 'frz-chk-001', name: 'Another' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'DUPLICATE_SKU', message: expect.any(String) } });
      expect(await prisma.product.count()).toBe(1);
      expect(await prisma.inventoryBalance.count()).toBe(1);
    });

    it('T-PRD-02 BR-02 two parallel creates of the same SKU give exactly one 201 and one 409', async () => {
      const results = await Promise.all([create(valid), create({ ...valid, sku: 'FRZ-CHK-001' })]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.error.code).toBe('DUPLICATE_SKU');
      expect(await prisma.product.count()).toBe(1);
      expect(await prisma.inventoryBalance.count()).toBe(1);
    });

    it.each([['AB'], ['-ABC'], ['AB C'], ['A'.repeat(51)], ['   '], ['ab_c'], [123], [undefined], ['ßku-1'], ['ſku-1'], ['ıabc']])(
      'T-PRD-03 AC-02.3 BR-01 SKU %p is 400 VALIDATION_ERROR naming sku',
      async (sku) => {
        const res = await create({ ...valid, sku });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(fieldsOf(res)).toContain('sku');
        expect(new Set(fieldsOf(res))).toEqual(new Set(['sku']));
        expect(await prisma.product.count()).toBe(0);
      },
    );

    it('T-PRD-03 BR-01 a 50-character SKU and a 3-character SKU with surrounding spaces are accepted', async () => {
      expect((await create({ ...valid, sku: 'a'.repeat(50) })).body.sku).toBe('A'.repeat(50));
      expect((await create({ ...valid, sku: '  a-1  ' })).body.sku).toBe('A-1');
    });

    it.each([
      ['name', ''],
      ['name', '   '],
      ['name', 'n'.repeat(201)],
      ['name', undefined],
      ['unitOfMeasure', ''],
      ['unitOfMeasure', 'u'.repeat(21)],
      ['unitOfMeasure', undefined],
      ['description', 'd'.repeat(1001)],
      ['description', 5],
    ])('T-PRD-03 BR-03 %s = %p is 400 VALIDATION_ERROR naming the field', async (field, value) => {
      const res = await create({ ...valid, [field]: value });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(new Set(fieldsOf(res))).toEqual(new Set([field]));
      expect(await prisma.product.count()).toBe(0);
    });

    it('T-PRD-03 BR-03 upper bounds are accepted (name 200, unit 20, description 1000)', async () => {
      const res = await create({ ...valid, name: 'n'.repeat(200), unitOfMeasure: 'u'.repeat(20), description: 'd'.repeat(1000) });

      expect(res.status).toBe(201);
    });

    it('T-PRD-03 spec §4.2 an unknown body field is 400 VALIDATION_ERROR naming it', async () => {
      const res = await create({ ...valid, quantityOnHand: 5 });

      expect(res.status).toBe(400);
      expect(fieldsOf(res)).toEqual(['quantityOnHand']);
      expect(await prisma.product.count()).toBe(0);
    });
  });

  describe('list (FR-10, spec §4.4)', () => {
    it('T-PRD-04 AC-02.4 FR-10 search chk matches SKU or name in any case and nothing else', async () => {
      await seed([
        { sku: 'FRZ-CHK-001', name: 'Frozen chicken' },
        { sku: 'DRY-RICE-01', name: 'Rice with CHK flavour' },
        { sku: 'DRY-SALT-01', name: 'Sea salt' },
        { sku: 'XCHKX', name: 'Something' },
      ]);

      for (const search of ['chk', 'CHK', 'cHk']) {
        const res = await list({ search });
        expect(res.status).toBe(200);
        expect(res.body.data.map((p: { sku: string }) => p.sku).sort()).toEqual(['DRY-RICE-01', 'FRZ-CHK-001', 'XCHKX']);
        expect(res.body.meta.totalItems).toBe(3);
      }
    });

    it.each([['%', ['100% juice']], ['_', ['snake_case']], ['\\', ['back\\slash']], ['0%', ['100% juice']]])(
      'T-PRD-04 FR-10 search %p is matched literally, not as a wildcard',
      async (search, names) => {
        await seed([
          { sku: 'P-1', name: '100% juice' },
          { sku: 'P-2', name: 'snake_case' },
          { sku: 'P-3', name: 'back\\slash' },
          { sku: 'P-4', name: 'plain' },
        ]);

        const res = await list({ search });

        expect(res.status).toBe(200);
        expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(names);
      },
    );

    it.each([[''], ['   ']])('FR-10 search %p means no filter', async (search) => {
      await seed([{ sku: 'P-1', name: 'a' }, { sku: 'P-2', name: 'b' }]);

      const res = await list({ search });

      expect(res.status).toBe(200);
      expect(res.body.meta.totalItems).toBe(2);
    });

    it('T-PRD-04 FR-10 lists newest first, ties on created_at broken by id descending, with quantityOnHand', async () => {
      await seed([{ sku: 'OLD-1', name: 'old', createdAt: new Date('2026-01-01T00:00:00Z') }]);
      await seed([{ sku: 'NEW-1', name: 'new', createdAt: new Date('2026-03-01T00:00:00Z') }]);
      // Identical created_at (as for rows created in one transaction), so only the id orders these three.
      const tie = new Date('2026-06-01T00:00:00Z');
      const same = await seed(['SAME-1', 'SAME-2', 'SAME-3'].map((sku) => ({ sku, name: 's', createdAt: tie })));
      const sameIdsDesc = same.map((p) => p.id).sort().reverse();
      const expected = [...sameIdsDesc, ...(await prisma.product.findMany({ where: { sku: { in: ['NEW-1', 'OLD-1'] } }, orderBy: { createdAt: 'desc' } })).map((p) => p.id)];

      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual(expected);
      expect(res.body.data[0]).toEqual({
        id: sameIdsDesc[0],
        sku: expect.any(String),
        name: 's',
        unitOfMeasure: 'PCS',
        description: null,
        quantityOnHand: 0,
        createdAt: isoDate,
        updatedAt: isoDate,
      });

      // Paging through with pageSize 2 returns every product exactly once, in the same order.
      const paged: string[] = [];
      for (const page of [1, 2, 3]) {
        paged.push(...(await list({ page, pageSize: 2 })).body.data.map((p: { id: string }) => p.id));
      }
      expect(paged).toEqual(expected);
    });

    it('T-PRD-04 spec §4.4 pagination meta: 3 products with pageSize 2', async () => {
      await seed([{ sku: 'P-1', name: 'a' }, { sku: 'P-2', name: 'b' }, { sku: 'P-3', name: 'c' }]);

      const first = await list({ pageSize: 2 });
      const second = await list({ page: 2, pageSize: 2 });
      const beyond = await list({ page: 3, pageSize: 2 });

      expect(first.body.meta).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
      expect(first.body.data).toHaveLength(2);
      expect(second.body.meta).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
      expect(second.body.data).toHaveLength(1);
      expect(beyond.body).toEqual({ data: [], meta: { page: 3, pageSize: 2, totalItems: 3, totalPages: 2 } });
    });

    it('NFR-04 spec §4.4 defaults to page 1, pageSize 20; an empty list has 0 pages', async () => {
      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } });
    });

    it('NFR-04 spec §4.4 pageSize 100 is allowed', async () => {
      expect((await list({ pageSize: 100 })).body.meta.pageSize).toBe(100);
    });

    it('NFR-04 D-15 page 1000000 (the maximum) is allowed and returns an empty page', async () => {
      const res = await list({ page: 1000000, pageSize: 100 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1000000, pageSize: 100, totalItems: 0, totalPages: 0 } });
    });

    it.each([
      [{ pageSize: 101 }, 'pageSize'],
      [{ pageSize: 0 }, 'pageSize'],
      [{ pageSize: 'abc' }, 'pageSize'],
      [{ page: 0 }, 'page'],
      [{ page: 1.5 }, 'page'],
      [{ page: 'abc' }, 'page'],
      [{ page: '1e18' }, 'page'],
      [{ page: 1000001 }, 'page'],
      [{ search: 's'.repeat(101) }, 'search'],
      [{ foo: 'bar' }, 'foo'],
    ])('T-PRD-04 spec §4.4 query %p is 400 VALIDATION_ERROR naming %s', async (query, field) => {
      const res = await list(query);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(new Set(fieldsOf(res))).toEqual(new Set([field]));
    });
  });

  describe('get (FR-13)', () => {
    it('FR-13 returns the product with quantityOnHand', async () => {
      const created = (await create({ ...valid, description: 'Frozen' })).body;

      const res = await get(created.id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(created);
    });

    it('FR-13 quantityOnHand comes from the balance row', async () => {
      const created = (await create(valid)).body;
      await prisma.inventoryBalance.update({ where: { productId: created.id }, data: { quantityOnHand: 7 } });

      expect((await get(created.id)).body.quantityOnHand).toBe(7);
      expect((await list()).body.data[0].quantityOnHand).toBe(7);
    });

    it('FR-13 an unknown id is 404 NOT_FOUND', async () => {
      const res = await get(randomUUID());

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    });

    it('FR-13 a non-UUID id is 400 VALIDATION_ERROR', async () => {
      const res = await get('not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('authorization (FR-03, spec §8)', () => {
    it('T-AUT-04 AC-02.5 FR-03 an operator cannot create a product: 403 FORBIDDEN, nothing created', async () => {
      const res = await create(valid, 'operator');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
      expect(await prisma.product.count()).toBe(0);
      expect(await prisma.inventoryBalance.count()).toBe(0);
    });

    it('AC-02.5 FR-10 FR-13 an operator can list and view products', async () => {
      const created = (await create(valid)).body;

      expect((await list({}, 'operator')).body.data).toEqual([created]);
      expect((await get(created.id, 'operator')).status).toBe(200);
    });

    it.each([
      ['GET', '/api/v1/products'],
      ['POST', '/api/v1/products'],
      ['GET', `/api/v1/products/${randomUUID()}`],
    ])('FR-03 %s %s without a token is 401 UNAUTHENTICATED', async (method, path) => {
      const res = await (method === 'GET' ? request(app.getHttpServer()).get(path) : request(app.getHttpServer()).post(path).send(valid));

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(await prisma.product.count()).toBe(0);
    });
  });
});

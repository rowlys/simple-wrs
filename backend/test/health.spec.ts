import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';

describe('health (FR-50, US-09)', () => {
  describe('database reachable', () => {
    let app: INestApplication;
    beforeAll(async () => ({ app } = await createTestApp()));
    afterAll(() => app.close());

    it('AC-09.1 T-HLT-01 GET /health returns 200 {status: ok, database: up} without a token', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', database: 'up' });
    });

    it('FR-50 spec §4.1 /health has no /api/v1 prefix', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.status).toBe(404);
    });
  });

  describe('database unreachable', () => {
    let app: INestApplication;
    // A real PrismaClient pointed at a port nothing listens on; no mocks.
    beforeAll(async () => ({ app } = await createTestApp({ config: { databaseUrl: 'postgresql://wrs:x@127.0.0.1:1/wrs_test' } })));
    afterAll(() => app.close());

    it('AC-09.2 T-HLT-01 GET /health returns 503 {status: error, database: down}', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'error', database: 'down' });
    });
  });
});

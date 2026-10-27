import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp } from './app';

const OPENAPI = join(__dirname, '..', '..', 'docs', 'openapi.yaml');

// "METHOD /path" for every operation under `paths:` (hand-written file: two-space paths, four-space methods),
// with OpenAPI `{param}` written as Express `:param`.
function documentedOperations(): string[] {
  const paths = readFileSync(OPENAPI, 'utf8').split(/^components:/m)[0];
  const operations: string[] = [];
  let path = '';
  for (const line of paths.split(/\r?\n/)) {
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) path = p[1].replace(/\{(\w+)\}/g, ':$1');
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m) operations.push(`${m[1].toUpperCase()} ${path.startsWith('/health') ? path : `/api/v1${path}`}`);
  }
  return operations.sort();
}

describe('API contract (NFR-07)', () => {
  let app: INestApplication;

  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(() => app.close());

  it('T-API-01 NFR-07 every operation in openapi.yaml is routed and every route is documented', () => {
    const router = app.getHttpAdapter().getInstance().router as {
      stack: { route?: { path: string; methods: Record<string, boolean> } }[];
    };
    const routed = router.stack
      .filter((layer) => layer.route)
      .flatMap(({ route }) => Object.keys(route!.methods).map((method) => `${method.toUpperCase()} ${route!.path}`))
      .sort();

    expect(documentedOperations()).toHaveLength(20); // spec §4.1
    expect(routed).toEqual(documentedOperations());
  });

  it('NFR-07 spec §0 Swagger UI is served read-only at /api/docs without a token, from docs/openapi.yaml', async () => {
    const page = await request(app.getHttpServer()).get('/api/docs/');
    const spec = await request(app.getHttpServer()).get('/api/docs/openapi.yaml');

    expect(page.status).toBe(200);
    expect(page.text).toContain('swagger-ui');
    expect(spec.status).toBe(200);
    expect(spec.text).toBe(readFileSync(OPENAPI, 'utf8'));
    // The UI loads our contract, not the petstore default.
    expect((await request(app.getHttpServer()).get('/api/docs/swagger-ui-init.js')).text).toContain('"url": "/api/docs/openapi.yaml"');
  });
});

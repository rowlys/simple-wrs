import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';
import { createUser, truncateAll } from './db';
import { Roles } from '../src/common/auth/decorators';
import { PrismaService } from '../src/prisma/prisma.service';

// No supervisor-only endpoint exists yet, so this test-only controller runs through the real global
// JwtAuthGuard + RolesGuard + exception filter. T-AUT-04 proper (every real endpoint) comes with those endpoints.
@Controller('roles-test')
class RolesTestController {
  @Post('supervisor-only')
  @Roles('SUPERVISOR')
  supervisorOnly() {
    return { ok: true };
  }

  @Get('any-role')
  anyRole() {
    return { ok: true };
  }
}

describe('authorization (FR-03, spec §8)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ controllers: [RolesTestController] }));
    await truncateAll(prisma);
    await createUser(prisma, { username: 'operator', password: 'op-pass', role: 'OPERATOR' });
    await createUser(prisma, { username: 'supervisor', password: 'sup-pass', role: 'SUPERVISOR' });
    for (const [username, password] of [['operator', 'op-pass'], ['supervisor', 'sup-pass']]) {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username, password });
      tokens[username] = res.body.accessToken;
    }
  });
  afterAll(() => app.close());

  const call = (method: 'get' | 'post', path: string, user?: string) => {
    const req = request(app.getHttpServer())[method](`/api/v1/roles-test/${path}`);
    return user ? req.set('Authorization', `Bearer ${tokens[user]}`) : req;
  };

  it('AC-01.4 FR-03 an operator calling a @Roles(SUPERVISOR) handler gets 403 FORBIDDEN', async () => {
    const res = await call('post', 'supervisor-only', 'operator');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
  });

  it('FR-03 a supervisor may call a @Roles(SUPERVISOR) handler', async () => {
    const res = await call('post', 'supervisor-only', 'supervisor');
    expect(res.status).toBe(201);
  });

  it('FR-03 spec §8 a handler without @Roles allows any authenticated role', async () => {
    for (const user of ['operator', 'supervisor']) {
      const res = await call('get', 'any-role', user);
      expect({ user, status: res.status }).toEqual({ user, status: 200 });
    }
  });

  it('FR-02 authentication runs before the role check: no token on a role-protected handler gets 401', async () => {
    const res = await call('post', 'supervisor-only');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

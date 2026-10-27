import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestApp } from './app';
import { createUser, truncateAll } from './db';
import { PrismaService } from '../src/prisma/prisma.service';

describe('auth (US-01)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let operatorId: string;

  beforeAll(async () => ({ app, prisma } = await createTestApp()));
  beforeEach(async () => {
    await truncateAll(prisma);
    operatorId = (
      await createUser(prisma, { username: 'operator', password: 'right-password', role: 'OPERATOR', fullName: 'Budi Operator' })
    ).id;
  });
  afterAll(() => app.close());

  const login = (body: object) => request(app.getHttpServer()).post('/api/v1/auth/login').send(body);
  const me = (authorization?: string) => {
    const req = request(app.getHttpServer()).get('/api/v1/auth/me');
    return authorization ? req.set('Authorization', authorization) : req;
  };
  const unauthenticated = { error: { code: 'UNAUTHENTICATED', message: expect.any(String) } };

  it('AC-01.1 T-AUT-01 FR-01 valid login returns an HS256 token valid for 8h and the user', async () => {
    const res = await login({ username: 'operator', password: 'right-password' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: 28800,
      user: { id: operatorId, username: 'operator', fullName: 'Budi Operator', role: 'OPERATOR' },
    });
    const [header, payload] = res.body.accessToken
      .split('.')
      .slice(0, 2)
      .map((part: string) => JSON.parse(Buffer.from(part, 'base64url').toString()));
    expect(header.alg).toBe('HS256');
    expect(payload).toMatchObject({ sub: operatorId, username: 'operator', role: 'OPERATOR' });
    expect(payload.exp - payload.iat).toBe(28800);
  });

  it('AC-01.1 T-AUT-01 GET /auth/me returns the current user for a valid token', async () => {
    const { body } = await login({ username: 'operator', password: 'right-password' });

    const res = await me(`Bearer ${body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: operatorId, username: 'operator', fullName: 'Budi Operator', role: 'OPERATOR' });
  });

  it('AC-01.2 T-AUT-02 unknown user and wrong password get identical 401 INVALID_CREDENTIALS bodies', async () => {
    const unknownUser = await login({ username: 'nobody', password: 'right-password' });
    const wrongPassword = await login({ username: 'operator', password: 'wrong-password' });

    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it('AC-01.3 T-AUT-03 FR-02 a missing token gets 401 UNAUTHENTICATED', async () => {
    const res = await me();
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthenticated);
  });

  it('AC-01.3 T-AUT-03 malformed tokens and non-Bearer schemes get 401 UNAUTHENTICATED', async () => {
    for (const authorization of ['Bearer not-a-jwt', 'Bearer ', 'Basic b3BlcmF0b3I6cmlnaHQtcGFzc3dvcmQ=', 'garbage']) {
      const res = await me(authorization);
      expect({ authorization, status: res.status, body: res.body }).toEqual({ authorization, status: 401, body: unauthenticated });
    }
  });

  it('AC-01.3 T-AUT-03 an expired token gets 401 UNAUTHENTICATED', async () => {
    const expired = app.get(JwtService).sign({ sub: operatorId, username: 'operator', role: 'OPERATOR' }, { expiresIn: -10 });
    const res = await me(`Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthenticated);
  });

  it('AC-01.3 T-AUT-03 NFR-02 a token signed with another secret gets 401 UNAUTHENTICATED', async () => {
    const forged = new JwtService({ secret: 'x'.repeat(40) }).sign({ sub: operatorId, username: 'operator', role: 'SUPERVISOR' });
    const res = await me(`Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthenticated);
  });

  it('AC-01.3 a valid token for a user that no longer exists gets 401 UNAUTHENTICATED on /auth/me', async () => {
    const { body } = await login({ username: 'operator', password: 'right-password' });
    await prisma.user.delete({ where: { id: operatorId } });

    const res = await me(`Bearer ${body.accessToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthenticated);
  });

  it('FR-01 spec §4.2 LoginRequest with an extra field gets 400 VALIDATION_ERROR naming the field', async () => {
    const res = await login({ username: 'operator', password: 'right-password', role: 'SUPERVISOR' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: { fields: [{ field: 'role', message: expect.any(String) }] },
      },
    });
  });

  it('FR-01 spec §4.2 LoginRequest with missing or wrongly typed fields gets 400 VALIDATION_ERROR', async () => {
    const res = await login({ username: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.fields.map((f: { field: string }) => f.field);
    expect(new Set(fields)).toEqual(new Set(['username', 'password']));
  });

  it('T-API-02 spec §4.3 a malformed JSON body gets 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String), details: { fields: [] } } });
  });

  it('T-API-02 spec §4.3 a body over the parser limit (100 kB) gets 400 VALIDATION_ERROR, not 500', async () => {
    const res = await login({ username: 'operator', password: 'x'.repeat(200_000) });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'request entity too large', details: { fields: [] } },
    });
  });

  it('T-API-02 spec §4.3 an unknown route gets the 404 NOT_FOUND envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});

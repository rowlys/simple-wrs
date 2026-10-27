import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { AppModule } from '../app.module';
import { loadConfig } from './config';

describe('config (spec §8, §10)', () => {
  const valid = {
    DATABASE_URL: 'postgresql://wrs:pw@localhost:5432/wrs_test',
    JWT_SECRET: 's'.repeat(32),
  };

  it('NFR-02 spec §10 applies the defaults JWT_EXPIRES_IN=8h and PORT=3000', () => {
    expect(loadConfig(valid)).toEqual({
      databaseUrl: valid.DATABASE_URL,
      jwtSecret: valid.JWT_SECRET,
      jwtExpiresInSeconds: 8 * 3600,
      port: 3000,
    });
  });

  it('FR-01 JWT_EXPIRES_IN is configurable in s, m, h and d', () => {
    const seconds = (JWT_EXPIRES_IN: string) => loadConfig({ ...valid, JWT_EXPIRES_IN }).jwtExpiresInSeconds;
    expect([seconds('45s'), seconds('15m'), seconds('2h'), seconds('1d')]).toEqual([45, 900, 7200, 86400]);
    expect(loadConfig({ ...valid, PORT: '8081' }).port).toBe(8081);
  });

  it.each([
    ['DATABASE_URL is missing', { JWT_SECRET: valid.JWT_SECRET }, /DATABASE_URL/],
    ['JWT_SECRET is missing', { DATABASE_URL: valid.DATABASE_URL }, /JWT_SECRET/],
    ['JWT_SECRET has 31 characters', { ...valid, JWT_SECRET: 's'.repeat(31) }, /JWT_SECRET/],
    ['JWT_EXPIRES_IN is a bare number (3600)', { ...valid, JWT_EXPIRES_IN: '3600' }, /JWT_EXPIRES_IN/],
    ['JWT_EXPIRES_IN is 8 hours', { ...valid, JWT_EXPIRES_IN: '8 hours' }, /JWT_EXPIRES_IN/],
    ['PORT is not a port number', { ...valid, PORT: 'abc' }, /PORT/],
  ])('NFR-02 spec §8 refuses to start when %s', (_case, env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });

  it('NFR-02 the JWT_SECRET placeholder in .env.example is rejected, so a forgotten secret cannot start the API', () => {
    const example = parseEnv(readFileSync(join(__dirname, '..', '..', '..', '.env.example'), 'utf8'));
    expect(example.JWT_SECRET).toEqual(expect.any(String));
    expect(() => loadConfig({ ...valid, JWT_SECRET: example.JWT_SECRET })).toThrow(/JWT_SECRET/);
  });

  describe('app startup', () => {
    const saved = { ...process.env };
    afterEach(() => (process.env = { ...saved }));

    it('NFR-02 spec §8 the Nest app fails to start when JWT_SECRET is too short', async () => {
      process.env.JWT_SECRET = 's'.repeat(31);
      await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow(/JWT_SECRET/);
    });
  });
});

import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfig, loadConfig } from '../src/config/config';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { createUser } from './db';

// The real Nest app (same global prefix, guards, pipes and filter as main.ts) against wrs_test.
export async function createTestApp(
  options: { controllers?: Type[]; config?: Partial<AppConfig> } = {},
): Promise<{ app: INestApplication; prisma: PrismaService }> {
  let builder = Test.createTestingModule({ imports: [AppModule], controllers: options.controllers ?? [] });
  if (options.config) {
    builder = builder.overrideProvider(AppConfig).useValue({ ...loadConfig(), ...options.config });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export type TestUsers = Record<'operator' | 'supervisor', { id: string; token: string }>;

// Creates an operator and a supervisor (fullName = username) and logs both in through the API.
export async function createUsersAndLogin(app: INestApplication, prisma: PrismaService): Promise<TestUsers> {
  const users = {} as TestUsers;
  for (const role of ['OPERATOR', 'SUPERVISOR'] as const) {
    const username = role.toLowerCase() as keyof TestUsers;
    const { id } = await createUser(prisma, { username, password: `${username}-pass`, role });
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username, password: `${username}-pass` });
    if (res.status !== 200) throw new Error(`Test login as ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
    users[username] = { id, token: res.body.accessToken };
  }
  return users;
}

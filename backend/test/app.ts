import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AppConfig, loadConfig } from '../src/config/config';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

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

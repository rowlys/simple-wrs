import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { AppModule } from './app.module';
import { requestLogger } from './common/request-logger.middleware';
import { AppConfig } from './config/config';

// docs/openapi.yaml, two levels up from both src/ and dist/; the Docker image keeps the same layout (spec §11).
const OPENAPI_FILE = join(__dirname, '..', '..', 'docs', 'openapi.yaml');

// Shared by bootstrap and the integration tests so both run the same app.
// Guards, the validation pipe and the exception filter are registered in AppModule.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(requestLogger);

  // Spec §0: the hand-written contract, served read-only with Swagger UI. Plain Express middleware, outside the
  // Nest routes, so no token is needed to read it; "Try it out" still needs one (Authorize button).
  const openapi = readFileSync(OPENAPI_FILE, 'utf8');
  app.use('/api/docs/openapi.yaml', (_req: Request, res: Response) => res.type('application/yaml').send(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/docs/openapi.yaml' } }));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(AppConfig).port);
}

if (require.main === module) void bootstrap();

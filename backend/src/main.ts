import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { requestLogger } from './common/request-logger.middleware';
import { AppConfig } from './config/config';

// Shared by bootstrap and the integration tests so both run the same app.
// Guards, the validation pipe and the exception filter are registered in AppModule.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(requestLogger);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(AppConfig).port);
}

if (require.main === module) void bootstrap();

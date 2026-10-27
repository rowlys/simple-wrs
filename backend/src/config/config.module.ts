import { Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from './config';

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => loadConfig() }],
  exports: [AppConfig],
})
export class ConfigModule {}

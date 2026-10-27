import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/config';

// The single Prisma client. It connects lazily on the first query, so the API starts
// (and /health can answer 503) while the database is down.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ datasourceUrl: config.databaseUrl });
  }

  onModuleDestroy() {
    return this.$disconnect();
  }
}

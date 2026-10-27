import { Controller, Get, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../prisma/prisma.service';

interface HealthResponse {
  status: 'ok' | 'error';
  database: 'up' | 'down';
}

// GET /health, outside the /api/v1 prefix, no token (FR-50).
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch (e) {
      this.logger.warn(`Database unreachable: ${(e as Error).message}`);
      res.status(503);
      return { status: 'error', database: 'down' };
    }
  }
}

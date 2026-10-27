import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

// NFR-09: method, path, status and duration only. No bodies, headers or query strings, so
// passwords and tokens can never reach the log.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
}

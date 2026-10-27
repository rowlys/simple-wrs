import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { AppError } from './app-error';
import { ErrorCode } from './error-code';
import { uniqueViolation } from './prisma-errors';

// P2002 meta in Prisma 6 is { modelName, target: [db column names] }, not the constraint name
// (observed against the real schema, docs/ai-workflow.md §6), so the key is model + columns.
const UNIQUE_VIOLATIONS: Record<string, [ErrorCode, string]> = {
  'Product:sku': [ErrorCode.DUPLICATE_SKU, 'A product with this SKU already exists.'],
  'ReceivingItem:receiving_document_id,product_id': [
    ErrorCode.DUPLICATE_PRODUCT_IN_DOCUMENT,
    'This product is already on the document; change the existing line instead.',
  ],
  'ReceiptReversal:receipt_id': [ErrorCode.RECEIPT_ALREADY_REVERSED, 'This receipt has already been reversed.'],
};

const HTTP_STATUS_ERRORS: Record<number, [ErrorCode, string]> = {
  401: [ErrorCode.UNAUTHENTICATED, 'Authentication required.'],
  403: [ErrorCode.FORBIDDEN, 'You are not allowed to perform this action.'],
  404: [ErrorCode.NOT_FOUND, 'Resource not found.'],
};

// Known exceptions become an AppError; anything else returns undefined and is a 500.
function toAppError(exception: unknown): AppError | undefined {
  if (exception instanceof AppError) return exception;

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2025') return new AppError(ErrorCode.NOT_FOUND, 'Resource not found.');
    const known = UNIQUE_VIOLATIONS[uniqueViolation(exception) ?? ''];
    return known && new AppError(...known);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    // Nest raises 400 for a malformed body or a failed built-in pipe; the message is safe to show.
    if (status === 400) return new AppError(ErrorCode.VALIDATION_ERROR, exception.message, { fields: [] });
    const known = HTTP_STATUS_ERRORS[status];
    if (known) return new AppError(...known);
  }

  // body-parser raises http-errors (e.g. 413 entity.too.large) outside Nest; `expose` marks a client error.
  if (isExposedClientError(exception)) {
    return new AppError(ErrorCode.VALIDATION_ERROR, exception.message, { fields: [] });
  }
  return undefined;
}

function isExposedClientError(e: unknown): e is Error {
  const { status, expose } = e as { status?: unknown; expose?: unknown };
  return e instanceof Error && expose === true && typeof status === 'number' && status >= 400 && status < 500;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const error =
      toAppError(exception) ?? new AppError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred.');
    if (error.code === ErrorCode.INTERNAL_ERROR) {
      // NFR-09: every unexpected error is logged with its stack; the client only sees the generic message.
      this.logger.error(exception instanceof Error ? exception.message : String(exception), (exception as Error)?.stack);
    }

    const body = { error: { code: error.code, message: error.message, ...(error.details && { details: error.details }) } };
    host.switchToHttp().getResponse<Response>().status(error.status).json(body);
  }
}

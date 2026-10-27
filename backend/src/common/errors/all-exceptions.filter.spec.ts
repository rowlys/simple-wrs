import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsString, ValidateNested } from 'class-validator';
import { LoginRequest } from '../../modules/auth/dto/login.dto';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppError } from './app-error';
import { ErrorCode } from './error-code';
import { createValidationPipe } from './validation';

// Captures what the filter writes to the (Express) response.
function run(exception: unknown) {
  const out: { status?: number; body?: any } = {}; // any: test capture of the JSON body
  const response = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return out;
}

// Error shapes observed from Prisma 6.19 against the real migrated schema (see docs/ai-workflow.md §6).
const known = (code: string, meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('prisma message', { code, clientVersion: '6.19.3', meta });

class Line {
  @IsInt() quantity!: number;
}
class WithLines {
  @IsString() supplierName!: string;
  @ValidateNested({ each: true })
  @Type(() => Line)
  items!: Line[];
}

describe('AllExceptionsFilter (T-API-02, spec §4.2–4.3)', () => {
  let logError: jest.SpyInstance;
  beforeEach(() => (logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)));
  afterEach(() => logError.mockRestore());

  it('T-API-02 spec §4.2 an AppError becomes the envelope with its code, message and details', () => {
    const err = new AppError(ErrorCode.QUANTITY_EXCEEDS_REMAINING, 'Cannot receive 61 units; only 60 remaining.', {
      remainingQuantity: 60,
      requestedQuantity: 61,
    });
    expect(run(err)).toEqual({
      status: 422,
      body: {
        error: {
          code: 'QUANTITY_EXCEEDS_REMAINING',
          message: 'Cannot receive 61 units; only 60 remaining.',
          details: { remainingQuantity: 60, requestedQuantity: 61 },
        },
      },
    });
  });

  it('T-API-02 spec §4.3 every ErrorCode maps to its HTTP status', () => {
    const expected: Record<ErrorCode, number> = {
      VALIDATION_ERROR: 400,
      UNAUTHENTICATED: 401,
      INVALID_CREDENTIALS: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      DUPLICATE_SKU: 409,
      DUPLICATE_PRODUCT_IN_DOCUMENT: 409,
      INVALID_DOCUMENT_STATUS: 409,
      INVALID_STATUS_TRANSITION: 409,
      IDEMPOTENCY_KEY_REUSED: 409,
      RECEIPT_ALREADY_REVERSED: 409,
      QUANTITY_EXCEEDS_REMAINING: 422,
      DOCUMENT_HAS_NO_ITEMS: 422,
      ITEMS_NOT_FULLY_RECEIVED: 422,
      NOTHING_SHORT: 422,
      PRODUCT_NOT_FOUND: 422,
      INTERNAL_ERROR: 500,
    };
    const actual = Object.fromEntries(Object.values(ErrorCode).map((code) => [code, run(new AppError(code, 'm')).status]));
    expect(actual).toEqual(expected);
    expect(Object.values(ErrorCode).map((code) => run(new AppError(code, 'm')).body.error.code)).toEqual(Object.values(ErrorCode));
  });

  it('T-API-02 spec §4.2 ValidationPipe errors become VALIDATION_ERROR with details.fields', async () => {
    const pipe = createValidationPipe();
    const error = await pipe
      .transform({ username: 'operator', extra: 1 }, { type: 'body', metatype: LoginRequest })
      .catch((e: unknown) => e);

    const { status, body } = run(error);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request validation failed.');
    expect(body.error.details.fields.map((f: { field: string }) => f.field).sort()).toEqual(['extra', 'password', 'password']);
    for (const f of body.error.details.fields) expect(f.message).toEqual(expect.any(String));
  });

  it('T-API-02 spec §4.2 nested validation errors are reported with a dotted field path', async () => {
    const error = await createValidationPipe()
      .transform({ supplierName: 'S', items: [{ quantity: 1 }, { quantity: 'ten' }] }, { type: 'body', metatype: WithLines })
      .catch((e: unknown) => e);

    expect(run(error).body.error.details.fields).toEqual([{ field: 'items.1.quantity', message: 'quantity must be an integer number' }]);
  });

  it.each([
    ['products.sku', 'DUPLICATE_SKU', { modelName: 'Product', target: ['sku'] }],
    ['ri_document_product_uq', 'DUPLICATE_PRODUCT_IN_DOCUMENT', { modelName: 'ReceivingItem', target: ['receiving_document_id', 'product_id'] }],
    ['receipt_reversals_receipt_id_key', 'RECEIPT_ALREADY_REVERSED', { modelName: 'ReceiptReversal', target: ['receipt_id'] }],
  ])('T-API-02 spec §4.3 P2002 on %s maps to 409 %s', (_constraint, code, meta) => {
    const { status, body } = run(known('P2002', meta));
    expect(status).toBe(409);
    expect(body.error).toEqual({ code, message: expect.any(String) });
    expect(logError).not.toHaveBeenCalled();
  });

  it('T-API-02 spec §4.3 P2002 on any other unique constraint is an unexpected 500', () => {
    const { status, body } = run(known('P2002', { modelName: 'User', target: ['username'] }));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(logError).toHaveBeenCalled();
  });

  it('T-API-02 spec §4.3 P2025 maps to 404 NOT_FOUND', () => {
    const { status, body } = run(known('P2025', { modelName: 'Product', cause: 'No record was found for an update.' }));
    expect(status).toBe(404);
    expect(body.error).toEqual({ code: 'NOT_FOUND', message: expect.any(String) });
  });

  it.each([
    ['a raw-SQL CHECK violation (P2010 / 23514)', known('P2010', { code: '23514', message: 'violates check constraint "ri_received_range_chk"' })],
    ['a client CHECK violation', new Prisma.PrismaClientUnknownRequestError('violates check constraint', { clientVersion: '6.19.3' })],
    ['a plain Error', new Error('connection string postgres://secret')],
    ['a thrown non-Error', 'boom'],
  ])('T-API-02 NFR-09 %s becomes a generic 500 INTERNAL_ERROR and is logged with a stack', (_case, exception) => {
    const { status, body } = run(exception);
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
    expect(logError).toHaveBeenCalledTimes(1);
    if (exception instanceof Error) expect(logError.mock.calls[0][1]).toBe(exception.stack);
  });

  it.each([
    [new NotFoundException('Cannot GET /api/v1/nope'), 404, 'NOT_FOUND'],
    [new UnauthorizedException(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new BadRequestException('Unexpected end of JSON input'), 400, 'VALIDATION_ERROR'],
  ])('T-API-02 spec §4.3 Nest %p maps to %i %s', (exception, status, code) => {
    const out = run(exception);
    expect(out.status).toBe(status);
    expect(out.body.error.code).toBe(code);
  });

  it('T-API-02 spec §4.3 a body-parser client error (http-errors, e.g. 413) maps to 400 VALIDATION_ERROR', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, expose: true, type: 'entity.too.large' });
    expect(run(tooLarge)).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'request entity too large', details: { fields: [] } } },
    });
    expect(logError).not.toHaveBeenCalled();
  });
});

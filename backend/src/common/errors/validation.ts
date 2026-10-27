import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError } from './app-error';
import { ErrorCode } from './error-code';

// Nested errors (e.g. items[1].quantity) are reported as dotted paths: "items.1.quantity".
function toFields(errors: ValidationError[], prefix = ''): { field: string; message: string }[] {
  return errors.flatMap((e) => {
    const field = prefix + e.property;
    return [
      ...Object.values(e.constraints ?? {}).map((message) => ({ field, message })),
      ...toFields(e.children ?? [], `${field}.`),
    ];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppError(ErrorCode.VALIDATION_ERROR, 'Request validation failed.', { fields: toFields(errors) }),
  });
}

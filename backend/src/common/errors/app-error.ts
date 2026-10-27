import { ERROR_STATUS, ErrorCode } from './error-code';

// The only error services throw on purpose; the global filter turns it into the spec §4.2 envelope.
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

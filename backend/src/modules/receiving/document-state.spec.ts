import { ReceivingStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { assertCan, DocumentAction } from './document-state';

// PRD §9 / spec §7: the statuses each action is allowed from, and the error for every other status.
const RULES: [DocumentAction, ReceivingStatus[], ErrorCode][] = [
  ['EDIT_ITEMS', ['DRAFT'], ErrorCode.INVALID_DOCUMENT_STATUS],
  ['OPEN', ['DRAFT'], ErrorCode.INVALID_STATUS_TRANSITION],
  ['RECEIVE', ['OPEN', 'IN_PROGRESS'], ErrorCode.INVALID_DOCUMENT_STATUS],
  ['REVERSE', ['IN_PROGRESS'], ErrorCode.INVALID_DOCUMENT_STATUS],
  ['COMPLETE', ['IN_PROGRESS'], ErrorCode.INVALID_STATUS_TRANSITION],
  ['CLOSE_SHORT', ['IN_PROGRESS'], ErrorCode.INVALID_STATUS_TRANSITION],
  ['CANCEL', ['DRAFT', 'OPEN'], ErrorCode.INVALID_STATUS_TRANSITION],
];

const combinations = RULES.flatMap(([action, allowed, code]) =>
  Object.values(ReceivingStatus).map((status) => [action, status, allowed.includes(status) ? 'allowed' : code] as const),
);

describe('document state machine (spec §7)', () => {
  it('T-STM-01 covers all 42 action × status combinations', () => {
    expect(combinations).toHaveLength(42);
  });

  it.each(combinations)('T-STM-01 BR-11 %s on %s → %s', (action, status, expected) => {
    let error: unknown;
    try {
      assertCan(action, status);
    } catch (e) {
      error = e;
    }

    if (expected === 'allowed') {
      expect(error).toBeUndefined();
    } else {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: expected, details: { currentStatus: status, action } });
    }
  });
});

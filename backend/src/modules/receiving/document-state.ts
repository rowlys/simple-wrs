import { ReceivingStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';

export type DocumentAction = 'EDIT_ITEMS' | 'OPEN' | 'RECEIVE' | 'REVERSE' | 'COMPLETE' | 'CLOSE_SHORT' | 'CANCEL';

// The document state machine (PRD §9, spec §7): the statuses each action is allowed from.
const ALLOWED: Record<DocumentAction, ReceivingStatus[]> = {
  EDIT_ITEMS: ['DRAFT'],
  OPEN: ['DRAFT'],
  RECEIVE: ['OPEN', 'IN_PROGRESS'],
  REVERSE: ['IN_PROGRESS'],
  COMPLETE: ['IN_PROGRESS'],
  CLOSE_SHORT: ['IN_PROGRESS'],
  CANCEL: ['DRAFT', 'OPEN'],
};

// Changing a document's content is an INVALID_DOCUMENT_STATUS; changing its status an INVALID_STATUS_TRANSITION.
const CONTENT_ACTIONS: DocumentAction[] = ['EDIT_ITEMS', 'RECEIVE', 'REVERSE'];

const VERBS: Record<DocumentAction, string> = {
  EDIT_ITEMS: 'change the lines of',
  OPEN: 'open',
  RECEIVE: 'receive on',
  REVERSE: 'reverse a receipt of',
  COMPLETE: 'complete',
  CLOSE_SHORT: 'close short',
  CANCEL: 'cancel',
};

export function assertCan(action: DocumentAction, status: ReceivingStatus): void {
  if (ALLOWED[action].includes(status)) return;
  const code = CONTENT_ACTIONS.includes(action) ? ErrorCode.INVALID_DOCUMENT_STATUS : ErrorCode.INVALID_STATUS_TRANSITION;
  throw new AppError(code, `Cannot ${VERBS[action]} a document with status ${status}.`, { currentStatus: status, action });
}

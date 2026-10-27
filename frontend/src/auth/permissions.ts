import type { ReceivingStatus, Role } from '../api/types';

// FR-04: the UI hides what the role or status does not allow. The API enforces the same rules (FR-03).

export type DocumentAction = 'EDIT_ITEMS' | 'OPEN' | 'RECEIVE' | 'REVERSE' | 'COMPLETE' | 'CLOSE_SHORT' | 'CANCEL';
export type Action = DocumentAction | 'CREATE_PRODUCT' | 'CREATE_DOCUMENT';

// Spec §8, the authorization matrix.
const ROLES: Record<Action, Role[]> = {
  CREATE_PRODUCT: ['SUPERVISOR'],
  CREATE_DOCUMENT: ['SUPERVISOR'],
  EDIT_ITEMS: ['SUPERVISOR'],
  OPEN: ['SUPERVISOR'],
  COMPLETE: ['SUPERVISOR'],
  CLOSE_SHORT: ['SUPERVISOR'],
  CANCEL: ['SUPERVISOR'],
  RECEIVE: ['OPERATOR', 'SUPERVISOR'],
  REVERSE: ['SUPERVISOR'],
};

// Spec §7, the statuses each document action is allowed from (same table as backend document-state.ts).
const STATUSES: Record<DocumentAction, ReceivingStatus[]> = {
  EDIT_ITEMS: ['DRAFT'],
  OPEN: ['DRAFT'],
  RECEIVE: ['OPEN', 'IN_PROGRESS'],
  REVERSE: ['IN_PROGRESS'],
  COMPLETE: ['IN_PROGRESS'],
  CLOSE_SHORT: ['IN_PROGRESS'],
  CANCEL: ['DRAFT', 'OPEN'],
};

export const can = (role: Role, action: Action): boolean => ROLES[action].includes(role);

export const canOnDocument = (role: Role, action: DocumentAction, status: ReceivingStatus): boolean =>
  can(role, action) && STATUSES[action].includes(status);

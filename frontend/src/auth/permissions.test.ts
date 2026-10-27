import { describe, expect, it } from 'vitest';
import type { ReceivingStatus, Role } from '../api/types';
import { can, canOnDocument, type Action, type DocumentAction } from './permissions';

// Spec §8, the authorization matrix, written out row by row.
const MATRIX: Record<Action, Role[]> = {
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

// Spec §7, the statuses each document action is allowed from.
const STATE_MACHINE: Record<DocumentAction, ReceivingStatus[]> = {
  EDIT_ITEMS: ['DRAFT'],
  OPEN: ['DRAFT'],
  RECEIVE: ['OPEN', 'IN_PROGRESS'],
  REVERSE: ['IN_PROGRESS'],
  COMPLETE: ['IN_PROGRESS'],
  CLOSE_SHORT: ['IN_PROGRESS'],
  CANCEL: ['DRAFT', 'OPEN'],
};

const ROLES: Role[] = ['OPERATOR', 'SUPERVISOR'];
const STATUSES: ReceivingStatus[] = ['DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED_SHORT', 'CANCELLED'];

describe('permissions', () => {
  it('T-FE-01 FR-04 can(role, action) matches the authorization matrix (spec §8)', () => {
    for (const action of Object.keys(MATRIX) as Action[]) {
      for (const role of ROLES) {
        expect([action, role, can(role, action)]).toEqual([action, role, MATRIX[action].includes(role)]);
      }
    }
  });

  it('T-FE-03 FR-04 BR-11 canOnDocument allows an action only for an allowed role and status (spec §7, §8)', () => {
    for (const action of Object.keys(STATE_MACHINE) as DocumentAction[]) {
      for (const role of ROLES) {
        for (const status of STATUSES) {
          const expected = MATRIX[action].includes(role) && STATE_MACHINE[action].includes(status);
          expect([action, role, status, canOnDocument(role, action, status)]).toEqual([action, role, status, expected]);
        }
      }
    }
  });
});

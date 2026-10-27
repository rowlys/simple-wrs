import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReceivingStatus } from '../api/types';
import { makeDocument, makeItem } from '../test/fixtures';
import { operator, renderApp, stubFetch, supervisor } from '../test/render';
import { DocumentActions } from './DocumentActions';

// PRD §9 transitions a supervisor can trigger from each status; an operator triggers none (spec §8).
const SUPERVISOR_BUTTONS: Record<ReceivingStatus, string[]> = {
  DRAFT: ['Open for receiving', 'Cancel document'],
  OPEN: ['Cancel document'],
  IN_PROGRESS: ['Complete', 'Close short'],
  COMPLETED: [],
  CLOSED_SHORT: [],
  CANCELLED: [],
};

describe('DocumentActions', () => {
  for (const [status, buttons] of Object.entries(SUPERVISOR_BUTTONS) as [ReceivingStatus, string[]][]) {
    it(`T-FE-03 FR-04 ${status}: a supervisor sees [${buttons.join(', ')}], an operator sees none`, () => {
      stubFetch(() => ({ status: 200, body: {} }));
      const { unmount } = renderApp(<DocumentActions document={makeDocument(status)} />, { session: supervisor });
      expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(buttons);
      unmount();
      sessionStorage.clear();

      renderApp(<DocumentActions document={makeDocument(status)} />, { session: operator });
      expect(screen.queryAllByRole('button')).toEqual([]);
    });
  }

  it('T-FE-03 D-30 an IN_PROGRESS document with every line fully received offers Complete but not Close short', () => {
    stubFetch(() => ({ status: 200, body: {} }));
    renderApp(<DocumentActions document={makeDocument('IN_PROGRESS', [makeItem('FRZ-CHK-001', 100, 100)])} />, { session: supervisor });
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Complete']);
  });
});

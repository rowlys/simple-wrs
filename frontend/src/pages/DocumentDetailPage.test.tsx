import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ReceivingDocumentDetail } from '../api/types';
import { DOC_ID, makeDocument, makeItem, makeReceipt } from '../test/fixtures';
import { operator, renderApp, stubFetch, supervisor, type StubResponse } from '../test/render';
import type { Session } from '../auth/session';
import { DocumentDetailPage } from './DocumentDetailPage';

function show(document: ReceivingDocumentDetail, session: Session, respond?: (route: string, init: RequestInit) => StubResponse | undefined) {
  const noProducts = { data: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } };
  const fetchMock = stubFetch(
    (route, init) => respond?.(route, init) ?? { status: 200, body: route.startsWith('GET /api/v1/products') ? noProducts : document },
  );
  renderApp(
    <Routes>
      <Route path="/receiving/:id" element={<DocumentDetailPage />} />
    </Routes>,
    { route: `/receiving/${DOC_ID}`, session },
  );
  return fetchMock;
}

const posted = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([url, init]) => [init?.method, url, init?.body]);

describe('DocumentDetailPage', () => {
  it('FR-23 shows the header, lines with expected / received / remaining, and receipts with their reversal', async () => {
    const chicken = makeItem('FRZ-CHK-001', 100, 10);
    const doc = makeDocument('IN_PROGRESS', [chicken], [makeReceipt('r1', chicken, 100, true), makeReceipt('r2', chicken, 10)]);
    show(doc, operator);

    expect(await screen.findByRole('heading', { name: 'RCV-2026-000001' })).toBeInTheDocument();
    expect(screen.getByText('PT Sumber Beku Nusantara')).toBeInTheDocument();
    const line = within(screen.getByRole('table', { name: /lines/i })).getByText('FRZ-CHK-001').closest('tr')!;
    expect(within(line).getAllByRole('cell').map((c) => c.textContent).slice(3, 6)).toEqual(['100', '10', '90']);
    const receipts = within(screen.getByRole('table', { name: /receipts/i }));
    expect(receipts.getByText(/Typo: counted 10/)).toBeInTheDocument();
    expect(receipts.getByText(/Siti Supervisor/)).toBeInTheDocument();
  });

  it('T-FE-03 AC-04.9 NFR-06 an operator on an OPEN document gets a Receive field for each line not fully received and no supervisor actions', async () => {
    show(makeDocument('OPEN', [makeItem('FRZ-CHK-001', 100), makeItem('CHL-DRY-003', 50, 50)]), operator);

    expect(await screen.findAllByRole('button', { name: /^receive$/i })).toHaveLength(1);
    expect(screen.getByLabelText(/quantity to receive for FRZ-CHK-001/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel document|open for receiving|remove|save|add line/i })).not.toBeInTheDocument();
  });

  it('T-FE-03 FR-04 a COMPLETED document offers nobody a Receive or Reverse button', async () => {
    const chicken = makeItem('FRZ-CHK-001', 100, 100);
    show(makeDocument('COMPLETED', [chicken], [makeReceipt('r1', chicken, 100)]), supervisor);

    await screen.findByRole('heading', { name: 'RCV-2026-000001' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('FR-24 FR-25 FR-26 a supervisor on a DRAFT document changes and removes a line and gets the add-line form', async () => {
    const doc = makeDocument('DRAFT');
    const fetchMock = show(doc, supervisor, (route) => (route.startsWith('DELETE') ? { status: 204 } : undefined));

    const quantity = await screen.findByLabelText(/expected quantity for FRZ-CHK-001/i);
    await userEvent.clear(quantity);
    await userEvent.type(quantity, '120');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(screen.getByRole('button', { name: /add line/i })).toBeInTheDocument();

    await waitFor(() =>
      expect(posted(fetchMock)).toEqual([
        ['PATCH', `/api/v1/receiving-documents/${DOC_ID}/items/item-FRZ-CHK-001`, '{"expectedQuantity":120}'],
        ['DELETE', `/api/v1/receiving-documents/${DOC_ID}/items/item-FRZ-CHK-001`, undefined],
      ]),
    );
  });

  it('FR-04 BR-10 an operator on a DRAFT document sees no line controls', async () => {
    show(makeDocument('DRAFT'), operator);
    await screen.findByRole('heading', { name: 'RCV-2026-000001' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/expected quantity for/i)).not.toBeInTheDocument();
  });

  it('A-06 FR-34 an IN_PROGRESS document with every line received says it is ready to complete', async () => {
    show(makeDocument('IN_PROGRESS', [makeItem('FRZ-CHK-001', 100, 100)]), supervisor);
    expect(await screen.findByText('All items received — ready to complete')).toBeInTheDocument();
  });

  it('FR-35 a CLOSED_SHORT document shows each line’s shortage and the reason', async () => {
    show(makeDocument('CLOSED_SHORT', [makeItem('FRZ-CHK-001', 100, 70)]), supervisor);

    const lines = within(await screen.findByRole('table', { name: /lines/i }));
    expect(lines.getByRole('columnheader', { name: 'Shortage' })).toBeInTheDocument();
    expect(lines.getByText('30')).toBeInTheDocument();
    expect(screen.getByText(/Supplier out of stock/)).toBeInTheDocument();
  });

  it('FR-36 BR-17 a supervisor reverses a receipt with a reason', async () => {
    const chicken = makeItem('FRZ-CHK-001', 100, 100);
    const doc = makeDocument('IN_PROGRESS', [chicken], [makeReceipt('r1', chicken, 100)]);
    const fetchMock = show(doc, supervisor);

    await userEvent.click(await screen.findByRole('button', { name: /reverse/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Typo, counted 10');
    await userEvent.click(within(dialog).getByRole('button', { name: /reverse receipt/i }));

    await waitFor(() =>
      expect(posted(fetchMock)).toEqual([['POST', `/api/v1/receiving-documents/${DOC_ID}/receipts/r1/reverse`, '{"reason":"Typo, counted 10"}']]),
    );
  });
});

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { InventoryTransaction } from '../api/types';
import { DOC_ID } from '../test/fixtures';
import { operator, renderApp, stubFetch } from '../test/render';
import { TransactionsPage } from './TransactionsPage';

const product = { id: '10000000-0000-4000-8000-000000000001', sku: 'FRZ-CHK-001', name: 'Frozen Chicken Breast 1kg' };
const row = (id: string, type: InventoryTransaction['type'], quantityChange: number, balanceAfter: number): InventoryTransaction => ({
  id,
  type,
  product,
  quantityChange,
  balanceAfter,
  receiptId: type === 'RECEIPT' ? `receipt-${id}` : null,
  receiptReversalId: type === 'RECEIPT_REVERSAL' ? `reversal-${id}` : null,
  receivingDocument: { id: DOC_ID, documentNumber: 'RCV-2026-000001' },
  createdBy: { id: 'u1', fullName: 'Budi Operator' },
  createdAt: '2026-10-28T02:00:00.000Z',
});
const ledger = { data: [row('2', 'RECEIPT_REVERSAL', -100, 0), row('1', 'RECEIPT', 100, 100)], meta: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 } };
const empty = { data: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } };
const products = { data: [{ ...product, unitOfMeasure: 'CTN' }], meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } };

const respond = (route: string) => ({
  status: 200,
  body: route.includes('/inventory/transactions') ? ledger : route.includes('/products') ? products : empty,
});
const ledgerUrls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/v1/inventory/transactions'));

describe('TransactionsPage', () => {
  it('FR-41 AC-06.2 each row shows product, type, change, balance after, source document and user', async () => {
    stubFetch(respond);
    renderApp(<TransactionsPage />, { session: operator });

    const reversal = (await screen.findByText('−100')).closest('tr')!;
    expect(reversal).toHaveTextContent('FRZ-CHK-001');
    expect(reversal).toHaveTextContent('Reversal');
    expect(reversal).toHaveTextContent('Budi Operator');
    expect(screen.getByText('+100').closest('tr')).toHaveTextContent('Receipt');
    expect(screen.getAllByRole('link', { name: 'RCV-2026-000001' })[0]).toHaveAttribute('href', `/receiving/${DOC_ID}`);
  });

  it('FR-41 the product filter is sent as productId', async () => {
    const fetchMock = stubFetch(respond);
    renderApp(<TransactionsPage />, { session: operator });

    await userEvent.click(screen.getByRole('textbox', { name: /product/i }));
    await userEvent.click(await screen.findByRole('option', { name: /FRZ-CHK-001/ }));

    await waitFor(() => expect(ledgerUrls(fetchMock)).toContainEqual(expect.stringContaining(`productId=${product.id}`)));
  });

  it('FR-41 D-25 A-10 a date range covers whole local days: from at the start of the first, to (exclusive) at the start of the day after the last', async () => {
    const fetchMock = stubFetch(respond);
    renderApp(<TransactionsPage />, { session: operator });

    await userEvent.type(screen.getByLabelText(/^from/i), '2026-10-27');
    await userEvent.type(screen.getByLabelText(/^to/i), '2026-10-28');

    const from = encodeURIComponent(new Date(2026, 9, 27).toISOString());
    const to = encodeURIComponent(new Date(2026, 9, 29).toISOString());
    await waitFor(() => expect(ledgerUrls(fetchMock)).toContainEqual(expect.stringMatching(new RegExp(`from=${from}.*to=${to}`))));
  });

  it('FR-41 D-31 a To date before From is flagged and not sent', async () => {
    const fetchMock = stubFetch(respond);
    renderApp(<TransactionsPage />, { session: operator });

    await userEvent.type(screen.getByLabelText(/^from/i), '2026-10-28');
    await userEvent.type(screen.getByLabelText(/^to/i), '2026-10-20');

    expect(await screen.findByText('To must be on or after From')).toBeInTheDocument();
    expect(ledgerUrls(fetchMock).filter((url) => url.includes('to='))).toEqual([]);
  });
});

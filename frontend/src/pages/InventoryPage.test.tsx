import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { InventoryBalance } from '../api/types';
import { operator, renderApp, stubFetch } from '../test/render';
import { InventoryPage } from './InventoryPage';

const balance: InventoryBalance = {
  productId: '10000000-0000-4000-8000-000000000001',
  sku: 'FRZ-CHK-001',
  name: 'Frozen Chicken Breast 1kg',
  unitOfMeasure: 'CTN',
  quantityOnHand: 100,
  updatedAt: '2026-10-28T02:00:00.000Z',
};

describe('InventoryPage', () => {
  it('FR-40 AC-06.1 lists SKU, name, unit and on-hand, and sends the search to the API', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: { data: [balance], meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } } }));
    renderApp(<InventoryPage />, { session: operator });

    const row = (await screen.findByText('FRZ-CHK-001')).closest('tr')!;
    expect(row).toHaveTextContent('Frozen Chicken Breast 1kg');
    expect(row).toHaveTextContent('CTN');
    expect(row).toHaveTextContent('100');

    await userEvent.type(screen.getByPlaceholderText(/search/i), 'chk');
    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => url)).toContainEqual(expect.stringMatching(/^\/api\/v1\/inventory\?.*search=chk/)));
  });
});

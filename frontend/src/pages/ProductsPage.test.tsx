import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Page, Product } from '../api/types';
import { apiError, operator, renderApp, stubFetch, supervisor } from '../test/render';
import { ProductsPage } from './ProductsPage';

const chicken: Product = {
  id: '10000000-0000-4000-8000-000000000001',
  sku: 'FRZ-CHK-001',
  name: 'Frozen Chicken Breast 1kg',
  unitOfMeasure: 'CTN',
  description: null,
  quantityOnHand: 120,
  createdAt: '2026-10-27T01:00:00.000Z',
  updatedAt: '2026-10-27T01:00:00.000Z',
};
const page = (data: Product[]): Page<Product> => ({ data, meta: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } });

describe('ProductsPage', () => {
  it('AC-02.5 an operator sees the product list but no "New product" button', async () => {
    stubFetch(() => ({ status: 200, body: page([chicken]) }));
    renderApp(<ProductsPage />, { session: operator });

    expect(await screen.findByText('FRZ-CHK-001')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new product/i })).not.toBeInTheDocument();
  });

  it('FR-10 the search text is sent to the API', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: page([chicken]) }));
    renderApp(<ProductsPage />, { session: operator });

    await userEvent.type(screen.getByPlaceholderText(/search/i), 'chk');

    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => url)).toContainEqual(expect.stringMatching(/^\/api\/v1\/products\?.*search=chk/)));
  });

  it('FR-11 a supervisor creates a product with the "New product" form', async () => {
    const fetchMock = stubFetch((route) => (route.startsWith('POST') ? { status: 201, body: chicken } : { status: 200, body: page([]) }));
    renderApp(<ProductsPage />, { session: supervisor });

    await userEvent.click(await screen.findByRole('button', { name: /new product/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/sku/i), 'frz-chk-001');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'Frozen Chicken Breast 1kg');
    await userEvent.type(within(dialog).getByLabelText(/unit/i), 'CTN');
    await userEvent.click(within(dialog).getByRole('button', { name: /create/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ sku: 'frz-chk-001', name: 'Frozen Chicken Breast 1kg', unitOfMeasure: 'CTN', description: null });
  });

  it('AC-02.2 a duplicate SKU shows the server message and keeps the form open', async () => {
    stubFetch((route) =>
      route.startsWith('POST') ? apiError(409, 'DUPLICATE_SKU', 'A product with this SKU already exists.') : { status: 200, body: page([]) },
    );
    renderApp(<ProductsPage />, { session: supervisor });

    await userEvent.click(await screen.findByRole('button', { name: /new product/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/sku/i), 'frz-chk-001');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'Chicken');
    await userEvent.type(within(dialog).getByLabelText(/unit/i), 'CTN');
    await userEvent.click(within(dialog).getByRole('button', { name: /create/i }));

    expect(await within(dialog).findByText('A product with this SKU already exists.')).toBeInTheDocument();
  });
});

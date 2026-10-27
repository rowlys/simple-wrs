import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { makeDocument } from '../test/fixtures';
import { apiError, operator, renderApp, stubFetch, supervisor } from '../test/render';
import { DocumentCreatePage } from './DocumentCreatePage';

const chicken = { id: '10000000-0000-4000-8000-000000000001', sku: 'FRZ-CHK-001', name: 'Frozen Chicken Breast 1kg', unitOfMeasure: 'CTN' };
const products = { data: [chicken], meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } };

const routes = (
  <Routes>
    <Route path="/receiving" element={<p>Receiving list</p>} />
    <Route path="/receiving/new" element={<DocumentCreatePage />} />
    <Route path="/receiving/:id" element={<p>Detail page</p>} />
  </Routes>
);

describe('DocumentCreatePage', () => {
  it('FR-21 AC-03.1 a supervisor creates a draft with a line and lands on its detail page', async () => {
    const fetchMock = stubFetch((route) =>
      route.startsWith('POST') ? { status: 201, body: makeDocument('DRAFT') } : { status: 200, body: products },
    );
    renderApp(routes, { route: '/receiving/new', session: supervisor });

    await userEvent.type(screen.getByLabelText(/supplier name/i), 'PT Sumber Beku Nusantara');
    await userEvent.type(screen.getByLabelText(/reference number/i), 'SJ-1');
    await userEvent.click(screen.getByRole('button', { name: /add line/i }));
    await userEvent.click(screen.getByRole('textbox', { name: /product for line 1/i }));
    await userEvent.click(await screen.findByRole('option', { name: /FRZ-CHK-001/ }));
    await userEvent.type(screen.getByLabelText(/expected quantity for line 1/i), '100');
    await userEvent.click(screen.getByRole('button', { name: /create draft/i }));

    expect(await screen.findByText('Detail page')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      supplierName: 'PT Sumber Beku Nusantara',
      referenceNumber: 'SJ-1',
      expectedDate: null,
      notes: null,
      items: [{ productId: chicken.id, expectedQuantity: 100 }],
    });
  });

  it('BR-06 NFR-06 a rejected document shows the server message', async () => {
    stubFetch((route) =>
      route.startsWith('POST')
        ? apiError(409, 'DUPLICATE_PRODUCT_IN_DOCUMENT', 'This product is already on the document; change the existing line instead.')
        : { status: 200, body: products },
    );
    renderApp(routes, { route: '/receiving/new', session: supervisor });

    await userEvent.type(screen.getByLabelText(/supplier name/i), 'PT Sumber');
    await userEvent.click(screen.getByRole('button', { name: /create draft/i }));

    expect(await screen.findByText('This product is already on the document; change the existing line instead.')).toBeInTheDocument();
  });

  it('FR-04 an operator opening /receiving/new is sent back to the list', async () => {
    stubFetch(() => ({ status: 200, body: products }));
    renderApp(routes, { route: '/receiving/new', session: operator });
    await waitFor(() => expect(screen.getByText('Receiving list')).toBeInTheDocument());
  });
});

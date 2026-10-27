import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DOC_ID, makeDocument, makeItem, makeReceipt } from '../test/fixtures';
import { apiError, operator, renderApp, stubFetch, type StubResponse } from '../test/render';
import { ReceiveForm } from './ReceiveForm';

const item = makeItem('FRZ-CHK-001', 100, 40);
const result = (quantity: number): StubResponse => {
  const after = makeItem('FRZ-CHK-001', 100, 40 + quantity);
  return {
    status: 201,
    body: {
      receipt: makeReceipt('r1', after, quantity),
      item: after,
      document: { id: DOC_ID, documentNumber: 'RCV-2026-000001', status: 'IN_PROGRESS', allItemsReceived: false },
      inventory: { productId: after.product.id, quantityOnHand: 40 + quantity },
    },
  };
};

const field = () => screen.getByLabelText(/quantity to receive/i);
const receiveButton = () => screen.getByRole('button', { name: /^receive$/i });
const keysSent = (calls: [string, RequestInit?][]) =>
  calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']);

describe('ReceiveForm', () => {
  it('T-FE-02 AC-04.9 a retry after a network error resends the same Idempotency-Key; the next receipt gets a new key', async () => {
    let posts = 0;
    const fetchMock = stubFetch((route) => {
      if (route.startsWith('GET')) return { status: 200, body: makeDocument('IN_PROGRESS') };
      if (++posts === 1) throw new TypeError('Failed to fetch');
      return result(10);
    });
    renderApp(<ReceiveForm documentId={DOC_ID} item={item} />, { session: operator });

    await userEvent.type(field(), '10');
    await userEvent.click(receiveButton());
    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument();

    await userEvent.click(receiveButton()); // retry of the same submission
    await waitFor(() => expect(field()).toHaveValue('')); // cleared after success

    await userEvent.type(field(), '5');
    await userEvent.click(receiveButton());
    await waitFor(() => expect(keysSent(fetchMock.mock.calls)).toHaveLength(3));

    const [first, retry, next] = keysSent(fetchMock.mock.calls);
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(retry).toBe(first);
    expect(next).not.toBe(first);
  });

  it('T-FE-02 changing the quantity after a failed attempt uses a new key', async () => {
    const fetchMock = stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    renderApp(<ReceiveForm documentId={DOC_ID} item={item} />, { session: operator });

    await userEvent.type(field(), '10');
    await userEvent.click(receiveButton());
    await screen.findByText(/cannot reach the server/i);
    await userEvent.clear(field());
    await userEvent.type(field(), '8');
    await userEvent.click(receiveButton());

    await waitFor(() => expect(keysSent(fetchMock.mock.calls)).toHaveLength(2));
    const [first, second] = keysSent(fetchMock.mock.calls);
    expect(second).not.toBe(first);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ quantity: 8 });
  });

  it('T-FE-02 BR-09 typing the same quantity again after a failure keeps the key, so a receipt the server did record is not counted twice', async () => {
    const fetchMock = stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    renderApp(<ReceiveForm documentId={DOC_ID} item={item} />, { session: operator });

    await userEvent.type(field(), '10');
    await userEvent.click(receiveButton());
    await screen.findByText(/cannot reach the server/i);
    await userEvent.clear(field());
    await userEvent.type(field(), '10');
    await userEvent.click(receiveButton());

    await waitFor(() => expect(keysSent(fetchMock.mock.calls)).toHaveLength(2));
    const [first, second] = keysSent(fetchMock.mock.calls);
    expect(second).toBe(first);
  });

  it('AC-04.9 the quantity field does not accept more than the remaining quantity', async () => {
    stubFetch(() => result(1));
    renderApp(<ReceiveForm documentId={DOC_ID} item={item} />, { session: operator });

    await userEvent.type(field(), '61');

    expect(Number((field() as HTMLInputElement).value)).toBeLessThanOrEqual(60);
  });

  it('AC-04.3 NFR-06 an over-receipt rejected by the server shows its message', async () => {
    stubFetch(() =>
      apiError(422, 'QUANTITY_EXCEEDS_REMAINING', 'Cannot receive 60 units; only 20 remaining for FRZ-CHK-001.', { remainingQuantity: 20 }),
    );
    renderApp(<ReceiveForm documentId={DOC_ID} item={item} />, { session: operator });

    await userEvent.type(field(), '60');
    await userEvent.click(receiveButton());

    expect(await screen.findByText('Cannot receive 60 units; only 20 remaining for FRZ-CHK-001.')).toBeInTheDocument();
  });
});

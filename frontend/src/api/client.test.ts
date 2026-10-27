import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSession } from '../auth/session';
import { apiError, operator, stubFetch, supervisor } from '../test/render';
import { ApiError, onUnauthenticated, request } from './client';

describe('api client', () => {
  const unsubscribes: (() => void)[] = [];
  const listen = () => {
    const handler = vi.fn();
    unsubscribes.push(onUnauthenticated(handler));
    return handler;
  };
  afterEach(() => unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe()));

  it('FR-02 sends the stored token as a Bearer header and JSON bodies', async () => {
    writeSession(supervisor);
    const fetchMock = stubFetch(() => ({ status: 201, body: { id: 'p1' } }));

    await expect(request('POST', '/products', { body: { sku: 'A-1' } })).resolves.toEqual({ id: 'p1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/products');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer supervisor-token', 'Content-Type': 'application/json' });
    expect(init?.body).toBe('{"sku":"A-1"}');
  });

  it('FR-20 puts defined query values in the URL and leaves out empty ones', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: {} }));
    await request('GET', '/receiving-documents', { query: { page: 2, status: undefined, search: '' } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/receiving-documents?page=2');
  });

  it('AC-01.3 a 401 UNAUTHENTICATED for the stored token calls the logout handler', async () => {
    writeSession(supervisor);
    const handler = listen();
    stubFetch(() => apiError(401, 'UNAUTHENTICATED', 'Missing, invalid or expired token.'));

    await expect(request('GET', '/products')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('AC-01.3 a late 401 for a token that was replaced meanwhile does not log out the new session', async () => {
    writeSession(supervisor);
    const handler = listen();
    stubFetch(() => {
      writeSession(operator); // a new login while the old request was in flight
      return apiError(401, 'UNAUTHENTICATED', 'Missing, invalid or expired token.');
    });

    await expect(request('GET', '/products')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('AC-01.2 a 401 INVALID_CREDENTIALS does not call the logout handler', async () => {
    const handler = listen();
    stubFetch(() => apiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password'));

    await expect(request('POST', '/auth/login', { body: {} })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('NFR-06 turns the error envelope into an ApiError carrying the server message and details', async () => {
    stubFetch(() =>
      apiError(422, 'QUANTITY_EXCEEDS_REMAINING', 'Cannot receive 61 units; only 60 remaining for FRZ-CHK-001.', {
        remainingQuantity: 60,
        requestedQuantity: 61,
      }),
    );
    const error = await request('POST', '/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'QUANTITY_EXCEEDS_REMAINING',
      message: 'Cannot receive 61 units; only 60 remaining for FRZ-CHK-001.',
      details: { remainingQuantity: 60 },
    });
  });

  it('NFR-06 a response without the envelope (e.g. a proxy error page) and a network failure get plain messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));
    await expect(request('GET', '/products')).rejects.toMatchObject({ status: 502, message: 'The server returned an error (502). Try again.' });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(request('GET', '/products')).rejects.toMatchObject({ status: 0, message: 'Cannot reach the server. Check the connection and try again.' });
  });

  it('FR-26 a 204 response resolves without a body', async () => {
    stubFetch(() => ({ status: 204 }));
    await expect(request('DELETE', '/receiving-documents/d/items/i')).resolves.toBeUndefined();
  });
});

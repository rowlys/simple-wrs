import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeDocument } from '../test/fixtures';
import { operator, renderApp, stubFetch, supervisor } from '../test/render';
import { DocumentsPage } from './DocumentsPage';

const list = { data: [makeDocument('OPEN')], meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } };

describe('DocumentsPage', () => {
  it('FR-20 lists documents and sends the status filter and search to the API', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: list }));
    renderApp(<DocumentsPage />, { session: operator });

    expect(await screen.findByRole('link', { name: 'RCV-2026-000001' })).toHaveAttribute('href', `/receiving/${list.data[0].id}`);

    await userEvent.click(screen.getByRole('textbox', { name: /status/i }));
    await userEvent.click(await screen.findByRole('option', { name: 'In progress' }));
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'sumber');

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => url);
      expect(urls).toContainEqual(expect.stringMatching(/status=IN_PROGRESS.*search=sumber|search=sumber.*status=IN_PROGRESS/));
    });
  });

  it('FR-04 FR-21 only a supervisor sees "New document"', async () => {
    stubFetch(() => ({ status: 200, body: list }));
    const { unmount } = renderApp(<DocumentsPage />, { session: operator });
    await screen.findByText('RCV-2026-000001');
    expect(screen.queryByRole('link', { name: /new document/i })).not.toBeInTheDocument();
    unmount();

    renderApp(<DocumentsPage />, { session: supervisor });
    expect(await screen.findByRole('link', { name: /new document/i })).toHaveAttribute('href', '/receiving/new');
  });
});

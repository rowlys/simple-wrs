import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { writeSession, type Session } from '../auth/session';

export const supervisor: Session = {
  accessToken: 'supervisor-token',
  user: { id: '00000000-0000-4000-8000-000000000001', username: 'supervisor', fullName: 'Siti Supervisor', role: 'SUPERVISOR' },
};
export const operator: Session = {
  accessToken: 'operator-token',
  user: { id: '00000000-0000-4000-8000-000000000002', username: 'operator', fullName: 'Budi Operator', role: 'OPERATOR' },
};

/** Renders `ui` with every provider the app has, at `route`, optionally logged in. */
export function renderApp(ui: ReactElement, { route = '/', session }: { route?: string; session?: Session } = {}) {
  if (session) writeSession(session);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>{ui}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

export interface StubResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Replaces fetch: `respond` gets "METHOD /url" and the request init, and returns the response. */
export function stubFetch(respond: (route: string, init: RequestInit) => StubResponse | Promise<StubResponse>) {
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const { status, body, headers } = await respond(`${init.method ?? 'GET'} ${input}`, init);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const apiError = (status: number, code: string, message: string, details?: unknown): StubResponse => ({
  status,
  body: { error: { code, message, ...(details !== undefined && { details }) } },
});

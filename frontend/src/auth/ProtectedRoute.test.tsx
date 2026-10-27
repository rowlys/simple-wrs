import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { request } from '../api/client';
import { apiError, renderApp, stubFetch, supervisor } from '../test/render';
import { ProtectedRoute } from './ProtectedRoute';
import { readSession } from './session';

function ProductsProbe() {
  const { isPending } = useQuery({ queryKey: ['probe'], queryFn: () => request('GET', '/products') });
  return <p>{isPending ? 'Loading' : 'Loaded'}</p>;
}

const routes = (
  <Routes>
    <Route path="/login" element={<p>Login page</p>} />
    <Route element={<ProtectedRoute />}>
      <Route path="/products" element={<ProductsProbe />} />
    </Route>
  </Routes>
);

describe('ProtectedRoute', () => {
  it('AC-01.3 without a token a protected page sends the user to the login page', () => {
    renderApp(routes, { route: '/products' });
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('AC-01.3 FR-05 an expired token discards the session and returns the user to the login page', async () => {
    stubFetch(() => apiError(401, 'UNAUTHENTICATED', 'Missing, invalid or expired token.'));
    renderApp(routes, { route: '/products', session: supervisor });

    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(readSession()).toBeNull();
  });
});

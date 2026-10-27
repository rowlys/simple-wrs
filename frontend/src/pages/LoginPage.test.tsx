import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { readSession } from '../auth/session';
import { apiError, renderApp, stubFetch, supervisor } from '../test/render';
import { LoginPage } from './LoginPage';

const routes = (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/receiving" element={<p>Receiving list</p>} />
  </Routes>
);

async function logIn(username: string, password: string) {
  await userEvent.type(screen.getByLabelText(/username/i), username);
  await userEvent.type(screen.getByLabelText(/password/i), password);
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));
}

describe('LoginPage', () => {
  it('AC-01.1 valid credentials store the token and show the receiving document list', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: { ...supervisor, expiresIn: 28800 } }));
    renderApp(routes, { route: '/login' });

    await logIn('supervisor', 'secret');

    expect(await screen.findByText('Receiving list')).toBeInTheDocument();
    expect(readSession()).toEqual(supervisor);
    expect(fetchMock.mock.calls[0][1]?.body).toBe('{"username":"supervisor","password":"secret"}');
  });

  it('AC-01.2 invalid credentials show "Invalid username or password" and store no token', async () => {
    stubFetch(() => apiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password'));
    renderApp(routes, { route: '/login' });

    await logIn('supervisor', 'wrong');

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
    expect(readSession()).toBeNull();
  });
});

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onUnauthenticated, request } from '../api/client';
import type { LoginResponse, User } from '../api/types';
import { readSession, writeSession } from './session';

interface Auth {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(() => readSession()?.user ?? null);

  // FR-05: logging out discards the token and every cached response of the previous user.
  const logout = useCallback(() => {
    writeSession(null);
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  // AC-01.3: an expired or invalid token returns the user to the login page (ProtectedRoute redirects).
  useEffect(() => onUnauthenticated(logout), [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const { accessToken, user } = await request<LoginResponse>('POST', '/auth/login', { body: { username, password } });
    writeSession({ accessToken, user });
    setUser(user);
  }, []);

  const auth = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}

/** The logged-in user; only for components under ProtectedRoute. */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser must be used under ProtectedRoute');
  return user;
}

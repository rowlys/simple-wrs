import type { User } from '../api/types';

// Spec §1.1: the token lives in sessionStorage, so it is gone when the tab closes.
const KEY = 'wrs.session';

export interface Session {
  accessToken: string;
  user: User;
}

export function readSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null): void {
  if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
  else sessionStorage.removeItem(KEY);
}

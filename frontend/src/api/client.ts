import { readSession } from '../auth/session';

/** A failed API call. `message` is safe to show to the user (OpenAPI ErrorResponse). Status 0: no response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let unauthenticatedHandler: (() => void) | undefined;

/** AC-01.3: called when the stored token gets a 401 UNAUTHENTICATED. Returns an unsubscribe function. */
export function onUnauthenticated(handler: () => void): () => void {
  unauthenticatedHandler = handler;
  return () => {
    if (unauthenticatedHandler === handler) unauthenticatedHandler = undefined;
  };
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
}

export async function request<T>(method: string, path: string, { body, query, headers }: RequestOptions = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const url = `/api/v1${path}${params.size ? `?${params}` : ''}`;
  const token = readSession()?.accessToken;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check the connection and try again.');
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined; // not our API's JSON, e.g. a proxy's HTML error page
  }

  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined)?.error;
    if (!error?.code || !error.message) {
      throw new ApiError(response.status, 'INTERNAL_ERROR', `The server returned an error (${response.status}). Try again.`);
    }
    // Only when the rejected token is still the stored one: a late answer to an old token must not log out a newer session.
    if (error.code === 'UNAUTHENTICATED' && token && readSession()?.accessToken === token) unauthenticatedHandler?.();
    throw new ApiError(response.status, error.code, error.message, error.details);
  }
  return json as T;
}

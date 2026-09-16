const BASE = '/api/auth';

export type Persona = 'admin' | 'planner' | 'sourcing' | 'exec';
export type SessionUser = { name: string; role: Persona };

async function authError(res: Response, fallback: string): Promise<Error> {
  if (res.status === 401) return new Error('Invalid credentials');
  if (res.status >= 500 || res.status === 503) {
    return new Error('Server unavailable. The API may still be starting or misconfigured on Azure.');
  }
  let detail = '';
  try {
    const body = (await res.json()) as { detail?: unknown };
    detail = typeof body?.detail === 'string' ? body.detail : '';
  } catch {
    // ignore non-JSON bodies (e.g. Azure HTML error pages)
  }
  return new Error(detail || fallback);
}

export async function login(user_id: string, password: string): Promise<{ access_token: string; user: SessionUser }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, password }),
    });
  } catch {
    throw new Error('Cannot reach the API. Check that the Azure app is running (/health should return ok).');
  }
  if (!res.ok) throw await authError(res, 'Sign-in failed');
  return res.json();
}

export async function me(token: string): Promise<SessionUser> {
  const res = await fetch(`${BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Session expired');
  return res.json();
}

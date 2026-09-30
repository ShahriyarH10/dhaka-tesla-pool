// Thin fetch wrapper. One place that knows the base URL, the token, and the error shape.
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TOKEN_KEY = 'tesla-pool-token';

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (t) => window.localStorage.setItem(TOKEN_KEY, t),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = tokenStore.get();
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    const detail = err.details?.[0]?.message;
    throw new ApiError(res.status, err.code ?? 'ERROR', detail ? `${err.message}: ${detail}` : err.message ?? 'Something went wrong', err.details);
  }
  return data;
}

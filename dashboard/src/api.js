// The dashboard is served by the Lacy server, so API calls are same-origin by
// default. Set REACT_APP_API_URL when running `npm start` against a server
// somewhere else (e.g. http://localhost:4000).
const API_BASE = (process.env.REACT_APP_API_URL || '').replace(/\/+$/, '');

const TOKEN_KEY = 'lacyToken';

export function apiUrl(pathAndQuery) {
  return `${API_BASE}${pathAndQuery}`;
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * VS Code opens the dashboard with a single-use `code` in the URL. Swap it for a
 * session token, then strip it from the address bar so it is not left in history.
 */
let sessionPromise;

export function ensureSession() {
  // StrictMode runs effects twice in development; the handoff code is single-use,
  // so the exchange must happen at most once per page load.
  if (!sessionPromise) sessionPromise = exchangeSessionOnce();
  return sessionPromise;
}

async function exchangeSessionOnce() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) {
    return Boolean(getToken());
  }

  try {
    const response = await fetch(apiUrl('/api/auth/exchange'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return Boolean(getToken());

    const { token, user } = await response.json();
    localStorage.setItem(TOKEN_KEY, token);
    if (user?.id) localStorage.setItem('user_id', String(user.id));

    params.delete('code');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    return true;
  } catch {
    return Boolean(getToken());
  }
}

/** fetch() with the session token attached. */
export function apiFetch(pathAndQuery, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(apiUrl(pathAndQuery), { ...options, headers });
}

export default apiUrl;

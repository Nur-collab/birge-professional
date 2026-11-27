// ==============================================================================
// BIRGE WEB CLIENT — CORE HTTP CLIENT, TOKEN STORAGE & SESSION REFRESH
// ==============================================================================

const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
export const API_URL = configuredApiUrl || 'https://birge-api.onrender.com';

// Auth is always requested from the same-origin /api/auth proxy (Vite in
// development, vercel.json in production), so the HttpOnly refresh cookie is
// first-party. Other API calls stay on API_URL.
export const AUTH_URL = '/api/auth';

const LEGACY_ACCESS_TOKEN_KEY = 'birge_token';
const LEGACY_REFRESH_TOKEN_KEY = 'birge_refresh_token';
const CSRF_TOKEN_KEY = 'birge_csrf_token';

// Access and CSRF tokens live in memory; the refresh token never reaches JS.
// The CSRF value is only a nonce paired with an HttpOnly cookie, not a bearer
// credential. It is persisted so a page reload can refresh the session.
let accessToken = null;
let csrfToken = null;
try {
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
  csrfToken = localStorage.getItem(CSRF_TOKEN_KEY) || null;
} catch (_) {
  // Storage can be unavailable in private browsing modes.
}

export const tokenStorage = {
  get: () => accessToken,
  set: (token) => { accessToken = token || null; },
  getCsrf: () => csrfToken,
  setCsrf: (token) => {
    csrfToken = token || null;
    try {
      if (csrfToken) localStorage.setItem(CSRF_TOKEN_KEY, csrfToken);
      else localStorage.removeItem(CSRF_TOKEN_KEY);
    } catch (_) {}
  },
  setPair: (newAccessToken, newCsrfToken) => {
    accessToken = newAccessToken || null;
    if (newCsrfToken) {
      csrfToken = newCsrfToken;
      try { localStorage.setItem(CSRF_TOKEN_KEY, newCsrfToken); } catch (_) {}
    }
  },
  clear: () => {
    accessToken = null;
    tokenStorage.setCsrf(null);
    try {
      localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
      localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
    } catch (_) {}
  },
};

/**
 * Remove a query parameter in place, replacing the current history entry so
 * the value is not kept in the address bar or history.
 */
function consumeQueryParam(name) {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(name)) return null;
    const value = params.get(name);
    params.delete(name);
    const query = params.toString();
    const cleanUrl = window.location.pathname
      + (query ? `?${query}` : '')
      + (window.location.hash || '');
    window.history.replaceState({}, document.title, cleanUrl);
    return value || null;
  } catch {
    return null;
  }
}

/**
 * One-time login codes arrive in `?code=`. Read and remove the code before
 * any other request so it is not kept in history, referrers or logs.
 */
export function takeLoginCodeFromUrl() {
  return consumeQueryParam('code');
}

/**
 * Legacy magic links used an access token. Never read it as a credential;
 * remove it from the current history entry before the app renders.
 */
export function stripLegacyTokenFromUrl() {
  consumeQueryParam('token');
}

export const getCurrentUserId = () => {
  const token = tokenStorage.get();
  if (!token) return null;
  try {
    const segment = token.split('.')[1] || '';
    // JWT uses base64url while atob expects padded standard base64.
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + (4 - (normalized.length % 4)) % 4, '=');
    const payload = JSON.parse(atob(padded));
    return payload?.sub ? Number(payload.sub) : null;
  } catch {
    return null;
  }
};

function apiError(message, status = 0) {
  const error = new Error(message);
  error.status = status;
  return error;
}

let refreshPromise = null;

const requestUrl = (endpoint) => {
  if (endpoint.startsWith('/auth/')) {
    return `${AUTH_URL}${endpoint.slice('/auth'.length)}`;
  }
  return `${API_URL}${endpoint}`;
};

async function refreshAccessToken() {
  const csrf = tokenStorage.getCsrf();
  if (!csrf) return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${AUTH_URL}/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrf },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return false;
      if (!response.ok) {
        throw apiError(`Ошибка ${response.status}`, response.status);
      }
      const data = await response.json();
      if (!data?.access_token) return false;
      tokenStorage.setPair(data.access_token, data.csrf_token);
      return true;
    } catch (error) {
      if (error.status) throw error;
      throw apiError('Сервер не отвечает. Попробуйте ещё раз.');
    } finally {
      clearTimeout(timeoutId);
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function restoreSession() {
  if (tokenStorage.get()) return true;
  return refreshAccessToken();
}

export async function authFetch(endpoint, options = {}, allowRefresh = true) {
  const token = tokenStorage.get();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const url = requestUrl(endpoint);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  let response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (netErr) {
    if (netErr.name === 'AbortError') {
      throw apiError('Сервер не отвечает. Попробуйте ещё раз.');
    }
    throw apiError('Не удалось подключиться к серверу. Проверьте интернет-соединение.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    if (allowRefresh) {
      let refreshed = false;
      try {
        refreshed = await refreshAccessToken();
      } catch (error) {
        // A network/API outage must not destroy a valid local session.
        throw error;
      }
      if (refreshed) return authFetch(endpoint, options, false);
    }
    tokenStorage.clear();
    window.dispatchEvent(new Event('birge:unauthorized'));
    throw apiError('Сессия истекла. Войдите снова.', 401);
  }

  if (!response.ok) {
    let errorDetail = `Ошибка сервера (${response.status})`;
    try {
      const errorJson = await response.json();
      const detail = errorJson.detail ?? errorJson.message;
      if (typeof detail === 'string') {
        errorDetail = detail;
      } else if (Array.isArray(detail) && detail[0]?.msg) {
        errorDetail = detail[0].msg;
      }
    } catch (_) {}
    throw apiError(errorDetail, response.status);
  }

  if (response.status === 204) {
    return { ok: true };
  }

  try {
    return await response.json();
  } catch (_) {
    return { ok: true };
  }
}

// ==============================================================================
// BIRGE WEB CLIENT — CORE HTTP CLIENT, TOKEN STORAGE & SESSION REFRESH
// ==============================================================================
import { getAuthBaseUrl, isNativeApp } from '../platform';

const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
export const API_URL = configuredApiUrl || 'https://birge-api.onrender.com';

// In web/PWA, auth goes through the same-origin /api/auth proxy so the
// HttpOnly refresh cookie is first-party. In packaged Capacitor WebView builds,
// there is no Vercel proxy so auth targets `${API_URL}/auth` directly.
export const AUTH_URL = getAuthBaseUrl(API_URL);

const LEGACY_ACCESS_TOKEN_KEY = 'birge_token';
const LEGACY_REFRESH_TOKEN_KEY = 'birge_refresh_token';
const NATIVE_REFRESH_TOKEN_KEY = 'birge_native_refresh_token';
const CSRF_TOKEN_KEY = 'birge_csrf_token';

// On web, access and CSRF live outside refresh storage (refresh is HttpOnly cookie).
// Only packaged native WebView runtimes persist refresh_token for app restarts.
let accessToken = null;
let csrfToken = null;
let nativeRefreshToken = null;
try {
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
  csrfToken = localStorage.getItem(CSRF_TOKEN_KEY) || null;
  if (isNativeApp()) {
    nativeRefreshToken = localStorage.getItem(NATIVE_REFRESH_TOKEN_KEY) || null;
  } else {
    localStorage.removeItem(NATIVE_REFRESH_TOKEN_KEY);
  }
} catch (_) {
  // Storage can be unavailable in private browsing modes.
}

export const tokenStorage = {
  get: () => accessToken,
  set: (token) => { accessToken = token || null; },
  getCsrf: () => csrfToken,
  getNativeRefresh: () => (isNativeApp() ? nativeRefreshToken : null),
  setCsrf: (token) => {
    csrfToken = token || null;
    try {
      if (csrfToken) localStorage.setItem(CSRF_TOKEN_KEY, csrfToken);
      else localStorage.removeItem(CSRF_TOKEN_KEY);
    } catch (_) {}
  },
  setPair: (newAccessToken, newCsrfToken, newRefreshToken) => {
    accessToken = newAccessToken || null;
    if (newCsrfToken) {
      csrfToken = newCsrfToken;
      try { localStorage.setItem(CSRF_TOKEN_KEY, newCsrfToken); } catch (_) {}
    }
    if (isNativeApp() && newRefreshToken) {
      nativeRefreshToken = newRefreshToken;
      try { localStorage.setItem(NATIVE_REFRESH_TOKEN_KEY, newRefreshToken); } catch (_) {}
    }
  },
  clear: () => {
    accessToken = null;
    nativeRefreshToken = null;
    tokenStorage.setCsrf(null);
    try {
      localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
      localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
      localStorage.removeItem(NATIVE_REFRESH_TOKEN_KEY);
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
let warmUpPromise = null;
let lastWarmUpAt = 0;

const WARMUP_COOLDOWN_MS = 45000;
const REFRESH_TIMEOUT_MS = 40000;
const DEFAULT_TIMEOUT_MS = 65000;

/**
 * Wake up the Render backend directly via `/health`, bypassing the Vercel
 * `/api/auth` proxy timeout so cold starts finish before auth mutations run.
 */
export async function warmUpServer({ force = false, timeoutMs = 60000 } = {}) {
  if (typeof fetch !== 'function') return false;
  const now = Date.now();
  if (!force && lastWarmUpAt && (now - lastWarmUpAt) < WARMUP_COOLDOWN_MS) {
    return true;
  }
  if (warmUpPromise) return warmUpPromise;

  warmUpPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_URL}/health`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.ok) {
        lastWarmUpAt = Date.now();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
      warmUpPromise = null;
    }
  })();

  return warmUpPromise;
}

export function resetWarmUpStateForTests() {
  warmUpPromise = null;
  lastWarmUpAt = 0;
}

const isTransientWakeStatus = (status) => status === 502 || status === 503 || status === 504;

const requestUrl = (endpoint) => {
  if (endpoint.startsWith('/auth/')) {
    return `${getAuthBaseUrl(API_URL)}${endpoint.slice('/auth'.length)}`;
  }
  return `${API_URL}${endpoint}`;
};

async function attemptRefresh(authBaseUrl, csrf, nativeRefresh) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const fetchOptions = {
      method: 'POST',
      credentials: 'include',
      headers: nativeRefresh
        ? {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          }
        : { 'X-CSRF-Token': csrf },
      ...(nativeRefresh ? { body: JSON.stringify({ refresh_token: nativeRefresh }) } : {}),
      signal: controller.signal,
    };
    return await fetch(`${authBaseUrl}/refresh`, fetchOptions);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function refreshAccessToken() {
  const csrf = tokenStorage.getCsrf();
  const nativeRefresh = tokenStorage.getNativeRefresh();
  if (!csrf && !nativeRefresh) return false;
  if (refreshPromise) return refreshPromise;

  const authBaseUrl = getAuthBaseUrl(API_URL);
  refreshPromise = (async () => {
    try {
      let response;
      try {
        response = await attemptRefresh(authBaseUrl, csrf, nativeRefresh);
      } catch (firstErr) {
        if (firstErr?.name === 'AbortError') {
          await warmUpServer({ force: true });
          response = await attemptRefresh(authBaseUrl, csrf, nativeRefresh);
        } else {
          throw firstErr;
        }
      }
      if (isTransientWakeStatus(response.status)) {
        await warmUpServer({ force: true });
        response = await attemptRefresh(authBaseUrl, csrf, nativeRefresh);
      }
      if (response.status === 401 || response.status === 403) return false;
      if (!response.ok) {
        throw apiError(`Ошибка ${response.status}`, response.status);
      }
      const data = await response.json();
      if (!data?.access_token) return false;
      tokenStorage.setPair(data.access_token, data.csrf_token, data.refresh_token);
      return true;
    } catch (error) {
      if (error.status) throw error;
      throw apiError('Сервер не отвечает. Попробуйте ещё раз.');
    } finally {
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
  const { retryOnWake = false, ...fetchInit } = options;
  const token = tokenStorage.get();
  const isFormData = typeof FormData !== 'undefined' && fetchInit.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchInit.headers || {}),
  };

  const url = requestUrl(endpoint);
  const runOnce = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await fetch(url, {
        credentials: 'include',
        ...fetchInit,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let response;
  try {
    response = await runOnce();
    if (retryOnWake && isTransientWakeStatus(response.status)) {
      await warmUpServer({ force: true });
      response = await runOnce();
    }
  } catch (netErr) {
    if (retryOnWake && netErr?.name === 'AbortError') {
      try {
        await warmUpServer({ force: true });
        response = await runOnce();
      } catch (retryErr) {
        if (retryErr?.name === 'AbortError') {
          throw apiError('Сервер не отвечает. Попробуйте ещё раз.');
        }
        throw apiError('Не удалось подключиться к серверу. Проверьте интернет-соединение.');
      }
    } else if (netErr.name === 'AbortError') {
      throw apiError('Сервер не отвечает. Попробуйте ещё раз.');
    } else {
      throw apiError('Не удалось подключиться к серверу. Проверьте интернет-соединение.');
    }
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

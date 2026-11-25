import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  getCurrentUserId,
  stripLegacyTokenFromUrl,
  takeLoginCodeFromUrl,
  tokenStorage,
} from './api';

function makeToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

describe('getCurrentUserId', () => {
  beforeEach(() => {
    localStorage.clear();
    tokenStorage.clear();
  });

  it('reads sub from a base64url JWT', () => {
    tokenStorage.set(makeToken({ sub: '42' }));
    expect(getCurrentUserId()).toBe(42);
  });

  it('returns null for a malformed token', () => {
    tokenStorage.set('not-a-jwt');
    expect(getCurrentUserId()).toBeNull();
  });
});

describe('SSE tickets', () => {
  beforeEach(() => {
    localStorage.clear();
    tokenStorage.clear();
    tokenStorage.set('access-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests a short-lived ticket instead of putting access token in SSE URL', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ticket: 'short-ticket', expires_in: 60 }),
    }));

    await expect(api.createSseTicket('requester')).resolves.toEqual({
      ticket: 'short-ticket',
      expires_in: 60,
    });

    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('/trip-requests/sse-ticket?stream=requester');
    expect(url).not.toContain('token=');
  });
});

describe('login exchange code', () => {
  beforeEach(() => {
    localStorage.clear();
    tokenStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a legacy access token passed in the URL', () => {
    window.history.replaceState({}, '', '/?token=leaked-access-token');

    expect(tokenStorage.get()).toBeNull();
    expect(localStorage.getItem('birge_token')).toBeNull();
  });

  it('removes a legacy access token from the URL without storing it', () => {
    window.history.replaceState({}, '', '/trips/5?token=leaked-access-token&ref=bot');

    stripLegacyTokenFromUrl();

    expect(window.location.search).toBe('?ref=bot');
    expect(tokenStorage.get()).toBeNull();
    expect(tokenStorage.getCsrf()).toBeNull();
  });

  it('removes a one-time code from the URL before exchanging it', async () => {
    window.history.replaceState({}, '', '/trips/5?code=one-time-code&ref=bot');

    expect(takeLoginCodeFromUrl()).toBe('one-time-code');
    expect(window.location.search).toBe('?ref=bot');

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-access', csrf_token: 'csrf-token' }),
    }));

    await api.exchangeLoginCode('one-time-code');

    expect(tokenStorage.get()).toBe('new-access');
    expect(tokenStorage.getCsrf()).toBe('csrf-token');
    expect(localStorage.getItem('birge_token')).toBeNull();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/exchange-code');
    expect(options.body).toContain('one-time-code');
    expect(options.credentials).toBe('include');
  });
});

describe('auth refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    tokenStorage.clear();
    window.history.replaceState({}, '', '/');
    tokenStorage.setPair('expired-access', 'csrf-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes an expired access token and retries the request', async () => {
    const responses = [
      { ok: false, status: 401, json: async () => ({}) },
      {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'new-access', csrf_token: 'csrf-token' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          id: 7,
          name: 'Тест',
          phone: '+996555000007',
          reviews: [],
        }),
      },
    ];
    global.fetch = vi.fn(async () => responses.shift());

    const user = await api.getCurrentUser();

    expect(user.id).toBe(7);
    expect(tokenStorage.get()).toBe('new-access');
    expect(tokenStorage.getCsrf()).toBe('csrf-token');
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const [refreshUrl, refreshOptions] = global.fetch.mock.calls[1];
    expect(refreshUrl).toContain('/auth/refresh');
    expect(refreshOptions.body).toBeUndefined();
    expect(refreshOptions.credentials).toBe('include');
    expect(refreshOptions.headers['X-CSRF-Token']).toBe('csrf-token');
  });

  it('clears the session when refresh fails', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const unauthorized = vi.fn();
    window.addEventListener('birge:unauthorized', unauthorized, { once: true });

    await expect(api.getCurrentUser()).resolves.toBeNull();
    expect(tokenStorage.get()).toBeNull();
    expect(tokenStorage.getCsrf()).toBeNull();
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('restores a reloaded session from the HttpOnly refresh cookie', async () => {
    tokenStorage.clear();
    tokenStorage.setCsrf('csrf-token');
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'restored-access', csrf_token: 'csrf-token' }),
    }));

    await expect(api.restoreSession()).resolves.toBe(true);
    expect(tokenStorage.get()).toBe('restored-access');
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/refresh');
    expect(options.credentials).toBe('include');
  });

  it('does not call refresh without the CSRF nonce', async () => {
    tokenStorage.clear();
    global.fetch = vi.fn();

    await expect(api.restoreSession()).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('clears local tokens even when the logout request fails', async () => {
    tokenStorage.setPair('access-token', 'csrf-token');
    global.fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    await api.logout();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(tokenStorage.get()).toBeNull();
    expect(tokenStorage.getCsrf()).toBeNull();
  });
});

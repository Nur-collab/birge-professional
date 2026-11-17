import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getCurrentUserId, tokenStorage } from './api';

function makeToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

describe('getCurrentUserId', () => {
  beforeEach(() => {
    localStorage.clear();
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

describe('auth refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    tokenStorage.setPair('expired-access', 'valid-refresh');
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
        json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh' }),
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
    expect(tokenStorage.getRefresh()).toBe('new-refresh');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('clears the session when refresh fails', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const unauthorized = vi.fn();
    window.addEventListener('birge:unauthorized', unauthorized, { once: true });

    await expect(api.getCurrentUser()).resolves.toBeNull();
    expect(tokenStorage.get()).toBeNull();
    expect(tokenStorage.getRefresh()).toBeNull();
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('clears local tokens even when the logout request fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    await api.logout();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(tokenStorage.get()).toBeNull();
    expect(tokenStorage.getRefresh()).toBeNull();
  });
});

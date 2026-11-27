import { authFetch, restoreSession, tokenStorage } from './client';
import { closeActiveChatSocket } from './chat';

function persistSessionTokens(data) {
  if (data?.access_token) {
    tokenStorage.setPair(data.access_token, data.csrf_token);
  }
  return data;
}

export const authApi = {
  sendCode: async (phone) => {
    return authFetch('/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  },

  verifyCode: async (phone, code, name = '') => {
    const data = await authFetch('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone, code, ...(name ? { name } : {}) }),
    });
    return persistSessionTokens(data);
  },

  exchangeLoginCode: async (code) => {
    const data = await authFetch('/auth/exchange-code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    return persistSessionTokens(data);
  },

  createTelegramChallenge: async () => {
    return authFetch('/auth/telegram-challenge', {
      method: 'POST',
    });
  },

  getTelegramChallengeStatus: async (challengeId, verifier) => {
    return authFetch('/auth/telegram-challenge/status', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challengeId,
        verifier,
      }),
    });
  },

  completeTelegramChallenge: async (challengeId, verifier, name = '') => {
    const data = await authFetch('/auth/telegram-challenge/complete', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challengeId,
        verifier,
        ...(name ? { name } : {}),
      }),
    });
    return persistSessionTokens(data);
  },

  restoreSession,

  requestLoginCode: async () => {
    return authFetch('/auth/login-code', { method: 'POST' });
  },

  logout: async () => {
    try {
      // Revoke the refresh token on the server too, not only in this browser.
      await authFetch('/auth/logout', { method: 'POST' });
    } catch (_) {
      // Local logout must still work when the network or API is unavailable.
    }
    tokenStorage.clear();
    closeActiveChatSocket();
  },
};

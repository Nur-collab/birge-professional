import React from 'react';

export const BOT_URL = 'https://t.me/BirgeAuthBot';
export const LOGIN_FLOW_STORAGE_KEY = 'birge_login_flow_v1';
export const RESEND_COOLDOWN_SECONDS = 60;
export const RESCUE_HINT_DELAY_SECONDS = 8;
export const CHALLENGE_POLL_INTERVAL_MS = 2500;

export const readStoredFlow = () => {
  try {
    const sessionRaw = window.sessionStorage.getItem(LOGIN_FLOW_STORAGE_KEY);
    const raw = sessionRaw || window.localStorage.getItem(LOGIN_FLOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!sessionRaw) {
      // Only recover unexpired Telegram challenges if the OS evicted sessionStorage.
      if (
        parsed.step !== 'telegram'
        || !parsed.challenge?.expiresAt
        || Date.now() > parsed.challenge.expiresAt
      ) {
        window.localStorage.removeItem(LOGIN_FLOW_STORAGE_KEY);
        return null;
      }
      return parsed;
    }
    if (parsed.challenge?.expiresAt && Date.now() > parsed.challenge.expiresAt) {
      const cleaned = {
        ...parsed,
        step: parsed.step === 'telegram' ? 'phone' : parsed.step,
        challenge: null,
      };
      writeStoredFlow(cleaned);
      return cleaned;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writeStoredFlow = (state) => {
  try {
    if (!state || (state.step === 'phone' && !state.phone && !state.tgOpened && !state.challenge)) {
      window.sessionStorage.removeItem(LOGIN_FLOW_STORAGE_KEY);
      window.localStorage.removeItem(LOGIN_FLOW_STORAGE_KEY);
      return;
    }
    const serialized = JSON.stringify(state);
    window.sessionStorage.setItem(LOGIN_FLOW_STORAGE_KEY, serialized);
    // Only persist time-bounded Telegram deep-link challenges across OS app switches.
    if (state.step === 'telegram' && state.challenge?.expiresAt) {
      window.localStorage.setItem(LOGIN_FLOW_STORAGE_KEY, serialized);
    } else {
      window.localStorage.removeItem(LOGIN_FLOW_STORAGE_KEY);
    }
  } catch {
    // Private browsing or storage quota exceeded must not block login.
  }
};

export const clearStoredFlow = () => {
  try {
    window.sessionStorage.removeItem(LOGIN_FLOW_STORAGE_KEY);
    window.localStorage.removeItem(LOGIN_FLOW_STORAGE_KEY);
  } catch {
    // Ignore storage errors on cleanup.
  }
};

export const mapAuthError = (message, t) => {
  if (!message) return t('auth.error_invalid_code');
  if (/invalid,\s*expired,\s*or\s*locked\s*code/i.test(message)) {
    return t('auth.error_expired_code');
  }
  if (/invalid,\s*unverified,\s*or\s*expired\s*telegram\s*challenge/i.test(message)) {
    return t('auth.error_expired_tg');
  }
  if (/phone number required/i.test(message)) {
    return t('auth.error_phone_required');
  }
  if (/too many requests/i.test(message)) {
    return t('auth.error_too_many');
  }
  return message;
};

export const formatLocalPhone = (val) => {
  let digits = (val || '').replace(/\D/g, '');
  if (digits.startsWith('996')) digits = digits.slice(3);
  if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
  digits = digits.slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
};

export const KyrgyzstanFlag = () => (
  <svg width="20" height="14" viewBox="0 0 20 14" fill="none" className="kg-flag-svg" aria-hidden="true">
    <rect width="20" height="14" fill="#E8112D" />
    <circle cx="10" cy="7" r="3.2" fill="#FFE800" />
    <circle cx="10" cy="7" r="2.4" fill="#E8112D" />
    <circle cx="10" cy="7" r="1.8" fill="#FFE800" />
    <path d="M10 4.2V9.8M7.2 7H12.8M8 5.2L12 8.8M8 8.8L12 5.2" stroke="#E8112D" strokeWidth="0.6" />
  </svg>
);

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, takeLoginCodeFromUrl, tokenStorage } from '../utils/api';
import { loadTrip, saveTrip } from '../utils/tripStorage';

export default function useAuth({ clearActiveTrip }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [authRetry, setAuthRetry] = useState(0);
  const [currentUser, setCurrentUser] = useState(null);
  const [orphanedTrip, setOrphanedTrip] = useState(null);
  // StrictMode runs the auth effect twice. The first run removes ?code= from
  // the URL, so the second run must await the same exchange instead of
  // treating the session as empty.
  const loginCodeExchangeRef = useRef(null);

  // Инициализация авторизации по JWT-токену.
  // Сетевая ошибка НЕ должна разлогинивать: токен остаётся, показываем retry.
  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      setAuthError(false);

      // Magic links carry a one-time code, never an access token.
      const loginCode = takeLoginCodeFromUrl();
      if (loginCode) {
        loginCodeExchangeRef.current = api.exchangeLoginCode(loginCode)
          .catch(() => null);
      }
      const exchange = loginCodeExchangeRef.current;
      if (exchange) {
        await exchange;
        loginCodeExchangeRef.current = null;
        // The first StrictMode pass is already superseded by the second one.
        if (cancelled) return;
      }

      // Access token is memory-only, so a reload must restore the session
      // from the HttpOnly refresh cookie before deciding to show the login.
      let restored = Boolean(tokenStorage.get());
      if (!restored) {
        try {
          restored = await api.restoreSession();
        } catch (e) {
          if (cancelled) return;
          // Do not sign out on a cold Render / network error.
          setAuthError(true);
          setAuthLoading(false);
          return;
        }
        if (cancelled) return;
      }
      if (!restored) {
        setAuthLoading(false);
        setIsLoggedIn(false);
        setCurrentUser(null);
        return;
      }
      try {
        const profile = await api.getCurrentUser();
        if (cancelled) return;
        if (profile) {
          setCurrentUser(profile);
          setIsLoggedIn(true);
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
          }
          if (!loadTrip()) {
            try {
              const activeRes = await api.getActiveTrip();
              if (!cancelled && activeRes?.found) setOrphanedTrip(activeRes);
            } catch (_) {
              // Активная поездка не критична для входа.
            }
          }
        } else {
          tokenStorage.clear();
          setIsLoggedIn(false);
          setCurrentUser(null);
        }
      } catch (e) {
        if (cancelled) return;
        if (e.status === 401 || e.status === 403) {
          tokenStorage.clear();
          setIsLoggedIn(false);
          setCurrentUser(null);
        } else {
          setAuthError(true);
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };

    initAuth();

    const handleUnauthorized = () => {
      setIsLoggedIn(false);
      setCurrentUser(null);
      saveTrip(null);
      clearActiveTrip();
    };

    window.addEventListener('birge:unauthorized', handleUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener('birge:unauthorized', handleUnauthorized);
    };
  }, [authRetry, clearActiveTrip]);

  const handleLoggedIn = (user) => {
    if (!user) return;
    setCurrentUser(user);
    setIsLoggedIn(true);
    if (!loadTrip()) {
      api.getActiveTrip().then((res) => {
        if (res?.found) setOrphanedTrip(res);
      }).catch(() => {});
    }
  };

  const handleLogout = async () => {
    // Do not make the UI wait for the network: local logout is immediate.
    saveTrip(null);
    setCurrentUser(null);
    clearActiveTrip();
    setOrphanedTrip(null);
    setIsLoggedIn(false);
    await api.logout();
  };

  const retryAuth = useCallback(() => {
    setAuthLoading(true);
    setAuthRetry((n) => n + 1);
  }, []);

  return {
    isLoggedIn,
    authLoading,
    authError,
    currentUser,
    setCurrentUser,
    orphanedTrip,
    setOrphanedTrip,
    handleLoggedIn,
    handleLogout,
    retryAuth,
  };
}

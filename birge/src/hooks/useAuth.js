import { useCallback, useEffect, useState } from 'react';
import { api, tokenStorage } from '../utils/api';
import { loadTrip, saveTrip } from '../utils/tripStorage';

export default function useAuth({ clearActiveTrip }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [authRetry, setAuthRetry] = useState(0);
  const [currentUser, setCurrentUser] = useState(null);
  const [orphanedTrip, setOrphanedTrip] = useState(null);

  // Инициализация авторизации по JWT-токену.
  // Сетевая ошибка НЕ должна разлогинивать: токен остаётся, показываем retry.
  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      setAuthError(false);
      const token = tokenStorage.get();
      if (!token) {
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
    api.logout();
    saveTrip(null);
    setCurrentUser(null);
    clearActiveTrip();
    setOrphanedTrip(null);
    setIsLoggedIn(false);
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';

export default function useIncomingRequests({ currentUser, myTripId, activeTrip }) {
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const seenRequestIds = useRef(new Set());

  // Подписка на входящие запросы для ВОДИТЕЛЯ через опрос бэкенда.
  // Активна пока водитель в поиске (myTripId) или в активной поездке (activeTrip).
  useEffect(() => {
    if (!currentUser || (!myTripId && !activeTrip)) return;

    /** Звук + вибрация при новом запросе */
    const playNotificationSound = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } catch (_) { }
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    };

    const unsubscribe = api.subscribeIncomingRequests((requests) => {
      setPendingRequestCount(requests.length);
      // Показываем модал для новых запросов
      const newReq = requests.find((r) => !seenRequestIds.current.has(r.id));
      if (newReq) {
        seenRequestIds.current.add(newReq.id);
        setIncomingRequest(newReq);
        playNotificationSound();
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
          new Notification('Новый запрос на поездку', {
            body: `${newReq.requester_name} хочет присоединиться`,
            icon: '/pwa-192x192.png',
          });
        }
      }
    });

    return () => unsubscribe();
  }, [currentUser, myTripId, activeTrip]);

  const dismissIncomingRequest = useCallback(() => setIncomingRequest(null), []);
  const decrementPendingRequestCount = useCallback(() => {
    setPendingRequestCount((prev) => Math.max(0, prev - 1));
  }, []);

  return {
    incomingRequest,
    pendingRequestCount,
    dismissIncomingRequest,
    decrementPendingRequestCount,
  };
}

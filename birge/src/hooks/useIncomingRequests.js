import { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_URL } from '../utils/api';
import { showSystemNotificationSafely } from '../utils/platform';

const FALLBACK_POLL_MS = 15000;

export default function useIncomingRequests({ currentUser, myTripId, activeTrip }) {
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const seenRequestIds = useRef(new Set());
  const audioCtxRef = useRef(null);

  const playNotificationSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioCtx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
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
      }
    } catch (_) {
      // Audio playback can be blocked before user interaction.
    }
    try {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } catch (_) {}
  }, []);

  useEffect(() => () => {
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && typeof ctx.close === 'function') {
      ctx.close().catch(() => {});
    }
  }, []);

  // Подписка на входящие запросы для ВОДИТЕЛЯ: мгновенный SSE + резервный polling.
  // Активна пока водитель в поиске (myTripId) или в активной поездке (activeTrip).
  useEffect(() => {
    if (!currentUser || (!myTripId && !activeTrip)) return undefined;

    let cancelled = false;
    let es = null;
    let reconnectTimer = null;
    let reconnectDelay = 3000;

    const notifyNewRequest = (req) => {
      if (!req?.id || seenRequestIds.current.has(req.id)) return;
      seenRequestIds.current.add(req.id);
      setIncomingRequest(req);
      playNotificationSound();
      showSystemNotificationSafely('Новый запрос на поездку', {
        body: `${req.requester_name} хочет присоединиться`,
        icon: '/pwa-192x192.png',
      });
    };

    const syncRequests = async () => {
      if (cancelled) return;
      try {
        const requests = await api.getIncomingRequests();
        if (cancelled || !Array.isArray(requests)) return;
        setPendingRequestCount(requests.length);
        const newReq = requests.find((r) => !seenRequestIds.current.has(r.id));
        if (newReq) notifyNewRequest(newReq);
      } catch (_) {}
    };

    const handleSseEvent = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.event === 'passenger_cancelled') {
          syncRequests();
          return;
        }
        if (payload?.id && payload?.status === 'pending') {
          if (!seenRequestIds.current.has(payload.id)) {
            setPendingRequestCount((prev) => prev + 1);
          }
          notifyNewRequest(payload);
        }
      } catch (_) {}
    };

    const connectSse = async () => {
      if (cancelled || typeof EventSource === 'undefined') return;
      try {
        const ticketData = await api.createSseTicket('driver');
        if (cancelled) return;
        if (!ticketData?.ticket) throw new Error('SSE ticket is missing');

        const source = new EventSource(
          `${API_URL}/trip-requests/driver-events/${currentUser.id}?ticket=${encodeURIComponent(ticketData.ticket)}`
        );
        es = source;
        source.onopen = () => {
          reconnectDelay = 3000;
        };
        source.addEventListener('new_request', handleSseEvent);
        source.onerror = () => {
          source.close();
          if (es === source) es = null;
          if (!cancelled) {
            clearTimeout(reconnectTimer);
            const delay = reconnectDelay;
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
            reconnectTimer = setTimeout(connectSse, delay);
          }
        };
      } catch (_) {
        if (!cancelled) {
          clearTimeout(reconnectTimer);
          const delay = reconnectDelay;
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          reconnectTimer = setTimeout(connectSse, delay);
        }
      }
    };

    syncRequests();
    connectSse();
    const fallbackPoll = setInterval(syncRequests, FALLBACK_POLL_MS);

    const handleResume = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      syncRequests();
      if (!es || es.readyState === EventSource.CLOSED) {
        reconnectDelay = 3000;
        connectSse();
      }
    };
    const handleOnline = () => {
      if (cancelled) return;
      syncRequests();
      if (!es || es.readyState === EventSource.CLOSED) {
        reconnectDelay = 3000;
        connectSse();
      }
    };
    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      clearInterval(fallbackPoll);
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('online', handleOnline);
      es?.close();
    };
  }, [currentUser, myTripId, activeTrip, playNotificationSound]);

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

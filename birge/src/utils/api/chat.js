import { API_URL, authFetch, getCurrentUserId } from './client';

let activeChatWs = null;

export function closeActiveChatSocket() {
  if (activeChatWs) {
    try { activeChatWs.close(); } catch (_) {}
    activeChatWs = null;
  }
}

export const chatApi = {
  getTripMessages: async (tripId) => {
    const msgs = await authFetch(`/trips/${tripId}/messages`);
    if (!Array.isArray(msgs)) return [];
    return msgs.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      senderName: m.sender?.name || 'Пользователь',
      text: m.text,
      time: m.timestamp || '',
    }));
  },

  createWsTicket: async (tripId) => {
    return authFetch(`/trips/${tripId}/ws-ticket`, { method: 'POST' });
  },

  /** @returns {Promise<{ticket: string, expires_in: number}>} */
  createSseTicket: async (stream) => {
    return authFetch(
      `/trip-requests/sse-ticket?stream=${encodeURIComponent(stream)}`,
      { method: 'POST' },
    );
  },

  subscribeTripMessages: (tripId, callback) => {
    let active = true;
    const userId = getCurrentUserId();
    let ws = null;
    let pollInterval = null;
    let reconnectTimer = null;
    let reconnectDelay = 2000;
    const messagesById = new Map();

    const emitSorted = () => {
      const sorted = [...messagesById.values()].sort((a, b) => a.id - b.id);
      callback(sorted);
    };

    const replaceHistory = (list) => {
      if (!Array.isArray(list)) return;
      messagesById.clear();
      for (const item of list) {
        if (item?.id != null) messagesById.set(item.id, item);
      }
      emitSorted();
    };

    const loadHistory = async () => {
      try {
        const history = await chatApi.getTripMessages(tripId);
        if (active) replaceHistory(history);
      } catch (_) {}
    };

    const stopPolling = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const startPolling = () => {
      if (pollInterval || !active) return;
      pollInterval = setInterval(async () => {
        if (!active) return;
        try {
          const fresh = await chatApi.getTripMessages(tripId);
          if (active) replaceHistory(fresh);
        } catch (_) {}
      }, 3000);
    };

    const scheduleReconnect = () => {
      if (!active || !userId) return;
      clearTimeout(reconnectTimer);
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (!active || !userId || typeof WebSocket === 'undefined') {
        startPolling();
        return;
      }
      try {
        // Use a one-time short-lived WS ticket instead of putting JWT in the URL.
        const ticketData = await chatApi.createWsTicket(tripId);
        if (!active) return;
        if (!ticketData?.ticket) throw new Error('WebSocket ticket is missing');

        const wsUrl = API_URL.replace(/^https/, 'wss').replace(/^http/, 'ws');
        const socket = new WebSocket(
          `${wsUrl}/ws/chat/${tripId}/${userId}?ticket=${encodeURIComponent(ticketData.ticket)}`
        );
        ws = socket;
        activeChatWs = socket;

        socket.onopen = () => {
          reconnectDelay = 2000;
          stopPolling();
        };

        socket.onmessage = (event) => {
          if (!active) return;
          try {
            const payload = JSON.parse(event.data);
            if (payload?.error) return;
            if (payload?.id != null && typeof payload?.text === 'string') {
              messagesById.set(payload.id, {
                id: payload.id,
                senderId: payload.sender_id,
                senderName: payload.sender_name || 'Пользователь',
                text: payload.text,
                time: payload.timestamp || '',
              });
              emitSorted();
              return;
            }
          } catch (_) {}
          loadHistory();
        };

        socket.onerror = () => {
          startPolling();
        };

        socket.onclose = () => {
          if (activeChatWs === socket) activeChatWs = null;
          if (ws === socket) ws = null;
          if (active) {
            startPolling();
            scheduleReconnect();
          }
        };
      } catch (_) {
        startPolling();
        scheduleReconnect();
      }
    };

    loadHistory();
    connect();

    return () => {
      active = false;
      clearTimeout(reconnectTimer);
      stopPolling();
      if (ws) {
        try { ws.close(); } catch (_) {}
        if (activeChatWs === ws) activeChatWs = null;
      }
    };
  },

  sendChatMessage: async (tripId, text) => {
    const trimmed = text?.trim();
    if (!trimmed) return null;
    // Send over REST so the server persists before broadcasting over WS.
    return authFetch(`/trips/${tripId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text: trimmed }),
    });
  },
};

export const safetyApi = {
  submitReview: async (userId, rating, text, tripId = null) => {
    return authFetch('/reviews/', {
      method: 'POST',
      body: JSON.stringify({
        user_id: Number(userId),
        rating: Number(rating),
        text: text || '',
        ...(tripId ? { trip_id: Number(tripId) } : {}),
      }),
    });
  },

  sendPanic: async (tripId) => {
    try {
      return await authFetch(`/trips/${tripId}/panic`, { method: 'POST' });
    } catch (e) {
      console.error('[sendPanic]', e);
      return { sent: false, reason: e.message };
    }
  },

  registerPushToken: async (_token) => {
    return { ok: true };
  },
};

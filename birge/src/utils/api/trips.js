import { authFetch, getCurrentUserId, tokenStorage } from './client';

/**
 * @typedef {import('../../types/api').components['schemas']['Trip']} ApiTrip
 * @typedef {ApiTrip & {
 *   from: string,
 *   to: string,
 *   userId: number,
 *   user_id: number,
 *   isDriver: boolean,
 *   driverCarModel: string | null,
 *   driverCarPlate: string | null,
 *   driverCarColor: string | null,
 * }} TripView
 */

export const tripsApi = {
  createTrip: async (tripData) => {
    return authFetch('/trips/', {
      method: 'POST',
      body: JSON.stringify({
        role: tripData.role,
        origin: tripData.origin,
        destination: tripData.destination,
        time: tripData.time,
        date: tripData.date || null,
        seats: tripData.seats || 3,
        price_per_seat: tripData.price_per_seat || tripData.price || 0,
      }),
    });
  },

  findMatches: async (_userId, role, origin, destination, time, _seats = 1, date = null) => {
    const params = new URLSearchParams({
      role,
      origin,
      destination,
      time,
      ...(date ? { date } : {}),
    });

    const list = await authFetch(`/trips/matches?${params.toString()}`);
    if (!Array.isArray(list)) return [];

    return list.map((t) => ({
      id: t.id,
      trip_id: t.id,
      role: t.role,
      from: t.origin,
      to: t.destination,
      origin: t.origin,
      destination: t.destination,
      time: t.time,
      date: t.date || null,
      seats: t.seats || 3,
      seats_taken: t.seats_taken || 0,
      price_per_seat: t.price_per_seat || 0,
      userId: t.user?.id || t.user_id,
      user_id: t.user?.id || t.user_id,
      user: {
        id: t.user?.id || t.user_id,
        name: t.user?.name || 'Пользователь',
        photo: t.user?.photo || `https://i.pravatar.cc/150?u=${t.user_id}`,
        trust_rating: t.user?.trust_rating ?? 5.0,
        is_verified: t.user?.is_verified ?? false,
        car_model: t.user?.car_model || null,
        car_plate: t.user?.car_plate || null,
        car_color: t.user?.car_color || null,
      },
    }));
  },

  getMyTrips: async () => {
    return authFetch('/users/me/trips');
  },

  getActiveTrip: async () => {
    return authFetch('/users/me/active-trip');
  },

  /** @returns {Promise<TripView>} */
  getTrip: async (tripId) => {
    const trip = await authFetch(`/trips/${tripId}`);
    const currentUserId = getCurrentUserId();
    return {
      ...trip,
      from: trip.origin,
      to: trip.destination,
      userId: trip.user_id,
      user_id: trip.user_id,
      isDriver: trip.user_id === currentUserId,
      driverCarModel: trip.user?.car_model || null,
      driverCarPlate: trip.user?.car_plate || null,
      driverCarColor: trip.user?.car_color || null,
    };
  },

  getScheduledTrips: async () => {
    return authFetch('/users/me/scheduled-trips');
  },

  updateTripStatus: async (tripId, status) => {
    return authFetch(`/trips/${tripId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  cancelTrip: async (tripId) => {
    return authFetch(`/trips/${tripId}`, {
      method: 'DELETE',
    });
  },

  cancelScheduledTrip: async (tripId) => tripsApi.cancelTrip(tripId),

  getTripPassengers: async (tripId) => {
    return authFetch(`/trips/${tripId}/passengers`);
  },

  getTripPayment: async (tripId) => {
    return authFetch(`/trips/${tripId}/payment`);
  },

  // ─── TRIP REQUESTS ────────────────────────────────────────

  sendTripRequest: async (driverTripId, myTripId, driverId) => {
    return authFetch('/trip-requests/', {
      method: 'POST',
      body: JSON.stringify({
        trip_id: Number(driverTripId),
        requester_trip_id: myTripId ? Number(myTripId) : null,
        driver_id: driverId ? Number(driverId) : null,
      }),
    });
  },

  getIncomingRequests: async () => {
    return authFetch('/trip-requests/incoming/');
  },

  respondToRequest: async (requestId, action) => {
    const status = action === 'accept' ? 'accepted' : 'declined';
    return authFetch(`/trip-requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  checkRequestStatus: async (tripId) => {
    return authFetch(`/trip-requests/status/${tripId}`);
  },

  checkRequestsStatuses: async (tripIds = []) => {
    const cleanIds = [...new Set(
      (tripIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )].slice(0, 50);
    if (cleanIds.length === 0) return [];
    const data = await authFetch(`/trip-requests/statuses?trip_ids=${cleanIds.join(',')}`);
    return Array.isArray(data?.items) ? data.items : [];
  },

  subscribeIncomingRequests: (callback) => {
    let active = true;
    const poll = async () => {
      if (!active || !tokenStorage.get()) return;
      try {
        const reqs = await tripsApi.getIncomingRequests();
        if (active && Array.isArray(reqs)) callback(reqs);
      } catch (_) {}
    };

    poll();
    const interval = setInterval(poll, 3500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  },

  subscribeRequestStatus: (tripId, callback) => {
    let active = true;
    const poll = async () => {
      if (!active || !tokenStorage.get()) return;
      try {
        const res = await tripsApi.checkRequestStatus(tripId);
        if (active && res) callback(res);
      } catch (_) {}
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  },
};

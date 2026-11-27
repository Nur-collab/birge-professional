/**
 * Normalize a trip object returned by `/trips/matches` for UI cards.
 */
export function mapMatchTrip(trip) {
  return {
    id: trip.id,
    role: trip.role,
    from: trip.origin,
    to: trip.destination,
    origin: trip.origin,
    destination: trip.destination,
    time: trip.time,
    date: trip.date || null,
    seats: trip.seats ?? 3,
    seats_taken: trip.seats_taken ?? 0,
    price_per_seat: trip.price_per_seat || 0,
    match_type: trip.match_type || null,
    detour_km: trip.detour_km ?? null,
    distance_km: trip.distance_km ?? null,
    eta_minutes: trip.eta_minutes ?? null,
    origin_lat: trip.origin_lat ?? null,
    origin_lng: trip.origin_lng ?? null,
    dest_lat: trip.dest_lat ?? null,
    dest_lng: trip.dest_lng ?? null,
    userId: trip.user_id,
    user_id: trip.user_id,
    user: {
      id: trip.user?.id,
      name: trip.user?.name || 'Пользователь',
      photo: trip.user?.photo || `https://i.pravatar.cc/150?u=${trip.user_id}`,
      trust_rating: trip.user?.trust_rating || 5.0,
      is_verified: trip.user?.is_verified || false,
      car_model: trip.user?.car_model || null,
    },
  };
}

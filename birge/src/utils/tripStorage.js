const TRIP_STORAGE_KEY = 'birge_active_trip';

export const saveTrip = (trip) => {
  try {
    if (trip) localStorage.setItem(TRIP_STORAGE_KEY, JSON.stringify(trip));
    else localStorage.removeItem(TRIP_STORAGE_KEY);
  } catch (_) {
    // localStorage может быть недоступен в приватном режиме.
  }
};

export const loadTrip = () => {
  try {
    return JSON.parse(localStorage.getItem(TRIP_STORAGE_KEY));
  } catch {
    return null;
  }
};

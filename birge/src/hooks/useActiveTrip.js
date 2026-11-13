import { useCallback, useState } from 'react';
import { loadTrip, saveTrip } from '../utils/tripStorage';

export default function useActiveTrip() {
  const [activeTrip, setActiveTripState] = useState(loadTrip);

  // Обёртка setActiveTrip — автоматически пишет/очищает localStorage
  const setActiveTrip = useCallback((trip) => {
    setActiveTripState(trip);
    saveTrip(trip);
  }, []);

  const clearActiveTrip = useCallback(() => {
    setActiveTripState(null);
    saveTrip(null);
  }, []);

  return { activeTrip, setActiveTrip, clearActiveTrip };
}

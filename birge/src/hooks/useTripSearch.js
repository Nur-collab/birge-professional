import { useEffect, useRef, useState } from 'react';
import i18n from '../i18n';
import { api } from '../utils/api';
import { mapMatchTrip } from '../utils/mapMatchTrip';

const MIN_SKELETON_MS = 450;

export default function useTripSearch({
  currentUser,
  setCurrentUser,
  setActiveTrip,
  setActiveTab,
  showNotification,
}) {
  const [matches, setMatches] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchCriteria, setSearchCriteria] = useState(null);
  const [myTripId, setMyTripId] = useState(null);
  const mountedRef = useRef(true);
  const skeletonTimerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(skeletonTimerRef.current);
    };
  }, []);

  const handleSearch = async (tripData) => {
    if (!currentUser) return showNotification(i18n.t('common.error'), i18n.t('hooks.user_load_error'));

    clearTimeout(skeletonTimerRef.current);
    // Очищаем старую поездку из localStorage чтобы избежать конфликтов
    setActiveTrip(null);
    setMyTripId(null);

    setActiveTab('matches');
    setMatches([]);
    setIsSearching(true);
    setSearchCriteria(tripData);

    try {
      const apiTripData = {
        role: tripData.role,
        origin: tripData.from,
        destination: tripData.to,
        time: tripData.time,
        date: tripData.date || null,
        seats: tripData.seats || 3,
        price_per_seat: tripData.price || 0,
        ...(tripData.recurrence_days ? { recurrence_days: tripData.recurrence_days } : {}),
      };

      const createdTrip = await api.createTrip(apiTripData);
      if (!mountedRef.current) return;
      setMyTripId(createdTrip.id);

      if (tripData.role === 'driver') {
        setCurrentUser((prev) => ({ ...prev, trips_today: (prev?.trips_today || 0) + 1 }));
      }

      const [foundMatches] = await Promise.all([
        api.findMatches(
          currentUser.id,
          tripData.role,
          tripData.from,
          tripData.to,
          tripData.time,
          tripData.seats,
          tripData.date || null
        ),
        new Promise((resolve) => {
          skeletonTimerRef.current = setTimeout(resolve, MIN_SKELETON_MS);
        }),
      ]);
      if (!mountedRef.current) return;

      const mappedMatches = (foundMatches || []).map(mapMatchTrip);
      setMatches(mappedMatches);
      setIsSearching(false);

      if (mappedMatches.length > 0) {
        showNotification(i18n.t('hooks.found_title'), i18n.t('hooks.found_count', { count: mappedMatches.length }));
      } else {
        showNotification(i18n.t('hooks.not_found_title'), i18n.t('hooks.not_found_desc'));
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setIsSearching(false);
      setActiveTab('home');
      showNotification(i18n.t('common.error'), error.message || i18n.t('hooks.search_failed'));
    }
  };

  const handleCancelSearch = async () => {
    clearTimeout(skeletonTimerRef.current);
    // Удаляем поездку из БД, чтобы не путала другим пользователям
    if (myTripId) {
      try {
        await api.cancelTrip(myTripId);
      } catch (e) {
        showNotification(i18n.t('common.error'), e.message);
        return;
      }
    }
    setMatches([]);
    setIsSearching(false);
    setMyTripId(null);
    setSearchCriteria(null);
    setActiveTab('home');
  };

  return {
    matches,
    setMatches,
    isSearching,
    searchCriteria,
    setSearchCriteria,
    myTripId,
    setMyTripId,
    handleSearch,
    handleCancelSearch,
  };
}

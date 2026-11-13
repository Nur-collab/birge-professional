import { useState } from 'react';
import { api } from '../utils/api';

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

  const handleSearch = async (tripData) => {
    if (!currentUser) return showNotification('Ошибка', 'Не удалось загрузить пользователя');

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
      };

      const createdTrip = await api.createTrip(apiTripData);
      // ID поездки берём напрямую из ответа бэкенда — надёжно и без лишнего запроса
      setMyTripId(createdTrip.id);

      if (tripData.role === 'driver') {
        setCurrentUser((prev) => ({ ...prev, trips_today: prev.trips_today + 1 }));
      }

      // Небольшая задержка для красивой анимации скелетонов
      setTimeout(async () => {
        const foundMatches = await api.findMatches(
          currentUser.id,
          tripData.role,
          tripData.from,
          tripData.to,
          tripData.time,
          tripData.seats,
          tripData.date || null
        );

        const mappedMatches = foundMatches.map((m) => ({
          id: m.id,
          role: m.role,
          from: m.origin,
          to: m.destination,
          origin: m.origin,
          destination: m.destination,
          time: m.time,
          date: m.date || null,
          price_per_seat: m.price_per_seat || 0,
          userId: m.user_id,
          user_id: m.user_id,
          user: {
            id: m.user?.id,
            name: m.user?.name || 'Пользователь',
            photo: m.user?.photo || `https://i.pravatar.cc/150?u=${m.user_id}`,
            trust_rating: m.user?.trust_rating || 5.0,
            is_verified: m.user?.is_verified || false,
            car_model: m.user?.car_model || null,
          },
        }));

        setMatches(mappedMatches);
        setIsSearching(false);

        if (mappedMatches.length > 0) {
          showNotification('Найдены попутчики', `Совпадений: ${mappedMatches.length}`);
        } else {
          showNotification('Пока нет совпадений', 'Мы уведомим вас, когда кто-то появится.');
        }
      }, 1200);

    } catch (error) {
      setIsSearching(false);
      setActiveTab('home');
      showNotification('Ошибка', error.message);
    }
  };

  const handleCancelSearch = async () => {
    // Удаляем поездку из БД, чтобы не путала другим пользователям
    if (myTripId) {
      try {
        await api.cancelTrip(myTripId);
      } catch (e) {
        showNotification('Ошибка', e.message);
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

import { api } from '../utils/api';
import { localDateStr } from '../utils/date';

export default function useTripActions({
  activeTrip,
  currentUser,
  incomingRequest,
  orphanedTrip,
  setActiveTrip,
  setActiveTab,
  setCurrentUser,
  setMatches,
  setMyTripId,
  setOrphanedTrip,
  setSearchCriteria,
  setShowReview,
  setUnreadCount,
  dismissIncomingRequest,
  decrementPendingRequestCount,
  showNotification,
}) {
  const handleConnect = async (trip) => {
    const todayStr = localDateStr();
    const tripDate = trip.date && trip.date !== 'Сегодня' ? trip.date : todayStr;
    const isScheduled = tripDate > todayStr;
    // Статус поездки меняет только бэкенд: matched — когда заняты все места,
    // scheduled — для будущей даты. Иначе 3-местная машина закрывалась бы
    // после первого же пассажира.
    setActiveTrip({ ...trip, participants: 2, date: trip.date || 'Сегодня', isScheduled });
    setActiveTab('trip');
    setUnreadCount(0);
    const msg = isScheduled
      ? `Поездка с ${trip.user?.name || 'попутчиком'} запланирована`
      : `Вы едете с ${trip.user?.name || 'попутчиком'}`;
    showNotification(isScheduled ? 'Запланировано' : 'Попутчик найден', msg);
  };

  // При acceptе пассажир тоже получает данные машины водителя через requestInfo
  const handleConnectPassenger = async (trip) => {
    const { requestInfo } = trip;
    const todayStr = localDateStr();
    const tripDate = trip.date && trip.date !== 'Сегодня' ? trip.date : todayStr;
    const isScheduled = tripDate > todayStr;
    // Пассажир не имеет права менять статус поездки водителя — это делает
    // бэкенд атомарно при accept. Здесь только открываем экран поездки.
    setActiveTrip({
      ...trip,
      participants: 2,
      date: trip.date || 'Сегодня',
      isScheduled,
      driverCarModel: requestInfo?.driver_car_model,
      driverCarPlate: requestInfo?.driver_car_plate,
      driverCarColor: requestInfo?.driver_car_color,
      driverName: requestInfo?.driver_name,
      driverPhoto: requestInfo?.driver_photo,
    });
    setActiveTab('trip');
    setUnreadCount(0);
    const msg = isScheduled
      ? 'Поездка с водителем запланирована'
      : `Вы едете с ${trip.user?.name || 'попутчиком'}`;
    showNotification(isScheduled ? 'Запланировано' : 'Попутчик найден', msg);
  };

  const handleAcceptRequest = async (requestId, tripId, requesterId, requesterTripId) => {
    const acceptedReq = incomingRequest; // сохраняем до сброса
    try {
      await api.respondToRequest(requestId, 'accept');
    } catch (e) {
      showNotification('Ошибка', e.message);
      return;
    }

    dismissIncomingRequest();
    decrementPendingRequestCount();

    // Если водитель уже в поездке — просто приняли запрос, polling обновит список
    if (activeTrip) {
      showNotification('Пассажир принят', `${acceptedReq?.requester_name} едет с вами`);
      return;
    }

    // Первый пассажир — переходим в экран поездки
    const tripForDriver = {
      id: tripId,         // ID поездки водителя = комната чата для всех
      user_id: requesterId,
      from: acceptedReq?.origin,
      to: acceptedReq?.destination,
      time: acceptedReq?.time,
      date: acceptedReq?.date,
      isDriver: true,
      seats: acceptedReq?.seats || 3,
      user: {
        id: requesterId,
        name: acceptedReq?.requester_name,
        photo: acceptedReq?.requester_photo,
        trust_rating: acceptedReq?.requester_rating || 5.0,
      },
    };
    await handleConnect(tripForDriver);
  };

  const handleDeclineRequest = async (requestId) => {
    try {
      await api.respondToRequest(requestId, 'decline');
    } catch (e) {
      showNotification('Ошибка', e.message);
      return;
    }
    dismissIncomingRequest();
    decrementPendingRequestCount();
  };

  const handleFinishTrip = () => {
    // Показываем модалку отзыва
    setShowReview(true);
  };

  const handleReviewSubmit = async (rating, text) => {
    if (activeTrip?.user?.id && currentUser) {
      // Сначала фиксируем завершение: бэкенд разрешает отзыв только по
      // завершённой заявке.
      try {
        await api.updateTripStatus(activeTrip.id, 'completed');
      } catch (_) {}
      try {
        await api.submitReview(activeTrip.user.id, rating, text, activeTrip.id);
      } catch (e) {
        showNotification('Ошибка', e.message);
        return;
      }
      try {
        // Обновляем профиль, чтобы новый рейтинг отобразился сразу
        const refreshed = await api.getCurrentUser();
        if (refreshed) setCurrentUser(refreshed);
      } catch (_) {}
    }
    // Закрываем через 1.5 сек после успешной отправки
    setTimeout(() => {
      setShowReview(false);
      setActiveTrip(null);
      setMatches([]);
      setSearchCriteria(null);
      setMyTripId(null);
      setActiveTab('home');
    }, 1500);
  };

  const handleReviewSkip = async () => {
    if (activeTrip) {
      try {
        await api.updateTripStatus(activeTrip.id, 'completed');
      } catch (_) {}
    }
    setShowReview(false);
    setActiveTrip(null);
    setMatches([]);
    setSearchCriteria(null);
    setMyTripId(null);
    setActiveTab('home');
    showNotification('Поездка завершена', 'До следующей встречи!');
  };

  const handleTripCancelled = () => {
    setActiveTrip(null);
    setMatches([]);
    setSearchCriteria(null);
    setMyTripId(null);
    setActiveTab('home');
    showNotification('Поездка отменена', 'Вы можете найти нового попутчика.');
  };

  /** Возобновить поиск: восстанавливаем myTripId и переходим на вкладку Матчей */
  const handleResumeOrphan = () => {
    if (!orphanedTrip) return;
    setMyTripId(orphanedTrip.trip_id);
    setSearchCriteria({
      role: orphanedTrip.role,
      from: orphanedTrip.origin,
      to: orphanedTrip.destination,
      time: orphanedTrip.time,
      date: orphanedTrip.date,
    });
    setOrphanedTrip(null);
    setActiveTab('matches');
  };

  /** Удалить оставшуюся поездку из БД, скрыть баннер */
  const handleDiscardOrphan = async () => {
    if (!orphanedTrip) return;
    try {
      await api.cancelTrip(orphanedTrip.trip_id);
      setOrphanedTrip(null);
    } catch (e) {
      showNotification('Ошибка', e.message);
    }
  };

  return {
    handleConnect,
    handleConnectPassenger,
    handleAcceptRequest,
    handleDeclineRequest,
    handleFinishTrip,
    handleReviewSubmit,
    handleReviewSkip,
    handleTripCancelled,
    handleResumeOrphan,
    handleDiscardOrphan,
  };
}

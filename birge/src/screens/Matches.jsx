import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Star, CheckCircle, Clock, Car, Send, Loader, Calendar, Navigation, X, CheckCircle2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SkeletonCard from '../components/SkeletonCard';
import StatePanel from '../components/StatePanel';
import { api, API_URL } from '../utils/api';
import { localDateStr } from '../utils/date';
import { mapMatchTrip } from '../utils/mapMatchTrip';


// Вспомогательные функции API для запросов
const requestApi = {
  sendRequest: async (tripId, requesterTripId, driverId) => {
    return api.sendTripRequest(tripId, requesterTripId, driverId);
  },
  checkStatuses: async (tripIds) => {
    return api.checkRequestsStatuses(tripIds);
  },
  checkStatus: async (tripId) => {
    return api.checkRequestStatus(tripId);
  }
};

const today = localDateStr();
const tomorrow = localDateStr(1);

const formatChipLabel = (d, t, language) => {
  if (!d) return t('common.no_date');
  if (d === today) return t('common.today');
  if (d === tomorrow) return t('common.tomorrow');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d).trim());
  const dt = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const locale = language === 'ky' ? 'ky-KG' : 'ru-RU';
  return dt.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
};

export default function Matches({
  matches = [],
  setMatches,
  onConnect,
  onCancel,
  isLoading = false,
  searchCriteria,
  currentUser,
  myTripId,
  activeTrip,
  onGoToActiveTrip,
}) {
  const { t, i18n } = useTranslation();
  const [requestStatus, setRequestStatus] = useState({}); // { [tripId]: 'pending'|'accepted'|'declined' }
  const [requestError, setRequestError] = useState('');
  const connectedRef = useRef(false); // защита от повторного вызова onConnect
  const [activeDateFilter, setActiveDateFilter] = useState(searchCriteria?.date || null);

  // Refs, чтобы SSE-эффект не пересоздавался при каждом обновлении списка матчей.
  const matchesRef = useRef(matches);
  const onConnectRef = useRef(onConnect);
  useEffect(() => { matchesRef.current = matches; }, [matches]);
  useEffect(() => { onConnectRef.current = onConnect; }, [onConnect]);

  // Синхронизируем фильтр при смене критериев поиска
  useEffect(() => {
    setActiveDateFilter(searchCriteria?.date || null);
  }, [searchCriteria?.date]);

  // Уникальные даты из матчей для чипсов
  const uniqueDates = useMemo(() => {
    const dates = [...new Set(matches.map(m => m.date || null))];
    return dates.sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [matches]);

  // Отфильтрованные матчи
  const filteredMatches = useMemo(() => {
    if (!activeDateFilter) return matches;
    return matches.filter(m => m.date === activeDateFilter || (!m.date && activeDateFilter === null));
  }, [matches, activeDateFilter]);

  // Автополлинг за совпадениями
  useEffect(() => {
    if (isLoading || !searchCriteria || !currentUser) return;
    const pollInterval = setInterval(async () => {
      try {
        const found = await api.findMatches(
          currentUser.id, searchCriteria.role, searchCriteria.from,
          searchCriteria.to, searchCriteria.time, 1, searchCriteria.date || null
        );
        const mapped = (found || []).map(mapMatchTrip);
        // Всегда обновляем: если водитель/пассажир завершил поездку и бэкенд вернул 0,
        // список очищается, убирая завершенных попутчиков из интерфейса
        setMatches(mapped);
      } catch (e) { console.error('Auto-poll error:', e); }
    }, 6000);
    return () => clearInterval(pollInterval);
  }, [isLoading, searchCriteria, currentUser, setMatches]);

  // Для пассажира: SSE (мгновенные уведомления) + fallback polling каждые 15 сек
  useEffect(() => {
    if (!currentUser || searchCriteria?.role !== 'passenger') return;
    connectedRef.current = false;

    const handleStatusUpdate = (st) => {
      if (!st?.status || st.status === 'not_sent') return;
      setRequestStatus(prev => ({ ...prev, [st.trip_id]: st.status }));
      if (st.status === 'accepted' && !connectedRef.current) {
        connectedRef.current = true;
        const currentMatches = matchesRef.current || [];
        const matchedTrip = currentMatches.find(m => m.id === st.trip_id) || currentMatches[0];
        const chatTripId = st.trip_id || matchedTrip?.id;
        if (chatTripId) {
          Promise.resolve(onConnectRef.current({ ...matchedTrip, id: chatTripId, requestInfo: st }))
            .catch(() => { connectedRef.current = false; });
        }
      }
    };

    // --- SSE: короткоживущий ticket вместо access-токена в URL ---
    let es = null;
    let reconnectTimer = null;
    let cancelled = false;

    const handleSseEvent = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Обрабатываем ответ водителя (accepted/declined)
        handleStatusUpdate(data);
        // Обрабатываем SSE-событие завершения поездки водителем
        if (data?.event === 'trip_completed' && !connectedRef.current) {
          connectedRef.current = true;
          const currentMatches = matchesRef.current || [];
          const matchedTrip = currentMatches.find(m => m.id === data.trip_id) || currentMatches[0];
          if (matchedTrip) {
            Promise.resolve(onConnectRef.current({
              ...matchedTrip,
              id: data.trip_id,
              requestInfo: { status: 'completed', trip_id: data.trip_id },
            })).catch(() => { connectedRef.current = false; });
          }
        }
      } catch (_) { }
    };

    const connectSse = async () => {
      if (cancelled || typeof EventSource === 'undefined') return;
      try {
        const ticketData = await api.createSseTicket('requester');
        if (cancelled) return;
        if (!ticketData?.ticket) throw new Error('SSE ticket is missing');

        const source = new EventSource(
          `${API_URL}/trip-requests/events/${currentUser.id}?ticket=${encodeURIComponent(ticketData.ticket)}`
        );
        es = source;
        source.addEventListener('request_update', handleSseEvent);
        source.onerror = () => {
          // Ticket живёт 60 секунд; после обрыва получаем новый.
          source.close();
          if (es === source) es = null;
          if (!cancelled) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectSse, 3000);
          }
        };
      } catch (_) {
        if (!cancelled) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectSse, 5000);
        }
      }
    };

    connectSse();

    // --- Fallback polling: каждые 15 сек одним батч-запросом (резервный вариант если SSE не работает) ---
    const pollReqStatus = setInterval(async () => {
      if (connectedRef.current) return; // уже подключились через SSE
      const tripIds = (matchesRef.current || []).map((trip) => trip.id).filter(Boolean);
      if (tripIds.length === 0) return;
      try {
        const items = await requestApi.checkStatuses(tripIds);
        for (const st of items) {
          handleStatusUpdate(st);
        }
      } catch (_) { }
    }, 15000);

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      es?.close();
      clearInterval(pollReqStatus);
    };
  }, [currentUser, searchCriteria]);

  const handleSendRequest = async (trip) => {
    if (!currentUser || !myTripId) return;
    setRequestError('');
    setRequestStatus(prev => ({ ...prev, [trip.id]: 'sending' }));
    try {
      // requester_id берётся из JWT — не передаём
      await requestApi.sendRequest(trip.id, myTripId, trip.user_id);
      setRequestStatus(prev => ({ ...prev, [trip.id]: 'pending' }));
    } catch (e) {
      setRequestStatus(prev => ({ ...prev, [trip.id]: null }));
      setRequestError(e.message);
    }
  };

  const isDriver = searchCriteria?.role === 'driver';

  if (activeTrip) {
    return (
      <div className="matches screen-content">
        <StatePanel
          badge={<>
            <CheckCircle2 size={14} aria-hidden="true" />
            {activeTrip.isScheduled ? t('matches.active_scheduled_badge') : t('matches.active_ongoing_badge')}
          </>}
          title={<>
            {activeTrip.origin} <span className="state-panel-arrow">→</span> {activeTrip.destination}
          </>}
          text={activeTrip.role === 'passenger'
            ? t('matches.active_passenger_desc', { name: activeTrip.user?.name || activeTrip.driverName || t('matches.driver_fallback') })
            : t('matches.active_driver_desc', { taken: activeTrip.seats_taken || 1, total: activeTrip.seats || 3 })}
          action={<button
            type="button"
            onClick={onGoToActiveTrip}
            className="primary-btn state-panel-action"
          >
            {t('matches.go_to_trip')}
          </button>}
        />
      </div>
    );
  }

  if (!searchCriteria && matches.length === 0) {
    return (
      <div className="matches screen-content">
        <StatePanel
          icon={<Navigation size={22} />}
          title={t('matches.no_active_title')}
          text={t('matches.no_active_desc')}
          action={<button
            type="button"
            onClick={onCancel}
            className="secondary-btn state-panel-action"
          >
            {t('matches.go_to_search')}
          </button>}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="matches screen-content">
        <header className="matches-heading">
          <div>
            <p className="matches-kicker">{t('matches.searching_kicker')}</p>
            <h2 className="matches-title">{t('matches.searching')}</h2>
          </div>
          <button type="button" onClick={onCancel} className="matches-cancel">
            <X size={14} aria-hidden="true" />
            {t('cancel')}
          </button>
        </header>
        <div className="matches-list">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="matches screen-content">
        <StatePanel
          icon={<Clock size={22} />}
          title={t('matches.empty')}
          text={t('matches.empty_desc')}
          action={<button type="button" onClick={onCancel} className="secondary-btn state-panel-action">
            <X size={15} aria-hidden="true" />
            {t('matches.cancel_search')}
          </button>}
        />
      </div>
    );
  }

  return (
    <div className="matches screen-content">
      {requestError && (
        <div role="alert" className="matches-error">
          {requestError}
        </div>
      )}

      <header className="matches-heading">
        <div>
          <p className="matches-kicker">{isDriver ? t('matches.kicker_driver') : t('matches.kicker_passenger')}</p>
          <h2 className="matches-title">{isDriver ? t('matches.title_driver') : t('matches.title_passenger')}</h2>
        </div>
        <button type="button" onClick={onCancel} className="matches-cancel">
          <X size={14} aria-hidden="true" />
          {t('matches.cancel_short')}
        </button>
      </header>

      {uniqueDates.length > 1 && (
        <div className="date-chips-row" role="group" aria-label={t('matches.date_filter_aria')}>
          <button
            type="button"
            className={'date-chip' + (activeDateFilter === null ? ' active' : '')}
            onClick={() => setActiveDateFilter(null)}
            aria-pressed={activeDateFilter === null}
          >
            {t('common.all')}
          </button>
          {uniqueDates.map((d) => (
            <button
              key={d || 'null'}
              type="button"
              className={'date-chip' + (activeDateFilter === d ? ' active' : '')}
              onClick={() => setActiveDateFilter(d)}
              aria-pressed={activeDateFilter === d}
            >
              {formatChipLabel(d, t, i18n.language)}
            </button>
          ))}
        </div>
      )}

      <div className="matches-list">
        {filteredMatches.map((trip) => {
          const status = requestStatus[trip.id];
          return (
            <article key={trip.id} className="match-card">
              <div className="match-card-top">
                <div className="match-person">
                  <img src={trip.user.photo} alt={trip.user.name} className="user-avatar" />
                  <div className="match-person-info">
                    <div className="user-name">
                      <span>{trip.user.name}</span>
                      {trip.user.is_verified && (
                        <CheckCircle size={14} className="match-verified-icon" aria-label={t('matches.verified_aria')} />
                      )}
                    </div>
                    <div className="user-meta">
                      <span>
                        <Star size={13} className="match-rating-icon" fill="currentColor" aria-hidden="true" />
                        {(trip.user.trust_rating || 5.0).toFixed(1)}
                      </span>
                      {trip.role === 'driver' && trip.user.car_model && (
                        <span>
                          <Car size={13} aria-hidden="true" />
                          {trip.user.car_model}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {trip.role === 'driver' ? (
                  trip.price_per_seat > 0 ? (
                    <div className="match-price">
                      <span className="match-price-value">{trip.price_per_seat}</span>
                      <span className="match-price-unit">{t('matches.price_unit')}</span>
                    </div>
                  ) : (
                    <span className="match-price-free">{t('common.by_agreement')}</span>
                  )
                ) : (
                  <span className="match-role-badge">{t('matches.passenger')}</span>
                )}
              </div>

              <div className="match-route-card">
                <div className="match-route-row">
                  <span className="match-route-node match-route-node-from" aria-hidden="true" />
                  <div>
                    <span className="match-route-label">{t('search.from')}</span>
                    <span className="match-route-place">{trip.from}</span>
                  </div>
                </div>
                <div className="match-route-line" aria-hidden="true" />
                <div className="match-route-row">
                  <span className="match-route-node match-route-node-to" aria-hidden="true" />
                  <div>
                    <span className="match-route-label">{t('search.to')}</span>
                    <span className="match-route-place">{trip.to}</span>
                  </div>
                </div>
              </div>

              <div className="match-meta-row">
                <span className="match-meta-chip">
                  <Clock size={13} aria-hidden="true" />
                  {trip.time}
                </span>
                {trip.role === 'driver' && (
                  <span className="match-meta-chip">
                    <Users size={13} aria-hidden="true" />
                    {t('matches.seats_left', {
                      free: Math.max(0, (trip.seats ?? 3) - (trip.seats_taken ?? 0)),
                      total: trip.seats ?? 3,
                    })}
                  </span>
                )}
                {trip.date && (
                  <span className="match-meta-chip">
                    <Calendar size={13} aria-hidden="true" />
                    {formatChipLabel(trip.date, t, i18n.language)}
                  </span>
                )}
              </div>

              {isDriver ? (
                <div className="match-note">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('matches.driver_wait_note')}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className={'primary-btn match-btn' + (status ? ' is-' + status : '')}
                  onClick={() => { if (!status) handleSendRequest(trip); }}
                  disabled={!!status}
                  aria-busy={status === 'sending'}
                >
                  {status === 'sending' && (
                    <>
                      <Loader size={16} className="spin" aria-hidden="true" />
                      <span>{t('matches.btn_sending')}</span>
                    </>
                  )}
                  {status === 'pending' && (
                    <>
                      <Clock size={15} aria-hidden="true" />
                      <span>{t('matches.btn_pending')}</span>
                    </>
                  )}
                  {status === 'accepted' && (
                    <>
                      <CheckCircle2 size={15} aria-hidden="true" />
                      <span>{t('matches.btn_accepted')}</span>
                    </>
                  )}
                  {status === 'declined' && (
                    <>
                      <X size={15} aria-hidden="true" />
                      <span>{t('matches.btn_declined')}</span>
                    </>
                  )}
                  {!status && (
                    <>
                      <Send size={15} aria-hidden="true" />
                      <span>{t('matches.btn_request')}</span>
                    </>
                  )}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

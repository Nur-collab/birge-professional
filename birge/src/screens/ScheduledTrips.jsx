import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar, Clock, Users, Car,
  Star, ShieldCheck, ChevronRight, RefreshCw, Trash2, Plus
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import { localDateStr } from '../utils/date';
import ReviewModal from '../components/ReviewModal';
import SkeletonCard from '../components/SkeletonCard';
import StatePanel from '../components/StatePanel';
import './ScheduledTrips.css';

export default function ScheduledTrips({ currentUser, onOpenTrip, onCancel }) {
  const { t, i18n } = useTranslation();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState('');
  // Пользователь, которого оцениваем; для проверки на бэкенде храним trip_id.
  const [reviewTarget, setReviewTarget] = useState(null); // { id, name, photo, trip_id }

  const today = localDateStr();
  const tomorrow = localDateStr(1);

  const formatDate = (d) => {
    if (!d) return '—';
    if (d === today) return t('common.today');
    if (d === tomorrow) return t('common.tomorrow');
    const dt = new Date(d + 'T00:00:00');
    const locale = i18n.language === 'ky' ? 'ky-KG' : 'ru-RU';
    return dt.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' });
  };

  const daysUntil = (d) => {
    if (!d) return null;
    const diff = Math.ceil((new Date(d + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    if (diff === 0) return t('common.today').toLowerCase();
    if (diff === 1) return t('common.tomorrow').toLowerCase();
    return t('sched.days_in', { days: diff });
  };

  const tripsCountLabel = (count) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return t('sched.count_one', { count });
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t('sched.count_few', { count });
    return t('sched.count_many', { count });
  };

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await api.getScheduledTrips();
      setTrips(Array.isArray(data) ? data : []);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Обновляем каждые 30 сек
    const interval = setInterval(() => load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  const handleCancel = async (trip) => {
    // Водитель отменяет свою поездку, пассажир — своё участие в поездке
    // водителя. Удалять requester_trip_id нельзя: это лишь поисковая
    // поездка пассажира, а принятая заявка останется на сервере.
    const confirmMsg =
      trip.role === 'driver'
        ? t('sched.confirm_driver_cancel')
        : t('sched.confirm_passenger_cancel');

    if (!window.confirm(confirmMsg)) return;

    setCancellingId(trip.trip_id);
    try {
      if (trip.role === 'driver') {
        await api.updateTripStatus(trip.trip_id, 'cancelled');
      } else {
        await api.updateTripStatus(trip.trip_id, 'passenger_cancelled');
      }
      setTrips(prev => prev.filter(t => t.trip_id !== trip.trip_id));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="sched-screen">
      {error && (
        <div role="alert" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger-border)', borderRadius: 12, padding: '10px 14px', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      {/* Заголовок */}
      <div className="sched-header">
        <div>
          <h2 className="sched-title">{t('sched.title')}</h2>
          <p className="sched-subtitle">
            {loading
              ? t('sched.loading')
              : trips.length > 0
                ? tripsCountLabel(trips.length)
                : t('sched.empty')}
          </p>
        </div>
        <button
          type="button"
          className={`sched-refresh-btn ${refreshing ? 'spinning' : ''}`}
          onClick={() => load(true)}
          title={t('sched.refresh')}
          aria-label={t('sched.refresh_aria')}
          aria-busy={refreshing}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>

      {loading ? (
        <div className="sched-list">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : trips.length === 0 ? (
        <StatePanel
          titleAs="h3"
          icon={<Calendar size={22} />}
          title={t('sched.empty_title')}
          text={t('sched.empty_desc')}
          action={<button
            type="button"
            className="primary-btn state-panel-action"
            onClick={onCancel}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} aria-hidden="true" />
            <span>{t('sched.plan_btn')}</span>
          </button>}
        />
      ) : (
        <div className="sched-list">
          {trips.map((trip, idx) => (
            <div key={`${trip.trip_id}-${idx}`} className="sched-card">

              {/* Цветной акцент слева — зелёный для водителя, синий для пассажира */}
              <div className={`sched-card-accent ${trip.role === 'driver' ? 'accent-driver' : 'accent-passenger'}`} />

              {/* Верхняя строка: роль + дата */}
              <div className="sched-card-top">
                <div className="sched-role-badge">
                  {trip.role === 'driver' ? (
                    <><Car size={12} /> {t('matches.driver')}</>
                  ) : (
                    <><Users size={12} /> {t('matches.passenger')}</>
                  )}
                </div>
                <div className="sched-date-chip">
                  <Calendar size={12} />
                  <span>{formatDate(trip.date)}</span>
                  {trip.date && trip.date !== today && trip.date !== tomorrow && (
                    <span className="sched-days-until">({daysUntil(trip.date)})</span>
                  )}
                </div>
              </div>

              {/* Маршрут */}
              <div className="sched-route">
                <div className="sched-route-row">
                  <div className="sched-dot green" />
                  <span className="sched-loc">{trip.origin}</span>
                </div>
                <div className="sched-route-line" />
                <div className="sched-route-row">
                  <div className="sched-dot red" />
                  <span className="sched-loc">{trip.destination}</span>
                </div>
              </div>

              {/* Время */}
              <div className="sched-time-row">
                <Clock size={13} color="var(--info)" />
                <span className="sched-time">{trip.time}</span>
                {trip.role === 'driver' && (
                  <div className="sched-seats-mini">
                    <Users size={12} color="var(--primary)" />
                    <span>{trip.seats_taken} / {trip.seats}</span>
                  </div>
                )}
              </div>

              {/* Пассажиры (для водителя) */}
              {trip.role === 'driver' && trip.passengers && trip.passengers.length > 0 && (
                <div className="sched-passengers">
                  <div className="sched-pass-label">{t('sched.passengers_label')}</div>
                  <div className="sched-pass-list">
                    {trip.passengers.map(p => (
                      <div key={p.id} className="sched-pass-row">
                        <img
                          src={p.photo || `https://i.pravatar.cc/40?u=${p.id}`}
                          alt={p.name}
                          className="sched-pass-photo"
                        />
                        <div className="sched-pass-info">
                          <span className="sched-pass-name">{p.name}</span>
                          <div className="sched-pass-rating">
                            <Star size={10} fill="var(--warning)" color="var(--warning)" />
                            <span>{p.trust_rating?.toFixed(1)}</span>
                            {p.is_verified && <ShieldCheck size={10} color="var(--primary)" />}
                          </div>
                        </div>
                        {/* Водитель может оценить пассажира */}
                        <button
                          type="button"
                          className="sched-review-btn"
                          onClick={() => setReviewTarget(p)}
                          title={t('sched.rate_passenger_title')}
                          aria-label={t('sched.rate_passenger_aria', { name: p.name })}
                        >
                          <Star size={11} fill="var(--warning)" color="var(--warning)" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Водитель (для пассажира) */}
              {trip.role === 'passenger' && trip.driver && (
                <div className="sched-driver-card">
                  <img
                    src={trip.driver.photo || `https://i.pravatar.cc/40?u=${trip.driver.id}`}
                    alt={trip.driver.name}
                    className="sched-driver-photo"
                  />
                  <div className="sched-driver-info">
                    <div className="sched-driver-name">{trip.driver.name}</div>
                    <div className="sched-driver-rating">
                      <Star size={10} fill="var(--warning)" color="var(--warning)" />
                      <span>{trip.driver.trust_rating?.toFixed(1)}</span>
                      {trip.driver.is_verified && <ShieldCheck size={10} color="var(--primary)" />}
                    </div>
                    {trip.driver.car_model && (
                      <div className="sched-car-row">
                        <div className="sched-car-model">
                          <Car size={10} color="var(--primary)" />
                          {trip.driver.car_model}
                          {trip.driver.car_color ? ` · ${trip.driver.car_color}` : ''}
                        </div>
                        {trip.driver.car_plate && (
                          <div className="sched-car-plate">{trip.driver.car_plate}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Оценка доступна только после поездки, не для будущих дат */}
              {trip.role === 'passenger' && trip.driver && trip.date && trip.date <= today && (
                <button
                  type="button"
                  className="sched-review-btn"
                  onClick={() => setReviewTarget({ ...trip.driver, trip_id: trip.trip_id })}
                  title={t('sched.rate_driver_title')}
                >
                  <Star size={12} fill="var(--warning)" color="var(--warning)" aria-hidden="true" />
                  {t('sched.rate_driver')}
                </button>
              )}

              {/* Действия */}
              <div className="sched-actions">
                <button
                  type="button"
                  className="sched-open-btn"
                  onClick={() => onOpenTrip(trip)}
                >
                  {t('sched.open_trip')} <ChevronRight size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`sched-cancel-btn ${cancellingId === trip.trip_id ? 'loading' : ''}`}
                  onClick={() => handleCancel(trip)}
                  disabled={cancellingId === trip.trip_id}
                  title={trip.role === 'driver' ? t('sched.cancel') : t('sched.decline_trip')}
                  aria-label={trip.role === 'driver' ? t('sched.cancel') : t('sched.decline_trip')}
                  aria-busy={cancellingId === trip.trip_id}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ReviewModal: открывается при клике на кнопку оценки */}
      {reviewTarget && (
        <ReviewModal
          partner={reviewTarget}
          onSubmit={async (rating, text) => {
            try {
              await api.submitReview(reviewTarget.id, rating, text, reviewTarget.trip_id);
              setReviewTarget(null);
              setError('');
            } catch (e) {
              setError(e.message);
            }
          }}
          onSkip={() => setReviewTarget(null)}
        />
      )}

    </div>
  );
}

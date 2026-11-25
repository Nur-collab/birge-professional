import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar, MapPin, Navigation, Clock, Users, Car,
  Star, ShieldCheck, ChevronRight, RefreshCw, Trash2, ArrowRight, Plus
} from 'lucide-react';
import { api } from '../utils/api';
import { localDateStr } from '../utils/date';
import ReviewModal from '../components/ReviewModal';
import SkeletonCard from '../components/SkeletonCard';
import StatePanel from '../components/StatePanel';

export default function ScheduledTrips({ currentUser, onOpenTrip, onCancel }) {
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
    if (d === today) return 'Сегодня';
    if (d === tomorrow) return 'Завтра';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
  };

  const daysUntil = (d) => {
    if (!d) return null;
    const diff = Math.ceil((new Date(d + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    if (diff === 0) return 'сегодня';
    if (diff === 1) return 'завтра';
    return `через ${diff} дн.`;
  };

  const tripsCountLabel = (count) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return `${count} предстоящая поездка`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} предстоящие поездки`;
    return `${count} предстоящих поездок`;
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
        ? 'Отменить запланированную поездку? Все пассажиры будут уведомлены.'
        : 'Отказаться от поездки с этим водителем?';

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
          <h2 className="sched-title">Запланированные</h2>
          <p className="sched-subtitle">
            {loading
              ? 'Загружаем поездки…'
              : trips.length > 0
                ? tripsCountLabel(trips.length)
                : 'Нет запланированных поездок'}
          </p>
        </div>
        <button
          type="button"
          className={`sched-refresh-btn ${refreshing ? 'spinning' : ''}`}
          onClick={() => load(true)}
          title="Обновить"
          aria-label="Обновить запланированные поездки"
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
          title="Пока пусто"
          text="Запланируйте поездку на завтра или следующую неделю — она появится здесь автоматически"
          action={<button
            type="button"
            className="primary-btn state-panel-action"
            onClick={onCancel}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Запланировать поездку</span>
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
                    <><Car size={12} /> Водитель</>
                  ) : (
                    <><Users size={12} /> Пассажир</>
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
                  <div className="sched-pass-label">Пассажиры:</div>
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
                          title="Оценить пассажира"
                          aria-label={`Оценить пассажира ${p.name}`}
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
                  title="Оставить отзыв о водителе"
                >
                  <Star size={12} fill="var(--warning)" color="var(--warning)" aria-hidden="true" />
                  Оценить водителя
                </button>
              )}

              {/* Действия */}
              <div className="sched-actions">
                <button
                  type="button"
                  className="sched-open-btn"
                  onClick={() => onOpenTrip(trip)}
                >
                  Открыть поездку <ChevronRight size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`sched-cancel-btn ${cancellingId === trip.trip_id ? 'loading' : ''}`}
                  onClick={() => handleCancel(trip)}
                  disabled={cancellingId === trip.trip_id}
                  title={trip.role === 'driver' ? 'Отменить поездку' : 'Отказаться от поездки'}
                  aria-label={trip.role === 'driver' ? 'Отменить поездку' : 'Отказаться от поездки'}
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

      <style>{`
        .sched-screen {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        /* Header */
        .sched-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .sched-title {
          font-size: 1.15rem;
          font-weight: 800;
          color: var(--text-main);
          margin: 0 0 2px 0;
        }
        .sched-subtitle {
          font-size: 0.78rem;
          color: var(--text-muted);
          margin: 0;
        }
        .sched-review-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          background: var(--warning-soft);
          border: 1.5px solid var(--warning-border);
          border-radius: 20px;
          color: var(--warning-strong);
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          margin-top: 6px;
        }
        .sched-review-btn:hover {
          background: var(--warning-soft);
          border-color: var(--warning);
        }
        .sched-refresh-btn {
          width: 44px; height: 44px;
          border-radius: 10px;
          border: 1.5px solid var(--border-subtle);
          background: var(--bg-card);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          color: var(--text-muted);
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .sched-refresh-btn:hover { background: var(--bg-subtle); color: var(--text-muted); }
        .sched-refresh-btn.spinning svg { animation: spin360 0.7s linear infinite; }
        @keyframes spin360 { to { transform: rotate(360deg); } }

        /* Cards list */
        .sched-list { display: flex; flex-direction: column; gap: 14px; }

        /* Card */
        .sched-card {
          background: var(--bg-card);
          border: 1.5px solid var(--bg-subtle);
          border-radius: 18px;
          padding: 16px;
          display: flex; flex-direction: column; gap: 12px;
          position: relative;
          overflow: hidden;
          box-shadow: 0 2px 12px var(--shadow-soft);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .sched-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px var(--shadow-soft); }

        .sched-card-accent {
          position: absolute; left: 0; top: 0; bottom: 0;
          width: 4px;
        }
        .accent-driver { background: var(--primary); }
        .accent-passenger { background: var(--info); }

        /* Top row */
        .sched-card-top {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px;
        }
        .sched-role-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 20px;
          font-size: 0.72rem; font-weight: 700;
          background: var(--accent-soft); color: var(--primary-hover);
        }
        .accent-passenger ~ * .sched-role-badge,
        .sched-card:has(.accent-passenger) .sched-role-badge {
          background: var(--info-soft); color: var(--info);
        }
        .sched-date-chip {
          display: flex; align-items: center; gap: 4px;
          background: var(--bg-input); border: 1px solid var(--border-subtle);
          border-radius: 20px; padding: 3px 10px;
          font-size: 0.72rem; color: var(--text-muted); font-weight: 600;
        }
        .sched-days-until { color: var(--info); font-weight: 700; }

        /* Route */
        .sched-route {
          background: var(--bg-input); border-radius: 10px; padding: 10px 12px;
          display: flex; flex-direction: column; gap: 0;
        }
        .sched-route-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
        .sched-route-line {
          height: 1px; background: var(--border-subtle);
          margin: 0 0 0 7px; /* align with dot center */
        }
        .sched-dot {
          width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
        }
        .sched-dot.green { background: var(--primary); }
        .sched-dot.red { background: var(--danger); }
        .sched-loc {
          font-size: 0.82rem; color: var(--text-muted); font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          flex: 1;
        }

        /* Time row */
        .sched-time-row {
          display: flex; align-items: center; gap: 6px;
        }
        .sched-time {
          font-size: 0.9rem; font-weight: 700; color: var(--text-main); flex: 1;
        }
        .sched-seats-mini {
          display: flex; align-items: center; gap: 4px;
          background: var(--accent-soft); border-radius: 8px; padding: 3px 8px;
          font-size: 0.75rem; font-weight: 600; color: var(--primary-hover);
        }

        /* Passengers (driver view) */
        .sched-passengers { display: flex; flex-direction: column; gap: 6px; }
        .sched-pass-label { font-size: 0.72rem; color: var(--text-subtle); font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
        .sched-pass-list { display: flex; flex-direction: column; gap: 6px; }
        .sched-pass-row {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-input); border-radius: 10px; padding: 7px 10px;
        }
        .sched-pass-photo {
          width: 32px; height: 32px; border-radius: 50%;
          object-fit: cover; border: 2px solid var(--accent-soft); flex-shrink: 0;
        }
        .sched-pass-info { display: flex; flex-direction: column; gap: 2px; }
        .sched-pass-name { font-size: 0.82rem; font-weight: 600; color: var(--text-main); }
        .sched-pass-rating { display: flex; align-items: center; gap: 3px; font-size: 0.72rem; color: var(--text-muted); }

        /* Driver card (passenger view) */
        .sched-driver-card {
          display: flex; align-items: flex-start; gap: 10px;
          background: var(--info-soft); border: 1px solid var(--info-border);
          border-radius: 12px; padding: 10px 12px;
        }
        .sched-driver-photo {
          width: 40px; height: 40px; border-radius: 50%;
          object-fit: cover; border: 2px solid var(--bg-card); flex-shrink: 0;
          box-shadow: 0 1px 6px var(--shadow-medium);
        }
        .sched-driver-info { display: flex; flex-direction: column; gap: 3px; flex: 1; }
        .sched-driver-name { font-size: 0.88rem; font-weight: 700; color: var(--text-main); }
        .sched-driver-rating { display: flex; align-items: center; gap: 3px; font-size: 0.72rem; color: var(--text-muted); }
        .sched-car-row { display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
        .sched-car-model {
          display: flex; align-items: center; gap: 4px;
          background: var(--accent-soft); border: 1px solid var(--accent-soft);
          border-radius: 6px; padding: 2px 7px;
          font-size: 0.72rem; font-weight: 600; color: var(--primary);
        }
        .sched-car-plate {
          background: var(--inverse-surface); color: var(--inverse-text);
          border-radius: 5px; padding: 2px 7px;
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.5px;
        }

        /* Actions */
        .sched-actions { display: flex; gap: 8px; align-items: center; }
        .sched-open-btn {
          flex: 1;
          min-height: 44px;
          display: flex; align-items: center; justify-content: center; gap: 5px;
          background: var(--info-strong);
          color: var(--on-primary); border: none; border-radius: 12px;
          font-size: 0.85rem; font-weight: 700;
          padding: 10px 14px; cursor: pointer;
          transition: opacity 0.15s ease;
        }
        .sched-open-btn:hover { opacity: 0.92; }
        .sched-cancel-btn {
          width: 40px; height: 40px;
          border: 1.5px solid var(--danger-soft); border-radius: 12px;
          background: var(--danger-soft); color: var(--danger);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s; flex-shrink: 0;
        }
        .sched-cancel-btn:hover:not(:disabled) { background: var(--danger-soft); }
        .sched-cancel-btn.loading { opacity: 0.5; cursor: wait; }
      `}</style>
    </div>
  );
}

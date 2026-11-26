import React, { useState, useEffect } from 'react';
import { ArrowLeft, MapPin, Calendar, CheckCircle, Clock, Car, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';

export default function TripHistory({ currentUser, onBack }) {
  const { t } = useTranslation();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTrips();
  }, []);

  const loadTrips = async () => {
    try {
      setLoading(true);
      const data = await api.getMyTrips();
      // Фильтруем поездки, оставляя только те, которые уже завершены или сматчены
      const pastTrips = data.filter(t => t.status === 'completed' || t.status === 'matched');
      setTrips(pastTrips);
    } catch (error) {
      console.error('Failed to load trips history', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return dateString || t('common.no_date');
  };

  return (
    <div className="history screen-content">
      <div className="history-header">
        <button type="button" className="back-btn" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </button>
        <h2>{t('history.title')}</h2>
        <div style={{ width: 24 }}></div>
      </div>

      <div className="history-list">
        {loading ? (
          <div role="status" aria-live="polite" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <div className="loader" aria-hidden="true" style={{ width: 30, height: 30, borderWidth: 3 }}></div>
            <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{t('loading')}</p>
          </div>
        ) : trips.length === 0 ? (
          <div className="empty-state glass-panel">
            <Clock size={48} color="var(--text-subtle)" style={{ margin: '0 auto 1rem auto' }} />
            <h3>{t('history.empty')}</h3>
          </div>
        ) : (
          trips.map(trip => (
            <div key={trip.id} className="history-card glass-panel">
              <div className="history-card-header">
                <div className="history-date">
                  <Calendar size={14} />
                  <span>{t('history.at_time', { date: formatDate(trip.date), time: trip.time })}</span>
                </div>
                {trip.status === 'completed' ? (
                  <span className="history-status completed">
                    <CheckCircle size={14} /> {t('matches.status.completed')}
                  </span>
                ) : (
                  <span className="history-status active">{t('matches.status.active')}</span>
                )}
              </div>

              <div className="history-route">
                <div className="route-point">
                  <MapPin size={16} color="var(--primary)" />
                  <span className="point-text">{trip.origin}</span>
                </div>
                <div className="route-line"></div>
                <div className="route-point">
                  <MapPin size={16} color="var(--primary)" />
                  <span className="point-text">{trip.destination}</span>
                </div>
              </div>

              <div className="history-footer">
                <span className="history-role" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {trip.role === 'driver' ? <><Car size={13} /> {t('matches.driver')}</> : <><User size={13} /> {t('matches.passenger')}</>}
                </span>
                <span style={{ fontWeight: 700, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {(trip.price_per_seat ?? trip.price ?? 0) > 0
                    ? `${trip.price_per_seat ?? trip.price} ${t('common.som')}`
                    : t('common.free')}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        .history {
          animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .history-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 0 1.5rem 0;
        }
        .history-header h2 {
          font-size: 1.2rem;
          color: var(--dark);
          margin: 0;
        }
        .back-btn {
          min-width: 44px;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-muted);
          padding: 8px;
          margin-left: -10px;
          cursor: pointer;
        }
        .history-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .empty-state {
          text-align: center;
          padding: 3rem 1.5rem;
          border: 1px dashed var(--border-strong);
        }
        .empty-state h3 {
          color: var(--dark);
          margin: 0;
        }
        .history-card {
          padding: 1.2rem;
          transition: transform 0.2s;
        }
        .history-card:active {
          transform: scale(0.98);
        }
        .history-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          padding-bottom: 0.8rem;
          border-bottom: 1px solid var(--bg-subtle);
        }
        .history-date {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.85rem;
          color: var(--text-muted);
          font-weight: 500;
        }
        .history-status {
          font-size: 0.75rem;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .history-status.completed {
          background: var(--accent-soft);
          color: var(--primary-hover);
        }
        .history-status.active {
          background: var(--warning-soft);
          color: var(--warning);
        }
        .history-route {
          position: relative;
          padding-left: 8px;
          margin-bottom: 1rem;
        }
        .route-line {
          position: absolute;
          left: 15px;
          top: 20px;
          bottom: 20px;
          width: 2px;
          background: var(--border-subtle);
          z-index: 0;
        }
        .route-point {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 10px 0;
          position: relative;
          z-index: 1;
        }
        .route-point svg {
          background: var(--glass-bg);
          border-radius: 50%;
        }
        .point-text {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--dark);
        }
        .history-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px dashed var(--border-subtle);
          font-size: 0.85rem;
        }
        .history-role {
          color: var(--text-muted);
          font-weight: 500;
        }
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

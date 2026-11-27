import React, { useState, useEffect } from 'react';
import { ArrowLeft, MapPin, Calendar, CheckCircle, Clock, Car, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import './TripHistory.css';

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

    </div>
  );
}

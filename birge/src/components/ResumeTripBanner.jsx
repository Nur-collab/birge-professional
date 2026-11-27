import React from 'react';
import { Navigation, Trash2, RotateCcw, Clock, Car, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './ResumeTripBanner.css';

/**
 * ResumeTripBanner — всплывает снизу если у пользователя есть
 * незавершённая active-поездка (закрыл приложение во время поиска).
 *
 * Props:
 *  trip     {object}   — данные поездки из /users/me/active-trip
 *  onResume {function} — возобновить поиск
 *  onDiscard {function} — удалить и начать заново
 */
export default function ResumeTripBanner({ trip, onResume, onDiscard }) {
  const { t } = useTranslation();
  if (!trip?.found) return null;

  const isDriver = trip.role === 'driver';
  const roleLabel = isDriver ? t('dash.role_driver') : t('dash.role_passenger');
  const roleColor = isDriver ? 'var(--warning)' : 'var(--primary)';
  const roleSurface = isDriver ? 'var(--warning-soft)' : 'var(--accent-soft)';

  return (
    <div style={styles.wrapper} role="region" aria-label={t('resume.aria')}>
      <div style={styles.card}>
        {/* Иконка */}
        <div style={{ ...styles.iconWrap, background: roleSurface, color: roleColor }}>
          <RotateCcw size={20} />
        </div>

        {/* Текст */}
        <div style={styles.body}>
          <div style={styles.title}>{t('resume.title')}</div>
          <div style={{ ...styles.role, display: 'flex', alignItems: 'center', gap: 4 }}>
            {isDriver ? <Car size={13} /> : <User size={13} />}
            <span>{roleLabel}</span>
          </div>
          <div style={styles.route}>
            <span style={styles.routeFrom}>{trip.origin}</span>
            <span style={styles.arrow}>→</span>
            <span style={styles.routeTo}>{trip.destination}</span>
          </div>
          <div style={{ ...styles.time, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={12} />
            <span>{trip.time}</span>
          </div>
        </div>

        {/* Кнопки */}
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.resumeBtn}
            onClick={onResume}
            title={t('resume.continue_title')}
          >
            <Navigation size={15} aria-hidden="true" />
            {t('resume.continue')}
          </button>
          <button
            type="button"
            style={styles.discardBtn}
            onClick={onDiscard}
            title={t('resume.discard_title')}
            aria-label={t('resume.discard_aria')}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

    </div>
  );
}

const styles = {
  wrapper: {
    position: 'fixed',
    bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'calc(100% - 2rem)',
    maxWidth: 444,
    zIndex: 200,
    animation: 'birge-slide-up 0.35s ease-out',
  },

  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'var(--surface-glass)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1.5px solid var(--border-subtle)',
    borderRadius: 18,
    padding: '12px 14px',
    boxShadow: '0 8px 32px var(--shadow-medium), 0 2px 8px var(--primary-glow)',
  },

  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  body: {
    flex: 1,
    minWidth: 0,
  },

  title: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    marginBottom: 2,
  },

  role: {
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: 3,
  },

  route: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },

  routeFrom: {
    fontSize: '0.75rem',
    color: 'var(--text-main)',
    fontWeight: 500,
    maxWidth: 110,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  arrow: {
    fontSize: '0.75rem',
    color: 'var(--text-subtle)',
  },

  routeTo: {
    fontSize: '0.75rem',
    color: 'var(--text-main)',
    fontWeight: 500,
    maxWidth: 110,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  time: {
    fontSize: '0.73rem',
    color: 'var(--text-subtle)',
    marginTop: 2,
  },

  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
  },

  resumeBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '7px 12px',
    background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))',
    color: 'var(--on-primary)',
    border: 'none',
    borderRadius: 10,
    fontSize: '0.8rem',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px var(--primary-glow)',
    transition: 'opacity 0.15s',
  },

  discardBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px',
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
};
